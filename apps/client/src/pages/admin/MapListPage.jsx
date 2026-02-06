import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { mapApi } from '../../services/adminApi'

export default function MapListPage() {
    const [maps, setMaps] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        loadMaps()
    }, [])

    const loadMaps = async () => {
        try {
            setLoading(true)
            const data = await mapApi.list()
            setMaps(data.maps)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi của bản đồ này.`)) return

        try {
            await mapApi.delete(id)
            loadMaps()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Bản Đồ</h1>
                <Link
                    to="/admin/maps/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-blue-50 border-b border-blue-100">
                                <tr>
                                    <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs w-[40%]">Bản Đồ</th>
                                    <th className="px-4 py-3 text-center text-blue-900 font-bold uppercase text-xs w-[10%]">Thứ Tự</th>
                                    <th className="px-4 py-3 text-center text-blue-900 font-bold uppercase text-xs w-[20%]">Thông Tin</th>
                                    <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs w-[30%]">Hành Động</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {maps.map((map) => (
                                    <tr key={map._id} className="hover:bg-blue-50 transition-colors group">
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-800 font-bold text-base">{map.name}</span>
                                                    {map.isLegendary && (
                                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold uppercase border border-amber-200">
                                                            Săn Bắt
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-slate-400 text-xs font-mono mt-0.5">{map.slug}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-600 rounded font-mono text-xs font-bold">
                                                #{map.orderIndex || 0}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex flex-col gap-1 items-center">
                                                <span className="text-slate-600 font-medium text-xs bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                                                    Lv {map.levelMin}-{map.levelMax}
                                                </span>
                                                {map.requiredSearches > 0 && (
                                                    <span className="text-[10px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded">
                                                        🔒 {map.requiredSearches}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-90 group-hover:opacity-100 transition-opacity">
                                                <Link
                                                    to={`/admin/maps/${map._id}/drop-rates`}
                                                    className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded text-xs font-bold transition-colors"
                                                    title="Quản lý tỷ lệ rơi"
                                                >
                                                    Drop
                                                </Link>
                                                <Link
                                                    to={`/admin/maps/${map._id}/edit`}
                                                    className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-xs font-bold transition-colors"
                                                    title="Chỉnh sửa"
                                                >
                                                    Sửa
                                                </Link>
                                                <button
                                                    onClick={() => handleDelete(map._id, map.name)}
                                                    className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-bold transition-colors"
                                                    title="Xóa bản đồ"
                                                >
                                                    Xóa
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {maps.length === 0 && (
                                    <tr>
                                        <td colSpan="4" className="px-4 py-12 text-center text-slate-400 italic">
                                            Chưa có dữ liệu bản đồ.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
