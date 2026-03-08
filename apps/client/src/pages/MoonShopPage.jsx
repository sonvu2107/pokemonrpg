import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'
import Modal from '../components/Modal'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-indigo-700 to-blue-500 text-white font-bold px-4 py-1.5 text-center border-y border-indigo-800 shadow-sm">
        {title}
    </div>
)

const TYPE_LABELS = {
    all: 'Tất cả loại',
    healing: 'Hồi phục',
    pokeball: 'Bóng',
    evolution: 'Tiến hóa',
    battle: 'Chiến đấu',
    key: 'Chìa khóa',
    misc: 'Khác',
}

const getFallbackItemImage = () => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png'

export default function MoonShopPage() {
    const [items, setItems] = useState([])
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, limit: 20, total: 0 })
    const [typeFilter, setTypeFilter] = useState('all')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [buyingItemId, setBuyingItemId] = useState('')
    const [showBuyModal, setShowBuyModal] = useState(false)
    const [selectedBuyItem, setSelectedBuyItem] = useState(null)
    const [buyQuantity, setBuyQuantity] = useState(1)
    const toast = useToast()

    useEffect(() => {
        loadItems(1, typeFilter)
    }, [typeFilter])

    const availableTypes = useMemo(() => {
        const dynamicTypes = [...new Set(items.map((item) => item.type).filter(Boolean))]
        return ['all', ...dynamicTypes]
    }, [items])

    const loadItems = async (page, type) => {
        try {
            setLoading(true)
            setError('')

            const params = {
                page,
                limit: pagination.limit,
            }
            if (type && type !== 'all') {
                params.type = type
            }

            const data = await gameApi.getMoonShopItems(params)
            setItems(data.items || [])
            setWallet({
                platinumCoins: Number(data?.wallet?.platinumCoins ?? 0),
                moonPoints: Number(data?.wallet?.moonPoints || 0),
            })
            setPagination((prev) => ({
                ...prev,
                ...(data.pagination || {}),
            }))
        } catch (err) {
            setError(err.message || 'Không thể tải Cửa hàng Nguyệt Các')
            setItems([])
        } finally {
            setLoading(false)
        }
    }

    const handlePageChange = async (page) => {
        if (page < 1 || page > (pagination.totalPages || 1)) return
        await loadItems(page, typeFilter)
    }

    const handleBuy = async (item, quantity = 1) => {
        const normalizedQuantity = Math.max(1, Number(quantity) || 1)
        const remainingPurchaseLimit = Math.max(0, Number(item?.remainingPurchaseLimit || 0))
        if (Number(item?.effectivePurchaseLimit || 0) > 0 && normalizedQuantity > remainingPurchaseLimit) {
            toast.showError(`Vật phẩm này chỉ còn mua được ${remainingPurchaseLimit} lần trong tuần này`)
            return
        }

        try {
            setBuyingItemId(item._id)
            const result = await gameApi.buyMoonShopItem(item._id, normalizedQuantity)
            setWallet({
                platinumCoins: Number(result?.wallet?.platinumCoins ?? wallet.platinumCoins),
                moonPoints: Number(result?.wallet?.moonPoints || wallet.moonPoints),
            })
            toast.showSuccess(result?.message || 'Mua vật phẩm thành công')
            setShowBuyModal(false)
            setSelectedBuyItem(null)
            setBuyQuantity(1)
            await loadItems(pagination.page || 1, typeFilter)
        } catch (err) {
            toast.showError(err.message || 'Mua vật phẩm thất bại')
        } finally {
            setBuyingItemId('')
        }
    }

    const openBuyModal = (item) => {
        if (!item?._id) return
        setSelectedBuyItem(item)
        setBuyQuantity(1)
        setShowBuyModal(true)
    }

    const closeBuyModal = () => {
        if (buyingItemId) return
        setShowBuyModal(false)
        setSelectedBuyItem(null)
        setBuyQuantity(1)
    }

    const incrementBuyQuantity = (step) => {
        setBuyQuantity((prev) => {
            const next = Math.max(1, Math.min(9999, Number(prev || 1) + Number(step || 0)))
            return next
        })
    }

    const selectedItemPrice = Number(selectedBuyItem?.shopPrice || 0)
    const selectedTotalPrice = selectedItemPrice * Math.max(1, Number(buyQuantity) || 1)
    const notEnoughMoonPoints = selectedTotalPrice > Number(wallet?.moonPoints || 0)
    const selectedEffectivePurchaseLimit = Math.max(0, Number(selectedBuyItem?.effectivePurchaseLimit || 0))
    const selectedRemainingPurchaseLimit = Math.max(0, Number(selectedBuyItem?.remainingPurchaseLimit || 0))
    const isPurchaseLimitReached = selectedEffectivePurchaseLimit > 0 && selectedRemainingPurchaseLimit <= 0
    const exceedPurchaseLimit = selectedEffectivePurchaseLimit > 0 && Math.max(1, Number(buyQuantity) || 1) > selectedRemainingPurchaseLimit

    return (
        <div className="max-w-4xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <div className="text-slate-700 text-sm font-bold flex justify-center gap-4 mb-1">
                    <span className="flex items-center gap-1">🪙 {wallet.platinumCoins.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-indigo-700">🌑 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt Các</span>
                </div>
                <h1 className="text-3xl font-bold text-indigo-900 drop-shadow-sm">Cửa Hàng Nguyệt Các</h1>
            </div>

            <div className="space-y-4">
                <section className="border border-indigo-300 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Moon Shop" />

                    <div className="bg-indigo-100/50 border-b border-indigo-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-indigo-800 uppercase">Lọc theo loại</label>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700"
                            >
                                {availableTypes.map((type) => (
                                    <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                                ))}
                            </select>
                        </div>

                        <div className="text-xs text-slate-500 font-medium">
                            Thanh toán bằng Điểm Nguyệt Các.
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="hidden sm:table-header-group">
                                <tr className="bg-indigo-50 border-b border-indigo-300 text-indigo-900 text-sm font-bold">
                                    <th className="px-3 py-2 text-center border-r border-indigo-200 w-24">Hình</th>
                                    <th className="px-3 py-2 text-center border-r border-indigo-200">Vật phẩm</th>
                                    <th className="px-3 py-2 text-center border-r border-indigo-200 w-48">Giá</th>
                                    <th className="px-3 py-2 text-center w-28">Mua</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-10 text-center text-slate-500 font-bold">Đang tải cửa hàng...</td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-10 text-center text-red-600 font-bold">{error}</td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-10 text-center text-slate-500">Chưa có vật phẩm nào đang bán.</td>
                                    </tr>
                                ) : (
                                    items.map((item) => (
                                        <tr key={item._id} className="border-b border-indigo-100 hover:bg-indigo-50/40 flex flex-col sm:table-row p-4 sm:p-0 gap-3 sm:gap-0">
                                            <td className="px-4 py-3 border-indigo-100 border-b sm:border-b-0 sm:border-r flex items-center gap-4 sm:table-cell w-full align-middle">
                                                <Link to={`/items/${item._id}`} className="flex items-center gap-4 w-full sm:w-auto sm:mx-auto group">
                                                    <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 bg-indigo-50 sm:bg-transparent rounded-lg sm:rounded-none flex items-center justify-center border border-indigo-100 sm:border-none sm:mx-auto">
                                                        <img
                                                            src={item.imageUrl || getFallbackItemImage()}
                                                            alt={item.name}
                                                            className="w-12 h-12 sm:w-16 sm:h-16 object-contain pixelated"
                                                            onError={(event) => {
                                                                event.currentTarget.onerror = null
                                                                event.currentTarget.src = getFallbackItemImage()
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="flex-1 sm:hidden">
                                                        <div className="font-bold text-slate-800 text-lg leading-tight group-hover:text-indigo-700">{item.name}</div>
                                                        <div className="text-xs italic text-slate-500 mt-1 line-clamp-2">{item.description || 'Không có mô tả.'}</div>
                                                    </div>
                                                </Link>
                                            </td>

                                            <td className="hidden sm:table-cell px-4 py-3 border-r border-indigo-100 text-center align-middle">
                                                <Link to={`/items/${item._id}`} className="block hover:underline">
                                                    <div className="font-bold text-slate-800 text-lg hover:text-indigo-700">{item.name}</div>
                                                    <div className="text-sm italic text-slate-600 mt-1">{item.description || 'Không có mô tả.'}</div>
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3 border-indigo-100 flex items-center justify-between sm:table-cell w-full sm:border-r align-middle">
                                                <div className="sm:text-center text-left">
                                                    <div className="font-bold text-xl text-indigo-700 sm:text-slate-900">{Number(item.shopPrice || 0).toLocaleString('vi-VN')} <span className="text-sm sm:text-lg font-normal sm:font-bold">điểm</span></div>
                                                    <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider font-bold sm:font-normal sm:normal-case sm:tracking-normal w-max sm:mx-auto">nguyệt các</div>
                                                    {Number(item.effectivePurchaseLimit || 0) > 0 && (
                                                        <div className="text-[11px] mt-1 font-semibold text-amber-700">Còn tuần này: {Number(item.remainingPurchaseLimit || 0).toLocaleString('vi-VN')}</div>
                                                    )}
                                                </div>

                                                <div className="sm:hidden">
                                                    <button
                                                        onClick={() => openBuyModal(item)}
                                                        disabled={buyingItemId === item._id || (Number(item.effectivePurchaseLimit || 0) > 0 && Number(item.remainingPurchaseLimit || 0) <= 0)}
                                                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                                                    >
                                                        {Number(item.effectivePurchaseLimit || 0) > 0 && Number(item.remainingPurchaseLimit || 0) <= 0
                                                            ? 'Hết lượt'
                                                            : (buyingItemId === item._id ? 'Đang mua...' : 'Mua')}
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="hidden sm:table-cell px-4 py-3 text-center align-middle">
                                                <button
                                                    onClick={() => openBuyModal(item)}
                                                    disabled={buyingItemId === item._id || (Number(item.effectivePurchaseLimit || 0) > 0 && Number(item.remainingPurchaseLimit || 0) <= 0)}
                                                    className="w-full sm:w-auto px-6 py-2 bg-white border border-indigo-400 text-indigo-800 font-bold hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed rounded shadow-sm"
                                                >
                                                    {Number(item.effectivePurchaseLimit || 0) > 0 && Number(item.remainingPurchaseLimit || 0) <= 0
                                                        ? 'Hết lượt'
                                                        : (buyingItemId === item._id ? 'Đang mua...' : 'Mua')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {pagination.totalPages > 1 && (
                        <div className="bg-slate-50 border-t border-indigo-200 p-2 flex justify-center gap-1 flex-wrap">
                            {Array.from({ length: pagination.totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                                <button
                                    key={pageNum}
                                    onClick={() => handlePageChange(pageNum)}
                                    className={`w-8 h-8 text-xs font-bold rounded border ${pageNum === pagination.page
                                        ? 'bg-indigo-600 text-white border-indigo-700'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                        }`}
                                >
                                    {pageNum}
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <Modal
                isOpen={showBuyModal && Boolean(selectedBuyItem)}
                onClose={closeBuyModal}
                title="Mua vật phẩm"
                maxWidth="sm"
            >
                {selectedBuyItem && (
                    <div className="space-y-4">
                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 flex items-center gap-3">
                            <div className="w-14 h-14 rounded border border-indigo-100 bg-white flex items-center justify-center shrink-0">
                                <img
                                    src={selectedBuyItem.imageUrl || getFallbackItemImage()}
                                    alt={selectedBuyItem.name}
                                    className="w-10 h-10 object-contain pixelated"
                                    onError={(event) => {
                                        event.currentTarget.onerror = null
                                        event.currentTarget.src = getFallbackItemImage()
                                    }}
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="font-bold text-slate-800 truncate">{selectedBuyItem.name}</div>
                                <div className="text-xs text-slate-600 line-clamp-2">
                                    {selectedBuyItem.description || 'Không có mô tả.'}
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-indigo-800 uppercase mb-2">Số lượng</label>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => incrementBuyQuantity(-1)}
                                    className="w-10 h-10 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50"
                                >
                                    -
                                </button>
                                <input
                                    type="number"
                                    min="1"
                                    max="9999"
                                    value={buyQuantity}
                                    onChange={(event) => setBuyQuantity(Math.max(1, Math.min(9999, parseInt(event.target.value, 10) || 1)))}
                                    className="flex-1 h-10 px-3 border border-slate-300 rounded text-center font-bold text-slate-800"
                                />
                                <button
                                    type="button"
                                    onClick={() => incrementBuyQuantity(1)}
                                    className="w-10 h-10 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50"
                                >
                                    +
                                </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {[1, 5, 10, 20, 50].map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setBuyQuantity(preset)}
                                        className={`px-2 py-1 text-xs font-bold rounded border ${buyQuantity === preset
                                            ? 'bg-indigo-600 text-white border-indigo-700'
                                            : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                                            }`}
                                    >
                                        x{preset}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                            <div className="flex justify-between">
                                <span className="text-slate-600">Đơn giá</span>
                                <span className="font-bold text-slate-800">{selectedItemPrice.toLocaleString('vi-VN')} điểm</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-600">Số lượng</span>
                                <span className="font-bold text-slate-800">x{Math.max(1, Number(buyQuantity) || 1)}</span>
                            </div>
                            <div className="pt-1 border-t border-slate-200 flex justify-between text-base">
                                <span className="font-bold text-slate-700">Tổng thanh toán</span>
                                <span className="font-extrabold text-indigo-700">{selectedTotalPrice.toLocaleString('vi-VN')} điểm</span>
                            </div>
                            <div className="flex justify-between text-xs pt-1">
                                <span className="text-slate-500">Số dư hiện tại</span>
                                <span className="font-semibold text-slate-700">{Number(wallet?.moonPoints || 0).toLocaleString('vi-VN')} điểm</span>
                            </div>
                            {selectedEffectivePurchaseLimit > 0 && (
                                <div className="flex justify-between text-xs pt-1">
                                    <span className="text-slate-500">Lượt mua còn lại tuần này</span>
                                    <span className="font-semibold text-slate-700">{selectedRemainingPurchaseLimit.toLocaleString('vi-VN')}</span>
                                </div>
                            )}
                            {notEnoughMoonPoints && (
                                <div className="text-xs font-bold text-red-600 pt-1">Bạn không đủ Điểm Nguyệt Các để mua số lượng này.</div>
                            )}
                            {isPurchaseLimitReached && (
                                <div className="text-xs font-bold text-red-600 pt-1">Vật phẩm đã hết lượt mua trong tuần này.</div>
                            )}
                            {exceedPurchaseLimit && !isPurchaseLimitReached && (
                                <div className="text-xs font-bold text-red-600 pt-1">Số lượng vượt quá lượt mua còn lại.</div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeBuyModal}
                                disabled={Boolean(buyingItemId)}
                                className="px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={() => handleBuy(selectedBuyItem, buyQuantity)}
                                disabled={buyingItemId === selectedBuyItem._id || notEnoughMoonPoints || isPurchaseLimitReached || exceedPurchaseLimit}
                                className="px-4 py-2 rounded border border-indigo-600 bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {buyingItemId === selectedBuyItem._id ? 'Đang mua...' : 'Xác nhận mua'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
