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
        const res = await fetch(`${API_URL}/admin/maps`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Tạo bản đồ thất bại')
        }
        return res.json()
    },

    async update(id, data) {
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(data),
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
}

// Battle trainer endpoints
export const battleTrainerApi = {
    async list() {
        const res = await fetch(`${API_URL}/admin/battle-trainers`, {
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
