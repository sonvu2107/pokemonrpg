import { AsyncLocalStorage } from 'node:async_hooks'

const MAX_ROUTE_KEYS = Math.max(50, Number.parseInt(process.env.PERF_METRICS_MAX_ROUTES || '400', 10) || 400)
const MAX_WORKER_KEYS = Math.max(2, Number.parseInt(process.env.PERF_METRICS_MAX_WORKERS || '20', 10) || 20)
const MAX_SAMPLES_PER_KEY = Math.max(20, Number.parseInt(process.env.PERF_METRICS_MAX_SAMPLES || '300', 10) || 300)
const isPerfMetricsEnabled = String(
    process.env.PERF_METRICS_ENABLED
    || (process.env.NODE_ENV === 'production' ? 'false' : 'true')
).trim().toLowerCase() === 'true'

const contextStore = new AsyncLocalStorage()

const routeMetrics = new Map()
const workerMetrics = new Map()

const nowIso = () => new Date().toISOString()

const toSafeNumber = (value, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeRouteSegment = (segment = '') => {
    const value = String(segment || '').trim()
    if (!value) return ''

    if (/^[0-9a-f]{24}$/i.test(value)) return ':id'
    if (/^[0-9]+$/.test(value)) return ':num'
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return ':uuid'

    return value
}

export const normalizeRoutePath = (rawPath = '') => {
    const path = String(rawPath || '').split('?')[0]
    const segments = path
        .split('/')
        .filter(Boolean)
        .map((segment) => normalizeRouteSegment(segment))

    return `/${segments.join('/')}`.replace(/\/+$/, '') || '/'
}

const percentile = (samples = [], p = 50) => {
    if (!Array.isArray(samples) || samples.length === 0) return 0
    const sorted = [...samples].sort((left, right) => left - right)
    const target = Math.ceil((Math.max(1, Math.min(99, Number(p) || 50)) / 100) * sorted.length) - 1
    const index = Math.max(0, Math.min(sorted.length - 1, target))
    return sorted[index]
}

const trimMapSize = (mapRef, maxSize) => {
    while (mapRef.size > maxSize) {
        const oldestKey = mapRef.keys().next().value
        if (!oldestKey) return
        mapRef.delete(oldestKey)
    }
}

const getOrCreateRouteMetric = (routeKey) => {
    if (routeMetrics.has(routeKey)) {
        return routeMetrics.get(routeKey)
    }

    const metric = {
        routeKey,
        requestCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        durationSamplesMs: [],
        totalMongoOps: 0,
        statusCounts: {},
        updatedAt: nowIso(),
    }
    routeMetrics.set(routeKey, metric)
    trimMapSize(routeMetrics, MAX_ROUTE_KEYS)
    return metric
}

const getOrCreateWorkerMetric = (workerName) => {
    if (workerMetrics.has(workerName)) {
        return workerMetrics.get(workerName)
    }

    const metric = {
        workerName,
        tickCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        durationSamplesMs: [],
        totalMongoOps: 0,
        successCount: 0,
        skippedCount: 0,
        errorCount: 0,
        activeTickCount: 0,
        fetchedTickCount: 0,
        lockNotAcquiredTickCount: 0,
        totalFetchedUsers: 0,
        totalProcessedUsers: 0,
        skippedReasons: {},
        errorReasons: {},
        updatedAt: nowIso(),
    }
    workerMetrics.set(workerName, metric)
    trimMapSize(workerMetrics, MAX_WORKER_KEYS)
    return metric
}

const pushSample = (samples, value) => {
    samples.push(toSafeNumber(value, 0))
    while (samples.length > MAX_SAMPLES_PER_KEY) {
        samples.shift()
    }
}

export const runWithPerfContext = (context = {}, handler) => {
    if (!isPerfMetricsEnabled || typeof handler !== 'function') {
        return typeof handler === 'function' ? handler() : undefined
    }

    const normalizedContext = context && typeof context === 'object' ? context : {}
    normalizedContext.type = String(normalizedContext.type || '').trim().toLowerCase()
    normalizedContext.routeKey = String(normalizedContext.routeKey || '').trim()
    normalizedContext.workerName = String(normalizedContext.workerName || '').trim()
    normalizedContext.mongoOps = Math.max(0, Number(normalizedContext.mongoOps || 0))

    return contextStore.run(normalizedContext, handler)
}

export const incrementMongoOpCounter = () => {
    if (!isPerfMetricsEnabled) return
    const context = contextStore.getStore()
    if (!context || typeof context !== 'object') return
    context.mongoOps = Math.max(0, Number(context.mongoOps || 0)) + 1
}

export const getPerfContextMongoOps = () => {
    const context = contextStore.getStore()
    return Math.max(0, Number(context?.mongoOps || 0))
}

export const perfRequestContextMiddleware = (req, res, next) => {
    if (!isPerfMetricsEnabled) {
        return next()
    }

    const originalPath = String(req.originalUrl || req.url || '').trim()
    const shouldTrack = originalPath.startsWith('/api/') || originalPath === '/health'
    if (!shouldTrack) {
        return next()
    }

    const routeKey = `${String(req.method || 'GET').toUpperCase()} ${normalizeRoutePath(originalPath)}`
    const startedAtNs = process.hrtime.bigint()
    const context = {
        type: 'http',
        routeKey,
        mongoOps: 0,
    }

    return runWithPerfContext(context, () => {
        res.on('finish', () => {
            const elapsedNs = process.hrtime.bigint() - startedAtNs
            const durationMs = Number(elapsedNs) / 1_000_000
            const statusCode = Math.max(0, Number(res.statusCode) || 0)
            const mongoOps = Math.max(0, Number(context.mongoOps || 0))
            recordHttpRequestMetric({ routeKey, statusCode, durationMs, mongoOps })
        })

        return next()
    })
}

export const recordHttpRequestMetric = ({ routeKey, statusCode, durationMs, mongoOps }) => {
    if (!isPerfMetricsEnabled) return

    const normalizedRoute = String(routeKey || '').trim()
    if (!normalizedRoute) return

    const metric = getOrCreateRouteMetric(normalizedRoute)
    const safeStatusCode = Math.max(0, Number(statusCode) || 0)
    const safeDurationMs = Math.max(0, toSafeNumber(durationMs, 0))
    const safeMongoOps = Math.max(0, Number(mongoOps || 0))

    metric.requestCount += 1
    metric.totalDurationMs += safeDurationMs
    metric.maxDurationMs = Math.max(metric.maxDurationMs, safeDurationMs)
    metric.totalMongoOps += safeMongoOps
    metric.statusCounts[safeStatusCode] = (metric.statusCounts[safeStatusCode] || 0) + 1
    if (safeStatusCode >= 400) {
        metric.errorCount += 1
    }

    pushSample(metric.durationSamplesMs, safeDurationMs)
    metric.updatedAt = nowIso()
}

export const recordWorkerTickMetric = ({ workerName, durationMs, mongoOps, stats = {} }) => {
    if (!isPerfMetricsEnabled) return

    const normalizedWorkerName = String(workerName || '').trim()
    if (!normalizedWorkerName) return

    const metric = getOrCreateWorkerMetric(normalizedWorkerName)
    const safeDurationMs = Math.max(0, toSafeNumber(durationMs, 0))
    const safeMongoOps = Math.max(0, Number(mongoOps || 0))

    metric.tickCount += 1
    metric.totalDurationMs += safeDurationMs
    metric.maxDurationMs = Math.max(metric.maxDurationMs, safeDurationMs)
    metric.totalMongoOps += safeMongoOps
    pushSample(metric.durationSamplesMs, safeDurationMs)

    metric.successCount += Math.max(0, Number(stats?.success || 0))
    metric.skippedCount += Math.max(0, Number(stats?.skipped || 0))
    metric.errorCount += Math.max(0, Number(stats?.errors || 0))

    const fetchedUsers = Math.max(0, Number(stats?.fetched || 0))
    const processedUsers = Math.max(0, Number(stats?.success || 0))
        + Math.max(0, Number(stats?.skipped || 0))
        + Math.max(0, Number(stats?.errors || 0))

    metric.totalFetchedUsers += fetchedUsers
    metric.totalProcessedUsers += processedUsers
    if (fetchedUsers > 0) {
        metric.fetchedTickCount += 1
    }
    if (fetchedUsers > 0 || processedUsers > 0) {
        metric.activeTickCount += 1
    }

    const skippedReasons = stats?.skippedReasons && typeof stats.skippedReasons === 'object'
        ? stats.skippedReasons
        : {}
    const errorReasons = stats?.errorReasons && typeof stats.errorReasons === 'object'
        ? stats.errorReasons
        : {}

    for (const [reason, count] of Object.entries(skippedReasons)) {
        const key = String(reason || '').trim().toUpperCase() || 'UNKNOWN'
        const safeCount = Math.max(0, Number(count || 0))
        metric.skippedReasons[key] = (metric.skippedReasons[key] || 0) + safeCount

        if (key === 'LOCK_NOT_ACQUIRED' && safeCount > 0) {
            metric.lockNotAcquiredTickCount += 1
        }
    }

    for (const [reason, count] of Object.entries(errorReasons)) {
        const key = String(reason || '').trim().toUpperCase() || 'UNKNOWN'
        metric.errorReasons[key] = (metric.errorReasons[key] || 0) + Math.max(0, Number(count || 0))
    }

    metric.updatedAt = nowIso()
}

const toDurationSummary = (samples = [], total = 0, count = 0, max = 0) => ({
    avg: count > 0 ? Number((total / count).toFixed(2)) : 0,
    max: Number(toSafeNumber(max, 0).toFixed(2)),
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    p99: Number(percentile(samples, 99).toFixed(2)),
})

export const getPerfMetricsSnapshot = () => {
    const httpRoutes = Array.from(routeMetrics.values())
        .map((metric) => ({
            route: metric.routeKey,
            requestCount: metric.requestCount,
            errorCount: metric.errorCount,
            statusCounts: metric.statusCounts,
            latencyMs: toDurationSummary(
                metric.durationSamplesMs,
                metric.totalDurationMs,
                metric.requestCount,
                metric.maxDurationMs
            ),
            mongoOps: {
                total: metric.totalMongoOps,
                avg: metric.requestCount > 0
                    ? Number((metric.totalMongoOps / metric.requestCount).toFixed(2))
                    : 0,
            },
            updatedAt: metric.updatedAt,
        }))
        .sort((left, right) => right.requestCount - left.requestCount)

    const workers = Array.from(workerMetrics.values())
        .map((metric) => ({
            worker: metric.workerName,
            tickCount: metric.tickCount,
            outcomes: {
                success: metric.successCount,
                skipped: metric.skippedCount,
                error: metric.errorCount,
            },
            skippedReasons: metric.skippedReasons,
            errorReasons: metric.errorReasons,
            durationMs: toDurationSummary(
                metric.durationSamplesMs,
                metric.totalDurationMs,
                metric.tickCount,
                metric.maxDurationMs
            ),
            mongoOps: {
                total: metric.totalMongoOps,
                avgPerTick: metric.tickCount > 0
                    ? Number((metric.totalMongoOps / metric.tickCount).toFixed(2))
                    : 0,
            },
            activity: {
                activeTickCount: metric.activeTickCount,
                activeTickRatio: metric.tickCount > 0
                    ? Number((metric.activeTickCount / metric.tickCount).toFixed(4))
                    : 0,
                fetchedTickCount: metric.fetchedTickCount,
                fetchedTickRatio: metric.tickCount > 0
                    ? Number((metric.fetchedTickCount / metric.tickCount).toFixed(4))
                    : 0,
                lockNotAcquiredTickCount: metric.lockNotAcquiredTickCount,
                lockNotAcquiredTickRatio: metric.tickCount > 0
                    ? Number((metric.lockNotAcquiredTickCount / metric.tickCount).toFixed(4))
                    : 0,
                totalFetchedUsers: metric.totalFetchedUsers,
                totalProcessedUsers: metric.totalProcessedUsers,
                avgFetchedUsersPerTick: metric.tickCount > 0
                    ? Number((metric.totalFetchedUsers / metric.tickCount).toFixed(2))
                    : 0,
                avgProcessedUsersPerTick: metric.tickCount > 0
                    ? Number((metric.totalProcessedUsers / metric.tickCount).toFixed(2))
                    : 0,
            },
            updatedAt: metric.updatedAt,
        }))
        .sort((left, right) => right.tickCount - left.tickCount)

    return {
        enabled: isPerfMetricsEnabled,
        capturedAt: nowIso(),
        limits: {
            maxRouteKeys: MAX_ROUTE_KEYS,
            maxWorkerKeys: MAX_WORKER_KEYS,
            maxSamplesPerKey: MAX_SAMPLES_PER_KEY,
        },
        requestLatencyByRoute: httpRoutes,
        mongoOpsByRouteAndWorker: {
            routes: httpRoutes.map((entry) => ({
                route: entry.route,
                requestCount: entry.requestCount,
                mongoOps: entry.mongoOps,
            })),
            workers: workers.map((entry) => ({
                worker: entry.worker,
                tickCount: entry.tickCount,
                mongoOps: entry.mongoOps,
            })),
        },
        workerOutcomesByReason: workers.map((entry) => ({
            worker: entry.worker,
            outcomes: entry.outcomes,
            skippedReasons: entry.skippedReasons,
            errorReasons: entry.errorReasons,
        })),
        workers,
    }
}
