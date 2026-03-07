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

const normalizeMapSpecialPokemonConfigs = (value) => {
    if (!Array.isArray(value)) return []

    const normalized = []
    const seen = new Set()

    for (const entry of value) {
        const pokemonIdRaw = typeof entry === 'string'
            ? entry
            : (entry?.pokemonId?._id || entry?.pokemonId)
        const pokemonId = String(pokemonIdRaw || '').trim()
        if (!pokemonId) continue

        const formIdRaw = typeof entry === 'object' && entry !== null ? entry.formId : 'normal'
        const formId = String(formIdRaw || '').trim().toLowerCase() || 'normal'
        const dedupeKey = `${pokemonId}:${formId}`
        if (seen.has(dedupeKey)) continue

        const weightRaw = typeof entry === 'object' && entry !== null ? entry.weight : 1
        const weightParsed = Number(weightRaw)
        const weight = Number.isFinite(weightParsed) && weightParsed > 0 ? weightParsed : 1

        normalized.push({ pokemonId, formId, weight })
        seen.add(dedupeKey)

        if (normalized.length >= 5) break
    }

    return normalized
}

const MAP_RARITY_CATCH_KEYS = ['s', 'ss', 'sss']
const MAP_RARITY_CATCH_BONUS_MIN_PERCENT = -95
const MAP_RARITY_CATCH_BONUS_MAX_PERCENT = 500

const normalizeMapRarityCatchBonusPercent = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return MAP_RARITY_CATCH_KEYS.reduce((acc, key) => {
        const parsed = Number(source?.[key])
        acc[key] = Number.isFinite(parsed)
            ? Math.max(MAP_RARITY_CATCH_BONUS_MIN_PERCENT, Math.min(MAP_RARITY_CATCH_BONUS_MAX_PERCENT, parsed))
            : 0
        return acc
    }, {})
}

const buildMapPayload = (data = {}) => {
    const iconIdRaw = data?.iconId
    const parsedIconId = Number(iconIdRaw)
    const iconId = iconIdRaw === '' || iconIdRaw === null || iconIdRaw === undefined || !Number.isFinite(parsedIconId)
        ? ''
        : parsedIconId

    return {
        name: String(data?.name || '').trim(),
        description: String(data?.description || '').trim(),
        mapImageUrl: String(data?.mapImageUrl || '').trim(),
        levelMin: Number(data?.levelMin) || 1,
        levelMax: Number(data?.levelMax) || 1,
        isLegendary: Boolean(data?.isLegendary),
        isEventMap: Boolean(data?.isEventMap),
        iconId,
        specialPokemonImages: Array.isArray(data?.specialPokemonImages)
            ? data.specialPokemonImages
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .slice(0, 5)
            : [],
        specialPokemonConfigs: normalizeMapSpecialPokemonConfigs(data?.specialPokemonConfigs),
        specialPokemonEncounterRate: Number(data?.specialPokemonEncounterRate ?? 0),
        requiredSearches: Math.max(0, Number(data?.requiredSearches) || 0),
        requiredPlayerLevel: Math.max(1, Number(data?.requiredPlayerLevel) || 1),
        encounterRate: Number(data?.encounterRate ?? 1),
        itemDropRate: Number(data?.itemDropRate ?? 0),
        rarityCatchBonusPercent: normalizeMapRarityCatchBonusPercent(data?.rarityCatchBonusPercent),
        orderIndex: Math.max(0, Number(data?.orderIndex) || 0),
    }
}

// Pokemon endpoints
export const pokemonApi = {
    // GET /api/admin/pokemon?search=&type=&page=&limit=
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/pokemon?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải Pokemon')
        return res.json()
    },

    // GET /api/admin/pokemon/:id
    async getById(id) {
        const res = await fetch(`${API_URL}/admin/pokemon/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải Pokemon')
        return res.json()
    },

    // GET /api/admin/pokemon/lookup/moves
    async lookupMoves(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/pokemon/lookup/moves?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải danh sách kỹ năng')
        return res.json()
    },

    // GET /api/admin/pokemon/form-variants
    async listFormVariants(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/pokemon/form-variants?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể tải danh sách dạng tùy chỉnh')
        }
        return res.json()
    },

    // POST /api/admin/pokemon/form-variants
    async upsertFormVariant(data = {}) {
        const res = await fetch(`${API_URL}/admin/pokemon/form-variants`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể lưu dạng mới')
        }
        return res.json()
    },

    // POST /api/admin/pokemon
    async create(data) {
        const res = await fetch(`${API_URL}/admin/pokemon`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo Pokemon thất bại')
        }
        return res.json()
    },

    // PUT /api/admin/pokemon/:id
    async update(id, data) {
        const res = await fetch(`${API_URL}/admin/pokemon/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật Pokemon thất bại')
        }
        return res.json()
    },

    // PUT /api/admin/pokemon/evolutions/bulk
    async bulkUpdateEvolutions(updates = []) {
        const res = await fetch(`${API_URL}/admin/pokemon/evolutions/bulk`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ updates }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật tiến hóa hàng loạt thất bại')
        }
        return res.json()
    },

    // POST /api/admin/pokemon/import/csv
    async importPokemonCsv(pokemon = []) {
        const res = await fetch(`${API_URL}/admin/pokemon/import/csv`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ pokemon }),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Import Pokemon CSV that bai')
        }
        return res.json()
    },

    // DELETE /api/admin/pokemon/:id
    async delete(id) {
        const res = await fetch(`${API_URL}/admin/pokemon/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa Pokemon thất bại')
        return res.json()
    },
}

// Map endpoints
export const mapApi = {
    async list() {
        const res = await fetch(`${API_URL}/admin/maps`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải bản đồ')
        return res.json()
    },

    async getById(id) {
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải bản đồ')
        return res.json()
    },

    async create(data) {
        const payload = buildMapPayload(data)
        const res = await fetch(`${API_URL}/admin/maps`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo bản đồ thất bại')
        }
        return res.json()
    },

    async update(id, data) {
        const payload = buildMapPayload(data)
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật bản đồ thất bại')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa bản đồ thất bại')
        return res.json()
    },

    // GET /api/admin/maps/:mapId/drop-rates
    async getDropRates(mapId) {
        const res = await fetch(`${API_URL}/admin/maps/${mapId}/drop-rates`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải tỉ lệ rơi')
        return res.json()
    },

    async getItemDropRates(mapId) {
        const res = await fetch(`${API_URL}/admin/maps/${mapId}/item-drop-rates`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải tỉ lệ rơi vật phẩm')
        return res.json()
    },

    async getLookupItems() {
        const res = await fetch(`${API_URL}/admin/maps/lookup/items`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Không thể tải vật phẩm')
        }
        return res.json()
    },

    // POST /api/admin/maps/upload-special-image
    async uploadSpecialImage(file) {
        const formData = new FormData()
        formData.append('image', file)

        const res = await fetch(`${API_URL}/admin/maps/upload-special-image`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
            },
            body: formData,
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tải lên thất bại')
        }
        return res.json()
    },

    // POST /api/admin/maps/upload-map-image
    async uploadMapImage(file) {
        const formData = new FormData()
        formData.append('image', file)

        const res = await fetch(`${API_URL}/admin/maps/upload-map-image`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
            },
            body: formData,
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tải ảnh bản đồ thất bại')
        }
        return res.json()
    },
}

// DropRate endpoints
export const dropRateApi = {
    // POST /api/admin/drop-rates (upsert)
    async upsert(data) {
        const res = await fetch(`${API_URL}/admin/drop-rates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Lưu tỉ lệ rơi thất bại')
        }
        return res.json()
    },

    // DELETE /api/admin/drop-rates/:id
    async delete(id) {
        const res = await fetch(`${API_URL}/admin/drop-rates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa tỉ lệ rơi thất bại')
        return res.json()
    },

    // DELETE /api/admin/drop-rates/map/:mapId
    async deleteAll(mapId) {
        const res = await fetch(`${API_URL}/admin/drop-rates/map/${mapId}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        const data = await res.json()
        if (!res.ok) {
            throw new Error(data.message || 'Xóa toàn bộ tỉ lệ rơi thất bại')
        }
        return data
    },
}

// Item endpoints
export const itemApi = {
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/items?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải vật phẩm')
        return res.json()
    },

    async getById(id) {
        const res = await fetch(`${API_URL}/admin/items/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải vật phẩm')
        return res.json()
    },

    async create(data) {
        const res = await fetch(`${API_URL}/admin/items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo vật phẩm thất bại')
        }
        return res.json()
    },

    async update(id, data) {
        const res = await fetch(`${API_URL}/admin/items/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật vật phẩm thất bại')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/items/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa vật phẩm thất bại')
        return res.json()
    },

    async getPurchaseHistory(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/items/purchase-history?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể tải lịch sử mua')
        }
        return res.json()
    },
}

// Move endpoints
export const moveApi = {
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/moves?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải kỹ năng')
        return res.json()
    },

    async getById(id) {
        const res = await fetch(`${API_URL}/admin/moves/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải kỹ năng')
        return res.json()
    },

    async create(data) {
        const res = await fetch(`${API_URL}/admin/moves`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo kỹ năng thất bại')
        }
        return res.json()
    },

    async importMoveCsv(moves = []) {
        const res = await fetch(`${API_URL}/admin/moves/import/csv`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ moves }),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Import kỹ năng thất bại')
        }
        return res.json()
    },

    async update(id, data) {
        const res = await fetch(`${API_URL}/admin/moves/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật kỹ năng thất bại')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/moves/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa kỹ năng thất bại')
        return res.json()
    },

    async getPurchaseHistory(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/moves/purchase-history?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể tải lịch sử mua kỹ năng')
        }
        return res.json()
    },

    async getEffectProgress() {
        const res = await fetch(`${API_URL}/admin/moves/effects/progress`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể tải tiến độ hiệu ứng kỹ năng')
        }
        return res.json()
    },

    async getEffectCatalog() {
        const res = await fetch(`${API_URL}/admin/moves/effects/catalog`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể tải danh mục hiệu ứng')
        }
        return res.json()
    },

    async bulkApplyShop(data = {}) {
        const res = await fetch(`${API_URL}/admin/moves/shop/bulk-apply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể cập nhật shop hàng loạt cho kỹ năng')
        }
        return res.json()
    },

    async bulkHideShop(data = {}) {
        const res = await fetch(`${API_URL}/admin/moves/shop/bulk-hide`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Không thể ẩn hàng loạt kỹ năng khỏi shop')
        }
        return res.json()
    },
}

// Battle trainer endpoints
export const battleTrainerApi = {
    async list(params = {}) {
        const query = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.append(key, String(value))
            }
        })
        const queryString = query.toString()
        const res = await fetch(`${API_URL}/admin/battle-trainers${queryString ? `?${queryString}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Không thể tải huấn luyện viên battle')
        return res.json()
    },

    async create(data) {
        const res = await fetch(`${API_URL}/admin/battle-trainers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo huấn luyện viên thất bại')
        }
        return res.json()
    },

    async update(id, data) {
        const res = await fetch(`${API_URL}/admin/battle-trainers/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật huấn luyện viên thất bại')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/battle-trainers/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa huấn luyện viên thất bại')
        return res.json()
    },

    async deleteAll() {
        const res = await fetch(`${API_URL}/admin/battle-trainers`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Xóa toàn bộ huấn luyện viên thất bại')
        }
        return res.json()
    },

    async deleteAutoGenerated() {
        const res = await fetch(`${API_URL}/admin/battle-trainers/auto-generated`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Xóa trainer auto-generated thất bại')
        }
        return res.json()
    },

    async autoGenerate(payload = {}) {
        const res = await fetch(`${API_URL}/admin/battle-trainers/auto-generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.message || 'Auto tạo huấn luyện viên thất bại')
        }
        return res.json()
    },
}

// Item DropRate endpoints
export const itemDropRateApi = {
    async upsert(data) {
        const res = await fetch(`${API_URL}/admin/item-drop-rates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Lưu tỉ lệ rơi vật phẩm thất bại')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/item-drop-rates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Xóa tỉ lệ rơi vật phẩm thất bại')
        return res.json()
    },
}

// Daily reward endpoints
export const dailyRewardApi = {
    // GET /api/admin/daily-rewards
    async list() {
        const res = await fetch(`${API_URL}/admin/daily-rewards`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải cấu hình quà hằng ngày')
        return res.json()
    },

    // PUT /api/admin/daily-rewards/:day
    async update(day, payload) {
        const res = await fetch(`${API_URL}/admin/daily-rewards/${day}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Không thể cập nhật quà hằng ngày')
        return res.json()
    },
}

// Weekly leaderboard reward endpoints
export const leaderboardRewardApi = {
    // GET /api/admin/leaderboard-rewards?mode=&weekStart=
    async list(params = {}) {
        const query = new URLSearchParams()
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.append(key, String(value))
            }
        })

        const queryString = query.toString()
        const res = await fetch(`${API_URL}/admin/leaderboard-rewards${queryString ? `?${queryString}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải dữ liệu trao thưởng top tuần')
        return res.json()
    },

    // POST /api/admin/leaderboard-rewards/award
    async award(payload = {}) {
        const res = await fetch(`${API_URL}/admin/leaderboard-rewards/award`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Trao thưởng top tuần thất bại')
        return res.json()
    },

    // GET /api/admin/leaderboard-rewards/meta/items
    async lookupItems(params = {}) {
        const query = new URLSearchParams()
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.append(key, String(value))
            }
        })

        const queryString = query.toString()
        const res = await fetch(`${API_URL}/admin/leaderboard-rewards/meta/items${queryString ? `?${queryString}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách vật phẩm thưởng')
        return res.json()
    },

    // GET /api/admin/leaderboard-rewards/meta/pokemon
    async lookupPokemon(params = {}) {
        const query = new URLSearchParams()
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.append(key, String(value))
            }
        })

        const queryString = query.toString()
        const res = await fetch(`${API_URL}/admin/leaderboard-rewards/meta/pokemon${queryString ? `?${queryString}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách Pokemon thưởng')
        return res.json()
    },
}

// Promo code endpoints
export const promoCodeApi = {
    // GET /api/admin/promo-codes
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/promo-codes${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách mã code')
        return res.json()
    },

    // POST /api/admin/promo-codes
    async create(payload) {
        const res = await fetch(`${API_URL}/admin/promo-codes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Tạo mã code thất bại')
        return res.json()
    },

    // PUT /api/admin/promo-codes/:id
    async update(id, payload) {
        const res = await fetch(`${API_URL}/admin/promo-codes/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Cập nhật mã code thất bại')
        return res.json()
    },

    // DELETE /api/admin/promo-codes/:id
    async delete(id) {
        const res = await fetch(`${API_URL}/admin/promo-codes/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Xóa mã code thất bại')
        return res.json()
    },
}

// User endpoints
export const userApi = {
    // GET /api/admin/users?search=&page=&limit=
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/users?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách người dùng')
        return res.json()
    },

    // PUT /api/admin/users/:id/role
    async updateRole(userId, role) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/role`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ role }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật vai trò thất bại')
        }
        return res.json()
    },

    // PUT /api/admin/users/:id/permissions
    async updatePermissions(userId, permissions) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/permissions`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ permissions }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Cập nhật quyền thất bại')
        }
        return res.json()
    },

    // PUT /api/admin/users/:id/vip-benefits
    async updateVipBenefits(userId, payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/vip-benefits`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Cập nhật quyền lợi VIP thất bại')
        return res.json()
    },

    // PUT /api/admin/users/:id/vip-tier
    async updateVipTier(userId, payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/vip-tier`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Cập nhật cấp VIP cho người dùng thất bại')
        return res.json()
    },

    // POST /api/admin/users/bulk-delete
    async bulkDelete(userIds = []) {
        const res = await fetch(`${API_URL}/admin/users/bulk-delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ userIds }),
        })
        if (!res.ok) await throwApiError(res, 'Xóa tài khoản hàng loạt thất bại')
        return res.json()
    },

    // PUT /api/admin/users/:id/ban
    async updateBan(userId, payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/ban`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Cập nhật trạng thái khóa tài khoản thất bại')
        return res.json()
    },

    // GET /api/admin/users/ip-bans
    async listIpBans(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/users/ip-bans?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách IP bị chặn')
        return res.json()
    },

    // POST /api/admin/users/ip-bans
    async banIp(payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/ip-bans`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Chặn IP thất bại')
        return res.json()
    },

    // DELETE /api/admin/users/ip-bans/:banId
    async unbanIp(banId) {
        const res = await fetch(`${API_URL}/admin/users/ip-bans/${banId}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Gỡ chặn IP thất bại')
        return res.json()
    },

    // GET /api/admin/users/lookup/pokemon
    async lookupPokemon(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/users/lookup/pokemon?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tra cứu Pokemon')
        return res.json()
    },

    // GET /api/admin/users/lookup/items
    async lookupItems(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/users/lookup/items?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tra cứu vật phẩm')
        return res.json()
    },

    // POST /api/admin/users/:id/grant-pokemon
    async grantPokemon(userId, payload) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/grant-pokemon`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Cấp Pokemon thất bại')
        return res.json()
    },

    // POST /api/admin/users/:id/grant-item
    async grantItem(userId, payload) {
        const res = await fetch(`${API_URL}/admin/users/${userId}/grant-item`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload),
        })
        if (!res.ok) await throwApiError(res, 'Cấp vật phẩm thất bại')
        return res.json()
    },
}

export const vipTierApi = {
    // GET /api/admin/users/vip-tiers
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/users/vip-tiers${query ? `?${query}` : ''}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải danh sách đặc quyền VIP')
        return res.json()
    },

    // POST /api/admin/users/vip-tiers
    async create(payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/vip-tiers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tạo đặc quyền VIP')
        return res.json()
    },

    // POST /api/admin/users/vip-tiers/bulk-range
    async createRange(payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/vip-tiers/bulk-range`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Không thể tạo dải cấp VIP')
        return res.json()
    },

    // POST /api/admin/users/vip-tiers/upload-image
    async uploadImage(file) {
        const formData = new FormData()
        formData.append('image', file)

        const res = await fetch(`${API_URL}/admin/users/vip-tiers/upload-image`, {
            method: 'POST',
            headers: {
                ...getAuthHeader(),
            },
            body: formData,
        })
        if (!res.ok) await throwApiError(res, 'Không thể tải ảnh đặc quyền VIP')
        return res.json()
    },

    // PUT /api/admin/users/vip-tiers/:tierId
    async update(tierId, payload = {}) {
        const res = await fetch(`${API_URL}/admin/users/vip-tiers/${tierId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(payload || {}),
        })
        if (!res.ok) await throwApiError(res, 'Không thể cập nhật đặc quyền VIP')
        return res.json()
    },

    // DELETE /api/admin/users/vip-tiers/:tierId
    async delete(tierId) {
        const res = await fetch(`${API_URL}/admin/users/vip-tiers/${tierId}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) await throwApiError(res, 'Không thể xóa đặc quyền VIP')
        return res.json()
    },
}
