import { useEffect, useState } from 'react'
import { gameApi } from '../services/gameApi'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const formatCurrency = (value) => `$${formatNumber(value)}`

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

export default function OnlineStatsPage() {
    const [wallet, setWallet] = useState({ gold: 0, moonPoints: 0 })
    const [onlineCount, setOnlineCount] = useState(0)
    const [onlineTrainers, setOnlineTrainers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1 })

    useEffect(() => {
        loadWallet()
        loadOnline(1)
    }, [])

    const loadWallet = async () => {
        try {
            const data = await gameApi.getProfile()
            setWallet({
                gold: Number(data?.playerState?.gold || 0),
                moonPoints: Number(data?.playerState?.moonPoints || 0),
            })
        } catch (_err) {
            setWallet({ gold: 0, moonPoints: 0 })
        }
    }

    const loadOnline = async (page = 1) => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getOnlineStats({ page, limit: 25 })
            setOnlineCount(Number(data?.onlineCount || 0))
            setOnlineTrainers(Array.isArray(data?.onlineTrainers) ? data.onlineTrainers : [])
            setPagination({
                page: Number(data?.pagination?.page || 1),
                totalPages: Number(data?.pagination?.totalPages || 1),
            })
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách online')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12">
            <div className="text-center mb-5">
                <h1 className="text-3xl font-bold text-blue-900">Huấn luyện viên trực tuyến</h1>
                <div className="mt-2 text-sm text-slate-700 font-medium">
                    Hiện đang có <span className="font-bold text-blue-900">{formatNumber(onlineCount)}</span> huấn luyện viên online.
                </div>
            </div>

            {error && (
                <div className="mb-4 border border-red-300 bg-red-50 text-red-700 px-4 py-3 font-bold">
                    {error}
                </div>
            )}

            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <SectionHeader title="Danh sách đang online" />
                <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm font-bold text-slate-700 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                    <span>Xu Bạch Kim: <span className="text-blue-900">{formatCurrency(wallet.gold)}</span></span>
                    <span>Điểm Nguyệt: <span className="text-blue-900">{formatNumber(wallet.moonPoints)}</span></span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead>
                            <tr className="bg-blue-50 border-b border-blue-300">
                                <th className="px-4 py-3 text-center font-bold text-blue-900 w-28">Mã</th>
                                <th className="px-4 py-3 text-center font-bold text-blue-900">Người chơi</th>
                                <th className="px-4 py-3 text-center font-bold text-blue-900 w-52">Thời gian chơi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="3" className="px-4 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách online...</td>
                                </tr>
                            ) : onlineTrainers.length === 0 ? (
                                <tr>
                                    <td colSpan="3" className="px-4 py-8 text-center text-slate-400 italic">Không có huấn luyện viên online</td>
                                </tr>
                            ) : (
                                onlineTrainers.map((entry, index) => (
                                    <tr
                                        key={`${entry.rank}-${entry.username}`}
                                        className={`border-b border-blue-100 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}`}
                                    >
                                        <td className="px-4 py-3 text-center font-bold text-slate-800">{entry.userIdLabel}</td>
                                        <td className="px-4 py-3 text-center font-bold text-indigo-800">{entry.username}</td>
                                        <td className="px-4 py-3 text-center text-slate-700">{entry.playTime}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {pagination.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
                    <button
                        onClick={() => loadOnline(Math.max(1, pagination.page - 1))}
                        disabled={pagination.page <= 1 || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Trước
                    </button>
                    <span className="text-slate-700">Trang {pagination.page}/{pagination.totalPages}</span>
                    <button
                        onClick={() => loadOnline(Math.min(pagination.totalPages, pagination.page + 1))}
                        disabled={pagination.page >= pagination.totalPages || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Sau
                    </button>
                </div>
            )}
        </div>
    )
}
