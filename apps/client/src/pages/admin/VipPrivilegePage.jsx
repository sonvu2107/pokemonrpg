import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { vipTierApi } from '../../services/adminApi'

const createDefaultTierForm = () => ({
    code: '',
    name: '',
    level: '1',
    description: '',
    isActive: true,
    title: '',
    titleImageUrl: '',
    avatarFrameUrl: '',
    autoSearchEnabled: true,
    autoSearchDurationMinutes: '0',
    autoSearchUsesPerDay: '0',
    autoBattleTrainerEnabled: true,
    autoBattleTrainerDurationMinutes: '0',
    autoBattleTrainerUsesPerDay: '0',
    expBonusPercent: '0',
    moonPointBonusPercent: '0',
    catchRateBonusPercent: '0',
    itemDropBonusPercent: '0',
    dailyRewardBonusPercent: '0',
    customBenefitsText: '',
})

const parsePercent = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.min(1000, Math.round(parsed * 100) / 100)
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
        autoSearchEnabled: benefits?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: String(benefits?.autoSearchDurationMinutes ?? base.autoSearchDurationMinutes),
        autoSearchUsesPerDay: String(benefits?.autoSearchUsesPerDay ?? base.autoSearchUsesPerDay),
        autoBattleTrainerEnabled: benefits?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: String(benefits?.autoBattleTrainerDurationMinutes ?? base.autoBattleTrainerDurationMinutes),
        autoBattleTrainerUsesPerDay: String(benefits?.autoBattleTrainerUsesPerDay ?? base.autoBattleTrainerUsesPerDay),
        expBonusPercent: String(benefits?.expBonusPercent ?? base.expBonusPercent),
        moonPointBonusPercent: String(benefits?.moonPointBonusPercent ?? base.moonPointBonusPercent),
        catchRateBonusPercent: String(benefits?.catchRateBonusPercent ?? base.catchRateBonusPercent),
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
            autoSearchEnabled: Boolean(form.autoSearchEnabled),
            autoSearchDurationMinutes: Math.max(0, parseInt(form.autoSearchDurationMinutes, 10) || 0),
            autoSearchUsesPerDay: Math.max(0, parseInt(form.autoSearchUsesPerDay, 10) || 0),
            autoBattleTrainerEnabled: Boolean(form.autoBattleTrainerEnabled),
            autoBattleTrainerDurationMinutes: Math.max(0, parseInt(form.autoBattleTrainerDurationMinutes, 10) || 0),
            autoBattleTrainerUsesPerDay: Math.max(0, parseInt(form.autoBattleTrainerUsesPerDay, 10) || 0),
            expBonusPercent: parsePercent(form.expBonusPercent),
            moonPointBonusPercent: parsePercent(form.moonPointBonusPercent),
            catchRateBonusPercent: parsePercent(form.catchRateBonusPercent),
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
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [showInactive, setShowInactive] = useState(true)
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState('')
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

    useEffect(() => {
        loadTiers()
    }, [showInactive])

    const visibleTiers = useMemo(() => {
        const keyword = search.trim().toLowerCase()
        if (!keyword) return tiers
        return tiers.filter((tier) => {
            const text = `${tier.code || ''} ${tier.name || ''} ${tier.description || ''}`.toLowerCase()
            return text.includes(keyword)
        })
    }, [tiers, search])

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
            const payload = buildPayloadFromForm(form)
            if (editingId) {
                await vipTierApi.update(editingId, payload)
            } else {
                await vipTierApi.create(payload)
            }
            await loadTiers()
            resetForm()
        } catch (err) {
            setError(err.message || 'Không thể lưu cấu hình đặc quyền VIP')
        } finally {
            setSaving(false)
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
            await loadTiers()
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
            await loadTiers()
        } catch (err) {
            setError(err.message || 'Không thể tạo dải cấp VIP')
        } finally {
            setRangeSubmitting(false)
        }
    }

    const handleUploadAsset = async (type, file) => {
        if (!file) return
        if (!String(file.type || '').startsWith('image/')) {
            setError('Chỉ hỗ trợ tải tệp hình ảnh')
            return
        }

        const key = type === 'title' ? 'title' : 'frame'
        try {
            setError('')
            setUploadingAsset((prev) => ({ ...prev, [key]: true }))
            const res = await vipTierApi.uploadImage(file)
            const imageUrl = String(res?.imageUrl || '').trim()
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
                        <div className="grid grid-cols-2 gap-2">
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

                    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-blue-200 shadow-sm p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
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

                        <div className="grid grid-cols-2 gap-2">
                            <input
                                type="text"
                                value={form.code}
                                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                                placeholder="Mã (VD: VIP1)"
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                            />
                            <input
                                type="number"
                                min="1"
                                max="9999"
                                value={form.level}
                                onChange={(e) => setForm((prev) => ({ ...prev, level: e.target.value }))}
                                placeholder="Cấp"
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                            />
                        </div>

                        <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="Tên cấp VIP"
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />

                        <textarea
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            placeholder="Mô tả ngắn"
                            rows={2}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />

                        <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 space-y-3">
                            <div className="text-xs font-bold text-blue-900 uppercase tracking-wide">Ảnh thưởng hiển thị (Upload)</div>

                            <div className="grid grid-cols-2 gap-3">
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
                        </div>

                        <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                            <div className="text-xs font-bold text-emerald-900 uppercase tracking-wide">Tinh chỉnh các loại Auto</div>
                            <AutoOptionRow
                                label="Auto tìm kiếm bản đồ"
                                description="Cho phép VIP bật/tắt tự động tìm Pokémon trong map (kèm rule auto)."
                                checked={form.autoSearchEnabled}
                                onChange={(e) => setForm((prev) => ({ ...prev, autoSearchEnabled: e.target.checked }))}
                            />
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                    <div className="font-semibold text-slate-700 mb-1">Thời gian dùng Auto tìm (phút)</div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.autoSearchDurationMinutes}
                                        onChange={(e) => setForm((prev) => ({ ...prev, autoSearchDurationMinutes: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                        placeholder="0 = không giới hạn"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                    <div className="font-semibold text-slate-700 mb-1">Số lượt Auto tìm mỗi ngày</div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.autoSearchUsesPerDay}
                                        onChange={(e) => setForm((prev) => ({ ...prev, autoSearchUsesPerDay: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                        placeholder="0 = không giới hạn"
                                    />
                                </label>
                            </div>
                            <AutoOptionRow
                                label="Auto battle trainer"
                                description="Cho phép VIP bật/tắt tự động đánh trong chế độ battle trainer."
                                checked={form.autoBattleTrainerEnabled}
                                onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerEnabled: e.target.checked }))}
                            />
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                    <div className="font-semibold text-slate-700 mb-1">Thời gian dùng Auto battle (phút)</div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.autoBattleTrainerDurationMinutes}
                                        onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerDurationMinutes: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                        placeholder="0 = không giới hạn"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5">
                                    <div className="font-semibold text-slate-700 mb-1">Số lượt Auto battle mỗi ngày</div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.autoBattleTrainerUsesPerDay}
                                        onChange={(e) => setForm((prev) => ({ ...prev, autoBattleTrainerUsesPerDay: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                        placeholder="0 = không giới hạn"
                                    />
                                </label>
                            </div>
                        </div>

                        <label className="flex items-center gap-2 px-2 py-1.5 border border-slate-200 rounded text-sm">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                            />
                            Kích hoạt cấp VIP này
                        </label>

                        <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                            <div className="text-xs font-bold text-amber-900 uppercase tracking-wide">Thưởng chỉ số</div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
                                    <div className="font-semibold text-slate-700 mb-1">Thưởng kinh nghiệm (EXP) %</div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={form.expBonusPercent}
                                        onChange={(e) => setForm((prev) => ({ ...prev, expBonusPercent: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
                                    <div className="font-semibold text-slate-700 mb-1">Thưởng điểm Nguyệt Các %</div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={form.moonPointBonusPercent}
                                        onChange={(e) => setForm((prev) => ({ ...prev, moonPointBonusPercent: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
                                    <div className="font-semibold text-slate-700 mb-1">Thưởng tỉ lệ bắt Pokémon %</div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={form.catchRateBonusPercent}
                                        onChange={(e) => setForm((prev) => ({ ...prev, catchRateBonusPercent: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs">
                                    <div className="font-semibold text-slate-700 mb-1">Thưởng tỉ lệ rơi vật phẩm %</div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={form.itemDropBonusPercent}
                                        onChange={(e) => setForm((prev) => ({ ...prev, itemDropBonusPercent: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                    />
                                </label>
                                <label className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs col-span-2">
                                    <div className="font-semibold text-slate-700 mb-1">Thưởng quà đăng nhập hằng ngày %</div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={form.dailyRewardBonusPercent}
                                        onChange={(e) => setForm((prev) => ({ ...prev, dailyRewardBonusPercent: e.target.value }))}
                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                    />
                                </label>
                            </div>
                        </div>

                        <textarea
                            value={form.customBenefitsText}
                            onChange={(e) => setForm((prev) => ({ ...prev, customBenefitsText: e.target.value }))}
                            placeholder="Quyền lợi khác, mỗi dòng một mục"
                            rows={4}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                        />

                        <button
                            type="submit"
                            disabled={saving}
                            className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-bold disabled:opacity-60"
                        >
                            {saving ? 'Đang lưu...' : (editingId ? 'Cập nhật cấp VIP' : 'Tạo cấp VIP')}
                        </button>
                    </form>
                </div>

                <div className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-blue-100 bg-blue-50/60 flex flex-wrap items-center gap-2 justify-between">
                        <div className="font-bold text-slate-800">Danh sách đặc quyền VIP ({visibleTiers.length})</div>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Tìm theo mã/tên..."
                                className="px-3 py-1.5 border border-slate-300 rounded text-sm"
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
                        </div>
                    </div>

                    {error && (
                        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 font-medium">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="p-6 text-center text-slate-500 font-bold">Đang tải dữ liệu...</div>
                    ) : visibleTiers.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 italic">Chưa có cấp đặc quyền nào.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[860px]">
                                <thead className="bg-slate-50 text-slate-700 text-xs uppercase">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Cấp</th>
                                        <th className="px-3 py-2 text-left">Mã / Tên</th>
                                        <th className="px-3 py-2 text-left">Quyền lợi chính</th>
                                        <th className="px-3 py-2 text-left">Bonus</th>
                                        <th className="px-3 py-2 text-center">Trạng thái</th>
                                        <th className="px-3 py-2 text-center">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {visibleTiers.map((tier) => {
                                        const benefits = tier?.benefits || {}
                                        return (
                                            <tr key={tier._id} className="hover:bg-blue-50/30">
                                                <td className="px-3 py-2 font-bold text-blue-700">VIP {tier.level}</td>
                                                <td className="px-3 py-2">
                                                    <div className="font-bold text-slate-800">{tier.code} - {tier.name}</div>
                                                    <div className="text-xs text-slate-500 break-all">{tier.description || '--'}</div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-700">
                                                    <div className="flex items-center gap-2">
                                                        <span>Danh hiệu:</span>
                                                        <div className="h-7 w-16 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                                                            {benefits.titleImageUrl ? (
                                                                <img
                                                                    src={benefits.titleImageUrl}
                                                                    alt="Danh hiệu"
                                                                    className="max-h-full max-w-full object-contain"
                                                                />
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">--</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>Auto tìm: <span className="font-semibold">{benefits.autoSearchEnabled ? 'Bật' : 'Tắt'}</span></div>
                                                    <div>Thời gian Auto tìm: <span className="font-semibold">{Number(benefits.autoSearchDurationMinutes || 0) > 0 ? `${benefits.autoSearchDurationMinutes} phút` : 'Không giới hạn'}</span></div>
                                                    <div>Số lượt Auto tìm/ngày: <span className="font-semibold">{Number(benefits.autoSearchUsesPerDay || 0) > 0 ? benefits.autoSearchUsesPerDay : 'Không giới hạn'}</span></div>
                                                    <div>Auto battle: <span className="font-semibold">{benefits.autoBattleTrainerEnabled ? 'Bật' : 'Tắt'}</span></div>
                                                    <div>Thời gian Auto battle: <span className="font-semibold">{Number(benefits.autoBattleTrainerDurationMinutes || 0) > 0 ? `${benefits.autoBattleTrainerDurationMinutes} phút` : 'Không giới hạn'}</span></div>
                                                    <div>Số lượt Auto battle/ngày: <span className="font-semibold">{Number(benefits.autoBattleTrainerUsesPerDay || 0) > 0 ? benefits.autoBattleTrainerUsesPerDay : 'Không giới hạn'}</span></div>
                                                    <div className="flex items-center gap-2">
                                                        <span>Khung:</span>
                                                        <div className="h-7 w-16 rounded border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                                                            {benefits.avatarFrameUrl ? (
                                                                <img
                                                                    src={benefits.avatarFrameUrl}
                                                                    alt="Khung"
                                                                    className="max-h-full max-w-full object-contain"
                                                                />
                                                            ) : (
                                                                <span className="text-[10px] text-slate-400">--</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-700">
                                                    <div>EXP: <span className="font-semibold">+{benefits.expBonusPercent || 0}%</span></div>
                                                    <div>Moon: <span className="font-semibold">+{benefits.moonPointBonusPercent || 0}%</span></div>
                                                    <div>Catch: <span className="font-semibold">+{benefits.catchRateBonusPercent || 0}%</span></div>
                                                    <div>Drop: <span className="font-semibold">+{benefits.itemDropBonusPercent || 0}%</span></div>
                                                    <div>Daily: <span className="font-semibold">+{benefits.dailyRewardBonusPercent || 0}%</span></div>
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tier.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {tier.isActive ? 'Kích hoạt' : 'Đã tắt'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <div className="inline-flex gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleEdit(tier)}
                                                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-bold"
                                                        >
                                                            Sửa
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDelete(tier)}
                                                            disabled={deletingId === tier._id}
                                                            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold disabled:opacity-60"
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
                    )}
                </div>
            </div>
        </div>
    )
}
