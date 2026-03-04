import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { resolvePokemonSprite } from '../utils/pokemonFormUtils'

const TRAINER_ORDER_STORAGE_KEY = 'battle_trainer_order_index'
const MOBILE_COMPLETED_ENTRIES_PER_VIEW = 4
const DESKTOP_COMPLETED_ENTRIES_PER_VIEW = 6
const DEFAULT_RANKED_RETURN_PATH = '/rankings/pokemon'

const resolveSafeRankedReturnPath = (value = '') => {
    const normalizedRaw = String(value || '').trim()
    if (!normalizedRaw) return DEFAULT_RANKED_RETURN_PATH
    const normalized = `/${normalizedRaw.replace(/^\/+/, '')}`
    if (normalized === '/rankings/pokemon') return normalized
    return DEFAULT_RANKED_RETURN_PATH
}

// Helper for the blue gradient header
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm first:rounded-t">
        {title}
    </div>
)

const typeColors = {
    grass: 'bg-green-100 text-green-800 border-green-300',
    fire: 'bg-red-100 text-red-800 border-red-300',
    water: 'bg-blue-100 text-blue-800 border-blue-300',
    electric: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    ice: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    dragon: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    poison: 'bg-purple-100 text-purple-800 border-purple-300',
    normal: 'bg-slate-100 text-slate-800 border-slate-300',
}

const statusLabels = {
    burn: 'Bỏng',
    poison: 'Độc',
    paralyze: 'Tê Liệt',
    freeze: 'Đóng Băng',
    sleep: 'Ngủ',
    confuse: 'Rối Loạn',
    flinch: 'Choáng',
}

const getGuardBadgeText = (guards = {}) => {
    const normalized = guards && typeof guards === 'object' ? guards : {}
    const physicalTurns = Number(normalized?.physical?.turns || 0)
    const specialTurns = Number(normalized?.special?.turns || 0)
    if (physicalTurns > 0 && specialTurns > 0) {
        return `Lá chắn hỗn hợp (${Math.max(physicalTurns, specialTurns)})`
    }
    if (physicalTurns > 0) {
        return `Chắn vật lý (${physicalTurns})`
    }
    if (specialTurns > 0) {
        return `Chắn đặc biệt (${specialTurns})`
    }
    return ''
}

const getVolatileBadgeText = (volatileState = {}) => {
    const state = volatileState && typeof volatileState === 'object' ? volatileState : {}
    const statusShieldTurns = Number(state?.statusShieldTurns || 0)
    if (statusShieldTurns > 0) {
        return `Chắn trạng thái (${statusShieldTurns})`
    }
    const statDropShieldTurns = Number(state?.statDropShieldTurns || 0)
    if (statDropShieldTurns > 0) {
        return `Chắn giảm chỉ số (${statDropShieldTurns})`
    }
    const rechargeTurns = Number(state?.rechargeTurns || 0)
    if (rechargeTurns > 0) {
        return `Hồi sức (${rechargeTurns})`
    }
    const bindTurns = Number(state?.bindTurns || 0)
    if (bindTurns > 0) {
        return `Bị trói (${bindTurns})`
    }
    const lockedRepeatMoveName = String(state?.lockedRepeatMoveName || '').trim()
    if (lockedRepeatMoveName) {
        return `Không lặp: ${lockedRepeatMoveName}`
    }
    return ''
}

const normalizeMoveType = (name = '') => {
    const normalized = String(name || '').toLowerCase()
    if (normalized.includes('fire')) return 'fire'
    if (normalized.includes('water')) return 'water'
    if (normalized.includes('grass') || normalized.includes('leaf') || normalized.includes('vine')) return 'grass'
    if (normalized.includes('electric') || normalized.includes('spark') || normalized.includes('thunder')) return 'electric'
    if (normalized.includes('ice') || normalized.includes('frost')) return 'ice'
    if (normalized.includes('dragon')) return 'dragon'
    if (normalized.includes('poison') || normalized.includes('toxic')) return 'poison'
    return 'normal'
}

const resolveMovePowerForDisplay = (entry, name = '') => {
    const powerRaw = Number(entry?.power)
    if (Number.isFinite(powerRaw) && powerRaw > 0) {
        return Math.floor(powerRaw)
    }
    return normalizeMoveNameKey(name) === 'struggle' ? 35 : 0
}

const normalizeMoveNameKey = (value = '') => String(value || '').trim().toLowerCase()
const getBattlePokemonDisplayName = (pokemon) => pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon'

const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon?.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter((entry) => Number.isFinite(entry?.level) && entry.level <= level)
        .sort((a, b) => a.level - b.level)
        .map((entry) => String(entry?.moveName || '').trim())
        .filter(Boolean)
    return learned.slice(-4)
}

const mergeBattleMoveNames = (moves = [], pokemon = null, level = 1) => {
    const explicit = (Array.isArray(moves) ? moves : [])
        .map((entry) => {
            if (typeof entry === 'string') {
                const name = String(entry || '').trim()
                return name ? { name } : null
            }

            const name = String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null

            return {
                ...entry,
                name,
            }
        })
        .filter(Boolean)

    if (explicit.length >= 4) return explicit.slice(0, 4)

    const merged = [...explicit]
    const knownSet = new Set(explicit.map((entry) => normalizeMoveNameKey(entry?.name || '')))
    const fallback = buildMovesForLevel(pokemon, level)

    for (const moveName of fallback) {
        const key = normalizeMoveNameKey(moveName)
        if (!key || knownSet.has(key)) continue
        merged.push({ name: moveName })
        knownSet.add(key)
        if (merged.length >= 4) break
    }

    return merged.slice(0, 4)
}

const normalizeMoveList = (moves = []) => {
    const struggleMove = {
        id: 'struggle-fallback',
        name: 'Struggle',
        type: 'normal',
        power: 35,
        category: 'physical',
        currentPp: 99,
        maxPp: 99,
    }

    const list = Array.isArray(moves) ? moves : []
    const mapped = list
        .map((entry, index) => {
            const name = typeof entry === 'string'
                ? entry
                : String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null
            const type = String(entry?.type || '').trim().toLowerCase() || normalizeMoveType(name)
            const power = resolveMovePowerForDisplay(entry, name)
            const currentPpRaw = Number(entry?.currentPp ?? entry?.pp)
            const maxPpRaw = Number(entry?.maxPp)
            const defaultPp = Math.max(1, Math.floor(Number(entry?.pp) || 10))
            const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0 ? Math.floor(maxPpRaw) : defaultPp
            const currentPp = Number.isFinite(currentPpRaw)
                ? Math.max(0, Math.min(maxPp, Math.floor(currentPpRaw)))
                : maxPp
            return {
                id: `${name}-${index}`,
                name,
                type,
                power,
                category: String(entry?.category || '').trim().toLowerCase(),
                currentPp,
                maxPp,
            }
        })
        .filter(Boolean)

    if (mapped.length > 0) {
        const limited = mapped.slice(0, 4)
        const hasStruggle = limited.some((entry) => normalizeMoveNameKey(entry?.name) === 'struggle')
        return hasStruggle ? limited : [...limited, struggleMove]
    }

    return [struggleMove]
}

const ProgressBar = ({ current, max, colorClass, label }) => {
    const safeMax = max > 0 ? max : 1
    const percent = Math.min(100, Math.max(0, (current / safeMax) * 100))
    return (
        <div className="w-full">
            <div className="flex justify-between text-[10px] font-bold px-1 mb-0.5">
                <span>{label}: {Math.round(percent)}%</span>
                <span>{Math.max(0, Math.floor(current))}/{Math.max(1, Math.floor(safeMax))}</span>
            </div>
            <div className="h-2 w-full bg-slate-200 rounded-full border border-slate-300 overflow-hidden">
                <div
                    className={`h-full ${colorClass} transition-all duration-300`}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    )
}

const ActiveBattleView = ({
    party,
    encounter,
    playerState,
    opponent,
    onAttack,
    actionMessage,
    activeTab,
    onSelectTab,
    inventory,
    onUseItem,
    onRun,
    selectedMoveIndex,
    onSelectMove,
    battleLog,
    isAttacking,
    activePartyIndex,
    partyHpState,
}) => {
    const resolvedActiveIndex = Number.isInteger(activePartyIndex)
        ? activePartyIndex
        : party.findIndex((slot) => Boolean(slot))
    const activePokemon = party[resolvedActiveIndex] || party.find((slot) => Boolean(slot)) || null
    const activeHpState = (resolvedActiveIndex >= 0 && Array.isArray(partyHpState))
        ? partyHpState[resolvedActiveIndex]
        : null
    const activeMaxHp = Math.max(1, Number(activePokemon?.stats?.hp) || 100)
    const activeCurrentHpRaw = Number(activeHpState?.currentHp)
    const activeCurrentHp = Number.isFinite(activeCurrentHpRaw) ? activeCurrentHpRaw : activeMaxHp

    const playerMon = activePokemon ? {
        name: activePokemon.nickname || activePokemon.pokemonId?.name || 'Unknown',
        level: activePokemon.level,
        maxHp: activeMaxHp,
        hp: Math.max(0, Math.min(activeMaxHp, activeCurrentHp)),
        exp: activePokemon.experience,
        maxExp: activePokemon.level * 100,
        sprite: resolvePokemonSprite({
            species: activePokemon.pokemonId || {},
            formId: activePokemon.formId,
            isShiny: Boolean(activePokemon.isShiny),
            preferBack: true,
        }),
        status: String(activePokemon?.status || '').trim().toLowerCase(),
        statusTurns: Number.isFinite(Number(activePokemon?.statusTurns)) ? Math.max(0, Math.floor(Number(activePokemon.statusTurns))) : 0,
        damageGuards: activePokemon?.damageGuards || {},
        volatileState: activePokemon?.volatileState || {},
        moves: normalizeMoveList(
            mergeBattleMoveNames(
                activePokemon.moves || [],
                activePokemon.pokemonId,
                Number(activePokemon.level) || 1
            )
        ),
    } : null

    const activeOpponent = opponent?.team?.[opponent.currentIndex || 0] || null
    const enemyMon = activeOpponent ? {
        name: activeOpponent.name || 'Pokemon Hoang Dã',
        owner: opponent?.trainerName || 'Hoang Dã',
        level: activeOpponent.level,
        maxHp: activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1,
        hp: activeOpponent.currentHp ?? (activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1),
        sprite: activeOpponent.sprite || '',
        status: String(activeOpponent?.status || '').trim().toLowerCase(),
        statusTurns: Number.isFinite(Number(activeOpponent?.statusTurns)) ? Math.max(0, Math.floor(Number(activeOpponent.statusTurns))) : 0,
        damageGuards: activeOpponent?.damageGuards || {},
        volatileState: activeOpponent?.volatileState || {},
    } : {
        name: 'Pokemon Hoang Dã',
        owner: 'Hoang Dã',
        level: 1,
        maxHp: 1,
        hp: 1,
        sprite: '',
        status: '',
        statusTurns: 0,
        damageGuards: {},
        volatileState: {},
    }

    const moves = playerMon?.moves || normalizeMoveList([])
    const selectedMove = moves[selectedMoveIndex] || moves[0] || normalizeMoveList([])[0]
    const battleUsableInventory = (Array.isArray(inventory) ? inventory : [])
        .filter((entry) => {
            const itemType = String(entry?.item?.type || '').trim().toLowerCase()
            if (!entry?.item?._id || Number(entry?.quantity) <= 0) return false
            return itemType === 'healing'
        })

    return (
        <div className="space-y-3 animate-fadeIn">
            <div className="grid grid-cols-2 gap-1 bg-white border border-slate-400 p-1 rounded">
                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">
                        {playerMon ? `Của bạn: ${playerMon.name}` : 'Không có Pokemon trong đội'}
                    </h3>
                    {playerMon?.status && (
                        <div className="mb-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                            {statusLabels[playerMon.status] || playerMon.status}
                            {playerMon.statusTurns > 0 ? ` (${playerMon.statusTurns})` : ''}
                        </div>
                    )}
                    {playerMon && getGuardBadgeText(playerMon.damageGuards) && (
                        <div className="mb-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                            {getGuardBadgeText(playerMon.damageGuards)}
                        </div>
                    )}
                    {playerMon && getVolatileBadgeText(playerMon.volatileState) && (
                        <div className="mb-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {getVolatileBadgeText(playerMon.volatileState)}
                        </div>
                    )}

                    {playerMon && (
                        <div className="w-full grid grid-cols-2 gap-1 mb-2">
                            <ProgressBar current={playerMon.hp} max={playerMon.maxHp} colorClass="bg-green-500" label="HP" />
                        </div>
                    )}

                    {playerMon && (
                        <div className="w-full mb-4">
                            <div className="text-[10px] font-bold text-center mb-0.5">Cấp {playerMon.level}</div>
                            <div className="h-1.5 w-full bg-slate-200 border border-slate-300">
                                <div className="h-full bg-yellow-400" style={{ width: `${(playerMon.exp / playerMon.maxExp) * 100}%` }}></div>
                            </div>
                        </div>
                    )}

                    {playerMon?.sprite ? (
                        <img src={playerMon.sprite} className="w-24 h-24 pixelated object-contain" />
                    ) : (
                        <div className="w-24 h-24 bg-slate-100 border border-slate-200 rounded" />
                    )}
                </div>

                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">{enemyMon.owner} - {enemyMon.name}</h3>
                    {enemyMon.status && (
                        <div className="mb-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                            {statusLabels[enemyMon.status] || enemyMon.status}
                            {enemyMon.statusTurns > 0 ? ` (${enemyMon.statusTurns})` : ''}
                        </div>
                    )}
                    {getGuardBadgeText(enemyMon.damageGuards) && (
                        <div className="mb-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                            {getGuardBadgeText(enemyMon.damageGuards)}
                        </div>
                    )}
                    {getVolatileBadgeText(enemyMon.volatileState) && (
                        <div className="mb-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {getVolatileBadgeText(enemyMon.volatileState)}
                        </div>
                    )}

                    {enemyMon.sprite ? (
                        <img src={enemyMon.sprite} className="w-24 h-24 pixelated object-contain mb-2" />
                    ) : (
                        <div className="w-24 h-24 bg-slate-100 border border-slate-200 rounded mb-2" />
                    )}

                    <div className="w-full mt-auto">
                        <div className="text-[10px] font-bold text-center mb-0.5">Cấp {enemyMon.level}</div>
                        <div className="h-1.5 w-full bg-slate-200 border border-slate-300 mb-2"></div>

                        <div className="w-full grid grid-cols-2 gap-1">
                            <ProgressBar current={enemyMon.hp} max={enemyMon.maxHp} colorClass="bg-green-500" label="HP" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                <div className="flex border-b border-slate-300 text-xs font-bold bg-slate-50">
                    <button
                        onClick={() => onSelectTab('fight')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'fight' ? 'text-green-700 border-b-2 border-green-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Chiến Đấu
                    </button>
                    <button
                        onClick={() => onSelectTab('item')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'item' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Vật Phẩm
                    </button>
                    <button
                        onClick={() => onSelectTab('focus')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'focus' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Tập Trung
                    </button>
                    <button
                        onClick={() => onSelectTab('party')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'party' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Đổi Đội Hình
                    </button>
                    <button
                        onClick={() => onSelectTab('run')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'run' ? 'text-red-700 border-b-2 border-red-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Thoát
                    </button>
                </div>

                {activeTab === 'fight' && (moves.length > 0 ? (
                    <div className="p-2 grid grid-cols-2 gap-2">
                        {moves.map((move, idx) => {
                            const isSelected = selectedMoveIndex === idx
                            const isOutOfPp = Number(move.currentPp) <= 0
                            return (
                                <button
                                    key={move.id}
                                    onClick={() => onSelectMove?.(idx)}
                                    className={`text-left p-1 border rounded flex justify-between items-center ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'} ${isOutOfPp ? 'opacity-70' : ''}`}
                                >
                                    <div>
                                        <span className={`text-[9px] uppercase font-bold px-1 rounded mr-1 ${typeColors[move.type] || 'bg-slate-100'}`}>
                                            {move.type}
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">{move.name}</span>
                                        <div className={`text-[10px] mt-0.5 ${isOutOfPp ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                                            {move.currentPp}/{move.maxPp} PP
                                        </div>
                                    </div>
                                    <div className="text-[11px] font-bold text-right leading-tight">
                                        <div className="text-slate-500 uppercase">Pow</div>
                                        <div>{Number(move.power) > 0 ? move.power : '--'}</div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <div className="p-3 text-center text-xs text-slate-500">Không có chiêu thức.</div>
                ))}

                {activeTab === 'item' && (
                    <div className="p-3 text-xs text-slate-600">
                        {battleUsableInventory.length === 0 ? (
                            <div className="text-center text-slate-500">
                                Không có vật phẩm hồi phục có thể dùng trong trận này.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {battleUsableInventory.map((entry) => (
                                    <button
                                        key={entry.item._id}
                                        onClick={() => onUseItem?.(entry)}
                                        className="border border-slate-200 rounded p-2 text-left hover:bg-slate-50"
                                    >
                                        <div className="font-bold text-slate-700">{entry.item.name}</div>
                                        <div className="text-[10px] text-slate-500">x{entry.quantity}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'focus' && (
                    <div className="p-3">
                        <FeatureUnavailableNotice
                            compact
                            title="Tập trung chưa cập nhật"
                            message="Tính năng Tập Trung trong battle đang được phát triển."
                        />
                    </div>
                )}

                {activeTab === 'party' && (
                    <div className="p-3">
                        <FeatureUnavailableNotice
                            compact
                            title="Đổi đội hình chưa cập nhật"
                            message="Đổi đội hình ngay trong battle chưa khả dụng ở phiên bản này."
                        />
                    </div>
                )}

                {activeTab === 'run' && (
                    <div className="p-3 text-center">
                        <button
                            onClick={onRun}
                            className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-bold text-slate-700"
                        >
                            Thoát
                        </button>
                    </div>
                )}

                {activeTab === 'fight' && (
                    <div className="p-2 text-center border-t border-slate-200 bg-slate-50">
                        <div className="text-xs text-slate-500 mb-2">
                            Chọn chiêu thức hoặc hành động, sau đó nhấn dưới đây.
                        </div>
                        <button
                            onClick={() => onAttack?.(selectedMove)}
                            disabled={!playerMon || isAttacking}
                            className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm text-sm mx-auto disabled:opacity-50"
                        >
                            {isAttacking ? 'Đang tấn công...' : 'Tấn Công'}
                        </button>
                    </div>
                )}
            </div>

            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                <div className="bg-amber-50 border-b border-slate-300 text-center text-sm font-bold py-1.5">
                    Kết Quả Trận Đấu
                </div>
                <div className="p-3 text-center text-sm text-slate-700 min-h-20">
                    {actionMessage && <div className="font-semibold mb-1">{actionMessage}</div>}
                    {battleLog?.length > 0 ? (
                        battleLog.map((line, idx) => (
                            <div key={`${line}-${idx}`}>{line}</div>
                        ))
                    ) : (
                        <div className="text-slate-500">Chưa có hành động.</div>
                    )}
                </div>
            </div>

            {(!opponent?.team || opponent.team.length === 0) && (
                <div className="border border-slate-400 bg-white rounded overflow-hidden">
                    <div className="p-3 text-center text-xs text-slate-500">
                        Chưa cấu hình đội hình huấn luyện viên.
                    </div>
                </div>
            )}
        </div>
    )
}
export function BattlePage() {
    const location = useLocation()
    const navigate = useNavigate()
    const challengeSearchParams = new URLSearchParams(location.search)
    const rankedChallengePokemonId = String(challengeSearchParams.get('challengePokemonId') || '').trim()
    const rankedChallengeReturnTo = resolveSafeRankedReturnPath(challengeSearchParams.get('returnTo'))
    const isRankedChallengeRequested = Boolean(rankedChallengePokemonId)
    const [maps, setMaps] = useState([])
    const [party, setParty] = useState([])
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState(isRankedChallengeRequested ? 'battle' : 'lobby') // 'lobby' | 'battle'
    const [encounter, setEncounter] = useState(null)
    const [playerState, setPlayerState] = useState(null)
    const [opponent, setOpponent] = useState(null)
    const [battleOpponent, setBattleOpponent] = useState(null)
    const [actionMessage, setActionMessage] = useState('')
    const [battleResults, setBattleResults] = useState(null)
    const [masterPokemon, setMasterPokemon] = useState([])
    const [completedEntries, setCompletedEntries] = useState([])
    const [completedCarouselIndex, setCompletedCarouselIndex] = useState(0)
    const [completedEntriesPerView, setCompletedEntriesPerView] = useState(DESKTOP_COMPLETED_ENTRIES_PER_VIEW)
    const [hoveredCompletedId, setHoveredCompletedId] = useState(null)
    const [activeTab, setActiveTab] = useState('fight')
    const [inventory, setInventory] = useState([])
    const [selectedMoveIndex, setSelectedMoveIndex] = useState(0)
    const [battleLog, setBattleLog] = useState([])
    const [isAttacking, setIsAttacking] = useState(false)
    const [battlePlayerIndex, setBattlePlayerIndex] = useState(0)
    const [battlePartyHpState, setBattlePartyHpState] = useState([])
    const [activeBattleMode, setActiveBattleMode] = useState('trainer')
    const [duelOpponentMoves, setDuelOpponentMoves] = useState([])
    const [duelOpponentMoveCursor, setDuelOpponentMoveCursor] = useState(0)
    const [duelReturnPath, setDuelReturnPath] = useState(DEFAULT_RANKED_RETURN_PATH)
    const [duelResultModal, setDuelResultModal] = useState(null)
    const [isStartingRankedDuel, setIsStartingRankedDuel] = useState(false)
    const rankedChallengeLockRef = useRef('')

    const completedSlides = []
    for (let index = 0; index < completedEntries.length; index += completedEntriesPerView) {
        completedSlides.push(completedEntries.slice(index, index + completedEntriesPerView))
    }
    if (completedSlides.length === 0) {
        completedSlides.push([])
    }
    const completedSlideCount = completedSlides.length

    const partyCandidates = party
        .map((slot, index) => {
            if (!slot?._id) return null
            return {
                id: String(slot._id),
                index,
                name: getBattlePokemonDisplayName(slot),
                level: Number(slot.level) || 1,
            }
        })
        .filter(Boolean)

    const markTrainerCompleted = async (trainerId) => {
        const normalizedId = String(trainerId || '').trim()
        if (!normalizedId) return null
        const res = await gameApi.completeTrainer(normalizedId)
        const completedTrainerIds = Array.isArray(res?.completedBattleTrainers)
            ? res.completedBattleTrainers
            : []
        return new Set(
            completedTrainerIds
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        )
    }

    const buildBattlePartyState = (partySlots = []) => {
        return (Array.isArray(partySlots) ? partySlots : []).map((slot) => {
            if (!slot) return null
            const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
            return { currentHp: maxHp, maxHp }
        })
    }

    const getNextAlivePartyIndex = (partySlots = [], hpState = [], currentIndex = -1) => {
        const total = Array.isArray(partySlots) ? partySlots.length : 0
        if (total === 0) return -1
        const startIndex = Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1

        for (let step = 1; step <= total; step += 1) {
            const idx = (startIndex + step + total) % total
            const slot = partySlots[idx]
            if (!slot) continue
            const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
            const currentHpRaw = Number(hpState?.[idx]?.currentHp)
            const currentHp = clampValue(Number.isFinite(currentHpRaw) ? currentHpRaw : maxHp, 0, maxHp)
            if (currentHp > 0) return idx
        }

        return -1
    }

    const getStoredTrainerOrder = () => {
        const raw = window.localStorage.getItem(TRAINER_ORDER_STORAGE_KEY)
        const parsed = Number.parseInt(raw || '0', 10)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    }

    const setStoredTrainerOrder = (value) => {
        const parsed = Number.parseInt(String(value || '0'), 10)
        const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
        window.localStorage.setItem(TRAINER_ORDER_STORAGE_KEY, String(normalized))
        return normalized
    }

    const getTrainerOrderFromProgress = (trainers = [], completedTrainerIds = new Set()) => {
        if (!Array.isArray(trainers) || trainers.length === 0) return 0

        const normalizedCompleted = completedTrainerIds instanceof Set
            ? completedTrainerIds
            : new Set(
                (Array.isArray(completedTrainerIds) ? completedTrainerIds : [])
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )

        const firstUncompletedIndex = trainers.findIndex((trainer) => {
            const trainerId = String(trainer?._id || '').trim()
            if (!trainerId) return true
            return !normalizedCompleted.has(trainerId)
        })

        if (firstUncompletedIndex !== -1) {
            return firstUncompletedIndex
        }

        return getStoredTrainerOrder() % trainers.length
    }

    const getTrainerByOrder = (trainers = [], preferredOrder = null) => {
        if (!Array.isArray(trainers) || trainers.length === 0) {
            return { trainer: null, trainerOrder: 0 }
        }
        const computedOrder = Number.isFinite(preferredOrder)
            ? Math.max(0, Math.floor(preferredOrder))
            : getStoredTrainerOrder()
        const trainerOrder = computedOrder % trainers.length
        return {
            trainer: trainers[trainerOrder],
            trainerOrder,
        }
    }

    const advanceTrainerOrder = (currentOrder, total) => {
        if (!Number.isFinite(total) || total <= 0) return 0
        const current = Number.isFinite(currentOrder) ? currentOrder : 0
        const nextOrder = (current + 1) % total
        window.localStorage.setItem(TRAINER_ORDER_STORAGE_KEY, String(nextOrder))
        return nextOrder
    }

    useEffect(() => {
        loadData()
    }, [])

    useEffect(() => {
        const updateEntriesPerView = () => {
            const nextValue = window.innerWidth < 640
                ? MOBILE_COMPLETED_ENTRIES_PER_VIEW
                : DESKTOP_COMPLETED_ENTRIES_PER_VIEW
            setCompletedEntriesPerView((prev) => (prev === nextValue ? prev : nextValue))
        }

        updateEntriesPerView()
        window.addEventListener('resize', updateEntriesPerView)
        return () => window.removeEventListener('resize', updateEntriesPerView)
    }, [])

    useEffect(() => {
        const lastSlide = Math.max(0, completedSlideCount - 1)
        setCompletedCarouselIndex((prev) => Math.min(prev, lastSlide))
    }, [completedSlideCount])

    useEffect(() => {
        if (!rankedChallengePokemonId) return
        if (loading || isStartingRankedDuel) return
        if (activeBattleMode === 'duel' && view === 'battle') return

        setDuelReturnPath(rankedChallengeReturnTo)
        if (partyCandidates.length === 0) {
            setActionMessage('Bạn cần có Pokemon trong đội hình để khiêu chiến BXH.')
            navigate(rankedChallengeReturnTo, { replace: true })
            return
        }

        const challengeKey = `${rankedChallengePokemonId}:smart:${rankedChallengeReturnTo}`
        if (rankedChallengeLockRef.current === challengeKey) return

        if (view !== 'battle') {
            setView('battle')
        }

        rankedChallengeLockRef.current = challengeKey
        setIsStartingRankedDuel(true)
        startRankedPokemonDuel(rankedChallengePokemonId)
            .finally(() => {
                rankedChallengeLockRef.current = ''
                setIsStartingRankedDuel(false)
                navigate('/battle', { replace: true })
            })
    }, [rankedChallengePokemonId, rankedChallengeReturnTo, loading, isStartingRankedDuel, partyCandidates.length, activeBattleMode, view])

    const loadData = async () => {
        try {
            if (isRankedChallengeRequested) {
                const [allMaps, partyData, encounterData, profileData, inventoryData] = await Promise.all([
                    gameApi.getMaps(),
                    gameApi.getParty(),
                    gameApi.getActiveEncounter(),
                    gameApi.getProfile(),
                    gameApi.getInventory(),
                ])

                setMaps(allMaps)
                setParty(partyData)
                setEncounter(encounterData?.encounter || null)
                setPlayerState(profileData?.playerState || null)
                setInventory(inventoryData?.inventory || [])
                setMasterPokemon([])
                setCompletedEntries([])
                setCompletedCarouselIndex(0)
                setOpponent(null)
                setBattleOpponent(null)
                setBattlePlayerIndex(0)
                setBattlePartyHpState([])
                setActiveBattleMode('trainer')
                setDuelOpponentMoves([])
                setDuelOpponentMoveCursor(0)
                setDuelResultModal(null)
                return
            }

            const [allMaps, partyData, encounterData, profileData, trainerData, inventoryData] = await Promise.all([
                gameApi.getMaps(),
                gameApi.getParty(),
                gameApi.getActiveEncounter(),
                gameApi.getProfile(),
                gameApi.getBattleTrainers(),
                gameApi.getInventory(),
            ])
            setMaps(allMaps)
            setParty(partyData)
            setEncounter(encounterData?.encounter || null)
            setPlayerState(profileData?.playerState || null)
            const trainerList = trainerData?.trainers || []
            setMasterPokemon(trainerList)
            setInventory(inventoryData?.inventory || [])

            const completedTrainerIds = new Set(
                (Array.isArray(profileData?.user?.completedBattleTrainers)
                    ? profileData.user.completedBattleTrainers
                    : []
                )
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )
            const completedFromServer = buildCompletedEntries(trainerList)
                .filter((entry) => completedTrainerIds.has(String(entry.id)))
            setCompletedEntries(completedFromServer)
            setCompletedCarouselIndex(0)

            const syncedTrainerOrder = getTrainerOrderFromProgress(trainerList, completedTrainerIds)
            setStoredTrainerOrder(syncedTrainerOrder)
            const { trainer, trainerOrder } = getTrainerByOrder(trainerList, syncedTrainerOrder)
            const builtOpponent = buildOpponent(encounterData?.encounter || null, trainer, trainerOrder)
            setOpponent(builtOpponent)
            setBattleOpponent(builtOpponent)
            setBattlePlayerIndex(0)
            setBattlePartyHpState([])
            setActiveBattleMode('trainer')
            setDuelOpponentMoves([])
            setDuelOpponentMoveCursor(0)
            setDuelResultModal(null)

        } catch (error) {
            console.error('Tải dữ liệu thất bại', error)
        } finally {
            setLoading(false)
        }
    }

    const appendBattleLog = (lines) => {
        const normalized = (Array.isArray(lines) ? lines : [lines]).filter(Boolean)
        if (normalized.length === 0) return
        setBattleLog((prev) => [...normalized, ...prev].slice(0, 8))
    }

    const navigateBackToRankingsAfterDuel = () => {
        navigate(duelReturnPath || DEFAULT_RANKED_RETURN_PATH)
    }

    const showRankedDuelResultModal = ({ resultType, title, message }) => {
        setDuelResultModal({
            resultType: resultType === 'defeat' ? 'defeat' : 'win',
            title: String(title || '').trim() || 'Kết quả khiêu chiến BXH',
            message: String(message || '').trim() || 'Trận đấu đã kết thúc.',
        })
    }

    const closeRankedDuelResultModal = () => {
        setDuelResultModal(null)
        navigateBackToRankingsAfterDuel()
    }

    const handleAttack = async (selectedMove) => {
        if (isAttacking || duelResultModal || !battleOpponent?.team?.length) return

        const currentIndex = battleOpponent.currentIndex || 0
        const target = battleOpponent.team[currentIndex]
        if (!target) return
        if (Number(target.currentHp ?? target.maxHp ?? 0) <= 0) {
            if (activeBattleMode === 'duel') {
                setActionMessage('Trận đấu 1v1 đã kết thúc. Hãy thoát ra để bắt đầu trận mới.')
            }
            return
        }

        const resolvedPartyState = Array.isArray(battlePartyHpState) && battlePartyHpState.length === party.length
            ? battlePartyHpState
            : buildBattlePartyState(party)
        const resolvedActiveIndex = party[battlePlayerIndex]
            ? battlePlayerIndex
            : getNextAlivePartyIndex(party, resolvedPartyState, -1)
        if (resolvedActiveIndex === -1) {
            setActionMessage('Bạn không còn Pokemon nào có thể chiến đấu.')
            return
        }
        if (resolvedActiveIndex !== battlePlayerIndex) {
            setBattlePlayerIndex(resolvedActiveIndex)
        }

        const activePokemon = party[resolvedActiveIndex] || null
        const activeName = activePokemon?.nickname || activePokemon?.pokemonId?.name || 'Pokemon'
        const activeMaxHp = Math.max(1, Number(activePokemon?.stats?.hp) || 1)
        const activeResultImage = resolvePokemonSprite({
            species: activePokemon?.pokemonId || {},
            formId: activePokemon?.formId,
            isShiny: Boolean(activePokemon?.isShiny),
        })
        const activeHpState = resolvedPartyState[resolvedActiveIndex] || { currentHp: activeMaxHp, maxHp: activeMaxHp }
        const playerCurrentHpForTurn = clampValue(
            Number.isFinite(Number(activeHpState.currentHp)) ? Number(activeHpState.currentHp) : activeMaxHp,
            0,
            activeMaxHp
        )

        if (playerCurrentHpForTurn <= 0) {
            const switchedIndex = getNextAlivePartyIndex(party, resolvedPartyState, resolvedActiveIndex)
            if (switchedIndex !== -1) {
                const switchedPokemon = party[switchedIndex]
                setBattlePlayerIndex(switchedIndex)
                setActionMessage(`${activeName} đã kiệt sức. ${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} ra sân.`)
            } else {
                setActionMessage('Pokemon của bạn đã kiệt sức. Hãy bắt đầu lại trận đấu.')
            }
            return
        }

        setIsAttacking(true)
        try {
            const duelTurnPayload = activeBattleMode === 'duel'
                ? {
                    opponentMoveMode: 'smart',
                    opponentMoveCursor: duelOpponentMoveCursor,
                    opponentMoves: duelOpponentMoves,
                }
                : {}

            const res = await gameApi.battleAttack({
                moveName: selectedMove?.name,
                move: selectedMove,
                trainerId: battleOpponent?.trainerId || null,
                activePokemonId: activePokemon?._id || null,
                fieldState: battleOpponent?.fieldState || {},
                opponent: {
                    name: target.name,
                    level: target.level,
                    currentHp: target.currentHp ?? target.maxHp,
                    maxHp: target.maxHp,
                    baseStats: target.baseStats || {},
                    status: target.status || '',
                    statusTurns: Number.isFinite(Number(target.statusTurns)) ? Math.max(0, Math.floor(Number(target.statusTurns))) : 0,
                    statStages: target.statStages || {},
                    damageGuards: target.damageGuards || {},
                    wasDamagedLastTurn: Boolean(target.wasDamagedLastTurn),
                    volatileState: target.volatileState || {},
                },
                player: {
                    level: activePokemon?.level || 1,
                    currentHp: playerCurrentHpForTurn,
                    maxHp: activeMaxHp,
                    baseStats: activePokemon?.stats || activePokemon?.pokemonId?.baseStats || {},
                    status: activePokemon?.status || '',
                    statusTurns: Number.isFinite(Number(activePokemon?.statusTurns)) ? Math.max(0, Math.floor(Number(activePokemon.statusTurns))) : 0,
                    statStages: activePokemon?.statStages || {},
                    damageGuards: activePokemon?.damageGuards || {},
                    wasDamagedLastTurn: Boolean(activePokemon?.wasDamagedLastTurn),
                    volatileState: activePokemon?.volatileState || {},
                },
                ...duelTurnPayload,
            })

            const battle = res?.battle || {}
            const damage = Number.isFinite(battle.damage) ? battle.damage : 1
            const nextHp = Number.isFinite(battle.currentHp)
                ? Math.max(0, battle.currentHp)
                : Math.max(0, (target.currentHp ?? target.maxHp) - damage)
            const moveName = battle?.move?.name || selectedMove?.name || 'Attack'
            const moveHit = battle?.move?.hit !== false
            const moveFallbackReason = String(battle?.move?.fallbackReason || '').trim()
            const moveFallbackFrom = String(battle?.move?.fallbackFrom || '').trim()
            const counterAttack = battle?.counterAttack || null
            const effectLogs = Array.isArray(battle?.effects?.logs)
                ? battle.effects.logs.filter((entry) => Boolean(String(entry || '').trim()))
                : []
            const opponentMoveState = battle?.opponentMoveState && typeof battle.opponentMoveState === 'object'
                ? battle.opponentMoveState
                : null

            if (activeBattleMode === 'duel' && opponentMoveState) {
                const nextCursorRaw = Number(opponentMoveState?.cursor)
                const nextCursor = Number.isFinite(nextCursorRaw) ? Math.max(0, Math.floor(nextCursorRaw)) : 0
                const nextMoves = Array.isArray(opponentMoveState?.moves)
                    ? opponentMoveState.moves.map((entry, idx) => ({
                        ...entry,
                        id: `duel-op-${idx}-${String(entry?.name || '').trim() || 'move'}`,
                    }))
                    : []
                setDuelOpponentMoveCursor(nextCursor)
                setDuelOpponentMoves(nextMoves)
            }

            if (battle?.player) {
                setParty((prevParty) => {
                    const nextParty = Array.isArray(prevParty) ? [...prevParty] : []
                    const targetSlot = nextParty[resolvedActiveIndex]
                    if (!targetSlot) return prevParty

                    const ppState = Array.isArray(battle.player.movePpState) ? battle.player.movePpState : null
                    const moveMap = new Map(
                        (ppState || []).map((entry) => [
                            String(entry?.moveName || '').trim().toLowerCase(),
                            {
                                name: String(entry?.moveName || '').trim(),
                                currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                                maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                                pp: Math.max(0, Number(entry?.currentPp || 0)),
                            },
                        ])
                    )

                    const sourceMoves = Array.isArray(targetSlot.moves) ? targetSlot.moves : []
                    const nextMoves = sourceMoves.map((entry) => {
                        const baseMove = typeof entry === 'string'
                            ? { name: String(entry || '').trim() }
                            : { ...(entry || {}) }
                        const name = String(baseMove?.name || baseMove?.moveName || '').trim()
                        const key = name.toLowerCase()
                        const ppPatch = moveMap.get(key)
                        if (!ppPatch) return baseMove
                        return {
                            ...baseMove,
                            ...ppPatch,
                            name: ppPatch.name || baseMove.name,
                        }
                    })

                    const nextStatus = String(battle.player?.status || '').trim().toLowerCase()
                    const nextStatusTurns = Number.isFinite(Number(battle.player?.statusTurns))
                        ? Math.max(0, Math.floor(Number(battle.player.statusTurns)))
                        : 0
                    const nextStatStages = battle.player?.statStages && typeof battle.player.statStages === 'object'
                        ? battle.player.statStages
                        : {}
                    const nextDamageGuards = battle.player?.damageGuards && typeof battle.player.damageGuards === 'object'
                        ? battle.player.damageGuards
                        : {}
                    const nextWasDamagedLastTurn = Boolean(battle.player?.wasDamagedLastTurn)
                    const nextVolatileState = battle.player?.volatileState && typeof battle.player.volatileState === 'object'
                        ? battle.player.volatileState
                        : {}

                    nextParty[resolvedActiveIndex] = {
                        ...targetSlot,
                        moves: nextMoves,
                        movePpState: ppState || targetSlot.movePpState || [],
                        status: nextStatus,
                        statusTurns: nextStatusTurns,
                        statStages: nextStatStages,
                        damageGuards: nextDamageGuards,
                        wasDamagedLastTurn: nextWasDamagedLastTurn,
                        volatileState: nextVolatileState,
                    }
                    return nextParty
                })
            }

            let defeatedAll = false
            let defeatedName = ''
            let nextName = ''
            const currentBattleState = battleOpponent
            const currentBattleIndex = currentBattleState?.currentIndex || 0
            const targetStatePatch = battle?.targetState || null
            const localResolvedTeam = (currentBattleState?.team || []).map((member, index) => {
                if (index !== currentBattleIndex) return member
                return {
                    ...member,
                    currentHp: nextHp,
                    maxHp: targetStatePatch?.maxHp ?? member?.maxHp ?? 1,
                    status: String(targetStatePatch?.status || member?.status || '').trim().toLowerCase(),
                    statusTurns: Number.isFinite(Number(targetStatePatch?.statusTurns))
                        ? Math.max(0, Math.floor(Number(targetStatePatch.statusTurns)))
                        : Math.max(0, Math.floor(Number(member?.statusTurns) || 0)),
                    statStages: targetStatePatch?.statStages && typeof targetStatePatch.statStages === 'object'
                        ? targetStatePatch.statStages
                        : (member?.statStages || {}),
                    damageGuards: targetStatePatch?.damageGuards && typeof targetStatePatch.damageGuards === 'object'
                        ? targetStatePatch.damageGuards
                        : (member?.damageGuards || {}),
                    wasDamagedLastTurn: Boolean(targetStatePatch?.wasDamagedLastTurn ?? member?.wasDamagedLastTurn),
                    volatileState: targetStatePatch?.volatileState && typeof targetStatePatch.volatileState === 'object'
                        ? targetStatePatch.volatileState
                        : (member?.volatileState || {}),
                }
            })

            let nextBattleState = currentBattleState
            const serverOpponentState = battle?.opponent
            if (serverOpponentState && Array.isArray(serverOpponentState.team)) {
                const mergedTeam = (currentBattleState?.team || []).map((member, index) => {
                    const serverEntry = serverOpponentState.team[index]
                    if (!serverEntry) return member
                    return {
                        ...member,
                        ...serverEntry,
                        currentHp: serverEntry.currentHp ?? member?.currentHp ?? member?.maxHp ?? 0,
                        maxHp: serverEntry.maxHp ?? member?.maxHp ?? 1,
                        status: String(serverEntry.status || member?.status || '').trim().toLowerCase(),
                        statusTurns: Number.isFinite(Number(serverEntry.statusTurns))
                            ? Math.max(0, Math.floor(Number(serverEntry.statusTurns)))
                            : Math.max(0, Math.floor(Number(member?.statusTurns) || 0)),
                        statStages: serverEntry.statStages && typeof serverEntry.statStages === 'object'
                            ? serverEntry.statStages
                            : (member?.statStages || {}),
                        damageGuards: serverEntry.damageGuards && typeof serverEntry.damageGuards === 'object'
                            ? serverEntry.damageGuards
                            : (member?.damageGuards || {}),
                        wasDamagedLastTurn: Boolean(serverEntry.wasDamagedLastTurn ?? member?.wasDamagedLastTurn),
                        volatileState: serverEntry.volatileState && typeof serverEntry.volatileState === 'object'
                            ? serverEntry.volatileState
                            : (member?.volatileState || {}),
                    }
                })
                const serverCurrentIndex = Number.isInteger(serverOpponentState.currentIndex)
                    ? serverOpponentState.currentIndex
                    : currentBattleIndex

                const previousTargetHp = Number(currentBattleState?.team?.[currentBattleIndex]?.currentHp)
                const fallbackTargetHp = Number(currentBattleState?.team?.[currentBattleIndex]?.maxHp)
                const beforeHitHp = Number.isFinite(previousTargetHp)
                    ? previousTargetHp
                    : (Number.isFinite(fallbackTargetHp) ? fallbackTargetHp : 0)
                const afterHitHp = Number(mergedTeam?.[currentBattleIndex]?.currentHp ?? 0)
                if (beforeHitHp > 0 && afterHitHp <= 0) {
                    defeatedName = mergedTeam?.[currentBattleIndex]?.name || target.name || 'Pokemon'
                }

                defeatedAll = Boolean(serverOpponentState.defeatedAll) || serverCurrentIndex >= mergedTeam.length
                if (!defeatedAll && serverCurrentIndex !== currentBattleIndex) {
                    nextName = mergedTeam?.[serverCurrentIndex]?.name || 'Pokemon'
                }

                nextBattleState = {
                    ...currentBattleState,
                    ...serverOpponentState,
                    currentIndex: serverCurrentIndex,
                    team: mergedTeam,
                }
            } else {
                const activeEnemy = localResolvedTeam[currentBattleIndex]
                if (activeEnemy && activeEnemy.currentHp <= 0) {
                    defeatedName = activeEnemy.name || 'Pokemon'
                    const nextIndex = localResolvedTeam.findIndex((member, memberIndex) => {
                        if (memberIndex <= currentBattleIndex) return false
                        const hp = member.currentHp ?? member.maxHp ?? 0
                        return hp > 0
                    })
                    if (nextIndex !== -1) {
                        nextName = localResolvedTeam[nextIndex]?.name || 'Pokemon'
                        nextBattleState = { ...currentBattleState, team: localResolvedTeam, currentIndex: nextIndex }
                    } else {
                        defeatedAll = true
                        nextBattleState = { ...currentBattleState, team: localResolvedTeam }
                    }
                } else {
                    nextBattleState = { ...currentBattleState, team: localResolvedTeam }
                }
            }

            const nextFieldState = battle?.fieldState && typeof battle.fieldState === 'object'
                ? battle.fieldState
                : (nextBattleState?.fieldState && typeof nextBattleState.fieldState === 'object'
                    ? nextBattleState.fieldState
                    : {})
            nextBattleState = {
                ...nextBattleState,
                fieldState: nextFieldState,
            }

            setBattleOpponent(nextBattleState)

            const logLines = [
                moveHit
                    ? `${activeName} của bạn dùng ${moveName}! Gây ${damage} sát thương.`
                    : `${activeName} của bạn dùng ${moveName} nhưng trượt.`,
            ]
            if (moveFallbackReason === 'OUT_OF_PP') {
                logLines.unshift(`Chiêu ${moveFallbackFrom || 'đã chọn'} đã hết PP, hệ thống tự chuyển sang Struggle.`)
            }
            let nextPartyState = resolvedPartyState
            let authoritativePlayerHp = null
            let authoritativePlayerMaxHp = activeMaxHp
            if (battle?.player && Number.isFinite(battle.player.currentHp)) {
                authoritativePlayerMaxHp = Math.max(1, Number(battle.player.maxHp) || activeMaxHp)
                authoritativePlayerHp = clampValue(Number(battle.player.currentHp) || 0, 0, authoritativePlayerMaxHp)
            }

            let switchedAfterDefeat = false
            if (counterAttack) {
                const counterDamage = Number.isFinite(counterAttack.damage) ? counterAttack.damage : 0
                const counterMoveName = counterAttack?.move?.name || 'Phản công'
                const nextPlayerHpFromCounter = Number.isFinite(counterAttack.currentHp)
                    ? Math.max(0, counterAttack.currentHp)
                    : Math.max(0, playerCurrentHpForTurn - counterDamage)
                authoritativePlayerMaxHp = Math.max(1, Number(counterAttack?.maxHp) || authoritativePlayerMaxHp || activeMaxHp)
                if (Number.isFinite(authoritativePlayerHp)) {
                    authoritativePlayerHp = Math.min(authoritativePlayerHp, clampValue(nextPlayerHpFromCounter, 0, authoritativePlayerMaxHp))
                } else {
                    authoritativePlayerHp = clampValue(nextPlayerHpFromCounter, 0, authoritativePlayerMaxHp)
                }
                logLines.push(`${target.name || 'Đối thủ'} dùng ${counterMoveName}! Gây ${counterDamage} sát thương.`)
            }

            if (Number.isFinite(authoritativePlayerHp)) {
                nextPartyState = resolvedPartyState.map((entry, idx) => {
                    if (idx !== resolvedActiveIndex) return entry
                    return {
                        currentHp: clampValue(authoritativePlayerHp, 0, authoritativePlayerMaxHp),
                        maxHp: authoritativePlayerMaxHp,
                    }
                })
            }

            if (effectLogs.length > 0) {
                logLines.push(...effectLogs)
            }

            setBattlePartyHpState(nextPartyState)

            const nextPlayerHp = clampValue(
                Number(nextPartyState?.[resolvedActiveIndex]?.currentHp) || 0,
                0,
                Number(nextPartyState?.[resolvedActiveIndex]?.maxHp) || activeMaxHp
            )
            if (nextPlayerHp <= 0) {
                logLines.push(`${activeName} đã bại trận.`)

                const switchedIndex = getNextAlivePartyIndex(party, nextPartyState, resolvedActiveIndex)
                if (switchedIndex !== -1) {
                    const switchedPokemon = party[switchedIndex]
                    setBattlePlayerIndex(switchedIndex)
                    switchedAfterDefeat = true
                    logLines.push(`${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} vào sân thay thế.`)
                    setActionMessage(`${activeName} bại trận. ${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} vào sân.`)
                }
            }
            if (nextHp <= 0) {
                logLines.push(`${target.name || 'Đối thủ'} đã bại trận.`)
            }
            appendBattleLog(logLines)

            if (switchedAfterDefeat) {
                return
            }

            if (nextPlayerHp <= 0) {
                if (activeBattleMode === 'duel') {
                    const defeatedTargetName = target?.name || battleOpponent?.trainerName || 'Đối thủ BXH'
                    setActionMessage('Pokemon của bạn đã bại trận.')
                    showRankedDuelResultModal({
                        resultType: 'defeat',
                        title: 'Thua Khiêu Chiến BXH',
                        message: `Bạn đã thua trước ${defeatedTargetName}.`,
                    })
                    return
                }
                setActionMessage('Pokemon của bạn đã bại trận. Trận đấu kết thúc.')
                setBattleResults({
                    resultType: 'defeat',
                    message: 'Pokemon của bạn đã bại trận. Trận đấu kết thúc.',
                    pokemon: {
                        name: activeName,
                        imageUrl: activeResultImage,
                        level: activePokemon?.level || 1,
                        exp: activePokemon?.experience || 0,
                        expToNext: Math.max(1, Number(activePokemon?.level || 1) * 100),
                        levelsGained: 0,
                        happinessGained: 0,
                    },
                    rewards: {
                        coins: 0,
                        trainerExp: 0,
                        moonPoints: 0,
                        prizePokemon: null,
                        prizeItem: null,
                    },
                    evolution: {
                        evolved: false,
                        chain: [],
                    },
                })
                return
            }

            if (defeatedAll) {
                if (activeBattleMode === 'duel') {
                    const defeatedTargetName = target?.name || battleOpponent?.trainerName || 'Đối thủ BXH'
                    setActionMessage('Bạn đã chiến thắng trận khiêu chiến BXH.')
                    showRankedDuelResultModal({
                        resultType: 'win',
                        title: 'Thắng Khiêu Chiến BXH',
                        message: `Bạn đã đánh bại ${defeatedTargetName}.`,
                    })
                    return
                }
                setActionMessage('Bạn đã đánh bại toàn bộ đội hình đối thủ.')
                try {
                    const resResolve = await gameApi.resolveBattle(
                        nextBattleState?.team || battleOpponent.team,
                        currentBattleState?.trainerId || null
                    )
                    setBattleResults(resResolve.results)
                    const entry = buildCompletedEntryFromBattle(currentBattleState)
                    if (entry) {
                        try {
                            const completedTrainerIds = await markTrainerCompleted(entry.id)
                            if (completedTrainerIds) {
                                setCompletedCarouselIndex(0)
                                setCompletedEntries((prev) => {
                                    if (prev.some((item) => String(item.id) === String(entry.id))) return prev
                                    return [entry, ...prev]
                                })
                            }
                        } catch (saveProgressError) {
                            console.error('Lưu tiến trình huấn luyện viên hoàn thành thất bại', saveProgressError)
                        }
                    }

                    if (masterPokemon.length > 0) {
                        const nextOrder = advanceTrainerOrder(currentBattleState?.trainerOrder || 0, masterPokemon.length)
                        const nextTrainer = masterPokemon[nextOrder] || null
                        setOpponent(buildOpponent(null, nextTrainer, nextOrder))
                    }
                } catch (err) {
                    setActionMessage(err.message)
                }
            } else if (nextName) {
                setActionMessage(`${defeatedName} bại trận. ${nextName} tham chiến.`)
            } else {
                setActionMessage(`${moveName} gây ${damage} sát thương.`)
            }
        } catch (err) {
            setActionMessage(err.message)
            if (String(err?.message || '').toLowerCase().includes('bại trận')) {
                if (activeBattleMode === 'duel') {
                    showRankedDuelResultModal({
                        resultType: 'defeat',
                        title: 'Thua Khiêu Chiến BXH',
                        message: err.message || 'Pokemon của bạn đã bại trận.',
                    })
                    return
                }
                setBattleResults((prev) => prev || {
                    resultType: 'defeat',
                    message: err.message,
                    pokemon: {
                        name: activeName,
                        imageUrl: activeResultImage,
                        level: activePokemon?.level || 1,
                        exp: activePokemon?.experience || 0,
                        expToNext: Math.max(1, Number(activePokemon?.level || 1) * 100),
                        levelsGained: 0,
                        happinessGained: 0,
                    },
                    rewards: {
                        coins: 0,
                        trainerExp: 0,
                        moonPoints: 0,
                        prizePokemon: null,
                        prizeItem: null,
                    },
                    evolution: {
                        evolved: false,
                        chain: [],
                    },
                })
            }
        } finally {
            setIsAttacking(false)
        }
    }

    const handleUseItem = async (entry) => {
        if (!entry?.item?._id) return
        if (entry.item?.type !== 'healing') {
            const message = 'Trong battle này chỉ dùng được vật phẩm hồi phục.'
            setActionMessage(message)
            appendBattleLog([message])
            return
        }
        try {
            const activeSlot = party[battlePlayerIndex] || party.find((slot) => Boolean(slot)) || null
            const res = await gameApi.useItem(entry.item._id, 1, null, activeSlot?._id || null)
            setActionMessage(res.message || 'Đã dùng vật phẩm.')
            appendBattleLog([res.message || 'Đã dùng vật phẩm.'])

            if (res?.effect?.type === 'healing' && Number(res?.effect?.healedHp) > 0 && res?.effect?.hpContext === 'battle') {
                setBattlePartyHpState((prev) => {
                    const next = Array.isArray(prev) ? [...prev] : []
                    const resolvedIndex = Number.isInteger(battlePlayerIndex) ? battlePlayerIndex : 0
                    const entryState = next[resolvedIndex] || { currentHp: 0, maxHp: 1 }
                    next[resolvedIndex] = {
                        currentHp: Math.max(0, Number(res.effect.hp || entryState.currentHp || 0)),
                        maxHp: Math.max(1, Number(res.effect.maxHp || entryState.maxHp || 1)),
                    }
                    return next
                })
            }

            const inventoryData = await gameApi.getInventory()
            setInventory(inventoryData?.inventory || [])
            const refreshedParty = await gameApi.getParty()
            setParty(refreshedParty)
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const handleRun = async () => {
        if (activeBattleMode === 'duel') {
            navigateBackToRankingsAfterDuel()
            return
        }
        if (!encounter?._id) {
            setActionMessage('Bạn đã thoát.')
            appendBattleLog(['Bạn đã thoát.'])
            setView('lobby')
            return
        }
        try {
            const res = await gameApi.runEncounter(encounter._id)
            setActionMessage(res.message || 'Bạn đã thoát.')
            appendBattleLog([res.message || 'Bạn đã thoát.'])
            setView('lobby')
            setEncounter(null)
            setBattlePartyHpState([])
            setBattlePlayerIndex(0)
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const clampValue = (value, min, max) => Math.max(min, Math.min(max, value))

    const resolveBattleStats = (pokemonStats = {}, formStats = {}) => {
        const baseHp = Number(formStats?.hp) || Number(pokemonStats?.hp) || 1
        const baseAtk = Number(formStats?.atk) || Number(pokemonStats?.atk) || 1
        const baseDef = Number(formStats?.def) || Number(pokemonStats?.def) || 1
        const baseSpAtk = Number(formStats?.spatk) || Number(pokemonStats?.spatk) || 1
        const baseSpDef = Number(formStats?.spdef) || Number(formStats?.spldef) || Number(pokemonStats?.spdef) || Number(pokemonStats?.spldef) || 1
        const baseSpd = Number(formStats?.spd) || Number(pokemonStats?.spd) || 1

        return {
            hp: Math.max(1, Math.floor(baseHp)),
            atk: Math.max(1, Math.floor(baseAtk)),
            def: Math.max(1, Math.floor(baseDef)),
            spatk: Math.max(1, Math.floor(baseSpAtk)),
            spdef: Math.max(1, Math.floor(baseSpDef)),
            spd: Math.max(1, Math.floor(baseSpd)),
        }
    }

    const resolveTrainerTeamEntry = (entry = {}) => {
        const poke = entry.pokemonId || entry.pokemon || null
        const normalizedFormId = String(entry?.formId || poke?.defaultFormId || 'normal').trim() || 'normal'
        const forms = Array.isArray(poke?.forms) ? poke.forms : []
        const form = forms.find((candidate) => String(candidate?.formId || '').trim() === normalizedFormId) || null
        const resolvedStats = resolveBattleStats(poke?.baseStats || {}, form?.stats || {})
        const resolvedSprite = form?.imageUrl || form?.sprites?.normal || form?.sprites?.icon || getPokemonSprite(poke)

        return {
            poke,
            formId: normalizedFormId,
            formName: form?.formName || normalizedFormId,
            baseStats: resolvedStats,
            sprite: resolvedSprite,
        }
    }

    const getPokemonSprite = (pokemon) => {
        if (!pokemon) return ''
        return pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.front_default || ''
    }

    const pickRandom = (list, count) => {
        if (!Array.isArray(list) || list.length === 0) return []
        const picked = []
        const used = new Set()
        while (picked.length < Math.min(count, list.length)) {
            const index = Math.floor(Math.random() * list.length)
            if (used.has(index)) continue
            used.add(index)
            picked.push(list[index])
        }
        return picked
    }

    const buildOpponent = (currentEncounter, trainer = null, trainerOrder = 0) => {

        const team = (trainer?.team || []).map((entry) => {
            const resolvedEntry = resolveTrainerTeamEntry(entry)
            const poke = resolvedEntry.poke
            const baseStats = resolvedEntry.baseStats
            const hp = Math.max(1, (baseStats.hp || 1) + ((entry.level || 1) - 1))
            return {
                id: poke?._id || entry.pokemonId,
                name: poke?.name || 'Pokemon',
                level: entry.level || 1,
                sprite: resolvedEntry.sprite,
                formId: resolvedEntry.formId,
                formName: resolvedEntry.formName,
                baseStats,
                pokemon: poke,
                currentHp: hp,
                maxHp: hp,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
            }
        })

        return {
            trainerId: trainer?._id || null,
            trainerOrder,
            trainerName: trainer?.name || 'Trainer',
            trainerImage: trainer?.imageUrl || '/assets/08_trainer_female.png',
            trainerQuote: trainer?.quote || 'Good luck!',
            trainerPrize: trainer?.prizePokemonId?.name || 'Không có',
            trainerPrizeItem: trainer?.prizeItemId?.name || 'Không có',
            trainerPrizeItemQuantity: Math.max(1, Number(trainer?.prizeItemQuantity) || 1),
            trainerCoinsReward: Math.max(0, Number(trainer?.platinumCoinsReward) || 0),
            trainerExpReward: Math.max(0, Number(trainer?.expReward) || 0),
            trainerMoonPointsReward: Math.max(0, Number(trainer?.moonPointsReward) || 0),
            currentIndex: 0,
            level: currentEncounter?.level || 1,
            hp: currentEncounter?.hp || 1,
            maxHp: currentEncounter?.maxHp || 1,
            pokemon: currentEncounter?.pokemon || null,
            team,
            fieldState: {},
        }
    }

    const buildCompletedEntryFromBattle = (battleData) => {
        if (!battleData) return null
        const team = (battleData.team || []).map((poke, index) => ({
            id: poke.id || `${battleData.trainerId || battleData.trainerName || 'trainer'}-${index}`,
            name: poke.name || 'Pokemon',
            level: poke.level || 1,
            sprite: poke.sprite || '',
        }))
        return {
            id: battleData.trainerId || battleData.trainerName || `trainer-${Date.now()}`,
            name: battleData.trainerName || 'Trainer',
            image: battleData.trainerImage || '/assets/08_trainer_female.png',
            quote: battleData.trainerQuote || '',
            team,
            prize: battleData.trainerPrize || 'Không có',
        }
    }

    const buildCompletedEntries = (trainerList) => {
        return trainerList.map((trainer) => {
            const team = (trainer.team || []).map((entry) => {
                const resolvedEntry = resolveTrainerTeamEntry(entry)
                const poke = resolvedEntry.poke
                return {
                    id: poke?._id || entry.pokemonId,
                    name: poke?.name || 'Pokemon',
                    level: entry.level || 1,
                    sprite: resolvedEntry.sprite,
                }
            })
            return {
                id: trainer._id,
                name: trainer.name,
                image: trainer.imageUrl || '/assets/08_trainer_female.png',
                quote: trainer.quote || '',
                team,
                prize: trainer.prizePokemonId?.name || 'Không có',
            }
        })
    }

    const startBattleWithOpponent = (candidateOpponent = null) => {
        const fallbackSelection = getTrainerByOrder(masterPokemon)
        const nextOpponent = candidateOpponent || opponent || buildOpponent(null, fallbackSelection.trainer, fallbackSelection.trainerOrder)

        if (!nextOpponent?.team?.length) {
            setActionMessage('Không có đội hình huấn luyện viên để chiến đấu.')
            return
        }

        setBattleResults(null)
        setBattleLog([])
        setActionMessage('')
        setSelectedMoveIndex(0)
        setActiveTab('fight')
        setActiveBattleMode('trainer')
        setDuelOpponentMoves([])
        setDuelOpponentMoveCursor(0)
        setDuelResultModal(null)
        setBattleOpponent(nextOpponent)
        setParty((prevParty) => (Array.isArray(prevParty) ? prevParty.map((slot) => {
            if (!slot) return slot
            return {
                ...slot,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
            }
        }) : prevParty))
        const initialPartyState = buildBattlePartyState(party)
        setBattlePartyHpState(initialPartyState)
        const initialIndex = getNextAlivePartyIndex(party, initialPartyState, -1)
        setBattlePlayerIndex(Math.max(0, initialIndex))
        setView('battle')
    }

    const startRankedPokemonDuel = async (targetPokemonId) => {
        const normalizedTargetId = String(targetPokemonId || '').trim()
        if (!normalizedTargetId) {
            setActionMessage('Thiếu Pokemon mục tiêu để khiêu chiến.')
            return
        }

        const attackerCandidate = partyCandidates[0]
            || null
        if (!attackerCandidate) {
            setActionMessage('Bạn chưa có Pokemon trong đội hình để khiêu chiến.')
            return
        }

        const attackerSlot = party[attackerCandidate.index] || null
        if (!attackerSlot) {
            setActionMessage('Không tìm thấy Pokemon của bạn trong đội hình hiện tại.')
            return
        }

        try {
            const targetPokemon = await gameApi.getPokemonDetail(normalizedTargetId)
            const targetSpecies = targetPokemon?.pokemonId || {}
            const targetLevel = Math.max(1, Number(targetPokemon?.level) || 1)
            const targetStats = targetPokemon?.stats || {}
            const targetMaxHp = Math.max(1, Number(targetStats?.maxHp || targetStats?.hp) || 1)

            const targetMoves = Array.isArray(targetPokemon?.moveDetails) && targetPokemon.moveDetails.length > 0
                ? targetPokemon.moveDetails
                : mergeBattleMoveNames(targetPokemon?.moves || [], targetSpecies, targetLevel)
            const defenderMoves = normalizeMoveList(
                (Array.isArray(targetMoves) ? targetMoves : []).map((entry) => {
                    const maxPp = Number(entry?.maxPp ?? entry?.pp)
                    const resolvedMaxPp = Number.isFinite(maxPp) && maxPp > 0 ? Math.floor(maxPp) : 10
                    return {
                        ...(entry || {}),
                        maxPp: resolvedMaxPp,
                        currentPp: resolvedMaxPp,
                    }
                })
            ).map((entry, index) => ({
                ...entry,
                id: `ranked-op-${index}-${entry.name}`,
            }))

            const duelOpponent = {
                trainerId: null,
                trainerOrder: 0,
                trainerName: `BXH: ${getBattlePokemonDisplayName(targetPokemon)}`,
                trainerImage: resolvePokemonSprite({
                    species: targetSpecies,
                    formId: targetPokemon?.formId,
                    isShiny: Boolean(targetPokemon?.isShiny),
                }),
                trainerQuote: 'Auto chọn kỹ năng thông minh',
                trainerPrize: 'Không có',
                trainerPrizeItem: 'Không có',
                trainerPrizeItemQuantity: 1,
                trainerCoinsReward: 0,
                trainerExpReward: 0,
                trainerMoonPointsReward: 0,
                currentIndex: 0,
                level: targetLevel,
                hp: targetMaxHp,
                maxHp: targetMaxHp,
                pokemon: targetSpecies,
                team: [{
                    id: targetPokemon?._id || normalizedTargetId,
                    name: getBattlePokemonDisplayName(targetPokemon),
                    level: targetLevel,
                    sprite: resolvePokemonSprite({
                        species: targetSpecies,
                        formId: targetPokemon?.formId,
                        isShiny: Boolean(targetPokemon?.isShiny),
                    }),
                    baseStats: targetStats,
                    types: Array.isArray(targetSpecies?.types) ? targetSpecies.types : [],
                    currentHp: targetMaxHp,
                    maxHp: targetMaxHp,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                }],
                fieldState: {},
            }

            setParty((prevParty) => (Array.isArray(prevParty) ? prevParty.map((slot, index) => {
                if (!slot || index !== attackerCandidate.index) return slot
                return {
                    ...slot,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                }
            }) : prevParty))

            const initialPartyState = buildBattlePartyState(party).map((entry, index) => {
                if (!entry) return entry
                if (index !== attackerCandidate.index) {
                    return {
                        ...entry,
                        currentHp: 0,
                    }
                }
                return entry
            })

            setBattleResults(null)
            setBattleLog([])
            setActionMessage(`Bạn khiêu chiến ${getBattlePokemonDisplayName(targetPokemon)} từ BXH.`)
            setSelectedMoveIndex(0)
            setActiveTab('fight')
            setActiveBattleMode('duel')
            setDuelResultModal(null)
            setOpponent(duelOpponent)
            setBattleOpponent(duelOpponent)
            setBattlePlayerIndex(attackerCandidate.index)
            setBattlePartyHpState(initialPartyState)
            setDuelOpponentMoves(defenderMoves)
            setDuelOpponentMoveCursor(0)
            setView('battle')
        } catch (error) {
            setActionMessage(error?.message || 'Không thể bắt đầu trận khiêu chiến từ BXH.')
        }
    }

    const handleRematchTrainer = (entry) => {
        const normalizedId = String(entry?.id || '').trim()
        if (!normalizedId) return

        const trainerOrder = masterPokemon.findIndex(
            (trainer) => String(trainer?._id || '').trim() === normalizedId
        )
        if (trainerOrder === -1) {
            setActionMessage('Không tìm thấy dữ liệu huấn luyện viên để đấu lại.')
            return
        }

        const trainer = masterPokemon[trainerOrder]
        const rematchOpponent = buildOpponent(null, trainer, trainerOrder)
        setOpponent(rematchOpponent)
        startBattleWithOpponent(rematchOpponent)
    }

    if (isRankedChallengeRequested && (loading || isStartingRankedDuel || activeBattleMode !== 'duel')) {
        return (
            <div className="max-w-4xl mx-auto py-12">
                <div className="text-center text-slate-500 font-bold animate-pulse">
                    Đang vào trận khiêu chiến Pokemon từ BXH...
                </div>
            </div>
        )
    }

    if (view === 'battle') {
        return (
            <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">
                <div className="text-center space-y-2">
                    <div className="text-slate-600 font-bold text-sm">
                        🪙 {playerState?.platinumCoins ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
                    </div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                        {activeBattleMode === 'duel' ? 'Chế độ: Khiêu chiến BXH' : 'Chế độ: Battle Trainer'}
                    </div>
                </div>

                <ActiveBattleView
                    party={party}
                    encounter={encounter}
                    playerState={playerState}
                    opponent={battleOpponent || opponent}
                    onAttack={handleAttack}
                    actionMessage={actionMessage}
                    activeTab={activeTab}
                    onSelectTab={setActiveTab}
                    inventory={inventory}
                    onUseItem={handleUseItem}
                    onRun={handleRun}
                    selectedMoveIndex={selectedMoveIndex}
                    onSelectMove={setSelectedMoveIndex}
                    battleLog={battleLog}
                    isAttacking={isAttacking}
                    activePartyIndex={battlePlayerIndex}
                    partyHpState={battlePartyHpState}
                />
                {activeBattleMode === 'duel' && duelResultModal && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[440px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">
                                {duelResultModal.title}
                            </div>
                            <div className="p-4 text-center space-y-2">
                                <div className={`text-base font-bold ${duelResultModal.resultType === 'win' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {duelResultModal.resultType === 'win' ? 'Chiến thắng!' : 'Thất bại!'}
                                </div>
                                <div className="text-sm text-slate-700">{duelResultModal.message}</div>
                            </div>
                            <div className="border-t border-slate-200 p-3 text-center">
                                <button
                                    onClick={closeRankedDuelResultModal}
                                    className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm"
                                >
                                    Quay về BXH Pokémon
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {battleResults && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[520px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">
                                {battleResults?.resultType === 'defeat' ? 'Kết Thúc Trận Đấu' : 'Kết Quả Trận Đấu'}
                            </div>
                            <div className="p-4 text-center text-xs">
                                <div className="mb-2">
                                    {battleResults?.resultType === 'defeat'
                                        ? (battleResults?.message || 'Pokemon của bạn đã bại trận.')
                                        : 'Trận đấu đã kết thúc thành công!'}
                                </div>
                                {battleResults?.resultType === 'defeat' ? (
                                    <div className="border border-rose-200 bg-rose-50 rounded p-3 flex items-center gap-3 justify-center">
                                        {battleResults.pokemon?.imageUrl ? (
                                            <img
                                                src={battleResults.pokemon.imageUrl}
                                                alt={battleResults.pokemon.name}
                                                className="w-10 h-10 object-contain pixelated bg-white rounded border border-rose-200"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 bg-white rounded border border-rose-200" />
                                        )}
                                        <div className="text-left">
                                            <div className="font-bold text-sm text-rose-700">{battleResults.pokemon?.name || 'Pokemon'}</div>
                                            <div className="text-rose-600">Đã kiệt sức</div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {Array.isArray(battleResults.pokemonRewards) && battleResults.pokemonRewards.length > 0 ? (
                                            <div className="space-y-2">
                                                {battleResults.pokemonRewards.map((reward, index) => (
                                                    <div
                                                        key={`${reward.userPokemonId || reward.name || 'pokemon'}-${index}`}
                                                        className="border border-slate-200 rounded p-3 flex items-center gap-3 justify-center"
                                                    >
                                                        {reward.imageUrl ? (
                                                            <img
                                                                src={reward.imageUrl}
                                                                alt={reward.name}
                                                                className="w-10 h-10 object-contain pixelated bg-slate-100 rounded border border-slate-200"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200" />
                                                        )}
                                                        <div className="text-left">
                                                            <div className="font-bold text-sm">{reward.name}</div>
                                                            <div>Hạ gục: {reward.defeatedCount || 0} Pokemon</div>
                                                            <div>+{reward.levelsGained || 0} cấp</div>
                                                            <div>+{reward.happinessGained || 0} Hạnh phúc</div>
                                                            <div className="text-slate-500">
                                                                EXP: {reward.exp}/{reward.expToNext} (+{reward.finalExp || 0})
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="border border-slate-200 rounded p-3 flex items-center gap-3 justify-center">
                                                {battleResults.pokemon?.imageUrl ? (
                                                    <img
                                                        src={battleResults.pokemon.imageUrl}
                                                        alt={battleResults.pokemon.name}
                                                        className="w-10 h-10 object-contain pixelated bg-slate-100 rounded border border-slate-200"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200" />
                                                )}
                                                <div className="text-left">
                                                    <div className="font-bold text-sm">{battleResults.pokemon.name}</div>
                                                    <div>+{battleResults.pokemon.levelsGained} cấp</div>
                                                    <div>+{battleResults.pokemon.happinessGained} Hạnh phúc</div>
                                                    <div className="text-slate-500">EXP: {battleResults.pokemon.exp}/{battleResults.pokemon.expToNext}</div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="mt-3 text-sm font-bold text-slate-700">+{battleResults.rewards.coins} Xu</div>
                                        <div className="text-xs text-slate-500">+{battleResults.rewards.trainerExp} EXP Huấn luyện viên</div>
                                        <div className="text-xs text-slate-500">+{battleResults.rewards.moonPoints || 0} Điểm Nguyệt Các</div>
                                        {battleResults.rewards?.prizeItem?.name && (
                                            <div className="text-xs text-blue-600 mt-1">
                                                + Vật phẩm: {battleResults.rewards.prizeItem.name} x{battleResults.rewards.prizeItem.quantity || 1}
                                            </div>
                                        )}
                                        {battleResults.rewards?.prizePokemon?.claimed && (
                                            <div className="text-xs text-emerald-600 mt-1">
                                                + Phần thưởng: {battleResults.rewards.prizePokemon.name}
                                            </div>
                                        )}
                                        {battleResults.rewards?.prizePokemon?.alreadyClaimed && (
                                            <div className="text-xs text-slate-500 mt-1">
                                                {battleResults.rewards.prizePokemon.blockedReason === 'trainer_completed'
                                                    ? `Đã hoàn thành trainer này trước đó, không nhận lại Pokémon thưởng (${battleResults.rewards.prizePokemon.name}).`
                                                    : `Phần thưởng đã nhận: ${battleResults.rewards.prizePokemon.name}`}
                                            </div>
                                        )}
                                        {battleResults.evolution?.evolved && Array.isArray(battleResults.evolution.chain) && battleResults.evolution.chain.length > 0 && (
                                            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-left">
                                                <div className="text-[11px] font-bold text-emerald-700">Tiến hóa</div>
                                                {battleResults.evolution.chain.map((step, index) => (
                                                    <div key={`${step.fromPokemonId || step.from}-${step.toPokemonId || step.to}-${index}`} className="text-[11px] text-emerald-800">
                                                        {step.from} {'->'} {step.to} (Lv. {step.level})
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="border-t border-slate-200 p-3 text-center">
                                <button
                                    onClick={() => {
                                        setBattleResults(null)
                                        setView('lobby')
                                        setBattleLog([])
                                        setActionMessage('')
                                        setSelectedMoveIndex(0)
                                        setActiveTab('fight')
                                        setBattlePlayerIndex(0)
                                        setBattlePartyHpState([])
                                        loadData()
                                    }}
                                    className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm"
                                >
                                    {battleResults?.resultType === 'defeat' ? 'Quay lại' : 'Chiến đấu'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">

            <div className="text-center space-y-2">
                <div className="text-slate-600 font-bold text-sm">
                    🪙 {playerState?.platinumCoins ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
                </div>
                <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm uppercase tracking-wide">
                    Khu Vực Chiến Đấu
                </h1>
            </div>

            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Trận Chiến Hiện Tại" />
                <div className="p-6 bg-white flex flex-col items-center text-center">
                    {opponent && (
                        <div className="mb-3 flex flex-col items-center">
                            <img
                                src={opponent.trainerImage}
                                alt={opponent.trainerName}
                                className="w-24 h-24 object-contain pixelated"
                            />
                            <div className="mt-2">
                                <span className="font-bold text-slate-800">Huấn luyện viên {opponent.trainerName}:</span>
                                <span className="text-slate-600 italic ml-1">"{opponent.trainerQuote}"</span>
                            </div>
                        </div>
                    )}

                    {opponent?.team?.length ? (
                        <button
                            onClick={() => startBattleWithOpponent()}
                            className="text-3xl font-extrabold text-blue-800 hover:text-blue-600 hover:scale-105 transition-transform drop-shadow-sm my-2"
                        >
                            Chiến đấu!
                        </button>
                    ) : (
                        <div className="text-slate-500 text-sm">Không có đội hình huấn luyện viên để chiến đấu.</div>
                    )}

                    <div className="w-full mt-4 border-t border-blue-100"></div>

                    <div className="w-full bg-blue-50/50 py-2 border-b border-blue-100">
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Đội Hình Pokémon</div>
                        <div className="flex justify-center gap-8">
                            {(opponent?.team || []).map((poke) => (
                                <div key={poke.id} className="flex flex-col items-center">
                                    {poke.sprite ? (
                                        <img
                                            src={poke.sprite}
                                            className="w-10 h-10 pixelated"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded" />
                                    )}
                                    <span className="text-[10px] font-bold text-slate-700">L. {poke.level}</span>
                                    {poke.formId && poke.formId !== 'normal' && (
                                        <span className="text-[9px] text-slate-500">{poke.formName || poke.formId}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="w-full py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Phần Thưởng</div>
                        {opponent?.team?.length ? (
                            <div className="mt-1 space-y-0.5 text-sm font-bold text-slate-700">
                                <div>Pokémon: {opponent?.trainerPrize || 'Không có'}</div>
                                <div>Item: {opponent?.trainerPrizeItem && opponent?.trainerPrizeItem !== 'Không có' ? `${opponent.trainerPrizeItem} x${opponent?.trainerPrizeItemQuantity || 1}` : 'Không có'}</div>
                                <div>
                                    Xu Bạch Kim: {opponent?.trainerCoinsReward > 0
                                        ? `+${opponent.trainerCoinsReward}`
                                        : 'Theo cấp đội hình'}
                                </div>
                                <div>
                                    EXP huấn luyện viên: {opponent?.trainerExpReward > 0
                                        ? `+${opponent.trainerExpReward}`
                                        : 'Theo cấp đội hình'}
                                </div>
                                <div>
                                    Điểm Nguyệt Các: {opponent?.trainerMoonPointsReward > 0
                                        ? `+${opponent.trainerMoonPointsReward}`
                                        : 'Theo cấp đội hình'}
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm font-bold text-slate-400 mt-1">Không có</div>
                        )}
                    </div>
                </div>
            </div>

            {completedEntries.length > 0 && (
                <>
                    <div className="rounded border border-blue-400 bg-white shadow-sm overflow-visible">
                        <SectionHeader title="Đã Hoàn Thành" />
                        <div className="p-4 sm:p-6 bg-white relative">
                            <div className="flex items-center justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHoveredCompletedId(null)
                                        setCompletedCarouselIndex((prev) => Math.max(0, prev - 1))
                                    }}
                                    disabled={completedCarouselIndex === 0}
                                    className="w-9 h-9 shrink-0 border border-blue-200 rounded bg-white text-blue-700 font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Trang trước"
                                >
                                    {'<'}
                                </button>

                                <div className="w-full max-w-[760px] overflow-hidden">
                                    <div
                                        className="flex transition-transform duration-500 ease-out"
                                        style={{ transform: `translateX(-${completedCarouselIndex * 100}%)` }}
                                    >
                                        {completedSlides.map((slideEntries, slideIndex) => (
                                            <div
                                                key={`completed-slide-${slideIndex}`}
                                                className="w-full shrink-0 flex flex-wrap justify-center gap-4 sm:gap-6 relative min-h-20"
                                            >
                                                {slideEntries.map((entry) => (
                                                    <div
                                                        key={entry.id}
                                                        className="relative z-0 shrink-0 cursor-pointer transition-transform hover:z-40 hover:scale-105"
                                                        onMouseEnter={() => setHoveredCompletedId(entry.id)}
                                                        onMouseLeave={() => setHoveredCompletedId(null)}
                                                        onClick={() => handleRematchTrainer(entry)}
                                                        title={`Đấu lại với ${entry.name}`}
                                                    >
                                                        <img
                                                            src={entry.image}
                                                            className="w-20 h-20 object-contain pixelated"
                                                        />
                                                        {hoveredCompletedId === entry.id && (
                                                            <div className="absolute left-1/2 bottom-full mb-3 w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 bg-white border border-slate-200 rounded shadow-lg p-3 text-xs z-50">
                                                                <div className="font-bold text-slate-700 mb-2">Thông tin</div>
                                                                <div className="flex gap-2 items-start">
                                                                    <img src={entry.image} className="w-12 h-12 object-contain pixelated" />
                                                                    <div>
                                                                        <div className="font-bold">Huấn luyện viên {entry.name}:</div>
                                                                        <div className="italic text-slate-600">"{entry.quote}"</div>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3 font-bold">Đội hình Pokémon</div>
                                                                <div className="flex gap-4 mt-2">
                                                                    {entry.team.map((poke) => (
                                                                        <div key={poke.id} className="flex flex-col items-center">
                                                                            {poke.sprite ? (
                                                                                <img src={poke.sprite} className="w-8 h-8 pixelated" />
                                                                            ) : (
                                                                                <div className="w-8 h-8 bg-slate-100 border border-slate-200 rounded" />
                                                                            )}
                                                                            <div className="text-[10px] font-bold">L. {poke.level}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="mt-3 font-bold">Phần thưởng Pokémon</div>
                                                                <div>{entry.prize}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setHoveredCompletedId(null)
                                        setCompletedCarouselIndex((prev) => Math.min(completedSlideCount - 1, prev + 1))
                                    }}
                                    disabled={completedCarouselIndex >= completedSlideCount - 1}
                                    className="w-9 h-9 shrink-0 border border-blue-200 rounded bg-white text-blue-700 font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Trang sau"
                                >
                                    {'>'}
                                </button>
                            </div>

                            {completedEntries.length > completedEntriesPerView && (
                                <div className="mt-3 text-center text-xs font-bold text-slate-500">
                                    Trang {completedCarouselIndex + 1}/{completedSlideCount}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded border border-blue-400 bg-blue-100/50 shadow-sm overflow-hidden text-center p-2">
                        <SectionHeader title="Đã Hoàn Thành - Chi Tiết" />
                        <p className="text-xs text-blue-800 mt-2 p-2">
                            Nhấn vào ảnh huấn luyện viên để đấu lại. Rê chuột để xem chi tiết đầy đủ.
                        </p>
                    </div>
                </>
            )}

        </div>
    )
}

export function ExplorePage() {
    return (
        <div className="space-y-3">
            <div className="text-lg font-semibold text-slate-100">Khám phá</div>
            <div className="rounded border border-slate-700 bg-slate-950/40 p-3 text-slate-300">
                <FeatureUnavailableNotice
                    title="Khám phá chưa cập nhật"
                    message="Bản đồ khám phá thời gian thực đang được hoàn thiện cho Phase 2."
                />
            </div>
        </div>
    )
}
