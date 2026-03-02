import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { gameApi } from '../services/gameApi'
import { getRarityStyle } from '../utils/rarityStyles'

// Helper component for section headers
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonDisplay = (entry) => {
    const species = entry?.pokemonId || {}
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const requestedFormId = normalizeFormId(entry?.formId || species?.defaultFormId || 'normal')
    const resolvedForm = forms.find((candidate) => normalizeFormId(candidate?.formId) === requestedFormId) || null
    const baseNormal = species?.imageUrl || species?.sprites?.normal || species?.sprites?.icon || ''
    const formNormal = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || baseNormal
    const shinySprite = resolvedForm?.sprites?.shiny || species?.sprites?.shiny || formNormal

    return {
        species,
        formId: requestedFormId,
        formName: String(resolvedForm?.formName || resolvedForm?.formId || requestedFormId).trim(),
        sprite: entry?.isShiny ? shinySprite : formNormal,
    }
}

export default function PokemonBoxPage() {
    const [pokemon, setPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [counts, setCounts] = useState({ total: 0, box: 0, party: 0 })
    const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 })

    // Filters state
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState('id')
    const [page, setPage] = useState(1)

    // Debounce search
    const [debouncedSearch, setDebouncedSearch] = useState('')

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 500)
        return () => clearTimeout(timer)
    }, [search])

    useEffect(() => {
        setPage(1)
    }, [filter, debouncedSearch, sort])

    useEffect(() => {
        loadBox()
    }, [page, filter, debouncedSearch, sort])

    const loadBox = async () => {
        try {
            setLoading(true)
            const data = await api.getBox({
                page,
                limit: 28, // 7 columns x 4 rows
                search: debouncedSearch,
                filter,
                sort
            })
            setPokemon(data.pokemon)
            setPagination(data.pagination)
            setCounts(data.counts || { total: 0, box: 0, party: 0 })
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const forms = [
        'Normal', 'Shiny', 'Dark', 'Silver', 'Golden', 'Crystal',
        'Ruby', 'Sapphire', 'Emerald', 'Shadow', 'Light',
        'Legacy', 'Pearl', 'Astral', 'Rainbow'
    ]

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

    const getEvolutionRule = (species = {}, currentFormId = 'normal') => {
        const normalizedFormId = String(currentFormId || '').trim()
        const forms = Array.isArray(species?.forms) ? species.forms : []
        const matchedForm = forms.find((entry) => String(entry?.formId || '').trim() === normalizedFormId) || null
        const evolution = matchedForm?.evolution?.evolvesTo
            ? matchedForm.evolution
            : (species?.evolution || {})

        const rawEvolvesTo = evolution?.evolvesTo
        const evolvesTo = rawEvolvesTo
            ? (typeof rawEvolvesTo === 'string'
                ? rawEvolvesTo
                : String(rawEvolvesTo?._id || rawEvolvesTo).trim())
            : ''
        const minLevel = Number.parseInt(evolution?.minLevel, 10)
        return {
            evolvesTo,
            minLevel: Number.isFinite(minLevel) && minLevel > 0 ? minLevel : null,
        }
    }

    const canEvolve = (pokemonEntry) => {
        const species = pokemonEntry?.pokemonId || {}
        const { evolvesTo, minLevel } = getEvolutionRule(species, pokemonEntry?.formId)
        if (!evolvesTo || minLevel === null) return false
        return Number(pokemonEntry?.level || 0) >= minLevel
    }

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12">

            {/* Top Banner / Info from screenshot */}
            {/* Top Banner / Info from screenshot */}
            <div className="text-center mb-6">
                <div className="text-slate-600 text-xs font-bold flex justify-center gap-4 mb-2">
                    <span className="flex items-center gap-1">🪙 0 Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌑 0 Điểm Nguyệt Các</span>
                </div>
                <h1 className="text-3xl font-bold text-center text-blue-900 drop-shadow-sm">Kho Pokemon Của Bạn</h1>
            </div>

            <div className="space-y-4">

                {/* 1. Pokemon Owned Section */}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Pokemon Đang Sở Hữu" />
                    <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                        Pokemon Đang Sở Hữu
                    </div>
                    <div className="p-4 text-center text-sm font-bold text-slate-700">
                        Bạn hiện đang có <span className="text-blue-600">{counts.total}</span> Pokémon (trong kho/đội hình).
                    </div>
                </div>

                {/* 2. Filter/Sort Section */}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Lọc / Sắp Xếp" />
                    <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                        Lọc / Sắp Xếp
                    </div>
                    <div className="p-4 text-center">
                        {/* All / Alphabet */}
                        <div className="mb-2 text-xs font-bold leading-relaxed">
                            <button
                                onClick={() => setFilter('all')}
                                className={`uppercase mr-2 ${filter === 'all' ? 'text-red-600' : 'text-blue-700 hover:underline'}`}
                            >
                                Tất Cả
                            </button>
                            {/* Alphabet - assuming filtering by name starting with letter? API support needed for robust letter filter, but for now just showing UI */}
                            {alphabet.map(letter => (
                                <span key={letter} className="mx-0.5 text-blue-700 cursor-pointer hover:underline text-[10px]">
                                    {letter}
                                </span>
                            ))}
                        </div>

                        {/* Forms */}
                        <div className="mb-4 text-[10px] font-bold text-blue-800 leading-relaxed max-w-2xl mx-auto">
                            {forms.map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f.toLowerCase())}
                                    className={`mx-1 uppercase ${filter === f.toLowerCase() ? 'text-red-600' : 'text-blue-700 hover:underline'}`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>

                        {/* Sort/Search Inputs */}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-xs font-bold text-slate-700">
                            <div className="flex gap-4">
                                <label className="flex items-center gap-1 cursor-pointer hover:text-blue-600">
                                    <input
                                        type="radio"
                                        name="sort"
                                        checked={sort === 'level'}
                                        onChange={() => setSort('level')}
                                    />
                                    Theo Cấp
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer hover:text-blue-600">
                                    <input
                                        type="radio"
                                        name="sort"
                                        checked={sort === 'id'}
                                        onChange={() => setSort('id')}
                                    />
                                    Theo ID
                                </label>
                                <label className="flex items-center gap-1 cursor-pointer hover:text-blue-600">
                                    <input
                                        type="radio"
                                        name="sort"
                                        checked={sort === 'ig'}
                                        onChange={() => setSort('ig')}
                                    />
                                    Theo Ngày Bắt
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Tìm kiếm (vd: Pikachu)"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="border border-slate-300 rounded px-2 py-1 w-48 focus:outline-none focus:border-blue-400 text-slate-700"
                                />
                                <button className="bg-slate-100 border border-slate-300 px-3 py-1 rounded hover:bg-slate-200 text-slate-700 shadow-sm">
                                    Tìm
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Pagination Top */}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Trang" />
                    <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                        Trang
                    </div>
                    <div className="p-2 text-center flex justify-center gap-1">
                        {Array.from({ length: Math.min(pagination.pages, 10) }, (_, i) => i + 1).map(p => (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                className={`w-8 h-8 flex items-center justify-center text-xs font-bold rounded border ${page === p
                                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 4. Your Box Grid */}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-blue-50">
                    <SectionHeader title="Kho Pokemon" />

                    {/* Headers */}
                    <div className="flex text-xs font-bold text-blue-800 border-b border-blue-300 bg-white">
                        <div className="flex-1 p-1 text-center">Thông Tin Pokemon</div>
                    </div>

                    {/* Content */}
                    <div className="p-4 bg-white min-h-[300px]">
                        {loading ? (
                            <div className="text-center py-12 text-slate-400 font-bold animate-pulse">Đang tải Pokemon...</div>
                        ) : pokemon.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 italic">
                                Không tìm thấy Pokemon nào.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                                {pokemon.map((p) => {
                                    const display = resolvePokemonDisplay(p)
                                    const species = display.species
                                    const sprite = display.sprite
                                    const name = p.nickname || species.name || 'Unknown'
                                    const rarity = species.rarity || 'd'
                                    const style = getRarityStyle(rarity)
                                    const isEvolvable = canEvolve(p)
                                    const showFormLabel = Boolean(display.formName) && display.formId !== 'normal'

                                    return (
                                        <div key={p._id} className={`group relative flex flex-col items-center p-2 rounded cursor-pointer transition-all hover:scale-105 ${style.border} ${style.bg} ${style.shadow} ${style.frameClass}`}>
                                            {isEvolvable && (
                                                <Link
                                                    to={`/pokemon/${p._id}/evolve`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="absolute top-0 left-0 z-30"
                                                    title="Pokemon có thể tiến hóa"
                                                >
                                                    <span className="bg-emerald-600 text-white text-[8px] px-1.5 py-0.5 rounded-br font-bold uppercase shadow-sm">UP</span>
                                                </Link>
                                            )}
                                            <Link to={`/pokemon/${p._id}`} className="flex flex-col items-center w-full relative z-10">
                                                {/* Rarity Badge */}
                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-bl ${style.badge} z-20 shadow-sm opacity-90`}>
                                                    {style.label}
                                                </span>

                                                <div className="relative w-16 h-16 flex items-center justify-center">
                                                    <img
                                                        src={sprite || '/placeholder.png'}
                                                        alt={name}
                                                        className="max-w-full max-h-full pixelated rendering-pixelated drop-shadow-sm"
                                                        onError={(e) => {
                                                            e.target.onerror = null
                                                            e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                                        }}
                                                    />
                                                </div>
                                                <div className={`mt-1 text-[10px] font-bold truncate w-full text-center ${style.text}`}>
                                                    {name}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <span className="text-[9px] bg-white/80 px-1 rounded text-slate-600 font-bold border border-slate-200">
                                                        Lv.{p.level}
                                                    </span>
                                                    {p.isShiny && (
                                                        <span className="text-[8px] text-amber-500 font-bold bg-white/80 px-1 rounded border border-amber-200" title="Shiny">SHINY</span>
                                                    )}
                                                    {showFormLabel && (
                                                        <span className="text-[8px] text-sky-700 font-bold bg-white/80 px-1 rounded border border-sky-200" title={`Form: ${display.formName}`}>
                                                            {display.formName}
                                                        </span>
                                                    )}
                                                </div>
                                            </Link>

                                            {/* Add to Party Button */}
                                            {p.location !== 'party' && (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation()
                                                        try {
                                                            await gameApi.addToParty(p._id)
                                                            alert('Đã thêm vào đội hình!')
                                                            loadBox()
                                                        } catch (err) {
                                                            alert(err.message)
                                                        }
                                                    }}
                                                    className="mt-2 px-2 py-1 text-[10px] font-bold uppercase rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400 transition-colors"
                                                >
                                                    + Vào Đội
                                                </button>
                                            )}
                                            {p.location === 'party' && (
                                                <div className={`absolute left-0 ${isEvolvable ? 'top-5' : 'top-0'}`}>
                                                    <span className="bg-blue-600 text-white text-[8px] px-1 py-0.5 rounded-br font-bold uppercase shadow-sm">Party</span>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
