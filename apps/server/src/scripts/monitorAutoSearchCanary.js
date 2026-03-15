import dotenv from 'dotenv'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

dotenv.config({ path: '.env' })

const CANARY_PORT = Math.max(1, Number.parseInt(process.env.CANARY_PORT || '3001', 10) || 3001)
const DURATION_MINUTES = Math.max(1, Number.parseInt(process.env.CANARY_MONITOR_MINUTES || '10', 10) || 10)
const INTERVAL_SECONDS = Math.max(10, Number.parseInt(process.env.CANARY_MONITOR_INTERVAL_SECONDS || '60', 10) || 60)
const LOG_FILE = String(process.env.CANARY_LOG_FILE || 'canary_server.log').trim() || 'canary_server.log'

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
    const worker = pick(metrics.workers, 'worker', 'auto-search') || {}
    const routeSearch = pick(metrics.requestLatencyByRoute, 'route', 'POST /api/game/search') || {}
    const routeAttack = pick(metrics.requestLatencyByRoute, 'route', 'POST /api/game/encounter/:id/attack') || {}
    const routeUse = pick(metrics.requestLatencyByRoute, 'route', 'POST /api/inventory/use') || {}

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
        routeHits: {
            search: Number(routeSearch.requestCount || 0),
            attack: Number(routeAttack.requestCount || 0),
            inventoryUse: Number(routeUse.requestCount || 0),
        },
        routeErrors: {
            search: Number(routeSearch.errorCount || 0),
            attack: Number(routeAttack.errorCount || 0),
            inventoryUse: Number(routeUse.errorCount || 0),
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
    const getRoute = (snapshot, key) => Number(snapshot?.routeHits?.[key] || 0)
    const getRouteError = (snapshot, key) => Number(snapshot?.routeErrors?.[key] || 0)
    const getActivity = (snapshot, key) => Number(snapshot?.worker?.activity?.[key] || 0)
    const getSkippedReason = (snapshot, key) => Number(snapshot?.worker?.skippedReasons?.[key] || 0)

    const hasActivityMetrics = Boolean(start?.worker?.hasActivityMetrics && end?.worker?.hasActivityMetrics)
    const fallbackLockNotAcquiredTicks = Math.max(
        0,
        getSkippedReason(end, 'LOCK_NOT_ACQUIRED') - getSkippedReason(start, 'LOCK_NOT_ACQUIRED')
    )
    const delta = {
        ticks: Math.max(0, Number(end?.worker?.tickCount || 0) - Number(start?.worker?.tickCount || 0)),
        success: Math.max(0, getOutcome(end, 'success') - getOutcome(start, 'success')),
        skipped: Math.max(0, getOutcome(end, 'skipped') - getOutcome(start, 'skipped')),
        error: Math.max(0, getOutcome(end, 'error') - getOutcome(start, 'error')),
        routeHits: {
            search: Math.max(0, getRoute(end, 'search') - getRoute(start, 'search')),
            attack: Math.max(0, getRoute(end, 'attack') - getRoute(start, 'attack')),
            inventoryUse: Math.max(0, getRoute(end, 'inventoryUse') - getRoute(start, 'inventoryUse')),
        },
        routeErrors: {
            search: Math.max(0, getRouteError(end, 'search') - getRouteError(start, 'search')),
            attack: Math.max(0, getRouteError(end, 'attack') - getRouteError(start, 'attack')),
            inventoryUse: Math.max(0, getRouteError(end, 'inventoryUse') - getRouteError(start, 'inventoryUse')),
        },
        memoryGrowthBytes: Number(end?.process?.memoryBytes || 0) - Number(start?.process?.memoryBytes || 0),
        logGrowthBytes: Math.max(0, Number(end?.process?.logSizeBytes || 0) - Number(start?.process?.logSizeBytes || 0)),
        activeTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'activeTickCount') - getActivity(start, 'activeTickCount'))
            : null,
        fetchedTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'fetchedTickCount') - getActivity(start, 'fetchedTickCount'))
            : null,
        lockNotAcquiredTicks: hasActivityMetrics
            ? Math.max(0, getActivity(end, 'lockNotAcquiredTickCount') - getActivity(start, 'lockNotAcquiredTickCount'))
            : fallbackLockNotAcquiredTicks,
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
        },
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
    await mongoose.disconnect()

    if (!admin[0]) {
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

    for (let index = 0; index < totalSamples; index += 1) {
        const response = await fetch(`http://127.0.0.1:${CANARY_PORT}/api/stats/perf`, { headers })
        const payload = await response.json()
        if (!response.ok || !payload?.ok) {
            throw new Error(`Failed to fetch /api/stats/perf (status=${response.status})`)
        }

        snapshots.push(buildSnapshot({ metrics: payload.metrics || {}, pid }))

        if (index < totalSamples - 1) {
            await sleep(INTERVAL_SECONDS * 1000)
        }
    }

    const start = snapshots[0]
    const end = snapshots[snapshots.length - 1]
    const durationAvgSeries = snapshots
        .map((entry) => Number(entry?.worker?.durationMs?.avg || 0))
        .filter((value) => Number.isFinite(value))

    const skippedWatchList = ['REQUEST_TIMEOUT', 'ACTION_COOLDOWN', 'MAP_LOCKED', 'NO_BALL_AVAILABLE']
    const endSkippedReasons = end?.worker?.skippedReasons || {}
    const endErrorReasons = end?.worker?.errorReasons || {}

    const summary = diffSnapshots(start, end)
    const lockNotAcquiredRatio = summary.delta.ticks > 0
        ? Number((summary.delta.lockNotAcquiredTicks / summary.delta.ticks).toFixed(4))
        : 0

    console.log(JSON.stringify({
        ok: true,
        config: {
            canaryPort: CANARY_PORT,
            durationMinutes: DURATION_MINUTES,
            intervalSeconds: INTERVAL_SECONDS,
            totalSamples,
            pid,
            logFile: LOG_FILE,
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
            routeHitsEnd: end?.routeHits || {},
            routeErrorsEnd: end?.routeErrors || {},
            activityEnd: end?.worker?.activity || {},
            hasActivityMetrics: Boolean(end?.worker?.hasActivityMetrics),
            lockNotAcquiredPerTotalTicks: {
                count: summary.delta.lockNotAcquiredTicks,
                totalTicks: summary.delta.ticks,
                ratio: lockNotAcquiredRatio,
            },
            activeTicks: {
                count: summary.delta.activeTicks,
                totalTicks: summary.delta.ticks,
                ratio: summary.delta.activeTicks !== null && summary.delta.ticks > 0
                    ? Number((summary.delta.activeTicks / summary.delta.ticks).toFixed(4))
                    : null,
            },
            skippedReasonsEnd: endSkippedReasons,
            errorReasonsEnd: endErrorReasons,
            flaggedSkippedReasons: skippedWatchList.filter((key) => Number(endSkippedReasons[key] || 0) > 0),
            newErrorReasons: Object.keys(endErrorReasons).filter((key) => Number(endErrorReasons[key] || 0) > 0),
            memoryMb: {
                start: Number((Number(start?.process?.memoryBytes || 0) / (1024 * 1024)).toFixed(2)),
                end: Number((Number(end?.process?.memoryBytes || 0) / (1024 * 1024)).toFixed(2)),
                growth: Number((summary.delta.memoryGrowthBytes / (1024 * 1024)).toFixed(2)),
            },
            logMbGrowth: Number((summary.delta.logGrowthBytes / (1024 * 1024)).toFixed(3)),
        },
        start,
        end,
    }, null, 2))
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exit(1)
})
