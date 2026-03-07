import dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const API_BASE = String(process.env.API_BASE || 'http://localhost:3000/api').replace(/\/$/, '')
const TARGET_PATH_RAW = String(process.env.RATE_LIMIT_TEST_PATH || '/news?limit=1').trim()
const TARGET_PATH = TARGET_PATH_RAW.startsWith('/') ? TARGET_PATH_RAW : `/${TARGET_PATH_RAW}`
const REQUEST_TOTAL = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_TEST_TOTAL || '1020', 10) || 1020)
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_TEST_CONCURRENCY || '25', 10) || 25)
const TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.RATE_LIMIT_TEST_TIMEOUT_MS || '15000', 10) || 15000)
const AUTH_TOKEN = String(process.env.RATE_LIMIT_TEST_TOKEN || '').trim()

const requestOnce = async (requestNumber) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const startedAt = Date.now()

    try {
        const headers = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}
        const response = await fetch(`${API_BASE}${TARGET_PATH}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
        })

        let body = null
        try {
            body = await response.json()
        } catch {
            body = null
        }

        return {
            requestNumber,
            ok: response.ok,
            status: response.status,
            durationMs: Date.now() - startedAt,
            retryAfterHeader: Number(response.headers.get('Retry-After') || 0),
            code: String(body?.code || '').trim(),
            retryAfterSeconds: Number(body?.retryAfterSeconds || 0),
            message: String(body?.message || '').trim(),
            error: '',
        }
    } catch (error) {
        return {
            requestNumber,
            ok: false,
            status: 0,
            durationMs: Date.now() - startedAt,
            retryAfterHeader: 0,
            code: '',
            retryAfterSeconds: 0,
            message: '',
            error: String(error?.message || error),
        }
    } finally {
        clearTimeout(timeoutId)
    }
}

const countByStatus = (records = []) => {
    return records.reduce((acc, entry) => {
        const key = String(entry.status || 0)
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})
}

const runLoad = async () => {
    const records = new Array(REQUEST_TOTAL)
    let cursor = 0

    const worker = async () => {
        while (cursor < REQUEST_TOTAL) {
            const current = cursor
            cursor += 1
            records[current] = await requestOnce(current + 1)
        }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker())
    await Promise.all(workers)
    return records
}

async function main() {
    const startedAt = Date.now()
    const records = await runLoad()
    const statusCounts = countByStatus(records)
    const first429 = records.find((entry) => entry.status === 429) || null
    const globalRateLimitHit = records.find((entry) => entry.code === 'GLOBAL_RATE_LIMIT') || null
    const failedConnections = records.filter((entry) => entry.status === 0).slice(0, 3)

    const summary = {
        ok: true,
        config: {
            apiBase: API_BASE,
            path: TARGET_PATH,
            requests: REQUEST_TOTAL,
            concurrency: CONCURRENCY,
            timeoutMs: TIMEOUT_MS,
            hasAuthToken: Boolean(AUTH_TOKEN),
        },
        durationMs: Date.now() - startedAt,
        statusCounts,
        first429,
        firstGlobalRateLimit: globalRateLimitHit,
        sampleConnectionErrors: failedConnections,
    }

    console.log(JSON.stringify(summary, null, 2))

    if (!first429) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
