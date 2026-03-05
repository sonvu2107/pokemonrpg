import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { resolveAvatarUrl } from '../utils/avatarUrl'
import TrainerProfileModal from '../components/TrainerProfileModal'
import { useTrainerProfileModal } from '../hooks/useTrainerProfileModal'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold py-2 px-4 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

export default function PokemonRankingsPage() {
    const navigate = useNavigate()
    const [rankings, setRankings] = useState([])
    const [pagination, setPagination] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [featureNotice, setFeatureNotice] = useState('')
    const { openTrainerProfile, trainerModalProps } = useTrainerProfileModal({ defaultReturnTo: '/rankings/pokemon' })

    useEffect(() => {
        loadRankings(currentPage)
    }, [currentPage])

    const loadRankings = async (page) => {
        try {
            setLoading(true)
            setFeatureNotice('')
            const data = await gameApi.getPokemonRankings({ page, limit: 35 })
            setRankings(data.rankings || [])
            setPagination(data.pagination)
        } catch (err) {
            setError(err.message || 'Không thể tải bảng xếp hạng Pokémon')
        } finally {
            setLoading(false)
        }
    }
    const renderPagination = () => {
        if (!pagination) return null
        const { currentPage, totalPages } = pagination
        if (!totalPages || totalPages <= 1) return null
        const pages = []
        pages.push(1)
        const start = Math.max(2, currentPage - 2)
        const end = Math.min(totalPages - 1, currentPage + 2)

        if (start > 2) pages.push('...')
        for (let i = start; i <= end; i++) {
            pages.push(i)
        }
        if (end < totalPages - 1) pages.push('...')
        if (totalPages > 1) pages.push(totalPages)

        return (
            <div className="flex justify-center gap-1 flex-wrap px-4 py-3">
                {pages.map((page, index) => {
                    if (page === '...') {
                        return <span key={`ellipsis-${index}`} className="px-2 text-slate-400">...</span>
                    }
                    return (
                        <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-3 py-1 min-w-[40px] font-bold transition-colors ${page === currentPage
                                ? 'bg-blue-600 text-white'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                } rounded shadow-sm`}
                        >
                            [{page}]
                        </button>
                    )
                })}
            </div>
        )
    }

    const getUsernameColor = (rank) => {
        const colors = [
            'text-blue-800',
            'text-green-600',
            'text-purple-600',
            'text-cyan-600',
            'text-pink-600',
            'text-orange-600',
        ]
        return colors[(rank - 1) % colors.length] || 'text-blue-700'
    }

    const getMasterTitleColor = (pokemon) => {
        if (!pokemon || !pokemon.types || pokemon.types.length === 0) return 'text-slate-500';

        const typeColors = {
            fire: 'text-red-500',
            water: 'text-blue-500',
            grass: 'text-green-500',
            electric: 'text-yellow-500',
            psychic: 'text-pink-500',
            ghost: 'text-purple-600',
            dragon: 'text-indigo-600',
            dark: 'text-slate-800',
            steel: 'text-slate-500',
            fairy: 'text-pink-400',
        }

        return typeColors[pokemon.types[0].toLowerCase()] || 'text-slate-500';
    }

    const handleChallengeFromRanking = (userPokemonId) => {
        const normalizedId = String(userPokemonId || '').trim()
        if (!normalizedId) {
            setFeatureNotice('Không tìm thấy ID Pokemon để khiêu chiến.')
            return
        }

        navigate(`/battle?challengePokemonId=${encodeURIComponent(normalizedId)}&returnTo=${encodeURIComponent('rankings/pokemon')}`)
    }

    if (loading && rankings.length === 0) {
        return (
            <div className="max-w-4xl mx-auto py-12">
                <div className="text-center text-slate-500 font-bold animate-pulse">
                    Đang tải bảng xếp hạng...
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="max-w-4xl mx-auto py-12">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    Lỗi: {error}
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">Bảng Xếp Hạng Pokémon</h1>
                <div className="flex items-center justify-center gap-2 text-sm font-bold">
                    <Link to="/rankings/overall" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Chung</Link>
                    <Link to="/rankings/pokemon" className="px-3 py-1 rounded bg-blue-600 text-white">Pokémon</Link>
                    <Link to="/rankings/daily" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Hàng Ngày</Link>
                </div>
            </div>

            {featureNotice && (
                <FeatureUnavailableNotice
                    compact
                    className="mb-4"
                    message={featureNotice}
                />
            )}

            <div className="border-2 border-slate-800 bg-white shadow-lg">
                <SectionHeader title="Bảng Xếp Hạng Pokémon Chung" />
                <div className="grid grid-cols-12 bg-blue-100 border-b-2 border-slate-800 text-slate-800 font-bold text-sm py-2">
                    <div className="col-span-3 sm:col-span-2 text-center border-r border-slate-400 flex items-center justify-center">Hạng</div>
                    <div className="col-span-3 sm:col-span-2 text-center border-r border-slate-400 flex items-center justify-center">Hình Ảnh</div>
                    <div className="col-span-3 sm:col-span-4 text-center border-r border-slate-400 flex items-center justify-center">Pokémon</div>
                    <div className="col-span-3 sm:col-span-4 text-center flex items-center justify-center">Người Chơi</div>
                </div>
                <div className="divide-y divide-slate-400">
                    {rankings.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 italic">
                            Chưa có dữ liệu
                        </div>
                    ) : (
                        rankings.map((entry, index) => {
                            const detailId = entry.userPokemonId || entry.id
                            const pokemonName = entry.pokemon?.name || 'Không rõ'
                            const level = entry.level || entry.pokemon?.level || 1
                            const exp = entry.experience || entry.pokemon?.experience || 0
                            const sprite = entry.sprite || entry.pokemon?.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                            return (
                                <div
                                    key={detailId}
                                    className="grid grid-cols-12 items-center min-h-[120px] bg-white hover:bg-blue-50 transition-colors"
                                >
                                    <div className="col-span-3 sm:col-span-2 text-center text-base sm:text-lg md:text-xl font-extrabold text-slate-800 h-full flex items-center justify-center border-r border-slate-300 px-1 overflow-hidden">
                                        {entry.rank}
                                    </div>
                                    <div className="col-span-3 sm:col-span-2 flex justify-center h-full items-center border-r border-slate-300 p-2">
                                        <Link to={`/pokemon/${detailId}`}>
                                            <img
                                                src={sprite}
                                                alt={pokemonName}
                                                className="w-20 h-20 object-contain pixelated hover:scale-110 transition-transform cursor-pointer"
                                                loading="lazy"
                                                onError={(e) => {
                                                    e.target.onerror = null
                                                    e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                                }}
                                            />
                                        </Link>
                                    </div>
                                    <div className="col-span-3 sm:col-span-4 h-full flex flex-col justify-center items-center border-r border-slate-300 p-2 gap-2">
                                        <div className="text-center">
                                            <Link to={`/pokemon/${detailId}`} className="font-bold text-slate-800 text-sm sm:text-base hover:underline flex items-center gap-1 justify-center flex-wrap">
                                                {entry.nickname || pokemonName}
                                                {entry.isShiny && <span className="text-yellow-500 text-xs" title="Shiny">✨</span>}
                                            </Link>
                                            <div className="text-xs sm:text-sm text-slate-600 font-medium">
                                                Lv. {level.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap justify-center gap-1 sm:gap-2 w-full mt-1">
                                            <button
                                                className="bg-white hover:bg-slate-100 text-slate-800 text-[10px] sm:text-xs font-bold py-1 px-1.5 sm:px-3 border border-slate-400 rounded shadow-sm disabled:opacity-50 whitespace-nowrap"
                                                onClick={() => handleChallengeFromRanking(detailId)}
                                            >
                                                Khiêu Chiến
                                            </button>
                                            <Link
                                                to={`/pokemon/${detailId}`}
                                                className="bg-white hover:bg-slate-100 text-slate-800 text-[10px] sm:text-xs font-bold py-1 px-1.5 sm:px-3 border border-slate-400 rounded shadow-sm inline-block whitespace-nowrap"
                                            >
                                                Chỉ Số
                                            </Link>
                                        </div>
                                    </div>
                                    <div className="col-span-3 sm:col-span-4 h-full flex flex-col justify-center items-center p-2 gap-1">
                                        <div className="w-10 h-10 rounded overflow-hidden mb-1">
                                            <button
                                                type="button"
                                                onClick={() => openTrainerProfile({
                                                    userId: entry.owner?._id,
                                                    username: entry.owner?.username,
                                                    avatar: entry.owner?.avatar,
                                                }, { returnTo: '/rankings/pokemon' })}
                                                className="w-10 h-10 rounded overflow-hidden"
                                            >
                                                <img
                                                    src={resolveAvatarUrl(entry.owner?.avatar, DEFAULT_AVATAR)}
                                                    className="w-full h-full object-cover"
                                                    alt="Avatar"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null
                                                        e.currentTarget.src = resolveAvatarUrl('', DEFAULT_AVATAR)
                                                    }}
                                                />
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => openTrainerProfile({
                                                userId: entry.owner?._id,
                                                username: entry.owner?.username,
                                                avatar: entry.owner?.avatar,
                                            }, { returnTo: '/rankings/pokemon' })}
                                            className={`font-bold text-sm sm:text-base hover:underline ${getUsernameColor(entry.rank)}`}
                                        >
                                            {entry.owner?.username || 'Không rõ'}
                                        </button>
                                        <div className={`text-xs ${getMasterTitleColor(entry.pokemon)} font-medium`}>
                                            Bậc Thầy {pokemonName}
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
                {pagination && pagination.totalPages > 1 && (
                    <div className="bg-slate-100 border-t-2 border-slate-800 p-2">
                        {renderPagination()}
                    </div>
                )}
            </div>

            <TrainerProfileModal {...trainerModalProps} />
        </div>
    )
}
