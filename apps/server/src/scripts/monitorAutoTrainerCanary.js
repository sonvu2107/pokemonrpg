import dotenv from 'dotenv'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

dotenv.config({ path: '.env' })

const CANARY_PORT = Math.max(1, Number.parseInt(process.env.TRAINER_CANARY_PORT || process.env.CANARY_PORT || '3002', 10) || 3002)
const DURATION_MINUTES = Math.max(1, Number.parseInt(process.env.TRAINER_CANARY_MONITOR_MINUTES || '30', 10) || 30)
const INTERVAL_SECONDS = Math.max(10, Number.parseInt(process.env.TRAINER_CANARY_MONITOR_INTERVAL_SECONDS || '60', 10) || 60)
const LOG_FILE = String(process.env.TRAINER_CANARY_LOG_FILE || 'canary_trainer_server.log').trim() || 'canary_trainer_server.log'

const WORKER_NAME = 'auto-trainer'
const HOT_ROUTE = 'POST /api/game/battle/resolve'
const SAFE_SKIPPED_REASONS = new Set(['LOCK_NOT_ACQUIRED', 'WAIT_INTERVAL'])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pick = (arr, key, value) => (Array.isArray(arr) ? arr.find((entry) => entry?.[key] === value) : null)

const readCanaryPid = () => {
    try {
        return String(
            execSync(
                `powershell.exe -Command "Get-NetTCPConnection -LocalPort ${CANARY_PORT} -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess"`,
                { stdio: ['ignore', 'pipe', 'pipe'] }
            )
        ).trim()
    } catch {
        return ''
    }
}

const readWorkingSetBytes = (pid = '') => {
    if (!pid) return 0
    try {
        const output = String(
            execSync(
                `powershell.exe -Command "(Get-Process -Id ${pid}).WorkingSet64"`,
                { stdio: ['ignore', 'pipe', 'pipe'] }
            )
        ).trim()
        const parsed = Number.parseInt(output, 10)
        return Number.isFinite(parsed) ? parsed : 0
    } catch {
        return 0
    }
}

const buildSnapshot = ({ metrics = {}, pid = '' } = {}) => {
    const worker = pick(metrics.workers, 'worker', WORKER_NAME) || {}
    const hotRoute = pick(metrics.requestLatencyByRoute, 'route', HOT_ROUTE) || {}

    const logSizeBytes = (() => {
        try {
            return fs.statSync(LOG_FILE).size
        } catch {
            return 0
        }
    })()

    return {
        capturedAt: metrics.capturedAt || new Date().toISOString(),
        worker: {
            hasActivityMetrics: Boolean(worker?.activity && typeof worker.activity === 'object'),
            tickCount: Number(worker.tickCount || 0),
            outcomes: worker.outcomes || { success: 0, skipped: 0, error: 0 },
            skippedReasons: worker.skippedReasons || {},
            errorReasons: worker.errorReasons || {},
            durationMs: worker.durationMs || { avg: 0, p95: 0, p99: 0, max: 0 },
            mongoOps: worker.mongoOps || { avgPerTick: 0, total: 0 },
            activity: worker.activity || {
                activeTickCount: 0,
                activeTickRatio: 0,
                fetchedTickCount: 0,
                fetchedTickRatio: 0,
                lockNotAcquiredTickCount: 0,
                lockNotAcquiredTickRatio: 0,
                totalFetchedUsers: 0,
                totalProcessedUsers: 0,
                avgFetchedUsersPerTick: 0,
                avgProcessedUsersPerTick: 0,
            },
        },
        route: {
            resolveHits: Number(hotRoute.requestCount || 0),
            resolveErrors: Number(hotRoute.errorCount || 0),
        },
        process: {
            pid,
            memoryBytes: readWorkingSetBytes(pid),
            logSizeBytes,
        },
    }
}

    const diffSnapshots = (start = {}, end = {}) => {
    const getOutcome = (snapshot, key) => Number(snapshot?.worker?.outcomes?.[key] || 0)
    const getActivity = (snapshot, key) => Number(snapshot?.worker?.activity?.[key] || 0)
    const getSkippedReason = (snapshot, key) => Number(snapshot?.worker?.skippedReasons?.[key] || 0)
    const hasActivityMetrics = Boolean(start?.worker?.hasActivityMetrics && end?.worker?.hasActivityMetrics)

    const delta = {
        ticks: Math.max(0, Number(end?.worker?.tickCount || 0) - Number(start?.worker?.tickCount || 0)),
        success: Math.max(0, getOutcome(end, 'success') - getOutcome(start, 'success')),
        skipped: Math.max(0, getOutcome(end, 'skipped') - getOutcome(start, 'skipped')),
        error: Math.max(0, getOutcome(end, 'error') - getOutcome(start, 'error')),
        activeTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'activeTickCount') - getActivity(start, 'activeTickCount'))
            : null,
        fetchedTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'fetchedTickCount') - getActivity(start, 'fetchedTickCount'))
            : null,
        lockNotAcquiredTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'lockNotAcquiredTickCount') - getActivity(start, 'lockNotAcquiredTickCount'))
            : Math.max(0, getSkippedReason(end, 'LOCK_NOT_ACQUIRED') - getSkippedReason(start, 'LOCK_NOT_ACQUIRED')),
        usersFetched: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'totalFetchedUsers') - getActivity(start, 'totalFetchedUsers'))
            : null,
        usersProcessed: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'totalProcessedUsers') - getActivity(start, 'totalProcessedUsers'))
            : null,
        resolveRouteHits: Math.max(0, Number(end?.route?.resolveHits || 0) - Number(start?.route?.resolveHits || 0)),
        resolveRouteErrors: Math.max(0, Number(end?.route?.resolveErrors || 0) - Number(start?.route?.resolveErrors || 0)),
        memoryGrowthBytes: Number(end?.process?.memoryBytes || 0) - Number(start?.process?.memoryBytes || 0),
        logGrowthBytes: Math.max(0, Number(end?.process?.logSizeBytes || 0) - Number(start?.process?.logSizeBytes || 0)),
    }

    const total = delta.success + delta.skipped + delta.error
    return {
        delta,
        ratios: {
            success: total > 0 ? Number((delta.success / total).toFixed(4)) : 0,
            skipped: total > 0 ? Number((delta.skipped / total).toFixed(4)) : 0,
            error: total > 0 ? Number((delta.error / total).toFixed(4)) : 0,
        },
        throughput: {
            processedPerTick: delta.ticks > 0
                ? Number(((delta.success + delta.skipped + delta.error) / delta.ticks).toFixed(3))
                : 0,
            successPerTick: delta.ticks > 0
                ? Number((delta.success / delta.ticks).toFixed(3))
                : 0,
            fetchedPerTick: delta.ticks > 0 && delta.usersFetched !== null
                ? Number((delta.usersFetched / delta.ticks).toFixed(3))
                : null,
        },
    }
}

const mapDelta = (before = {}, after = {}) => {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    const delta = {}
    for (const key of keys) {
        const value = Number(after?.[key] || 0) - Number(before?.[key] || 0)
        if (value > 0) {
            delta[key] = value
        }
    }
    return delta
}

const collectIdempotencyProbe = async () => {
    const duplicateRewardMarkers = await mongoose.connection.db.collection('userpokemons').aggregate([
        {
            $match: {
                originalTrainer: { $exists: true, $type: 'string', $ne: '' },
            },
        },
        {
            $group: {
                _id: {
                    userId: '$userId',
                    originalTrainer: '$originalTrainer',
                },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gt: 1 },
            },
        },
        {
            $count: 'duplicateGroups',
        },
    ]).toArray()

    const activeCompletedSessions = await mongoose.connection.db.collection('battlesessions').countDocuments({
        expiresAt: { $gt: new Date() },
        $expr: { $gte: ['$currentIndex', { $size: { $ifNull: ['$team', []] } }] },
    })

    return {
        duplicateRewardMarkerGroups: Number(duplicateRewardMarkers?.[0]?.duplicateGroups || 0),
        activeCompletedSessions: Number(activeCompletedSessions || 0),
    }
}

async function main() {
    const mongoUri = String(process.env.MONGO_URI || '').trim()
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    if (!mongoUri || !jwtSecret) {
        throw new Error('Missing MONGO_URI or JWT_SECRET')
    }

    const pid = readCanaryPid()
    if (!pid) {
        throw new Error(`Cannot find process listening on port ${CANARY_PORT}`)
    }

    await mongoose.connect(mongoUri)
    const admin = await mongoose.connection.db
        .collection('users')
        .find({ role: 'admin' })
        .project({ _id: 1 })
        .limit(1)
        .toArray()

    if (!admin[0]) {
        await mongoose.disconnect()
        throw new Error('No admin user found')
    }

    const token = jwt.sign(
        {
            userId: String(admin[0]._id),
            tokenType: 'internal',
        },
        jwtSecret,
        { expiresIn: '2h' }
    )

    const headers = { Authorization: `Bearer ${token}` }
    const totalSamples = Math.max(2, Math.floor((DURATION_MINUTES * 60) / INTERVAL_SECONDS) + 1)
    const snapshots = []

    const idempotencyBefore = await collectIdempotencyProbe()

    for (let index = 0; index < totalSamples; index += 1) {
        const response = await fetch(`http://127.0.0.1:${CANARY_PORT}/api/stats/perf`, { headers })
        const payload = await response.json()
        if (!response.ok || !payload?.ok) {
            await mongoose.disconnect()
            throw new Error(`Failed to fetch /api/stats/perf (status=${response.status})`)
        }

        snapshots.push(buildSnapshot({ metrics: payload.metrics || {}, pid }))

        if (index < totalSamples - 1) {
            await sleep(INTERVAL_SECONDS * 1000)
        }
    }

    const idempotencyAfter = await collectIdempotencyProbe()
    await mongoose.disconnect()

    const start = snapshots[0]
    const end = snapshots[snapshots.length - 1]
    const durationAvgSeries = snapshots
        .map((entry) => Number(entry?.worker?.durationMs?.avg || 0))
        .filter((value) => Number.isFinite(value))

    const summary = diffSnapshots(start, end)
    const lockNotAcquiredRatio = summary.delta.ticks > 0
        ? Number((summary.delta.lockNotAcquiredTicks / summary.delta.ticks).toFixed(4))
        : 0

    const skippedReasonsStart = start?.worker?.skippedReasons || {}
    const skippedReasonsEnd = end?.worker?.skippedReasons || {}
    const skippedReasonsDelta = mapDelta(skippedReasonsStart, skippedReasonsEnd)
    const errorReasonsStart = start?.worker?.errorReasons || {}
    const errorReasonsEnd = end?.worker?.errorReasons || {}
    const errorReasonsDelta = mapDelta(errorReasonsStart, errorReasonsEnd)
    const skippedReasonKeys = Object.keys(skippedReasonsDelta)
    const flaggedSkippedReasons = skippedReasonKeys.filter((key) => {
        const normalized = String(key || '').trim().toUpperCase()
        return !SAFE_SKIPPED_REASONS.has(normalized) && Number(skippedReasonsDelta[key] || 0) > 0
    })
    const newErrorReasons = Object.keys(errorReasonsDelta).filter((key) => Number(errorReasonsDelta[key] || 0) > 0)

    console.log(JSON.stringify({
        ok: true,
        config: {
            canaryPort: CANARY_PORT,
            durationMinutes: DURATION_MINUTES,
            intervalSeconds: INTERVAL_SECONDS,
            totalSamples,
            pid,
            logFile: LOG_FILE,
            worker: WORKER_NAME,
            hotRoute: HOT_ROUTE,
        },
        summary: {
            ...summary,
            durationMs: {
                startAvg: Number(start?.worker?.durationMs?.avg || 0),
                endAvg: Number(end?.worker?.durationMs?.avg || 0),
                minAvg: durationAvgSeries.length > 0 ? Number(Math.min(...durationAvgSeries).toFixed(2)) : 0,
                maxAvg: durationAvgSeries.length > 0 ? Number(Math.max(...durationAvgSeries).toFixed(2)) : 0,
            },
            mongoAvgPerTick: {
                start: Number(start?.worker?.mongoOps?.avgPerTick || 0),
                end: Number(end?.worker?.mongoOps?.avgPerTick || 0),
            },
            lockNotAcquiredPerTotalTicks: {
                count: summary.delta.lockNotAcquiredTicks,
                totalTicks: summary.delta.ticks,
                ratio: lockNotAcquiredRatio,
            },
            users: {
                fetched: summary.delta.usersFetched,
                processed: summary.delta.usersProcessed,
                success: summary.delta.success,
                skipped: summary.delta.skipped,
                error: summary.delta.error,
            },
            activeTicks: {
                count: summary.delta.activeTicks,
                totalTicks: summary.delta.ticks,
                ratio: summary.delta.activeTicks !== null && summary.delta.ticks > 0
                    ? Number((summary.delta.activeTicks / summary.delta.ticks).toFixed(4))
                    : null,
            },
            routeResolveHitsDelta: summary.delta.resolveRouteHits,
            routeResolveErrorsDelta: summary.delta.resolveRouteErrors,
            routeResolveHitsEnd: Number(end?.route?.resolveHits || 0),
            routeResolveErrorsEnd: Number(end?.route?.resolveErrors || 0),
            skippedReasonsDelta,
            skippedReasonsEnd,
            errorReasonsDelta,
            errorReasonsEnd,
            flaggedSkippedReasons,
            newErrorReasons,
            memoryMb: {
                start: Number((Number(start?.process?.memoryBytes || 0) / (1024 * 1024)).toFixed(2)),
                end: Number((Number(end?.process?.memoryBytes || 0) / (1024 * 1024)).toFixed(2)),
                growth: Number((summary.delta.memoryGrowthBytes / (1024 * 1024)).toFixed(2)),
            },
            logMbGrowth: Number((summary.delta.logGrowthBytes / (1024 * 1024)).toFixed(3)),
            idempotencyProbe: {
                before: idempotencyBefore,
                after: idempotencyAfter,
                delta: {
                    duplicateRewardMarkerGroups: Number(idempotencyAfter.duplicateRewardMarkerGroups || 0) - Number(idempotencyBefore.duplicateRewardMarkerGroups || 0),
                    activeCompletedSessions: Number(idempotencyAfter.activeCompletedSessions || 0) - Number(idempotencyBefore.activeCompletedSessions || 0),
                },
            },
        },
        start,
        end,
    }, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exit(1)
})
