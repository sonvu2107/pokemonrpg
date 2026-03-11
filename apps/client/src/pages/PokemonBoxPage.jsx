import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { gameApi } from '../services/gameApi'
import { valleyApi } from '../services/valleyApi'
import { getRarityStyle } from '../utils/rarityStyles'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import SmartImage from '../components/SmartImage'
import VipCaughtStar from '../components/VipCaughtStar'
import { useProfileQuery } from '../hooks/queries/gameQueries'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const NEW_POKEMON_TAG_TTL_MS = 5 * 60 * 1000
const NEW_POKEMON_BADGE_REFRESH_MS = 15 * 1000
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const getPokemonCaughtAtMs = (entry) => {
    const source = entry?.obtainedAt || entry?.createdAt
    const parsed = source ? new Date(source).getTime() : NaN
    return Number.isFinite(parsed) ? parsed : 0
}

const isRecentlyCaughtPokemon = (entry, nowMs = Date.now()) => {
    const caughtAtMs = getPokemonCaughtAtMs(entry)
    if (!caughtAtMs) return false
    return nowMs - caughtAtMs <= NEW_POKEMON_TAG_TTL_MS
}

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
    const { data: profilePayload } = useProfileQuery()
    const [pokemon, setPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [counts, setCounts] = useState({ total: 0, box: 0, party: 0 })
    const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 })
    const toast = useToast()
    const { user, setUser } = useAuth()
    const [liveUser, setLiveUser] = useState(user)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState('id')
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [page, setPage] = useState(1)
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [releaseConfirmId, setReleaseConfirmId] = useState(null)
    const [releasingId, setReleasingId] = useState(null)
    const [escrowedPokemon, setEscrowedPokemon] = useState([])
    const wallet = {
        platinumCoins: Number(liveUser?.playerState?.platinumCoins ?? 0),
        moonPoints: Number(liveUser?.playerState?.moonPoints || 0),
    }

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 500)
        return () => clearTimeout(timer)
    }, [search])

    useEffect(() => {
        setPage(1)
    }, [filter, debouncedSearch, sort])

    useEffect(() => {
        const timer = setInterval(() => {
            setNowMs(Date.now())
        }, NEW_POKEMON_BADGE_REFRESH_MS)

        return () => clearInterval(timer)
    }, [])

    useEffect(() => {
        if (!profilePayload) return
        setLiveUser(profilePayload)
        if (typeof setUser === 'function' && profilePayload?.user) {
            setUser(profilePayload.user)
        }
    }, [profilePayload, setUser])

    useEffect(() => {
        loadBox()
    }, [page, filter, debouncedSearch, sort])

    useEffect(() => {
        loadEscrowedPokemon()
    }, [])

    const loadBox = async () => {
        try {
            setLoading(true)
            const data = await api.getBox({
                page,
                limit: 28,
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

    const loadEscrowedPokemon = async () => {
        try {
            const data = await gameApi.getEscrowedAuctionPokemon()
            setEscrowedPokemon(Array.isArray(data?.pokemon) ? data.pokemon : [])
        } catch (err) {
            console.error(err)
            setEscrowedPokemon([])
        }
    }

    const handleReleaseToValley = async (pokemonId) => {
        setReleasingId(pokemonId)
        try {
            const data = await valleyApi.release(pokemonId)
            toast.showSuccess(data.message || 'Đã thả vào Thung Lũng!')
            setReleaseConfirmId(null)
            loadBox()
        } catch (err) {
            toast.showError(err.message || 'Thả Pokémon thất bại')
        } finally {
            setReleasingId(null)
        }
    }

    const forms = [
        'Normal', 'Shiny', 'Dark', 'Silver', 'Golden', 'Crystal',
        'Ruby', 'Sapphire', 'Emerald', 'Shadow', 'Light',
        'Legacy', 'Pearl', 'Astral', 'Rainbow'
    ]

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

    const getEvolutionRule = (species = {}, currentFormId = 'normal') => {
        const baseEvolution = species?.evolution || {}
        const baseMinLevel = Number.parseInt(baseEvolution?.minLevel, 10)
        if (baseEvolution?.evolvesTo && Number.isFinite(baseMinLevel) && baseMinLevel > 0) {
            const rawEvolvesTo = baseEvolution.evolvesTo
            return {
                evolvesTo: typeof rawEvolvesTo === 'string'
                    ? rawEvolvesTo
                    : String(rawEvolvesTo?._id || rawEvolvesTo).trim(),
                minLevel: baseMinLevel,
            }
        }

        const normalizedFormId = String(currentFormId || '').trim().toLowerCase()
        const forms = Array.isArray(species?.forms) ? species.forms : []
        const matchedForm = forms.find((entry) => String(entry?.formId || '').trim().toLowerCase() === normalizedFormId) || null
        const evolution = matchedForm?.evolution || {}

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
            <div className="text-center mb-6">
                <div className="text-slate-600 text-xs font-bold flex justify-center gap-4 mb-2">
                    <span className="flex items-center gap-1">🪙 {Number(wallet.platinumCoins || 0).toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌑 {Number(wallet.moonPoints || 0).toLocaleString('vi-VN')} Điểm Nguyệt Các</span>
                </div>
                <h1 className="text-3xl font-bold text-center text-blue-900 drop-shadow-sm">Kho Pokémon Của Bạn</h1>
            </div>

            <div className="space-y-4">
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Pokémon Đang Sở Hữu" />
                    <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                        Pokémon Đang Sở Hữu
                    </div>
                    <div className="p-4 text-center text-sm font-bold text-slate-700">
                        Bạn hiện đang có <span className="text-blue-600">{counts.total}</span> Pokémon (trong kho/đội hình).
                    </div>
                </div>
                {escrowedPokemon.length > 0 && (
                    <div className="border border-amber-300 rounded-t-lg overflow-hidden shadow-sm bg-white">
                        <SectionHeader title="Đang Giữ Cho Đấu Giá" />
                        <div className="p-4 bg-amber-50/60 space-y-3">
                            <div className="text-sm text-amber-900 font-semibold">
                                Có <span className="font-bold">{escrowedPokemon.length}</span> Pokémon đang được giữ cho các phiên đấu giá nháp hoặc đang diễn ra.
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {escrowedPokemon.map((entry) => (
                                    <Link key={entry._id} to="/auctions/manage" className="rounded-xl border border-amber-200 bg-white p-3 hover:bg-amber-50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 overflow-hidden shrink-0">
                                                {entry?.sprite ? <img src={entry.sprite} alt={entry.name} className="h-12 w-12 object-contain pixelated rendering-pixelated" /> : <span className="text-slate-300">?</span>}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1">
                                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 border border-amber-200">Đang giữ cho đấu giá</span>
                                                    {entry.isShiny && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">Shiny</span>}
                                                </div>
                                                <div className="mt-1 truncate font-bold text-slate-800">{entry.nickname ? `${entry.nickname} - ${entry.name}` : entry.name}</div>
                                                <div className="text-xs text-slate-500">Lv.{Number(entry.level || 1).toLocaleString('vi-VN')} - {entry.formId || 'normal'}</div>
                                                <div className="text-xs font-semibold text-amber-700">Mở Đấu giá của tôi để chỉnh sửa hoặc hủy phiên.</div>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Lọc / Sắp Xếp" />
                    <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                        Lọc / Sắp Xếp
                    </div>
                    <div className="p-4 text-center">
                        <div className="mb-2 text-xs font-bold leading-relaxed">
                            <button
                                onClick={() => setFilter('all')}
                                className={`uppercase mr-2 ${filter === 'all' ? 'text-red-600' : 'text-blue-700 hover:underline'}`}
                            >
                                Tất Cả
                            </button>
                            {alphabet.map(letter => (
                                <span key={letter} className="mx-0.5 text-blue-700 cursor-pointer hover:underline text-[10px]">
                                    {letter}
                                </span>
                            ))}
                        </div>
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


                {/* 4. Your Box Grid */}
                <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-blue-50">
                    <SectionHeader title="Kho Pokémon" />

                    {/* Headers */}
                    <div className="flex text-xs font-bold text-blue-800 border-b border-blue-300 bg-white">
                        <div className="flex-1 p-1 text-center">Thông Tin Pokémon</div>
                    </div>

                    {/* Content */}
                    <div className="p-4 bg-white min-h-[300px]">
                        {loading ? (
                            <div className="text-center py-12 text-slate-400 font-bold animate-pulse">Đang tải Pokémon...</div>
                        ) : pokemon.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 italic">
                                Không tìm thấy Pokémon nào.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                                {pokemon.map((p) => {
                                    const display = resolvePokemonDisplay(p)
                                    const species = display.species
                                    const sprite = display.sprite
                                    const name = p.nickname || species.name || 'Unknown'
                                    const rarity = species.rarity || 'd'
                                    const style = getRarityStyle(rarity)
                                    const isEvolvable = canEvolve(p)
                                    const isNewlyCaught = isRecentlyCaughtPokemon(p, nowMs)
                                    const showFormLabel = Boolean(display.formName) && display.formId !== 'normal'

                                    return (
                                        <div key={p._id} className={`group relative flex flex-col items-center p-2 rounded cursor-pointer transition-all hover:scale-105 ${style.border} ${style.bg} ${style.shadow} ${style.frameClass}`}>
                                            {isNewlyCaught && (
                                                <span className="pointer-events-none absolute top-0 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-white shadow-sm">
                                                    NEW
                                                </span>
                                            )}
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
                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-bl ${style.badge} z-20 shadow-sm opacity-90`}>
                                                    {style.label}
                                                </span>

                                                <div className="relative w-24 h-24 flex items-center justify-center mb-1">
                                                    <SmartImage
                                                        src={sprite || '/placeholder.png'}
                                                        alt={name}
                                                        width={80}
                                                        height={80}
                                                        className="w-20 h-20 object-contain pixelated rendering-pixelated drop-shadow-sm transition-transform group-hover:scale-110"
                                                        fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                                                    />
                                                </div>
                                                <div className={`mt-1 flex w-full items-center justify-center gap-1 text-[10px] font-bold ${style.text}`}>
                                                    <span className="truncate">{name}</span>
                                                    <VipCaughtStar level={p.obtainedVipMapLevel} className="text-[10px] shrink-0" />
                                                </div>
                                                <div className="flex flex-wrap items-center justify-center gap-1 mt-1 text-center w-full">
                                                    <span className="text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-slate-700 font-bold border border-slate-200">
                                                        Lv.{p.level}
                                                    </span>
                                                    {p.isShiny && (
                                                        <span className="text-[9px] text-amber-500 font-bold bg-amber-50/80 px-1.5 py-0.5 rounded border border-amber-200 shadow-sm" title="Shiny">SHINY</span>
                                                    )}
                                                    {showFormLabel && (
                                                        <span className="text-[9px] text-sky-700 font-bold bg-sky-50/80 px-1.5 py-0.5 rounded border border-sky-200 shadow-sm" title={`Form: ${display.formName}`}>
                                                            {display.formName}
                                                        </span>
                                                    )}
                                                </div>
                                            </Link>
                                            {p.location !== 'party' && (
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation()
                                                        try {
                                                            await gameApi.addToParty(p._id)
                                                            toast.showSuccess('Đã thêm vào đội hình!')
                                                            loadBox()
                                                        } catch (err) {
                                                            toast.showError(err.message || 'Thêm vào đội hình thất bại')
                                                        }
                                                    }}
                                                    className="mt-2.5 w-full text-center px-2 py-1.5 text-[11px] font-bold uppercase rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400 transition-colors shadow-sm"
                                                >
                                                    Vào Đội
                                                </button>
                                            )}
                                            {p.location !== 'party' && releaseConfirmId !== p._id && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setReleaseConfirmId(p._id) }}
                                                    className="mt-1 w-full text-center px-2 py-1 text-[10px] font-bold uppercase rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 transition-colors shadow-sm"
                                                >
                                                    Thả vào Thung Lũng
                                                </button>
                                            )}
                                            {p.location !== 'party' && releaseConfirmId === p._id && (
                                                <div className="mt-1 flex gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => handleReleaseToValley(p._id)}
                                                        disabled={releasingId === p._id}
                                                        className="flex-1 text-center px-1 py-1 text-[9px] font-bold uppercase rounded border border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition-colors shadow-sm"
                                                    >
                                                        {releasingId === p._id ? '...' : 'Xác nhận'}
                                                    </button>
                                                    <button
                                                        onClick={() => setReleaseConfirmId(null)}
                                                        className="flex-1 text-center px-1 py-1 text-[9px] font-bold uppercase rounded border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors shadow-sm"
                                                    >
                                                        Hủy
                                                    </button>
                                                </div>
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

                    {/* Pagination Bottom */}
                    {pagination.pages > 1 && (
                        <div className="bg-slate-50 border-t border-blue-200 p-3 text-center flex justify-center flex-wrap gap-1.5 opacity-90">
                            {Array.from({ length: Math.min(pagination.pages, 10) }, (_, i) => i + 1).map(p => (
                                <button
                                    key={p}
                                    onClick={() => {
                                        setPage(p)
                                        window.scrollTo({ top: 0, behavior: 'smooth' })
                                    }}
                                    className={`w-9 h-9 flex items-center justify-center text-xs font-bold rounded border shadow-sm transition-colors ${page === p
                                        ? 'bg-blue-600 border-blue-700 text-white'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-400'
                                        }`}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
