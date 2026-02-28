import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

const formatDate = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleDateString('vi-VN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}

export default function ShopSellPage() {
    const [wallet, setWallet] = useState({ gold: 0, moonPoints: 0 })
    const [availablePokemon, setAvailablePokemon] = useState([])
    const [activeListings, setActiveListings] = useState([])
    const [soldListings, setSoldListings] = useState([])
    const [pagination, setPagination] = useState({
        limit: 20,
        active: { page: 1, totalPages: 1 },
        sold: { page: 1, totalPages: 1 },
    })

    const [selectedPokemonId, setSelectedPokemonId] = useState('')
    const [price, setPrice] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [cancellingId, setCancellingId] = useState('')
    const [loadedAvailable, setLoadedAvailable] = useState(false)

    const activePage = pagination?.active?.page || 1
    const soldPage = pagination?.sold?.page || 1

    useEffect(() => {
        loadSellData(activePage, soldPage, { includeAvailable: !loadedAvailable })
    }, [activePage, soldPage])

    const selectedPokemon = useMemo(
        () => availablePokemon.find((entry) => entry.id === selectedPokemonId) || null,
        [availablePokemon, selectedPokemonId]
    )

    const loadSellData = async (nextActivePage = 1, nextSoldPage = 1, options = {}) => {
        try {
            setLoading(true)
            setError('')
            const includeAvailable = Boolean(options.includeAvailable)
            const data = await gameApi.getShopSellData({
                activePage: nextActivePage,
                soldPage: nextSoldPage,
                limit: pagination.limit,
                includeAvailable: includeAvailable ? 1 : 0,
            })

            setWallet({
                gold: Number(data?.wallet?.gold || 0),
                moonPoints: Number(data?.wallet?.moonPoints || 0),
            })
            if (Array.isArray(data.availablePokemon)) {
                setAvailablePokemon(data.availablePokemon)
                setLoadedAvailable(true)
            }
            setActiveListings(data.activeListings || [])
            setSoldListings(data.soldListings || [])
            setPagination((prev) => ({
                ...prev,
                ...(data.pagination || {}),
            }))

            if (selectedPokemonId && !(data.availablePokemon || []).some((entry) => entry.id === selectedPokemonId)) {
                setSelectedPokemonId('')
            }
        } catch (err) {
            setError(err.message || 'Không thể tải dữ liệu cửa hàng bán')
        } finally {
            setLoading(false)
        }
    }

    const handleCreateListing = async () => {
        const numericPrice = parseInt(price, 10)
        if (!selectedPokemonId) {
            window.alert('Vui lòng chọn Pokemon để đăng bán.')
            return
        }
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
            window.alert('Giá bán không hợp lệ.')
            return
        }

        try {
            setSubmitting(true)
            await gameApi.createShopListing({
                userPokemonId: selectedPokemonId,
                price: numericPrice,
            })
            setSelectedPokemonId('')
            setPrice('')
            await loadSellData(1, soldPage, { includeAvailable: true })
        } catch (err) {
            window.alert(err.message || 'Đăng bán thất bại')
        } finally {
            setSubmitting(false)
        }
    }

    const handleCancelListing = async (listingId) => {
        try {
            setCancellingId(listingId)
            await gameApi.cancelShopListing(listingId)
            await loadSellData(activePage, soldPage, { includeAvailable: true })
        } catch (err) {
            window.alert(err.message || 'Hủy tin đăng thất bại')
        } finally {
            setCancellingId('')
        }
    }

    const renderPageButtons = (type) => {
        const pageInfo = pagination?.[type] || { page: 1, totalPages: 1 }
        const totalPages = pageInfo.totalPages || 1
        const current = pageInfo.page || 1
        if (totalPages <= 1) return null

        const onClickPage = (page) => {
            if (type === 'active') {
                setPagination((prev) => ({ ...prev, active: { ...prev.active, page } }))
            } else {
                setPagination((prev) => ({ ...prev, sold: { ...prev.sold, page } }))
            }
        }

        return (
            <div className="flex justify-center gap-1 flex-wrap p-2 bg-slate-50 border-t border-blue-200">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                        key={`${type}-${pageNumber}`}
                        onClick={() => onClickPage(pageNumber)}
                        className={`w-8 h-8 text-xs font-bold rounded border ${pageNumber === current
                            ? 'bg-blue-600 text-white border-blue-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }`}
                    >
                        {pageNumber}
                    </button>
                ))}
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <div className="text-slate-700 text-sm font-bold flex justify-center gap-4 mb-1">
                    <span className="flex items-center gap-1">🪙 {wallet.gold.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌙 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt</span>
                </div>
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Bán Pokemon</h1>
            </div>

            <div className="space-y-4">
                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Đăng Bán Pokemon" />
                    <div className="bg-blue-100/50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase">
                        Chọn Pokemon từ kho và đặt giá
                    </div>

                    <div className="p-4 space-y-3">
                        {loading ? (
                            <div className="text-center text-slate-500 font-bold py-4">Đang tải danh sách Pokemon...</div>
                        ) : availablePokemon.length === 0 ? (
                            <div className="text-center text-slate-500">Không có Pokemon khả dụng để đăng bán.</div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <select
                                        value={selectedPokemonId}
                                        onChange={(e) => setSelectedPokemonId(e.target.value)}
                                        className="border border-slate-300 rounded px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
                                    >
                                        <option value="">Chọn Pokemon muốn bán</option>
                                        {availablePokemon.map((entry) => (
                                            <option key={entry.id} value={entry.id}>
                                                {entry.pokemonName} (Lv.{entry.level})
                                            </option>
                                        ))}
                                    </select>

                                    <input
                                        type="number"
                                        min="1"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                        placeholder="Nhập giá bán (xu)"
                                        className="border border-slate-300 rounded px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
                                    />
                                </div>

                                {selectedPokemon && (
                                    <div className="flex items-center gap-3 rounded border border-blue-200 bg-blue-50 p-3">
                                        <img
                                            src={selectedPokemon.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'}
                                            alt={selectedPokemon.speciesName}
                                            className="w-14 h-14 object-contain pixelated"
                                        />
                                        <div className="text-sm">
                                            <div className="font-bold text-slate-800">{selectedPokemon.pokemonName}</div>
                                            <div className="text-slate-600">Loài: {selectedPokemon.speciesName}</div>
                                            <div className="text-slate-600">Cấp độ: {selectedPokemon.level}</div>
                                        </div>
                                    </div>
                                )}

                                <div className="text-center">
                                    <button
                                        onClick={handleCreateListing}
                                        disabled={submitting || !selectedPokemonId}
                                        className="px-4 py-2 rounded border border-blue-300 bg-white text-blue-700 font-bold text-sm hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {submitting ? 'Đang đăng bán...' : '[ Đăng bán ]'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Tin Đăng Đang Hoạt Động" />
                    {error ? (
                        <div className="px-4 py-8 text-center text-red-600 font-bold">{error}</div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="bg-blue-50 border-b border-blue-300 text-blue-900 text-xs sm:text-sm font-bold">
                                            <th className="px-2 py-2 text-center border-r border-blue-200 w-20 sm:w-28">Sprite</th>
                                            <th className="px-2 py-2 text-center border-r border-blue-200">Pokemon</th>
                                            <th className="px-2 py-2 text-center border-r border-blue-200 w-28 sm:w-36">Giá</th>
                                            <th className="px-2 py-2 text-center w-20 sm:w-24">Tác vụ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeListings.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">Bạn chưa có tin đăng hoạt động.</td>
                                            </tr>
                                        ) : (
                                            activeListings.map((listing) => (
                                                <tr key={listing.id} className="border-b border-blue-100 hover:bg-blue-50/40">
                                                    <td className="px-1 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                        <img src={listing.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'} alt={listing.speciesName} className="w-10 h-10 sm:w-14 sm:h-14 object-contain pixelated mx-auto" />
                                                    </td>
                                                    <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                        <div className="font-bold text-slate-800 text-xs sm:text-sm">{listing.pokemonName}</div>
                                                        <div className="text-xs sm:text-sm text-slate-600">Lv.{listing.level}</div>
                                                        <div className="text-[10px] sm:text-xs text-slate-500">Đăng ngày: {formatDate(listing.listedAt)}</div>
                                                    </td>
                                                    <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center text-sm sm:text-lg font-bold text-slate-800">
                                                        {Number(listing.price || 0).toLocaleString('vi-VN')} xu
                                                    </td>
                                                    <td className="px-1 sm:px-3 py-2 sm:py-3 text-center">
                                                        <button
                                                            onClick={() => handleCancelListing(listing.id)}
                                                            disabled={cancellingId === listing.id}
                                                            className="px-2 py-1 sm:px-3 sm:py-1.5 bg-white border border-red-300 text-red-700 font-bold text-xs sm:text-sm hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {cancellingId === listing.id ? 'Hủy...' : 'Hủy'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {renderPageButtons('active')}
                        </>
                    )}
                </section>

                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Pokemon Đã Bán" />
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-blue-50 border-b border-blue-300 text-blue-900 text-xs sm:text-sm font-bold">
                                    <th className="px-2 py-2 text-center border-r border-blue-200 w-20 sm:w-28">Sprite</th>
                                    <th className="px-2 py-2 text-center border-r border-blue-200">Pokemon</th>
                                    <th className="px-2 py-2 text-center border-r border-blue-200 w-28 sm:w-36">Giá</th>
                                    <th className="px-2 py-2 text-center w-24 sm:w-36">Người mua</th>
                                </tr>
                            </thead>
                            <tbody>
                                {soldListings.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-8 text-center text-slate-500">Bạn chưa bán Pokemon nào.</td>
                                    </tr>
                                ) : (
                                    soldListings.map((listing) => (
                                        <tr key={listing.id} className="border-b border-blue-100 hover:bg-blue-50/40">
                                            <td className="px-1 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                <img src={listing.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'} alt={listing.speciesName} className="w-10 h-10 sm:w-14 sm:h-14 object-contain pixelated mx-auto" />
                                            </td>
                                            <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                <div className="font-bold text-slate-800 text-xs sm:text-sm">{listing.pokemonName}</div>
                                                <div className="text-xs sm:text-sm text-slate-600">Lv.{listing.level}</div>
                                                <div className="text-[10px] sm:text-xs text-slate-500">Bán ngày: {formatDate(listing.soldAt || listing.listedAt)}</div>
                                            </td>
                                            <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center text-sm sm:text-lg font-bold text-slate-800">
                                                {Number(listing.price || 0).toLocaleString('vi-VN')} xu
                                            </td>
                                            <td className="px-1 sm:px-3 py-2 sm:py-3 text-center">
                                                <div className="font-bold text-slate-700 text-xs sm:text-sm break-words">{listing.buyer?.username || 'Không rõ'}</div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {renderPageButtons('sold')}
                </section>
            </div>
        </div>
    )
}
