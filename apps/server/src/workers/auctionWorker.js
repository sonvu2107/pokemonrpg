import { activateDueAuctions, settleDueAuctions } from '../services/auctionService.js'

const TICK_INTERVAL_MS = 15 * 1000

let intervalRef = null
let running = false

const runTick = async () => {
    if (running) return
    running = true
    const startedAt = Date.now()
    try {
        const activatedCount = await activateDueAuctions(new Date())
        const settleResults = await settleDueAuctions({ source: 'worker', limit: 10, now: new Date() })
        const settledCount = settleResults.filter((entry) => entry?.ok).length
        const failedCount = settleResults.filter((entry) => entry?.status === 'settlement_failed').length

        if (activatedCount > 0 || settledCount > 0 || failedCount > 0) {
            console.log(`[auction-worker] tick done: activated=${activatedCount} settled=${settledCount} failed=${failedCount} durationMs=${Date.now() - startedAt}`)
        }
    } catch (error) {
        console.error('[auction-worker] tick error:', error)
    } finally {
        running = false
    }
}

export const startAuctionWorker = () => {
    if (intervalRef) return
    intervalRef = setInterval(() => {
        runTick()
    }, TICK_INTERVAL_MS)
    setTimeout(() => {
        runTick()
    }, 1500)
    console.log(`[auction-worker] started (tick=${TICK_INTERVAL_MS}ms)`)
}

export const stopAuctionWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
