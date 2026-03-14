import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const API_BASE = String(process.env.API_BASE || 'http://localhost:3000/api').replace(/\/$/, '')
const BENCH_TOKEN = String(process.env.BENCH_TOKEN || '').trim()
const BENCH_MAP_SLUG = String(process.env.BENCH_MAP_SLUG || '').trim()
const BENCH_POKEMON_ID = String(process.env.BENCH_POKEMON_ID || '').trim()

const WARMUP_RUNS = Math.max(0, Number.parseInt(process.env.BENCH_WARMUP || '3', 10) || 3)
const MEASURE_RUNS = Math.max(1, Number.parseInt(process.env.BENCH_RUNS || '20', 10) || 20)
const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.BENCH_TIMEOUT_MS || '15000', 10) || 15000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const percentile = (values, p) => {
    if (!Array.isArray(values) || values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const rawIndex = Math.ceil((p / 100) * sorted.length) - 1
    const index = Math.max(0, Math.min(sorted.length - 1, rawIndex))
    return sorted[index]
}

const toMs = (value) => Number(value.toFixed(2))

const requestJson = async (path, { token = '', method = 'GET' } = {}) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const started = performance.now()

    try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {}
        const response = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            signal: controller.signal,
        })

        let data = null
        try {
            data = await response.json()
        } catch {
            data = null
        }

        return {
            ok: response.ok,
            status: response.status,
            data,
            latencyMs: performance.now() - started,
            error: '',
        }
    } catch (error) {
        return {
            ok: false,
            status: 0,
            data: null,
            latencyMs: performance.now() - started,
            error: String(error?.message || error),
        }
    } finally {
        clearTimeout(timeout)
    }
}

const summarizeRuns = (runs = []) => {
    const latencies = runs.map((entry) => Number(entry.latencyMs || 0)).filter((entry) => Number.isFinite(entry) && entry >= 0)
    const statusCounts = runs.reduce((acc, entry) => {
        const key = String(entry.status || 0)
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

    const successCount = runs.filter((entry) => entry.ok).length
    const errorSamples = runs.filter((entry) => !entry.ok && entry.error).slice(0, 3).map((entry) => entry.error)
    const avg = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0
    const min = latencies.length > 0 ? Math.min(...latencies) : 0
    const max = latencies.length > 0 ? Math.max(...latencies) : 0

    return {
        runs: runs.length,
        successCount,
        errorCount: runs.length - successCount,
        successRate: runs.length > 0 ? Number(((successCount / runs.length) * 100).toFixed(2)) : 0,
        statusCounts,
        latencyMs: {
            min: toMs(min),
            max: toMs(max),
            avg: toMs(avg),
            p50: toMs(percentile(latencies, 50)),
            p95: toMs(percentile(latencies, 95)),
            p99: toMs(percentile(latencies, 99)),
        },
        errorSamples,
    }
}

const runBenchmark = async (spec) => {
    const warmup = spec.warmup ?? WARMUP_RUNS
    const runs = spec.runs ?? MEASURE_RUNS

    for (let i = 0; i < warmup; i += 1) {
        await requestJson(spec.path, { token: spec.token || '' })
        await sleep(10)
    }

    const records = []
    for (let i = 0; i < runs; i += 1) {
        const result = await requestJson(spec.path, { token: spec.token || '' })
        records.push(result)
        await sleep(10)
    }

    return {
        name: spec.name,
        path: spec.path,
        auth: Boolean(spec.token),
        summary: summarizeRuns(records),
    }
}

const resolveMapSlug = async () => {
    if (BENCH_MAP_SLUG) return BENCH_MAP_SLUG
    const result = await requestJson('/maps')
    const maps = Array.isArray(result?.data?.maps) ? result.data.maps : []
    const slug = maps.find((entry) => entry?.slug)?.slug
    return String(slug || '').trim()
}

const resolveUserPokemonId = async () => {
    if (BENCH_POKEMON_ID) return BENCH_POKEMON_ID
    if (!BENCH_TOKEN) return ''

    const result = await requestJson('/box?page=1&limit=1', { token: BENCH_TOKEN })
    const rows = Array.isArray(result?.data?.pokemon) ? result.data.pokemon : []
    const id = rows.find((entry) => entry?._id)?._id
    return String(id || '').trim()
}

async function main() {
    const [mapSlug, userPokemonId] = await Promise.all([resolveMapSlug(), resolveUserPokemonId()])

    const specs = [
        { name: 'Server stats', path: '/stats' },
        { name: 'Maps list', path: '/maps' },
        { name: 'Legendary maps', path: '/maps/legendary' },
        { name: 'Pokemon list', path: '/pokemon?page=1&limit=100' },
        ...(mapSlug ? [{ name: 'Map detail', path: `/maps/${encodeURIComponent(mapSlug)}` }] : []),
        ...(userPokemonId ? [{ name: 'Pokemon detail', path: `/pokemon/${encodeURIComponent(userPokemonId)}` }] : []),
        ...(BENCH_TOKEN ? [{ name: 'Shop buy list', path: '/shop/buy?page=1&limit=20', token: BENCH_TOKEN }] : []),
    ]

    if (specs.length === 0) {
        console.log(JSON.stringify({ ok: false, message: 'No benchmark targets found' }, null, 2))
        process.exitCode = 1
        return
    }

    const results = []
    for (const spec of specs) {
        const result = await runBenchmark(spec)
        results.push(result)
    }

    console.log(JSON.stringify({
        ok: true,
        config: {
            apiBase: API_BASE,
            warmupRuns: WARMUP_RUNS,
            measureRuns: MEASURE_RUNS,
            timeoutMs: REQUEST_TIMEOUT_MS,
            hasToken: Boolean(BENCH_TOKEN),
            mapSlug: mapSlug || null,
            userPokemonId: userPokemonId || null,
        },
        results,
    }, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
