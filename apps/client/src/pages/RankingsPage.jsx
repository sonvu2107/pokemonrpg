import { useState, useEffect } from 'react'
import { gameApi } from '../services/gameApi'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

export default function RankingsPage() {
    const [rankings, setRankings] = useState([])
    const [pagination, setPagination] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [currentPage, setCurrentPage] = useState(1)

    useEffect(() => {
        loadRankings(currentPage)
    }, [currentPage])

    const loadRankings = async (page) => {
        try {
            setLoading(true)
            const data = await gameApi.getRankings('overall', page, 35)
            setRankings(data.rankings || [])
            setPagination(data.pagination)
        } catch (err) {
            setError(err.message || 'Failed to load rankings')
        } finally {
            setLoading(false)
        }
    }

    const renderPagination = () => {
        if (!pagination) return null

        const { currentPage, totalPages } = pagination
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
                <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">Map Rankings</h1>
            </div>

            {/* Main Rankings Table */}
            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <SectionHeader title="Overall Rankings" />

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-blue-50 border-b border-blue-300">
                                <th className="px-4 py-3 text-left font-bold text-blue-900 w-20">Rank</th>
                                <th className="px-4 py-3 text-left font-bold text-blue-900">Username</th>
                                <th className="px-4 py-3 text-right font-bold text-blue-900">EXP</th>
                                <th className="px-4 py-3 text-right font-bold text-blue-900 w-28">Level</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rankings.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-4 py-8 text-center text-slate-400 italic">
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
                                        <td className={`px-4 py-3 font-bold ${getUsernameColor(player.rank)}`}>
                                            {player.username}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">
                                            {player.experience.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">
                                            {player.level.toLocaleString()}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination && (
                    <div className="bg-blue-50 border-t border-blue-300">
                        <SectionHeader title="Pages" />
                        {renderPagination()}
                    </div>
                )}
            </div>
        </div>
    )
}
