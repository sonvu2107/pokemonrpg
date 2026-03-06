const STORAGE_KEY = 'vip_auto_usage_limits_v1'

const getTodayKey = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const readStorage = () => {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

const writeStorage = (data) => {
    if (typeof window === 'undefined') return
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data || {}))
    } catch {
        // Ignore storage errors silently
    }
}

const toSafeInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Number.parseInt(fallback, 10) || 0)
    return parsed
}

export const getVipAutoLimitConfig = (userLike, feature) => {
    const benefits = userLike?.vipBenefits || {}
    if (feature === 'map-search') {
        return {
            durationMinutes: toSafeInt(benefits.autoSearchDurationMinutes, 0),
            usesPerDay: toSafeInt(benefits.autoSearchUsesPerDay, 0),
        }
    }

    return {
        durationMinutes: toSafeInt(benefits.autoBattleTrainerDurationMinutes, 0),
        usesPerDay: toSafeInt(benefits.autoBattleTrainerUsesPerDay, 0),
    }
}

export const getVipAutoUsageToday = (userId, feature) => {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId) {
        return { used: 0, dateKey: getTodayKey() }
    }

    const store = readStorage()
    const today = getTodayKey()
    const userStore = store?.[normalizedUserId] && typeof store[normalizedUserId] === 'object'
        ? store[normalizedUserId]
        : {}
    const featureStore = userStore?.[feature] && typeof userStore[feature] === 'object'
        ? userStore[feature]
        : {}

    if (String(featureStore.dateKey || '') !== today) {
        return { used: 0, dateKey: today }
    }

    return {
        used: toSafeInt(featureStore.used, 0),
        dateKey: today,
    }
}

export const consumeVipAutoUse = (userId, feature, usesPerDayLimit) => {
    const limit = toSafeInt(usesPerDayLimit, 0)
    const normalizedUserId = String(userId || '').trim()

    if (!normalizedUserId) {
        return {
            ok: limit <= 0,
            used: 0,
            limit,
            remaining: limit <= 0 ? Infinity : 0,
        }
    }

    const current = getVipAutoUsageToday(normalizedUserId, feature)
    if (limit > 0 && current.used >= limit) {
        return {
            ok: false,
            used: current.used,
            limit,
            remaining: 0,
        }
    }

    const nextUsed = current.used + 1
    const today = current.dateKey
    const store = readStorage()
    const userStore = store?.[normalizedUserId] && typeof store[normalizedUserId] === 'object'
        ? store[normalizedUserId]
        : {}

    store[normalizedUserId] = {
        ...userStore,
        [feature]: {
            used: nextUsed,
            dateKey: today,
        },
    }
    writeStorage(store)

    return {
        ok: true,
        used: nextUsed,
        limit,
        remaining: limit > 0 ? Math.max(0, limit - nextUsed) : Infinity,
    }
}
