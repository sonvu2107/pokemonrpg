import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BulkItemUseModal, { getBulkItemUseLimit } from '../components/BulkItemUseModal'
import { useAuth } from '../context/AuthContext'
import { gameApi } from '../services/gameApi'

const ITEM_FALLBACK_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

const TYPE_META = {
    healing: { label: 'Hồi phục', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    pokeball: { label: 'Bóng', badge: 'bg-red-100 text-red-700 border-red-200' },
    evolution: { label: 'Tiến hóa', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
    battle: { label: 'Chiến đấu', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
    key: { label: 'Chìa khóa', badge: 'bg-slate-200 text-slate-700 border-slate-300' },
    misc: { label: 'Khác', badge: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
}

const RARITY_META = {
    common: { label: 'Phổ biến', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
    uncommon: { label: 'Ít gặp', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    rare: { label: 'Hiếm', badge: 'bg-blue-100 text-blue-700 border-blue-200' },
    epic: { label: 'Sử thi', badge: 'bg-violet-100 text-violet-700 border-violet-200' },
    legendary: { label: 'Huyền thoại', badge: 'bg-orange-100 text-orange-700 border-orange-200' },
}

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

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')

const formatCatchPercent = (value) => {
    const safeValue = Number(value)
    if (!Number.isFinite(safeValue)) return '0%'
    const clampedValue = Math.min(100, Math.max(0, safeValue))
    return `${clampedValue.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`
}

const resolveEffectSummary = (item) => {
    const effectType = String(item?.effectType || 'none')
    if (effectType === 'catchMultiplier') {
        return `Tỉ lệ bắt cơ bản ${formatCatchPercent(item?.effectValue)} (được cộng thêm khi HP Pokemon hoang dã giảm)`
    }
    if (effectType === 'heal' || effectType === 'healAmount') {
        const hp = Number(item?.effectValue || 0)
        const pp = Number(item?.effectValueMp || 0)
        return `Hồi ${hp} HP, ${pp} PP`
    }
    if (effectType === 'grantVipTier') {
        const vipLevel = Math.max(1, Number(item?.effectValue || 1))
        const durationValue = Math.max(1, Number(item?.effectValueMp || 1))
        const durationUnit = String(item?.effectDurationUnit || 'month') === 'week' ? 'tuần' : 'tháng'
        return `Dùng để kích hoạt VIP ${vipLevel} trong ${durationValue} ${durationUnit}`
    }
    if (effectType === 'allowOffTypeSkills') {
        return 'Dùng lên 1 Pokemon để thêm 1 ô skill khác hệ'
    }
    if (effectType === 'grantPokemonExp') {
        return `Dùng lên 1 Pokemon để cộng ${formatNumber(item?.effectValue)} EXP`
    }
    if (effectType === 'grantPokemonLevel') {
        return `Dùng lên 1 Pokemon để tăng ${formatNumber(item?.effectValue)} cấp`
    }
    if (effectType === 'transferPokemonLevel') {
        return 'Dùng lên 1 Pokemon để level của Pokemon đó đổi thành level của 1 Pokemon khác, Pokemon nguồn sẽ về Lv. 1'
    }
    return 'Không có hiệu ứng'
}

export default function ItemInfoPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { user, token, login } = useAuth()

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [item, setItem] = useState(null)
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const [inventoryQuantity, setInventoryQuantity] = useState(0)
    const [usingItem, setUsingItem] = useState(false)
    const [bulkUseModalOpen, setBulkUseModalOpen] = useState(false)

    const loadItemDetail = useCallback(async () => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getItemDetail(id)
            setItem(data?.item || null)
            setWallet({
                platinumCoins: Number(data?.wallet?.platinumCoins ?? 0),
                moonPoints: Number(data?.wallet?.moonPoints || 0),
            })
            setInventoryQuantity(Number(data?.inventory?.quantity || 0))
        } catch (err) {
            setError(err.message || 'Không thể tải chi tiết vật phẩm')
            setItem(null)
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => {
        loadItemDetail()
    }, [loadItemDetail])

    const typeMeta = TYPE_META[item?.type] || TYPE_META.misc
    const rarityMeta = RARITY_META[item?.rarity] || RARITY_META.common
    const effectSummary = useMemo(() => resolveEffectSummary(item), [item])
    const isOnSale = Boolean(item?.isShopEnabled && Number(item?.shopPrice || 0) > 0)
    const canUseDirectly = String(item?.effectType || '') === 'grantVipTier' && inventoryQuantity > 0
    const currentVipTierLevel = Math.max(0, Number(user?.vipTierLevel || 0))
    const maxDirectUseQuantity = Math.min(inventoryQuantity, getBulkItemUseLimit(currentVipTierLevel))

    const syncAuthUser = (nextUserPartial) => {
        if (!nextUserPartial || !token || typeof login !== 'function') return
        login({
            ...(user || {}),
            ...nextUserPartial,
            id: user?.id || nextUserPartial?.id || user?._id || null,
        }, token)
    }

    const handleUseItem = async (quantity) => {
        if (!item?._id || !canUseDirectly) return

        try {
            setUsingItem(true)
            const result = await gameApi.useItem(item._id, quantity)
            syncAuthUser(result?.user)
            alert(result?.message || 'Dùng vật phẩm thành công')
            setBulkUseModalOpen(false)
            await loadItemDetail()
        } catch (err) {
            alert(err.message || 'Không thể dùng vật phẩm')
        } finally {
            setUsingItem(false)
        }
    }

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-blue-800 font-bold">Đang tải chi tiết vật phẩm...</p>
            </div>
        )
    }

    if (error || !item) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="text-red-500 font-bold text-lg mb-4">⚠️ {error || 'Vật phẩm không tồn tại'}</div>
                <div className="space-x-3 text-sm">
                    <Link to="/inventory" className="text-blue-600 hover:underline">Về Túi đồ</Link>
                    <span className="text-slate-300">|</span>
                    <Link to="/shop/items" className="text-blue-600 hover:underline">Về Cửa hàng</Link>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-4">
            <div className="text-center mb-4 text-slate-700 text-sm font-bold flex justify-center gap-4">
                <span className="flex items-center gap-1">🪙 {formatNumber(wallet.platinumCoins)} Xu Bạch Kim</span>
                <span className="flex items-center gap-1 text-purple-700">🌑 {formatNumber(wallet.moonPoints)} Điểm Nguyệt Các</span>
            </div>

            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title="Chi Tiết Vật Phẩm" />
                <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase">
                    {item.name}
                </div>

                <div className="p-4 grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
                    <div className="border border-blue-300 rounded p-4 bg-blue-50/40">
                        <div className="w-36 h-36 mx-auto rounded-lg bg-white border border-blue-100 shadow-inner flex items-center justify-center overflow-hidden">
                            <img
                                src={item.imageUrl || ITEM_FALLBACK_IMAGE}
                                alt={item.name}
                                className="w-24 h-24 object-contain pixelated"
                                onError={(event) => {
                                    event.currentTarget.onerror = null
                                    event.currentTarget.src = ITEM_FALLBACK_IMAGE
                                }}
                            />
                        </div>

                        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${typeMeta.badge}`}>
                                {typeMeta.label}
                            </span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${rarityMeta.badge}`}>
                                {rarityMeta.label}
                            </span>
                        </div>

                        <p className="mt-3 text-xs text-slate-700 leading-relaxed text-center">
                            {String(item.description || '').trim() || 'Chưa có mô tả cho vật phẩm này.'}
                        </p>
                    </div>

                    <div className="border border-blue-300 rounded overflow-hidden">
                        <InfoRow label="Tên vật phẩm" value={item.name} />
                        <InfoRow label="Loại" value={typeMeta.label} />
                        <InfoRow label="Độ hiếm" value={rarityMeta.label} />
                        <InfoRow label="Trạng thái shop" value={isOnSale ? 'Đang bán' : 'Không bán'} />
                        <InfoRow label="Giá shop" value={`${formatNumber(item.shopPrice)} xu Bạch Kim`} />
                        <InfoRow label="Trong túi đồ" value={`${formatNumber(inventoryQuantity)} cái`} />
                        <InfoRow label="Hiệu ứng" value={effectSummary} />
                    </div>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-sm font-bold"
                >
                    Quay lại
                </button>
                <Link
                    to="/inventory"
                    className="px-4 py-2 bg-blue-100 border border-blue-200 hover:bg-blue-200 text-blue-800 rounded text-sm font-bold"
                >
                    Mở Túi Đồ
                </Link>
                {canUseDirectly && (
                    <button
                        type="button"
                        onClick={() => setBulkUseModalOpen(true)}
                        disabled={usingItem}
                        className="px-4 py-2 bg-amber-100 border border-amber-200 hover:bg-amber-200 text-amber-800 rounded text-sm font-bold disabled:opacity-60"
                    >
                        {usingItem ? 'Đang dùng...' : `Dùng ngay${maxDirectUseQuantity > 1 ? ` (tối đa ${formatNumber(maxDirectUseQuantity)})` : ''}`}
                    </button>
                )}
                <Link
                    to="/shop/items"
                    className="px-4 py-2 bg-cyan-100 border border-cyan-200 hover:bg-cyan-200 text-cyan-800 rounded text-sm font-bold"
                >
                    Mở Cửa Hàng Vật Phẩm
                </Link>
            </div>
            {['allowOffTypeSkills', 'grantPokemonExp', 'grantPokemonLevel', 'transferPokemonLevel'].includes(String(item?.effectType || '')) && inventoryQuantity > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-800">
                    Vật phẩm này dùng tại trang chi tiết Pokemon để áp dụng lên Pokemon bạn chọn.
                </div>
            )}
            {canUseDirectly && (
                <BulkItemUseModal
                    isOpen={bulkUseModalOpen}
                    onClose={() => setBulkUseModalOpen(false)}
                    item={item}
                    inventoryQuantity={inventoryQuantity}
                    vipTierLevel={currentVipTierLevel}
                    submitting={usingItem}
                    onConfirm={handleUseItem}
                />
            )}
        </div>
    )
}
