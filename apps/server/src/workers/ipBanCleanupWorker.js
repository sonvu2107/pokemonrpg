import { cleanupExpiredIpBans } from '../services/ipBanGuardService.js'

const CLEANUP_INTERVAL_MS = Math.max(30000, Number.parseInt(process.env.IP_BAN_CLEANUP_INTERVAL_MS || '60000', 10) || 60000)

let intervalRef = null
let isRunning = false

const runCleanupTick = async () => {
    if (isRunning) return
    isRunning = true

    try {
        const result = await cleanupExpiredIpBans()
        if (result.modifiedCount > 0) {
            console.log(`[ip-ban-cleanup-worker] deactivated expired bans: matched=${result.matchedCount} modified=${result.modifiedCount}`)
        }
    } catch (error) {
        console.error('[ip-ban-cleanup-worker] tick failed:', error)
    } finally {
        isRunning = false
    }
}

export const startIpBanCleanupWorker = () => {
    const enabled = String(process.env.IP_BAN_CACHE_ENABLED || '').trim().toLowerCase() === 'true'
    if (!enabled) return
    if (intervalRef) return

    intervalRef = setInterval(() => {
        runCleanupTick()
    }, CLEANUP_INTERVAL_MS)

    setTimeout(() => {
        runCleanupTick()
    }, 2000)

    console.log(`[ip-ban-cleanup-worker] started (interval=${CLEANUP_INTERVAL_MS}ms)`)
}

export const stopIpBanCleanupWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
