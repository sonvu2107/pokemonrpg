import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { pokemonApi } from '../../services/adminApi'

const TYPE_COLORS = {
    normal: 'bg-gray-500',
    fire: 'bg-red-500',
    water: 'bg-blue-500',
    grass: 'bg-green-500',
    electric: 'bg-yellow-500',
    ice: 'bg-cyan-400',
    fighting: 'bg-orange-600',
    poison: 'bg-purple-600',
    ground: 'bg-amber-700',
    flying: 'bg-indigo-400',
    psychic: 'bg-pink-500',
    bug: 'bg-lime-600',
    rock: 'bg-stone-600',
    ghost: 'bg-violet-700',
    dragon: 'bg-indigo-700',
    dark: 'bg-gray-800',
    steel: 'bg-slate-500',
    fairy: 'bg-pink-400',
}

export default function PokemonListPage() {
    const [pokemon, setPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    // Filters
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })

    useEffect(() => {
        loadPokemon()
    }, [search, typeFilter, page])

    const loadPokemon = async () => {
        try {
            setLoading(true)
            const data = await pokemonApi.list({ search, type: typeFilter, page, limit: 20 })
            setPokemon(data.pokemon)
            setPagination(data.pagination)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi vật phẩm này.`)) return

        try {
            await pokemonApi.delete(id)
            loadPokemon()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Pokemon</h1>
                <Link
                    to="/admin/pokemon/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                {/* Filters */}
                <div className="flex gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
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
                        <option value="">Tất cả hệ</option>
                        {Object.keys(TYPE_COLORS).map(type => (
                            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                        ))}
                    </select>
                </div>

                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                    <>
                        {/* Table */}
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                            <table className="w-full text-sm">
                                <thead className="bg-blue-50 border-b border-blue-100">
                                    <tr>
                                        <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">#</th>
                                        <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">Hình</th>
                                        <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">Tên</th>
                                        <th className="px-3 py-3 text-left text-blue-900 font-bold uppercase text-xs">Hệ</th>
                                        <th className="px-3 py-3 text-center text-blue-900 font-bold uppercase text-xs">HP</th>
                                        <th className="px-3 py-3 text-center text-blue-900 font-bold uppercase text-xs">TC</th>
                                        <th className="px-3 py-3 text-center text-blue-900 font-bold uppercase text-xs">PT</th>
                                        <th className="px-3 py-3 text-right text-blue-900 font-bold uppercase text-xs">Hành Động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pokemon.map((p) => (
                                        <tr key={p._id} className="hover:bg-blue-50 transition-colors">
                                            <td className="px-3 py-2 text-slate-500 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                                            <td className="px-3 py-2">
                                                {p.imageUrl ? (
                                                    <img
                                                        src={p.imageUrl}
                                                        alt={p.name}
                                                        className="w-12 h-12 object-cover rounded border border-slate-200 shadow-sm"
                                                    />
                                                ) : (
                                                    <div className="w-12 h-12 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                                        ?
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-slate-800 font-bold">{p.name}</td>
                                            <td className="px-3 py-2">
                                                <div className="flex gap-1">
                                                    {p.types.map(type => (
                                                        <span
                                                            key={type}
                                                            className={`px-1.5 py-0.5 rounded text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                                        >
                                                            {type}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-center text-slate-600">{p.baseStats.hp}</td>
                                            <td className="px-3 py-2 text-center text-slate-600">{p.baseStats.atk}</td>
                                            <td className="px-3 py-2 text-center text-slate-600">{p.baseStats.def}</td>
                                            <td className="px-3 py-2 text-right">
                                                <Link
                                                    to={`/admin/pokemon/${p._id}/edit`}
                                                    className="inline-block px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold mr-2 shadow-sm"
                                                >
                                                    Sửa
                                                </Link>
                                                <button
                                                    onClick={() => handleDelete(p._id, p.name)}
                                                    className="inline-block px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-bold shadow-sm"
                                                >
                                                    Xóa
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {pokemon.length === 0 && (
                                        <tr>
                                            <td colSpan="8" className="px-4 py-8 text-center text-slate-500 italic">
                                                Không tìm thấy Pokemon nào.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="flex justify-between items-center mt-4 text-slate-600 text-xs font-medium">
                            <div className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
                                Trang <span className="text-blue-700 font-bold">{pagination.page}</span> / {pagination.pages} (Tổng {pagination.total})
                            </div>
                            <div className="flex gap-2">
                                <button
                                    disabled={page === 1}
                                    onClick={() => setPage(page - 1)}
                                    className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-slate-700 shadow-sm"
                                >
                                    &laquo; Trước
                                </button>
                                <button
                                    disabled={page >= pagination.pages}
                                    onClick={() => setPage(page + 1)}
                                    className="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-bold text-slate-700 shadow-sm"
                                >
                                    Sau &raquo;
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
