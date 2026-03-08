import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { itemApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const ITEM_FALLBACK_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

const ITEM_TYPES = [
    { value: 'healing', label: 'Hồi phục' },
    { value: 'pokeball', label: 'Bóng' },
    { value: 'evolution', label: 'Tiến hóa' },
    { value: 'battle', label: 'Chiến đấu' },
    { value: 'key', label: 'Chìa khóa' },
    { value: 'misc', label: 'Khác' },
]

const ITEM_TYPE_META = {
    healing: { label: 'Hồi phục', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    pokeball: { label: 'Bóng', badge: 'bg-red-100 text-red-700 border-red-200' },
    evolution: { label: 'Tiến hóa', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    battle: { label: 'Chiến đấu', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
    key: { label: 'Chìa khóa', badge: 'bg-slate-200 text-slate-700 border-slate-300' },
    misc: { label: 'Khác', badge: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
}

const ITEM_RARITIES = [
    { value: 'common', label: 'Phổ biến' },
    { value: 'uncommon', label: 'Ít gặp' },
    { value: 'rare', label: 'Hiếm' },
    { value: 'epic', label: 'Sử thi' },
    { value: 'legendary', label: 'Huyền thoại' },
]

const ITEM_RARITY_META = {
    common: { label: 'Phổ biến', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
    uncommon: { label: 'Ít gặp', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    rare: { label: 'Hiếm', badge: 'bg-blue-100 text-blue-700 border-blue-200' },
    epic: { label: 'Sử thi', badge: 'bg-violet-100 text-violet-700 border-violet-200' },
    legendary: { label: 'Huyền thoại', badge: 'bg-orange-100 text-orange-700 border-orange-200' },
}

const POKEMON_RARITY_TIERS = [
    { value: 'd', label: 'D' },
    { value: 'c', label: 'C' },
    { value: 'b', label: 'B' },
    { value: 'a', label: 'A' },
    { value: 's', label: 'S' },
    { value: 'ss', label: 'SS' },
    { value: 'sss', label: 'SSS' },
]
const POKEMON_RARITY_ORDER = POKEMON_RARITY_TIERS.map((entry) => entry.value)

const EFFECT_TYPE_OPTIONS = [
    { value: 'none', label: 'Không có' },
    { value: 'catchMultiplier', label: 'Đặt tỉ lệ bắt (%)' },
    { value: 'heal', label: 'Hồi HP/PP' },
    { value: 'healAmount', label: 'Hồi HP/PP (Legacy)' },
]

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const InfoRow = ({ label, value }) => (
    <div className="flex border-b border-blue-200 last:border-b-0 text-xs">
        <div className="w-1/3 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className="w-2/3 p-2 font-bold text-slate-700 flex items-center break-words">
            {value}
        </div>
    </div>
)

const formatCurrency = (value) => Number(value || 0).toLocaleString('vi-VN')

const formatCatchPercent = (value) => {
    const safeValue = Number(value)
    if (!Number.isFinite(safeValue)) return '0%'
    const clampedValue = Math.min(100, Math.max(0, safeValue))
    return `${clampedValue.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`
}

const buildEffectSummary = (effectType, effectValue, effectValueMp) => {
    if (effectType === 'catchMultiplier') {
        return `Tỉ lệ bắt cố định ${formatCatchPercent(effectValue)}`
    }
    if (effectType === 'heal' || effectType === 'healAmount') {
        const hp = Number(effectValue || 0)
        const pp = Number(effectValueMp || 0)
        return `Hồi ${hp} HP, ${pp} PP`
    }
    return 'Không có hiệu ứng'
}

export default function ItemFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        type: 'misc',
        rarity: 'common',
        shopPrice: 0,
        moonShopPrice: 0,
        isShopEnabled: false,
        isMoonShopEnabled: false,
        purchaseLimit: 0,
        vipPurchaseLimitBonusPerLevel: 0,
        isEvolutionMaterial: false,
        evolutionRarityFrom: 'd',
        evolutionRarityTo: 'sss',
        imageUrl: '',
        description: '',
        effectType: 'none',
        effectValue: 0,
        effectValueMp: 0,
    })

    useEffect(() => {
        if (isEdit) {
            loadItem()
        }
    }, [id])

    const loadItem = async () => {
        try {
            setLoading(true)
            const data = await itemApi.getById(id)
            setFormData({
                name: data.item.name || '',
                type: data.item.type || 'misc',
                rarity: data.item.rarity || 'common',
                shopPrice: data.item.shopPrice ?? 0,
                moonShopPrice: data.item.moonShopPrice ?? 0,
                isShopEnabled: Boolean(data.item.isShopEnabled),
                isMoonShopEnabled: Boolean(data.item.isMoonShopEnabled),
                purchaseLimit: Math.max(0, Number(data.item.purchaseLimit) || 0),
                vipPurchaseLimitBonusPerLevel: Math.max(0, Number(data.item.vipPurchaseLimitBonusPerLevel) || 0),
                isEvolutionMaterial: Boolean(data.item.isEvolutionMaterial),
                evolutionRarityFrom: data.item.evolutionRarityFrom || 'd',
                evolutionRarityTo: data.item.evolutionRarityTo || 'sss',
                imageUrl: data.item.imageUrl || '',
                description: data.item.description || '',
                effectType: data.item.effectType || 'none',
                effectValue: data.item.effectValue ?? 0,
                effectValueMp: data.item.effectValueMp ?? 0,
            })
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (!formData.name.trim()) {
            setError('Tên vật phẩm là bắt buộc')
            return
        }

        if (formData.isEvolutionMaterial) {
            const fromIndex = POKEMON_RARITY_ORDER.indexOf(formData.evolutionRarityFrom)
            const toIndex = POKEMON_RARITY_ORDER.indexOf(formData.evolutionRarityTo)
            if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) {
                setError('Khoảng rank tiến hóa không hợp lệ (From phải <= To)')
                return
            }
        }

        try {
            setLoading(true)

            const payload = {
                ...formData,
                name: formData.name.trim(),
                description: String(formData.description || '').trim(),
                shopPrice: Math.max(0, Number(formData.shopPrice) || 0),
                moonShopPrice: Math.max(0, Number(formData.moonShopPrice) || 0),
                purchaseLimit: Math.max(0, Number(formData.purchaseLimit) || 0),
                vipPurchaseLimitBonusPerLevel: Math.max(0, Number(formData.vipPurchaseLimitBonusPerLevel) || 0),
                effectValue: Math.max(0, Number(formData.effectValue) || 0),
                effectValueMp: Math.max(0, Number(formData.effectValueMp) || 0),
            }

            if (payload.effectType === 'none') {
                payload.effectValue = 0
                payload.effectValueMp = 0
            }

            if (payload.effectType === 'catchMultiplier') {
                payload.effectValue = Math.min(100, Math.max(0, Number(payload.effectValue) || 0))
            }

            if (!['heal', 'healAmount'].includes(payload.effectType)) {
                payload.effectValueMp = 0
            }

            if (isEdit) {
                await itemApi.update(id, payload)
            } else {
                await itemApi.create(payload)
            }
            navigate('/admin/items')
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const selectedTypeMeta = ITEM_TYPE_META[formData.type] || ITEM_TYPE_META.misc
    const selectedRarityMeta = ITEM_RARITY_META[formData.rarity] || ITEM_RARITY_META.common
    const previewName = formData.name.trim() || 'Vật phẩm chưa đặt tên'
    const previewDescription = formData.description.trim() || 'Chưa có mô tả cho vật phẩm này.'
    const isHealEffect = formData.effectType === 'heal' || formData.effectType === 'healAmount'

    const effectSummary = useMemo(
        () => buildEffectSummary(formData.effectType, formData.effectValue, formData.effectValueMp),
        [formData.effectType, formData.effectValue, formData.effectValueMp]
    )
    const evolutionRangeLabel = useMemo(() => {
        const fromLabel = POKEMON_RARITY_TIERS.find((entry) => entry.value === formData.evolutionRarityFrom)?.label || 'D'
        const toLabel = POKEMON_RARITY_TIERS.find((entry) => entry.value === formData.evolutionRarityTo)?.label || 'SSS'
        return `${fromLabel} - ${toLabel}`
    }, [formData.evolutionRarityFrom, formData.evolutionRarityTo])

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm max-w-5xl mx-auto mb-10">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">
                    {isEdit ? 'Cập Nhật Vật Phẩm' : 'Thêm Mới Vật Phẩm'}
                </h1>
            </div>

            <div className="p-6">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">1. Thông Tin Cơ Bản</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên Vật Phẩm *</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Loại</label>
                                            <select
                                                value={formData.type}
                                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            >
                                                {ITEM_TYPES.map((item) => (
                                                    <option key={item.value} value={item.value}>{item.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Độ Hiếm</label>
                                            <select
                                                value={formData.rarity}
                                                onChange={(e) => setFormData({ ...formData, rarity: e.target.value })}
                                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            >
                                                {ITEM_RARITIES.map((item) => (
                                                    <option key={item.value} value={item.value}>{item.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Mô Tả</label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows="4"
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">2. Cửa Hàng</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá Bán Cửa Hàng (Xu)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={formData.shopPrice}
                                            onChange={(e) => setFormData({ ...formData, shopPrice: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá Bán Nguyệt Các (Điểm)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={formData.moonShopPrice}
                                            onChange={(e) => setFormData({ ...formData, moonShopPrice: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(formData.isShopEnabled)}
                                                onChange={(e) => setFormData({ ...formData, isShopEnabled: e.target.checked })}
                                                className="accent-blue-600"
                                            />
                                            Hiển thị trong Cửa hàng vật phẩm
                                        </label>
                                    </div>
                                    <div className="flex items-end">
                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(formData.isMoonShopEnabled)}
                                                onChange={(e) => setFormData({ ...formData, isMoonShopEnabled: e.target.checked })}
                                                className="accent-blue-600"
                                            />
                                            Hiển thị trong Cửa hàng Nguyệt Các
                                        </label>
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giới Hạn Mua (0 = Không giới hạn)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={formData.purchaseLimit}
                                            onChange={(e) => setFormData({ ...formData, purchaseLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Bonus giới hạn theo VIP / cấp</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={formData.vipPurchaseLimitBonusPerLevel}
                                            onChange={(e) => setFormData({ ...formData, vipPurchaseLimitBonusPerLevel: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(formData.isEvolutionMaterial)}
                                                onChange={(e) => setFormData({ ...formData, isEvolutionMaterial: e.target.checked })}
                                                className="accent-blue-600"
                                            />
                                            Có thể dùng làm vật phẩm tiến hóa
                                        </label>
                                    </div>
                                    {formData.isEvolutionMaterial && (
                                        <>
                                            <div>
                                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Từ Rank</label>
                                                <select
                                                    value={formData.evolutionRarityFrom}
                                                    onChange={(e) => setFormData({ ...formData, evolutionRarityFrom: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                                >
                                                    {POKEMON_RARITY_TIERS.map((entry) => (
                                                        <option key={`from-${entry.value}`} value={entry.value}>{entry.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Đến Rank</label>
                                                <select
                                                    value={formData.evolutionRarityTo}
                                                    onChange={(e) => setFormData({ ...formData, evolutionRarityTo: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                                >
                                                    {POKEMON_RARITY_TIERS.map((entry) => (
                                                        <option key={`to-${entry.value}`} value={entry.value}>{entry.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">3. Hiệu Ứng</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Hiệu Ứng</label>
                                        <select
                                            value={formData.effectType}
                                            onChange={(e) => setFormData({ ...formData, effectType: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        >
                                            {EFFECT_TYPE_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">
                                            {formData.effectType === 'catchMultiplier' ? 'Tỉ lệ bắt (%)' : 'Giá trị HP'}
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max={formData.effectType === 'catchMultiplier' ? 100 : undefined}
                                            step={formData.effectType === 'catchMultiplier' ? '0.1' : '0.01'}
                                            value={formData.effectValue}
                                            onChange={(e) => {
                                                const nextValue = parseFloat(e.target.value) || 0
                                                const normalizedValue = formData.effectType === 'catchMultiplier'
                                                    ? Math.min(100, Math.max(0, nextValue))
                                                    : nextValue
                                                setFormData({ ...formData, effectValue: normalizedValue })
                                            }}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                </div>
                                {isHealEffect && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                        <div>
                                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá trị PP</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={formData.effectValueMp}
                                                onChange={(e) => setFormData({ ...formData, effectValueMp: parseFloat(e.target.value) || 0 })}
                                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="bg-white rounded border border-blue-100 p-4 shadow-sm">
                                <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-blue-900 uppercase">Ảnh Vật Phẩm</h3>
                                        <p className="text-xs text-blue-700 mt-1">Tải ảnh đại diện cho vật phẩm.</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                                    <ImageUpload
                                        currentImage={formData.imageUrl}
                                        onUploadSuccess={(url) => setFormData((prev) => ({
                                            ...prev,
                                            imageUrl: Array.isArray(url) ? (url[0] || '') : (url || ''),
                                        }))}
                                        label="Ảnh Vật Phẩm"
                                    />
                                </div>
                            </div>
                        </div>

                        <aside className="xl:sticky xl:top-4 space-y-4">
                            <div className="border border-blue-400 rounded-lg overflow-hidden shadow-sm bg-white">
                                <SectionHeader title="Chi Tiết Vật Phẩm" />
                                <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase">
                                    Xem Trước
                                </div>

                                <div className="p-4">
                                    <div className="flex flex-col items-center mb-4">
                                        <div className="w-28 h-28 rounded-lg bg-blue-50 border border-blue-100 shadow-inner flex items-center justify-center mb-3 overflow-hidden">
                                            <img
                                                src={formData.imageUrl || ITEM_FALLBACK_IMAGE}
                                                alt={previewName}
                                                className="w-20 h-20 object-contain pixelated"
                                                onError={(event) => {
                                                    event.currentTarget.onerror = null
                                                    event.currentTarget.src = ITEM_FALLBACK_IMAGE
                                                }}
                                            />
                                        </div>

                                        <h2 className="text-lg font-bold text-blue-900 text-center leading-tight">
                                            {previewName}
                                        </h2>

                                        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${selectedTypeMeta.badge}`}>
                                                {selectedTypeMeta.label}
                                            </span>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${selectedRarityMeta.badge}`}>
                                                {selectedRarityMeta.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="border border-blue-300 rounded overflow-hidden">
                                        <InfoRow label="Loại" value={selectedTypeMeta.label} />
                                        <InfoRow label="Độ hiếm" value={selectedRarityMeta.label} />
                                        <InfoRow label="Giá shop" value={`${formatCurrency(formData.shopPrice)} xu`} />
                                        <InfoRow label="Giá Nguyệt Các" value={`${formatCurrency(formData.moonShopPrice)} điểm`} />
                                        <InfoRow label="Shop vật phẩm" value={formData.isShopEnabled ? 'Đang bán' : 'Ẩn'} />
                                        <InfoRow label="Shop Nguyệt Các" value={formData.isMoonShopEnabled ? 'Đang bán' : 'Ẩn'} />
                                        <InfoRow label="Giới hạn mua" value={Number(formData.purchaseLimit || 0) > 0 ? `${formatCurrency(formData.purchaseLimit)} lần` : 'Không giới hạn'} />
                                        <InfoRow label="Bonus VIP" value={`${formatCurrency(formData.vipPurchaseLimitBonusPerLevel)} / cấp`} />
                                        <InfoRow label="Vật phẩm tiến hóa" value={formData.isEvolutionMaterial ? 'Có' : 'Không'} />
                                        {formData.isEvolutionMaterial && (
                                            <InfoRow label="Khoảng rank" value={evolutionRangeLabel} />
                                        )}
                                        <InfoRow label="Hiệu ứng" value={effectSummary} />
                                    </div>

                                    <div className="mt-3 border border-blue-200 rounded bg-blue-50/40 p-3">
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700 mb-1">Mô tả</div>
                                        <p className="text-xs text-slate-700 leading-relaxed">
                                            {previewDescription}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-slate-200">
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-sm font-bold shadow-md transform transition-all active:scale-[0.98]"
                        >
                            {loading ? 'Đang Xử Lý...' : isEdit ? 'LƯU THAY ĐỔI' : 'TẠO VẬT PHẨM MỚI'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/items')}
                            className="px-8 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-bold shadow-sm transition-all"
                        >
                            Hủy
                        </button>
                    </div>
                </form>
            </div>

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
