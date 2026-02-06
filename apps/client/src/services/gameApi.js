const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Helper to get auth header
const getAuthHeader = () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
}

export const gameApi = {
    // POST /api/game/click
    async click() {
        const res = await fetch(`${API_URL}/game/click`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to click')
        return res.json()
    },

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
            throw new Error(data.message || 'Failed to search map')
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
            throw new Error(data.message || 'Failed to fetch map state')
        }
        return data
    },

    // GET /api/game/maps
    async getMaps() {
        const res = await fetch(`${API_URL}/game/maps`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch maps')
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
            throw new Error(err.message || 'Attack failed')
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
            throw new Error(err.message || 'Catch failed')
        }
        return res.json()
    },

    // POST /api/game/encounter/:id/run
    async runEncounter(encounterId) {
        const res = await fetch(`${API_URL}/game/encounter/${encounterId}/run`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Run failed')
        }
        return res.json()
    },

    // GET /api/stats - Get server statistics
    async getServerStats() {
        const res = await fetch(`${API_URL}/stats`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch server stats')
        }
        return res.json()
    },
}
