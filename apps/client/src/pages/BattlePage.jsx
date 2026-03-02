import { useState, useEffect } from 'react'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'

const TRAINER_ORDER_STORAGE_KEY = 'battle_trainer_order_index'
const MOBILE_COMPLETED_ENTRIES_PER_VIEW = 4
const DESKTOP_COMPLETED_ENTRIES_PER_VIEW = 6

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

const inferMovePower = (name = '') => {
    const normalized = String(name || '').toLowerCase()
    if (!normalized) return 35
    if (normalized === 'struggle') return 35
    if (normalized.includes('quick')) return 70
    if (normalized.includes('tackle')) return 80
    if (normalized.includes('leaf')) return 90
    if (normalized.includes('power') || normalized.includes('beam')) return 110
    if (normalized.includes('blast')) return 120
    return 85
}

const inferMoveMp = (name = '') => {
    const normalized = String(name || '').toLowerCase()
    if (!normalized || normalized === 'struggle') return 0
    if (normalized.includes('power') || normalized.includes('blast')) return 12
    if (normalized.includes('leaf')) return 7
    if (normalized.includes('quick')) return 3
    return 6
}

const normalizeMoveList = (moves = []) => {
    const list = Array.isArray(moves) ? moves : []
    const mapped = list
        .map((entry, index) => {
            const name = typeof entry === 'string'
                ? entry
                : String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null
            const type = normalizeMoveType(name)
            return {
                id: `${name}-${index}`,
                name,
                type,
                power: inferMovePower(name),
                mp: inferMoveMp(name),
            }
        })
        .filter(Boolean)
    if (mapped.length > 0) return mapped.slice(0, 4)
    return [{
        id: 'struggle',
        name: 'Struggle',
        type: 'normal',
        power: 35,
        mp: 0,
    }]
}

const ProgressBar = ({ current, max, colorClass, label }) => {
    const safeMax = max > 0 ? max : 1
    const percent = Math.min(100, Math.max(0, (current / safeMax) * 100))
    return (
        <div className="w-full">
            <div className="flex justify-between text-[10px] font-bold px-1 mb-0.5">
                <span>{label}: {Math.round(percent)}%</span>
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
        maxMp: playerState?.maxMp || 0,
        mp: playerState?.mp || 0,
        exp: activePokemon.experience,
        maxExp: activePokemon.level * 100,
        sprite: activePokemon.pokemonId?.sprites?.back_default || activePokemon.pokemonId?.imageUrl || activePokemon.pokemonId?.sprites?.normal || activePokemon.pokemonId?.sprites?.front_default,
        moves: normalizeMoveList(activePokemon.moves || []),
    } : null

    const activeOpponent = opponent?.team?.[opponent.currentIndex || 0] || null
    const enemyMon = activeOpponent ? {
        name: activeOpponent.name || 'Pokemon Hoang Dã',
        owner: opponent?.trainerName || 'Hoang Dã',
        level: activeOpponent.level,
        maxHp: activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1,
        hp: activeOpponent.currentHp ?? (activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1),
        maxMp: activeOpponent.maxMp || 0,
        mp: activeOpponent.currentMp || 0,
        sprite: activeOpponent.sprite || '',
    } : {
        name: 'Pokemon Hoang Dã',
        owner: 'Hoang Dã',
        level: 1,
        maxHp: 1,
        hp: 1,
        maxMp: 0,
        mp: 0,
        sprite: '',
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

                    {playerMon && (
                        <div className="w-full grid grid-cols-2 gap-1 mb-2">
                            <ProgressBar current={playerMon.hp} max={playerMon.maxHp} colorClass="bg-green-500" label="HP" />
                            {playerMon.maxMp > 0 && (
                                <ProgressBar current={playerMon.mp} max={playerMon.maxMp} colorClass="bg-blue-500" label="MP" />
                            )}
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
                            {enemyMon.maxMp > 0 && (
                                <ProgressBar current={enemyMon.mp} max={enemyMon.maxMp} colorClass="bg-blue-500" label="MP" />
                            )}
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
                            return (
                                <button
                                    key={move.id}
                                    onClick={() => onSelectMove?.(idx)}
                                    className={`text-left p-1 border rounded flex justify-between items-center ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'}`}
                                >
                                    <div>
                                        <span className={`text-[9px] uppercase font-bold px-1 rounded mr-1 ${typeColors[move.type] || 'bg-slate-100'}`}>
                                            {move.type}
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">{move.name}</span>
                                        <div className="text-[10px] text-slate-500 mt-0.5">{move.mp} MP</div>
                                    </div>
                                    <div className="text-xs font-bold">{move.power}</div>
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
    const [maps, setMaps] = useState([])
    const [party, setParty] = useState([])
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState('lobby') // 'lobby' | 'battle'
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

    const completedSlides = []
    for (let index = 0; index < completedEntries.length; index += completedEntriesPerView) {
        completedSlides.push(completedEntries.slice(index, index + completedEntriesPerView))
    }
    if (completedSlides.length === 0) {
        completedSlides.push([])
    }
    const completedSlideCount = completedSlides.length

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

    const getTrainerByOrder = (trainers = []) => {
        if (!Array.isArray(trainers) || trainers.length === 0) {
            return { trainer: null, trainerOrder: 0 }
        }
        const trainerOrder = getStoredTrainerOrder() % trainers.length
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

    const loadData = async () => {
        try {
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

            const { trainer, trainerOrder } = getTrainerByOrder(trainerList)
            const builtOpponent = buildOpponent(encounterData?.encounter || null, trainer, trainerOrder)
            setOpponent(builtOpponent)
            setBattleOpponent(builtOpponent)
            setBattlePlayerIndex(0)
            setBattlePartyHpState([])

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

    const handleAttack = async (selectedMove) => {
        if (isAttacking || !battleOpponent?.team?.length) return

        const currentIndex = battleOpponent.currentIndex || 0
        const target = battleOpponent.team[currentIndex]
        if (!target) return

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
            const res = await gameApi.battleAttack({
                moveName: selectedMove?.name,
                move: selectedMove,
                trainerId: battleOpponent?.trainerId || null,
                activePokemonId: activePokemon?._id || null,
                opponent: {
                    level: target.level,
                    currentHp: target.currentHp ?? target.maxHp,
                    maxHp: target.maxHp,
                    baseStats: target.baseStats || {},
                },
                player: {
                    level: activePokemon?.level || 1,
                    currentHp: playerCurrentHpForTurn,
                    maxHp: activeMaxHp,
                    baseStats: activePokemon?.stats || activePokemon?.pokemonId?.baseStats || {},
                },
            })

            const battle = res?.battle || {}
            const damage = Number.isFinite(battle.damage) ? battle.damage : 1
            const nextHp = Number.isFinite(battle.currentHp)
                ? Math.max(0, battle.currentHp)
                : Math.max(0, (target.currentHp ?? target.maxHp) - damage)
            const moveName = battle?.move?.name || selectedMove?.name || 'Attack'
            const counterAttack = battle?.counterAttack || null

            if (battle?.player && Number.isFinite(battle.player.mp)) {
                setPlayerState((prev) => (prev
                    ? { ...prev, mp: battle.player.mp, maxMp: battle.player.maxMp ?? prev.maxMp }
                    : prev
                ))
            }

            let defeatedAll = false
            let defeatedName = ''
            let nextName = ''
            const currentBattleState = battleOpponent
            const currentBattleIndex = currentBattleState?.currentIndex || 0
            const localResolvedTeam = (currentBattleState?.team || []).map((member, index) => {
                if (index !== currentBattleIndex) return member
                return { ...member, currentHp: nextHp }
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

            setBattleOpponent(nextBattleState)

            const logLines = [`${activeName} của bạn dùng ${moveName}! Gây ${damage} sát thương.`]
            let nextPartyState = resolvedPartyState
            if (battle?.player && Number.isFinite(battle.player.currentHp)) {
                const authoritativeMaxHp = Math.max(1, Number(battle.player.maxHp) || activeMaxHp)
                nextPartyState = resolvedPartyState.map((entry, idx) => {
                    if (idx !== resolvedActiveIndex) return entry
                    return {
                        currentHp: clampValue(Number(battle.player.currentHp) || 0, 0, authoritativeMaxHp),
                        maxHp: authoritativeMaxHp,
                    }
                })
            }

            let switchedAfterDefeat = false
            if (counterAttack) {
                const counterDamage = Number.isFinite(counterAttack.damage) ? counterAttack.damage : 0
                const counterMoveName = counterAttack?.move?.name || 'Phản công'
                const nextPlayerHpFromCounter = Number.isFinite(counterAttack.currentHp)
                    ? Math.max(0, counterAttack.currentHp)
                    : Math.max(0, playerCurrentHpForTurn - counterDamage)
                if (!(battle?.player && Number.isFinite(battle.player.currentHp))) {
                    nextPartyState = resolvedPartyState.map((entry, idx) => {
                        if (idx !== resolvedActiveIndex) return entry
                        return {
                            currentHp: clampValue(nextPlayerHpFromCounter, 0, activeMaxHp),
                            maxHp: activeMaxHp,
                        }
                    })
                }
                logLines.push(`${target.name || 'Đối thủ'} dùng ${counterMoveName}! Gây ${counterDamage} sát thương.`)
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
                setActionMessage('Pokemon của bạn đã bại trận. Trận đấu kết thúc.')
                setBattleResults({
                    resultType: 'defeat',
                    message: 'Pokemon của bạn đã bại trận. Trận đấu kết thúc.',
                    pokemon: {
                        name: activeName,
                        imageUrl: activePokemon?.pokemonId?.imageUrl ||
                            activePokemon?.pokemonId?.sprites?.normal ||
                            activePokemon?.pokemonId?.sprites?.front_default ||
                            '',
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
                setBattleResults((prev) => prev || {
                    resultType: 'defeat',
                    message: err.message,
                    pokemon: {
                        name: activeName,
                        imageUrl: activePokemon?.pokemonId?.imageUrl ||
                            activePokemon?.pokemonId?.sprites?.normal ||
                            activePokemon?.pokemonId?.sprites?.front_default ||
                            '',
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
            const res = await gameApi.useItem(entry.item._id, 1, null)
            setActionMessage(res.message || 'Đã dùng vật phẩm.')
            appendBattleLog([res.message || 'Đã dùng vật phẩm.'])
            const inventoryData = await gameApi.getInventory()
            setInventory(inventoryData?.inventory || [])
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const handleRun = async () => {
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
                currentMp: 10,
                maxMp: 10,
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
        setBattleOpponent(nextOpponent)
        const initialPartyState = buildBattlePartyState(party)
        setBattlePartyHpState(initialPartyState)
        const initialIndex = getNextAlivePartyIndex(party, initialPartyState, -1)
        setBattlePlayerIndex(Math.max(0, initialIndex))
        setView('battle')
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

    if (view === 'battle') {
        return (
            <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">
                <div className="text-center space-y-2">
                    <div className="text-slate-600 font-bold text-sm">
                        🪙 {playerState?.gold ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
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
                                                Phần thưởng đã nhận: {battleResults.rewards.prizePokemon.name}
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
                    🪙 {playerState?.gold ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
                </div>
                <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm uppercase tracking-wide">
                    Khu Vực Chiến Đấu
                </h1>
            </div>

            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Cốt Truyện" />
                <div className="p-4 bg-slate-50 text-center">
                    <div className="inline-block font-bold text-slate-700 hover:text-blue-600 cursor-pointer">
                        [ Cốt Truyện Galactic ]
                    </div>
                </div>
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







