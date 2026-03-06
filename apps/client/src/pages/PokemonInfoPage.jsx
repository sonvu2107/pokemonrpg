import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { useAuth } from '../context/AuthContext'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const toOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const resolvePokemonCombatPower = (pokemonLike, statsLike = {}) => {
    const directPower = Number(pokemonLike?.combatPower ?? pokemonLike?.power)
    if (Number.isFinite(directPower) && directPower > 0) {
        return Math.floor(directPower)
    }

    const level = Math.max(1, Number(pokemonLike?.level || 1))
    const hp = Math.max(1, Number((statsLike?.maxHp ?? statsLike?.hp) || 1))
    const atk = Math.max(1, Number(statsLike?.atk || 1))
    const def = Math.max(1, Number(statsLike?.def || 1))
    const spatk = Math.max(1, Number(statsLike?.spatk || 1))
    const spdef = Math.max(1, Number(statsLike?.spdef || statsLike?.spldef || 1))
    const spd = Math.max(1, Number(statsLike?.spd || 1))

    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (level * 2)
    const shinyBonus = pokemonLike?.isShiny ? 1.03 : 1
    return Math.max(1, Math.floor(rawPower * shinyBonus))
}

const normalizeMoveKey = (value = '') => String(value || '').trim().toLowerCase()

const InfoRow = ({ label, value, valueClass = '' }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs">
        <div className="w-1/3 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className={`w-2/3 p-2 font-bold text-slate-700 flex items-center ${valueClass}`}>
            {value}
        </div>
    </div>
)

const StatRow = ({ label, value, label2, value2 }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs">
        {/* Col 1 */}
        <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
            {value}
        </div>

        {/* Col 2 */}
        {label2 && (
            <>
                <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                    {label2}:
                </div>
                <div className="w-1/3 p-2 font-bold text-slate-700 flex items-center justify-center">
                    {value2}
                </div>
            </>
        )}
    </div>
)

export default function PokemonInfoPage() {
    const { id } = useParams()
    const { user } = useAuth()
    const [pokemon, setPokemon] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [featureNotice, setFeatureNotice] = useState('')
    const [skillModalOpen, setSkillModalOpen] = useState(false)
    const [skillInventory, setSkillInventory] = useState([])
    const [skillLoading, setSkillLoading] = useState(false)
    const [skillError, setSkillError] = useState('')
    const [selectedSkillId, setSelectedSkillId] = useState('')
    const [replaceMoveIndex, setReplaceMoveIndex] = useState(-1)
    const [teachingSkill, setTeachingSkill] = useState(false)
    const [removingSkillName, setRemovingSkillName] = useState('')

    useEffect(() => {
        loadPokemon()
    }, [id])

    const loadPokemon = async () => {
        try {
            setLoading(true)
            setError(null)
            setFeatureNotice('')
            const data = await gameApi.getPokemonDetail(id)
            setPokemon(data)
        } catch (err) {
            console.error(err)
            setError('Không tìm thấy thông tin Pokemon hoặc có lỗi xảy ra.')
        } finally {
            setLoading(false)
        }
    }

    const loadSkillInventory = async () => {
        try {
            setSkillLoading(true)
            setSkillError('')
            const data = await gameApi.getPokemonSkills(id)
            const skills = Array.isArray(data?.skills) ? data.skills : []
            setSkillInventory(skills)
            if (skills.length > 0) {
                const firstLearnable = skills.find((entry) => entry.canLearn)
                setSelectedSkillId(firstLearnable ? String(firstLearnable.moveId) : String(skills[0].moveId))
            } else {
                setSelectedSkillId('')
            }
        } catch (err) {
            setSkillError(err.message || 'Không thể tải kho kỹ năng')
            setSkillInventory([])
            setSelectedSkillId('')
        } finally {
            setSkillLoading(false)
        }
    }

    const openSkillModal = async () => {
        setSkillModalOpen(true)
        setReplaceMoveIndex(-1)
        await loadSkillInventory()
    }

    const handleTeachSkill = async () => {
        const selectedSkill = skillInventory.find((entry) => String(entry.moveId) === String(selectedSkillId))
        if (!selectedSkill) {
            setFeatureNotice('Vui lòng chọn một kỹ năng để học.')
            return
        }
        if (!selectedSkill.canLearn) {
            setFeatureNotice(selectedSkill.reason || 'Pokemon này đã biết kỹ năng đã chọn.')
            return
        }

        const currentMoves = Array.isArray(pokemon?.moves)
            ? pokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean)
            : []

        const payload = {
            moveId: selectedSkill.moveId,
        }

        if (currentMoves.length >= 4) {
            if (replaceMoveIndex < 0 || replaceMoveIndex >= currentMoves.length) {
                setFeatureNotice('Pokemon đã đủ 4 kỹ năng. Hãy chọn kỹ năng cần thay thế.')
                return
            }
            payload.replaceMoveIndex = replaceMoveIndex
        }

        try {
            setTeachingSkill(true)
            const data = await gameApi.teachPokemonSkill(id, payload)
            setPokemon((prev) => {
                if (!prev) return prev

                const nextMoves = Array.isArray(data?.pokemon?.moves) ? data.pokemon.moves : prev.moves
                const nextMovePpState = Array.isArray(data?.pokemon?.movePpState) ? data.pokemon.movePpState : prev.movePpState
                const moveDetailsMap = new Map(
                    (Array.isArray(prev.moveDetails) ? prev.moveDetails : [])
                        .map((entry) => {
                            const name = String(entry?.name || '').trim()
                            const key = normalizeMoveKey(name)
                            if (!key) return null
                            return [key, {
                                name,
                                type: String(entry?.type || '').trim().toLowerCase(),
                                category: String(entry?.category || '').trim().toLowerCase(),
                                power: toOptionalNumber(entry?.power),
                                accuracy: toOptionalNumber(entry?.accuracy),
                            }]
                        })
                        .filter(Boolean)
                )

                const replacedMoveName = String(data?.replacedMove || '').trim()
                if (replacedMoveName) {
                    moveDetailsMap.delete(normalizeMoveKey(replacedMoveName))
                }

                const taughtMove = data?.taughtMove || null
                const taughtMoveName = String(taughtMove?.name || '').trim()
                if (taughtMoveName) {
                    moveDetailsMap.set(normalizeMoveKey(taughtMoveName), {
                        name: taughtMoveName,
                        type: String(taughtMove?.type || '').trim().toLowerCase(),
                        category: String(taughtMove?.category || '').trim().toLowerCase(),
                        power: toOptionalNumber(taughtMove?.power),
                        accuracy: toOptionalNumber(taughtMove?.accuracy),
                    })
                }

                const nextMoveDetails = (Array.isArray(nextMoves) ? nextMoves : [])
                    .map((moveNameRaw) => {
                        const moveName = String(moveNameRaw || '').trim()
                        if (!moveName) return null
                        const existing = moveDetailsMap.get(normalizeMoveKey(moveName))
                        if (existing) {
                            return {
                                ...existing,
                                name: moveName,
                            }
                        }
                        return {
                            name: moveName,
                            type: '',
                            category: '',
                            power: null,
                            accuracy: null,
                        }
                    })
                    .filter(Boolean)

                return {
                    ...prev,
                    moves: nextMoves,
                    movePpState: nextMovePpState,
                    moveDetails: nextMoveDetails,
                }
            })
            setFeatureNotice(data?.message || 'Pokemon đã học kỹ năng mới.')
            setReplaceMoveIndex(-1)
            await loadSkillInventory()
        } catch (err) {
            setFeatureNotice(err.message || 'Dạy kỹ năng thất bại.')
        } finally {
            setTeachingSkill(false)
        }
    }

    const handleRemoveSkill = async (moveName) => {
        const safeMoveName = String(moveName || '').trim()
        if (!safeMoveName) return
        const confirmed = window.confirm(`Gỡ kỹ năng ${safeMoveName} khỏi Pokemon này?`)
        if (!confirmed) return

        try {
            setRemovingSkillName(safeMoveName)
            const data = await gameApi.removePokemonSkill(id, { moveName: safeMoveName })
            setPokemon((prev) => {
                if (!prev) return prev

                const nextMoves = Array.isArray(data?.pokemon?.moves) ? data.pokemon.moves : prev.moves
                const nextMovePpState = Array.isArray(data?.pokemon?.movePpState) ? data.pokemon.movePpState : prev.movePpState
                const moveDetailsMap = new Map(
                    (Array.isArray(prev.moveDetails) ? prev.moveDetails : [])
                        .map((entry) => {
                            const name = String(entry?.name || '').trim()
                            const key = normalizeMoveKey(name)
                            if (!key) return null
                            return [key, {
                                name,
                                type: String(entry?.type || '').trim().toLowerCase(),
                                category: String(entry?.category || '').trim().toLowerCase(),
                                power: toOptionalNumber(entry?.power),
                                accuracy: toOptionalNumber(entry?.accuracy),
                            }]
                        })
                        .filter(Boolean)
                )

                const removedMoveName = String(data?.removedMove || safeMoveName).trim()
                if (removedMoveName) {
                    moveDetailsMap.delete(normalizeMoveKey(removedMoveName))
                }

                const nextMoveDetails = (Array.isArray(nextMoves) ? nextMoves : [])
                    .map((moveNameRaw) => {
                        const moveName = String(moveNameRaw || '').trim()
                        if (!moveName) return null
                        const existing = moveDetailsMap.get(normalizeMoveKey(moveName))
                        if (existing) {
                            return {
                                ...existing,
                                name: moveName,
                            }
                        }
                        return {
                            name: moveName,
                            type: '',
                            category: '',
                            power: null,
                            accuracy: null,
                        }
                    })
                    .filter(Boolean)

                return {
                    ...prev,
                    moves: nextMoves,
                    movePpState: nextMovePpState,
                    moveDetails: nextMoveDetails,
                }
            })
            setFeatureNotice(data?.message || `Đã gỡ kỹ năng ${safeMoveName}.`)
        } catch (err) {
            setFeatureNotice(err.message || 'Gỡ kỹ năng thất bại.')
        } finally {
            setRemovingSkillName('')
        }
    }

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-blue-800 font-bold">Đang tải thông tin Pokemon...</p>
            </div>
        )
    }

    if (error || !pokemon) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="text-red-500 font-bold text-lg mb-4">⚠️ {error || 'Pokemon không tồn tại'}</div>
                <Link to="/box" className="text-blue-600 hover:underline">Quay lại Kho Pokemon</Link>
            </div>
        )
    }

    const base = pokemon.pokemonId
    const currentMoves = Array.isArray(pokemon.moves)
        ? pokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
    const protectedMoveKeySet = new Set([
        'struggle',
    ])
    const isProtectedMoveName = (value = '') => protectedMoveKeySet.has(String(value || '').trim().toLowerCase())
    const hasProtectedMoveVisible = currentMoves.some((entry) => protectedMoveKeySet.has(String(entry || '').trim().toLowerCase()))
    const virtualDefaultMoveName = hasProtectedMoveVisible ? '' : 'Struggle'
    const movePpMap = new Map(
        (Array.isArray(pokemon.movePpState) ? pokemon.movePpState : [])
            .map((entry) => [
                String(entry?.moveName || '').trim().toLowerCase(),
                {
                    currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                    maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                },
            ])
    )
    const currentMoveDetails = (() => {
        const rawMoveDetails = Array.isArray(pokemon?.moveDetails) ? pokemon.moveDetails : []
        if (rawMoveDetails.length > 0) {
            return rawMoveDetails
                .map((entry) => {
                    const name = String(entry?.name || '').trim()
                    if (!name) return null
                    const key = name.toLowerCase()
                    const ppState = movePpMap.get(key)
                    return {
                        name,
                        type: String(entry?.type || '').trim().toLowerCase(),
                        category: String(entry?.category || '').trim().toLowerCase(),
                        power: toOptionalNumber(entry?.power),
                        accuracy: toOptionalNumber(entry?.accuracy),
                        currentPp: Number.isFinite(Number(ppState?.currentPp)) ? Number(ppState.currentPp) : Math.max(0, Number(entry?.currentPp || 0)),
                        maxPp: Number.isFinite(Number(ppState?.maxPp)) ? Number(ppState.maxPp) : Math.max(1, Number(entry?.maxPp || 1)),
                    }
                })
                .filter(Boolean)
        }

        return currentMoves.map((moveName) => {
            const key = String(moveName || '').trim().toLowerCase()
            const ppState = movePpMap.get(key)
            return {
                name: moveName,
                type: '',
                category: '',
                power: null,
                accuracy: null,
                currentPp: Number.isFinite(Number(ppState?.currentPp)) ? Number(ppState.currentPp) : 0,
                maxPp: Number.isFinite(Number(ppState?.maxPp)) ? Number(ppState.maxPp) : 1,
            }
        })
    })()
    const moveDetailsWithDefault = [...currentMoveDetails]
    if (virtualDefaultMoveName && !moveDetailsWithDefault.some((entry) => String(entry?.name || '').trim().toLowerCase() === 'struggle')) {
        moveDetailsWithDefault.unshift({
            name: virtualDefaultMoveName,
            type: 'normal',
            category: 'physical',
            power: 35,
            accuracy: 100,
            currentPp: 99,
            maxPp: 99,
        })
    }
    const orderedMoveDetails = [...moveDetailsWithDefault].sort((left, right) => {
        const leftProtected = isProtectedMoveName(left?.name)
        const rightProtected = isProtectedMoveName(right?.name)
        if (leftProtected && !rightProtected) return -1
        if (!leftProtected && rightProtected) return 1
        return 0
    })
    const orderedCurrentMoves = [...currentMoves].sort((left, right) => {
        const leftProtected = isProtectedMoveName(left)
        const rightProtected = isProtectedMoveName(right)
        if (leftProtected && !rightProtected) return -1
        if (!leftProtected && rightProtected) return 1
        return 0
    })
    const moveDisplaySlots = Array.from({ length: 4 }, (_, index) => orderedMoveDetails[index] || null)
    const viewerId = String(user?.id || user?._id || '').trim()
    const ownerId = String(pokemon?.userId?._id || '').trim()
    const isOwnerViewing = Boolean(viewerId && ownerId && viewerId === ownerId)
    const forms = Array.isArray(base?.forms) ? base.forms : []
    const resolvedFormId = normalizeFormId(pokemon.formId || base?.defaultFormId || 'normal')
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === resolvedFormId) || null
    const resolvedFormName = String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim()
    const formNormalSprite = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || base?.imageUrl || base?.sprites?.normal || base?.sprites?.icon || ''
    const formShinySprite = resolvedForm?.sprites?.shiny || base?.sprites?.shiny || formNormalSprite
    const stats = pokemon.stats
    const combatPower = resolvePokemonCombatPower(pokemon, stats)
    const sprite = pokemon.isShiny ? formShinySprite : formNormalSprite
    const previousPokemon = pokemon.evolution?.previousPokemon || null
    const previousSprite = previousPokemon?.sprites?.normal || ''
    const ownerAvatar = String(pokemon.userId?.avatar || '').trim() || DEFAULT_AVATAR
    const normalizeTrainerLabel = (value = '') => {
        const raw = String(value || '').trim()
        if (!raw) return ''
        const [prefix] = raw.split(':')
        const token = String(prefix || '').trim().toLowerCase()
        if (!token) return ''
        if (token === 'admin_grant' || token === 'system_grant') return 'Hệ thống cấp'
        return token
            .split(/[_\-\s]+/)
            .filter(Boolean)
            .map((entry) => entry.slice(0, 1).toUpperCase() + entry.slice(1))
            .join(' ')
    }
    const originalTrainerRaw = String(pokemon.originalTrainer || '').trim()
    const originalTrainerDisplay = normalizeTrainerLabel(originalTrainerRaw) || pokemon.userId?.username || 'Unknown'
    const obtainedLabel = originalTrainerRaw
        ? (String(originalTrainerRaw).toLowerCase().startsWith('admin_grant') ? 'Nhận từ hệ thống' : 'Trao đổi')
        : 'Bắt hoang dã'
    const nicknameDisplay = String(pokemon.nickname || '').trim()
    const hasCustomNickname = Boolean(
        nicknameDisplay && nicknameDisplay.toLowerCase() !== String(base.name || '').trim().toLowerCase()
    )
    const serverStats = pokemon.serverStats || {}
    const hasServerStats = Object.prototype.hasOwnProperty.call(serverStats, 'speciesTotal')
    const speciesTotal = Number(serverStats.speciesTotal) || 0
    const speciesRank = Number(serverStats.speciesRank)
    const totalPokemonInServer = Number(serverStats.totalPokemon) || 0
    const pokemonTypes = Array.isArray(base?.types)
        ? base.types.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : []

    const typeBadgeClass = {
        normal: 'bg-slate-200 text-slate-700 border-slate-300',
        fire: 'bg-red-100 text-red-700 border-red-200',
        water: 'bg-blue-100 text-blue-700 border-blue-200',
        electric: 'bg-yellow-100 text-yellow-700 border-yellow-200',
        grass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        ice: 'bg-cyan-100 text-cyan-700 border-cyan-200',
        fighting: 'bg-orange-100 text-orange-700 border-orange-200',
        poison: 'bg-purple-100 text-purple-700 border-purple-200',
        ground: 'bg-amber-100 text-amber-700 border-amber-200',
        flying: 'bg-sky-100 text-sky-700 border-sky-200',
        psychic: 'bg-pink-100 text-pink-700 border-pink-200',
        bug: 'bg-lime-100 text-lime-700 border-lime-200',
        rock: 'bg-stone-200 text-stone-700 border-stone-300',
        ghost: 'bg-violet-100 text-violet-700 border-violet-200',
        dragon: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        dark: 'bg-slate-300 text-slate-800 border-slate-400',
        steel: 'bg-zinc-200 text-zinc-700 border-zinc-300',
        fairy: 'bg-rose-100 text-rose-700 border-rose-200',
    }

    // Format rarity
    const rarityColor = {
        d: 'text-slate-500',
        c: 'text-green-600',
        b: 'text-blue-600',
        a: 'text-purple-600',
        s: 'text-orange-500',
        ss: 'text-red-600',
        sss: 'text-yellow-500'
    }[base.rarity] || 'text-slate-700'

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-6">

            {/* Main Card */}
            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">

                {/* Header */}
                <SectionHeader title={`Thông Tin Pokemon ${base.name} (ID #${base.pokedexNumber})`} />
                <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                    Tổng Quan
                </div>

                {/* Content Container */}
                <div className="p-4">

                    {/* Sprite & Basic Info */}
                    <div className="flex flex-col items-center mb-6">
                        <div className="relative w-32 h-32 flex items-center justify-center mb-2">
                            <img
                                src={sprite}
                                alt={base.name}
                                className="max-w-full max-h-full pixelated rendering-pixelated scale-125"
                                onError={(e) => {
                                    e.target.onerror = null
                                    e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                }}
                            />
                            {previousPokemon && previousSprite && (
                                <img
                                    src={previousSprite}
                                    alt={previousPokemon.name}
                                    className="absolute -right-16 top-1/2 -translate-y-1/2 w-14 h-14 object-contain pixelated opacity-90"
                                    onError={(e) => {
                                        e.target.onerror = null
                                        e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                    }}
                                />
                            )}
                            {/* Small icon maybe? */}
                        </div>

                        <h2 className="text-2xl font-bold text-blue-900 flex items-center gap-2">
                            {base.name}
                            {pokemon.isShiny && <span className="text-amber-500 text-sm">★</span>}
                        </h2>

                        {hasCustomNickname && (
                            <div className="mt-1 text-sm font-semibold text-slate-600">
                                {nicknameDisplay}
                            </div>
                        )}

                        {resolvedFormId !== 'normal' && (
                            <div className="mt-1">
                                <span className="text-[11px] uppercase bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200">
                                    {resolvedFormName}
                                </span>
                            </div>
                        )}

                        <div className="text-xs font-bold mt-1 flex gap-2">
                            <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-700">Lv. {pokemon.level}</span>
                            <span className="bg-rose-100 px-2 py-0.5 rounded text-rose-700">LC {combatPower.toLocaleString('vi-VN')}</span>
                            <span className={`bg-slate-100 px-2 py-0.5 rounded uppercase ${rarityColor}`}>
                                {base.rarity.toUpperCase()}
                            </span>
                        </div>

                        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                            {pokemonTypes.length > 0 ? pokemonTypes.map((type) => (
                                <span
                                    key={type}
                                    className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${typeBadgeClass[type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                                >
                                    {type}
                                </span>
                            )) : (
                                <span className="text-[10px] text-slate-400">Chưa có dữ liệu hệ</span>
                            )}
                        </div>

                        {/* Experience Bar? Optional */}
                    </div>

                    {/* Owner Section */}
                    <div className="border border-blue-300 rounded mb-4 overflow-hidden">
                        <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                            Chủ Sở Hữu
                        </div>
                        <div className="p-2 text-center text-sm font-bold text-slate-700 flex flex-col items-center">
                            <img
                                src={ownerAvatar}
                                alt={pokemon.userId?.username || 'Unknown'}
                                className="w-10 h-10 rounded-full border border-blue-200 object-cover bg-slate-100 mb-1"
                                onError={(e) => {
                                    e.currentTarget.onerror = null
                                    e.currentTarget.src = DEFAULT_AVATAR
                                }}
                            />
                            <span className="text-blue-600">{pokemon.userId?.username || 'Unknown'}</span>
                            <span className="text-[10px] text-slate-400">ID: {pokemon.userId?._id?.slice(-8).toUpperCase()}</span>
                        </div>
                    </div>

                    {/* Stats Table */}
                    <div className="border border-blue-300 rounded overflow-hidden mb-4">
                        <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                            Chỉ Số Pokemon
                        </div>

                        <StatRow
                            label="Max HP" value={stats.maxHp}
                            label2="Attack" value2={stats.atk}
                        />
                        <StatRow
                            label="Defense" value={stats.def}
                            label2="Sp. Atk" value2={stats.spatk}
                        />
                        <StatRow
                            label="Sp. Def" value={stats.spdef}
                            label2="Speed" value2={stats.spd}
                        />
                        <StatRow
                            label="Lực Chiến" value={combatPower.toLocaleString('vi-VN')}
                            label2="Cấp" value2={`Lv. ${pokemon.level}`}
                        />

                        {/* Extra info row */}
                        <div className="flex border-b border-blue-200 last:border-0 text-xs">
                            <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                                Vật phẩm:
                            </div>
                            <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
                                {pokemon.heldItem || 'Không'}
                            </div>
                            <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                                Thắng:
                            </div>
                            <div className="w-1/3 p-2 font-bold text-slate-700 flex items-center justify-center">
                                ? (0 thua)
                            </div>
                        </div>

                        {/* Moves */}
                        <div className="flex border-b border-blue-200 last:border-0 text-xs text-center">
                            {moveDisplaySlots.map((slot, index) => {
                                const isLast = index === moveDisplaySlots.length - 1
                                return (
                                    <div
                                        key={`move-slot-${index}`}
                                        className={`w-1/4 p-2 font-bold text-slate-700 ${isLast ? '' : 'border-r border-blue-200'}`}
                                    >
                                        {slot ? (
                                            <>
                                                <div>{slot.name}</div>
                                                <div className="text-[10px] text-slate-500 mt-0.5">{slot.currentPp}/{slot.maxPp} PP</div>
                                                <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                                                    {slot.type ? String(slot.type).toUpperCase() : '--'}
                                                    {' • '}
                                                    {slot.category ? String(slot.category).toUpperCase() : '--'}
                                                    {' • Pow '}
                                                    {toOptionalNumber(slot.power) ?? '--'}
                                                    {' • Acc '}
                                                    {toOptionalNumber(slot.accuracy) ?? '--'}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="italic text-slate-400">-</div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        {isOwnerViewing && (
                            <div className="p-2 bg-slate-50 border-t border-blue-200 text-center space-y-2">
                                <button
                                    type="button"
                                    onClick={openSkillModal}
                                    className="px-3 py-1.5 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                >
                                    Học Kỹ Năng Từ Kho
                                </button>
                                {currentMoves.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-1">
                                        {orderedCurrentMoves.map((moveName, index) => (
                                            (() => {
                                                const isProtectedMove = isProtectedMoveName(moveName)
                                                return (
                                            <button
                                                key={`${moveName}-${index}-remove`}
                                                type="button"
                                                onClick={() => handleRemoveSkill(moveName)}
                                                disabled={removingSkillName === moveName || isProtectedMove}
                                                className={`px-2 py-1 text-[11px] font-bold rounded border ${isProtectedMove
                                                    ? 'bg-slate-100 border-slate-300 text-slate-500 cursor-not-allowed'
                                                    : 'bg-white border-red-300 text-red-700 hover:bg-red-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
                                                title={isProtectedMove ? 'Kỹ năng mặc định không thể gỡ' : ''}
                                            >
                                                {isProtectedMove
                                                    ? `${moveName} (mặc định)`
                                                    : (removingSkillName === moveName ? 'Đang gỡ...' : `Gỡ ${moveName}`)}
                                            </button>
                                                )
                                            })()
                                        ))}
                                        {virtualDefaultMoveName && (
                                            <button
                                                type="button"
                                                disabled
                                                className="px-2 py-1 text-[11px] font-bold rounded border bg-slate-100 border-slate-300 text-slate-500 cursor-not-allowed"
                                                title="Kỹ năng mặc định luôn được giữ lại"
                                            >
                                                {virtualDefaultMoveName} (mặc định)
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Origin Section */}
                    <div className="border border-blue-300 rounded overflow-hidden">
                        <div className="flex text-xs text-center">
                            <div className="w-1/2 bg-blue-100/50 p-1 font-bold text-blue-800 border-r border-blue-200 border-b">
                                Người Bắt Đầu Tiên
                            </div>
                            <div className="w-1/2 bg-blue-100/50 p-1 font-bold text-blue-800 border-b border-blue-200">
                                Nơi Bắt
                            </div>
                        </div>
                        <div className="flex text-xs text-center text-slate-700 font-bold">
                            <div className="w-1/2 p-2 border-r border-blue-200">
                                {originalTrainerDisplay}
                            </div>
                            <div className="w-1/2 p-2">
                                {obtainedLabel}
                                {/* logic for place obtained is vague in schema, using fallback */}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Footer Stats similar to screenshot */}
            <div className="mt-4 border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white text-center">
                <div className="bg-blue-100/50 p-1 font-bold text-blue-800 text-xs border-b border-blue-200 uppercase">
                    Số Lượng Trong Server
                </div>
                <div className="p-2 text-xs font-bold text-blue-900">
                    {hasServerStats ? (
                        <>
                            <span className="text-slate-500">Loài này:</span> {speciesTotal.toLocaleString('vi-VN')}
                            {' '}
                            <span className="text-slate-400">[Hạng: {Number.isFinite(speciesRank) && speciesRank > 0 ? `#${speciesRank}` : 'Chưa có'}]</span>
                            {' '}
                            <span className="text-slate-500">| Tổng Pokémon:</span> {totalPokemonInServer.toLocaleString('vi-VN')}
                        </>
                    ) : (
                        <FeatureUnavailableNotice
                            compact
                            title="Số lượng trong server chưa cập nhật"
                            message="Dữ liệu thống kê máy chủ chưa sẵn sàng ở phiên bản này."
                        />
                    )}
                </div>
            </div>

            <div className="mt-4 text-center text-xs font-bold text-blue-800 space-x-4">
                <Link to="/rankings/pokemon" className="hover:underline hover:text-red-500">Bảng Xếp Hạng Pokémon</Link>
                <button
                    type="button"
                    onClick={() => setFeatureNotice('Tính năng Xếp Hạng Theo Loài chưa được cập nhật.')}
                    className="hover:underline hover:text-red-500"
                >
                    Xếp Hạng Theo Loài
                </button>
                <button
                    type="button"
                    onClick={() => setFeatureNotice('Tính năng Lịch Sử Pokémon chưa được cập nhật.')}
                    className="hover:underline hover:text-red-500"
                >
                    Lịch Sử Pokémon
                </button>
            </div>

            {featureNotice && (
                <FeatureUnavailableNotice
                    className="mt-2"
                    message={featureNotice}
                />
            )}

            {skillModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/70 p-4 flex items-center justify-center">
                    <div className="w-full max-w-2xl bg-white border border-blue-300 rounded-lg shadow-xl overflow-hidden">
                        <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2 flex items-center justify-between border-b border-blue-600">
                            <h3 className="text-sm sm:text-base font-bold text-white uppercase">Dạy Kỹ Năng Cho Pokemon</h3>
                            <button
                                type="button"
                                onClick={() => setSkillModalOpen(false)}
                                className="text-white text-xs font-bold px-2 py-1 rounded hover:bg-white/20"
                            >
                                Đóng
                            </button>
                        </div>

                        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                            {skillLoading ? (
                                <div className="text-center text-slate-500 py-8">Đang tải kho kỹ năng...</div>
                            ) : skillError ? (
                                <div className="text-center text-red-600 py-6 font-bold">{skillError}</div>
                            ) : skillInventory.length === 0 ? (
                                <div className="text-center text-slate-500 py-6">
                                    Bạn chưa có kỹ năng nào trong kho. Hãy mua ở Cửa Hàng Kỹ Năng.
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        {skillInventory.map((entry) => {
                                            const selected = String(selectedSkillId) === String(entry.moveId)
                                            return (
                                                <label
                                                    key={String(entry.moveId)}
                                                    className={`block border rounded p-3 cursor-pointer transition ${selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'} ${entry.canLearn ? '' : 'opacity-60'}`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <input
                                                            type="radio"
                                                            name="teachSkill"
                                                            checked={selected}
                                                            onChange={() => setSelectedSkillId(String(entry.moveId))}
                                                            className="mt-1 accent-blue-600"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-bold text-blue-900">{entry.move?.name || 'Unknown Skill'}</span>
                                                                <span className="text-xs font-bold text-slate-600">x{Number(entry.quantity || 0)}</span>
                                                            </div>
                                                            <div className="text-xs text-slate-600 mt-1">
                                                                {String(entry.move?.type || '').toUpperCase()} • {String(entry.move?.category || '').toUpperCase()} • Pow {entry.move?.power ?? '--'} • PP {entry.move?.pp ?? '--'}
                                                            </div>
                                                            {!entry.canLearn && (
                                                                <div className="text-[11px] text-amber-700 font-semibold mt-1">{entry.reason || 'Không thể học kỹ năng này'}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                    </div>

                                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                        Kỹ năng mặc định: <span className="font-bold text-slate-700">{virtualDefaultMoveName || 'Đã có trong bộ kỹ năng hiện tại'}</span>
                                    </div>

                                    {currentMoves.length >= 4 && (
                                        <div className="border border-amber-200 bg-amber-50 rounded p-3">
                                            <div className="text-xs font-bold text-amber-800 uppercase mb-2">Chọn kỹ năng cần thay thế</div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {currentMoves.map((moveName, index) => (
                                                    <button
                                                        key={`${moveName}-${index}`}
                                                        type="button"
                                                        onClick={() => setReplaceMoveIndex(index)}
                                                        className={`px-3 py-2 border rounded text-left text-sm font-semibold transition ${replaceMoveIndex === index
                                                            ? 'border-amber-500 bg-white text-amber-800'
                                                            : 'border-amber-200 bg-white text-slate-700 hover:border-amber-400'
                                                            }`}
                                                    >
                                                        Slot {index + 1}: {moveName}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="border-t border-slate-200 p-3 bg-slate-50 flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => setSkillModalOpen(false)}
                                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-sm font-semibold"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleTeachSkill}
                                disabled={teachingSkill || skillLoading || skillInventory.length === 0}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded text-sm font-bold"
                            >
                                {teachingSkill ? 'Đang dạy...' : 'Xác Nhận Học Kỹ Năng'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
