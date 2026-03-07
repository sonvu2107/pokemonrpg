const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
import { clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const getAuthHeader = () => {
    const token = getValidTokenFromStorage()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const throwApiError = async (res, fallbackMessage) => {
    let payload = null
    try {
        payload = await res.json()
    } catch (_error) {
        payload = null
    }
    const message = payload?.message || fallbackMessage
    if (res.status === 401) {
        clearAuthSession(message || 'Phiên đăng nhập không hợp lệ')
    }
    throw new Error(message)
}

const valleyApi = {
    /** GET /api/valley — browse available Pokémon in the Valley */
    async listAvailable({ page = 1, limit = 20, rarity, search } = {}) {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) })
        if (rarity) params.set('rarity', rarity)
        if (search) params.set('search', search)
        const res = await fetch(`${API_URL}/valley?${params}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải Thung Lũng Pokémon')
        return res.json()
    },

    /** GET /api/valley/my-box — user's box Pokémon (for Release tab) */
    async getMyBox({ page = 1, limit = 20, search } = {}) {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) })
        if (search) params.set('search', search)
        const res = await fetch(`${API_URL}/valley/my-box?${params}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải kho Pokémon')
        return res.json()
    },

    /** GET /api/valley/my-releases — Pokémon the user has released (history) */
    async getMyReleases({ page = 1, limit = 20 } = {}) {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) })
        const res = await fetch(`${API_URL}/valley/my-releases?${params}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải lịch sử thả Pokémon')
        return res.json()
    },

    /** GET /api/valley/:id/chance?ballItemId=... — preview catch-chance label */
    async getChanceLabel(valleyPokemonId, ballItemId) {
        const params = new URLSearchParams({ ballItemId })
        const res = await fetch(`${API_URL}/valley/${encodeURIComponent(valleyPokemonId)}/chance?${params}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể kiểm tra tỉ lệ bắt')
        return res.json() // { ok: true, label: 'Thấp'|'Trung bình'|'Cao'|'Rất cao' }
    },

    /** POST /api/valley/release — release a Pokémon from box into Valley */
    async release(userPokemonId) {
        const res = await fetch(`${API_URL}/valley/release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ userPokemonId }),
        })
        if (!res.ok) await throwApiError(res, 'Không thể thả Pokémon vào Thung Lũng')
        return res.json()
    },

    /** POST /api/valley/:id/catch — attempt to catch a Valley Pokémon */
    async catchPokemon(valleyPokemonId, ballItemId) {
        const res = await fetch(`${API_URL}/valley/${encodeURIComponent(valleyPokemonId)}/catch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ ballItemId }),
        })
        if (!res.ok) await throwApiError(res, 'Không thể bắt Pokémon')
        return res.json()
    },
}

export { valleyApi }
