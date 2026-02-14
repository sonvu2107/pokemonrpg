const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Helper to get auth header
const getAuthHeader = () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const newsApi = {
    // Get all published news (public)
    getNews: async (options = 10) => {
        const normalized = typeof options === 'number'
            ? { limit: options }
            : (options || {})
        const limit = Number.isFinite(Number(normalized.limit)) ? Number(normalized.limit) : 10
        const type = String(normalized.type || '').trim().toLowerCase()
        const searchParams = new URLSearchParams({ limit: String(limit) })
        if (type) {
            searchParams.set('type', type)
        }

        const res = await fetch(`${API_URL}/news?${searchParams.toString()}`)
        if (!res.ok) throw new Error('Failed to fetch news')
        return res.json()
    },

    // Get single news post
    getNewsById: async (id) => {
        const res = await fetch(`${API_URL}/news/${id}`)
        if (!res.ok) throw new Error('Failed to fetch news')
        return res.json()
    },

    // Admin: Get all news including unpublished
    getAllNews: async () => {
        const res = await fetch(`${API_URL}/news/admin/all`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to fetch all news')
        return res.json()
    },

    // Admin: Create news
    createNews: async (newsData) => {
        const res = await fetch(`${API_URL}/news`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(newsData),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to create news')
        }
        return res.json()
    },

    // Admin: Update news
    updateNews: async (id, newsData) => {
        const res = await fetch(`${API_URL}/news/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify(newsData),
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.message || 'Failed to update news')
        }
        return res.json()
    },

    // Admin: Delete news
    deleteNews: async (id) => {
        const res = await fetch(`${API_URL}/news/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) throw new Error('Failed to delete news')
        return res.json()
    },
}

export default newsApi
