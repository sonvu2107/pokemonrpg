import User from '../models/User.js'
import { buildVipResetPayload } from '../utils/vipStatus.js'

const VIP_EXPIRE_SWEEP_INTERVAL_MS = Math.max(30000, Number.parseInt(process.env.VIP_EXPIRE_SWEEP_INTERVAL_MS || '60000', 10) || 60000)

let intervalRef = null
let isRunning = false

const runVipExpireTick = async () => {
    if (isRunning) return
    isRunning = true

    try {
        const now = new Date()
        const result = await User.updateMany(
            {
                role: 'vip',
                vipExpiresAt: { $ne: null, $lte: now },
            },
            {
                $set: buildVipResetPayload(),
            }
        )

        const modifiedCount = Math.max(0, Number(result?.modifiedCount || 0))
        if (modifiedCount > 0) {
            console.log(`[vip-expire-worker] expired VIP users: modified=${modifiedCount}`)
        }
    } catch (error) {
        console.error('[vip-expire-worker] tick failed:', error)
    } finally {
        isRunning = false
    }
}

export const startVipExpireWorker = () => {
    const enabled = String(process.env.VIP_EXPIRE_BACKGROUND_JOB_ENABLED || '').trim().toLowerCase() === 'true'
    if (!enabled) return
    if (intervalRef) return

    intervalRef = setInterval(() => {
        runVipExpireTick()
    }, VIP_EXPIRE_SWEEP_INTERVAL_MS)

    setTimeout(() => {
        runVipExpireTick()
    }, 3000)

    console.log(`[vip-expire-worker] started (interval=${VIP_EXPIRE_SWEEP_INTERVAL_MS}ms)`)
}

export const stopVipExpireWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
