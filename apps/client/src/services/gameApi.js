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

    // GET /api/game/encounter/active
    async getActiveEncounter() {
        const res = await fetch(`${API_URL}/game/encounter/active`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch encounter')
        }
        return res.json()
    },

    // POST /api/game/battle/resolve
    async resolveBattle(opponentTeam, trainerId = null) {
        const res = await fetch(`${API_URL}/game/battle/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ opponentTeam, trainerId }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to resolve battle')
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
            throw new Error(err.message || 'Battle attack failed')
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

    // GET /api/pokemon/:id
    async getPokemonDetail(id) {
        const res = await fetch(`${API_URL}/pokemon/${id}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch pokemon detail')
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
            throw new Error(data.message || 'Failed to evolve pokemon')
        }
        return data
    },

    // GET /api/party
    async getParty() {
        const res = await fetch(`${API_URL}/party`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch party')
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
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch inventory')
        }
        return res.json()
    },

    // GET /api/auth/me
    async getProfile() {
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch profile')
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
            throw new Error(data.message || 'Failed to save trainer progress')
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
            throw new Error(err.message || 'Failed to fetch box')
        }
        return res.json()
    },

    // GET /api/pokemon
    async getPokemonList(params = {}) {
        const searchParams = new URLSearchParams(params)
        const res = await fetch(`${API_URL}/pokemon?${searchParams.toString()}`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch pokemon list')
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
            throw new Error(err.message || 'Failed to fetch pokedex')
        }
        return res.json()
    },

    // GET /api/battle-trainers
    async getBattleTrainers() {
        const res = await fetch(`${API_URL}/battle-trainers`)
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to fetch battle trainers')
        }
        return res.json()
    },

    // POST /api/inventory/use
    async useItem(itemId, quantity = 1, encounterId = null) {
        const res = await fetch(`${API_URL}/inventory/use`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ itemId, quantity, encounterId }),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to use item')
        }
        return res.json()
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
            throw new Error(err.message || 'Swap failed')
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
            throw new Error(err.message || 'Add to party failed')
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
            throw new Error(err.message || 'Remove from party failed')
        }
        return res.json()
    },

    // GET /api/rankings/pokemon - Pokemon leaderboard with filters
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
            throw new Error(err.message || 'Failed to fetch pokemon rankings')
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
            throw new Error(err.message || 'Failed to fetch rankings')
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
            throw new Error(err.message || 'Failed to fetch daily rankings')
        }
        return res.json()
    },
}
