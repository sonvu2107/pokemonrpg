import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import VipUsername from '../../components/VipUsername'
import { userApi, vipTierApi } from '../../services/adminApi'
import { uploadToCloudinary, validateImageFile } from '../../utils/cloudinaryUtils'
import { normalizeVipHexColor, normalizeVipUsernameEffect } from '../../utils/vip'

const VIP_TITLE_UPLOAD_TRANSFORMATION = 'e_trim/c_pad,w_960,h_320,b_transparent/f_auto/q_auto:good'
const DEFAULT_NAME_COLOR = '#F59E0B'
const DEFAULT_NAME_GRADIENT_COLOR = '#FFF3B0'

const toLocalDateTimeInputValue = (value) => {
    const date = value ? new Date(value) : null
    if (!date || Number.isNaN(date.getTime())) return ''
    const offsetMs = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const createDefaultTierForm = () => ({
    code: '',
    name: '',
    level: '1',
    description: '',
    isActive: true,
    title: '',
    titleImageUrl: '',
    avatarFrameUrl: '',
    usernameColor: '',
    usernameGradientColor: '',
    usernameEffect: 'none',
    autoSearchEnabled: true,
    autoSearchDurationMinutes: '0',
    autoSearchUsesPerDay: '0',
    autoBattleTrainerEnabled: true,
    autoBattleTrainerDurationMinutes: '0',
    autoBattleTrainerUsesPerDay: '0',
    expBonusPercent: '0',
    platinumCoinBonusPercent: '0',
    ssCatchRateBonusPercent: '0',
    itemDropBonusPercent: '0',
    dailyRewardBonusPercent: '0',
    customBenefitsText: '',
})

const parsePercent = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.min(1000, Math.round(parsed * 100) / 100)
}

const resolveColorPickerValue = (value, fallback = DEFAULT_NAME_COLOR) => {
    return normalizeVipHexColor(value) || fallback
}

const normalizeTierToForm = (tierLike = null) => {
    const base = createDefaultTierForm()
    if (!tierLike) return base

    const benefits = tierLike?.benefits && typeof tierLike.benefits === 'object'
        ? tierLike.benefits
        : {}

    return {
        code: String(tierLike?.code || base.code),
        name: String(tierLike?.name || base.name),
        level: String(tierLike?.level ?? base.level),
        description: String(tierLike?.description || base.description),
        isActive: Boolean(tierLike?.isActive),
        title: String(benefits?.title || base.title),
        titleImageUrl: String(benefits?.titleImageUrl || base.titleImageUrl),
        avatarFrameUrl: String(benefits?.avatarFrameUrl || base.avatarFrameUrl),
        usernameColor: String(benefits?.usernameColor || base.usernameColor).trim().toUpperCase(),
        usernameGradientColor: String(benefits?.usernameGradientColor || base.usernameGradientColor).trim().toUpperCase(),
        usernameEffect: normalizeVipUsernameEffect(benefits?.usernameEffect || base.usernameEffect),
        autoSearchEnabled: benefits?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: String(benefits?.autoSearchDurationMinutes ?? base.autoSearchDurationMinutes),
        autoSearchUsesPerDay: String(benefits?.autoSearchUsesPerDay ?? base.autoSearchUsesPerDay),
        autoBattleTrainerEnabled: benefits?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: String(benefits?.autoBattleTrainerDurationMinutes ?? base.autoBattleTrainerDurationMinutes),
        autoBattleTrainerUsesPerDay: String(benefits?.autoBattleTrainerUsesPerDay ?? base.autoBattleTrainerUsesPerDay),
        expBonusPercent: String(benefits?.expBonusPercent ?? base.expBonusPercent),
        platinumCoinBonusPercent: String(
            benefits?.platinumCoinBonusPercent
            ?? benefits?.moonPointBonusPercent
            ?? base.platinumCoinBonusPercent
        ),
        ssCatchRateBonusPercent: String(
            benefits?.ssCatchRateBonusPercent
            ?? benefits?.catchRateBonusPercent
            ?? base.ssCatchRateBonusPercent
        ),
        itemDropBonusPercent: String(benefits?.itemDropBonusPercent ?? base.itemDropBonusPercent),
        dailyRewardBonusPercent: String(benefits?.dailyRewardBonusPercent ?? base.dailyRewardBonusPercent),
        customBenefitsText: Array.isArray(benefits?.customBenefits)
            ? benefits.customBenefits.join('\n')
            : '',
    }
}

const buildPayloadFromForm = (form) => {
    const customBenefits = [...new Set(
        String(form.customBenefitsText || '')
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)
    )]

    return {
        code: String(form.code || '').trim(),
        name: String(form.name || '').trim(),
        level: Math.max(1, parseInt(form.level, 10) || 1),
        description: String(form.description || '').trim(),
        isActive: Boolean(form.isActive),
        benefits: {
            title: String(form.title || '').trim(),
            titleImageUrl: String(form.titleImageUrl || '').trim(),
            avatarFrameUrl: String(form.avatarFrameUrl || '').trim(),
            usernameColor: normalizeVipHexColor(form.usernameColor),
            usernameGradientColor: normalizeVipHexColor(form.usernameGradientColor),
            usernameEffect: normalizeVipUsernameEffect(form.usernameEffect),
            autoSearchEnabled: Boolean(form.autoSearchEnabled),
            autoSearchDurationMinutes: Math.max(0, parseInt(form.autoSearchDurationMinutes, 10) || 0),
            autoSearchUsesPerDay: Math.max(0, parseInt(form.autoSearchUsesPerDay, 10) || 0),
            autoBattleTrainerEnabled: Boolean(form.autoBattleTrainerEnabled),
            autoBattleTrainerDurationMinutes: Math.max(0, parseInt(form.autoBattleTrainerDurationMinutes, 10) || 0),
            autoBattleTrainerUsesPerDay: Math.max(0, parseInt(form.autoBattleTrainerUsesPerDay, 10) || 0),
            expBonusPercent: parsePercent(form.expBonusPercent),
            platinumCoinBonusPercent: parsePercent(form.platinumCoinBonusPercent),
            ssCatchRateBonusPercent: parsePercent(form.ssCatchRateBonusPercent),
            itemDropBonusPercent: parsePercent(form.itemDropBonusPercent),
            dailyRewardBonusPercent: parsePercent(form.dailyRewardBonusPercent),
            customBenefits,
        },
    }
}

const AutoOptionRow = ({ label, description, checked, onChange }) => (
    <label className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div>
            <div className="text-sm font-bold text-slate-800">{label}</div>
            <div className="text-xs text-slate-500">{description}</div>
        </div>
        <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            className="mt-1 accent-blue-600"
        />
    </label>
)

export default function VipPrivilegePage() {
    const [tiers, setTiers] = useState([])
    const [vipUsers, setVipUsers] = useState([])
    const [vipExpiryDraftByUserId, setVipExpiryDraftByUserId] = useState({})
    const [loading, setLoading] = useState(true)
    const [vipUsersLoading, setVipUsersLoading] = useState(true)
    const [updatingVipExpiryUserId, setUpdatingVipExpiryUserId] = useState('')
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [vipUserSearch, setVipUserSearch] = useState('')
    const [vipUserPage, setVipUserPage] = useState(1)
    const [showInactive, setShowInactive] = useState(true)
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState('')
    const [syncingTierId, setSyncingTierId] = useState('')
    const [syncingAllTiers, setSyncingAllTiers] = useState(false)
    const [syncNotice, setSyncNotice] = useState(null)
    const [editingId, setEditingId] = useState('')
    const [form, setForm] = useState(createDefaultTierForm())
    const [rangeForm, setRangeForm] = useState({ fromLevel: '1', toLevel: '10' })
    const [rangeSubmitting, setRangeSubmitting] = useState(false)
    const [uploadingAsset, setUploadingAsset] = useState({ title: false, frame: false })
    const loadTiers = async () => {
        try {
            setLoading(true)
            setError('')
            const res = await vipTierApi.list({
                search: search.trim(),
                active: showInactive ? '' : 'true',
            })
            setTiers(Array.isArray(res?.vipTiers) ? res.vipTiers : [])
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách đặc quyền VIP')
            setTiers([])
        } finally {
            setLoading(false)
        }
    }

    const loadVipUsers = async () => {
        try {
            setVipUsersLoading(true)
            const res = await userApi.list({ role: 'vip', limit: 100 })
            const nextUsers = Array.isArray(res?.users) ? res.users : []
            setVipUsers(nextUsers)
            setVipExpiryDraftByUserId(
                nextUsers.reduce((acc, user) => {
                    const userId = String(user?._id || '').trim()
                    if (!userId) return acc
                    acc[userId] = toLocalDateTimeInputValue(user?.vipExpiresAt)
                    return acc
                }, {})
            )
        } catch (err) {
            setVipUsers([])
            setError((prev) => prev || err.message || 'Không thể tải danh sách user VIP')
        } finally {
            setVipUsersLoading(false)
        }
    }

    const refreshPageData = async () => {
        await Promise.all([loadTiers(), loadVipUsers()])
    }

    const handleVipExpiryDraftChange = (userId, value) => {
        const normalizedUserId = String(userId || '').trim()
        if (!normalizedUserId) return
        setVipExpiryDraftByUserId((prev) => ({
            ...prev,
            [normalizedUserId]: value,
        }))
    }

    const handleUpdateVipExpiry = async (user) => {
        const userId = String(user?._id || '').trim()
        if (!userId) return

        const expiresAt = String(vipExpiryDraftByUserId?.[userId] || '').trim()
        if (!expiresAt) {
            setError('Vui lòng chọn thời gian hết hạn VIP.')
            return
        }

        try {
            setUpdatingVipExpiryUserId(userId)
            setError('')
            const payload = {
                expiresAt,
                applyBenefits: false,
            }

            if (user?.vipTierId) {
                payload.tierId = user.vipTierId
            } else {
                payload.level = Math.max(1, Number(user?.vipTierLevel || 1))
            }

            const res = await userApi.updateVipTier(userId, payload)
            if (res?.user) {
                setVipUsers((prev) => prev.map((entry) => (entry._id === userId ? res.user : entry)))
                setVipExpiryDraftByUserId((prev) => ({
                    ...prev,
                    [userId]: toLocalDateTimeInputValue(res.user?.vipExpiresAt),
                }))
            }
        } catch (err) {
            setError(err.message || 'Không thể cập nhật thời gian hết hạn VIP')
        } finally {
            setUpdatingVipExpiryUserId('')
        }
    }

    useEffect(() => {
        refreshPageData()
    }, [showInactive])

    const visibleTiers = useMemo(() => {
        const keyword = search.trim().toLowerCase()
        if (!keyword) return tiers
        return tiers.filter((tier) => {
            const text = `${tier.code || ''} ${tier.name || ''} ${tier.description || ''}`.toLowerCase()
            return text.includes(keyword)
        })
    }, [tiers, search])

    const visibleVipUsers = useMemo(() => {
        const keyword = vipUserSearch.trim().toLowerCase()
        if (!keyword) return vipUsers
        return vipUsers.filter((user) => {
            const text = `${user?.username || ''} ${user?.email || ''} ${user?.vipTierCode || ''} ${user?.vipTierLevel || 0}`.toLowerCase()
            return text.includes(keyword)
        })
    }, [vipUsers, vipUserSearch])

    useEffect(() => {
        setVipUserPage(1)
    }, [vipUserSearch])

    const VIP_USERS_PER_PAGE = 8
    const vipUserTotalPages = Math.max(1, Math.ceil(visibleVipUsers.length / VIP_USERS_PER_PAGE))
    const paginatedVipUsers = useMemo(() => {
        return visibleVipUsers.slice((vipUserPage - 1) * VIP_USERS_PER_PAGE, vipUserPage * VIP_USERS_PER_PAGE)
    }, [visibleVipUsers, vipUserPage])

    const handleEdit = (tier) => {
        setEditingId(String(tier?._id || ''))
        setForm(normalizeTierToForm(tier))
    }

    const resetForm = () => {
        setEditingId('')
        setForm(createDefaultTierForm())
    }

    const handleSubmit = async (event) => {
        event.preventDefault()
        try {
            setSaving(true)
            setError('')
            setSyncNotice(null)
            const payload = buildPayloadFromForm(form)
            let res = null
            if (editingId) {
                res = await vipTierApi.update(editingId, payload)
            } else {
                res = await vipTierApi.create(payload)
            }
            await refreshPageData()
            resetForm()
            if (editingId && Number(res?.syncedUsers || 0) > 0) {
                setSyncNotice({
                    tone: 'success',
                    message: `${res?.vipTier?.name || 'Tier VIP'}: đã đồng bộ ${Number(res?.syncedUsers || 0)} / ${Number(res?.matchedUsers || 0)} user đang dùng tier này.`,
                })
            }
        } catch (err) {
            setError(err.message || 'Không thể lưu cấu hình đặc quyền VIP')
        } finally {
            setSaving(false)
        }
    }

    const handleSyncTierUsers = async (tier) => {
        const tierId = String(tier?._id || '').trim()
        if (!tierId) return

        const confirmed = confirm(`Đồng bộ lại toàn bộ user đang dùng ${tier?.name || tier?.code}?`)
        if (!confirmed) return

        try {
            setSyncingTierId(tierId)
            setError('')
            setSyncNotice(null)
            const res = await vipTierApi.syncUsers(tierId)
            await refreshPageData()
            setSyncNotice({
                tone: Number(res?.syncedUsers || 0) > 0 ? 'success' : 'info',
                message: `${tier?.name || tier?.code || 'Tier VIP'}: đã đồng bộ ${Number(res?.syncedUsers || 0)} / ${Number(res?.matchedUsers || 0)} user.`,
            })
        } catch (err) {
            setError(err.message || 'Không thể đồng bộ user của cấp VIP')
        } finally {
            setSyncingTierId('')
        }
    }

    const handleSyncAllTierUsers = async () => {
        const confirmed = confirm('Đồng bộ lại toàn bộ user của tất cả gói VIP?')
        if (!confirmed) return

        try {
            setSyncingAllTiers(true)
            setError('')
            setSyncNotice(null)
            const res = await vipTierApi.syncAllUsers()
            await refreshPageData()
            setSyncNotice({
                tone: Number(res?.syncedUsers || 0) > 0 ? 'success' : 'info',
                message: `Đã đồng bộ ${Number(res?.syncedUsers || 0)} / ${Number(res?.matchedUsers || 0)} user từ ${Number(res?.tierCount || 0)} tier VIP.`,
            })
        } catch (err) {
            setError(err.message || 'Không thể đồng bộ toàn bộ user VIP')
        } finally {
            setSyncingAllTiers(false)
        }
    }

    const handleDelete = async (tier) => {
        const tierId = String(tier?._id || '')
        if (!tierId) return
        const confirmed = confirm(`Xóa cấp ${tier?.name || tier?.code}?`)
        if (!confirmed) return

        try {
            setDeletingId(tierId)
            setError('')
            await vipTierApi.delete(tierId)
            if (editingId === tierId) {
                resetForm()
            }
            await refreshPageData()
        } catch (err) {
            setError(err.message || 'Không thể xóa cấp VIP')
        } finally {
            setDeletingId('')
        }
    }

    const handleCreateRange = async () => {
        try {
            setRangeSubmitting(true)
            setError('')
            const fromLevel = Math.max(1, parseInt(rangeForm.fromLevel, 10) || 1)
            const toLevel = Math.max(1, parseInt(rangeForm.toLevel, 10) || fromLevel)
            const res = await vipTierApi.createRange({ fromLevel, toLevel })
            alert(res?.message || 'Đã tạo dải cấp VIP')
            await refreshPageData()
        } catch (err) {
            setError(err.message || 'Không thể tạo dải cấp VIP')
        } finally {
            setRangeSubmitting(false)
        }
    }

    const handleUploadAsset = async (type, file) => {
        if (!file) return
        const validationError = validateImageFile(file)
        if (validationError) {
            setError(validationError)
            return
        }

        const key = type === 'title' ? 'title' : 'frame'
        try {
            setError('')
            setUploadingAsset((prev) => ({ ...prev, [key]: true }))
            const uploadOptions = type === 'title'
                ? {
                    folder: 'pokemon/vip-assets',
                    transformation: VIP_TITLE_UPLOAD_TRANSFORMATION,
                }
                : { folder: 'pokemon/vip-assets' }

            let imageUrl = ''
            try {
                imageUrl = await uploadToCloudinary(file, undefined, uploadOptions)
            } catch (uploadError) {
                const errorMessage = String(uploadError?.message || '').toLowerCase()
                const isTransformationBlocked = type === 'title'
                    && errorMessage.includes('transformation')
                    && (
                        errorMessage.includes('invalid')
                        ||
                        errorMessage.includes('not allowed')
                        || errorMessage.includes('not authorized')
                        || errorMessage.includes('unsigned')
                    )

                if (!isTransformationBlocked) {
                    throw uploadError
                }

                imageUrl = await uploadToCloudinary(file, undefined, { folder: 'pokemon/vip-assets' })
            }

            if (!imageUrl) {
                throw new Error('Không nhận được URL ảnh sau khi tải lên')
            }

            if (type === 'title') {
                setForm((prev) => ({ ...prev, titleImageUrl: imageUrl }))
            } else {
                setForm((prev) => ({ ...prev, avatarFrameUrl: imageUrl }))
            }
        } catch (err) {
            setError(err.message || 'Không thể tải ảnh lên')
        } finally {
            setUploadingAsset((prev) => ({ ...prev, [key]: false }))
        }
    }

    const ghostBtnBase =
        "inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1";

    const editBtn =
        `${ghostBtnBase} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white focus:ring-blue-300`;

    const deleteBtn =
        `${ghostBtnBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white focus:ring-red-300`;

    const saveBtn =
        `${ghostBtnBase} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white focus:ring-emerald-300`;

    const syncBtn =
        `${ghostBtnBase} border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-600 hover:text-white focus:ring-cyan-300`;

    const neutralBtn =
        `${ghostBtnBase} border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-700 hover:text-white focus:ring-slate-300`;

    const inputClass =
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

    const sectionClass =
        "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

    const formTitle = editingId ? 'Cập nhật đặc quyền VIP' : 'Tạo đặc quyền VIP mới'

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 p-4 rounded-lg border border-blue-300">
                <div>
                    <h1 className="text-xl font-bold text-white">Quản lý đặc quyền VIP</h1>
                    <p className="text-blue-50 text-sm mt-1">Tạo cấp VIP từ 1 đến không giới hạn và chỉnh quyền lợi chi tiết.</p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white/95 border border-slate-300 hover:bg-white text-slate-800 rounded-md text-sm font-bold shadow-sm"
                >
                    Quay lại
                </Link>
            </div>

            <div className="space-y-5">
                <div className="space-y-4">
                    <div className="bg-white rounded-lg border border-blue-200 shadow-sm p-4 space-y-3">
                        <div className="text-sm font-bold text-slate-800 uppercase tracking-wide">Tạo nhanh VIP 1 - XXX</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                                type="number"
                                min="1"
                                value={rangeForm.fromLevel}
                                onChange={(e) => setRangeForm((prev) => ({ ...prev, fromLevel: e.target.value }))}
                                placeholder="Từ cấp"
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                            />
                            <input
                                type="number"
                                min="1"
                                value={rangeForm.toLevel}
                                onChange={(e) => setRangeForm((prev) => ({ ...prev, toLevel: e.target.value }))}
                                placeholder="Đến cấp"
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleCreateRange}
                            disabled={rangeSubmitting}
                            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold disabled:opacity-60"
                        >
                            {rangeSubmitting ? 'Đang tạo...' : 'Tạo dải cấp VIP'}
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 shadow-sm p-4 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-bold text-slate-800 uppercase tracking-wide">{formTitle}</div>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="px-2 py-1 border border-slate-300 rounded text-xs font-bold text-slate-600 hover:bg-slate-50"
                                >
                                    Tạo mới
                                </button>
                            )}
                        </div>

                        <div className="space-y-5">
                            <section className={sectionClass}>
                                <h3 className="mb-4 text-sm font-semibold text-slate-900">
                                    Thông tin cơ bản
                                </h3>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Mã (VD: VIP1)</label>
                                        <input
                                            type="text"
                                            value={form.code}
                                            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                                            placeholder="Mã (VD: VIP1)"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Cấp</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="9999"
                                            value={form.level}
                                            onChange={(e) => setForm((prev) => ({ ...prev, level: e.target.value }))}
                                            placeholder="Cấp"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Tên hiển thị</label>
                                        <input
                                            type="text"
                                            value={form.name}
                                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                                            placeholder="Tên cấp VIP"
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1 md:col-span-2 xl:col-span-3">
                                        <label className="block text-xs font-medium text-slate-600">Mô tả ngắn</label>
                                        <textarea
                                            value={form.description}
                                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                                            placeholder="Mô tả ngắn"
                                            rows={2}
                                            className={inputClass}
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-2 xl:col-span-3">
                                        <input
                                            type="checkbox"
                                            checked={form.isActive}
                                            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                                            className="h-4 w-4 rounded border-slate-300"
                                        />
                                        <span className="font-semibold">Kích hoạt cấp VIP này</span>
                                    </label>
                                </div>
                            </section>

                            <section className={sectionClass}>
                                <h3 className="mb-4 text-sm font-semibold text-slate-900">
                                    Ảnh thưởng hiển thị
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <div className="text-[11px] font-semibold text-slate-700">Ảnh thưởng danh hiệu VIP</div>
                                        <div className="h-16 rounded border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                                            {form.titleImageUrl ? (
                                                <img
                                                    src={form.titleImageUrl}
                                                    alt="Danh hiệu VIP"
                                                    className="max-h-full max-w-full object-contain"
                                                    onError={(event) => {
                                                        event.currentTarget.style.display = 'none'
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-[11px] text-slate-400">Chưa có ảnh danh hiệu</span>
                                            )}
                                        </div>
                                        <input
                                            id="vip-title-image-upload"
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0]
                                                e.target.value = ''
                                                handleUploadAsset('title', file)
                                            }}
                                        />
                                        <label
                                            htmlFor="vip-title-image-upload"
                                            className="inline-flex items-center justify-center w-full px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs font-bold text-slate-700 cursor-pointer"
                                        >
                                            {uploadingAsset.title ? 'Đang tải ảnh...' : 'Tải ảnh danh hiệu'}
                                        </label>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-[11px] font-semibold text-slate-700">Ảnh thưởng khung avatar VIP</div>
                                        <div className="h-16 rounded border border-dashed border-slate-300 bg-white flex items-center justify-center overflow-hidden">
                                            {form.avatarFrameUrl ? (
                                                <img
                                                    src={form.avatarFrameUrl}
                                                    alt="Khung VIP"
                                                    className="max-h-full max-w-full object-contain"
                                                    onError={(event) => {
                                                        event.currentTarget.style.display = 'none'
                                                    }}
                                                />
                                            ) : (
                                                <span className="text-[11px] text-slate-400">Chưa có ảnh khung</span>
                                            )}
                                        </div>
                                        <input
                                            id="vip-frame-image-upload"
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0]
                                                e.target.value = ''
                                                handleUploadAsset('frame', file)
                                            }}
                                        />
                                        <label
                                            htmlFor="vip-frame-image-upload"
                                            className="inline-flex items-center justify-center w-full px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs font-bold text-slate-700 cursor-pointer"
                                        >
                                            {uploadingAsset.frame ? 'Đang tải ảnh...' : 'Tải ảnh khung'}
                                        </label>
                                    </div>
                                </div>
                            </section>

                            <section className={sectionClass}>
                                <h3 className="mb-4 text-sm font-semibold text-slate-900">
                                    Màu tên nhân vật VIP
                                </h3>
                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                                    <div className="space-y-1 xl:col-span-3">
                                        <label className="block text-xs font-medium text-slate-600">Xem trước tên</label>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                            <VipUsername
                                                userLike={{
                                                    role: 'vip',
                                                    vipBenefits: {
                                                        usernameColor: form.usernameColor,
                                                        usernameGradientColor: form.usernameGradientColor,
                                                        usernameEffect: form.usernameEffect,
                                                    },
                                                }}
                                                className="text-lg font-extrabold tracking-wide"
                                            >
                                                {form.name || `VIP ${form.level || '1'}`}
                                            </VipUsername>
                                            <div className="mt-2 text-[11px] text-slate-500">
                                                VIP 4-5 có thể đặt màu tĩnh. VIP 6 có thể bật "Chuyển màu" để tên chạy hiệu ứng.
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-600">Màu chính</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={resolveColorPickerValue(form.usernameColor, DEFAULT_NAME_COLOR)}
                                                onChange={(e) => setForm((prev) => ({ ...prev, usernameColor: e.target.value.toUpperCase() }))}
                                                className="h-10 w-14 rounded border border-slate-300 bg-white p-1"
                                            />
                                            <input
                                                type="text"
                                                value={form.usernameColor}
                                                onChange={(e) => setForm((prev) => ({ ...prev, usernameColor: e.target.value.toUpperCase() }))}
                                                placeholder="#F59E0B"
                                                className={inputClass}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, usernameColor: '' }))}
                                                className="shrink-0 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-slate-500">Để trống = dùng màu tên mặc định.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-600">Màu phụ hiệu ứng</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={resolveColorPickerValue(form.usernameGradientColor, DEFAULT_NAME_GRADIENT_COLOR)}
                                                onChange={(e) => setForm((prev) => ({ ...prev, usernameGradientColor: e.target.value.toUpperCase() }))}
                                                className="h-10 w-14 rounded border border-slate-300 bg-white p-1"
                                            />
                                            <input
                                                type="text"
                                                value={form.usernameGradientColor}
                                                onChange={(e) => setForm((prev) => ({ ...prev, usernameGradientColor: e.target.value.toUpperCase() }))}
                                                placeholder="#FFF3B0"
                                                className={inputClass}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, usernameGradientColor: '' }))}
                                                className="shrink-0 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-slate-500">Dùng khi bật chuyển màu. Để trống sẽ tự pha sáng từ màu chính.</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Hiệu ứng tên</label>
                                        <select
                                            value={form.usernameEffect}
                                            onChange={(e) => setForm((prev) => ({ ...prev, usernameEffect: e.target.value }))}
                                            className={inputClass}
                                        >
                                            <option value="none">Màu tĩnh</option>
                                            <option value="animated">Chuyển màu</option>
                                        </select>
                                    </div>
                                </div>
                            </section>

                            <section className={sectionClass}>
                                <h3 className="mb-4 text-sm font-semibold text-slate-900">
                                    Auto tìm kiếm / Auto battle
                                </h3>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="space-y-4">
                                        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={form.autoSearchEnabled}
                                                onChange={(e) => setForm((prev) => ({ ...prev, autoSearchEnabled: e.target.checked }))}
                                                className="h-4 w-4 rounded border-slate-300"
                                            />
                                            <span className="font-semibold">Auto tìm kiếm bản đồ</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-medium text-slate-600">Thời gian (phút)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={form.autoSearchDurationMinutes}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, autoSearchDurationMinutes: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="0 = không hạn"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-medium text-slate-600">Số lượt/ngày</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={form.autoSearchUsesPerDay}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, autoSearchUsesPerDay: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="0 = không hạn"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={form.autoBattleTrainerEnabled}
                                                onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerEnabled: e.target.checked }))}
                                                className="h-4 w-4 rounded border-slate-300"
                                            />
                                            <span className="font-semibold">Auto battle trainer</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-medium text-slate-600">Thời gian (phút)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={form.autoBattleTrainerDurationMinutes}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerDurationMinutes: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="0 = không hạn"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="block text-[11px] font-medium text-slate-600">Số lượt/ngày</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={form.autoBattleTrainerUsesPerDay}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerUsesPerDay: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="0 = không hạn"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section className={sectionClass}>
                                <h3 className="mb-4 text-sm font-semibold text-slate-900">
                                    Chỉ số bonus
                                </h3>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Kinh nghiệm %</label>
                                        <input
                                            type="number" min="0" step="0.1"
                                            value={form.expBonusPercent}
                                            onChange={(e) => setForm((prev) => ({ ...prev, expBonusPercent: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Xu Bạch Kim %</label>
                                        <input
                                            type="number" min="0" step="0.1"
                                            value={form.platinumCoinBonusPercent}
                                            onChange={(e) => setForm((prev) => ({ ...prev, platinumCoinBonusPercent: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Bắt SS %</label>
                                        <input
                                            type="number" min="0" step="0.1"
                                            value={form.ssCatchRateBonusPercent}
                                            onChange={(e) => setForm((prev) => ({ ...prev, ssCatchRateBonusPercent: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-medium text-slate-600">Rơi đồ %</label>
                                        <input
                                            type="number" min="0" step="0.1"
                                            value={form.itemDropBonusPercent}
                                            onChange={(e) => setForm((prev) => ({ ...prev, itemDropBonusPercent: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1 col-span-1 sm:col-span-2">
                                        <label className="block text-xs font-medium text-slate-600">Quà hàng ngày %</label>
                                        <input
                                            type="number" min="0" step="0.1"
                                            value={form.dailyRewardBonusPercent}
                                            onChange={(e) => setForm((prev) => ({ ...prev, dailyRewardBonusPercent: e.target.value }))}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div className="space-y-1 col-span-1 sm:col-span-2 xl:col-span-4">
                                        <label className="block text-xs font-medium text-slate-600">Quyền lợi khác (mỗi dòng một mục)</label>
                                        <textarea
                                            value={form.customBenefitsText}
                                            onChange={(e) => setForm((prev) => ({ ...prev, customBenefitsText: e.target.value }))}
                                            placeholder="Quyền lợi khác..."
                                            rows={3}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            </section>

                            <button
                                type="submit"
                                disabled={saving}
                                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 transition-colors shadow"
                            >
                                {saving ? 'Đang lưu...' : (editingId ? 'Cập nhật cấp VIP' : 'Tạo cấp VIP')}
                            </button>
                        </div>
                    </form>
                </div>

                <div className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-blue-100 bg-amber-50/60 flex flex-wrap items-center gap-2 justify-between">
                        <div className="font-bold text-slate-800">Danh sách user đang có VIP ({visibleVipUsers.length})</div>
                        <div className="flex flex-wrap items-center w-full sm:w-auto gap-2">
                            <input
                                type="text"
                                value={vipUserSearch}
                                onChange={(e) => setVipUserSearch(e.target.value)}
                                placeholder="Tìm user VIP..."
                                className="px-3 py-1.5 border border-slate-300 rounded text-sm flex-1 min-w-[120px]"
                            />
                            <button
                                type="button"
                                onClick={loadVipUsers}
                                className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold"
                            >
                                Làm mới
                            </button>
                        </div>
                    </div>

                    {vipUsersLoading ? (
                        <div className="p-6 text-center text-slate-500 font-bold">Đang tải danh sách VIP...</div>
                    ) : visibleVipUsers.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 italic">Hiện chưa có user nào đang sở hữu VIP.</div>
                    ) : (
                        <>
                            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 bg-slate-50">
                                {paginatedVipUsers.map((user) => (
                                    <div key={user._id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col h-full">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-slate-900 truncate">
                                                {user.username}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-500 truncate">
                                                {user.email || "Không có email"}
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
                                                    VIP {Math.max(1, Number(user?.vipTierLevel || 1))}
                                                </span>
                                                <span className="font-semibold text-slate-600 text-[10px] bg-slate-100 rounded px-1.5 py-0.5">{user?.vipTierCode || '--'}</span>
                                            </div>
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-slate-100 flex-none">
                                            <label className="mb-1.5 block text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                                                Thời gian hết hạn
                                            </label>
                                            <div className="flex flex-col sm:flex-row gap-2 max-w-full">
                                                <input
                                                    type="datetime-local"
                                                    value={vipExpiryDraftByUserId?.[user._id] || ''}
                                                    onChange={(e) => handleVipExpiryDraftChange(user._id, e.target.value)}
                                                    className={`${inputClass} flex-1 min-w-0`}
                                                />
                                                <button
                                                    type="button"
                                                    className={`${saveBtn} h-[38px] w-full sm:w-auto shrink-0`}
                                                    onClick={() => handleUpdateVipExpiry(user)}
                                                    disabled={updatingVipExpiryUserId === user._id}
                                                >
                                                    {updatingVipExpiryUserId === user._id ? 'Đang lưu...' : 'Lưu'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {vipUserTotalPages > 1 && (
                                <div className="px-4 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
                                    <div className="text-sm text-slate-500">
                                        Trang <span className="font-bold text-slate-800">{vipUserPage}</span> / {vipUserTotalPages}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setVipUserPage((p) => Math.max(1, p - 1))}
                                            disabled={vipUserPage === 1}
                                            className="px-3 py-1.5 border border-slate-300 rounded text-sm font-medium bg-white hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white text-slate-700 transition-colors"
                                        >
                                            Trang trước
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setVipUserPage((p) => Math.min(vipUserTotalPages, p + 1))}
                                            disabled={vipUserPage === vipUserTotalPages}
                                            className="px-3 py-1.5 border border-slate-300 rounded text-sm font-medium bg-white hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-white text-slate-700 transition-colors"
                                        >
                                            Trang tiếp
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-blue-100 bg-blue-50/60 flex flex-wrap items-center gap-2 justify-between">
                        <div className="font-bold text-slate-800">Danh sách đặc quyền VIP ({visibleTiers.length})</div>
                        <div className="flex flex-wrap items-center w-full sm:w-auto gap-2">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Tìm theo mã/tên..."
                                className="px-3 py-1.5 border border-slate-300 rounded text-sm flex-1 min-w-[120px]"
                            />
                            <label className="inline-flex items-center gap-1 text-xs text-slate-600 px-2 py-1 border border-slate-300 rounded bg-white">
                                <input
                                    type="checkbox"
                                    checked={showInactive}
                                    onChange={(e) => setShowInactive(e.target.checked)}
                                />
                                Hiện cả cấp đã tắt
                            </label>
                            <button
                                type="button"
                                onClick={loadTiers}
                                className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold"
                            >
                                Làm mới
                            </button>
                            <button
                                type="button"
                                onClick={handleSyncAllTierUsers}
                                disabled={syncingAllTiers}
                                className="px-2.5 py-1.5 bg-cyan-600 border border-cyan-700 hover:bg-cyan-700 text-white rounded text-xs font-bold disabled:opacity-60"
                            >
                                {syncingAllTiers ? 'Đang đồng bộ tất cả...' : 'Đồng bộ tất cả user VIP'}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 font-medium">
                            {error}
                        </div>
                    )}

                    {syncNotice && (
                        <div className={`mx-4 mt-4 p-3 rounded text-sm font-medium border ${syncNotice.tone === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-cyan-50 border-cyan-200 text-cyan-700'
                            }`}>
                            {syncNotice.message}
                        </div>
                    )}

                    {loading ? (
                        <div className="p-6 text-center text-slate-500 font-bold">Đang tải dữ liệu...</div>
                    ) : visibleTiers.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 italic">Chưa có cấp đặc quyền nào.</div>
                    ) : (
                        <>
                            {/* Desktop View */}
                            <div className="hidden lg:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm mt-4 lg:mx-4 lg:mb-4">
                                <div className="overflow-x-auto" style={{ transform: 'rotateX(180deg)' }}>
                                    <table className="w-full min-w-[860px] text-sm text-slate-700" style={{ transform: 'rotateX(180deg)' }}>
                                        <thead className="bg-slate-50 text-slate-800">
                                            <tr className="border-b border-slate-200">
                                                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Cấp VIP</th>
                                                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Mã</th>
                                                <th className="px-4 py-3 text-left font-semibold">Tên hiển thị</th>
                                                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Trạng thái</th>
                                                <th className="px-4 py-3 text-left font-semibold">Quyền lợi chính</th>
                                                <th className="px-4 py-3 text-left font-semibold min-w-[200px]">Bonus</th>
                                                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap min-w-[180px]">
                                                    Thao tác
                                                </th>
                                            </tr>
                                        </thead>

                                        <tbody className="divide-y divide-slate-100">
                                            {visibleTiers.map((tier) => {
                                                const benefits = tier?.benefits || {}
                                                return (
                                                    <tr
                                                        key={tier._id}
                                                        className="align-middle transition-colors hover:bg-slate-50"
                                                    >
                                                        <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">
                                                            VIP {tier.level}
                                                        </td>

                                                        <td className="px-4 py-3 whitespace-nowrap font-bold text-blue-700">
                                                            {tier.code}
                                                        </td>

                                                        <td className="px-4 py-3 text-slate-700">
                                                            <div className="font-bold">{tier.name}</div>
                                                            <div className="text-xs text-slate-500 line-clamp-2">{tier.description || '--'}</div>
                                                        </td>

                                                        <td className="px-4 py-3 whitespace-nowrap">
                                                            <span
                                                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${tier.isActive
                                                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                                                    : "bg-slate-100 text-slate-500 border border-slate-200"
                                                                    }`}
                                                            >
                                                                {tier.isActive ? "Đang bật" : "Đã tắt"}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-slate-600">
                                                            <div className="space-y-1">
                                                                <div className="flex gap-2">
                                                                    <div className="h-6 w-14 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                                                                        {benefits.titleImageUrl ? (
                                                                            <img src={benefits.titleImageUrl} alt="Danh hiệu" className="max-h-full max-w-full object-contain" />
                                                                        ) : <span className="text-[9px] text-slate-400">Danh hiệu</span>}
                                                                    </div>
                                                                    <div className="h-6 w-14 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                                                                        {benefits.avatarFrameUrl ? (
                                                                            <img src={benefits.avatarFrameUrl} alt="Khung" className="max-h-full max-w-full object-contain" />
                                                                        ) : <span className="text-[9px] text-slate-400">Khung</span>}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span>Tên:</span>
                                                                    <VipUsername userLike={{ role: 'vip', vipBenefits: benefits }} className="font-extrabold">
                                                                        {tier.name || `VIP ${tier.level}`}
                                                                    </VipUsername>
                                                                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                                                                        {benefits.usernameEffect === 'animated' ? 'Chuyển màu' : (benefits.usernameColor ? 'Màu tĩnh' : 'Mặc định')}
                                                                    </span>
                                                                </div>
                                                                <div>Auto tìm: <span className="font-semibold">{benefits.autoSearchEnabled ? 'Bật' : 'Tắt'}</span> ({benefits.autoSearchDurationMinutes ? `${benefits.autoSearchDurationMinutes}p` : 'Vô hạn'} - {benefits.autoSearchUsesPerDay ? `${benefits.autoSearchUsesPerDay}lần/ngày` : 'Vô hạn'})</div>
                                                                <div>Auto battle: <span className="font-semibold">{benefits.autoBattleTrainerEnabled ? 'Bật' : 'Tắt'}</span> ({benefits.autoBattleTrainerDurationMinutes ? `${benefits.autoBattleTrainerDurationMinutes}p` : 'Vô hạn'} - {benefits.autoBattleTrainerUsesPerDay ? `${benefits.autoBattleTrainerUsesPerDay}lần/ngày` : 'Vô hạn'})</div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-xs text-slate-600">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                <span className="inline-flex bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">EXP +{benefits.expBonusPercent || 0}%</span>
                                                                <span className="inline-flex bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">Xu BK +{benefits.platinumCoinBonusPercent ?? benefits.moonPointBonusPercent ?? 0}%</span>
                                                                <span className="inline-flex bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">SS +{benefits.ssCatchRateBonusPercent ?? benefits.catchRateBonusPercent ?? 0}%</span>
                                                                <span className="inline-flex bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">Drop +{benefits.itemDropBonusPercent || 0}%</span>
                                                                <span className="inline-flex bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">Daily +{benefits.dailyRewardBonusPercent || 0}%</span>
                                                            </div>
                                                        </td>

                                                        <td className="px-4 py-3">
                                                            <div className="flex flex-wrap justify-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    className={editBtn}
                                                                    onClick={() => handleEdit(tier)}
                                                                >
                                                                    Sửa
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    className={syncBtn}
                                                                    onClick={() => handleSyncTierUsers(tier)}
                                                                    disabled={syncingTierId === tier._id}
                                                                >
                                                                    {syncingTierId === tier._id ? 'Đồng bộ...' : 'Đồng bộ user'}
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    className={deleteBtn}
                                                                    onClick={() => handleDelete(tier)}
                                                                    disabled={deletingId === tier._id || syncingTierId === tier._id}
                                                                >
                                                                    {deletingId === tier._id ? 'Xóa...' : 'Xóa'}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Mobile View */}
                            <div className="lg:hidden flex flex-col divide-y divide-slate-100">
                                {visibleTiers.map((tier) => {
                                    const benefits = tier?.benefits || {}
                                    return (
                                        <div key={tier._id} className="p-4 space-y-4 hover:bg-blue-50/30">
                                            <div className="flex justify-between items-start gap-2">
                                                <div>
                                                    <div className="inline-flex items-center gap-2">
                                                        <span className="font-bold text-blue-700 text-base">VIP {tier.level}</span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tier.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                            {tier.isActive ? 'Kích hoạt' : 'Đã tắt'}
                                                        </span>
                                                    </div>
                                                    <div className="font-bold text-slate-800 mt-1">{tier.code} - {tier.name}</div>
                                                    <div className="text-xs text-slate-500 break-all">{tier.description || '--'}</div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-700 bg-slate-50 rounded p-3">
                                                <div className="space-y-1.5">
                                                    <div className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-2">Quyền lợi chính</div>
                                                    <div className="flex justify-between items-center bg-white p-1 rounded gap-2">
                                                        <span>Tên:</span>
                                                        <div className="text-right">
                                                            <VipUsername userLike={{ role: 'vip', vipBenefits: benefits }} className="font-extrabold text-sm">
                                                                {tier.name || `VIP ${tier.level}`}
                                                            </VipUsername>
                                                            <div className="text-[10px] text-slate-500">
                                                                {benefits.usernameEffect === 'animated' ? 'Chuyển màu' : (benefits.usernameColor ? 'Màu tĩnh' : 'Mặc định')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between items-center bg-white p-1 rounded">
                                                        <span>Danh hiệu:</span>
                                                        <div className="h-7 w-16 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                            {benefits.titleImageUrl ? (
                                                                <img src={benefits.titleImageUrl} alt="Danh hiệu" className="max-h-full max-w-full object-contain" />
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">--</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-between items-center bg-white p-1 rounded">
                                                        <span>Khung:</span>
                                                        <div className="h-7 w-16 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                            {benefits.avatarFrameUrl ? (
                                                                <img src={benefits.avatarFrameUrl} alt="Khung" className="max-h-full max-w-full object-contain" />
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">--</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-1 mt-2">
                                                        <div className="bg-white p-1.5 rounded">
                                                            <span className="text-[10px] text-slate-500 block">Auto tìm</span>
                                                            <span className="font-bold text-slate-800">{benefits.autoSearchEnabled ? 'Bật' : 'Tắt'}</span>
                                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                                {Number(benefits.autoSearchDurationMinutes || 0) > 0 ? `${benefits.autoSearchDurationMinutes}p` : 'Vô hạn'}
                                                                {' • '}
                                                                {Number(benefits.autoSearchUsesPerDay || 0) > 0 ? `${benefits.autoSearchUsesPerDay}/ngày` : 'Vô hạn'}
                                                            </div>
                                                        </div>
                                                        <div className="bg-white p-1.5 rounded">
                                                            <span className="text-[10px] text-slate-500 block">Auto battle</span>
                                                            <span className="font-bold text-slate-800">{benefits.autoBattleTrainerEnabled ? 'Bật' : 'Tắt'}</span>
                                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                                {Number(benefits.autoBattleTrainerDurationMinutes || 0) > 0 ? `${benefits.autoBattleTrainerDurationMinutes}p` : 'Vô hạn'}
                                                                {' • '}
                                                                {Number(benefits.autoBattleTrainerUsesPerDay || 0) > 0 ? `${benefits.autoBattleTrainerUsesPerDay}/ngày` : 'Vô hạn'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <div className="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-2">Thưởng chỉ số</div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="bg-white px-2 py-1.5 rounded flex justify-between items-center border border-slate-100">
                                                            <span className="text-slate-500 font-medium tracking-tight">EXP:</span>
                                                            <span className="font-bold text-emerald-600 text-right shrink-0">+{benefits.expBonusPercent || 0}%</span>
                                                        </div>
                                                        <div className="bg-white px-2 py-1.5 rounded flex justify-between items-center border border-slate-100">
                                                            <span className="text-slate-500 font-medium tracking-tight">Xu Bạch Kim:</span>
                                                            <span className="font-bold text-blue-600 text-right shrink-0">+{benefits.platinumCoinBonusPercent ?? benefits.moonPointBonusPercent ?? 0}%</span>
                                                        </div>
                                                        <div className="bg-white px-2 py-1.5 rounded flex justify-between items-center border border-slate-100">
                                                            <span className="text-slate-500 font-medium tracking-tight">Bắt SS:</span>
                                                            <span className="font-bold text-purple-600 text-right shrink-0">+{benefits.ssCatchRateBonusPercent ?? benefits.catchRateBonusPercent ?? 0}%</span>
                                                        </div>
                                                        <div className="bg-white px-2 py-1.5 rounded flex justify-between items-center border border-slate-100">
                                                            <span className="text-slate-500 font-medium tracking-tight">Drop:</span>
                                                            <span className="font-bold text-amber-600 text-right shrink-0">+{benefits.itemDropBonusPercent || 0}%</span>
                                                        </div>
                                                        <div className="bg-white px-2 py-1.5 rounded flex justify-between items-center border border-slate-100 col-span-2">
                                                            <span className="text-slate-500 font-medium tracking-tight">Daily:</span>
                                                            <span className="font-bold text-rose-600 text-right shrink-0">+{benefits.dailyRewardBonusPercent || 0}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-200/50">
                                                <button
                                                    type="button"
                                                    onClick={() => handleEdit(tier)}
                                                    className={editBtn}
                                                >
                                                    Sửa
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSyncTierUsers(tier)}
                                                    disabled={syncingTierId === tier._id}
                                                    className={syncBtn}
                                                >
                                                    {syncingTierId === tier._id ? 'Đồng bộ...' : 'Đồng bộ user'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(tier)}
                                                    disabled={deletingId === tier._id || syncingTierId === tier._id}
                                                    className={deleteBtn}
                                                >
                                                    {deletingId === tier._id ? 'Đang xóa...' : 'Xóa'}
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
