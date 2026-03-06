const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
import { clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

// Helper to get auth header
const getAuthHeader = () => {
    const token = getValidTokenFromStorage()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const throwApiError = async (res, fallbackMessage) => {
    let err = null
    try {
        err = await res.json()
    } catch (_err) {
        err = null
    }

    const message = err?.message || fallbackMessage
    if (res.status === 401) {
        clearAuthSession(message || 'Phiên đăng nhập không hợp lệ')
    }
    throw new Error(message)
}

export const gameApi = {
    // POST /api/game/search
    async searchMap(mapSlug) {
        const res = await fetch(`${API_URL}/game/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ mapSlug }),
        })
        const data = await res.json()
        if (!res.ok) {
            if (res.status === 403 && data.locked) {
                return data
            }
            const error = new Error(data.message || 'Tìm kiếm bản đồ thất bại')
            error.code = String(data?.code || '')
            error.retryAfterMs = Number(data?.retryAfterMs || 0)
            throw error
        }
        return data
    },

    // GET /api/game/map/:slug/state
    async getMapState(mapSlug) {
        const res = await fetch(`${API_URL}/game/map/${mapSlug}/state`, {
            headers: getAuthHeader(),
        })
        const data = await res.json()
        if (!res.ok) {
            if (res.status === 403 && data.locked) {
                return data
            }
            throw new Error(data.message || 'Lấy trạng thái bản đồ thất bại')
        }
        return data
    },

    // GET /api/game/maps
    async getMaps() {
        const res = await fetch(`${API_URL}/game/maps`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách bản đồ')
        }
        const data = await res.json()
        return data.maps || []
    },

    // POST /api/game/encounter/:id/attack
    async attackEncounter(encounterId) {
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/attack`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tấn công thất bại')
        }
        return res.json()
    },

    // POST /api/game/encounter/:id/catch
    async catchEncounter(encounterId) {
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/catch`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Bắt Pokemon thất bại')
        }
        const data = await res.json()
        if (data?.globalNotification && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('globalNotification:local', {
                detail: data.globalNotification,
            }))
        }
        return data
    },

    // POST /api/game/encounter/:id/run
    async runEncounter(encounterId) {
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/run`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Bỏ chạy thất bại')
        }
        return res.json()
    },

    // GET /api/game/encounter/active
    async getActiveEncounter() {
        const res = await fetch(`${API_URL}/game/encounter/active`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải cuộc chạm trán')
        }
        return res.json()
    },

    // POST /api/game/battle/resolve
    async resolveBattle(_opponentTeam, trainerId = null) {
        const res = await fetch(`${API_URL}/game/battle/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ trainerId }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể nhận kết quả battle')
        }
        return res.json()
    },

    // POST /api/game/battle/attack
    async battleAttack(payload) {
        const res = await fetch(`${API_URL}/game/battle/attack`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tấn công trong battle thất bại')
        }
        return res.json()
    },

    // GET /api/stats - Get server statistics
    async getServerStats() {
        const res = await fetch(`${API_URL}/stats`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải thống kê máy chủ')
        }
        return res.json()
    },

    // GET /api/stats/daily - Get current user daily stats
    async getDailyStats(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()

        const res = await fetch(`${API_URL}/stats/daily${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải thống kê ngày')
        }
        return res.json()
    },

    // GET /api/daily-checkin - Get daily check-in status
    async getDailyCheckInStatus() {
        const res = await fetch(`${API_URL}/daily-checkin`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải thông tin điểm danh')
        }
        return res.json()
    },

    // POST /api/daily-checkin/claim - Claim daily reward
    async claimDailyCheckIn() {
        const res = await fetch(`${API_URL}/daily-checkin/claim`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Điểm danh thất bại')
        }
        return res.json()
    },

    // GET /api/promo-codes/history - Get redeem history
    async getPromoCodeHistory(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/promo-codes/history${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải lịch sử nhập code')
        }
        return res.json()
    },

    // POST /api/promo-codes/redeem - Redeem promo code
    async redeemPromoCode(code) {
        const res = await fetch(`${API_URL}/promo-codes/redeem`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ code }),
        })
        if (!res.ok) {
            await throwApiError(res, 'Nhập code thất bại')
        }
        return res.json()
    },

    // GET /api/stats/online - Get online trainers list
    async getOnlineStats(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()

        const res = await fetch(`${API_URL}/stats/online${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách người chơi online')
        }
        return res.json()
    },

    // GET /api/stats/online/challenge/:userId - Get online trainer challenge target
    async getOnlineChallengeTarget(userId) {
        const normalizedUserId = String(userId || '').trim()
        if (!normalizedUserId) {
            throw new Error('Thiếu userId để khiêu chiến online')
        }

        const res = await fetch(`${API_URL}/stats/online/challenge/${encodeURIComponent(normalizedUserId)}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải đội hình khiêu chiến online')
        }
        return res.json()
    },

    // GET /api/pokemon/:id
    async getPokemonDetail(id) {
        const res = await fetch(`${API_URL}/pokemon/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải chi tiết Pokemon')
        }
        const data = await res.json()
        return data.pokemon
    },

    // POST /api/pokemon/:id/evolve
    async evolvePokemon(id) {
        const res = await fetch(`${API_URL}/pokemon/${id}/evolve`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        const data = await res.json()
        if (!res.ok) {
            throw new Error(data.message || 'Tiến hóa Pokemon thất bại')
        }
        return data
    },

    // GET /api/pokemon/:id/skills
    async getPokemonSkills(id) {
        const res = await fetch(`${API_URL}/pokemon/${id}/skills`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải kho kỹ năng của Pokemon')
        }
        return res.json()
    },

    // POST /api/pokemon/:id/teach-skill
    async teachPokemonSkill(id, payload) {
        const res = await fetch(`${API_URL}/pokemon/${id}/teach-skill`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) {
            await throwApiError(res, 'Dạy kỹ năng thất bại')
        }
        return res.json()
    },

    // POST /api/pokemon/:id/remove-skill
    async removePokemonSkill(id, payload) {
        const res = await fetch(`${API_URL}/pokemon/${id}/remove-skill`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) {
            await throwApiError(res, 'Gỡ kỹ năng thất bại')
        }
        return res.json()
    },

    // GET /api/party
    async getParty() {
        const res = await fetch(`${API_URL}/party`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải đội hình')
        }
        const data = await res.json()
        return data.party
    },

    // GET /api/inventory
    async getInventory() {
        const res = await fetch(`${API_URL}/inventory`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải túi đồ')
        }
        return res.json()
    },

    // GET /api/auth/me
    async getProfile() {
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải hồ sơ')
        }
        return res.json()
    },

    // POST /api/auth/complete-trainer
    async completeTrainer(trainerId) {
        const res = await fetch(`${API_URL}/auth/complete-trainer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ trainerId }),
        })
        const data = await res.json()
        if (!res.ok) {
            throw new Error(data.message || 'Không thể lưu tiến trình huấn luyện viên')
        }
        return data
    },

    // GET /api/box
    async getBox(params = {}) {
        const searchParams = new URLSearchParams(params)
        const res = await fetch(`${API_URL}/box?${searchParams.toString()}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải hộp Pokemon')
        }
        return res.json()
    },

    // GET /api/pokemon
    async getPokemonList(params = {}) {
        const searchParams = new URLSearchParams(params)
        const res = await fetch(`${API_URL}/pokemon?${searchParams.toString()}`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải danh sách Pokemon')
        }
        return res.json()
    },

    // GET /api/pokemon/pokedex
    async getPokedex(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/pokemon/pokedex${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải Pokedex')
        }
        return res.json()
    },

    // GET /api/battle-trainers
    async getBattleTrainers() {
        const res = await fetch(`${API_URL}/battle-trainers`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải danh sách huấn luyện viên battle')
        }
        return res.json()
    },

    // POST /api/inventory/use
    async useItem(itemId, quantity = 1, encounterId = null, activePokemonId = null, moveName = '') {
        const res = await fetch(`${API_URL}/inventory/use`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ itemId, quantity, encounterId, activePokemonId, moveName }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Dùng vật phẩm thất bại')
        }
        const data = await res.json()
        if (data?.globalNotification && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('globalNotification:local', {
                detail: data.globalNotification,
            }))
        }
        return data
    },

    // POST /api/party/swap
    async swapParty(fromIndex, toIndex) {
        const res = await fetch(`${API_URL}/party/swap`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ fromIndex, toIndex }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Đổi vị trí thất bại')
        }
        return res.json()
    },

    // POST /api/party/add
    async addToParty(pokemonId) {
        const res = await fetch(`${API_URL}/party/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ pokemonId }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Thêm vào đội hình thất bại')
        }
        return res.json()
    },

    // POST /api/party/remove
    async removeFromParty(pokemonId) {
        const res = await fetch(`${API_URL}/party/remove`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ pokemonId }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Xóa khỏi đội hình thất bại')
        }
        return res.json()
    },

    // GET /api/rankings/pokemon - Pokemon collection leaderboard by user
    async getPokemonRankings(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/pokemon${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải bảng xếp hạng Pokemon')
        }
        return res.json()
    },

    // GET /api/shop/buy
    async getShopBuyListings(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/buy${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách cửa hàng')
        }
        return res.json()
    },

    // POST /api/shop/buy/:listingId
    async buyPokemon(listingId) {
        const res = await fetch(`${API_URL}/shop/buy/${listingId}`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Mua Pokemon thất bại')
        }
        return res.json()
    },

    // GET /api/shop/items
    async getShopItems(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/items${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải cửa hàng vật phẩm')
        }
        return res.json()
    },

    // GET /api/shop/items/:itemId
    async getItemDetail(itemId) {
        const res = await fetch(`${API_URL}/shop/items/${itemId}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải chi tiết vật phẩm')
        }
        return res.json()
    },

    // POST /api/shop/items/:itemId/buy
    async buyShopItem(itemId, quantity = 1) {
        const res = await fetch(`${API_URL}/shop/items/${itemId}/buy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ quantity }),
        })
        if (!res.ok) {
            await throwApiError(res, 'Mua vật phẩm thất bại')
        }
        return res.json()
    },

    // GET /api/shop/skills
    async getShopSkills(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/skills${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải cửa hàng kỹ năng')
        }
        return res.json()
    },

    // POST /api/shop/skills/:moveId/buy
    async buyShopSkill(moveId, quantity = 1) {
        const res = await fetch(`${API_URL}/shop/skills/${moveId}/buy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ quantity }),
        })
        if (!res.ok) {
            await throwApiError(res, 'Mua kỹ năng thất bại')
        }
        return res.json()
    },

    // GET /api/shop/sell
    async getShopSellData(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/sell${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải dữ liệu bán')
        }
        return res.json()
    },

    // POST /api/shop/sell/list
    async createShopListing(payload) {
        const res = await fetch(`${API_URL}/shop/sell/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            await throwApiError(res, 'Tạo tin đăng thất bại')
        }
        return res.json()
    },

    // POST /api/shop/sell/:listingId/cancel
    async cancelShopListing(listingId) {
        const res = await fetch(`${API_URL}/shop/sell/${listingId}/cancel`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Hủy tin đăng thất bại')
        }
        return res.json()
    },

    // GET /api/rankings/:type - Get rankings
    async getRankings(type = 'overall', page = 1, limit = 35) {
        const res = await fetch(`${API_URL}/rankings/${type}?page=${page}&limit=${limit}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải bảng xếp hạng')
        }
        return res.json()
    },

    // GET /api/rankings/daily - Get daily rankings
    async getDailyRankings(params = {}) {
        const searchParams = new URLSearchParams()
        const normalized = {
            page: params.page ?? 1,
            limit: params.limit ?? 35,
            type: params.type ?? 'search',
            date: params.date,
        }

        Object.entries(normalized).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })

        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/daily${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải bảng xếp hạng ngày')
        }
        return res.json()
    },
}
