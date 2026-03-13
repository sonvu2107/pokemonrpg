import { useEffect, useState } from 'react'
import { gameApi } from '../services/gameApi'
import { useAuth } from '../context/AuthContext'
import VipUsername from '../components/VipUsername'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')

const formatDateLabel = (dateKey) => {
    const [year, month, day] = String(dateKey || '').split('-').map((part) => Number(part))
    if (!year || !month || !day) return 'Thống kê theo ngày'
    return `Thống kê ngày ${day} tháng ${month} năm ${year}`
}

const DaySectionHeader = ({ title }) => (
    <div className="bg-gradient-to-b from-sky-400 to-blue-600 text-white font-bold text-center py-2 border border-blue-800 border-b-0 text-base sm:text-xl">
        {title}
    </div>
)

const StatsTable = ({ row }) => {
    if (!row?.hasData) {
        return (
            <div className="border border-blue-800 bg-white px-3 py-3 text-sm">
                -
            </div>
        )
    }

    return (
        <div className="border border-blue-800 bg-white overflow-x-auto">
            <table className="w-full border-collapse min-w-[640px] text-sm">
                <thead>
                    <tr className="bg-sky-100 text-left font-bold text-slate-900">
                        <th className="border border-blue-800 px-2 py-2">Tên bản đồ</th>
                        <th className="border border-blue-800 px-2 py-2">Lượt tìm kiếm</th>
                        <th className="border border-blue-800 px-2 py-2">Điểm Nguyệt bản đồ</th>
                        <th className="border border-blue-800 px-2 py-2">EXP bản đồ</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td className="border border-blue-800 px-2 py-2">{row.mapName || '-'}</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.searches)}</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.mapMoonPoints)} Điểm</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.mapExp)} EXP</td>
                    </tr>

                    <tr className="bg-sky-100 text-left font-bold text-slate-900">
                        <th className="border border-blue-800 px-2 py-2">Số trận</th>
                        <th className="border border-blue-800 px-2 py-2">Cấp độ</th>
                        <th className="border border-blue-800 px-2 py-2">Điểm Nguyệt chiến đấu</th>
                        <th className="border border-blue-800 px-2 py-2">Xu Bạch Kim</th>
                    </tr>
                    <tr>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.battles)}</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.levels)} cấp</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.battleMoonPoints)} Điểm</td>
                        <td className="border border-blue-800 px-2 py-2">{formatNumber(row.platinumCoins)} Xu</td>
                    </tr>

                    <tr className="bg-sky-100 text-left font-bold text-slate-900">
                        <th colSpan="2" className="border border-blue-800 px-2 py-2">Đào mỏ</th>
                        <th colSpan="2" className="border border-blue-800 px-2 py-2">Mảnh</th>
                    </tr>
                    <tr>
                        <td colSpan="2" className="border border-blue-800 px-2 py-2">{formatNumber(row.mines)}</td>
                        <td colSpan="2" className="border border-blue-800 px-2 py-2">{formatNumber(row.shards)} mảnh</td>
                    </tr>

                    <tr className="bg-sky-100 text-left font-bold text-slate-900">
                        <th colSpan="2" className="border border-blue-800 px-2 py-2">Xu Kim Cương</th>
                        <th colSpan="2" className="border border-blue-800 px-2 py-2">EXP Huấn Luyện Viên</th>
                    </tr>
                    <tr>
                        <td colSpan="2" className="border border-blue-800 px-2 py-2">{formatNumber(row.diamondCoins)} Xu KC</td>
                        <td colSpan="2" className="border border-blue-800 px-2 py-2">{formatNumber(row.trainerExp)} EXP</td>
                    </tr>
                </tbody>
            </table>
        </div>
    )
}

export default function DailyStatsPage() {
    const { user: authUser } = useAuth()
    const [username, setUsername] = useState(authUser?.username || 'Huấn Luyện Viên')
    const [stats, setStats] = useState([])
    const [loading, setLoading] = useState(true)
    const [dailyError, setDailyError] = useState('')

    useEffect(() => {
        loadDailyStats()
    }, [])

    const loadDailyStats = async () => {
        try {
            setDailyError('')
            setLoading(true)
            const data = await gameApi.getDailyStats({ days: 31 })
            setStats(Array.isArray(data?.stats) ? data.stats : [])
            if (data?.user?.username) {
                setUsername(data.user.username)
            }
        } catch (err) {
            setDailyError(err.message || 'Không thể tải thống kê hằng ngày')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12">
            <div className="text-center mb-5">
                <h1 className="text-3xl font-bold text-slate-800">Thống kê hằng ngày của <VipUsername userLike={authUser}>{username}</VipUsername></h1>
                <div className="mt-1 text-sm font-bold text-blue-700 underline decoration-blue-400 cursor-not-allowed" title="Tính năng đang được phát triển">
                    Xem thống kê đào mỏ chi tiết
                </div>
            </div>

            {loading && stats.length === 0 && (
                <div className="text-center py-8 text-slate-500 font-bold">Đang tải thống kê...</div>
            )}

            {dailyError && (
                <div className="mb-4 border border-red-300 bg-red-50 text-red-700 px-4 py-3 font-bold">
                    {dailyError}
                </div>
            )}

            <div className="space-y-4">
                {stats.map((row) => (
                    <section key={row.date}>
                        <DaySectionHeader title={formatDateLabel(row.date)} />
                        <StatsTable row={row} />
                    </section>
                ))}
            </div>
        </div>
    )
}
