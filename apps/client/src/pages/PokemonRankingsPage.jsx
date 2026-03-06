import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import VipAvatar from '../components/VipAvatar'
import TrainerProfileModal from '../components/TrainerProfileModal'
import { useTrainerProfileModal } from '../hooks/useTrainerProfileModal'
import { getVipTitle, getVipTitleImageUrl } from '../utils/vip'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold py-2 px-4 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

export default function PokemonRankingsPage() {
    const [rankings, setRankings] = useState([])
    const [pagination, setPagination] = useState(null)
    const [totalSpecies, setTotalSpecies] = useState(0)
    const [rankingMode, setRankingMode] = useState('collection')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const { openTrainerProfile, trainerModalProps } = useTrainerProfileModal({ defaultReturnTo: '/rankings/pokemon' })

    const isPowerMode = rankingMode === 'power'
    const pageTitle = isPowerMode ? 'BXH Lực Chiến Pokémon' : 'BXH Pokédex'
    const sectionTitle = isPowerMode ? 'Xếp Hạng Lực Chiến Pokémon' : 'Xếp Hạng Pokédex'

    useEffect(() => {
        setCurrentPage(1)
    }, [rankingMode])

    useEffect(() => {
        loadRankings(currentPage)
    }, [currentPage, rankingMode])

    const loadRankings = async (page) => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getPokemonRankings({ page, limit: 35, mode: rankingMode })
            setRankings(Array.isArray(data.rankings) ? data.rankings : [])
            setPagination(data.pagination || null)
            setTotalSpecies(Math.max(0, Number((data.totalDexEntries ?? data.totalSpecies) || 0)))
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

    const numberFormat = (value) => Number(value || 0).toLocaleString('vi-VN')
    const resolveCombatPower = (entry) => {
        const raw = Number(entry?.combatPower ?? entry?.power)
        if (Number.isFinite(raw) && raw > 0) {
            return Math.floor(raw)
        }
        const level = Math.max(1, Number(entry?.level || 1))
        return level * 10
    }

    const renderVipTitle = (userLike) => {
        const vipTitle = getVipTitle(userLike)
        const vipTitleImageUrl = getVipTitleImageUrl(userLike)

        if (vipTitleImageUrl) {
            return (
                <img
                    src={vipTitleImageUrl}
                    alt={vipTitle || 'Danh hiệu VIP'}
                    className="h-6 max-w-[130px] object-contain shrink-0"
                    onError={(event) => {
                        event.currentTarget.style.display = 'none'
                    }}
                />
            )
        }

        if (vipTitle) {
            return (
                <span className="text-xs font-bold text-amber-600 truncate max-w-[130px] shrink-0">
                    {vipTitle}
                </span>
            )
        }

        return null
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
                <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">{pageTitle}</h1>
                <div className="flex items-center justify-center gap-2 text-sm font-bold">
                    <Link to="/rankings/overall" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Chung</Link>
                    <Link to="/rankings/pokemon" className="px-3 py-1 rounded bg-blue-600 text-white">Pokémon</Link>
                    <Link to="/rankings/daily" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Hàng Ngày</Link>
                </div>
                <div className="mt-3 flex items-center justify-center gap-2 text-xs sm:text-sm font-bold">
                    <button
                        type="button"
                        onClick={() => setRankingMode('collection')}
                        className={`px-3 py-1 rounded border ${!isPowerMode
                            ? 'bg-cyan-600 border-cyan-700 text-white'
                            : 'bg-white border-cyan-200 text-cyan-700 hover:bg-cyan-50'
                            }`}
                    >
                        Thu Thập
                    </button>
                    <button
                        type="button"
                        onClick={() => setRankingMode('power')}
                        className={`px-3 py-1 rounded border ${isPowerMode
                            ? 'bg-cyan-600 border-cyan-700 text-white'
                            : 'bg-white border-cyan-200 text-cyan-700 hover:bg-cyan-50'
                            }`}
                    >
                        Lực Chiến
                    </button>
                </div>
            </div>

            <div className="border-2 border-slate-800 bg-white shadow-lg">
                <SectionHeader title={sectionTitle} />
                <div className="overflow-x-auto">
                    {isPowerMode ? (
                        <table className="w-full table-fixed text-sm sm:text-base">
                            <thead>
                                <tr className="bg-blue-100 border-b-2 border-slate-800 text-slate-800 font-bold">
                                    <th className="px-2 py-2 text-left w-[10%] border-r border-slate-400">Hạng</th>
                                    <th className="px-2 py-2 text-left w-[42%] border-r border-slate-400">Pokémon</th>
                                    <th className="px-2 py-2 text-right w-[16%] border-r border-slate-400">Lực Chiến</th>
                                    <th className="px-2 py-2 text-right w-[8%] border-r border-slate-400">Cấp</th>
                                    <th className="px-2 py-2 text-left w-[24%]">Người Chơi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rankings.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-slate-400 italic">
                                            Chưa có dữ liệu
                                        </td>
                                    </tr>
                                ) : (
                                    rankings.map((entry) => {
                                        const detailId = entry.userPokemonId || entry.id
                                        const hasProfile = Boolean(entry.owner?._id)
                                        const displayName = entry.nickname || entry.pokemon?.name || 'Pokemon'
                                        const combatPower = resolveCombatPower(entry)
                                        return (
                                            <tr key={`${detailId || 'unknown'}-${entry.rank}`} className="border-b border-slate-200 hover:bg-blue-50 transition-colors">
                                                <td className="px-2 py-2.5 font-extrabold text-slate-800 border-r border-slate-200">#{entry.rank}</td>
                                                <td className="px-2 py-2.5 border-r border-slate-200">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Link to={`/pokemon/${detailId}`}>
                                                            <img
                                                                src={entry.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'}
                                                                alt={displayName}
                                                                className="w-14 h-14 sm:w-16 sm:h-16 object-contain pixelated"
                                                            />
                                                        </Link>
                                                        <div className="min-w-0 flex-1">
                                                            <Link to={`/pokemon/${detailId}`} className="font-bold text-slate-800 hover:underline block truncate">
                                                                {displayName}
                                                            </Link>
                                                            <div className="text-xs text-slate-500">#{numberFormat(entry.pokemon?.pokedexNumber || 0)}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2.5 text-right font-extrabold text-rose-700 border-r border-slate-200">
                                                    {numberFormat(combatPower)}
                                                </td>
                                                <td className="px-2 py-2.5 text-right font-bold text-slate-700 border-r border-slate-200">
                                                    {numberFormat(entry.level)}
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <VipAvatar
                                                            userLike={entry.owner}
                                                            avatar={entry.owner?.avatar}
                                                            fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"
                                                            alt={entry.owner?.username || 'Trainer'}
                                                            wrapperClassName="h-12 w-12"
                                                            imageClassName="h-12 w-12 rounded object-cover border border-blue-200"
                                                            frameClassName="h-12 w-12 rounded object-cover"
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 min-w-0 flex-nowrap">
                                                                <button
                                                                    type="button"
                                                                    disabled={!hasProfile}
                                                                    onClick={() => openTrainerProfile({
                                                                        userId: entry.owner?._id,
                                                                        username: entry.owner?.username,
                                                                        avatar: entry.owner?.avatar,
                                                                        role: entry.owner?.role,
                                                                        vipTierLevel: entry.owner?.vipTierLevel,
                                                                        vipTierCode: entry.owner?.vipTierCode,
                                                                        vipBenefits: entry.owner?.vipBenefits,
                                                                    }, { returnTo: '/rankings/pokemon' })}
                                                                    className={`font-bold hover:underline disabled:no-underline disabled:opacity-60 truncate ${getUsernameColor(entry.rank)}`}
                                                                >
                                                                    {entry.owner?.username || 'Không rõ'}
                                                                </button>
                                                                {renderVipTitle(entry.owner)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full text-sm sm:text-base">
                            <thead>
                                <tr className="bg-blue-100 border-b-2 border-slate-800 text-slate-800 font-bold">
                                    <th className="px-3 py-2 text-left w-20 border-r border-slate-400">Hạng</th>
                                    <th className="px-3 py-2 text-left border-r border-slate-400">Người Chơi</th>
                                    <th className="px-3 py-2 text-right w-52 border-r border-slate-400">Pokédex / Cá thể</th>
                                    <th className="px-3 py-2 text-right w-40">Hoàn Thành</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rankings.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                                            Chưa có dữ liệu
                                        </td>
                                    </tr>
                                ) : (
                                    rankings.map((entry) => {
                                        const collectedCount = Math.max(0, Number(entry.collectedCount || 0))
                                        const totalPokemon = Math.max(0, Number(entry.totalPokemon || 0))
                                        const completionPercent = Math.max(0, Number(entry.completionPercent || 0))
                                        const hasProfile = Boolean(entry.userId)
                                        return (
                                            <tr key={`${entry.userId || 'unknown'}-${entry.rank}`} className="border-b border-slate-200 hover:bg-blue-50 transition-colors">
                                                <td className="px-3 py-3 font-extrabold text-slate-800 border-r border-slate-200">#{entry.rank}</td>
                                                <td className="px-3 py-3 border-r border-slate-200">
                                                    <div className="flex items-center gap-3">
                                                        <VipAvatar
                                                            userLike={entry}
                                                            avatar={entry.avatar}
                                                            fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png"
                                                            alt={entry.username || 'Trainer'}
                                                            wrapperClassName="h-12 w-12"
                                                            imageClassName="h-12 w-12 rounded object-cover border border-blue-200"
                                                            frameClassName="h-12 w-12 rounded object-cover"
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2 min-w-0 flex-nowrap">
                                                                <button
                                                                    type="button"
                                                                    disabled={!hasProfile}
                                                                    onClick={() => openTrainerProfile({
                                                                        userId: entry.userId,
                                                                        username: entry.username,
                                                                        avatar: entry.avatar,
                                                                        role: entry.role,
                                                                        vipTierLevel: entry.vipTierLevel,
                                                                        vipTierCode: entry.vipTierCode,
                                                                        vipBenefits: entry.vipBenefits,
                                                                    }, { returnTo: '/rankings/pokemon' })}
                                                                    className={`font-bold hover:underline disabled:no-underline disabled:opacity-60 ${getUsernameColor(entry.rank)}`}
                                                                >
                                                                    {entry.username || 'Không rõ'}
                                                                </button>
                                                                {renderVipTitle(entry)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-right font-bold text-slate-700 border-r border-slate-200">
                                                    <div>Pokédex: {numberFormat(collectedCount)}{totalSpecies > 0 ? `/${numberFormat(totalSpecies)}` : ''}</div>
                                                    <div className="text-xs font-medium text-slate-500">
                                                        Cá thể đã có: {numberFormat(totalPokemon)}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <div className="font-bold text-blue-700">{numberFormat(completionPercent)}%</div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
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
