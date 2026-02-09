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
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm flex flex-col">
                        <div className="overflow-auto custom-scrollbar max-h-[60vh] sm:max-h-[500px] overscroll-contain">
                            <table className="w-full text-sm whitespace-nowrap">
                                <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs w-[35%]">Bản Đồ</th>
                                        <th className="px-3 py-2 text-center text-blue-900 font-bold uppercase text-xs w-[10%]">Thứ Tự</th>
                                        <th className="px-3 py-2 text-center text-blue-900 font-bold uppercase text-xs w-[25%]">Thông Tin</th>
                                        <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs w-[30%]">Hành Động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {maps.map((map) => (
                                        <tr key={map._id} className="hover:bg-blue-50 transition-colors group">
                                            <td className="px-3 py-2">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-slate-800 font-bold text-sm">{map.name}</span>
                                                        {map.isLegendary && (
                                                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-[3px] text-[10px] font-bold uppercase border border-amber-200">
                                                                Săn Bắt
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-slate-400 text-xs font-mono mt-0.5">{map.slug}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-mono text-xs font-bold">
                                                    #{map.orderIndex || 0}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <div className="flex flex-wrap justify-center items-center gap-2">
                                                    <span className="text-slate-600 font-medium text-xs bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 whitespace-nowrap">
                                                        Lv {map.levelMin}-{map.levelMax}
                                                    </span>
                                                    {map.requiredSearches > 0 && (
                                                        <span className="text-[10px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded whitespace-nowrap">
                                                            🔒 {map.requiredSearches}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                                                    <Link
                                                        to={`/admin/maps/${map._id}/drop-rates`}
                                                        className="p-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded shadow-sm transition-colors"
                                                        title="Quản lý tỷ lệ xuất hiện Pokemon"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                            <path d="M10 2a.75.75 0 01.75.75v1.5H18a.75.75 0 01.75.75v2.75l.501.071c.211.03.415.097.599.199l2.454 1.401a.75.75 0 010 1.305l-2.454 1.402a1.492 1.492 0 01-.599.198l-.501.073v2.752a.75.75 0 01-.75.75H2.75a.75.75 0 01-.75-.75v-2.752l-.502-.073a1.496 1.496 0 01-.598-.198L.68 12.339a.75.75 0 010-1.305l2.455-1.401c.184-.102.387-.169.6-.199l.5-.071V6.5a.75.75 0 01.75-.75h7.25v-1.5A.75.75 0 0110 2zM10.75 16.5h6.5v-2.327l-.46.067a2.986 2.986 0 00-1.198.396l-2.071 1.183a.75.75 0 01-.75 0l-1.611-.92a.75.75 0 01-.41-.652V16.5zM2.75 6.5v8.528l1.61-2.012a.75.75 0 011.063-.102l1.922 1.538 1.432-1.79a.75.75 0 011.127-.05l1.986 1.838V6.5h-9.14z" />
                                                        </svg>
                                                    </Link>
                                                    <Link
                                                        to={`/admin/maps/${map._id}/item-drop-rates`}
                                                        className="p-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded shadow-sm transition-colors"
                                                        title="Quản lý tỷ lệ rơi vật phẩm"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                            <path fillRule="evenodd" d="M10 2c-1.716 0-3.408.106-5.07.31C3.806 2.45 3 3.414 3 4.517V17.25a.75.75 0 001.075.676L10 15.082l5.925 2.844A.75.75 0 0017 17.25V4.517c0-1.103-.806-2.068-1.93-2.207A41.403 41.403 0 0010 2z" clipRule="evenodd" />
                                                        </svg>
                                                    </Link>
                                                    <Link
                                                        to={`/admin/maps/${map._id}/edit`}
                                                        className="p-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded shadow-sm transition-colors"
                                                        title="Chỉnh sửa"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                                        </svg>
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDelete(map._id, map.name)}
                                                        className="p-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded shadow-sm transition-colors"
                                                        title="Xóa bản đồ"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                        </svg>
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
                    </div>
                )}
            </div>
        </div>
    )
}
