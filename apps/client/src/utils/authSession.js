export const AUTH_EXPIRED_EVENT = 'auth:expired'

let lastAuthExpiredDispatchAt = 0

const decodeJwtPayload = (token) => {
    try {
        const payload = token.split('.')[1]
        if (!payload) return null
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
        const decoded = atob(padded)
        return JSON.parse(decoded)
    } catch {
        return null
    }
}

export const isTokenExpired = (token, skewSeconds = 10) => {
    const payload = decodeJwtPayload(token)
    const exp = Number(payload?.exp)
    if (!Number.isFinite(exp)) return false
    const nowInSeconds = Math.floor(Date.now() / 1000)
    return exp <= (nowInSeconds + skewSeconds)
}

export const clearAuthSession = (reason = 'Phiên đăng nhập đã hết hạn') => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')

    const now = Date.now()
    if (now - lastAuthExpiredDispatchAt > 300) {
        lastAuthExpiredDispatchAt = now
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, {
            detail: { reason },
        }))
    }
}

export const getValidTokenFromStorage = () => {
    const token = localStorage.getItem('token')
    if (!token) return null

    if (isTokenExpired(token)) {
        clearAuthSession('Token expired')
        return null
    }

    return token
}
