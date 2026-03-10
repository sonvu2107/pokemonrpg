import { useEffect, useMemo, useState } from 'react'
import { badgeAdminApi } from '../../services/adminApi'
import { uploadToCloudinary, validateImageFile } from '../../utils/cloudinaryUtils'

const BADGE_IMAGE_TRANSFORMATION = 'e_trim/c_pad,w_512,h_512,b_transparent/f_auto/q_auto:good'

const MISSION_OPTIONS = [
    { value: 'collect_type_count', label: 'Sở hữu theo hệ (tính trùng, tính form)' },
    { value: 'collect_type_distinct_count', label: 'Sở hữu theo hệ (không trùng, tính form)' },
    { value: 'collect_same_name_different_type_count', label: 'Cùng tên nhưng khác hệ (tính form)' },
    { value: 'collect_total_count', label: 'Tổng số Pokémon đã sở hữu (có trùng, tính form)' },
    { value: 'vip_tier_reached', label: 'Đạt mốc VIP' },
    { value: 'platinum_coins_owned_count', label: 'Sở hữu Xu Bạch Kim' },
    { value: 'catch_fail_count', label: 'Bắt trượt Pokémon' },
    { value: 'online_hours_count', label: 'Tổng số giờ online' },
    { value: 'complete_trainer_count', label: 'Hoàn thành huấn luyện viên' },
]

const EFFECT_OPTIONS = [
    { value: 'party_damage_percent', label: '% sát thương toàn đội' },
    { value: 'party_speed_percent', label: '% tốc độ toàn đội' },
    { value: 'party_hp_percent', label: '% máu toàn đội' },
    { value: 'party_type_damage_percent', label: '% sát thương theo hệ' },
]

const BADGE_RANK_OPTIONS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS']

const badgeRankClassMap = {
    D: 'border-slate-300 bg-slate-100 text-slate-700',
    C: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    B: 'border-sky-300 bg-sky-50 text-sky-700',
    A: 'border-violet-300 bg-violet-50 text-violet-700',
    S: 'border-orange-300 bg-orange-50 text-orange-700',
    SS: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    SSS: 'border-rose-300 bg-gradient-to-r from-rose-50 to-amber-50 text-rose-700',
}

const getBadgeRankClasses = (rank = 'D') => badgeRankClassMap[String(rank || 'D').toUpperCase()] || badgeRankClassMap.D

const POKEMON_TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']

const createDefaultForm = () => ({
    name: '',
    description: '',
    imageUrl: '',
    rank: 'D',
    isActive: true,
    orderIndex: '0',
    missionType: 'collect_type_count',
    missionConfig: {
        pokemonType: 'fire',
        pokemonName: '',
        requiredCount: '100',
    },
    rewardEffects: [{ effectType: 'party_type_damage_percent', percent: '5', pokemonType: 'fire' }],
})

const normalizeBadgeToForm = (badge = null) => {
    const base = createDefaultForm()
    if (!badge) return base
    return {
        name: String(badge.name || ''),
        description: String(badge.description || ''),
        imageUrl: String(badge.imageUrl || ''),
        rank: String(badge.rank || 'D').toUpperCase(),
        isActive: badge.isActive !== false,
        orderIndex: String(badge.orderIndex ?? 0),
        missionType: String(badge.missionType || base.missionType),
        missionConfig: {
            pokemonType: String(badge?.missionConfig?.pokemonType || base.missionConfig.pokemonType),
            pokemonName: String(badge?.missionConfig?.pokemonName || base.missionConfig.pokemonName),
            requiredCount: String(badge?.missionConfig?.requiredCount ?? base.missionConfig.requiredCount),
        },
        rewardEffects: Array.isArray(badge.rewardEffects) && badge.rewardEffects.length > 0
            ? badge.rewardEffects.map((entry) => ({
                effectType: String(entry.effectType || 'party_damage_percent'),
                percent: String(entry.percent ?? '0'),
                pokemonType: String(entry.pokemonType || ''),
            }))
            : base.rewardEffects,
    }
}

const buildPayload = (form) => ({
    name: String(form.name || '').trim(),
    description: String(form.description || '').trim(),
    imageUrl: String(form.imageUrl || '').trim(),
    rank: String(form.rank || 'D').trim().toUpperCase(),
    isActive: Boolean(form.isActive),
    orderIndex: Math.max(0, parseInt(form.orderIndex, 10) || 0),
    missionType: String(form.missionType || '').trim(),
    missionConfig: {
        pokemonType: String(form?.missionConfig?.pokemonType || '').trim(),
        pokemonName: String(form?.missionConfig?.pokemonName || '').trim(),
        requiredCount: Math.max(1, parseInt(form?.missionConfig?.requiredCount, 10) || 1),
    },
    rewardEffects: (Array.isArray(form.rewardEffects) ? form.rewardEffects : []).map((entry) => ({
        effectType: String(entry.effectType || '').trim(),
        percent: Math.max(0, Number(entry.percent) || 0),
        pokemonType: String(entry.pokemonType || '').trim(),
    })),
})

const buildSlugPreview = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

const buildCodePreview = (value = '') => buildSlugPreview(value)
    .replace(/-/g, '_')
    .toUpperCase()
    .slice(0, 48)

const InlineHelp = ({ title, text }) => (
    <div className="rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-900">
        <span className="font-bold">{title}:</span> {text}
    </div>
)

const FieldBlock = ({ title, hint = '', children, tone = 'slate' }) => {
    const toneClass = tone === 'amber'
        ? 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50'
        : tone === 'blue'
            ? 'border-blue-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50'
            : 'border-slate-200 bg-white'

    return (
        <section className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
            <div className="mb-3">
                <div className="text-sm font-bold text-slate-800">{title}</div>
                {hint ? <div className="text-xs font-medium text-slate-500 mt-1">{hint}</div> : null}
            </div>
            {children}
        </section>
    )
}

export default function BadgeManagerPage() {
    const [badges, setBadges] = useState([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState(null)
    const [editingId, setEditingId] = useState('')
    const [form, setForm] = useState(createDefaultForm())
    const [uploadingImage, setUploadingImage] = useState(false)

    const loadBadges = async () => {
        try {
            setLoading(true)
            setError('')
            const response = await badgeAdminApi.list({ page, limit: 10, search: search.trim() })
            setBadges(Array.isArray(response?.badges) ? response.badges : [])
            setPagination(response?.pagination || null)
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách huy hiệu')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadBadges()
    }, [page, search])

    const visibleBadges = useMemo(() => badges, [badges])

    const slugPreview = useMemo(() => buildSlugPreview(form.name || ''), [form.name])
    const codePreview = useMemo(() => buildCodePreview(form.name || ''), [form.name])

    const totalBadges = Math.max(0, Number(pagination?.total || 0))
    const totalPages = Math.max(1, Number(pagination?.pages || 1))
    const currentPage = Math.max(1, Number(pagination?.page || page))

    const resetForm = () => {
        setEditingId('')
        setForm(createDefaultForm())
    }

    const handleSearchChange = (value) => {
        setSearch(value)
        setPage(1)
    }

    const handleUploadImage = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        try {
            const validationError = validateImageFile(file)
            if (validationError) {
                setError(validationError)
                return
            }

            setUploadingImage(true)
            setError('')

            let imageUrl = ''
            try {
                imageUrl = await uploadToCloudinary(file, undefined, {
                    folder: 'pokemon/vip-assets',
                    transformation: BADGE_IMAGE_TRANSFORMATION,
                })
            } catch (uploadError) {
                const errorMessage = String(uploadError?.message || '').toLowerCase()
                const isTransformationBlocked = errorMessage.includes('transformation')
                    && (
                        errorMessage.includes('invalid')
                        || errorMessage.includes('not allowed')
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

            setForm((prev) => ({ ...prev, imageUrl }))
        } catch (err) {
            setError(err.message || 'Không thể tải ảnh huy hiệu')
        } finally {
            setUploadingImage(false)
        }
    }

    const handleSubmit = async (event) => {
        event.preventDefault()
        try {
            setSaving(true)
            setError('')
            const payload = buildPayload(form)
            if (editingId) {
                await badgeAdminApi.update(editingId, payload)
            } else {
                await badgeAdminApi.create(payload)
            }
            await loadBadges()
            resetForm()
            setPage(1)
        } catch (err) {
            setError(err.message || 'Không thể lưu huy hiệu')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (badge) => {
        if (!confirm(`Bạn có chắc muốn xóa huy hiệu ${badge?.name || badge?.code}?`)) return
        try {
            await badgeAdminApi.delete(badge._id)
            if (visibleBadges.length === 1 && currentPage > 1) {
                setPage((prev) => Math.max(1, prev - 1))
                return
            }
            await loadBadges()
            if (editingId === badge._id) resetForm()
        } catch (err) {
            setError(err.message || 'Không thể xóa huy hiệu')
        }
    }

    const missionNeedsType = form.missionType === 'collect_type_count' || form.missionType === 'collect_type_distinct_count'
    const missionNeedsPokemonName = form.missionType === 'collect_same_name_different_type_count'
    const missionCountPlaceholder = form.missionType === 'online_hours_count'
        ? 'Mốc số giờ online cần đạt'
        : form.missionType === 'vip_tier_reached'
            ? 'Mốc VIP cần đạt (ví dụ: 3)'
            : form.missionType === 'platinum_coins_owned_count'
                ? 'Số Xu Bạch Kim cần sở hữu'
                : form.missionType === 'catch_fail_count'
                    ? 'Số lần bắt trượt cần đạt'
                    : 'Mốc số lượng cần đạt'

    return (
        <div className="rounded-2xl border border-blue-300 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-blue-300 bg-gradient-to-r from-blue-600 via-cyan-500 to-sky-400 px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Huy Hiệu</h1>
                    </div>
                    <button type="button" onClick={resetForm} className="px-3 py-2 bg-white hover:bg-blue-50 text-blue-700 rounded-xl text-sm font-bold shadow-sm transition-colors">
                        + Tạo huy hiệu mới
                    </button>
                </div>
            </div>

            <div className="p-4 space-y-4 bg-slate-50/60">
                {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <FieldBlock title={editingId ? 'Đang chỉnh sửa huy hiệu' : 'Tạo huy hiệu mới'} hint="Điền thông tin cơ bản để định danh và hiển thị huy hiệu." tone="blue">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Tên huy hiệu" className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                            <input value={form.orderIndex} onChange={(e) => setForm((prev) => ({ ...prev, orderIndex: e.target.value }))} placeholder="Thứ tự hiển thị" className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                <span className="font-bold text-slate-700">Slug tự tạo:</span>{' '}
                                <span className="font-mono">{slugPreview || 'se-duoc-tao-tu-ten-huy-hieu'}</span>
                            </div>
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                <span className="font-bold text-slate-700">Mã nội bộ tự tạo:</span>{' '}
                                <span className="font-mono">{codePreview || 'BADGE'}</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <InlineHelp title="Slug" text="Được hệ thống tự tạo để định danh thân thiện, dùng cho URL và dữ liệu nội bộ." />
                            <InlineHelp title="Mã nội bộ" text="Chỉ dùng cho hệ thống quản trị và dữ liệu nền, người chơi sẽ không nhìn thấy." />
                        </div>
                        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-3 items-center">
                            <select value={form.rank} onChange={(e) => setForm((prev) => ({ ...prev, rank: e.target.value }))} className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                {BADGE_RANK_OPTIONS.map((rank) => <option key={rank} value={rank}>Hạng {rank}</option>)}
                            </select>
                            <div>
                                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black tracking-wide ${getBadgeRankClasses(form.rank)}`}>
                                    Hạng {form.rank}
                                </span>
                            </div>
                        </div>
                        <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows="3" placeholder="Mô tả ngắn về huy hiệu" className="w-full mt-3 px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                    </FieldBlock>

                    <FieldBlock title="Hình ảnh huy hiệu" hint="Có thể tải ảnh lên giống cơ chế ảnh danh hiệu VIP, hoặc dán trực tiếp đường dẫn ảnh." tone="amber">
                        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr,0.8fr] gap-4 items-start">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-xs font-bold uppercase text-slate-600">Nguồn ảnh</div>
                                    <label className="px-3 py-1.5 border border-blue-300 bg-blue-50 text-blue-700 text-xs font-bold cursor-pointer rounded-full">
                                        {uploadingImage ? 'Đang tải ảnh...' : 'Tải ảnh lên'}
                                        <input type="file" accept="image/*" className="hidden" onChange={handleUploadImage} />
                                    </label>
                                </div>
                                <input value={form.imageUrl} onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value }))} placeholder="Dán đường dẫn ảnh huy hiệu" className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                            </div>
                            <div className="rounded-2xl border border-amber-200 bg-white p-3">
                                <div className="text-xs font-bold text-slate-500 mb-2">Xem trước</div>
                                <div className="h-32 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                    {form.imageUrl ? <img src={form.imageUrl} alt="Xem trước huy hiệu" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">Chưa có ảnh</span>}
                                </div>
                            </div>
                        </div>
                    </FieldBlock>

                    <FieldBlock title="Điều kiện mở khóa" hint="Chọn kiểu nhiệm vụ mà người chơi cần hoàn thành để mở huy hiệu.">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <select value={form.missionType} onChange={(e) => setForm((prev) => ({ ...prev, missionType: e.target.value }))} className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                {MISSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <input value={form.missionConfig.requiredCount} onChange={(e) => setForm((prev) => ({ ...prev, missionConfig: { ...prev.missionConfig, requiredCount: e.target.value } }))} placeholder={missionCountPlaceholder} className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                        </div>
                        {missionNeedsType && (
                            <select value={form.missionConfig.pokemonType} onChange={(e) => setForm((prev) => ({ ...prev, missionConfig: { ...prev.missionConfig, pokemonType: e.target.value } }))} className="w-full mt-3 px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                {POKEMON_TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                            </select>
                        )}
                        {missionNeedsPokemonName && (
                            <input
                                value={form.missionConfig.pokemonName}
                                onChange={(e) => setForm((prev) => ({ ...prev, missionConfig: { ...prev.missionConfig, pokemonName: e.target.value } }))}
                                placeholder="Tên Pokémon (ví dụ: pikachu)"
                                className="w-full mt-3 px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white"
                            />
                        )}
                    </FieldBlock>

                    <FieldBlock title="Chỉ số thưởng" hint="Có thể thêm nhiều hiệu ứng để tạo huy hiệu phong phú hơn.">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                            <div className="text-xs font-bold uppercase text-slate-600">Danh sách hiệu ứng</div>
                            <button type="button" onClick={() => setForm((prev) => ({ ...prev, rewardEffects: [...prev.rewardEffects, { effectType: 'party_damage_percent', percent: '1', pokemonType: '' }] }))} className="px-3 py-1.5 border border-blue-300 bg-blue-50 text-blue-700 text-xs font-bold rounded-full">
                                + Thêm chỉ số
                            </button>
                        </div>
                        <div className="space-y-3">
                            {form.rewardEffects.map((effect, index) => (
                                <div key={`${effect.effectType}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                    <div className="grid grid-cols-1 lg:grid-cols-[1.3fr,140px,1fr,90px] gap-2 items-center">
                                        <select value={effect.effectType} onChange={(e) => setForm((prev) => ({ ...prev, rewardEffects: prev.rewardEffects.map((entry, idx) => idx === index ? { ...entry, effectType: e.target.value } : entry) }))} className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                            {EFFECT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                        <input value={effect.percent} onChange={(e) => setForm((prev) => ({ ...prev, rewardEffects: prev.rewardEffects.map((entry, idx) => idx === index ? { ...entry, percent: e.target.value } : entry) }))} placeholder="Phần trăm" className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white" />
                                        {effect.effectType === 'party_type_damage_percent' ? (
                                            <select value={effect.pokemonType} onChange={(e) => setForm((prev) => ({ ...prev, rewardEffects: prev.rewardEffects.map((entry, idx) => idx === index ? { ...entry, pokemonType: e.target.value } : entry) }))} className="px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                                <option value="">Chọn hệ</option>
                                                {POKEMON_TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                                            </select>
                                        ) : <div className="text-xs text-slate-500 px-2">Hiệu ứng này không cần chọn hệ.</div>}
                                        <button type="button" onClick={() => setForm((prev) => ({ ...prev, rewardEffects: prev.rewardEffects.filter((_, idx) => idx !== index) }))} className="px-2 py-2.5 border border-red-300 bg-red-50 text-red-700 text-xs font-bold rounded-xl">
                                            Xóa
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </FieldBlock>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between shadow-sm">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))} className="accent-blue-600" />
                            Kích hoạt huy hiệu này ngay sau khi lưu
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full md:w-auto">
                            <button type="button" onClick={resetForm} className="px-4 py-2 border border-slate-300 bg-white text-slate-700 text-sm font-bold rounded-xl w-full">Làm mới</button>
                            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 w-full">
                                {saving ? 'Đang lưu...' : (editingId ? 'Cập nhật huy hiệu' : 'Tạo huy hiệu')}
                            </button>
                        </div>
                    </div>
                </form>

                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-bold text-slate-800">Danh sách huy hiệu</div>
                            <div className="text-xs font-medium text-slate-500 mt-1">Chọn một dòng để chỉnh sửa nhanh, hoặc tìm kiếm theo tên, mã, slug.</div>
                            <div className="text-xs font-semibold text-slate-400 mt-1">Tổng cộng: {totalBadges.toLocaleString('vi-VN')} huy hiệu</div>
                        </div>
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder="Tìm theo tên, mã hoặc slug..."
                            className="w-full md:w-80 px-3 py-2 border border-slate-300 rounded-xl text-sm"
                        />
                    </div>

                    <div className="block md:hidden p-3 space-y-3 bg-slate-50/50">
                        {!loading && visibleBadges.length === 0 ? (
                            <div className="py-8 text-center italic text-slate-500">Chưa có huy hiệu</div>
                        ) : visibleBadges.map((badge) => (
                            <article key={badge._id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-3">
                                <div className="flex items-start gap-3">
                                    <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                                        {badge.imageUrl ? <img src={badge.imageUrl} alt={badge.name} className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-slate-400">Chưa có ảnh</span>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-base leading-5 text-slate-800 break-words">{badge.name}</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${getBadgeRankClasses(badge.rank)}`}>
                                                Hạng {badge.rank || 'D'}
                                            </span>
                                            <span className="text-xs font-semibold text-slate-400">Nội bộ</span>
                                        </div>
                                    </div>
                                </div>

                                {badge.description ? <div className="text-sm text-slate-600 break-words">{badge.description}</div> : null}

                                <div className="grid grid-cols-1 gap-2 text-sm">
                                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Nhiệm vụ</div>
                                        <div className="mt-1 text-slate-700">{badge.missionLabel}</div>
                                    </div>
                                    <div className="rounded-xl bg-sky-50 px-3 py-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700">Chỉ số thưởng</div>
                                        <div className="mt-1 text-sky-900">{badge.rewardLabel}</div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    <span className={`inline-flex whitespace-nowrap rounded-full px-4 py-2 text-xs font-bold ${badge.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {badge.isActive ? 'Đang bật' : 'Đang tắt'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setEditingId(badge._id); setForm(normalizeBadgeToForm(badge)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                                        className="whitespace-nowrap px-4 py-2.5 border border-blue-200 bg-blue-50 text-blue-700 text-sm font-bold rounded-xl shadow-sm transition-colors hover:bg-blue-600 hover:text-white"
                                    >
                                        Chỉnh sửa
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(badge)}
                                        className="whitespace-nowrap px-4 py-2.5 border border-red-200 bg-white text-red-600 text-sm font-bold rounded-xl shadow-sm transition-colors hover:bg-red-50"
                                    >
                                        Xóa
                                    </button>
                                </div>
                            </article>
                        ))}
                        {loading ? <div className="px-4 py-4 text-center text-sm font-bold text-slate-500">Đang tải danh sách huy hiệu...</div> : null}
                    </div>

                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                                    <th className="py-2 px-2 text-left">Huy hiệu</th>
                                    <th className="py-2 px-2 text-left">Nhiệm vụ</th>
                                    <th className="py-2 px-2 text-center">Trạng thái</th>
                                    <th className="py-2 px-2 text-center">Tác vụ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!loading && visibleBadges.length === 0 ? (
                                    <tr><td colSpan="4" className="py-8 text-center italic text-slate-500">Chưa có huy hiệu</td></tr>
                                ) : visibleBadges.map((badge) => (
                                    <tr key={badge._id} className="border-b border-slate-200 align-top hover:bg-slate-50/70">
                                        <td className="px-3 py-4">
                                            <div className="flex items-start gap-3">
                                                <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                                                    {badge.imageUrl ? <img src={badge.imageUrl} alt={badge.name} className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-slate-400">Chưa có ảnh</span>}
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="font-bold text-[17px] leading-5 text-slate-800">{badge.name}</div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${getBadgeRankClasses(badge.rank)}`}>
                                                            Hạng {badge.rank || 'D'}
                                                        </span>
                                                        <span className="text-xs font-semibold text-slate-400">Nội bộ</span>
                                                    </div>
                                                    {badge.description ? <div className="text-sm text-slate-600">{badge.description}</div> : null}
                                                    <div className="text-sm text-sky-800">{badge.rewardLabel}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-4 text-sm text-slate-700 leading-6">{badge.missionLabel}</td>
                                        <td className="px-3 py-4 text-center text-xs font-bold">
                                            <span className={`inline-flex whitespace-nowrap rounded-full px-4 py-2 ${badge.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {badge.isActive ? 'Đang bật' : 'Đang tắt'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-4 text-center">
                                            <div className="flex flex-col gap-2 items-center justify-center">
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditingId(badge._id); setForm(normalizeBadgeToForm(badge)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                                                    className="min-w-[110px] whitespace-nowrap px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 text-sm font-bold rounded-full shadow-sm transition-colors hover:bg-blue-600 hover:text-white"
                                                >
                                                    Chỉnh sửa
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(badge)}
                                                    className="min-w-[110px] whitespace-nowrap px-4 py-2 border border-red-200 bg-white text-red-600 text-sm font-bold rounded-full shadow-sm transition-colors hover:bg-red-50"
                                                >
                                                    Xóa
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {loading ? <div className="px-4 py-4 text-center text-sm font-bold text-slate-500">Đang tải danh sách huy hiệu...</div> : null}
                    </div>

                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm text-slate-600">
                            Trang <span className="font-bold text-slate-800">{currentPage}</span> / <span className="font-bold text-slate-800">{totalPages}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => setPage(1)}
                                disabled={currentPage <= 1 || loading}
                                className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50 whitespace-nowrap"
                            >
                                Đầu
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                disabled={currentPage <= 1 || loading}
                                className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50 whitespace-nowrap"
                            >
                                Trước
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={currentPage >= totalPages || loading}
                                className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50 whitespace-nowrap"
                            >
                                Sau
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage(totalPages)}
                                disabled={currentPage >= totalPages || loading}
                                className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50 whitespace-nowrap"
                            >
                                Cuối
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}
