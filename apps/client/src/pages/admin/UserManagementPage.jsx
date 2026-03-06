import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { userApi } from '../../services/adminApi'
import { ADMIN_PERMISSION_OPTIONS } from '../../constants/adminPermissions'

const DEFAULT_POKEMON_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const DEFAULT_ITEM_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

export default function UserManagementPage() {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState(null)
    const [selectedUserIds, setSelectedUserIds] = useState([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [updatingRoleUserId, setUpdatingRoleUserId] = useState(null)
    const [updatingPermissionUserId, setUpdatingPermissionUserId] = useState(null)
    const [grantModal, setGrantModal] = useState({ type: '', user: null })
    const [grantError, setGrantError] = useState('')
    const [granting, setGranting] = useState(false)

    const [pokemonLookup, setPokemonLookup] = useState([])
    const [pokemonLookupLoading, setPokemonLookupLoading] = useState(false)
    const [pokemonForm, setPokemonForm] = useState({
        search: '',
        pokemonId: '',
        level: 5,
        quantity: 1,
        formId: 'normal',
        isShiny: false,
    })

    const [itemLookup, setItemLookup] = useState([])
    const [itemLookupLoading, setItemLookupLoading] = useState(false)
    const [itemForm, setItemForm] = useState({
        search: '',
        itemId: '',
        quantity: 1,
    })

    useEffect(() => {
        loadUsers()
    }, [page, search])

    useEffect(() => {
        if (grantModal.type !== 'pokemon') return
        const timer = setTimeout(() => {
            loadPokemonLookup(pokemonForm.search)
        }, 220)
        return () => clearTimeout(timer)
    }, [grantModal.type, pokemonForm.search])

    useEffect(() => {
        if (grantModal.type !== 'item') return
        const timer = setTimeout(() => {
            loadItemLookup(itemForm.search)
        }, 220)
        return () => clearTimeout(timer)
    }, [grantModal.type, itemForm.search])

    useEffect(() => {
        if (grantModal.type !== 'pokemon') return
        const selectedPokemon = pokemonLookup.find((entry) => entry._id === pokemonForm.pokemonId)
        if (!selectedPokemon) return

        const forms = Array.isArray(selectedPokemon.forms) ? selectedPokemon.forms : []
        if (forms.length === 0) return

        const hasSelectedForm = forms.some((form) => String(form.formId || '').toLowerCase() === String(pokemonForm.formId || '').toLowerCase())
        if (!hasSelectedForm) {
            const nextFormId = selectedPokemon.defaultFormId || forms[0].formId || 'normal'
            setPokemonForm((prev) => ({ ...prev, formId: nextFormId }))
        }
    }, [grantModal.type, pokemonLookup, pokemonForm.pokemonId])

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
            alert('Cập nhật vai trò thất bại: ' + err.message)
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
            alert('Cập nhật quyền thất bại: ' + err.message)
        } finally {
            setUpdatingPermissionUserId(null)
        }
    }

    const handleSearchChange = (e) => {
        setSearch(e.target.value)
        setPage(1)
        setSelectedUserIds([])
    }

    const toggleUserSelection = (userId, checked) => {
        const normalizedId = String(userId || '').trim()
        if (!normalizedId) return

        setSelectedUserIds((prev) => {
            const set = new Set(prev)
            if (checked) {
                set.add(normalizedId)
            } else {
                set.delete(normalizedId)
            }
            return [...set]
        })
    }

    const toggleSelectCurrentPage = (checked) => {
        const pageIds = users.map((user) => String(user._id || '').trim()).filter(Boolean)
        setSelectedUserIds((prev) => {
            const set = new Set(prev)
            if (checked) {
                pageIds.forEach((id) => set.add(id))
            } else {
                pageIds.forEach((id) => set.delete(id))
            }
            return [...set]
        })
    }

    const handleBulkDelete = async () => {
        if (selectedUserIds.length === 0) return

        const confirmed = confirm(`Xóa ${selectedUserIds.length} tài khoản đã chọn? Thao tác này sẽ xóa luôn dữ liệu người chơi liên quan.`)
        if (!confirmed) return

        try {
            setBulkDeleting(true)
            const res = await userApi.bulkDelete(selectedUserIds)
            alert(res?.message || 'Đã xóa tài khoản thành công')
            setSelectedUserIds([])

            if (users.length === selectedUserIds.length && page > 1) {
                setPage((prev) => Math.max(1, prev - 1))
            } else {
                await loadUsers()
            }
        } catch (err) {
            alert('Xóa tài khoản thất bại: ' + (err.message || 'Lỗi không xác định'))
        } finally {
            setBulkDeleting(false)
        }
    }

    const loadPokemonLookup = async (searchText = '') => {
        try {
            setPokemonLookupLoading(true)
            const res = await userApi.lookupPokemon({ search: searchText, limit: 500 })
            const rows = Array.isArray(res?.pokemon) ? res.pokemon : []
            setPokemonLookup(rows)

            setPokemonForm((prev) => {
                if (prev.pokemonId && rows.some((entry) => entry._id === prev.pokemonId)) {
                    return prev
                }
                if (rows.length === 0) {
                    return { ...prev, pokemonId: '', formId: 'normal' }
                }
                const first = rows[0]
                return {
                    ...prev,
                    pokemonId: first._id,
                    formId: first.defaultFormId || first.forms?.[0]?.formId || 'normal',
                }
            })
        } catch (err) {
            setGrantError(err.message || 'Không thể tải danh sách pokemon')
        } finally {
            setPokemonLookupLoading(false)
        }
    }

    const loadItemLookup = async (searchText = '') => {
        try {
            setItemLookupLoading(true)
            const res = await userApi.lookupItems({ search: searchText, limit: 30 })
            const rows = Array.isArray(res?.items) ? res.items : []
            setItemLookup(rows)

            setItemForm((prev) => {
                if (prev.itemId && rows.some((entry) => entry._id === prev.itemId)) {
                    return prev
                }
                return { ...prev, itemId: rows[0]?._id || '' }
            })
        } catch (err) {
            setGrantError(err.message || 'Không thể tải danh sách vật phẩm')
        } finally {
            setItemLookupLoading(false)
        }
    }

    const openPokemonGrantModal = (user) => {
        setGrantError('')
        setGrantModal({ type: 'pokemon', user })
        setPokemonLookup([])
        setPokemonForm({
            search: '',
            pokemonId: '',
            level: 5,
            quantity: 1,
            formId: 'normal',
            isShiny: false,
        })
    }

    const openItemGrantModal = (user) => {
        setGrantError('')
        setGrantModal({ type: 'item', user })
        setItemLookup([])
        setItemForm({ search: '', itemId: '', quantity: 1 })
    }

    const closeGrantModal = () => {
        if (granting) return
        setGrantModal({ type: '', user: null })
        setGrantError('')
    }

    const handleGrantPokemon = async () => {
        if (!grantModal?.user?._id || !pokemonForm.pokemonId) return
        try {
            setGrantError('')
            setGranting(true)
            const payload = {
                pokemonId: pokemonForm.pokemonId,
                level: Number(pokemonForm.level) || 5,
                quantity: Number(pokemonForm.quantity) || 1,
                formId: pokemonForm.formId || 'normal',
                isShiny: Boolean(pokemonForm.isShiny),
            }
            const res = await userApi.grantPokemon(grantModal.user._id, payload)
            alert(res?.message || 'Đã thêm pokemon thành công')
            closeGrantModal()
        } catch (err) {
            setGrantError(err.message || 'Không thể thêm pokemon')
        } finally {
            setGranting(false)
        }
    }

    const handleGrantItem = async () => {
        if (!grantModal?.user?._id || !itemForm.itemId) return
        try {
            setGrantError('')
            setGranting(true)
            const payload = {
                itemId: itemForm.itemId,
                quantity: Number(itemForm.quantity) || 1,
            }
            const res = await userApi.grantItem(grantModal.user._id, payload)
            alert(res?.message || 'Đã thêm vật phẩm thành công')
            closeGrantModal()
        } catch (err) {
            setGrantError(err.message || 'Không thể thêm vật phẩm')
        } finally {
            setGranting(false)
        }
    }

    if (loading && users.length === 0) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải...</div>
    }

    const selectedPokemon = pokemonLookup.find((entry) => entry._id === pokemonForm.pokemonId) || null
    const selectedPokemonForms = selectedPokemon && Array.isArray(selectedPokemon.forms) && selectedPokemon.forms.length > 0
        ? selectedPokemon.forms
        : [{ formId: selectedPokemon?.defaultFormId || 'normal', formName: selectedPokemon?.defaultFormId || 'normal' }]
    const selectedItem = itemLookup.find((entry) => entry._id === itemForm.itemId) || null
    const selectedIdSet = new Set(selectedUserIds)
    const selectedOnCurrentPageCount = users.reduce((count, user) => {
        return count + (selectedIdSet.has(String(user._id || '').trim()) ? 1 : 0)
    }, 0)
    const allCurrentPageSelected = users.length > 0 && selectedOnCurrentPageCount === users.length

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Quản lý User và Phân quyền Admin</h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Tổng số: <span className="font-bold text-blue-600">{pagination?.total || 0}</span> users
                    </p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                >
                    Quay lại
                </Link>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <input
                    type="text"
                    placeholder="Tìm kiếm theo email hoặc username..."
                    value={search}
                    onChange={handleSearchChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                        Đã chọn: <span className="font-bold text-blue-700">{selectedUserIds.length}</span> tài khoản
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setSelectedUserIds([])}
                            disabled={selectedUserIds.length === 0 || bulkDeleting}
                            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Bỏ chọn
                        </button>
                        <button
                            type="button"
                            onClick={handleBulkDelete}
                            disabled={selectedUserIds.length === 0 || bulkDeleting}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {bulkDeleting ? 'Đang xóa...' : `Xóa hàng loạt (${selectedUserIds.length})`}
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3 text-xs text-blue-800">
                Mỗi module trong Admin Center có thể bật/tắt riêng cho từng admin.
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-blue-200 flex flex-col w-full max-w-full overflow-x-auto overscroll-x-contain">
                <div className="overflow-auto max-h-[65vh] custom-scrollbar w-full">
                    <table className="w-full text-sm min-w-[980px] lg:min-w-[1280px]">
                        <thead className="bg-slate-50 text-slate-700 uppercase text-xs tracking-wider border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-4 py-3 text-center font-bold w-14">
                                    <input
                                        type="checkbox"
                                        checked={allCurrentPageSelected}
                                        onChange={(e) => toggleSelectCurrentPage(e.target.checked)}
                                        disabled={users.length === 0 || bulkDeleting}
                                        className="accent-blue-600"
                                        title="Chọn tất cả tài khoản trong trang hiện tại"
                                    />
                                </th>
                                <th className="px-4 py-3 text-left font-bold min-w-[180px] sm:min-w-[220px]">Email</th>
                                <th className="px-4 py-3 text-left font-bold min-w-[140px] sm:min-w-[180px]">Username</th>
                                <th className="px-4 py-3 text-center font-bold whitespace-nowrap">Role</th>
                                <th className="px-4 py-3 text-left font-bold min-w-[250px] sm:min-w-[320px]">Admin Modules</th>
                                <th className="px-4 py-3 text-center font-bold min-w-[180px]">Trao thưởng</th>
                                <th className="px-4 py-3 text-center font-bold whitespace-nowrap">Ngày tạo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {users.map((user) => {
                                const roleUpdating = updatingRoleUserId === user._id
                                const permissionUpdating = updatingPermissionUserId === user._id
                                const isAdmin = user.role === 'admin'
                                const userPermissions = Array.isArray(user.adminPermissions) ? user.adminPermissions : []
                                const normalizedUserId = String(user._id || '').trim()
                                const isSelected = selectedIdSet.has(normalizedUserId)

                                return (
                                    <tr key={user._id} className="hover:bg-blue-50/30 transition-colors align-top">
                                        <td className="px-4 py-3 text-center">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => toggleUserSelection(normalizedUserId, e.target.checked)}
                                                disabled={bulkDeleting}
                                                className="accent-blue-600"
                                            />
                                        </td>
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
                                                <span className="text-xs text-slate-400">Không áp dụng</span>
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
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => openPokemonGrantModal(user)}
                                                    className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm"
                                                >
                                                    Pokemon
                                                </button>
                                                <button
                                                    onClick={() => openItemGrantModal(user)}
                                                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm"
                                                >
                                                    Vật phẩm
                                                </button>
                                            </div>
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

            {grantModal.type && grantModal.user && (
                <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-xl rounded-lg border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">
                                    {grantModal.type === 'pokemon' ? 'Thêm Pokemon cho người chơi' : 'Thêm vật phẩm cho người chơi'}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Mục tiêu: <span className="font-bold text-blue-700">{grantModal.user.username || grantModal.user.email}</span>
                                </p>
                            </div>
                            <button
                                onClick={closeGrantModal}
                                disabled={granting}
                                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {grantError && (
                                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm font-medium">
                                    {grantError}
                                </div>
                            )}

                            {grantModal.type === 'pokemon' ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Tìm Pokemon</label>
                                        <input
                                            type="text"
                                            value={pokemonForm.search}
                                            onChange={(e) => setPokemonForm((prev) => ({ ...prev, search: e.target.value }))}
                                            placeholder="Nhập tên hoặc số Pokedex"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div className="border border-slate-200 rounded-md max-h-56 overflow-y-auto">
                                        {pokemonLookupLoading ? (
                                            <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải Pokemon...</div>
                                        ) : pokemonLookup.length === 0 ? (
                                            <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokemon</div>
                                        ) : (
                                            pokemonLookup.map((entry) => {
                                                const forms = Array.isArray(entry.forms) && entry.forms.length > 0
                                                    ? entry.forms
                                                    : [{ formId: entry.defaultFormId || 'normal', formName: entry.defaultFormId || 'normal' }]

                                                return (
                                                    <button
                                                        type="button"
                                                        key={entry._id}
                                                        onClick={() => setPokemonForm((prev) => ({
                                                            ...prev,
                                                            pokemonId: entry._id,
                                                            formId: entry.defaultFormId || entry.forms?.[0]?.formId || 'normal',
                                                        }))}
                                                        className={`w-full px-3 py-2 border-b border-slate-100 text-left flex items-center gap-3 hover:bg-blue-50 ${pokemonForm.pokemonId === entry._id ? 'bg-blue-50' : ''}`}
                                                    >
                                                        <img
                                                            src={entry.sprite || DEFAULT_POKEMON_IMAGE}
                                                            alt={entry.name}
                                                            className="w-10 h-10 object-contain pixelated"
                                                            onError={(e) => {
                                                                e.currentTarget.onerror = null
                                                                e.currentTarget.src = DEFAULT_POKEMON_IMAGE
                                                            }}
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="font-bold text-slate-800 truncate">{entry.name}</div>
                                                            <div className="text-xs text-slate-500 font-mono">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</div>
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {forms.slice(0, 4).map((form) => (
                                                                    <span
                                                                        key={`${entry._id}-${form.formId}`}
                                                                        className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                                                    >
                                                                        {form.formName || form.formId}
                                                                    </span>
                                                                ))}
                                                                {forms.length > 4 && (
                                                                    <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                                                                        +{forms.length - 4} dạng
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </button>
                                                )
                                            })
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-bold text-slate-700 mb-1">Form</label>
                                            <select
                                                value={pokemonForm.formId}
                                                onChange={(e) => setPokemonForm((prev) => ({ ...prev, formId: e.target.value }))}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                {selectedPokemonForms.map((form) => (
                                                    <option key={form.formId} value={form.formId}>
                                                        {form.formName || form.formId}
                                                        {form.formName && form.formName !== form.formId ? ` (${form.formId})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-700 mb-1">Level</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={pokemonForm.level}
                                                onChange={(e) => setPokemonForm((prev) => ({ ...prev, level: e.target.value }))}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-slate-700 mb-1">Số lượng</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={pokemonForm.quantity}
                                                onChange={(e) => setPokemonForm((prev) => ({ ...prev, quantity: e.target.value }))}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 mt-6">
                                            <input
                                                id="grant-shiny"
                                                type="checkbox"
                                                checked={pokemonForm.isShiny}
                                                onChange={(e) => setPokemonForm((prev) => ({ ...prev, isShiny: e.target.checked }))}
                                                className="accent-blue-600"
                                            />
                                            <label htmlFor="grant-shiny" className="text-sm font-semibold text-slate-700">Shiny</label>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={handleGrantPokemon}
                                            disabled={granting || !pokemonForm.pokemonId}
                                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold disabled:opacity-50"
                                        >
                                            {granting ? 'Đang thêm...' : 'Thêm Pokemon'}
                                        </button>
                                        <button
                                            onClick={closeGrantModal}
                                            disabled={granting}
                                            className="flex-1 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold disabled:opacity-50"
                                        >
                                            Hủy
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Tìm vật phẩm</label>
                                        <input
                                            type="text"
                                            value={itemForm.search}
                                            onChange={(e) => setItemForm((prev) => ({ ...prev, search: e.target.value }))}
                                            placeholder="Nhập tên vật phẩm"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>

                                    <div className="border border-slate-200 rounded-md max-h-56 overflow-y-auto">
                                        {itemLookupLoading ? (
                                            <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải vật phẩm...</div>
                                        ) : itemLookup.length === 0 ? (
                                            <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy vật phẩm</div>
                                        ) : (
                                            itemLookup.map((entry) => (
                                                <button
                                                    type="button"
                                                    key={entry._id}
                                                    onClick={() => setItemForm((prev) => ({ ...prev, itemId: entry._id }))}
                                                    className={`w-full px-3 py-2 border-b border-slate-100 text-left flex items-center gap-3 hover:bg-emerald-50 ${itemForm.itemId === entry._id ? 'bg-emerald-50' : ''}`}
                                                >
                                                    <img
                                                        src={entry.imageUrl || DEFAULT_ITEM_IMAGE}
                                                        alt={entry.name}
                                                        className="w-8 h-8 object-contain"
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null
                                                            e.currentTarget.src = DEFAULT_ITEM_IMAGE
                                                        }}
                                                    />
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-slate-800 truncate">{entry.name}</div>
                                                        <div className="text-xs text-slate-500">{entry.type} • {entry.rarity}</div>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-bold text-slate-700 mb-1">Số lượng</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="99999"
                                                value={itemForm.quantity}
                                                onChange={(e) => setItemForm((prev) => ({ ...prev, quantity: e.target.value }))}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm">
                                            <span className="text-slate-500">Đã chọn:</span>{' '}
                                            <span className="font-bold text-slate-800">{selectedItem?.name || 'Chưa chọn'}</span>
                                        </div>
                                    </div>

                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={handleGrantItem}
                                            disabled={granting || !itemForm.itemId}
                                            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold disabled:opacity-50"
                                        >
                                            {granting ? 'Đang thêm...' : 'Thêm vật phẩm'}
                                        </button>
                                        <button
                                            onClick={closeGrantModal}
                                            disabled={granting}
                                            className="flex-1 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold disabled:opacity-50"
                                        >
                                            Hủy
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="text-center mt-6 p-4">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>
        </div>
    )
}
