import dotenv from 'dotenv'
import fs from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

dotenv.config({ path: '.env' })

const API_BASE = String(process.env.API_BASE || 'http://localhost:3000/api').replace(/\/$/, '')
const BENCH_TOKEN = String(process.env.BENCH_TOKEN || '').trim()
const BENCH_WARMUP = Math.max(0, Number.parseInt(process.env.BENCH_WARMUP || '2', 10) || 2)
const BENCH_RUNS = Math.max(1, Number.parseInt(process.env.BENCH_RUNS || '15', 10) || 15)
const BENCH_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.BENCH_TIMEOUT_MS || '15000', 10) || 15000)
const BENCH_COMPARE_FILE = String(process.env.BENCH_COMPARE_FILE || '').trim()
const BENCH_OUT_FILE = String(process.env.BENCH_OUT_FILE || '').trim()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const percentile = (values, p) => {
    const sorted = [...values].sort((left, right) => left - right)
    if (sorted.length === 0) return 0
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[index]
}

const round = (value) => Number(Number(value || 0).toFixed(2))

const buildStats = (values = []) => {
    const normalized = (Array.isArray(values) ? values : [])
        .map((entry) => Number(entry || 0))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)

    if (normalized.length === 0) {
        return {
            min: 0,
            max: 0,
            avg: 0,
            p50: 0,
            p95: 0,
        }
    }

    const total = normalized.reduce((sum, entry) => sum + entry, 0)

    return {
        min: round(Math.min(...normalized)),
        max: round(Math.max(...normalized)),
        avg: round(total / normalized.length),
        p50: round(percentile(normalized, 50)),
        p95: round(percentile(normalized, 95)),
    }
}

const resolveItemCount = (data = null) => {
    if (!data || typeof data !== 'object') return 0

    if (Array.isArray(data.posts)) return data.posts.length
    if (Array.isArray(data.onlineTrainers)) return data.onlineTrainers.length
    if (Array.isArray(data.pokemon)) return data.pokemon.length
    if (Array.isArray(data.items)) return data.items.length

    return 0
}

const requestJsonMetrics = async (path, { token = '' } = {}) => {
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), BENCH_TIMEOUT_MS)

    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {}
        const response = await fetch(`${API_BASE}${path}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        })

        const rawText = await response.text()
        const rawBytes = Buffer.byteLength(rawText, 'utf8')
        const gzipBytes = gzipSync(Buffer.from(rawText, 'utf8')).length

        let data = null
        try {
            data = rawText ? JSON.parse(rawText) : null
        } catch {
            data = null
        }

        const resolvedError = response.ok
            ? ''
            : String(data?.message || data?.error || `HTTP ${response.status}`).trim()

        return {
            ok: response.ok,
            status: response.status,
            latencyMs: performance.now() - startedAt,
            rawBytes,
            gzipBytes,
            itemCount: resolveItemCount(data),
            error: resolvedError,
        }
    } catch (error) {
        return {
            ok: false,
            status: 0,
            latencyMs: performance.now() - startedAt,
            rawBytes: 0,
            gzipBytes: 0,
            itemCount: 0,
            error: String(error?.message || error),
        }
    } finally {
        clearTimeout(timeout)
    }
}

const summarizeRecords = (records = []) => {
    const safeRecords = Array.isArray(records) ? records : []
    const successRecords = safeRecords.filter((entry) => entry.ok)
    const statusCounts = safeRecords.reduce((acc, entry) => {
        const key = String(entry.status || 0)
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

    const bytesPerItemValues = safeRecords
        .filter((entry) => Number(entry.itemCount) > 0)
        .map((entry) => Number(entry.rawBytes) / Number(entry.itemCount))

    return {
        runs: safeRecords.length,
        requestCount: safeRecords.length,
        successCount: successRecords.length,
        errorCount: safeRecords.length - successRecords.length,
        successRate: safeRecords.length > 0 ? round((successRecords.length / safeRecords.length) * 100) : 0,
        statusCounts,
        latencyMs: buildStats(safeRecords.map((entry) => entry.latencyMs)),
        rawBytes: buildStats(safeRecords.map((entry) => entry.rawBytes)),
        gzipBytes: buildStats(safeRecords.map((entry) => entry.gzipBytes)),
        itemCount: buildStats(safeRecords.map((entry) => entry.itemCount)),
        bytesPerItem: buildStats(bytesPerItemValues),
        errors: safeRecords.filter((entry) => !entry.ok).slice(0, 3).map((entry) => entry.error),
    }
}

const runSpec = async (spec = {}) => {
    const records = []

    for (let index = 0; index < BENCH_WARMUP; index += 1) {
        await requestJsonMetrics(spec.path, { token: spec.token || '' })
        await sleep(10)
    }

    for (let index = 0; index < BENCH_RUNS; index += 1) {
        const record = await requestJsonMetrics(spec.path, { token: spec.token || '' })
        records.push(record)
        await sleep(10)
    }

    return {
        name: spec.name,
        path: spec.path,
        requiresAuth: Boolean(spec.requiresAuth),
        summary: summarizeRecords(records),
    }
}

const buildComparison = async (currentResults = []) => {
    const compareFilePath = BENCH_COMPARE_FILE
    if (!compareFilePath) return null

    try {
        const raw = await fs.readFile(compareFilePath, 'utf8')
        const parsed = JSON.parse(raw)
        const previousResults = Array.isArray(parsed?.results) ? parsed.results : []
        const previousByPath = new Map(previousResults.map((entry) => [String(entry?.path || ''), entry]))

        const rows = currentResults.map((entry) => {
            const previous = previousByPath.get(String(entry.path || ''))
            if (!previous?.summary) {
                return {
                    path: entry.path,
                    hasBaseline: false,
                }
            }

            const prevRawAvg = Number(previous.summary?.rawBytes?.avg || 0)
            const currRawAvg = Number(entry.summary?.rawBytes?.avg || 0)
            const prevP95 = Number(previous.summary?.latencyMs?.p95 || 0)
            const currP95 = Number(entry.summary?.latencyMs?.p95 || 0)

            const deltaPercent = (before, after) => {
                if (!Number.isFinite(before) || before <= 0) return null
                return round(((after - before) / before) * 100)
            }

            return {
                path: entry.path,
                hasBaseline: true,
                before: {
                    rawBytesAvg: prevRawAvg,
                    latencyP95Ms: prevP95,
                },
                after: {
                    rawBytesAvg: currRawAvg,
                    latencyP95Ms: currP95,
                },
                deltaPercent: {
                    rawBytesAvg: deltaPercent(prevRawAvg, currRawAvg),
                    latencyP95Ms: deltaPercent(prevP95, currP95),
                },
            }
        })

        return {
            compareFile: compareFilePath,
            rows,
        }
    } catch (error) {
        return {
            compareFile: compareFilePath,
            error: String(error?.message || error),
            rows: [],
        }
    }
}

async function main() {
    const specs = [
        {
            name: 'News list',
            path: '/news?limit=20&type=news',
            requiresAuth: false,
            token: '',
        },
        {
            name: 'Online stats list',
            path: '/stats/online?page=1&limit=25',
            requiresAuth: true,
            token: BENCH_TOKEN,
        },
        {
            name: 'Pokemon box',
            path: '/box?page=1&limit=28&sort=id&filter=all',
            requiresAuth: true,
            token: BENCH_TOKEN,
        },
        {
            name: 'Pokedex list',
            path: '/pokemon/pokedex?page=1&limit=50',
            requiresAuth: true,
            token: BENCH_TOKEN,
        },
    ]

    const runnableSpecs = specs.filter((spec) => !spec.requiresAuth || Boolean(spec.token))
    const skippedSpecs = specs
        .filter((spec) => spec.requiresAuth && !spec.token)
        .map((spec) => ({
            name: spec.name,
            path: spec.path,
            reason: 'Missing BENCH_TOKEN',
        }))

    const results = []
    for (const spec of runnableSpecs) {
        const result = await runSpec(spec)
        results.push(result)
    }

    const comparison = await buildComparison(results)

    const report = {
        ok: true,
        config: {
            apiBase: API_BASE,
            warmupRuns: BENCH_WARMUP,
            measureRuns: BENCH_RUNS,
            timeoutMs: BENCH_TIMEOUT_MS,
            hasToken: Boolean(BENCH_TOKEN),
        },
        skipped: skippedSpecs,
        results,
        comparison,
    }

    if (BENCH_OUT_FILE) {
        await fs.writeFile(BENCH_OUT_FILE, JSON.stringify(report, null, 2), 'utf8')
    }

    console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
