import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { itemApi } from '../../services/adminApi'

const TYPE_LABELS = {
    healing: 'Hồi phục',
    pokeball: 'Bóng',
    evolution: 'Tiến hóa',
    battle: 'Chiến đấu',
    key: 'Chìa khóa',
    misc: 'Khác',
}

const RARITY_LABELS = {
    common: 'Phổ biến',
    uncommon: 'Ít gặp',
    rare: 'Hiếm',
    epic: 'Sử thi',
    legendary: 'Huyền thoại',
}

const RARITY_STYLES = {
    common: 'bg-slate-100 text-slate-600 border-slate-200',
    uncommon: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rare: 'bg-blue-50 text-blue-700 border-blue-200',
    epic: 'bg-amber-50 text-amber-700 border-amber-200',
    legendary: 'bg-red-50 text-red-700 border-red-200',
}

const buildEffectSummary = (item = {}) => {
    const effectType = String(item?.effectType || 'none').trim()
    if (effectType === 'catchMultiplier') {
        return `Bat ${Number(item?.effectValue || 0).toLocaleString('vi-VN')}%`
    }
    if (effectType === 'heal' || effectType === 'healAmount') {
        return `Hoi ${Number(item?.effectValue || 0).toLocaleString('vi-VN')} HP / ${Number(item?.effectValueMp || 0).toLocaleString('vi-VN')} PP`
    }
    if (effectType === 'grantVipTier') {
        const durationUnit = String(item?.effectDurationUnit || 'month') === 'week' ? 'tuan' : 'thang'
        return `VIP ${Math.max(1, Number(item?.effectValue || 1))} / ${Math.max(1, Number(item?.effectValueMp || 1))} ${durationUnit}`
    }
    return '--'
}

export default function ItemListPage() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [rarityFilter, setRarityFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })

    const [historyLogs, setHistoryLogs] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyError, setHistoryError] = useState('')
    const [historySearch, setHistorySearch] = useState('')
    const [historyItemId, setHistoryItemId] = useState('')
    const [historyShopType, setHistoryShopType] = useState('')
    const [historyPage, setHistoryPage] = useState(1)
    const [historyPagination, setHistoryPagination] = useState({ total: 0, pages: 0 })
    const [historyShopItems, setHistoryShopItems] = useState([])
    const [topScrollWidth, setTopScrollWidth] = useState(0)
    const [showTopScrollbar, setShowTopScrollbar] = useState(false)
    const topScrollbarRef = useRef(null)
    const tableScrollRef = useRef(null)
    const syncScrollLockRef = useRef(false)

    useEffect(() => {
        loadItems()
    }, [search, typeFilter, rarityFilter, page])

    useEffect(() => {
        loadPurchaseHistory()
    }, [historySearch, historyItemId, historyShopType, historyPage])

    const loadItems = async () => {
        try {
            setLoading(true)
            const data = await itemApi.list({ search, type: typeFilter, rarity: rarityFilter, page, limit: 20 })
            setItems(data.items || [])
            setPagination(data.pagination || { total: 0, pages: 0 })
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadPurchaseHistory = async () => {
        try {
            setHistoryLoading(true)
            setHistoryError('')
            const data = await itemApi.getPurchaseHistory({
                search: historySearch,
                itemId: historyItemId,
                shopType: historyShopType,
                page: historyPage,
                limit: 20,
            })
            setHistoryLogs(data.logs || [])
            setHistoryPagination(data.pagination || { total: 0, pages: 0 })
            setHistoryShopItems(data?.meta?.shopItems || [])
        } catch (err) {
            setHistoryError(err.message)
        } finally {
            setHistoryLoading(false)
        }
    }

    const formatDateTime = (value) => {
        if (!value) return '--'
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return '--'
        return date.toLocaleString('vi-VN')
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi vật phẩm trên bản đồ.`)) return

        try {
            await itemApi.delete(id)
            loadItems()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    useEffect(() => {
        const syncScrollMetrics = () => {
            const scrollContainer = tableScrollRef.current
            if (!scrollContainer) return
            setTopScrollWidth(scrollContainer.scrollWidth)
            setShowTopScrollbar(scrollContainer.scrollWidth > scrollContainer.clientWidth)
        }

        syncScrollMetrics()
        window.addEventListener('resize', syncScrollMetrics)
        return () => window.removeEventListener('resize', syncScrollMetrics)
    }, [items, loading])

    const handleTopScrollbarScroll = (event) => {
        if (syncScrollLockRef.current) return
        const scrollContainer = tableScrollRef.current
        if (!scrollContainer) return
        syncScrollLockRef.current = true
        scrollContainer.scrollLeft = event.currentTarget.scrollLeft
        requestAnimationFrame(() => {
            syncScrollLockRef.current = false
        })
    }

    const handleTableScroll = (event) => {
        if (syncScrollLockRef.current) return
        const topScrollbar = topScrollbarRef.current
        if (!topScrollbar) return
        syncScrollLockRef.current = true
        topScrollbar.scrollLeft = event.currentTarget.scrollLeft
        requestAnimationFrame(() => {
            syncScrollLockRef.current = false
        })
    }

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Vật Phẩm</h1>
                <Link
                    to="/admin/items/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                        type="text"
                        placeholder="Tìm theo tên..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả loại</option>
                        {Object.entries(TYPE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                    <select
                        value={rarityFilter}
                        onChange={(e) => { setRarityFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả độ hiếm</option>
                        {Object.entries(RARITY_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                </div>

                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                     <>
                        <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col w-full max-w-full overflow-x-auto overscroll-x-contain">
                            {showTopScrollbar && (
                                <div
                                    ref={topScrollbarRef}
                                    onScroll={handleTopScrollbarScroll}
                                    className="overflow-x-auto overflow-y-hidden custom-scrollbar border-b border-slate-200"
                                >
                                    <div style={{ width: `${topScrollWidth}px`, height: '14px' }} />
                                </div>
                            )}
                            <div
                                ref={tableScrollRef}
                                onScroll={handleTableScroll}
                                className="overflow-auto custom-scrollbar max-h-[60vh] sm:max-h-[500px] w-full"
                            >
                                <table className="w-full text-sm whitespace-nowrap min-w-[800px] lg:min-w-[1200px]">
                                    <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[56px] w-[56px]">Hình</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[150px] sm:min-w-[200px]">Tên</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[120px]">Loại</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[120px]">Độ Hiếm</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[120px]">Shop</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[130px]">Shop Nguyệt</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[140px]">Tiến hóa</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[180px]">Hiệu ứng</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs min-w-[120px]">Giao dịch</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs min-w-[130px]">Giới hạn mua</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs min-w-[130px]">+VIP / cấp</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs min-w-[120px]">Giá Shop</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs min-w-[120px]">Giá Nguyệt</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs min-w-[120px] sm:min-w-[160px] whitespace-nowrap">Hành Động</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {items.map((item) => (
                                            <tr key={item._id} className="hover:bg-blue-50 transition-colors">
                                                <td className="px-4 py-3">
                                                    {item.imageUrl ? (
                                                        <img
                                                            src={item.imageUrl}
                                                            alt={item.name}
                                                            className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                                            ?
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-slate-800 font-bold">{item.name}</td>
                                                <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[item.type] || item.type}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${RARITY_STYLES[item.rarity] || ''}`}>
                                                        {RARITY_LABELS[item.rarity] || item.rarity}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {item.isShopEnabled ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                            Đang bán
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-600 border-slate-200">
                                                            Ẩn shop
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {item.isMoonShopEnabled ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-indigo-50 text-indigo-700 border-indigo-200">
                                                            Đang bán
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-600 border-slate-200">
                                                            Ẩn shop
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    {item.isEvolutionMaterial ? (
                                                        <div className="flex flex-col gap-1">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-indigo-50 text-indigo-700 border-indigo-200">
                                                                Dùng tiến hóa
                                                            </span>
                                                            <span className="text-[10px] font-semibold text-slate-600">
                                                                Rank {String(item.evolutionRarityFrom || 'd').toUpperCase()} - {String(item.evolutionRarityTo || 'sss').toUpperCase()}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-600 border-slate-200">
                                                            Không
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-slate-700 font-semibold">{buildEffectSummary(item)}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${item.isTradable ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                        {item.isTradable ? 'Cho phép' : 'Khóa'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">
                                                    {Number(item.purchaseLimit || 0) > 0 ? Number(item.purchaseLimit || 0).toLocaleString('vi-VN') : '∞'}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">
                                                    {Number(item.vipPurchaseLimitBonusPerLevel || 0).toLocaleString('vi-VN')}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">
                                                    {Number(item.shopPrice || 0).toLocaleString('vi-VN')}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">
                                                    {Number(item.moonShopPrice || 0).toLocaleString('vi-VN')}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <Link
                                                        to={`/admin/items/${item._id}/edit`}
                                                        className="inline-block px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold mr-2 shadow-sm"
                                                    >
                                                        Sửa
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDelete(item._id, item.name)}
                                                        className="inline-block px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-bold shadow-sm"
                                                    >
                                                        Xóa
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {items.length === 0 && (
                                            <tr>
                                                <td colSpan="14" className="px-4 py-8 text-center text-slate-500 italic">
                                                    Chưa có vật phẩm nào.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {pagination.pages > 1 && (
                            <div className="flex justify-between items-center mt-4 text-slate-600 text-xs font-medium">
                                <div className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
                                    Tổng <span className="font-bold">{pagination.total}</span> bản ghi &bull; Trang <span className="font-bold text-blue-700">{page}</span>/{pagination.pages}
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        disabled={page === 1}
                                        onClick={() => setPage(page - 1)}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                    >
                                        &laquo;
                                    </button>
                                    {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((pageNum) => (
                                        <button
                                            key={pageNum}
                                            onClick={() => setPage(pageNum)}
                                            className={`min-w-[32px] px-2 py-1 border rounded text-xs font-bold transition-colors shadow-sm ${page === pageNum
                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                                }`}
                                        >
                                            {pageNum}
                                        </button>
                                    ))}
                                    <button
                                        disabled={page >= pagination.pages}
                                        onClick={() => setPage(page + 1)}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                    >
                                        &raquo;
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div className="mt-8 border border-blue-200 rounded-lg overflow-hidden shadow-sm bg-white">
                    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 border-b border-blue-600">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider drop-shadow-sm">Lịch Sử Mua Vật Phẩm (Audit)</h2>
                    </div>

                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2">
                        <input
                            type="text"
                            placeholder="Tìm theo người mua / vật phẩm..."
                            value={historySearch}
                            onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1) }}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                        />
                        <select
                            value={historyItemId}
                            onChange={(e) => { setHistoryItemId(e.target.value); setHistoryPage(1) }}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
                        >
                            <option value="">Tất cả vật phẩm shop</option>
                            {historyShopItems.map((entry) => (
                                <option key={entry._id} value={entry._id}>{entry.name}</option>
                            ))}
                        </select>
                        <select
                            value={historyShopType}
                            onChange={(e) => { setHistoryShopType(e.target.value); setHistoryPage(1) }}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
                        >
                            <option value="">Tất cả shop</option>
                            <option value="item">Shop vật phẩm</option>
                            <option value="moon">Shop Nguyệt Các</option>
                        </select>
                    </div>

                    {historyError && (
                        <div className="p-3 bg-red-50 text-red-700 border-b border-red-200 text-sm">{historyError}</div>
                    )}

                    <div className="overflow-auto custom-scrollbar max-h-[400px]">
                        <table className="w-full text-sm min-w-[980px]">
                            <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Thời gian</th>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Người mua</th>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Vật phẩm</th>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Shop</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">SL</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Đơn giá</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Tổng</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Ví trước/sau</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {historyLoading ? (
                                    <tr>
                                        <td colSpan="8" className="px-4 py-8 text-center text-slate-500 italic">Đang tải lịch sử...</td>
                                    </tr>
                                ) : historyLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="px-4 py-8 text-center text-slate-500 italic">Chưa có dữ liệu mua vật phẩm.</td>
                                    </tr>
                                ) : historyLogs.map((log) => (
                                    <tr key={log._id} className="hover:bg-blue-50 transition-colors">
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(log.createdAt)}</td>
                                        <td className="px-3 py-2 text-slate-800 font-semibold">{log?.buyer?.username || 'Không rõ'}</td>
                                        <td className="px-3 py-2 text-slate-700">{log?.item?.name || 'Vật phẩm đã xóa'}</td>
                                        <td className="px-3 py-2 text-slate-700 font-semibold">{log?.shopType === 'moon' ? 'Nguyệt Các' : 'Vật phẩm'}</td>
                                        <td className="px-3 py-2 text-right font-bold text-slate-700">{Number(log.quantity || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{Number(log.unitPrice || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right font-bold text-slate-800">{Number(log.totalCost || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right text-slate-600">{Number(log.walletGoldBefore || 0).toLocaleString('vi-VN')} → {Number(log.walletGoldAfter || 0).toLocaleString('vi-VN')} {log?.walletCurrency === 'moonPoints' ? 'điểm' : 'xu'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {historyPagination.pages > 1 && (
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 justify-between items-center p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
                            <span className="text-center sm:text-left">Tổng {historyPagination.total} giao dịch • Trang {historyPage}/{historyPagination.pages}</span>
                            <div className="flex flex-wrap justify-center gap-1">
                                <button
                                    disabled={historyPage <= 1}
                                    onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                                    className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold min-w-[32px] text-center"
                                >
                                    &laquo;
                                </button>
                                {Array.from({ length: historyPagination.pages }, (_, i) => i + 1).slice(0, 10).map((pageNum) => (
                                    <button
                                        key={pageNum}
                                        onClick={() => setHistoryPage(pageNum)}
                                        className={`min-w-[32px] px-2 py-1 border rounded font-bold text-center ${historyPage === pageNum
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                            }`}
                                    >
                                        {pageNum}
                                    </button>
                                ))}
                                <button
                                    disabled={historyPage >= historyPagination.pages}
                                    onClick={() => setHistoryPage((prev) => Math.min(historyPagination.pages, prev + 1))}
                                    className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold min-w-[32px] text-center"
                                >
                                    &raquo;
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="text-center mt-6">
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
