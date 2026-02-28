const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
import { clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

// Helper to set Authorization header
const authHeaders = () => {
    const token = getValidTokenFromStorage()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

export const api = {
    // Auth endpoints
    async register(email, username, password) {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Đăng ký thất bại')
        return data
    },

    async login(email, password) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Đăng nhập thất bại')
        return data
    },

    async getProfile() {
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: { ...authHeaders() },
        })
        const data = await res.json()
        if (res.status === 401) {
            clearAuthSession(data?.message || 'Phiên đăng nhập không hợp lệ')
        }
        if (!res.ok) throw new Error(data.message || 'Không thể tải hồ sơ')
        return data
    },

    async getStats() {
        const res = await fetch(`${API_URL}/stats`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Không thể tải thống kê')
        return data
    },

    // Game endpoints
    async clickAttack() {
        const res = await fetch(`${API_URL}/game/click`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
            },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Click thất bại')
        return data
    },
    async updateProfile(userData) {
        const res = await fetch(`${API_URL}/auth/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
            },
            body: JSON.stringify(userData),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Cập nhật thất bại')
        return data
    },
    async getBox(params = {}) {
        const query = new URLSearchParams(params).toString()
        const res = await fetch(`${API_URL}/box?${query}`, {
            headers: { ...authHeaders() },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message || 'Không thể tải hộp Pokemon')
        return data
    },
}
