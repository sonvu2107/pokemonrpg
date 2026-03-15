import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import VipUsername from '../components/VipUsername'
import UserAuctionManagementPage from './UserAuctionManagementPage'
import { resolveImageSrc } from '../utils/imageUrl'

const STATUS_OPTIONS = [
    { value: 'active', label: 'Đang diễn ra' },
    { value: 'scheduled', label: 'Sắp diễn ra' },
    { value: 'completed', label: 'Đã kết thúc' },
    { value: 'participated', label: 'Mình tham gia' },
]

const formatDateTime = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('vi-VN')
}

const formatCurrency = (value) => `${Math.max(0, Number(value || 0)).toLocaleString('vi-VN')} Xu Bạch Kim`

export default function AuctionsPage() {
    const BID_HISTORY_PAGE_SIZE = 10
    const { user } = useAuth()
    const location = useLocation()
    const navigate = useNavigate()
    const toast = useToast()
    const [status, setStatus] = useState('active')
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [auctions, setAuctions] = useState([])
    const [wallet, setWallet] = useState({ platinumCoins: 0 })
    const [selectedAuctionId, setSelectedAuctionId] = useState('')
    const [auctionDetail, setAuctionDetail] = useState(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [bidHistory, setBidHistory] = useState([])
    const [bidHistoryPage, setBidHistoryPage] = useState(1)
    const [bidHistoryPagination, setBidHistoryPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: BID_HISTORY_PAGE_SIZE })
    const [bidAmount, setBidAmount] = useState('')
    const [bidding, setBidding] = useState(false)
    const canManageAuctions = Math.max(0, Number(user?.vipTierLevel || 0)) >= 4
    const activeTab = location.pathname === '/auctions/manage' ? 'manage' : 'market'

    const selectedAuction = useMemo(() => {
        const fromList = auctions.find((entry) => entry.id === selectedAuctionId) || null
        return auctionDetail?.auction?.id === selectedAuctionId ? auctionDetail.auction : fromList
    }, [auctionDetail, auctions, selectedAuctionId])

    const loadAuctions = async () => {
        try {
            setLoading(true)
            setError('')
            const data = status === 'participated'
                ? await gameApi.getParticipatedAuctions({ search, limit: 30 })
                : await gameApi.getAuctions({ status, search, limit: 30 })
            const rows = Array.isArray(data?.auctions) ? data.auctions : []
            setWallet({ platinumCoins: Math.max(0, Number(data?.wallet?.platinumCoins || 0)) })
            setAuctions(rows)
            if (rows.length > 0) {
                setSelectedAuctionId((prev) => prev && rows.some((entry) => entry.id === prev) ? prev : rows[0].id)
            } else {
                setSelectedAuctionId('')
                setAuctionDetail(null)
                setBidHistory([])
            }
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách đấu giá')
            setAuctions([])
        } finally {
            setLoading(false)
        }
    }

    const loadAuctionDetail = async (auctionId) => {
        if (!auctionId) {
            setAuctionDetail(null)
            return
        }

        try {
            setDetailLoading(true)
            const data = await gameApi.getAuctionDetail(auctionId)
            setAuctionDetail(data)
            setBidAmount(String(data?.minNextBid || ''))
        } catch (err) {
            toast.showError(err.message || 'Không thể tải chi tiết đấu giá')
        } finally {
            setDetailLoading(false)
        }
    }

    const loadBidHistory = async (auctionId, page = 1) => {
        if (!auctionId) {
            setBidHistory([])
            return
        }

        try {
            setHistoryLoading(true)
            const data = await gameApi.getAuctionBids(auctionId, { page, limit: BID_HISTORY_PAGE_SIZE })
            setBidHistory(Array.isArray(data?.bids) ? data.bids : [])
            setBidHistoryPagination(data?.pagination || { page: 1, totalPages: 1, total: 0, limit: BID_HISTORY_PAGE_SIZE })
        } catch (err) {
            toast.showError(err.message || 'Không thể tải lịch sử đấu giá')
        } finally {
            setHistoryLoading(false)
        }
    }

    const refreshSelectedAuction = async () => {
        await loadAuctions()
        if (selectedAuctionId) {
            await Promise.all([
                loadAuctionDetail(selectedAuctionId),
                loadBidHistory(selectedAuctionId, bidHistoryPage),
            ])
        }
    }

    useEffect(() => {
        if (activeTab !== 'market') return
        loadAuctions()
    }, [status, search, activeTab])

    useEffect(() => {
        if (activeTab !== 'market') return
        if (selectedAuctionId) {
            loadAuctionDetail(selectedAuctionId)
        }
    }, [selectedAuctionId, activeTab])

    useEffect(() => {
        if (activeTab !== 'market') return
        if (!selectedAuctionId) return
        loadBidHistory(selectedAuctionId, bidHistoryPage)
    }, [selectedAuctionId, bidHistoryPage, activeTab])

    useEffect(() => {
        setBidHistoryPage(1)
    }, [selectedAuctionId])

    useEffect(() => {
        if (activeTab !== 'market') return undefined
        if (!selectedAuctionId) return undefined
        const interval = setInterval(() => {
            loadAuctions()
            loadAuctionDetail(selectedAuctionId)
            loadBidHistory(selectedAuctionId, bidHistoryPage)
        }, 15000)
        return () => clearInterval(interval)
    }, [selectedAuctionId, bidHistoryPage, activeTab])

    const handleSearch = () => {
        setSearch(searchInput.trim())
    }

    const handleBid = async () => {
        if (!selectedAuctionId) return
        const amount = Math.max(1, Number.parseInt(bidAmount, 10) || 0)
        if (amount <= 0) {
            toast.showWarning('Giá đấu không hợp lệ')
            return
        }

        try {
            setBidding(true)
            const result = await gameApi.placeAuctionBid(selectedAuctionId, amount)
            toast.showSuccess(result?.message || 'Đặt giá thành công')
            await Promise.all([loadAuctions(), loadAuctionDetail(selectedAuctionId), loadBidHistory(selectedAuctionId, 1)])
            setBidHistoryPage(1)
        } catch (err) {
            toast.showError(err.message || 'Đặt giá thất bại')
        } finally {
            setBidding(false)
        }
    }

    const handleChangeTab = (nextTab) => {
        if (nextTab === 'manage') {
            navigate('/auctions/manage')
            return
        }
        navigate('/auctions')
    }

    return (
        <div className="max-w-6xl mx-auto pb-12 space-y-4">
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Khu Đấu Giá</h1>
                <p className="text-sm text-slate-500">Đấu giá bằng Xu Bạch Kim. Giá cao nhất khi hết giờ sẽ thắng.</p>
                <div className="flex flex-wrap items-center justify-center gap-4 text-sm font-bold">
                    <span className="flex items-center gap-1 text-amber-700">🪙 {wallet.platinumCoins.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                </div>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-bold">
                        <button
                            type="button"
                            onClick={() => handleChangeTab('market')}
                            className={`rounded border px-3 py-2 ${activeTab === 'market' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'}`}
                        >
                            Khu đấu giá
                        </button>
                        <button
                            type="button"
                            onClick={() => handleChangeTab('manage')}
                            disabled={!canManageAuctions}
                            className={`rounded border px-3 py-2 ${activeTab === 'manage' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                            Đấu giá của tôi
                        </button>
                    </div>
                    {!canManageAuctions && (
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                            Tab Đấu giá của tôi yêu cầu tài khoản VIP 4 trở lên.
                        </div>
                    )}
                </div>
            </section>

            {activeTab === 'manage' ? <UserAuctionManagementPage embedded /> : (
                <>

            <section className="rounded-xl border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2 text-center text-white font-bold uppercase tracking-wide">Bộ lọc đấu giá</div>
                <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm font-bold">
                        {STATUS_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setStatus(option.value)}
                                className={`rounded border px-3 py-2 ${status === option.value ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-col md:flex-row gap-2">
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleSearch()
                            }}
                            placeholder="Tìm theo mã hoặc tiêu đề đấu giá"
                            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                        />
                        <button type="button" onClick={handleSearch} className="rounded border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">Tìm</button>
                    </div>
                </div>
            </section>

            {error && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">Danh sách phiên đấu giá</div>
                    <div className="max-h-[40vh] overflow-y-auto divide-y divide-slate-100">
                        {loading ? (
                            <div className="px-4 py-8 text-center text-slate-500 font-medium">Đang tải dữ liệu đấu giá...</div>
                        ) : auctions.length === 0 ? (
                            <div className="px-4 py-8 text-center text-slate-500">Chưa có phiên đấu giá phù hợp.</div>
                        ) : auctions.map((auction) => (
                            <button
                                key={auction.id}
                                type="button"
                                onClick={() => setSelectedAuctionId(auction.id)}
                                className={`w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors ${selectedAuctionId === auction.id ? 'bg-blue-50' : 'bg-white'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-14 h-14 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                        {auction.rewardSnapshot?.imageUrl ? <img src={resolveImageSrc(auction.rewardSnapshot.imageUrl)} alt={auction.rewardSnapshot?.name} className="w-10 h-10 object-contain" /> : <span className="text-slate-300 text-xs">?</span>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold uppercase tracking-wide text-blue-700">{auction.code}</div>
                                        <div className="font-bold text-slate-800 line-clamp-2">{auction.title}</div>
                                        <div className="text-xs text-slate-500 mt-1">Giá cao nhất: {formatCurrency(auction.highestBid || 0)}</div>
                                        <div className="text-xs text-slate-500">Người tham gia: {Number(auction.participantCount || 0).toLocaleString('vi-VN')}</div>
                                        <div className="text-xs text-slate-500">Kết thúc: {formatDateTime(auction.endsAt)}</div>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-slate-700">Chi tiết phiên đấu giá</div>
                        <button type="button" onClick={refreshSelectedAuction} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Làm mới</button>
                    </div>
                    {!selectedAuction ? (
                        <div className="px-4 py-8 text-center text-slate-500">Chọn một phiên đấu giá để xem chi tiết.</div>
                    ) : detailLoading && !auctionDetail ? (
                        <div className="px-4 py-8 text-center text-slate-500">Đang tải chi tiết...</div>
                    ) : (
                        <div className="p-4 space-y-4">
                            <div className="flex flex-col md:flex-row gap-4">
                                <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                                    {selectedAuction.rewardSnapshot?.imageUrl ? <img src={resolveImageSrc(selectedAuction.rewardSnapshot.imageUrl)} alt={selectedAuction.rewardSnapshot?.name} className="w-16 h-16 object-contain" /> : <span className="text-slate-300">?</span>}
                                </div>
                                <div className="space-y-2 min-w-0 flex-1">
                                    <div className="text-xs font-bold uppercase tracking-wide text-blue-700">{selectedAuction.code}</div>
                                    <h2 className="text-xl font-bold text-slate-800">{selectedAuction.title}</h2>
                                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{selectedAuction.description || 'Không có mô tả thêm.'}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Phần thưởng:</span> {selectedAuction.rewardSnapshot?.name} x{selectedAuction.rewardSnapshot?.quantity || 1}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Giá khởi điểm:</span> {formatCurrency(selectedAuction.startingBid)}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Bước giá:</span> {formatCurrency(selectedAuction.minIncrement)}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Giá tối thiểu tiếp theo:</span> {formatCurrency(auctionDetail?.minNextBid || selectedAuction.minNextBid)}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Giá cao nhất:</span> {formatCurrency(selectedAuction.highestBid || 0)}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Người tham gia:</span> {Number(selectedAuction.participantCount || 0).toLocaleString('vi-VN')}</div>
                                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold text-slate-700">Kết thúc:</span> {formatDateTime(selectedAuction.endsAt)}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                                <div className="text-sm font-bold text-blue-900">Đặt giá</div>
                                <div className="text-sm text-blue-800">
                                    Giá cao nhất của bạn: <span className="font-bold">{formatCurrency(auctionDetail?.myHighestBid || 0)}</span>
                                    {auctionDetail?.isLeading ? <span className="ml-2 font-bold text-emerald-700">Bạn đang dẫn đầu</span> : null}
                                </div>
                                <div className="flex flex-col md:flex-row gap-2">
                                    <input
                                        type="number"
                                        min={auctionDetail?.minNextBid || 1}
                                        value={bidAmount}
                                        onChange={(event) => setBidAmount(event.target.value)}
                                        disabled={!auctionDetail?.canBid || bidding}
                                        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleBid}
                                        disabled={!auctionDetail?.canBid || bidding}
                                        className="rounded border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                    >
                                        {bidding ? 'Đang gửi giá...' : 'Đặt giá'}
                                    </button>
                                </div>
                                {!auctionDetail?.canBid && <div className="text-xs font-semibold text-slate-500">Phiên này hiện không thể đặt giá.</div>}
                            </div>

                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
                                    <div className="text-sm font-bold text-slate-700">Lịch sử giá gần nhất</div>
                                    <div className="text-xs font-semibold text-slate-500">Trang {bidHistoryPagination.page || 1}/{bidHistoryPagination.totalPages || 1}</div>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {historyLoading ? (
                                        <div className="px-4 py-6 text-center text-sm text-slate-500">Đang tải lịch sử giá...</div>
                                    ) : bidHistory.length === 0 ? (
                                        <div className="px-4 py-6 text-center text-sm text-slate-500">Chưa có ai đặt giá.</div>
                                    ) : bidHistory.map((bid) => (
                                        <div key={bid.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                                            <div>
                                                <VipUsername userLike={bid} className="font-bold text-slate-800">{bid.username}</VipUsername>
                                                <div className="text-xs text-slate-500">{formatDateTime(bid.createdAt)}</div>
                                            </div>
                                            <div className="font-bold text-blue-700">{formatCurrency(bid.amount)}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-2">
                                    <div className="text-xs text-slate-500">Tổng lượt trả giá: {Number(bidHistoryPagination.total || 0).toLocaleString('vi-VN')}</div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setBidHistoryPage((prev) => Math.max(1, prev - 1))} disabled={(bidHistoryPagination.page || 1) <= 1 || historyLoading} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Trang trước</button>
                                        <button type="button" onClick={() => setBidHistoryPage((prev) => Math.min(bidHistoryPagination.totalPages || 1, prev + 1))} disabled={(bidHistoryPagination.page || 1) >= (bidHistoryPagination.totalPages || 1) || historyLoading} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Trang sau</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
                </>
            )}
        </div>
    )
}
