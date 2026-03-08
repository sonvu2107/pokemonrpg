import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'
import { resolvePokemonSprite } from '../utils/pokemonFormUtils'
import { getRarityStyle } from '../utils/rarityStyles'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')

export default function EvolvePage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { showSuccess, showError } = useToast()

    const [loading, setLoading] = useState(true)
    const [evolving, setEvolving] = useState(false)
    const [pokemon, setPokemon] = useState(null)
    const [evolved, setEvolved] = useState(false)
    const [evolutionMessage, setEvolutionMessage] = useState('')
    const [evolutionResult, setEvolutionResult] = useState(null)

    const [zoneLoading, setZoneLoading] = useState(false)
    const [zoneError, setZoneError] = useState('')
    const [zonePokemon, setZonePokemon] = useState([])
    const [zoneSearchInput, setZoneSearchInput] = useState('')
    const [zoneSearch, setZoneSearch] = useState('')
    const [zonePage, setZonePage] = useState(1)
    const [zonePagination, setZonePagination] = useState({
        page: 1,
        limit: 24,
        total: 0,
        pages: 1,
        hasNextPage: false,
        hasPrevPage: false,
    })

    const zonePageItems = useMemo(() => {
        const totalPages = Math.max(1, Number(zonePagination?.pages || 1))
        const page = Math.max(1, Number(zonePagination?.page || 1))
        if (totalPages <= 1) return [1]

        const result = [1]
        const start = Math.max(2, page - 2)
        const end = Math.min(totalPages - 1, page + 2)

        if (start > 2) result.push('...')
        for (let idx = start; idx <= end; idx += 1) result.push(idx)
        if (end < totalPages - 1) result.push('...')
        result.push(totalPages)

        return result
    }, [zonePagination])

    const loadEvolutionZone = async (targetPage = 1) => {
        try {
            setZoneLoading(true)
            setZoneError('')

            const data = await gameApi.getEvolutionZone({
                page: targetPage,
                limit: 24,
                search: zoneSearch,
            })

            const nextPokemon = Array.isArray(data?.pokemon) ? data.pokemon : []
            const nextPagination = data?.pagination || {
                page: 1,
                limit: 24,
                total: nextPokemon.length,
                pages: 1,
                hasNextPage: false,
                hasPrevPage: false,
            }

            const maxPage = Math.max(1, Number(nextPagination.pages || 1))
            if (targetPage > maxPage) {
                setZonePage(maxPage)
                return
            }

            setZonePokemon(nextPokemon)
            setZonePagination(nextPagination)
        } catch (error) {
            setZonePokemon([])
            setZoneError(error.message || 'Không thể tải khu vực tiến hóa')
        } finally {
            setZoneLoading(false)
        }
    }

    const loadPokemonDetail = async () => {
        try {
            setLoading(true)
            const data = await gameApi.getPokemonDetail(id)
            setPokemon(data)
        } catch (error) {
            setPokemon(null)
            showError(error.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!id) {
            setLoading(false)
            loadEvolutionZone(zonePage)
            return
        }

        setEvolved(false)
        setEvolutionMessage('')
        setEvolutionResult(null)
        loadPokemonDetail()
    }, [id, zonePage, zoneSearch])

    const handleZoneSearch = () => {
        const normalized = zoneSearchInput.trim()
        setZonePage(1)
        setZoneSearch(normalized)
    }

    const handleEvolve = async () => {
        if (!id) return

        setEvolving(true)
        try {
            const currentSnapshot = pokemon
            const snapshotTargetPokemon = currentSnapshot?.evolution?.targetPokemon || null
            const snapshotFromName = currentSnapshot?.nickname || currentSnapshot?.pokemonId?.name || 'Pokemon'
            const snapshotFromSprite = resolvePokemonSprite({
                species: currentSnapshot?.pokemonId || {},
                formId: currentSnapshot?.formId,
                isShiny: Boolean(currentSnapshot?.isShiny),
            })
            const snapshotToName = snapshotTargetPokemon?.name || 'Pokemon'
            const snapshotToSprite = resolvePokemonSprite({
                species: snapshotTargetPokemon || {},
                formId: currentSnapshot?.formId,
                isShiny: false,
                fallback: snapshotTargetPokemon?.sprites?.normal || '',
            })

            const res = await gameApi.evolvePokemon(id)
            setEvolutionMessage(res.message || '')
            setEvolutionResult({
                fromName: res?.evolution?.from || snapshotFromName,
                toName: res?.evolution?.to || snapshotToName,
                fromSprite: snapshotFromSprite,
                toSprite: snapshotToSprite,
            })
            await loadPokemonDetail()
            setEvolved(true)

            if (res?.evolution?.from && res?.evolution?.to) {
                showSuccess(`${res.evolution.from} đã tiến hóa thành ${res.evolution.to}!`)
            } else {
                showSuccess(res.message || 'Tiến hóa thành công!')
            }
        } catch (error) {
            showError(error.message)
        } finally {
            setEvolving(false)
        }
    }

    if (!id) {
        return (
            <div className="max-w-5xl mx-auto pb-12">
                <div className="text-center mb-6">
                    <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">Khu Vực Tiến Hóa Pokémon</h1>
                    <p className="text-sm text-slate-600 font-semibold">
                        Chỉ hiển thị các Pokémon đã đủ cấp để tiến hóa.
                    </p>
                </div>

                <div className="border-2 border-slate-800 bg-white shadow-lg">
                    <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-center font-bold px-4 py-2 border-b border-blue-700">
                        Kho Pokémon Đủ Điều Kiện Tiến Hóa
                    </div>

                    <div className="p-3 border-b border-slate-300 bg-slate-50 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                        <input
                            value={zoneSearchInput}
                            onChange={(event) => setZoneSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleZoneSearch()
                                }
                            }}
                            placeholder="Tìm theo tên hoặc số Pokédex..."
                            className="border border-slate-400 px-3 py-2 text-sm"
                        />
                        <button
                            type="button"
                            onClick={handleZoneSearch}
                            className="px-5 py-2 border border-blue-700 bg-white font-bold text-blue-800 hover:bg-blue-50"
                        >
                            Tìm
                        </button>
                    </div>

                    <div className="px-4 py-3 bg-slate-50 text-sm font-semibold text-slate-700 border-b border-slate-300">
                        Tổng số Pokémon có thể tiến hóa: <span className="text-blue-700">{formatNumber(zonePagination.total)}</span>
                    </div>

                    <div className="p-4 bg-white min-h-[260px]">
                        {zoneLoading ? (
                            <div className="text-center py-10 font-bold text-slate-500">Đang tải khu vực tiến hóa...</div>
                        ) : zoneError ? (
                            <div className="text-center py-10 font-bold text-red-600">{zoneError}</div>
                        ) : zonePokemon.length === 0 ? (
                            <div className="text-center py-10 space-y-3">
                                <p className="text-slate-500 italic">Bạn chưa có Pokémon nào đủ điều kiện tiến hóa.</p>
                                <button
                                    type="button"
                                    onClick={() => navigate('/box')}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded"
                                >
                                    Đi đến Kho Pokémon
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {zonePokemon.map((entry) => {
                                    const species = entry?.pokemonId || {}
                                    const rarityStyle = getRarityStyle(species?.rarity || 'd')
                                    const displayName = String(entry?.nickname || species?.name || 'Pokemon').trim()
                                    const baseName = String(species?.name || '').trim()
                                    const targetPokemon = entry?.evolution?.targetPokemon || null
                                    const targetName = String(targetPokemon?.name || 'Chưa có').trim()
                                    const parsedEvolutionLevel = Number.parseInt(entry?.evolution?.evolutionLevel, 10)
                                    const evolutionLevel = Number.isFinite(parsedEvolutionLevel) && parsedEvolutionLevel >= 1
                                        ? parsedEvolutionLevel
                                        : null
                                    const requiredItem = entry?.evolution?.requiredItem || null
                                    const sprite = resolvePokemonSprite({
                                        species,
                                        formId: entry?.formId,
                                        isShiny: Boolean(entry?.isShiny),
                                        fallback: species?.sprites?.normal || '',
                                    })
                                    const targetSprite = resolvePokemonSprite({
                                        species: targetPokemon || {},
                                        formId: entry?.formId,
                                        isShiny: false,
                                        fallback: targetPokemon?.sprites?.normal || '',
                                    })

                                    return (
                                        <div
                                            key={entry?._id}
                                            className={`border rounded p-3 shadow-sm transition-transform hover:-translate-y-0.5 ${rarityStyle.border} ${rarityStyle.bg}`}
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-900 truncate">{displayName}</div>
                                                    {baseName && baseName !== displayName && (
                                                        <div className="text-xs text-slate-500 truncate">{baseName}</div>
                                                    )}
                                                </div>
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${rarityStyle.badge}`}>
                                                    {rarityStyle.label}
                                                </span>
                                            </div>

                                            <div className="text-xs text-slate-600 mb-2">
                                                #{String(species?.pokedexNumber || 0).padStart(3, '0')} • Lv.{Math.max(1, Number(entry?.level || 1))}
                                            </div>

                                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 py-1">
                                                <img src={sprite} alt={displayName} className="w-16 h-16 mx-auto object-contain pixelated" />
                                                <span className="text-blue-400 font-black text-lg">→</span>
                                                {targetSprite ? (
                                                    <img src={targetSprite} alt={targetName} className="w-16 h-16 mx-auto object-contain pixelated" />
                                                ) : (
                                                    <div className="w-16 h-16 mx-auto rounded-full bg-slate-100 border border-slate-200" />
                                                )}
                                            </div>

                                            <div className="text-xs text-center text-slate-700 mb-3">
                                                Tiến hóa thành <span className="font-bold">{targetName}</span>
                                                {evolutionLevel ? <> (mốc cấp <span className="font-bold">{evolutionLevel}</span>)</> : ''}
                                            </div>

                                            {requiredItem && (
                                                <div className="text-[11px] text-center text-indigo-700 font-semibold mb-3">
                                                    Cần {formatNumber(requiredItem.requiredQuantity)} {requiredItem.name}
                                                    {requiredItem.rarityFrom && requiredItem.rarityTo
                                                        ? ` • Rank ${String(requiredItem.rarityFrom).toUpperCase()}-${String(requiredItem.rarityTo).toUpperCase()}`
                                                        : ''}
                                                </div>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => navigate(`/pokemon/${entry?._id}/evolve`)}
                                                className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wide"
                                            >
                                                Vào khu tiến hóa
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {zonePagination.pages > 1 && (
                        <div className="border-t border-slate-300 bg-slate-50 px-3 py-2 text-center font-bold text-blue-800">
                            <button
                                type="button"
                                onClick={() => setZonePage((prev) => Math.max(1, prev - 1))}
                                disabled={!zonePagination.hasPrevPage}
                                className={`mx-0.5 px-2 py-1 border rounded ${zonePagination.hasPrevPage ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                Trước
                            </button>
                            {zonePageItems.map((item, index) => (
                                item === '...'
                                    ? <span key={`zone-ellipsis-${index}`} className="mx-1 text-slate-500">...</span>
                                    : (
                                        <button
                                            type="button"
                                            key={`zone-page-${item}`}
                                            onClick={() => setZonePage(Number(item))}
                                            className={`mx-0.5 px-2 py-1 border rounded ${Number(item) === zonePagination.page ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 hover:bg-blue-50'}`}
                                        >
                                            {item}
                                        </button>
                                    )
                            ))}
                            <button
                                type="button"
                                onClick={() => setZonePage((prev) => prev + 1)}
                                disabled={!zonePagination.hasNextPage}
                                className={`mx-0.5 px-2 py-1 border rounded ${zonePagination.hasNextPage ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                Sau
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (loading) {
        return <div className="p-10 text-center">Đang tải...</div>
    }

    if (!pokemon) {
        return <div className="p-10 text-center">Không tìm thấy Pokémon</div>
    }

    const currentName = pokemon.nickname || pokemon.pokemonId?.name || 'Pokemon'
    const currentSprite = resolvePokemonSprite({
        species: pokemon.pokemonId || {},
        formId: pokemon.formId,
        isShiny: Boolean(pokemon.isShiny),
    })
    const targetPokemon = pokemon.evolution?.targetPokemon || null
    const targetName = targetPokemon?.name || 'Chưa có'
    const targetSprite = resolvePokemonSprite({
        species: targetPokemon || {},
        formId: pokemon.formId,
        isShiny: false,
        fallback: targetPokemon?.sprites?.normal || '',
    })
    const evolutionLevel = pokemon.evolution?.evolutionLevel || null
    const requiredItem = pokemon.evolution?.requiredItem || null
    const canEvolve = Boolean(pokemon.evolution?.canEvolve)
    const displayFromName = evolved ? (evolutionResult?.fromName || currentName) : currentName
    const displayToName = evolved ? (evolutionResult?.toName || targetName) : targetName
    const displayFromSprite = evolved ? (evolutionResult?.fromSprite || currentSprite) : currentSprite
    const displayToSprite = evolved ? (evolutionResult?.toSprite || targetSprite) : targetSprite

    return (
        <div className="max-w-4xl mx-auto p-4 animate-fade-in">
            <div className="bg-white rounded-xl shadow-lg border border-blue-200 overflow-hidden relative">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-1">
                    <div className="bg-white/10 p-2 text-center text-white text-xs font-bold tracking-wider uppercase">
                        Khu vực tiến hóa
                    </div>
                </div>

                <div className="p-8 text-center space-y-8">
                    <h1 className="text-4xl font-black text-blue-900 drop-shadow-sm uppercase tracking-tight">
                        Tiến Hóa Pokémon
                    </h1>

                    <div className="flex items-center justify-center gap-8 md:gap-16 py-8">
                        <div className="flex flex-col items-center gap-3 group">
                            <div className="relative">
                                <div className="w-24 h-24 md:w-32 md:h-32 bg-slate-100 rounded-full flex items-center justify-center shadow-inner border-4 border-white ring-2 ring-slate-100">
                                    <img
                                        src={displayFromSprite}
                                        alt={displayFromName}
                                        className="w-20 h-20 md:w-24 md:h-24 pixelated object-contain"
                                    />
                                </div>
                            </div>
                            {!evolved && <span className="font-bold text-slate-600">{displayFromName}</span>}
                        </div>

                        {!evolved && (
                            <div className="flex flex-col items-center gap-1 text-blue-300">
                                <div className="flex gap-1 animate-pulse">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col items-center gap-3">
                            <div className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center border-4 border-white ring-2 shadow-inner transition-all duration-500 ${evolved ? 'bg-yellow-50 ring-yellow-400 scale-110' : 'bg-slate-100 ring-slate-100'}`}>
                                {displayToSprite ? (
                                    <img
                                        src={displayToSprite}
                                        alt={displayToName}
                                        className={`w-20 h-20 md:w-24 md:h-24 pixelated object-contain transition-all duration-500 ${evolved ? 'animate-bounce' : 'opacity-40 grayscale'}`}
                                    />
                                ) : (
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-slate-200 border border-slate-300" />
                                )}
                            </div>
                            {!evolved && <span className="font-bold text-slate-800">{displayToName}</span>}
                        </div>
                    </div>

                    {!evolved && canEvolve ? (
                        <div className="space-y-6">
                            <p className="text-green-700 font-medium text-lg bg-green-50 inline-block px-6 py-2 rounded-full border border-green-100">
                                <span className="font-bold">{currentName}</span> có thể tiến hóa thành <span className="font-bold">{targetName}</span>{evolutionLevel ? <> (mốc cấp <span className="font-bold">{evolutionLevel}</span>)</> : ''}.
                            </p>
                            {requiredItem && (
                                <p className="text-indigo-700 font-medium text-sm bg-indigo-50 inline-block px-4 py-2 rounded-full border border-indigo-100">
                                    Dùng <span className="font-bold">{formatNumber(requiredItem.requiredQuantity)} {requiredItem.name}</span>
                                    {' '}• Trong túi: <span className="font-bold">{formatNumber(requiredItem.inventoryQuantity)}</span>
                                    {requiredItem.rarityFrom && requiredItem.rarityTo
                                        ? <> {' '}• Áp dụng rank <span className="font-bold">{String(requiredItem.rarityFrom).toUpperCase()}-{String(requiredItem.rarityTo).toUpperCase()}</span></>
                                        : ''}
                                </p>
                            )}
                            <div>
                                <button
                                    onClick={handleEvolve}
                                    disabled={evolving}
                                    className={`px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider rounded-lg shadow-lg hover:shadow-xl transform active:scale-95 transition-all text-lg ${evolving ? 'opacity-75 cursor-wait' : ''}`}
                                >
                                    {evolving ? 'Đang tiến hóa...' : 'Tiến hóa'}
                                </button>
                            </div>
                        </div>
                    ) : !evolved ? (
                        <div className="space-y-3">
                            <p className="text-slate-700 font-medium text-lg bg-slate-50 inline-block px-6 py-2 rounded-full border border-slate-200">
                                {targetPokemon
                                    ? (() => {
                                        if (requiredItem && !requiredItem.hasEnough) {
                                            const missingQty = Math.max(0, Number(requiredItem.requiredQuantity || 0) - Number(requiredItem.inventoryQuantity || 0))
                                            if (missingQty <= 0) {
                                                return `${requiredItem.name} không phù hợp cho rank hiện tại của ${currentName}.`
                                            }
                                            return `${currentName} thiếu ${formatNumber(missingQty)} ${requiredItem.name} để tiến hóa.`
                                        }
                                        return `${currentName} chưa đủ điều kiện tiến hóa${evolutionLevel ? ` (cần cấp ${evolutionLevel})` : ''}.`
                                    })()
                                    : `${currentName} chưa có thiết lập tiến hóa.`}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-fade-in-up">
                            <p className="text-slate-800 font-medium text-xl">
                                <span className="font-bold">{displayFromName}</span> đã tiến hóa thành <span className="font-bold text-blue-600">{displayToName}</span>!
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-2">
                                <button
                                    onClick={() => navigate('/evolve')}
                                    className="px-6 py-2 border-2 border-blue-300 hover:border-blue-400 text-blue-700 font-bold rounded-lg transition-colors"
                                >
                                    Về khu tiến hóa
                                </button>
                                <button
                                    onClick={() => navigate('/box')}
                                    className="px-6 py-2 border-2 border-slate-300 hover:border-slate-400 text-slate-600 font-bold rounded-lg transition-colors"
                                >
                                    Về kho
                                </button>
                            </div>
                        </div>
                    )}

                    {!evolved && evolutionMessage && (
                        <p className="text-sm font-semibold text-slate-500">{evolutionMessage}</p>
                    )}
                </div>
            </div>
        </div>
    )
}
