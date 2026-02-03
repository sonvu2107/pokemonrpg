import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { userApi } from '../../services/adminApi'

export default function UserManagementPage() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState(null)

    const [updatingUserId, setUpdatingUserId] = useState(null)

    useEffect(() => {
        loadUsers()
    }, [page, search])

    const loadUsers = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await userApi.list({ search, page, limit: 20 })
            setUsers(data.users)
            setPagination(data.pagination)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleRoleChange = async (userId, newRole) => {
        try {
            setUpdatingUserId(userId)
            await userApi.updateRole(userId, newRole)
            // Update local state
            setUsers(users.map(u => u._id === userId ? { ...u, role: newRole } : u))
        } catch (err) {
            alert('Thất bại: ' + err.message)
        } finally {
            setUpdatingUserId(null)
        }
    }

    const handleSearchChange = (e) => {
        setSearch(e.target.value)
        setPage(1) // Reset to first page on search
    }

    if (loading && users.length === 0) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải...</div>
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                        </svg>
                        Quản lý User
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Tổng số: <span className="font-bold text-blue-600">{pagination?.total || 0}</span> users
                    </p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Quay lại
                </Link>
            </div>

            {/* Search Bar */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div className="relative">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Tìm kiếm theo email hoặc username..."
                        value={search}
                        onChange={handleSearchChange}
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md">
                    {error}
                </div>
            )}

            {/* User Table */}
            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-700 uppercase text-xs tracking-wider border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-3 text-left font-bold">Email</th>
                                <th className="px-6 py-3 text-left font-bold">Username</th>
                                <th className="px-6 py-3 text-center font-bold">Role</th>
                                <th className="px-6 py-3 text-center font-bold">Ngày tạo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {users.map((user) => (
                                <tr key={user._id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-6 py-3">
                                        <div className="font-medium text-slate-800">{user.email}</div>
                                    </td>
                                    <td className="px-6 py-3">
                                        <div className="text-slate-600">{user.username || '-'}</div>
                                    </td>
                                    <td className="px-6 py-3 text-center">
                                        <select
                                            value={user.role}
                                            onChange={(e) => handleRoleChange(user._id, e.target.value)}
                                            disabled={updatingUserId === user._id}
                                            className={`px-3 py-1 rounded-md text-xs font-bold border-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${user.role === 'admin'
                                                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                                                    : 'bg-slate-100 text-slate-700 border-slate-300'
                                                } ${updatingUserId === user._id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-95'}`}
                                        >
                                            <option value="user">User</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-3 text-center text-slate-500 text-xs">
                                        {new Date(user.createdAt).toLocaleDateString('vi-VN')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination && pagination.pages > 1 && (
                    <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
                        <div className="text-xs text-slate-500">
                            Trang {pagination.page} / {pagination.pages}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1}
                                className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Trước
                            </button>
                            <button
                                onClick={() => setPage(page + 1)}
                                disabled={page >= pagination.pages}
                                className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Sau
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
