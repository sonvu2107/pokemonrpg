const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Public Map API (no authentication required)
export const mapApi = {
    // GET /api/maps/legendary - Fetch all legendary maps
    async fetchLegendaryMaps() {
        const res = await fetch(`${API_URL}/maps/legendary`)
        if (!res.ok) throw new Error('Failed to fetch legendary maps')
        const data = await res.json()
        return data.maps || []
    },

    // GET /api/maps - Fetch all maps
    async list() {
        const res = await fetch(`${API_URL}/maps`)
        if (!res.ok) throw new Error('Failed to fetch maps')
        const data = await res.json()
        return data.maps || []
    },

    // GET /api/maps/:slug - Fetch map details by slug
    async getBySlug(slug) {
        const res = await fetch(`${API_URL}/maps/${slug}`)
        if (!res.ok) throw new Error('Failed to fetch map')
        const data = await res.json()
        return data
    },
}
