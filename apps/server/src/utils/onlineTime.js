const toMillis = (value) => {
    const date = value instanceof Date ? value : new Date(value)
    const ms = date.getTime()
    return Number.isFinite(ms) ? ms : null
}

const resolveSessionStartMs = (userLike) => {
    const sessionStartMs = toMillis(userLike?.onlineSessionStartedAt)
    if (sessionStartMs !== null) return sessionStartMs

    const lastActiveMs = toMillis(userLike?.lastActive)
    if (lastActiveMs !== null) return lastActiveMs

    return null
}

const getCurrentSessionElapsedSeconds = (userLike, nowDate = new Date()) => {
    if (!userLike?.isOnline) return 0

    const startMs = resolveSessionStartMs(userLike)
    if (startMs === null) return 0

    const nowMs = toMillis(nowDate)
    if (nowMs === null || nowMs <= startMs) return 0

    return Math.max(0, Math.floor((nowMs - startMs) / 1000))
}

export const getTotalOnlineSeconds = (userLike, nowDate = new Date()) => {
    const storedSeconds = Math.max(0, Math.floor(Number(userLike?.totalOnlineSeconds) || 0))
    return storedSeconds + getCurrentSessionElapsedSeconds(userLike, nowDate)
}

export const getTotalOnlineHours = (userLike, nowDate = new Date()) => Math.floor(getTotalOnlineSeconds(userLike, nowDate) / 3600)

export const closeOnlineSession = (userDoc, nowDate = new Date()) => {
    const now = nowDate instanceof Date ? nowDate : new Date(nowDate)
    const totalSeconds = getTotalOnlineSeconds(userDoc, now)

    userDoc.totalOnlineSeconds = totalSeconds
    userDoc.isOnline = false
    userDoc.onlineSessionStartedAt = null
    userDoc.lastActive = now

    return totalSeconds
}

export const startOnlineSession = (userDoc, nowDate = new Date()) => {
    const now = nowDate instanceof Date ? nowDate : new Date(nowDate)
    const totalSeconds = getTotalOnlineSeconds(userDoc, now)

    userDoc.totalOnlineSeconds = totalSeconds
    userDoc.isOnline = true
    userDoc.onlineSessionStartedAt = now
    userDoc.lastActive = now

    return totalSeconds
}
