const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
import { clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const getAuthHeader = () => {
    const token = getValidTokenFromStorage()
    return token ? { Authorization: `Bearer ${token}` } : {}
}

const throwApiError = async (res, fallbackMessage) => {
    let payload = null
    try {
        payload = await res.json()
    } catch (_error) {
        payload = null
    }

    const message = payload?.message || fallbackMessage
    if (res.status === 401) {
        clearAuthSession(message || 'Phiên đăng nhập không hợp lệ')
    }

    throw new Error(message)
}

const friendsApi = {
    async getFriends() {
        const res = await fetch(`${API_URL}/friends`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải danh sách bạn bè')
        }
        return res.json()
    },

    async getRequests() {
        const res = await fetch(`${API_URL}/friends/requests`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải lời mời kết bạn')
        }
        return res.json()
    },

    async getSuggestions(limit = 8) {
        const searchParams = new URLSearchParams({ limit: String(limit) })
        const res = await fetch(`${API_URL}/friends/suggestions?${searchParams.toString()}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải đề xuất người chơi')
        }
        return res.json()
    },

    async getTrainerProfile(userId) {
        const normalizedUserId = String(userId || '').trim()
        if (!normalizedUserId) {
            throw new Error('Thiếu userId để xem hồ sơ')
        }

        const res = await fetch(`${API_URL}/friends/profile/${encodeURIComponent(normalizedUserId)}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tải hồ sơ người chơi')
        }
        return res.json()
    },

    async searchUsers(query, limit = 15) {
        const q = String(query || '').trim()
        if (!q) return { ok: true, users: [] }

        const searchParams = new URLSearchParams({ q, limit: String(limit) })
        const res = await fetch(`${API_URL}/friends/search?${searchParams.toString()}`, {
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể tìm người chơi')
        }
        return res.json()
    },

    async sendRequest(userId) {
        const res = await fetch(`${API_URL}/friends/requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
            },
            body: JSON.stringify({ userId }),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể gửi lời mời kết bạn')
        }
        return res.json()
    },

    async acceptRequest(requestId) {
        const normalizedRequestId = String(requestId || '').trim()
        const res = await fetch(`${API_URL}/friends/requests/${encodeURIComponent(normalizedRequestId)}/accept`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể chấp nhận lời mời kết bạn')
        }
        return res.json()
    },

    async rejectRequest(requestId) {
        const normalizedRequestId = String(requestId || '').trim()
        const res = await fetch(`${API_URL}/friends/requests/${encodeURIComponent(normalizedRequestId)}/reject`, {
            method: 'POST',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể từ chối lời mời kết bạn')
        }
        return res.json()
    },

    async cancelRequest(requestId) {
        const normalizedRequestId = String(requestId || '').trim()
        const res = await fetch(`${API_URL}/friends/requests/${encodeURIComponent(normalizedRequestId)}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể hủy lời mời kết bạn')
        }
        return res.json()
    },

    async removeFriend(friendUserId) {
        const normalizedFriendUserId = String(friendUserId || '').trim()
        const res = await fetch(`${API_URL}/friends/${encodeURIComponent(normalizedFriendUserId)}`, {
            method: 'DELETE',
            headers: getAuthHeader(),
        })
        if (!res.ok) {
            await throwApiError(res, 'Không thể xóa bạn bè')
        }
        return res.json()
    },
}

export { friendsApi }
