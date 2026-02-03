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
                                    <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">Tên</th>
                                    <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">Slug</th>
                                    <th className="px-3 py-3 text-center text-blue-900 font-bold uppercase text-xs">Cấp Độ</th>
                                    <th className="px-3 py-3 text-center text-blue-900 font-bold uppercase text-xs">Huyền Thoại</th>
                                    <th className="px-3 py-3 text-right text-blue-900 font-bold uppercase text-xs">Hành Động</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {maps.map((map) => (
                                    <tr key={map._id} className="hover:bg-blue-50 transition-colors">
                                        <td className="px-3 py-2 text-slate-800 font-bold">{map.name}</td>
                                        <td className="px-3 py-2 text-slate-500 text-xs font-mono">{map.slug}</td>
                                        <td className="px-3 py-2 text-center text-slate-600">
                                            {map.levelMin} - {map.levelMax}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {map.isLegendary && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold">
                                                    ⭐ Huyền Thoại
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <Link
                                                to={`/admin/maps/${map._id}/drop-rates`}
                                                className="inline-block px-2 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-xs font-bold mr-2 shadow-sm"
                                            >
                                                Tỷ Lệ Rơi
                                            </Link>
                                            <Link
                                                to={`/admin/maps/${map._id}/edit`}
                                                className="inline-block px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold mr-2 shadow-sm"
                                            >
                                                Sửa
                                            </Link>
                                            <button
                                                onClick={() => handleDelete(map._id, map.name)}
                                                className="inline-block px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-bold shadow-sm"
                                            >
                                                Xóa
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {maps.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="px-4 py-8 text-center text-slate-500 italic">
                                            Chưa có bản đồ nào.
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
