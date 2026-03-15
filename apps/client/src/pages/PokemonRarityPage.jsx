import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { getRarityStyle } from '../utils/rarityStyles'
import Modal from '../components/Modal'
import PokemonSpeciesDetailModal from '../components/PokemonSpeciesDetailModal'
import { resolveImageSrc } from '../utils/imageUrl'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-b from-blue-400 to-blue-600 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

const RARITY_FILTERS = [
    { value: 'all', label: 'Tất cả' },
    { value: 'sss+', label: 'SSS+' },
    { value: 'sss', label: 'SSS' },
    { value: 'ss', label: 'SS' },
    { value: 's', label: 'S' },
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
    { value: 'd', label: 'D' },
]

const TYPE_FILTERS = [
    { value: 'all', label: 'Tất cả hệ' },
    { value: 'normal', label: 'Normal' },
    { value: 'fire', label: 'Fire' },
    { value: 'water', label: 'Water' },
    { value: 'grass', label: 'Grass' },
    { value: 'electric', label: 'Electric' },
    { value: 'ice', label: 'Ice' },
    { value: 'fighting', label: 'Fighting' },
    { value: 'poison', label: 'Poison' },
    { value: 'ground', label: 'Ground' },
    { value: 'flying', label: 'Flying' },
    { value: 'psychic', label: 'Psychic' },
    { value: 'bug', label: 'Bug' },
    { value: 'rock', label: 'Rock' },
    { value: 'ghost', label: 'Ghost' },
    { value: 'dragon', label: 'Dragon' },
    { value: 'dark', label: 'Dark' },
    { value: 'steel', label: 'Steel' },
    { value: 'fairy', label: 'Fairy' },
]

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')

const getPokedexSprite = (pokedexNumber) => {
    const numeric = Math.max(0, Number.parseInt(pokedexNumber, 10) || 0)
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${numeric}.png`
}

export default function PokemonRarityPage() {
    const [rankings, setRankings] = useState([])
    const [selectedSpecies, setSelectedSpecies] = useState(null)
    const [summary, setSummary] = useState({ totalPokemonInPlayerHands: 0, totalSpecies: 0 })
    const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, total: 0, limit: 25 })

    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [rarityFilter, setRarityFilter] = useState('all')
    const [typeFilter, setTypeFilter] = useState('all')
    const [currentPage, setCurrentPage] = useState(1)
    const [selectedPokemonId, setSelectedPokemonId] = useState('')

    const [detailPokemonId, setDetailPokemonId] = useState(null)
    const [detailFormId, setDetailFormId] = useState(null)
    const [showDetailModal, setShowDetailModal] = useState(false)

    const [options, setOptions] = useState([])
    const [optionSearchInput, setOptionSearchInput] = useState('')
    const [optionSearch, setOptionSearch] = useState('')
    const [optionPage, setOptionPage] = useState(1)
    const [optionPagination, setOptionPagination] = useState({
        currentPage: 1,
        totalPages: 1,
        total: 0,
        limit: 40,
        hasNextPage: false,
        hasPrevPage: false,
    })
    const [pickerOpen, setPickerOpen] = useState(false)

    const [loading, setLoading] = useState(true)
    const [loadingOptions, setLoadingOptions] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        if (typeof window === 'undefined') return
        const params = new URLSearchParams(window.location.search)
        const pokemonIdFromUrl = String(params.get('pokemonId') || '').trim()
        if (pokemonIdFromUrl) {
            setSelectedPokemonId(pokemonIdFromUrl)
        }
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => {
            setOptionSearch(optionSearchInput.trim())
        }, 250)
        return () => clearTimeout(timer)
    }, [optionSearchInput])

    useEffect(() => {
        setOptionPage(1)
    }, [optionSearch, rarityFilter, typeFilter])

    useEffect(() => {
        setCurrentPage(1)
    }, [search])

    useEffect(() => {
        setCurrentPage(1)
        setSelectedPokemonId('')
    }, [rarityFilter, typeFilter])

    useEffect(() => {
        loadOptions()
    }, [optionSearch, rarityFilter, typeFilter, optionPage])

    useEffect(() => {
        loadRarityStats(currentPage)
    }, [currentPage, search, rarityFilter, typeFilter, selectedPokemonId])

    const loadOptions = async () => {
        try {
            setLoadingOptions(true)
            const data = await gameApi.getPokemonRarityOptions({
                search: optionSearch,
                rarity: rarityFilter,
                type: typeFilter,
                page: optionPage,
                limit: 40,
            })
            const nextOptions = Array.isArray(data?.options) ? data.options : []
            const nextPagination = data?.pagination || {
                currentPage: 1,
                totalPages: 1,
                total: nextOptions.length,
                limit: 40,
                hasNextPage: false,
                hasPrevPage: false,
            }
            if (optionPage > Number(nextPagination.totalPages || 1)) {
                setOptionPage(Math.max(1, Number(nextPagination.totalPages || 1)))
                return
            }

            setOptions(nextOptions)
            setOptionPagination(nextPagination)
            if (!selectedPokemonId && nextOptions.length > 0) {
                setSelectedPokemonId(String(nextOptions[0]?._id || ''))
            }
        } catch {
            setOptions([])
            setOptionPagination({
                currentPage: 1,
                totalPages: 1,
                total: 0,
                limit: 40,
                hasNextPage: false,
                hasPrevPage: false,
            })
        } finally {
            setLoadingOptions(false)
        }
    }

    const loadRarityStats = async (page) => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getPokemonRarityStats({
                page,
                limit: 25,
                search,
                rarity: rarityFilter,
                type: typeFilter,
                pokemonId: selectedPokemonId,
            })

            setRankings(Array.isArray(data?.rankings) ? data.rankings : [])
            setSelectedSpecies(data?.selectedSpecies || null)
            setSummary(data?.summary || { totalPokemonInPlayerHands: 0, totalSpecies: 0 })
            setPagination(data?.pagination || { currentPage: 1, totalPages: 1, total: 0, limit: 25 })

            const serverSelectedId = String(data?.selectedSpecies?.pokemonId || '')
            if (serverSelectedId && serverSelectedId !== selectedPokemonId) {
                setSelectedPokemonId(serverSelectedId)
            }
        } catch (err) {
            setError(err.message || 'Không thể tải bảng độ hiếm Pokémon')
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = () => {
        setCurrentPage(1)
        setSearch(searchInput.trim())
    }

    const openPokemonDetail = (pokemonId, formId = null) => {
        setDetailPokemonId(pokemonId)
        setDetailFormId(formId)
        setShowDetailModal(true)
    }

    const pageItems = useMemo(() => {
        const totalPages = pagination?.totalPages || 1
        const page = pagination?.currentPage || 1
        if (totalPages <= 1) return [1]

        const result = [1]
        const start = Math.max(2, page - 2)
        const end = Math.min(totalPages - 1, page + 2)

        if (start > 2) result.push('...')
        for (let i = start; i <= end; i += 1) result.push(i)
        if (end < totalPages - 1) result.push('...')
        if (totalPages > 1) result.push(totalPages)

        return result
    }, [pagination])

    const optionPageItems = useMemo(() => {
        const totalPages = optionPagination?.totalPages || 1
        const page = optionPagination?.currentPage || 1
        if (totalPages <= 1) return [1]

        const result = [1]
        const start = Math.max(2, page - 2)
        const end = Math.min(totalPages - 1, page + 2)

        if (start > 2) result.push('...')
        for (let i = start; i <= end; i += 1) result.push(i)
        if (end < totalPages - 1) result.push('...')
        if (totalPages > 1) result.push(totalPages)

        return result
    }, [optionPagination])

    const selectedRarityStyle = getRarityStyle(selectedSpecies?.rarity || 'd')
    const selectedOption = useMemo(
        () => options.find((entry) => String(entry?._id || '') === String(selectedPokemonId || '')) || null,
        [options, selectedPokemonId]
    )
    const selectedPreview = useMemo(() => {
        if (selectedSpecies && String(selectedSpecies.pokemonId) === String(selectedPokemonId)) {
            const defaultForm = (Array.isArray(selectedSpecies.forms) ? selectedSpecies.forms : []).find(f => f.isDefault) || selectedSpecies.forms?.[0]
            return {
                _id: selectedSpecies.pokemonId,
                name: selectedSpecies.name,
                pokedexNumber: selectedSpecies.pokedexNumber,
                rarity: selectedSpecies.rarity,
                sprite: defaultForm?.sprite
            }
        }
        return selectedOption || null
    }, [selectedSpecies, selectedOption, selectedPokemonId])

    return (
        <div className="max-w-5xl mx-auto pb-12">
            <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">Bảng Độ Hiếm Pokémon</h1>
                <div className="flex items-center justify-center gap-2 text-sm font-bold flex-wrap">
                    <Link to="/rankings/overall" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 whitespace-nowrap">Chung</Link>
                    <Link to="/rankings/pokemon" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 whitespace-nowrap">Pokémon</Link>
                    <Link to="/rankings/rarity" className="px-3 py-1 rounded bg-blue-600 text-white whitespace-nowrap">Độ Hiếm</Link>
                    <Link to="/rankings/daily" className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 whitespace-nowrap">Hàng Ngày</Link>
                </div>
            </div>

            <div className="border-2 border-slate-800 bg-white shadow-lg mb-5">
                <SectionHeader title="Thống kê số lượng" />
                <div className="px-4 py-3 border-b border-slate-300 text-center text-slate-700 font-semibold">
                    Thống kê số lượng Pokémon theo loài, độ hiếm và mức giá trị đề xuất.
                </div>

                <div className="p-4 border-b border-slate-300 bg-slate-50 space-y-3">
                    <div className="text-center font-bold text-blue-900">Chọn một Pokémon</div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-center">
                        <div className="border border-slate-300 bg-white p-3 flex items-center gap-3 min-w-0">
                            {selectedPreview ? (
                                <>
                                    <img
                                        src={selectedPreview.sprite || getPokedexSprite(selectedPreview.pokedexNumber)}
                                        alt={selectedPreview.name}
                                        className="w-12 h-12 object-contain pixelated shrink-0"
                                        onError={(e) => {
                                            e.target.onerror = null
                                            e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                        }}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-slate-800 truncate" title={selectedPreview.name}>{selectedPreview.name}</div>
                                        <div className="text-xs text-slate-500 truncate" title={`#${String(selectedPreview.pokedexNumber || 0).padStart(3, '0')} [${String(selectedPreview.rarity || 'd').toUpperCase()}]`}>
                                            #{String(selectedPreview.pokedexNumber || 0).padStart(3, '0')}
                                            {' '}[{String(selectedPreview.rarity || 'd').toUpperCase()}]
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="text-sm text-slate-500">Chưa chọn Pokémon</div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            className="px-4 py-2 border border-blue-700 bg-white font-bold text-blue-800 hover:bg-blue-50"
                        >
                            Chọn Pokémon
                        </button>
                    </div>
                </div>

                {selectedSpecies && (
                    <div className="border-b border-slate-300">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-white border-b border-slate-200">
                            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-center">
                                <div className="text-xs font-semibold text-slate-500 uppercase">Độ hiếm</div>
                                <div className="mt-1">
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${selectedRarityStyle.badge}`}>
                                        {selectedSpecies.rarityLabel}
                                    </span>
                                </div>
                            </div>
                            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-center">
                                <div className="text-xs font-semibold text-slate-500 uppercase">Trong tay người chơi</div>
                                <div className="mt-1 text-xl font-extrabold text-blue-800">{formatNumber(selectedSpecies.totalOwnedByPlayers)}</div>
                            </div>
                            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-center">
                                <div className="text-xs font-semibold text-slate-500 uppercase">Bạn đang có</div>
                                <div className="mt-1 text-xl font-extrabold text-emerald-700">{formatNumber(selectedSpecies.totalOwnedByMe)}</div>
                            </div>
                            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-center">
                                <div className="text-xs font-semibold text-slate-500 uppercase">Giá trị</div>
                                <div className="mt-1 text-xl font-extrabold text-rose-700">{selectedSpecies.valueScore}/100</div>
                                <div className="text-xs font-semibold text-rose-600">{selectedSpecies.valueTier}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 border-t border-l border-slate-300">
                            {(Array.isArray(selectedSpecies.forms) ? selectedSpecies.forms : []).map((form) => (
                                <button
                                    type="button"
                                    onClick={() => openPokemonDetail(selectedSpecies.pokemonId, form.formId)}
                                    key={`${selectedSpecies.pokemonId}-${form.formId}`} className="border-r border-b border-slate-300 bg-white p-3 text-center flex flex-col min-w-0 transition-colors hover:bg-slate-50 relative group"
                                >
                                    <div className="font-bold text-slate-900 text-base sm:text-lg leading-tight break-words group-hover:text-blue-700 transition-colors">{form.formName}</div>
                                    <div className="text-xs text-slate-500 mb-2 break-words">
                                        {selectedSpecies.name}
                                        {form.isDefault ? ' (Mặc định)' : ''}
                                    </div>
                                    <img
                                        src={form.sprite}
                                        alt={`${selectedSpecies.name} ${form.formName}`}
                                        className="w-20 h-20 mx-auto object-contain pixelated"
                                        loading="lazy"
                                        decoding="async"
                                        onError={(event) => {
                                            event.target.onerror = null
                                            event.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                        }}
                                    />
                                    <div className="mt-3 space-y-1">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Toàn server</div>
                                        <div className="text-xl font-extrabold text-blue-800">{formatNumber(form.totalOwnedByPlayers)}</div>
                                        <div className="text-xs font-semibold text-slate-500">
                                            Bạn có: <span className="text-emerald-700">{formatNumber(form.totalOwnedByMe)}</span>
                                        </div>
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 top-0 hidden group-hover:flex items-center justify-center bg-blue-900/10 pointer-events-none">
                                        <div className="bg-white/90 px-2 py-1 rounded text-[10px] font-bold text-blue-800 border border-blue-200 shadow-sm">Xem chi tiết</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="p-4 bg-slate-50 text-sm font-semibold text-slate-700 flex flex-wrap gap-x-5 gap-y-1">
                    <span>Tổng loài (lọc hiện tại): {formatNumber(summary.totalSpecies)}</span>
                    <span>Tổng cá thể toàn server: {formatNumber(summary.totalPokemonInPlayerHands)}</span>
                </div>
            </div>

            <div className="border-2 border-slate-800 bg-white shadow-lg">
                <SectionHeader title="Bảng Thống Kê Các Loài Pokémon" />

                <div className="p-3 border-b border-slate-300 bg-slate-50 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                    <input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') handleSearch()
                        }}
                        placeholder="Tìm theo tên hoặc số Pokédex..."
                        className="border border-slate-400 px-3 py-2 text-sm max-w-none sm:max-w-[200px] md:max-w-xs shrink-0"
                    />
                    <div className="flex flex-1 gap-2">
                        <select
                            value={typeFilter}
                            onChange={(event) => setTypeFilter(event.target.value)}
                            className="flex-1 border border-slate-400 px-3 py-2 text-sm bg-white min-w-0"
                        >
                            {TYPE_FILTERS.map((entry) => (
                                <option key={entry.value} value={entry.value}>{entry.label}</option>
                            ))}
                        </select>
                        <select
                            value={rarityFilter}
                            onChange={(event) => setRarityFilter(event.target.value)}
                            className="flex-1 border border-slate-400 px-3 py-2 text-sm bg-white min-w-0"
                        >
                            {RARITY_FILTERS.map((entry) => (
                                <option key={entry.value} value={entry.value}>{entry.label}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={handleSearch}
                        className="px-5 py-2 border border-blue-700 bg-white font-bold text-blue-800 hover:bg-blue-50 sm:ml-auto shrink-0"
                    >
                        Tìm
                    </button>
                </div>

                <div className="md:hidden">
                    {!loading && rankings.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 italic">
                            Không có dữ liệu phù hợp
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200">
                            {rankings.map((entry) => {
                                const style = getRarityStyle(entry.rarity)
                                const isSelected = String(entry.pokemonId || '') === String(selectedPokemonId || '')
                                return (
                                    <button
                                        type="button"
                                        key={entry.pokemonId}
                                        onClick={() => setSelectedPokemonId(String(entry.pokemonId || ''))}
                                        className="w-full text-left p-3 hover:bg-blue-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <img src={resolveImageSrc(entry.sprite)} alt={entry.name} className="w-12 h-12 object-contain pixelated shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className={`font-bold truncate group-hover:text-blue-700 transition-colors ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                                                        #{String(entry.pokedexNumber || 0).padStart(3, '0')} {entry.name}
                                                    </div>
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${style.badge}`}>
                                                        {entry.rarityLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                            <div className="rounded border border-slate-200 bg-blue-50 p-2 text-center">
                                                <div className="text-slate-500">Toàn server</div>
                                                <div className="font-extrabold text-blue-800">{formatNumber(entry.totalOwnedByPlayers)}</div>
                                            </div>
                                            <div className="rounded border border-slate-200 bg-emerald-50 p-2 text-center">
                                                <div className="text-slate-500">Bạn có</div>
                                                <div className="font-extrabold text-emerald-700">{formatNumber(entry.totalOwnedByMe)}</div>
                                            </div>
                                            <div className="rounded border border-slate-200 bg-rose-50 p-2 text-center">
                                                <div className="text-slate-500">Giá trị</div>
                                                <div className="font-extrabold text-rose-700 leading-tight">{entry.valueScore}/100</div>
                                                <div className="font-semibold text-[10px] text-rose-600 truncate">{entry.valueTier}</div>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm table-fixed">
                        <thead>
                            <tr className="bg-blue-100 border-b-2 border-slate-800 text-slate-800 font-bold">
                                <th className="px-3 py-2 text-left w-16 border-r border-slate-400 align-middle">ID</th>
                                <th className="px-3 py-2 text-left w-[35%] border-r border-slate-400 align-middle">Pokémon</th>
                                <th className="px-3 py-2 text-center w-24 border-r border-slate-400 align-middle">Hiếm</th>
                                <th className="px-3 py-2 text-right w-40 border-r border-slate-400 align-middle">Toàn server</th>
                                <th className="px-3 py-2 text-right w-32 border-r border-slate-400 align-middle">Bạn có</th>
                                <th className="px-3 py-2 text-right w-36 align-middle">Giá trị</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && rankings.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                                        Không có dữ liệu phù hợp
                                    </td>
                                </tr>
                            ) : (
                                rankings.map((entry) => {
                                    const style = getRarityStyle(entry.rarity)
                                    const isSelected = String(entry.pokemonId || '') === String(selectedPokemonId || '')
                                    return (
                                        <tr key={entry.pokemonId} className="border-b border-slate-200 hover:bg-blue-50 transition-colors">
                                            <td className="px-3 py-2 font-bold text-slate-700 border-r border-slate-200 align-middle">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</td>
                                            <td className="px-3 py-2 border-r border-slate-200 align-middle">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        openPokemonDetail(entry.pokemonId || '')
                                                    }}
                                                    title="Xem chi tiết loài"
                                                    className="w-full text-left min-w-0 group"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <img src={resolveImageSrc(entry.sprite)} alt={entry.name} className="w-12 h-12 object-contain pixelated shrink-0" />
                                                        <div className="min-w-0">
                                                            <div className={`font-bold truncate group-hover:text-blue-700 transition-colors ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                                                                {entry.name}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            </td>
                                            <td className="px-3 py-2 text-center border-r border-slate-200 align-middle">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${style.badge}`}>
                                                    {entry.rarityLabel}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-bold text-blue-800 border-r border-slate-200 align-middle tabular-nums">{formatNumber(entry.totalOwnedByPlayers)}</td>
                                            <td className="px-3 py-2 text-right font-bold text-emerald-700 border-r border-slate-200 align-middle tabular-nums">{formatNumber(entry.totalOwnedByMe)}</td>
                                            <td className="px-3 py-2 text-right align-middle">
                                                <div className="font-extrabold text-rose-700">{entry.valueScore}/100</div>
                                                <div className="text-xs font-semibold text-rose-500 truncate">{entry.valueTier}</div>
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>

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

                {pagination.totalPages > 1 && (
                    <div className="border-t border-slate-300 bg-slate-50 px-3 py-2 text-center font-bold text-blue-800">
                        {pageItems.map((item, idx) => (
                            item === '...'
                                ? <span key={`ellipsis-${idx}`} className="mx-1 text-slate-500">...</span>
                                : (
                                    <button
                                        key={`page-${item}`}
                                        onClick={() => setCurrentPage(Number(item))}
                                        className={`mx-0.5 ${Number(item) === currentPage ? 'text-red-600' : 'hover:underline'}`}
                                    >
                                        [{item}]
                                    </button>
                                )
                        ))}
                    </div>
                )}
            </div>

            <Modal
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                title="Chọn Pokémon"
                maxWidth="lg"
            >
                <div className="space-y-3">
                    <input
                        value={optionSearchInput}
                        onChange={(event) => setOptionSearchInput(event.target.value)}
                        placeholder="Tìm theo tên hoặc số Pokédex..."
                        className="w-full border border-slate-400 px-3 py-2 text-sm"
                        autoFocus
                    />

                    <div className="text-xs font-semibold text-slate-500">
                        {loadingOptions
                            ? 'Đang tải danh sách...'
                            : `Hiển thị ${formatNumber(options.length)} / ${formatNumber(optionPagination.total)} Pokémon`}
                    </div>

                    <div className="max-h-[56vh] overflow-y-auto border border-slate-200 rounded bg-slate-50 divide-y divide-slate-200">
                        {!loadingOptions && options.length === 0 && (
                            <div className="p-6 text-center text-sm italic text-slate-500">Không có Pokémon phù hợp</div>
                        )}

                        {options.map((entry) => {
                            const optionRarityStyle = getRarityStyle(entry.rarity)
                            const isActive = String(entry?._id || '') === String(selectedPokemonId || '')
                            return (
                                <button
                                    key={entry._id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedPokemonId(String(entry._id || ''))
                                        setPickerOpen(false)
                                    }}
                                    className={`w-full p-3 text-left hover:bg-blue-50 transition-colors ${isActive ? 'bg-blue-100/70' : 'bg-white'}`}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <img
                                            src={getPokedexSprite(entry.pokedexNumber)}
                                            alt={entry.name}
                                            className="w-10 h-10 object-contain pixelated shrink-0"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-slate-800 truncate">{entry.name}</div>
                                            <div className="text-xs text-slate-500">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</div>
                                        </div>
                                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold shrink-0 ${optionRarityStyle.badge}`}>
                                            {String(entry.rarity || 'd').toUpperCase()}
                                        </span>
                                        {isActive && (
                                            <span className="text-xs font-bold text-blue-700 shrink-0">Đã chọn</span>
                                        )}
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    {optionPagination.totalPages > 1 && (
                        <div className="flex flex-wrap items-center justify-center gap-1 text-xs font-bold text-blue-800">
                            <button
                                type="button"
                                onClick={() => setOptionPage((prev) => Math.max(1, prev - 1))}
                                disabled={!optionPagination.hasPrevPage}
                                className={`px-2 py-1 border border-slate-300 rounded ${optionPagination.hasPrevPage ? 'hover:bg-blue-50' : 'text-slate-400 cursor-not-allowed'}`}
                            >
                                Trước
                            </button>

                            {optionPageItems.map((item, idx) => (
                                item === '...'
                                    ? <span key={`option-ellipsis-${idx}`} className="px-1 text-slate-500">...</span>
                                    : (
                                        <button
                                            key={`option-page-${item}`}
                                            type="button"
                                            onClick={() => setOptionPage(Number(item))}
                                            className={`px-2 py-1 border rounded ${Number(item) === optionPagination.currentPage ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 hover:bg-blue-50'}`}
                                        >
                                            {item}
                                        </button>
                                    )
                            ))}

                            <button
                                type="button"
                                onClick={() => setOptionPage((prev) => prev + 1)}
                                disabled={!optionPagination.hasNextPage}
                                className={`px-2 py-1 border border-slate-300 rounded ${optionPagination.hasNextPage ? 'hover:bg-blue-50' : 'text-slate-400 cursor-not-allowed'}`}
                            >
                                Sau
                            </button>
                        </div>
                    )}
                </div>
            </Modal>

            <PokemonSpeciesDetailModal
                open={showDetailModal}
                onClose={() => setShowDetailModal(false)}
                speciesId={detailPokemonId}
                formId={detailFormId}
                title="Thông tin loài Pokémon"
            />
        </div>
    )
}
