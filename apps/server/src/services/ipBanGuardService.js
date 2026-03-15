import IpBan from '../models/IpBan.js'

const CACHE_TTL_MS = Math.max(1000, Number.parseInt(process.env.IP_BAN_CACHE_TTL_MS || '10000', 10) || 10000)
const CACHE_STALE_MS = Math.max(CACHE_TTL_MS, Number.parseInt(process.env.IP_BAN_CACHE_STALE_MS || '60000', 10) || 60000)
const CACHE_MAX_SIZE = Math.max(200, Number.parseInt(process.env.IP_BAN_CACHE_MAX_SIZE || '20000', 10) || 20000)

const ipBanCache = new Map()
const inFlightByIp = new Map()

const toIpKey = (ip = '') => String(ip || '').trim().toLowerCase()

const trimCacheSize = () => {
    while (ipBanCache.size > CACHE_MAX_SIZE) {
        const oldestKey = ipBanCache.keys().next().value
        if (!oldestKey) return
        ipBanCache.delete(oldestKey)
    }
}

const setCacheEntry = (ipKey, payload) => {
    ipBanCache.set(ipKey, payload)
    trimCacheSize()
    return payload
}

const buildCachePayload = (ipBanDoc = null, nowMs = Date.now()) => {
    const expiresAtMs = ipBanDoc?.expiresAt ? new Date(ipBanDoc.expiresAt).getTime() : null
    const hasFiniteExpiry = Number.isFinite(expiresAtMs)
    const isExpired = hasFiniteExpiry && expiresAtMs <= nowMs
    const isBlocked = Boolean(ipBanDoc && ipBanDoc.isActive && !isExpired)

    const freshnessMs = isBlocked && hasFiniteExpiry
        ? Math.max(1000, Math.min(CACHE_TTL_MS, expiresAtMs - nowMs))
        : CACHE_TTL_MS

    return {
        blocked: isBlocked,
        reason: isBlocked ? String(ipBanDoc?.reason || '').trim() : '',
        expiresAt: isBlocked && hasFiniteExpiry ? new Date(expiresAtMs).toISOString() : null,
        updatedAtMs: nowMs,
        freshUntilMs: nowMs + freshnessMs,
        staleUntilMs: nowMs + CACHE_STALE_MS,
    }
}

const queryIpBanFromDb = async (ipKey) => {
    const ipBan = await IpBan.findOne({ ip: ipKey, isActive: true })
        .select('reason expiresAt isActive')
        .lean()

    return buildCachePayload(ipBan, Date.now())
}

const refreshIpBanCache = async (ipKey) => {
    if (inFlightByIp.has(ipKey)) {
        return inFlightByIp.get(ipKey)
    }

    const task = queryIpBanFromDb(ipKey)
        .then((payload) => setCacheEntry(ipKey, payload))
        .finally(() => {
            inFlightByIp.delete(ipKey)
        })

    inFlightByIp.set(ipKey, task)
    return task
}

const revalidateInBackground = (ipKey) => {
    if (!ipKey || inFlightByIp.has(ipKey)) return
    void refreshIpBanCache(ipKey)
}

const hasExpiredCachedBlock = (payload = null, nowMs = Date.now()) => {
    if (!payload?.blocked) return false
    const expiresAtMs = payload?.expiresAt ? new Date(payload.expiresAt).getTime() : Number.NaN
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

const buildUnblockedPayloadFromCache = (payload = null, nowMs = Date.now()) => ({
    ...(payload && typeof payload === 'object' ? payload : {}),
    blocked: false,
    reason: '',
    expiresAt: null,
    updatedAtMs: nowMs,
    freshUntilMs: nowMs + Math.max(1000, Math.min(CACHE_TTL_MS, 5000)),
    staleUntilMs: nowMs + CACHE_STALE_MS,
})

export const checkIpBanWithCache = async (clientIp = '') => {
    const ipKey = toIpKey(clientIp)
    if (!ipKey) {
        return { blocked: false, reason: '', expiresAt: null }
    }

    const nowMs = Date.now()
    const cached = ipBanCache.get(ipKey)

    if (cached && hasExpiredCachedBlock(cached, nowMs)) {
        const normalized = setCacheEntry(ipKey, buildUnblockedPayloadFromCache(cached, nowMs))
        revalidateInBackground(ipKey)
        return normalized
    }

    if (cached && Number(cached.freshUntilMs || 0) > nowMs) {
        return cached
    }

    if (cached && Number(cached.staleUntilMs || 0) > nowMs) {
        revalidateInBackground(ipKey)
        return cached
    }

    return refreshIpBanCache(ipKey)
}

export const cleanupExpiredIpBans = async () => {
    const now = new Date()
    const result = await IpBan.updateMany(
        {
            isActive: true,
            expiresAt: { $ne: null, $lte: now },
        },
        {
            $set: {
                isActive: false,
                liftedAt: now,
                liftedBy: null,
            },
        }
    )

    return {
        matchedCount: Math.max(0, Number(result?.matchedCount || 0)),
        modifiedCount: Math.max(0, Number(result?.modifiedCount || 0)),
    }
}

export const invalidateIpBanCache = (clientIp = '') => {
    const ipKey = toIpKey(clientIp)
    if (!ipKey) return
    ipBanCache.delete(ipKey)
}

export const getIpBanCacheStats = () => ({
    size: ipBanCache.size,
    inFlight: inFlightByIp.size,
    ttlMs: CACHE_TTL_MS,
    staleMs: CACHE_STALE_MS,
})
