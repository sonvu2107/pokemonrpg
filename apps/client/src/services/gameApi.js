const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
import { clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const TAB_ID_STORAGE_KEY = 'vnpet:tab-id'
const PLAY_TAB_LOCK_PREFIX = 'vnpet:play-tab:'
const GAMEPLAY_LOCK_PREFIX = 'vnpet:gameplay-tab:'
const TAB_LOCK_STALE_MS = 6500

// Helper to get auth header
const getAuthHeader = () => {
    const token = getValidTokenFromStorage()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const getStoredUserKey = () => {
    if (typeof window === 'undefined') return ''

    try {
        const raw = window.localStorage.getItem('user')
        if (!raw) return ''
        const parsed = JSON.parse(raw)
        return String(parsed?.id || parsed?._id || parsed?.userId || parsed?.email || parsed?.username || '').trim()
    } catch {
        return ''
    }
}

const getCurrentTabId = () => {
    if (typeof window === 'undefined') return ''
    return String(window.sessionStorage.getItem(TAB_ID_STORAGE_KEY) || '').trim()
}

const isStaleTab = (entry) => {
    const lastSeen = Number(entry?.lastSeen || 0)
    if (!String(entry?.tabId || '').trim()) return true
    if (!Number.isFinite(lastSeen) || lastSeen <= 0) return true
    return (Date.now() - lastSeen) > TAB_LOCK_STALE_MS
}

const readAllowedTabs = (userKey) => {
    if (typeof window === 'undefined' || !userKey) return []

    try {
        const raw = window.localStorage.getItem(`${PLAY_TAB_LOCK_PREFIX}${userKey}`)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs : []
        return tabs
            .map((entry) => ({
                tabId: String(entry?.tabId || '').trim(),
                lastSeen: Number(entry?.lastSeen || 0),
            }))
            .filter((entry) => !isStaleTab(entry))
    } catch {
        return []
    }
}

const readGameplayLock = (userKey) => {
    if (typeof window === 'undefined' || !userKey) return null

    try {
        const raw = window.localStorage.getItem(`${GAMEPLAY_LOCK_PREFIX}${userKey}`)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return {
            tabId: String(parsed?.tabId || '').trim(),
            lastSeen: Number(parsed?.lastSeen || 0),
        }
    } catch {
        return null
    }
}

const writeGameplayLock = (userKey, tabId) => {
    if (typeof window === 'undefined' || !userKey || !tabId) return
    window.localStorage.setItem(`${GAMEPLAY_LOCK_PREFIX}${userKey}`, JSON.stringify({
        tabId,
        lastSeen: Date.now(),
    }))
}

const getGameplayActionHeaders = (actionLabel = 'thao tác này') => {
    const userKey = getStoredUserKey()
    const tabId = getCurrentTabId()

    if (!userKey || !tabId) {
        return {
            allowed: false,
            headers: {},
            message: 'Tab này chưa sẵn sàng để chơi. Hãy tải lại trang rồi thử lại.',
        }
    }

    const allowedTabs = readAllowedTabs(userKey)
    if (allowedTabs.length > 0 && !allowedTabs.some((entry) => entry.tabId === tabId)) {
        return {
            allowed: false,
            headers: {},
            message: 'Bạn đã mở quá 2 tab chơi cho tài khoản này.',
        }
    }

    const currentLock = readGameplayLock(userKey)
    if (!currentLock || isStaleTab(currentLock) || currentLock.tabId === tabId) {
        writeGameplayLock(userKey, tabId)
        return {
            allowed: true,
            headers: {
                'X-VNPET-Tab-Id': tabId,
                'X-VNPET-Gameplay-Tab': tabId,
                'X-VNPET-Gameplay-Claim': '1',
            },
        }
    }

    return {
        allowed: false,
        headers: {
            'X-VNPET-Tab-Id': tabId,
            'X-VNPET-Gameplay-Tab': tabId,
        },
        message: `Tab này đang ở chế độ xem. Hãy quay lại tab đang chơi để tiếp tục ${actionLabel}.`,
    }
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
        const gameplay = getGameplayActionHeaders('tìm kiếm bản đồ')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
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

    async getEventMaps() {
        const res = await fetch(`${API_URL}/game/event-maps`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách bản đồ sự kiện')
        }
        const data = await res.json()
        return data.maps || []
    },

    // POST /api/game/encounter/:id/attack
    async attackEncounter(encounterId) {
        const gameplay = getGameplayActionHeaders('tấn công Pokemon hoang dã')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/attack`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
                ...gameplay.headers,
            },
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tấn công thất bại')
        }
        return res.json()
    },

    // POST /api/game/encounter/:id/catch
    async catchEncounter(encounterId) {
        const gameplay = getGameplayActionHeaders('bắt Pokemon')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/catch`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
                ...gameplay.headers,
            },
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
        const gameplay = getGameplayActionHeaders('rút lui khỏi trận')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/run`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
                ...gameplay.headers,
            },
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
        const gameplay = getGameplayActionHeaders('nhận kết quả battle')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/battle/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
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
        const gameplay = getGameplayActionHeaders('tấn công battle')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/battle/attack`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tấn công trong battle thất bại')
        }
        return res.json()
    },

    async startTrainerBattle(payload) {
        const gameplay = getGameplayActionHeaders('bắt đầu battle trainer')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/battle/trainer/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể bắt đầu battle trainer')
        }
        return res.json()
    },

    async switchTrainerBattlePokemon(payload) {
        const gameplay = getGameplayActionHeaders('đổi Pokemon battle trainer')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/battle/trainer/switch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Đổi Pokemon trong battle trainer thất bại')
        }
        return res.json()
    },

    // GET /api/game/auto-trainer/status
    async getAutoTrainerStatus() {
        const res = await fetch(`${API_URL}/game/auto-trainer/status`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải trạng thái auto trainer')
        }
        return res.json()
    },

    // POST /api/game/auto-trainer/settings
    async updateAutoTrainerSettings(payload = {}) {
        const gameplay = getGameplayActionHeaders('cập nhật auto trainer')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/auto-trainer/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể cập nhật auto trainer')
        }
        return res.json()
    },

    // GET /api/game/auto-search/status
    async getAutoSearchStatus() {
        const res = await fetch(`${API_URL}/game/auto-search/status`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải trạng thái auto tìm kiếm')
        }
        return res.json()
    },

    // POST /api/game/auto-search/settings
    async updateAutoSearchSettings(payload = {}) {
        const gameplay = getGameplayActionHeaders('cập nhật auto tìm kiếm')
        if (!gameplay.allowed) {
            throw new Error(gameplay.message)
        }
        const res = await fetch(`${API_URL}/game/auto-search/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
                ...gameplay.headers,
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể cập nhật auto tìm kiếm')
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

    // GET /api/pokemon/species/:id
    async getPokemonSpeciesDetail(id) {
        const res = await fetch(`${API_URL}/pokemon/species/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải thông tin loài Pokemon')
        }
        const data = await res.json()
        return data.species
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

    // GET /api/pokemon/evolution-zone
    async getEvolutionZone(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/pokemon/evolution-zone${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải khu vực tiến hóa')
        }
        return res.json()
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

    // GET /api/pokemon/:id/level-transfer-candidates
    async getPokemonLevelTransferCandidates(id, params = {}) {
        const searchParams = new URLSearchParams(params)
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/pokemon/${id}/level-transfer-candidates${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách Pokemon nguồn')
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
    async getProfile(options = {}) {
        const searchParams = new URLSearchParams()
        if (options?.light) {
            searchParams.set('light', '1')
        }

        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auth/me${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải hồ sơ')
        }
        return res.json()
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

    async getPokedexStatus(entries = []) {
        const res = await fetch(`${API_URL}/pokemon/pokedex/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ entries }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải trạng thái Pokedex')
        }
        return res.json()
    },

    // GET /api/battle-trainers
    async getBattleTrainers(options = {}) {
        const searchParams = new URLSearchParams()
        if (options?.view) {
            searchParams.set('view', String(options.view || '').trim())
        }

        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/battle-trainers${query ? `?${query}` : ''}`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải danh sách huấn luyện viên battle')
        }
        return res.json()
    },

    async getBattleTrainer(trainerId) {
        const normalizedTrainerId = String(trainerId || '').trim()
        if (!normalizedTrainerId) {
            throw new Error('Thiếu mã huấn luyện viên battle')
        }

        const res = await fetch(`${API_URL}/battle-trainers/${normalizedTrainerId}`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải chi tiết huấn luyện viên battle')
        }
        return res.json()
    },

    // POST /api/inventory/use
    async useItem(itemId, quantity = 1, encounterId = null, activePokemonId = null, moveName = '', context = null, sourcePokemonId = null) {
        const res = await fetch(`${API_URL}/inventory/use`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ itemId, quantity, encounterId, activePokemonId, moveName, context, sourcePokemonId }),
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
        const shouldForceRefresh = params?.forceRefresh === true
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                if (key === 'forceRefresh') {
                    if (value === true) {
                        searchParams.append('refresh', '1')
                    }
                    return
                }
                searchParams.append(key, String(value))
            }
        })
        if (shouldForceRefresh) {
            searchParams.append('_ts', String(Date.now()))
        }
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/pokemon${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
            cache: shouldForceRefresh ? 'no-store' : 'default',
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải bảng xếp hạng Pokemon')
        }
        return res.json()
    },

    // GET /api/rankings/pokemon-rarity - Pokemon rarity amount viewer
    async getPokemonRarityStats(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/pokemon-rarity${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải bảng độ hiếm Pokemon')
        }
        return res.json()
    },

    // GET /api/rankings/pokemon-rarity/options - Pokemon selector options
    async getPokemonRarityOptions(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/pokemon-rarity/options${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải danh sách Pokemon cho bộ chọn')
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

    // GET /api/shop/moon-items
    async getMoonShopItems(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/moon-items${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải cửa hàng Nguyệt Các')
        }
        return res.json()
    },

    // GET /api/shop/moon-items/:itemId
    async getMoonShopItem(itemId) {
        const res = await fetch(`${API_URL}/shop/moon-items/${itemId}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải chi tiết vật phẩm')
        }
        return res.json()
    },

    // POST /api/shop/moon-items/:itemId/buy
    async buyMoonShopItem(itemId, quantity = 1) {
        const res = await fetch(`${API_URL}/shop/moon-items/${itemId}/buy`, {
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

    async getAvailableSellPokemon(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/sell/available-pokemon${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải Pokemon khả dụng để đăng bán')
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

    async getItemMarketSellData(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/item-market/sell${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải dữ liệu bán vật phẩm')
        return res.json()
    },

    async createItemMarketListing(payload) {
        const res = await fetch(`${API_URL}/shop/item-market/sell/list`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Tạo tin đăng vật phẩm thất bại')
        return res.json()
    },

    async cancelItemMarketListing(listingId) {
        const res = await fetch(`${API_URL}/shop/item-market/sell/${listingId}/cancel`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Hủy tin đăng vật phẩm thất bại')
        return res.json()
    },

    async getItemMarketListings(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/shop/item-market/buy${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải khu giao dịch vật phẩm')
        return res.json()
    },

    async buyItemMarketListing(listingId) {
        const res = await fetch(`${API_URL}/shop/item-market/buy/${listingId}`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Mua vật phẩm giao dịch thất bại')
        return res.json()
    },

    async getAuctions(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách đấu giá')
        return res.json()
    },

    async getParticipatedAuctions(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions/me/participated${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải phiên đấu giá bạn đã tham gia')
        return res.json()
    },

    async getAuctionDetail(id) {
        const res = await fetch(`${API_URL}/auctions/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải chi tiết đấu giá')
        return res.json()
    },

    async getAuctionBids(id, params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions/${id}/bids${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải lịch sử đấu giá')
        return res.json()
    },

    async placeAuctionBid(id, amount) {
        const res = await fetch(`${API_URL}/auctions/${id}/bid`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ amount }),
        })
        if (!res.ok) await throwApiError(res, 'Đặt giá đấu thất bại')
        return res.json()
    },

    async getManagedAuctions(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions/manage${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách đấu giá của bạn')
        return res.json()
    },

    async getEscrowedAuctionPokemon() {
        const res = await fetch(`${API_URL}/auctions/me/escrowed-pokemon`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải Pokémon đang được giữ cho đấu giá')
        return res.json()
    },

    async getManagedAuctionById(id) {
        const res = await fetch(`${API_URL}/auctions/manage/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải chi tiết đấu giá của bạn')
        return res.json()
    },

    async createManagedAuction(payload = {}) {
        const res = await fetch(`${API_URL}/auctions/manage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Tạo phiên đấu giá thất bại')
        return res.json()
    },

    async updateManagedAuction(id, payload = {}) {
        const res = await fetch(`${API_URL}/auctions/manage/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Cập nhật phiên đấu giá thất bại')
        return res.json()
    },

    async publishManagedAuction(id) {
        const res = await fetch(`${API_URL}/auctions/manage/${id}/publish`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Xuất bản phiên đấu giá thất bại')
        return res.json()
    },

    async cancelManagedAuction(id, payload = {}) {
        const res = await fetch(`${API_URL}/auctions/manage/${id}/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Hủy phiên đấu giá thất bại')
        return res.json()
    },

    async getManagedAuctionBids(id, params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions/manage/${id}/bids${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải lịch sử đấu giá của bạn')
        return res.json()
    },

    async lookupManagedAuctionPokemon(params = {}) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })
        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/auctions/manage/lookup/pokemon${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải Pokémon có thể đem đấu giá')
        return res.json()
    },

    // GET /api/rankings/:type - Get rankings
    async getRankings(type = 'overall', page = 1, limit = 35, params = {}) {
        const searchParams = new URLSearchParams({
            page: String(page),
            limit: String(limit),
        })
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.append(key, String(value))
            }
        })

        const query = searchParams.toString()
        const res = await fetch(`${API_URL}/rankings/${type}${query ? `?${query}` : ''}`, {
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
