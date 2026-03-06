const ACTION_GUARD_STATE_TTL_MS = 30 * 60 * 1000
const ACTION_GUARD_CLEANUP_INTERVAL = 500

const actionGuardState = new Map()
let actionGuardRequestCount = 0

const toPositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback
    }
    return parsed
}

const cleanupActionGuardState = (nowMs = Date.now()) => {
    for (const [key, value] of actionGuardState.entries()) {
        const updatedAt = Number(value?.updatedAt || 0)
        if ((nowMs - updatedAt) > ACTION_GUARD_STATE_TTL_MS) {
            actionGuardState.delete(key)
        }
    }
}

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim()
    }
    return req.ip || req.socket?.remoteAddress || ''
}

export const createActionGuard = (options = {}) => {
    const actionKey = String(options.actionKey || 'action')
        .trim()
        .toLowerCase() || 'action'
    const cooldownMs = toPositiveInt(options.cooldownMs, 600)
    const suspiciousViolationThreshold = toPositiveInt(options.suspiciousViolationThreshold, 3)
    const message = String(options.message || 'Thao tác quá nhanh. Vui lòng thử lại sau vài giây.')
        .trim() || 'Thao tác quá nhanh. Vui lòng thử lại sau vài giây.'

    return (req, res, next) => {
        const userId = String(req.user?.userId || '').trim()
        if (!userId) {
            return next()
        }

        actionGuardRequestCount += 1
        const nowMs = Date.now()

        if (actionGuardRequestCount % ACTION_GUARD_CLEANUP_INTERVAL === 0) {
            cleanupActionGuardState(nowMs)
        }

        const stateKey = `${actionKey}:${userId}`
        const currentState = actionGuardState.get(stateKey)
        const state = (!currentState || (nowMs - Number(currentState.updatedAt || 0)) > ACTION_GUARD_STATE_TTL_MS)
            ? {
                lastAllowedAt: 0,
                lastAttemptAt: 0,
                violationCount: 0,
                blockedCount: 0,
                updatedAt: nowMs,
            }
            : currentState

        const elapsedMs = state.lastAllowedAt > 0
            ? nowMs - state.lastAllowedAt
            : Number.POSITIVE_INFINITY
        const isBlocked = elapsedMs < cooldownMs
        const nextViolationCount = isBlocked
            ? state.violationCount + 1
            : Math.max(0, state.violationCount - 1)
        const nextState = {
            ...state,
            lastAllowedAt: isBlocked ? state.lastAllowedAt : nowMs,
            lastAttemptAt: nowMs,
            violationCount: nextViolationCount,
            blockedCount: isBlocked ? (state.blockedCount + 1) : state.blockedCount,
            updatedAt: nowMs,
        }

        actionGuardState.set(stateKey, nextState)

        if (!isBlocked) {
            return next()
        }

        const retryAfterMs = Math.max(1, cooldownMs - Math.max(0, elapsedMs))
        const isSuspicious = nextViolationCount >= suspiciousViolationThreshold
        req.actionGuardMeta = {
            action: actionKey,
            blocked: true,
            suspicious: isSuspicious,
            retryAfterMs,
            elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
            cooldownMs,
            violationCount: nextViolationCount,
            blockedCount: nextState.blockedCount,
        }

        if (isSuspicious) {
            console.warn('[ActionGuard] Suspicious action burst', {
                action: actionKey,
                userId,
                ip: getClientIp(req),
                violationCount: nextViolationCount,
                blockedCount: nextState.blockedCount,
                cooldownMs,
            })
        }

        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
        return res.status(429).json({
            ok: false,
            code: 'ACTION_COOLDOWN',
            action: actionKey,
            retryAfterMs,
            message,
        })
    }
}
