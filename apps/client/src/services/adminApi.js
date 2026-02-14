const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Helper to get auth header
const getAuthHeader = () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
}

// Pokemon endpoints
export const pokemonApi = {
    // GET /api/admin/pokemon?search=&type=&page=&limit=
    async list(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/admin/pokemon?${query}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch pokemon')
        return res.json()
    },

    // GET /api/admin/pokemon/:id
    async getById(id) {
        const res = await fetch(`${API_URL}/admin/pokemon/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch pokemon')
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
            throw new Error(err.message || 'Failed to create pokemon')
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
            throw new Error(err.message || 'Failed to update pokemon')
        }
        return res.json()
    },

    // DELETE /api/admin/pokemon/:id
    async delete(id) {
        const res = await fetch(`${API_URL}/admin/pokemon/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete pokemon')
        return res.json()
    },
}

// Map endpoints
export const mapApi = {
    async list() {
        const res = await fetch(`${API_URL}/admin/maps`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch maps')
        return res.json()
    },

    async getById(id) {
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch map')
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
            throw new Error(err.message || 'Failed to create map')
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
            throw new Error(err.message || 'Failed to update map')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/maps/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete map')
        return res.json()
    },

    // GET /api/admin/maps/:mapId/drop-rates
    async getDropRates(mapId) {
        const res = await fetch(`${API_URL}/admin/maps/${mapId}/drop-rates`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch drop rates')
        if (!res.ok) throw new Error('Failed to fetch drop rates')
        return res.json()
    },

    async getItemDropRates(mapId) {
        const res = await fetch(`${API_URL}/admin/maps/${mapId}/item-drop-rates`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch item drop rates')
        return res.json()
    },

    async getLookupItems() {
        const res = await fetch(`${API_URL}/admin/maps/lookup/items`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch items')
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
            throw new Error(err.message || 'Upload failed')
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
            throw new Error(err.message || 'Map image upload failed')
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
            throw new Error(err.message || 'Failed to save drop rate')
        }
        return res.json()
    },

    // DELETE /api/admin/drop-rates/:id
    async delete(id) {
        const res = await fetch(`${API_URL}/admin/drop-rates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete drop rate')
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
            throw new Error(data.message || 'Failed to delete all drop rates')
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
        if (!res.ok) throw new Error('Failed to fetch items')
        return res.json()
    },

    async getById(id) {
        const res = await fetch(`${API_URL}/admin/items/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch item')
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
            throw new Error(err.message || 'Failed to create item')
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
            throw new Error(err.message || 'Failed to update item')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/items/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete item')
        return res.json()
    },
}

// Battle trainer endpoints
export const battleTrainerApi = {
    async list() {
        const res = await fetch(`${API_URL}/admin/battle-trainers`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch battle trainers')
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
            throw new Error(err.message || 'Failed to create trainer')
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
            throw new Error(err.message || 'Failed to update trainer')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/battle-trainers/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete trainer')
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
            throw new Error(err.message || 'Failed to save item drop rate')
        }
        return res.json()
    },

    async delete(id) {
        const res = await fetch(`${API_URL}/admin/item-drop-rates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete item drop rate')
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
        if (!res.ok) throw new Error('Failed to fetch users')
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
            throw new Error(err.message || 'Failed to update role')
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
            throw new Error(err.message || 'Failed to update permissions')
        }
        return res.json()
    },
}
