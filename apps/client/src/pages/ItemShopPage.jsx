import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
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

const getFallbackItemImage = () => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

export default function ItemShopPage() {
    const [items, setItems] = useState([])
    const [wallet, setWallet] = useState({ gold: 0, moonPoints: 0 })
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, limit: 20, total: 0 })
    const [typeFilter, setTypeFilter] = useState('all')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [buyingItemId, setBuyingItemId] = useState('')
    const [buyQuantity, setBuyQuantity] = useState(1)

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

            const data = await gameApi.getShopItems(params)
            setItems(data.items || [])
            setWallet({
                gold: Number(data?.wallet?.gold || 0),
                moonPoints: Number(data?.wallet?.moonPoints || 0),
            })
            setPagination((prev) => ({
                ...prev,
                ...(data.pagination || {}),
            }))
        } catch (err) {
            setError(err.message || 'Không thể tải cửa hàng vật phẩm')
            setItems([])
        } finally {
            setLoading(false)
        }
    }

    const handlePageChange = async (page) => {
        if (page < 1 || page > (pagination.totalPages || 1)) return
        await loadItems(page, typeFilter)
    }

    const handleBuy = async (item) => {
        const quantity = Math.max(1, Number(buyQuantity) || 1)
        try {
            setBuyingItemId(item._id)
            const result = await gameApi.buyShopItem(item._id, quantity)
            setWallet({
                gold: Number(result?.wallet?.gold || wallet.gold),
                moonPoints: Number(result?.wallet?.moonPoints || wallet.moonPoints),
            })
            window.alert(result?.message || 'Mua vật phẩm thành công')
        } catch (err) {
            window.alert(err.message || 'Mua vật phẩm thất bại')
        } finally {
            setBuyingItemId('')
        }
    }

    return (
        <div className="max-w-4xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <div className="text-slate-700 text-sm font-bold flex justify-center gap-4 mb-1">
                    <span className="flex items-center gap-1">🪙 {wallet.gold.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌙 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt</span>
                </div>
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Cửa Hàng Vật Phẩm</h1>
            </div>

            <div className="space-y-4">
                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Item Shop" />

                    <div className="bg-blue-100/50 border-b border-blue-200 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase">Lọc theo loại</label>
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

                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase">Số lượng mua nhanh</label>
                            <select
                                value={buyQuantity}
                                onChange={(e) => setBuyQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700"
                            >
                                <option value={1}>x1</option>
                                <option value={5}>x5</option>
                                <option value={10}>x10</option>
                                <option value={20}>x20</option>
                            </select>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px]">
                            <thead>
                                <tr className="bg-blue-50 border-b border-blue-300 text-blue-900 text-sm font-bold">
                                    <th className="px-3 py-2 text-center border-r border-blue-200 w-24">Hình</th>
                                    <th className="px-3 py-2 text-center border-r border-blue-200">Vật phẩm</th>
                                    <th className="px-3 py-2 text-center border-r border-blue-200 w-48">Giá</th>
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
                                        <tr key={item._id} className="border-b border-blue-100 hover:bg-blue-50/40">
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <img
                                                    src={item.imageUrl || getFallbackItemImage()}
                                                    alt={item.name}
                                                    className="w-10 h-10 object-contain mx-auto pixelated"
                                                    onError={(event) => {
                                                        event.currentTarget.onerror = null
                                                        event.currentTarget.src = getFallbackItemImage()
                                                    }}
                                                />
                                            </td>
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <div className="font-bold text-slate-800 text-lg">{item.name}</div>
                                                <div className="text-sm italic text-slate-600 mt-1">{item.description || 'Không có mô tả.'}</div>
                                            </td>
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <div className="font-bold text-xl text-slate-900">{Number(item.shopPrice || 0).toLocaleString('vi-VN')} xu</div>
                                                <div className="text-sm text-slate-500">Xu Bạch Kim</div>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <button
                                                    onClick={() => handleBuy(item)}
                                                    disabled={buyingItemId === item._id}
                                                    className="px-3 py-1.5 bg-white border border-blue-400 text-blue-800 font-bold hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {buyingItemId === item._id ? 'Đang mua...' : 'Mua'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {pagination.totalPages > 1 && (
                        <div className="bg-slate-50 border-t border-blue-200 p-2 flex justify-center gap-1 flex-wrap">
                            {Array.from({ length: pagination.totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                                <button
                                    key={pageNum}
                                    onClick={() => handlePageChange(pageNum)}
                                    className={`w-8 h-8 text-xs font-bold rounded border ${pageNum === pagination.page
                                        ? 'bg-blue-600 text-white border-blue-700'
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
        </div>
    )
}
