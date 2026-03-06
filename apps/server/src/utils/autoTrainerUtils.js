export const AUTO_TRAINER_GAME_TIMEZONE = String(process.env.GAME_TIMEZONE || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh'
export const AUTO_SEARCH_RARITY_KEYS = ['sss', 'ss', 's', 'a', 'b', 'c', 'd']
export const AUTO_SEARCH_DEFAULT_ACTION_BY_RARITY = {
    sss: 'catch',
    ss: 'catch',
    s: 'catch',
    a: 'battle',
    b: 'battle',
    c: 'battle',
    d: 'battle',
}

export const toSafeInt = (value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const parsed = Number.parseInt(value, 10)
    const normalized = Number.isFinite(parsed) ? parsed : Number.parseInt(fallback, 10)
    const safe = Number.isFinite(normalized) ? normalized : 0
    return Math.max(min, Math.min(max, safe))
}

export const normalizeId = (value = '') => String(value || '').trim()

export const normalizeSearchText = (value = '') => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export const getGameDayKey = (date = new Date(), timezone = AUTO_TRAINER_GAME_TIMEZONE) => {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(date)
    } catch {
        const year = date.getUTCFullYear()
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const day = String(date.getUTCDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }
}

export const hasVipAutoTrainerAccess = (userLike = {}) => {
    const role = String(userLike?.role || '').trim().toLowerCase()
    const vipTierLevel = toSafeInt(userLike?.vipTierLevel, 0)
    const vipEnabled = userLike?.vipBenefits?.autoBattleTrainerEnabled !== false

    const roleEligible = role === 'vip' || role === 'admin'
    return vipEnabled && (roleEligible || vipTierLevel > 0)
}

export const hasVipAutoSearchAccess = (userLike = {}) => {
    const role = String(userLike?.role || '').trim().toLowerCase()
    const vipTierLevel = toSafeInt(userLike?.vipTierLevel, 0)
    const vipEnabled = userLike?.vipBenefits?.autoSearchEnabled !== false

    const roleEligible = role === 'vip' || role === 'admin'
    return vipEnabled && (roleEligible || vipTierLevel > 0)
}

const normalizeAutoSearchAction = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'catch' || normalized === 'run') return normalized
    return 'battle'
}

export const normalizeAutoSearchActionByRarity = (actionByRarityLike = {}) => {
    const source = actionByRarityLike && typeof actionByRarityLike === 'object'
        ? actionByRarityLike
        : {}

    return AUTO_SEARCH_RARITY_KEYS.reduce((acc, rarityKey) => {
        acc[rarityKey] = normalizeAutoSearchAction(source?.[rarityKey] || AUTO_SEARCH_DEFAULT_ACTION_BY_RARITY[rarityKey])
        return acc
    }, {})
}

export const normalizeAutoCatchFormMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'normal' || normalized === 'variant') return normalized
    return 'all'
}

export const normalizeRarityToken = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    return AUTO_SEARCH_RARITY_KEYS.includes(normalized) ? normalized : 'd'
}

export const normalizeFormId = (value = '') => String(value || '').trim().toLowerCase() || 'normal'

export const isFormAllowedForCatch = (formId = 'normal', mode = 'all') => {
    const normalizedFormId = normalizeFormId(formId)
    const normalizedMode = normalizeAutoCatchFormMode(mode)
    if (normalizedMode === 'all') return true
    if (normalizedMode === 'normal') return normalizedFormId === 'normal'
    if (normalizedMode === 'variant') return normalizedFormId !== 'normal'
    return true
}

const EVENT_MAP_PATTERN = /(^|[\s_-])(event|su-kien|sukien)($|[\s_-])/i
export const isEventMapLike = (mapLike = null) => {
    if (!mapLike || typeof mapLike !== 'object') return false
    if (Boolean(mapLike.isEventMap)) return true
    const slug = String(mapLike.slug || '').trim().toLowerCase()
    const name = String(mapLike.name || '').trim().toLowerCase()
    return EVENT_MAP_PATTERN.test(slug) || EVENT_MAP_PATTERN.test(name)
}

export const resolveDailyState = (stateLike = {}, dailyLimit = 0, now = new Date()) => {
    const dayKey = getGameDayKey(now)
    const limit = toSafeInt(dailyLimit, 0)
    const storedDayKey = String(stateLike?.dayKey || '').trim()
    const usedCount = toSafeInt(stateLike?.dayCount, 0)
    const count = storedDayKey === dayKey ? usedCount : 0
    const remaining = limit > 0 ? Math.max(0, limit - count) : Infinity

    return {
        dayKey,
        limit,
        count,
        remaining,
    }
}

export const normalizeAutoTrainerState = (stateLike = {}) => {
    const logs = Array.isArray(stateLike?.logs) ? stateLike.logs : []
    return {
        enabled: Boolean(stateLike?.enabled),
        trainerId: normalizeId(stateLike?.trainerId),
        attackIntervalMs: Math.max(450, toSafeInt(stateLike?.attackIntervalMs, 700)),
        startedAt: stateLike?.startedAt ? new Date(stateLike.startedAt) : null,
        dayKey: String(stateLike?.dayKey || '').trim(),
        dayCount: toSafeInt(stateLike?.dayCount, 0),
        dayLimit: toSafeInt(stateLike?.dayLimit, 0),
        lastAction: stateLike?.lastAction && typeof stateLike.lastAction === 'object'
            ? {
                action: String(stateLike.lastAction.action || '').trim(),
                result: String(stateLike.lastAction.result || '').trim(),
                reason: String(stateLike.lastAction.reason || '').trim(),
                targetId: normalizeId(stateLike.lastAction.targetId),
                at: stateLike.lastAction.at ? new Date(stateLike.lastAction.at) : null,
            }
            : null,
        logs: logs
            .map((entry, index) => ({
                _id: entry?._id || `auto-log-${index}`,
                message: String(entry?.message || '').trim(),
                type: String(entry?.type || 'info').trim() || 'info',
                at: entry?.at ? new Date(entry.at) : null,
            }))
            .filter((entry) => entry.message),
    }
}

export const normalizeAutoSearchState = (stateLike = {}) => {
    const logs = Array.isArray(stateLike?.logs) ? stateLike.logs : []
    return {
        enabled: Boolean(stateLike?.enabled),
        mapSlug: String(stateLike?.mapSlug || '').trim().toLowerCase(),
        searchIntervalMs: Math.max(900, toSafeInt(stateLike?.searchIntervalMs, 1200)),
        actionByRarity: normalizeAutoSearchActionByRarity(stateLike?.actionByRarity),
        catchFormMode: normalizeAutoCatchFormMode(stateLike?.catchFormMode),
        catchBallItemId: normalizeId(stateLike?.catchBallItemId),
        startedAt: stateLike?.startedAt ? new Date(stateLike.startedAt) : null,
        dayKey: String(stateLike?.dayKey || '').trim(),
        dayCount: toSafeInt(stateLike?.dayCount, 0),
        dayLimit: toSafeInt(stateLike?.dayLimit, 0),
        lastAction: stateLike?.lastAction && typeof stateLike.lastAction === 'object'
            ? {
                action: String(stateLike.lastAction.action || '').trim(),
                result: String(stateLike.lastAction.result || '').trim(),
                reason: String(stateLike.lastAction.reason || '').trim(),
                targetId: normalizeId(stateLike.lastAction.targetId),
                at: stateLike.lastAction.at ? new Date(stateLike.lastAction.at) : null,
            }
            : null,
        logs: logs
            .map((entry, index) => ({
                _id: entry?._id || `auto-map-log-${index}`,
                message: String(entry?.message || '').trim(),
                type: String(entry?.type || 'info').trim() || 'info',
                at: entry?.at ? new Date(entry.at) : null,
            }))
            .filter((entry) => entry.message),
    }
}
