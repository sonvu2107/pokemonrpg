import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { gameApi } from '../services/gameApi'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const DAILY_TABS = [
    { label: 'BXH Tìm Kiếm', value: 'search' },
    { label: 'BXH EXP Bản Đồ', value: 'mapExp' },
    { label: 'BXH Điểm Nguyệt', value: 'moonPoints' },
]
const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const toDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const buildDateButtons = (today = new Date()) => {
    const start = new Date(today)
    start.setHours(0, 0, 0, 0)

    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start)
        date.setDate(start.getDate() - (6 - index))
        return {
            value: toDateKey(date),
            label: WEEKDAY_LABELS[date.getDay()],
        }
    })
}

export default function RankingsPage() {
    const [rankings, setRankings] = useState([])
    const [pagination, setPagination] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [dailyType, setDailyType] = useState('search')

    const location = useLocation()
    const isDaily = location.pathname.includes('daily')
    const rankingType = isDaily ? 'daily' : 'overall'
    const todayKey = useMemo(() => toDateKey(new Date()), [])
    const [selectedDate, setSelectedDate] = useState(todayKey)
    const dateButtons = useMemo(() => buildDateButtons(new Date()), [])
    const dailyTitleMap = {
        search: 'Bảng Xếp Hạng Tìm Kiếm Hằng Ngày',
        mapExp: 'Bảng Xếp Hạng EXP Bản Đồ Hằng Ngày',
        moonPoints: 'Bảng Xếp Hạng Điểm Nguyệt Hằng Ngày',
    }
    const pageTitle = isDaily ? (dailyTitleMap[dailyType] || dailyTitleMap.search) : 'Bảng Xếp Hạng Chung'

    useEffect(() => {
        setCurrentPage(1)
    }, [rankingType, dailyType, selectedDate])

    useEffect(() => {
        loadRankings(currentPage)
    }, [currentPage, rankingType, dailyType, selectedDate])

    const loadRankings = async (page) => {
        try {
            setError('')
            setLoading(true)
            const data = rankingType === 'daily'
                ? await gameApi.getDailyRankings({ page, limit: 35, type: dailyType, date: selectedDate })
                : await gameApi.getRankings(rankingType, page, 35)

            setRankings(data.rankings || [])
            setPagination(data.pagination || null)

            if (rankingType === 'daily' && data.date && data.date !== selectedDate) {
                setSelectedDate(data.date)
            }
        } catch (err) {
            setError(err.message || 'Không thể tải bảng xếp hạng')
        } finally {
            setLoading(false)
        }
    }

    const renderPagination = () => {
        if (!pagination) return null

        const { currentPage, totalPages } = pagination
        if (!totalPages || totalPages <= 1) return null

        const pages = []

        // Show first page
        pages.push(1)

        // Show pages around current
        const start = Math.max(2, currentPage - 2)
        const end = Math.min(totalPages - 1, currentPage + 2)

        if (start > 2) pages.push('...')
        for (let i = start; i <= end; i++) {
            pages.push(i)
        }
        if (end < totalPages - 1) pages.push('...')

        // Show last page
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

    // Username colors (cycling pattern like in the image)
    const getUsernameColor = (rank) => {
        const colors = [
            'text-green-600',   // Killua420
            'text-cyan-500',    // Rimooona
            'text-purple-600',  // The Grinch
            'text-cyan-600',    // Dialga
            'text-purple-500',  // Skwuid
            'text-blue-500',    // Phil
            'text-pink-500',    // Lilypad
            'text-cyan-600',    // CryptoMoo
            'text-blue-600',    // Vizoin
            'text-blue-500',    // Spy
            'text-blue-600',    // btaayc
            'text-pink-400',    // Rere
        ]
        return colors[(rank - 1) % colors.length]
    }

    const numberFormat = (value) => Number(value || 0).toLocaleString('vi-VN')

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
        <div className="max-w-4xl mx-auto pb-12">
            {/* Header with coins */}
            <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">{pageTitle}</h1>
                <div className="flex items-center justify-center gap-2 text-sm font-bold">
                    <Link to="/rankings/overall" className={`px-3 py-1 rounded ${!isDaily ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>Chung</Link>
                    <Link to="/rankings/pokemon" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Pokémon</Link>
                    <Link to="/rankings/daily" className={`px-3 py-1 rounded ${isDaily ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>Hàng Ngày</Link>
                </div>
            </div>

            {isDaily && (
                <div className="mb-4 rounded border border-blue-200 bg-blue-50/60 px-3 py-3">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold sm:text-sm">
                        {DAILY_TABS.map((tab) => (
                            <button
                                key={tab.value}
                                onClick={() => setDailyType(tab.value)}
                                className={`rounded px-3 py-1 transition-colors ${dailyType === tab.value
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white text-blue-700 hover:bg-blue-100'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold sm:text-sm">
                        {dateButtons.map((item) => (
                            <button
                                key={item.value}
                                onClick={() => setSelectedDate(item.value)}
                                className={`rounded px-3 py-1 transition-colors ${selectedDate === item.value
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-white text-slate-700 hover:bg-blue-100'
                                    }`}
                            >
                                {item.label}
                            </button>
                        ))}
                        <button
                            onClick={() => setSelectedDate(todayKey)}
                            className={`rounded px-3 py-1 transition-colors ${selectedDate === todayKey
                                ? 'bg-cyan-600 text-white'
                                : 'bg-white text-slate-700 hover:bg-blue-100'
                                }`}
                        >
                            Hôm Nay
                        </button>
                        <span className="ml-auto text-xs text-slate-600">{selectedDate}</span>
                    </div>
                </div>
            )}

            {/* Main Rankings Table */}
            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <SectionHeader title={pageTitle} />

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-blue-50 border-b border-blue-300">
                                <th className="px-4 py-3 text-left font-bold text-blue-900 w-20">Hạng</th>
                                <th className="px-4 py-3 text-left font-bold text-blue-900">Người Chơi</th>
                                {isDaily ? (
                                    <>
                                        <th className="px-4 py-3 text-right font-bold text-blue-900">Điểm Nguyệt</th>
                                        <th className="px-4 py-3 text-right font-bold text-blue-900">EXP Bản Đồ</th>
                                        <th className="px-4 py-3 text-right font-bold text-blue-900">Lượt Tìm Kiếm</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-4 py-3 text-right font-bold text-blue-900">Kinh Nghiệm</th>
                                        <th className="px-4 py-3 text-right font-bold text-blue-900 w-28">Cấp Độ</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {rankings.length === 0 ? (
                                <tr>
                                    <td colSpan={isDaily ? 5 : 4} className="px-4 py-8 text-center text-slate-400 italic">
                                        Chưa có dữ liệu
                                    </td>
                                </tr>
                            ) : (
                                rankings.map((player, index) => (
                                    <tr
                                        key={player.userId || index}
                                        className={`border-b border-blue-100 hover:bg-blue-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'
                                            }`}
                                    >
                                        <td className="px-4 py-3 font-bold text-slate-700">
                                            #{player.rank}
                                        </td>
                                        {isDaily ? (
                                            <>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <img
                                                            src={player.avatar || DEFAULT_AVATAR}
                                                            alt={player.username || 'Player'}
                                                            className="h-9 w-9 rounded object-cover border border-blue-200"
                                                            loading="lazy"
                                                            onError={(e) => {
                                                                e.currentTarget.onerror = null
                                                                e.currentTarget.src = DEFAULT_AVATAR
                                                            }}
                                                        />
                                                        <div>
                                                            <div className={`font-bold ${getUsernameColor(player.rank)}`}>
                                                                {player.username || 'Không rõ'}
                                                            </div>
                                                            <div className="text-xs text-slate-500">Cấp {numberFormat(player.level || 1)}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{numberFormat(player.moonPoints)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{numberFormat(player.mapExp)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{numberFormat(player.searches)}</td>
                                            </>
                                        ) : (
                                            <>
                                                <td className={`px-4 py-3 font-bold ${getUsernameColor(player.rank)}`}>
                                                    {player.username}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">
                                                    {numberFormat(player.experience)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">
                                                    {numberFormat(player.level)}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="bg-blue-50 border-t border-blue-300">
                        <SectionHeader title="Trang" />
                        {renderPagination()}
                    </div>
                )}
            </div>
        </div>
    )
}
