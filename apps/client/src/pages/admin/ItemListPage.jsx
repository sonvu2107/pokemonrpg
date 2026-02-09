import { useEffect, useState } from 'react'
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

export default function ItemListPage() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [rarityFilter, setRarityFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })

    useEffect(() => {
        loadItems()
    }, [search, typeFilter, rarityFilter, page])

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

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi vật phẩm trên bản đồ.`)) return

        try {
            await itemApi.delete(id)
            loadItems()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
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
                <div className="flex flex-wrap gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                        type="text"
                        placeholder="Tìm theo tên..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả loại</option>
                        {Object.entries(TYPE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                        ))}
                    </select>
                    <select
                        value={rarityFilter}
                        onChange={(e) => { setRarityFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
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
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col">
                            <div className="overflow-auto custom-scrollbar max-h-[60vh] sm:max-h-[500px] overscroll-contain">
                                <table className="w-full text-sm whitespace-nowrap">
                                    <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Hình</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Tên</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Loại</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Độ Hiếm</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Hành Động</th>
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
                                                <td colSpan="5" className="px-4 py-8 text-center text-slate-500 italic">
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
            </div>
        </div>
    )
}
