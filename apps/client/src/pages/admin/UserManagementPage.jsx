import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { userApi } from '../../services/adminApi'
import { ADMIN_PERMISSION_OPTIONS } from '../../constants/adminPermissions'

export default function UserManagementPage() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState(null)
    const [updatingRoleUserId, setUpdatingRoleUserId] = useState(null)
    const [updatingPermissionUserId, setUpdatingPermissionUserId] = useState(null)

    useEffect(() => {
        loadUsers()
    }, [page, search])

    const loadUsers = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await userApi.list({ search, page, limit: 20 })
            setUsers(data.users || [])
            setPagination(data.pagination)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const updateUserInState = (updatedUser) => {
        setUsers((prev) => prev.map((user) => (user._id === updatedUser._id ? { ...user, ...updatedUser } : user)))
    }

    const handleRoleChange = async (userId, newRole) => {
        try {
            setUpdatingRoleUserId(userId)
            const res = await userApi.updateRole(userId, newRole)
            if (res?.user) {
                updateUserInState(res.user)
            }
        } catch (err) {
            alert('Cap nhat role that bai: ' + err.message)
        } finally {
            setUpdatingRoleUserId(null)
        }
    }

    const handlePermissionToggle = async (user, permission, checked) => {
        const currentPermissions = Array.isArray(user.adminPermissions) ? user.adminPermissions : []
        const nextPermissions = checked
            ? [...new Set([...currentPermissions, permission])]
            : currentPermissions.filter((item) => item !== permission)

        try {
            setUpdatingPermissionUserId(user._id)
            const res = await userApi.updatePermissions(user._id, nextPermissions)
            if (res?.user) {
                updateUserInState(res.user)
            }
        } catch (err) {
            alert('Cap nhat quyen that bai: ' + err.message)
        } finally {
            setUpdatingPermissionUserId(null)
        }
    }

    const handleSearchChange = (e) => {
        setSearch(e.target.value)
        setPage(1)
    }

    if (loading && users.length === 0) {
        return <div className="text-center py-8 text-blue-800 font-medium">Dang tai...</div>
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Quan ly User va Phan quyen Admin</h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Tong so: <span className="font-bold text-blue-600">{pagination?.total || 0}</span> users
                    </p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                >
                    Quay lai
                </Link>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <input
                    type="text"
                    placeholder="Tim kiem theo email hoac username..."
                    value={search}
                    onChange={handleSearchChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-xs text-blue-800">
                Moi module trong Admin Center co the bat/tat rieng cho tung admin.
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden flex flex-col">
                <div className="overflow-auto max-h-[65vh] custom-scrollbar">
                    <table className="w-full text-sm min-w-[1100px]">
                        <thead className="bg-slate-50 text-slate-700 uppercase text-xs tracking-wider border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 text-left font-bold">Email</th>
                                <th className="px-4 py-3 text-left font-bold">Username</th>
                                <th className="px-4 py-3 text-center font-bold">Role</th>
                                <th className="px-4 py-3 text-left font-bold">Admin Modules</th>
                                <th className="px-4 py-3 text-center font-bold">Ngay tao</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {users.map((user) => {
                                const roleUpdating = updatingRoleUserId === user._id
                                const permissionUpdating = updatingPermissionUserId === user._id
                                const isAdmin = user.role === 'admin'
                                const userPermissions = Array.isArray(user.adminPermissions) ? user.adminPermissions : []

                                return (
                                    <tr key={user._id} className="hover:bg-blue-50/30 transition-colors align-top">
                                        <td className="px-4 py-3 font-medium text-slate-800">{user.email}</td>
                                        <td className="px-4 py-3 text-slate-600">{user.username || '-'}</td>
                                        <td className="px-4 py-3 text-center">
                                            <select
                                                value={user.role}
                                                onChange={(e) => handleRoleChange(user._id, e.target.value)}
                                                disabled={roleUpdating}
                                                className={`px-3 py-1 rounded-md text-xs font-bold border-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${user.role === 'admin'
                                                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                                                    : 'bg-slate-100 text-slate-700 border-slate-300'
                                                    } ${roleUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-95'}`}
                                            >
                                                <option value="user">User</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </td>
                                        <td className="px-4 py-3">
                                            {!isAdmin ? (
                                                <span className="text-xs text-slate-400">Khong ap dung</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {ADMIN_PERMISSION_OPTIONS.map((option) => {
                                                        const checked = userPermissions.includes(option.key)
                                                        return (
                                                            <label
                                                                key={option.key}
                                                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${checked
                                                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                                                    : 'bg-white border-slate-200 text-slate-600'} ${permissionUpdating ? 'opacity-60' : ''}`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    disabled={permissionUpdating}
                                                                    onChange={(e) => handlePermissionToggle(user, option.key, e.target.checked)}
                                                                    className="accent-blue-600"
                                                                />
                                                                <span className="font-semibold">{option.label}</span>
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center text-slate-500 text-xs">
                                            {new Date(user.createdAt).toLocaleDateString('vi-VN')}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

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
                                Truoc
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
