const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_URL.replace(/\/api\/?$/, '')
const BACKEND_ORIGIN = String(SOCKET_URL || '').replace(/\/+$/, '')

const hasAbsoluteProtocol = (value = '') => /^(https?:)?\/\//i.test(value)

export const resolveAvatarUrl = (value = '', fallback = '') => {
    const raw = String(value || '').trim()
    const normalizedFallback = String(fallback || '').trim()
    const safeFallback = normalizedFallback || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/132.png'

    if (!raw) return safeFallback
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw
    if (hasAbsoluteProtocol(raw)) {
        if (raw.startsWith('//')) return `https:${raw}`
        return raw
    }
    if (raw.startsWith('/assets/')) return raw
    if (raw.startsWith('assets/')) return `/${raw}`
    if (!BACKEND_ORIGIN) return raw
    if (raw.startsWith('/')) return `${BACKEND_ORIGIN}${raw}`
    return `${BACKEND_ORIGIN}/${raw.replace(/^\/+/, '')}`
}
