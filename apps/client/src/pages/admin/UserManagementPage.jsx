import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { userApi, vipTierApi } from '../../services/adminApi'
import { ADMIN_PERMISSION_OPTIONS } from '../../constants/adminPermissions'

const DEFAULT_POKEMON_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const DEFAULT_ITEM_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

const toLocalDateTimeInputValue = (value) => {
    const date = value ? new Date(value) : new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
    if (Number.isNaN(date.getTime())) return ''
    const offsetMs = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const createDefaultVipBenefitForm = () => ({
    vipTierId: '',
    vipExpiresAt: toLocalDateTimeInputValue(),
    title: '',
    titleImageUrl: '',
    avatarFrameUrl: '',
    autoSearchEnabled: true,
    autoSearchDurationMinutes: 0,
    autoSearchUsesPerDay: 0,
    autoBattleTrainerEnabled: true,
    autoBattleTrainerDurationMinutes: 0,
    autoBattleTrainerUsesPerDay: 0,
})

const normalizeVipBenefitFormFromUser = (userLike) => {
    const base = createDefaultVipBenefitForm()
    const source = userLike?.vipBenefits && typeof userLike.vipBenefits === 'object'
        ? userLike.vipBenefits
        : {}
    return {
        vipTierId: String(userLike?.vipTierId || base.vipTierId).trim(),
        vipExpiresAt: toLocalDateTimeInputValue(userLike?.vipExpiresAt),
        title: String(source.title || base.title).trim().slice(0, 80),
        titleImageUrl: String(source.titleImageUrl || base.titleImageUrl).trim(),
        avatarFrameUrl: String(source.avatarFrameUrl || base.avatarFrameUrl).trim(),
        autoSearchEnabled: source.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

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
    const [updatingBanUserId, setUpdatingBanUserId] = useState(null)
    const [updatingVipBenefitUserId, setUpdatingVipBenefitUserId] = useState(null)
    const [assigningVipTierUserId, setAssigningVipTierUserId] = useState(null)
    const [quickVipTierByUserId, setQuickVipTierByUserId] = useState({})
    const [grantModal, setGrantModal] = useState({ type: '', user: null })
    const [grantError, setGrantError] = useState('')
    const [granting, setGranting] = useState(false)
    const [vipTiers, setVipTiers] = useState([])
    const [vipBenefitModal, setVipBenefitModal] = useState({
        open: false,
        user: null,
        form: createDefaultVipBenefitForm(),
        error: '',
        submitting: false,
    })
    const [ipBans, setIpBans] = useState([])
    const [ipBanLoading, setIpBanLoading] = useState(false)
    const [ipBanError, setIpBanError] = useState('')
    const [banIpForm, setBanIpForm] = useState({
        ip: '',
        reason: '',
        durationHours: '',
    })
    const [accountBanModal, setAccountBanModal] = useState({
        open: false,
        user: null,
        reason: '',
        durationHours: '',
        error: '',
        submitting: false,
    })

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
        loadIpBans()
    }, [])

    useEffect(() => {
        loadVipTiers()
    }, [])

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

    const isUserCurrentlyBanned = (user) => {
        if (!user?.isBanned) return false
        if (!user?.bannedUntil) return true
        const banUntilMs = new Date(user.bannedUntil).getTime()
        if (!Number.isFinite(banUntilMs)) return true
        return banUntilMs > Date.now()
    }

    const formatDateTime = (value) => {
        if (!value) return '--'
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return '--'
        return date.toLocaleString('vi-VN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    const loadIpBans = async () => {
        try {
            setIpBanLoading(true)
            setIpBanError('')
            const res = await userApi.listIpBans({ limit: 50, page: 1 })
            setIpBans(Array.isArray(res?.ipBans) ? res.ipBans : [])
        } catch (err) {
            setIpBanError(err.message || 'Không thể tải danh sách IP bị chặn')
            setIpBans([])
        } finally {
            setIpBanLoading(false)
        }
    }

    const loadVipTiers = async () => {
        try {
            const res = await vipTierApi.list({ active: 'true' })
            setVipTiers(Array.isArray(res?.vipTiers) ? res.vipTiers : [])
        } catch (_err) {
            setVipTiers([])
        }
    }

    const updateUserInState = (updatedUser) => {
        setUsers((prev) => prev.map((user) => (user._id === updatedUser._id ? { ...user, ...updatedUser } : user)))
    }

    const resolveVipTierIdForUser = (userLike) => {
        const directTierId = String(userLike?.vipTierId || '').trim()
        if (directTierId) return directTierId

        const level = Number(userLike?.vipTierLevel || 0)
        if (level <= 0) return ''

        const tierByLevel = vipTiers.find((entry) => Number(entry?.level || 0) === level)
        return String(tierByLevel?._id || '').trim()
    }

    const openVipBenefitModal = (user) => {
        const normalizedUserTierId = String(user?.vipTierId || '').trim()
        const tierByLevel = vipTiers.find((entry) => Number(entry?.level || 0) === Number(user?.vipTierLevel || 0))
        const resolvedTierId = normalizedUserTierId || String(tierByLevel?._id || '').trim()
        const normalizedForm = normalizeVipBenefitFormFromUser({
            ...user,
            vipTierId: resolvedTierId,
        })

        setVipBenefitModal({
            open: true,
            user,
            form: normalizedForm,
            error: '',
            submitting: false,
        })
    }

    const closeVipBenefitModal = (force = false) => {
        if (!force && vipBenefitModal.submitting) return
        setVipBenefitModal({
            open: false,
            user: null,
            form: createDefaultVipBenefitForm(),
            error: '',
            submitting: false,
        })
    }

    const updateVipBenefitFormField = (field, value) => {
        setVipBenefitModal((prev) => ({
            ...prev,
            error: '',
            form: {
                ...prev.form,
                [field]: value,
            },
        }))
    }

    const submitVipBenefitModal = async () => {
        const targetUser = vipBenefitModal.user
        if (!targetUser?._id) return

        try {
            setVipBenefitModal((prev) => ({ ...prev, submitting: true, error: '' }))
            setUpdatingVipBenefitUserId(targetUser._id)

            const selectedTierId = String(vipBenefitModal.form.vipTierId || '').trim()
            if (!selectedTierId) {
                throw new Error('Vui lòng chọn cấp VIP cho người dùng (ví dụ VIP 1 - VIP 10).')
            }

            const tierRes = await userApi.updateVipTier(targetUser._id, {
                tierId: selectedTierId,
                expiresAt: String(vipBenefitModal.form.vipExpiresAt || '').trim(),
                applyBenefits: true,
            })
            const tierUpdatedUser = tierRes?.user || null
            if (tierUpdatedUser) {
                updateUserInState(tierUpdatedUser)
            }

            const payload = {
                title: String(vipBenefitModal.form.title || '').trim(),
                titleImageUrl: String(vipBenefitModal.form.titleImageUrl || '').trim(),
                avatarFrameUrl: String(vipBenefitModal.form.avatarFrameUrl || '').trim(),
                autoSearchEnabled: Boolean(vipBenefitModal.form.autoSearchEnabled),
                autoSearchDurationMinutes: Math.max(0, parseInt(vipBenefitModal.form.autoSearchDurationMinutes, 10) || 0),
                autoSearchUsesPerDay: Math.max(0, parseInt(vipBenefitModal.form.autoSearchUsesPerDay, 10) || 0),
                autoBattleTrainerEnabled: Boolean(vipBenefitModal.form.autoBattleTrainerEnabled),
                autoBattleTrainerDurationMinutes: Math.max(0, parseInt(vipBenefitModal.form.autoBattleTrainerDurationMinutes, 10) || 0),
                autoBattleTrainerUsesPerDay: Math.max(0, parseInt(vipBenefitModal.form.autoBattleTrainerUsesPerDay, 10) || 0),
            }

            const res = await userApi.updateVipBenefits(targetUser._id, payload)
            if (res?.user) {
                updateUserInState(res.user)
            }
            closeVipBenefitModal(true)
        } catch (err) {
            setVipBenefitModal((prev) => ({
                ...prev,
                submitting: false,
                error: err.message || 'Không thể cập nhật quyền lợi VIP',
            }))
        } finally {
            setUpdatingVipBenefitUserId(null)
        }
    }

    const handleQuickVipTierChange = (userId, tierId) => {
        const normalizedUserId = String(userId || '').trim()
        if (!normalizedUserId) return
        setQuickVipTierByUserId((prev) => ({
            ...prev,
            [normalizedUserId]: String(tierId || '').trim(),
        }))
    }

    const handleQuickAssignVipTier = async (user) => {
        const userId = String(user?._id || '').trim()
        if (!userId) return

        const selectedTierId = String(
            quickVipTierByUserId?.[userId]
            || resolveVipTierIdForUser(user)
            || ''
        ).trim()

        if (!selectedTierId) {
            alert('Vui lòng chọn cấp VIP trước khi set cho user.')
            return
        }

        try {
            setAssigningVipTierUserId(userId)
            const res = await userApi.updateVipTier(userId, {
                tierId: selectedTierId,
                applyBenefits: true,
            })

            if (res?.user) {
                updateUserInState(res.user)
            }
        } catch (err) {
            alert('Set VIP cho user thất bại: ' + (err.message || 'Lỗi không xác định'))
        } finally {
            setAssigningVipTierUserId(null)
        }
    }

    const handleRoleChange = async (userId, newRole) => {
        try {
            setUpdatingRoleUserId(userId)
            const res = await userApi.updateRole(userId, newRole)
            if (res?.user) {
                updateUserInState(res.user)
                if (vipBenefitModal.open && vipBenefitModal.user?._id === userId && !['vip', 'admin'].includes(newRole)) {
                    closeVipBenefitModal(true)
                }
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

    const openAccountBanModal = (user) => {
        setAccountBanModal({
            open: true,
            user,
            reason: user?.banReason || '',
            durationHours: '',
            error: '',
            submitting: false,
        })
    }

    const closeAccountBanModal = (force = false) => {
        if (!force && accountBanModal.submitting) return
        setAccountBanModal({
            open: false,
            user: null,
            reason: '',
            durationHours: '',
            error: '',
            submitting: false,
        })
    }

    const submitAccountBanModal = async () => {
        const targetUser = accountBanModal.user
        if (!targetUser?._id) return

        const durationRaw = String(accountBanModal.durationHours || '').trim()
        let bannedUntil = null
        if (durationRaw) {
            const parsedHours = Number.parseInt(durationRaw, 10)
            if (!Number.isFinite(parsedHours) || parsedHours < 1) {
                setAccountBanModal((prev) => ({
                    ...prev,
                    error: 'Số giờ khóa phải là số nguyên dương (hoặc để trống để khóa vĩnh viễn).',
                }))
                return
            }
            bannedUntil = new Date(Date.now() + parsedHours * 60 * 60 * 1000).toISOString()
        }

        try {
            setAccountBanModal((prev) => ({ ...prev, submitting: true, error: '' }))
            setUpdatingBanUserId(targetUser._id)

            const res = await userApi.updateBan(targetUser._id, {
                isBanned: true,
                reason: String(accountBanModal.reason || '').trim(),
                bannedUntil,
            })
            if (res?.user) {
                updateUserInState(res.user)
            }
            closeAccountBanModal(true)
        } catch (err) {
            setAccountBanModal((prev) => ({
                ...prev,
                submitting: false,
                error: err.message || 'Không thể khóa tài khoản',
            }))
        } finally {
            setUpdatingBanUserId(null)
        }
    }

    const handleToggleUserBan = async (user) => {
        const activeBan = isUserCurrentlyBanned(user)
        try {
            setUpdatingBanUserId(user._id)

            if (activeBan) {
                const confirmed = confirm(`Gỡ khóa tài khoản ${user.username || user.email}?`)
                if (!confirmed) return

                const res = await userApi.updateBan(user._id, { isBanned: false })
                if (res?.user) {
                    updateUserInState(res.user)
                }
                return
            }
            setUpdatingBanUserId(null)
            openAccountBanModal(user)
            return
        } catch (err) {
            alert('Cập nhật khóa tài khoản thất bại: ' + (err.message || 'Lỗi không xác định'))
        } finally {
            setUpdatingBanUserId(null)
        }
    }

    const handleBanIpFromUser = (user) => {
        const defaultIp = String(user?.lastLoginIp || '').trim()
        setBanIpForm((prev) => ({
            ...prev,
            ip: defaultIp,
            reason: prev.reason || `Chặn từ tài khoản ${user?.username || user?.email || ''}`.trim(),
        }))
    }

    const handleCreateIpBan = async () => {
        const ip = String(banIpForm.ip || '').trim()
        if (!ip) {
            alert('Vui lòng nhập IP cần chặn')
            return
        }

        const parsedHours = Number.parseInt(String(banIpForm.durationHours || '').trim(), 10)
        const hasDuration = Number.isFinite(parsedHours) && parsedHours > 0
        const expiresAt = hasDuration
            ? new Date(Date.now() + parsedHours * 60 * 60 * 1000).toISOString()
            : null

        try {
            setIpBanLoading(true)
            setIpBanError('')
            const res = await userApi.banIp({
                ip,
                reason: String(banIpForm.reason || '').trim(),
                expiresAt,
            })
            setBanIpForm({ ip: '', reason: '', durationHours: '' })
            alert(res?.message || 'Đã chặn IP thành công')
            await loadIpBans()
        } catch (err) {
            setIpBanError(err.message || 'Không thể chặn IP')
        } finally {
            setIpBanLoading(false)
        }
    }

    const handleUnbanIp = async (banId) => {
        const confirmed = confirm('Gỡ chặn IP này?')
        if (!confirmed) return

        try {
            setIpBanLoading(true)
            setIpBanError('')
            const res = await userApi.unbanIp(banId)
            alert(res?.message || 'Đã gỡ chặn IP')
            await loadIpBans()
        } catch (err) {
            setIpBanError(err.message || 'Không thể gỡ chặn IP')
        } finally {
            setIpBanLoading(false)
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
    const bannedUsersOnPage = users.filter((user) => isUserCurrentlyBanned(user)).length
    const activeIpBanCount = ipBans.length

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-wrap justify-between items-center gap-3 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 p-4 rounded-lg shadow-sm border border-blue-300">
                <div>
                    <h1 className="text-xl font-bold text-white">User Security Control</h1>
                    <p className="text-blue-50 text-sm mt-1">
                        Tổng users: <span className="font-bold text-cyan-300">{pagination?.total || 0}</span>
                        {' • '}
                        Bị khóa (trang hiện tại): <span className="font-bold text-rose-300">{bannedUsersOnPage}</span>
                        {' • '}
                        IP đang chặn: <span className="font-bold text-amber-300">{activeIpBanCount}</span>
                    </p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white/95 border border-slate-300 hover:bg-white text-slate-800 rounded-md text-sm font-bold shadow-sm transition-all"
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
                Chế độ quản trị bảo mật: phân quyền admin theo module, khóa/mở khóa tài khoản theo thời hạn, và chặn IP nghi vấn trực tiếp.
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-blue-100 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Ban IP</h2>
                    <button
                        type="button"
                        onClick={loadIpBans}
                        disabled={ipBanLoading}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-bold shadow-sm disabled:opacity-50"
                    >
                        Làm mới
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input
                        type="text"
                        value={banIpForm.ip}
                        onChange={(e) => setBanIpForm((prev) => ({ ...prev, ip: e.target.value }))}
                        placeholder="IP cần chặn"
                        className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                        type="text"
                        value={banIpForm.reason}
                        onChange={(e) => setBanIpForm((prev) => ({ ...prev, reason: e.target.value }))}
                        placeholder="Lý do (tùy chọn)"
                        className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                        type="number"
                        min="1"
                        value={banIpForm.durationHours}
                        onChange={(e) => setBanIpForm((prev) => ({ ...prev, durationHours: e.target.value }))}
                        placeholder="Số giờ chặn"
                        className="px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={handleCreateIpBan}
                        disabled={ipBanLoading}
                        className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-bold shadow-sm disabled:opacity-50"
                    >
                        {ipBanLoading ? 'Đang xử lý...' : 'Chặn IP'}
                    </button>
                </div>

                {ipBanError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 font-medium">
                        {ipBanError}
                    </div>
                )}

                <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 text-xs">
                        {ipBans.length === 0 ? (
                            <div className="px-3 py-3 text-slate-500">Chưa có IP nào bị chặn.</div>
                        ) : (
                            ipBans.map((ban) => (
                                <div key={ban._id} className="px-3 py-2 flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="font-bold text-slate-800 break-all">{ban.ip}</div>
                                        <div className="text-slate-500">
                                            {ban.reason || 'Không có lý do'}
                                            {' • '}
                                            Hết hạn: {formatDateTime(ban.expiresAt)}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleUnbanIp(ban._id)}
                                        disabled={ipBanLoading}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50"
                                    >
                                        Gỡ chặn
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-blue-200 flex flex-col w-full max-w-full overflow-x-auto overscroll-x-contain">
                <div className="overflow-auto max-h-[65vh] custom-scrollbar w-full" style={{ transform: 'rotateX(180deg)' }}>
                    <table className="w-full text-sm text-slate-700 min-w-[1020px] lg:min-w-[1120px]" style={{ transform: 'rotateX(180deg)' }}>
                        <thead className="bg-slate-50 text-slate-800 uppercase text-[11px] tracking-wide border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="whitespace-nowrap px-3 py-3 text-center font-semibold w-12">
                                    <input
                                        type="checkbox"
                                        checked={allCurrentPageSelected}
                                        onChange={(e) => toggleSelectCurrentPage(e.target.checked)}
                                        disabled={users.length === 0 || bulkDeleting}
                                        className="accent-blue-600"
                                        title="Chọn tất cả tài khoản trong trang hiện tại"
                                    />
                                </th>
                                <th className="whitespace-nowrap px-3 py-3 text-left font-semibold min-w-[220px]">Email</th>
                                <th className="whitespace-nowrap px-3 py-3 text-left font-semibold min-w-[180px]">Username</th>
                                <th className="whitespace-nowrap px-3 py-3 text-center font-semibold">Trạng thái</th>
                                <th className="whitespace-nowrap px-3 py-3 text-left font-semibold min-w-[140px]">IP gần nhất</th>
                                <th className="whitespace-nowrap px-3 py-3 text-center font-semibold">Role</th>
                                <th className="whitespace-nowrap px-3 py-3 text-left font-semibold min-w-[300px]">Admin Modules</th>
                                <th className="px-3 py-3 text-center font-semibold min-w-[260px]">Trao thưởng / Kiểm soát</th>
                                <th className="whitespace-nowrap px-3 py-3 text-center font-semibold">Ngày tạo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {users.map((user) => {
                                const roleUpdating = updatingRoleUserId === user._id
                                const tierAssigning = assigningVipTierUserId === user._id
                                const permissionUpdating = updatingPermissionUserId === user._id
                                const isAdmin = user.role === 'admin'
                                const userPermissions = Array.isArray(user.adminPermissions) ? user.adminPermissions : []
                                const normalizedUserId = String(user._id || '').trim()
                                const isSelected = selectedIdSet.has(normalizedUserId)
                                const quickSelectedVipTierId = String(
                                    quickVipTierByUserId?.[normalizedUserId]
                                    || resolveVipTierIdForUser(user)
                                    || ''
                                ).trim()

                                return (
                                    <tr key={user._id} className="align-middle transition-colors hover:bg-slate-50">
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-center">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => toggleUserSelection(normalizedUserId, e.target.checked)}
                                                disabled={bulkDeleting}
                                                className="accent-blue-600"
                                            />
                                        </td>
                                        <td className="px-3 py-3 align-middle font-medium text-slate-900 break-all">{user.email}</td>
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-slate-600">{user.username || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-center">
                                            {isUserCurrentlyBanned(user) ? (
                                                <div className="inline-flex flex-col items-center gap-1">
                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                                                        Đang bị khóa
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 max-w-[170px] truncate" title={user.banReason || 'Không có lý do'}>
                                                        {user.banReason || 'Không có lý do'}
                                                    </span>
                                                    {user.bannedUntil && (
                                                        <span className="text-[10px] text-slate-500">
                                                            Đến: {formatDateTime(user.bannedUntil)}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                    Hoạt động
                                                </span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-xs text-slate-600">
                                            {user.lastLoginIp ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleBanIpFromUser(user)}
                                                    className="font-mono text-[11px] text-blue-700 hover:text-blue-800 hover:underline"
                                                    title="Bấm để điền IP vào form Ban IP"
                                                >
                                                    {user.lastLoginIp}
                                                </button>
                                            ) : (
                                                <span className="text-slate-400">--</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-center">
                                            <div className="inline-flex flex-col items-center gap-1">
                                                <select
                                                    value={user.role}
                                                    onChange={(e) => handleRoleChange(user._id, e.target.value)}
                                                    disabled={roleUpdating}
                                                    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${user.role === 'admin'
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                                                        : (user.role === 'vip'
                                                            ? 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100'
                                                            : 'bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100')
                                                        } ${roleUpdating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                >
                                                    <option value="user">User</option>
                                                    <option value="vip">VIP</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                                {user.role === 'vip' ? (
                                                    <div className="flex flex-col items-start gap-1">
                                                        <span className="px-1.5 py-0.5 rounded bg-yellow-50 border border-yellow-200 text-[10px] font-bold text-yellow-700">
                                                            VIP Lv.{Math.max(1, Number(user?.vipTierLevel || 1))}{user?.vipTierCode ? ` • ${user.vipTierCode}` : ''}
                                                        </span>
                                                        {user?.vipExpiresAt ? (
                                                            <span className="text-[10px] text-amber-700 font-semibold">
                                                                Hết hạn: {new Date(user.vipExpiresAt).toLocaleString('vi-VN')}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-slate-400">--</span>
                                                )}

                                                <div className="inline-flex items-center gap-1 mt-1">
                                                    <select
                                                        value={quickSelectedVipTierId}
                                                        onChange={(e) => handleQuickVipTierChange(normalizedUserId, e.target.value)}
                                                        disabled={tierAssigning || vipTiers.length === 0}
                                                        className="px-1.5 py-1 rounded border border-slate-300 text-[10px] bg-white max-w-[118px]"
                                                    >
                                                        <option value="">Set VIP</option>
                                                        {vipTiers.map((tier) => (
                                                            <option key={tier._id} value={tier._id}>
                                                                VIP {tier.level}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleQuickAssignVipTier(user)}
                                                        disabled={!quickSelectedVipTierId || tierAssigning || vipTiers.length === 0}
                                                        className="px-1.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {tierAssigning ? 'Set...' : 'Set'}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 align-middle">
                                            {!isAdmin ? (
                                                <span className="text-xs text-slate-400">Không áp dụng</span>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-1.5 max-w-[360px]">
                                                    {ADMIN_PERMISSION_OPTIONS.map((option) => {
                                                        const checked = userPermissions.includes(option.key)
                                                        return (
                                                            <label
                                                                key={option.key}
                                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] leading-tight ${checked
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
                                        <td className="px-3 py-3 align-middle text-center">
                                            <div className="flex flex-wrap justify-center gap-2 min-w-[260px] mx-auto">
                                                <button
                                                    onClick={() => openPokemonGrantModal(user)}
                                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors duration-200 bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-600 hover:text-white"
                                                >
                                                    Pokemon
                                                </button>
                                                <button
                                                    onClick={() => openItemGrantModal(user)}
                                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors duration-200 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-600 hover:text-white"
                                                >
                                                    Vật phẩm
                                                </button>
                                                <button
                                                    onClick={() => openVipBenefitModal(user)}
                                                    disabled={updatingVipBenefitUserId === user._id}
                                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors duration-200 bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {updatingVipBenefitUserId === user._id ? 'Đang lưu...' : `VIP ${Number(user?.vipTierLevel || 0) > 0 ? `Lv.${user.vipTierLevel}` : ''}`.trim()}
                                                </button>
                                                <button
                                                    onClick={() => handleToggleUserBan(user)}
                                                    disabled={updatingBanUserId === user._id}
                                                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors duration-200 disabled:opacity-50 ${isUserCurrentlyBanned(user)
                                                        ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-500 hover:text-white'
                                                        : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-600 hover:text-white'
                                                        }`}
                                                >
                                                    {updatingBanUserId === user._id
                                                        ? 'Đang cập nhật...'
                                                        : (isUserCurrentlyBanned(user) ? 'Gỡ khóa' : 'Khóa TK')}
                                                </button>
                                                <button
                                                    onClick={() => handleBanIpFromUser(user)}
                                                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors duration-200 bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-700 hover:text-white"
                                                >
                                                    Ban IP
                                                </button>
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 align-middle text-center text-slate-500 text-xs">
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

            {vipBenefitModal.open && vipBenefitModal.user && (
                <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-4xl rounded-lg border border-slate-200 shadow-2xl">
                        <div className="px-5 py-4 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-amber-800">Quản lý quyền lợi VIP</h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Mục tiêu: <span className="font-bold text-amber-700">{vipBenefitModal.user.username || vipBenefitModal.user.email}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => closeVipBenefitModal()}
                                disabled={vipBenefitModal.submitting}
                                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5">
                            {vipBenefitModal.error && (
                                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm font-medium mb-4">
                                    {vipBenefitModal.error}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Cấp VIP (VIP 1 - VIP X)</label>
                                        <p className="text-[11px] text-amber-700 mb-1.5 leading-tight">Bạn có thể chọn thời gian hết hạn cố định. Nếu không chọn sẽ mặc định cộng 1 tháng.</p>
                                        <select
                                            value={vipBenefitModal.form.vipTierId}
                                            onChange={(e) => updateVipBenefitFormField('vipTierId', e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                        >
                                            <option value="">Chọn cấp VIP</option>
                                            {vipTiers.map((tier) => (
                                                <option key={tier._id} value={tier._id}>
                                                    VIP {tier.level} - {tier.name || tier.code}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Thời gian hết hạn VIP</label>
                                        <input
                                            type="datetime-local"
                                            value={vipBenefitModal.form.vipExpiresAt}
                                            onChange={(e) => updateVipBenefitFormField('vipExpiresAt', e.target.value)}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Danh hiệu VIP</label>
                                        <input
                                            type="text"
                                            maxLength={80}
                                            value={vipBenefitModal.form.title}
                                            onChange={(e) => updateVipBenefitFormField('title', e.target.value)}
                                            placeholder="VD: VIP Kim Cương"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">URL ảnh danh hiệu VIP</label>
                                        <input
                                            type="url"
                                            value={vipBenefitModal.form.titleImageUrl}
                                            onChange={(e) => updateVipBenefitFormField('titleImageUrl', e.target.value)}
                                            placeholder="https://..."
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Avatar frame URL</label>
                                        <input
                                            type="url"
                                            value={vipBenefitModal.form.avatarFrameUrl}
                                            onChange={(e) => updateVipBenefitFormField('avatarFrameUrl', e.target.value)}
                                            placeholder="https://..."
                                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-3 bg-slate-50 p-3 rounded-md border border-slate-200">
                                        <label className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-slate-700">Cho phép auto tìm kiếm</span>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(vipBenefitModal.form.autoSearchEnabled)}
                                                onChange={(e) => updateVipBenefitFormField('autoSearchEnabled', e.target.checked)}
                                                className="accent-amber-600"
                                            />
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Thời gian (phút)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={vipBenefitModal.form.autoSearchDurationMinutes}
                                                    onChange={(e) => updateVipBenefitFormField('autoSearchDurationMinutes', e.target.value)}
                                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Số lượt / ngày</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={vipBenefitModal.form.autoSearchUsesPerDay}
                                                    onChange={(e) => updateVipBenefitFormField('autoSearchUsesPerDay', e.target.value)}
                                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 bg-slate-50 p-3 rounded-md border border-slate-200">
                                        <label className="flex items-center justify-between gap-3">
                                            <span className="text-sm font-semibold text-slate-700">Cho phép auto battle trainer</span>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(vipBenefitModal.form.autoBattleTrainerEnabled)}
                                                onChange={(e) => updateVipBenefitFormField('autoBattleTrainerEnabled', e.target.checked)}
                                                className="accent-amber-600"
                                            />
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Thời gian (phút)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={vipBenefitModal.form.autoBattleTrainerDurationMinutes}
                                                    onChange={(e) => updateVipBenefitFormField('autoBattleTrainerDurationMinutes', e.target.value)}
                                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Số lượt / ngày</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={vipBenefitModal.form.autoBattleTrainerUsesPerDay}
                                                    onChange={(e) => updateVipBenefitFormField('autoBattleTrainerUsesPerDay', e.target.value)}
                                                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 mt-5 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => closeVipBenefitModal()}
                                    disabled={vipBenefitModal.submitting}
                                    className="px-6 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold disabled:opacity-50 min-w-[100px]"
                                >
                                    Hủy
                                </button>
                                <button
                                    type="button"
                                    onClick={submitVipBenefitModal}
                                    disabled={vipBenefitModal.submitting}
                                    className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-md text-sm font-bold disabled:opacity-50 shadow-sm min-w-[140px]"
                                >
                                    {vipBenefitModal.submitting ? 'Đang lưu...' : 'Lưu quyền lợi'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {accountBanModal.open && accountBanModal.user && (
                <div className="fixed inset-0 bg-blue-900/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-md rounded-lg border border-slate-200 shadow-2xl">
                        <div className="px-5 py-4 border-b border-blue-100 bg-blue-50/60 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-blue-800">Khóa tài khoản</h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Mục tiêu: <span className="font-bold text-red-700">{accountBanModal.user.username || accountBanModal.user.email}</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => closeAccountBanModal()}
                                disabled={accountBanModal.submitting}
                                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {accountBanModal.error && (
                                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm font-medium">
                                    {accountBanModal.error}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Lý do khóa (tùy chọn)</label>
                                <textarea
                                    value={accountBanModal.reason}
                                    onChange={(e) => setAccountBanModal((prev) => ({ ...prev, reason: e.target.value }))}
                                    rows={3}
                                    placeholder="Ví dụ: Vi phạm quy định cộng đồng"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Thời hạn khóa (giờ)</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={accountBanModal.durationHours}
                                    onChange={(e) => setAccountBanModal((prev) => ({ ...prev, durationHours: e.target.value }))}
                                    placeholder="Để trống = khóa vĩnh viễn"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {[24, 72, 168].map((hours) => (
                                        <button
                                            key={hours}
                                            type="button"
                                            onClick={() => setAccountBanModal((prev) => ({ ...prev, durationHours: String(hours) }))}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                                        >
                                            {hours / 24} ngày
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setAccountBanModal((prev) => ({ ...prev, durationHours: '' }))}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
                                    >
                                        Vĩnh viễn
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={submitAccountBanModal}
                                    disabled={accountBanModal.submitting}
                                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-bold disabled:opacity-50"
                                >
                                    {accountBanModal.submitting ? 'Đang khóa...' : 'Xác nhận khóa'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => closeAccountBanModal()}
                                    disabled={accountBanModal.submitting}
                                    className="flex-1 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold disabled:opacity-50"
                                >
                                    Hủy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                                                max="3000"
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
