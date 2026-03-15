import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const BASE_URL = String(process.env.LOAD_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const LOAD_TOKEN = String(process.env.LOAD_TOKEN || process.env.BENCH_TOKEN || '').trim()
const LOAD_MAP_SLUG = String(process.env.LOAD_MAP_SLUG || process.env.BENCH_MAP_SLUG || '').trim()
const LOAD_DURATION_SECONDS = Math.max(5, Number.parseInt(process.env.LOAD_DURATION_SECONDS || '60', 10) || 60)
const LOAD_CONCURRENCY = Math.max(1, Number.parseInt(process.env.LOAD_CONCURRENCY || '12', 10) || 12)
const LOAD_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.LOAD_TIMEOUT_MS || '10000', 10) || 10000)
const LOAD_SEED = Math.max(1, Number.parseInt(process.env.LOAD_SEED || '1337', 10) || 1337)

const percentile = (values, p) => {
    const normalized = Array.isArray(values) ? values : []
    if (normalized.length === 0) return 0
    const sorted = [...normalized].sort((left, right) => left - right)
    const rawIndex = Math.ceil((Math.max(1, Math.min(99, Number(p) || 50)) / 100) * sorted.length) - 1
    const index = Math.max(0, Math.min(sorted.length - 1, rawIndex))
    return sorted[index]
}

const createPrng = (seed) => {
    let state = Number(seed) || 1
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const requestJson = async ({ method = 'GET', path = '/', headers = {}, body = null }) => {
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeoutRef = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)

    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        })

        const text = await response.text()
        let payload = null
        try {
            payload = text ? JSON.parse(text) : null
        } catch {
            payload = null
        }

        return {
            ok: response.ok,
            status: response.status,
            latencyMs: performance.now() - startedAt,
            error: response.ok ? '' : String(payload?.message || payload?.code || `HTTP ${response.status}`).trim(),
        }
    } catch (error) {
        return {
            ok: false,
            status: 0,
            latencyMs: performance.now() - startedAt,
            error: String(error?.message || error),
        }
    } finally {
        clearTimeout(timeoutRef)
    }
}

const toSummary = (records = []) => {
    const latencies = records
        .map((entry) => Number(entry?.latencyMs || 0))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)

    const count = records.length
    const successCount = records.filter((entry) => entry?.ok).length
    const totalLatency = latencies.reduce((sum, entry) => sum + entry, 0)
    const statusCounts = records.reduce((acc, entry) => {
        const key = String(entry?.status || 0)
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

    return {
        requestCount: count,
        successCount,
        errorCount: count - successCount,
        successRate: count > 0 ? Number(((successCount / count) * 100).toFixed(2)) : 0,
        statusCounts,
        latencyMs: {
            avg: count > 0 ? Number((totalLatency / count).toFixed(2)) : 0,
            p50: Number(percentile(latencies, 50).toFixed(2)),
            p95: Number(percentile(latencies, 95).toFixed(2)),
            p99: Number(percentile(latencies, 99).toFixed(2)),
            max: Number((latencies.length > 0 ? Math.max(...latencies) : 0).toFixed(2)),
        },
        errorSamples: records
            .filter((entry) => !entry?.ok && entry?.error)
            .slice(0, 3)
            .map((entry) => entry.error),
    }
}

const buildProfile = () => {
    const commonAuthHeaders = LOAD_TOKEN
        ? { Authorization: `Bearer ${LOAD_TOKEN}` }
        : {}

    const profile = [
        {
            key: 'GET /api/stats',
            weight: 4,
            request: {
                method: 'GET',
                path: '/api/stats',
            },
        },
        {
            key: 'GET /api/maps',
            weight: 3,
            request: {
                method: 'GET',
                path: '/api/maps',
            },
        },
        {
            key: 'GET /api/news?limit=20&type=news',
            weight: 2,
            request: {
                method: 'GET',
                path: '/api/news?limit=20&type=news',
            },
        },
    ]

    if (LOAD_TOKEN) {
        profile.push({
            key: 'GET /api/box?page=1&limit=20',
            weight: 2,
            request: {
                method: 'GET',
                path: '/api/box?page=1&limit=20',
                headers: commonAuthHeaders,
            },
        })
    }

    if (LOAD_TOKEN && LOAD_MAP_SLUG) {
        profile.push({
            key: 'POST /api/game/search',
            weight: 1,
            request: {
                method: 'POST',
                path: '/api/game/search',
                headers: {
                    ...commonAuthHeaders,
                    'Content-Type': 'application/json',
                },
                body: { mapSlug: LOAD_MAP_SLUG },
            },
        })
    }

    return profile
}

const pickWeighted = (items, rand) => {
    const total = items.reduce((sum, entry) => sum + Math.max(1, Number(entry?.weight || 1)), 0)
    if (total <= 0) return items[0]

    let cursor = rand() * total
    for (const item of items) {
        cursor -= Math.max(1, Number(item?.weight || 1))
        if (cursor <= 0) return item
    }
    return items[items.length - 1]
}

async function main() {
    const profile = buildProfile()
    if (profile.length === 0) {
        console.log(JSON.stringify({ ok: false, message: 'No profile targets configured' }, null, 2))
        process.exitCode = 1
        return
    }

    const rand = createPrng(LOAD_SEED)
    const deadlineAt = Date.now() + (LOAD_DURATION_SECONDS * 1000)
    const recordsByKey = new Map(profile.map((entry) => [entry.key, []]))

    const workers = Array.from({ length: LOAD_CONCURRENCY }, async () => {
        while (Date.now() < deadlineAt) {
            const selected = pickWeighted(profile, rand)
            const result = await requestJson(selected.request)
            recordsByKey.get(selected.key)?.push(result)
        }
    })

    await Promise.all(workers)

    const results = profile.map((entry) => ({
        key: entry.key,
        weight: entry.weight,
        summary: toSummary(recordsByKey.get(entry.key) || []),
    }))

    const allRecords = Array.from(recordsByKey.values()).flat()

    console.log(JSON.stringify({
        ok: true,
        config: {
            baseUrl: BASE_URL,
            durationSeconds: LOAD_DURATION_SECONDS,
            concurrency: LOAD_CONCURRENCY,
            timeoutMs: LOAD_TIMEOUT_MS,
            seed: LOAD_SEED,
            hasToken: Boolean(LOAD_TOKEN),
            mapSlug: LOAD_MAP_SLUG || null,
        },
        profile: profile.map((entry) => ({ key: entry.key, weight: entry.weight })),
        overall: toSummary(allRecords),
        results,
    }, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
