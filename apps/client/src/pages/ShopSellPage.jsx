import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'
import PokemonTradeDetailModal from '../components/PokemonTradeDetailModal'

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

const SELL_POKEMON_MODAL_PAGE_SIZE = 24

export default function ShopSellPage() {
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const [availablePokemon, setAvailablePokemon] = useState([])
    const toast = useToast()
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
    const [showPokemonPickerModal, setShowPokemonPickerModal] = useState(false)
    const [pokemonPickerSearchTerm, setPokemonPickerSearchTerm] = useState('')
    const [pokemonPickerPage, setPokemonPickerPage] = useState(1)
    const [detailPokemon, setDetailPokemon] = useState(null)
    const [detailTitle, setDetailTitle] = useState('Chi tiết Pokémon')

    const activePage = pagination?.active?.page || 1
    const soldPage = pagination?.sold?.page || 1

    useEffect(() => {
        loadSellData(activePage, soldPage, { includeAvailable: !loadedAvailable })
    }, [activePage, soldPage])

    const selectedPokemon = useMemo(
        () => availablePokemon.find((entry) => entry.id === selectedPokemonId) || null,
        [availablePokemon, selectedPokemonId]
    )

    const pokemonPickerRows = useMemo(() => {
        const normalizedSearch = String(pokemonPickerSearchTerm || '').trim().toLowerCase()
        if (!normalizedSearch) return availablePokemon

        return availablePokemon.filter((entry) => {
            const pokemonName = String(entry?.pokemonName || '').toLowerCase()
            const speciesName = String(entry?.speciesName || '').toLowerCase()
            const formName = String(entry?.formName || '').toLowerCase()
            const formId = String(entry?.formId || '').toLowerCase()
            return pokemonName.includes(normalizedSearch)
                || speciesName.includes(normalizedSearch)
                || formName.includes(normalizedSearch)
                || formId.includes(normalizedSearch)
        })
    }, [availablePokemon, pokemonPickerSearchTerm])

    const pokemonPickerTotal = pokemonPickerRows.length
    const pokemonPickerTotalPages = Math.max(1, Math.ceil(pokemonPickerTotal / SELL_POKEMON_MODAL_PAGE_SIZE))
    const normalizedPokemonPickerPage = Math.min(pokemonPickerPage, pokemonPickerTotalPages)
    const pokemonPickerPageStartIndex = (normalizedPokemonPickerPage - 1) * SELL_POKEMON_MODAL_PAGE_SIZE
    const pokemonPickerPageRows = pokemonPickerRows.slice(
        pokemonPickerPageStartIndex,
        pokemonPickerPageStartIndex + SELL_POKEMON_MODAL_PAGE_SIZE
    )
    const pokemonPickerPageStart = pokemonPickerTotal > 0
        ? pokemonPickerPageStartIndex + 1
        : 0
    const pokemonPickerPageEnd = pokemonPickerTotal > 0
        ? Math.min(pokemonPickerTotal, pokemonPickerPageStartIndex + SELL_POKEMON_MODAL_PAGE_SIZE)
        : 0

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
                platinumCoins: Number(data?.wallet?.platinumCoins ?? 0),
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
            toast.showWarning('Vui lòng chọn Pokemon để đăng bán.')
            return
        }
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
            toast.showWarning('Giá bán không hợp lệ.')
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
            toast.showSuccess('Đăng bán Pokemon thành công')
        } catch (err) {
            toast.showError(err.message || 'Đăng bán thất bại')
        } finally {
            setSubmitting(false)
        }
    }

    const handleCancelListing = async (listingId) => {
        try {
            setCancellingId(listingId)
            await gameApi.cancelShopListing(listingId)
            await loadSellData(activePage, soldPage, { includeAvailable: true })
            toast.showSuccess('Hủy tin đăng thành công')
        } catch (err) {
            toast.showError(err.message || 'Hủy tin đăng thất bại')
        } finally {
            setCancellingId('')
        }
    }

    const handleOpenPokemonPickerModal = () => {
        setPokemonPickerSearchTerm('')
        setPokemonPickerPage(1)
        setShowPokemonPickerModal(true)
    }

    const handleSelectPokemonFromModal = (pokemonId) => {
        setSelectedPokemonId(String(pokemonId || '').trim())
        setShowPokemonPickerModal(false)
    }

    const handleOpenPokemonDetail = (pokemonEntry, title = 'Chi tiết Pokémon') => {
        setDetailPokemon(pokemonEntry || null)
        setDetailTitle(title)
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
                    <span className="flex items-center gap-1">🪙 {wallet.platinumCoins.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌙 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt Các</span>
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
                                    <button
                                        type="button"
                                        onClick={handleOpenPokemonPickerModal}
                                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-slate-700 bg-white text-left focus:outline-none focus:border-blue-500 hover:bg-slate-50"
                                    >
                                        {selectedPokemon
                                            ? `${selectedPokemon.pokemonName} (Lv.${selectedPokemon.level})`
                                            : 'Chọn Pokemon muốn bán'}
                                    </button>

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
                                            {selectedPokemon.formId && selectedPokemon.formId !== 'normal' && (
                                                <div className="text-sky-700 font-bold text-xs uppercase">Form: {selectedPokemon.formName || selectedPokemon.formId}</div>
                                            )}
                                            <div className="text-slate-600">Cấp độ: {selectedPokemon.level}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenPokemonDetail(selectedPokemon, 'Chi tiết Pokémon muốn bán')}
                                            className="ml-auto px-2 py-1 text-xs font-bold rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-50"
                                        >
                                            Chi tiết
                                        </button>
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
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenPokemonDetail(listing, 'Chi tiết Pokémon đang bán')}
                                                            className="rounded hover:bg-blue-50 p-1"
                                                        >
                                                            <img src={listing.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'} alt={listing.speciesName} className="w-10 h-10 sm:w-14 sm:h-14 object-contain pixelated mx-auto" />
                                                        </button>
                                                    </td>
                                                    <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenPokemonDetail(listing, 'Chi tiết Pokémon đang bán')}
                                                            className="w-full text-center rounded p-1 hover:bg-blue-50"
                                                        >
                                                            <div className="font-bold text-slate-800 text-xs sm:text-sm">{listing.pokemonName}</div>
                                                            {listing.formId && listing.formId !== 'normal' && (
                                                                <div className="text-[10px] sm:text-xs text-sky-700 font-bold uppercase">{listing.formName || listing.formId}</div>
                                                            )}
                                                            <div className="text-xs sm:text-sm text-slate-600">Lv.{listing.level}</div>
                                                            <div className="text-[10px] sm:text-xs text-slate-500">Đăng ngày: {formatDate(listing.listedAt)}</div>
                                                        </button>
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
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenPokemonDetail(listing, 'Chi tiết Pokémon đã bán')}
                                                    className="rounded hover:bg-blue-50 p-1"
                                                >
                                                    <img src={listing.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'} alt={listing.speciesName} className="w-10 h-10 sm:w-14 sm:h-14 object-contain pixelated mx-auto" />
                                                </button>
                                            </td>
                                            <td className="px-2 sm:px-3 py-2 sm:py-3 border-r border-blue-100 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenPokemonDetail(listing, 'Chi tiết Pokémon đã bán')}
                                                    className="w-full text-center rounded p-1 hover:bg-blue-50"
                                                >
                                                    <div className="font-bold text-slate-800 text-xs sm:text-sm">{listing.pokemonName}</div>
                                                    {listing.formId && listing.formId !== 'normal' && (
                                                        <div className="text-[10px] sm:text-xs text-sky-700 font-bold uppercase">{listing.formName || listing.formId}</div>
                                                    )}
                                                    <div className="text-xs sm:text-sm text-slate-600">Lv.{listing.level}</div>
                                                    <div className="text-[10px] sm:text-xs text-slate-500">Bán ngày: {formatDate(listing.soldAt || listing.listedAt)}</div>
                                                </button>
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

            {showPokemonPickerModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={() => setShowPokemonPickerModal(false)}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Chọn Pokemon để đăng bán</h3>
                            <button
                                type="button"
                                onClick={() => setShowPokemonPickerModal(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokemon</label>
                                <input
                                    type="text"
                                    value={pokemonPickerSearchTerm}
                                    onChange={(event) => {
                                        setPokemonPickerSearchTerm(event.target.value)
                                        setPokemonPickerPage(1)
                                    }}
                                    placeholder="Nhập tên Pokemon"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {pokemonPickerPageRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không có Pokemon phù hợp</div>
                                ) : (
                                    pokemonPickerPageRows.map((entry) => {
                                        const isSelected = entry.id === selectedPokemonId
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => handleSelectPokemonFromModal(entry.id)}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={entry.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'}
                                                        alt={entry.speciesName}
                                                        className="w-8 h-8 object-contain pixelated"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-semibold text-slate-700 truncate">{entry.pokemonName}</span>
                                                        <span className="text-xs text-slate-500">Lv.{entry.level}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-500 truncate mt-0.5">{entry.speciesName}</div>
                                                    {entry.formId && entry.formId !== 'normal' && (
                                                        <div className="mt-1">
                                                            <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border bg-blue-100 text-blue-700 border-blue-200">
                                                                {entry.formName || entry.formId}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>
                                    Hiển thị {pokemonPickerPageStart}-{pokemonPickerPageEnd} / {pokemonPickerTotal} Pokemon
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setPokemonPickerPage((prev) => Math.max(1, prev - 1))}
                                        disabled={normalizedPokemonPickerPage <= 1}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">
                                        Trang {normalizedPokemonPickerPage}/{pokemonPickerTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setPokemonPickerPage((prev) => Math.min(pokemonPickerTotalPages, prev + 1))}
                                        disabled={normalizedPokemonPickerPage >= pokemonPickerTotalPages}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Sau
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <PokemonTradeDetailModal
                open={Boolean(detailPokemon)}
                pokemon={detailPokemon}
                title={detailTitle}
                onClose={() => setDetailPokemon(null)}
            />
        </div>
    )
}
