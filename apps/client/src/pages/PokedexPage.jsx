import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

const COIN_ICON = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/coin-case.png'
const MOON_ICON = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png'
const POKEBALL_ICON = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold text-center py-2 border-b border-blue-700">
        {title}
    </div>
)

const toTitle = (value) => {
    if (!value) return ''
    return String(value).charAt(0).toUpperCase() + String(value).slice(1)
}

export default function PokedexPage() {
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [showIncomplete, setShowIncomplete] = useState(false)
    const [pokemon, setPokemon] = useState([])
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 })
    const [completion, setCompletion] = useState({ owned: 0, total: 0, percent: 0 })
    const [currency, setCurrency] = useState({ gold: 0, moonPoints: 0 })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        loadProfile()
    }, [])

    useEffect(() => {
        loadPokedex()
    }, [pagination.page, search, showIncomplete])

    const loadProfile = async () => {
        try {
            const data = await gameApi.getProfile()
            setCurrency({
                gold: data?.playerState?.gold || 0,
                moonPoints: data?.playerState?.moonPoints || 0,
            })
        } catch {
            setCurrency({ gold: 0, moonPoints: 0 })
        }
    }

    const loadPokedex = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getPokedex({
                page: pagination.page,
                limit: pagination.limit,
                search,
                incomplete: showIncomplete ? 1 : 0,
            })
            setPokemon(data.pokemon || [])
            setPagination(data.pagination || { page: 1, pages: 1, total: 0, limit: 50 })
            setCompletion(data.completion || { owned: 0, total: 0, percent: 0 })
        } catch (err) {
            setError(err.message || 'Không thể tải Pokédex')
        } finally {
            setLoading(false)
        }
    }

    const pageItems = useMemo(() => {
        const totalPages = pagination?.pages || 1
        if (totalPages <= 60) {
            return Array.from({ length: totalPages }, (_, i) => i + 1)
        }
        const currentPage = pagination?.page || 1
        const result = [1]
        const start = Math.max(2, currentPage - 4)
        const end = Math.min(totalPages - 1, currentPage + 4)
        if (start > 2) result.push('...')
        for (let i = start; i <= end; i += 1) result.push(i)
        if (end < totalPages - 1) result.push('...')
        result.push(totalPages)
        return result
    }, [pagination])

    const handleSearch = () => {
        setPagination((prev) => ({ ...prev, page: 1 }))
        setSearch(searchInput.trim())
    }

    const typeLabel = (types = []) => {
        if (!Array.isArray(types) || types.length === 0) return '-'
        return types.map((type) => toTitle(type)).join('/')
    }

    return (
        <div className="max-w-4xl mx-auto pb-12">
            <div className="text-center mb-5">
                <div className="text-slate-800 font-bold text-xl mb-1">Pokédex</div>
                <div className="text-sm font-bold text-slate-700 flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1">
                        <img src={COIN_ICON} alt="Coins" className="w-4 h-4" />
                        <span>{Number(currency.gold || 0).toLocaleString('vi-VN')} Platinum Coins</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <img src={MOON_ICON} alt="Moon Points" className="w-4 h-4" />
                        <span>{Number(currency.moonPoints || 0).toLocaleString('vi-VN')} Moon Points</span>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="border border-slate-700 bg-white">
                    <SectionHeader title="Tìm kiếm Pokémon" />
                    <div className="border-b border-slate-700 text-center py-2 font-bold text-blue-900 bg-blue-100">Bộ Lọc</div>
                    <div className="border-b border-slate-700 text-center py-2 bg-slate-50">
                        <button
                            onClick={() => {
                                setShowIncomplete((prev) => !prev)
                                setPagination((prev) => ({ ...prev, page: 1 }))
                            }}
                            className={`font-bold underline ${showIncomplete ? 'text-blue-700' : 'text-slate-600'}`}
                        >
                            Hiện chưa có {showIncomplete ? '(BẬT)' : '(TẮT)'}
                        </button>
                    </div>
                    <div className="border-b border-slate-700 text-center py-2 font-bold text-blue-900 bg-blue-100">Tìm kiếm</div>
                    <div className="border-b border-slate-700 flex justify-center py-2 bg-slate-50">
                        <input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleSearch()
                            }}
                            className="w-72 max-w-[90%] border border-slate-500 px-2 py-1 text-sm"
                            placeholder="Nhập tên..."
                        />
                    </div>
                    <div className="text-center py-2 bg-slate-50">
                        <button
                            onClick={handleSearch}
                            className="px-5 py-1 border border-blue-700 bg-white font-bold hover:bg-blue-50"
                        >
                            Tìm
                        </button>
                    </div>
                </div>

                <div className="border border-slate-700 bg-white">
                    <SectionHeader title="Tiến độ Pokédex" />
                    <div className="border-b border-slate-700 text-center py-2 font-bold text-blue-900 bg-blue-100">Tiến độ</div>
                    <div className="text-center py-2">
                        {completion.owned}/{completion.total} ({completion.percent}%)
                    </div>
                </div>

                <div className="border border-slate-700 bg-white">
                    <SectionHeader title="Trang" />
                    <div className="border-b border-slate-700 text-center py-2 font-bold text-blue-900 bg-blue-100">Danh sách trang</div>
                    <div className="text-center py-2 font-bold text-blue-800">
                        {pageItems.map((item, idx) => (
                            item === '...'
                                ? <span key={`ellipsis-${idx}`} className="mx-1 text-slate-500">...</span>
                                : (
                                    <button
                                        key={`page-${item}`}
                                        onClick={() => setPagination((prev) => ({ ...prev, page: item }))}
                                        className={`mx-0.5 ${item === pagination.page ? 'text-red-600' : 'hover:underline'}`}
                                    >
                                        [{item}]
                                    </button>
                                )
                        ))}
                    </div>
                </div>

                <div className="border border-slate-700 bg-white overflow-x-auto">
                    <SectionHeader title="Pokédex" />
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-blue-100 text-blue-900 border-b border-slate-700">
                                <th className="border-r border-slate-700 py-2 px-1 text-center w-12">STT</th>
                                <th className="border-r border-slate-700 py-2 px-1 text-center w-12">Có?</th>
                                <th className="border-r border-slate-700 py-2 px-1 text-center w-24">Ảnh</th>
                                <th className="border-r border-slate-700 py-2 px-1 text-center">Tên Pokémon</th>
                                <th className="py-2 px-1 text-center w-28">Hệ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && pokemon.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-center py-8 italic text-slate-500">
                                        Không tìm thấy kết quả
                                    </td>
                                </tr>
                            ) : (
                                pokemon.map((entry) => (
                                    <tr key={entry._id} className="border-b border-slate-300">
                                        <td className="border-r border-slate-300 text-center py-1">#{entry.pokedexNumber}</td>
                                        <td className="border-r border-slate-300 text-center py-1">
                                            <img
                                                src={POKEBALL_ICON}
                                                alt={entry.got ? 'Đã bắt' : 'Chưa bắt'}
                                                className={`w-5 h-5 mx-auto ${entry.got ? '' : 'grayscale opacity-40'}`}
                                            />
                                        </td>
                                        <td className="border-r border-slate-300 text-center py-1">
                                            <img
                                                src={entry.sprite || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${entry.pokedexNumber}.png`}
                                                alt={entry.name}
                                                className="w-16 h-16 mx-auto pixelated"
                                                onError={(event) => {
                                                    event.target.onerror = null
                                                    event.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                                }}
                                            />
                                        </td>
                                        <td className="border-r border-slate-300 text-center py-1 text-blue-800 font-bold">
                                            [ {entry.name} ]
                                        </td>
                                        <td className="text-center py-1">{typeLabel(entry.types)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    {loading && (
                        <div className="text-center py-3 font-bold text-slate-500 border-t border-slate-300">
                            Đang tải dữ liệu...
                        </div>
                    )}
                    {error && (
                        <div className="text-center py-3 font-bold text-red-600 border-t border-slate-300">
                            {error}
                        </div>
                    )}
                    <div className="border-t border-slate-700 text-center py-2 font-bold text-blue-800 bg-slate-50">
                        {pageItems.map((item, idx) => (
                            item === '...'
                                ? <span key={`ellipsis-bottom-${idx}`} className="mx-1 text-slate-500">...</span>
                                : (
                                    <button
                                        key={`page-bottom-${item}`}
                                        onClick={() => setPagination((prev) => ({ ...prev, page: item }))}
                                        className={`mx-0.5 ${item === pagination.page ? 'text-red-600' : 'hover:underline'}`}
                                    >
                                        [{item}]
                                    </button>
                                )
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
