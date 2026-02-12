import { useState, useEffect } from 'react'
import { gameApi } from '../services/gameApi'

const TRAINER_ORDER_STORAGE_KEY = 'battle_trainer_order_index'

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
}) => {
    const activePokemon = party.find(p => p) || null

    const playerMon = activePokemon ? {
        name: activePokemon.nickname || activePokemon.pokemonId?.name || 'Unknown',
        level: activePokemon.level,
        maxHp: activePokemon.stats?.hp || 100,
        hp: activePokemon.stats?.hp || 100,
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
                        {inventory.length === 0 ? (
                            <div className="text-center text-slate-500">Không có vật phẩm.</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {inventory.map((entry) => (
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
                    <div className="p-3 text-center text-xs text-slate-500">Sắp ra mắt.</div>
                )}

                {activeTab === 'party' && (
                    <div className="p-3 text-center text-xs text-slate-500">Sắp ra mắt.</div>
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
    const [hoveredCompletedId, setHoveredCompletedId] = useState(null)
    const [activeTab, setActiveTab] = useState('fight')
    const [inventory, setInventory] = useState([])
    const [selectedMoveIndex, setSelectedMoveIndex] = useState(0)
    const [battleLog, setBattleLog] = useState([])
    const [isAttacking, setIsAttacking] = useState(false)

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

            const { trainer, trainerOrder } = getTrainerByOrder(trainerList)
            const builtOpponent = buildOpponent(encounterData?.encounter || null, trainer, trainerOrder)
            setOpponent(builtOpponent)
            setBattleOpponent(builtOpponent)

        } catch (error) {
            console.error('Failed to load data', error)
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

        const activePokemon = party.find((p) => p) || null
        const activeName = activePokemon?.nickname || activePokemon?.pokemonId?.name || 'Pokemon'

        setIsAttacking(true)
        try {
            const res = await gameApi.battleAttack({
                moveName: selectedMove?.name,
                move: selectedMove,
                opponent: {
                    level: target.level,
                    currentHp: target.currentHp ?? target.maxHp,
                    maxHp: target.maxHp,
                    baseStats: target.baseStats || {},
                },
            })

            const battle = res?.battle || {}
            const damage = Number.isFinite(battle.damage) ? battle.damage : 1
            const nextHp = Number.isFinite(battle.currentHp)
                ? Math.max(0, battle.currentHp)
                : Math.max(0, (target.currentHp ?? target.maxHp) - damage)
            const moveName = battle?.move?.name || selectedMove?.name || 'Attack'

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
            const teamForResolve = (currentBattleState?.team || []).map((member, index) => {
                if (index !== currentBattleIndex) return member
                return { ...member, currentHp: nextHp }
            })

            let nextBattleState = currentBattleState
            const activeEnemy = teamForResolve[currentBattleIndex]
            if (activeEnemy && activeEnemy.currentHp <= 0) {
                defeatedName = activeEnemy.name || 'Pokemon'
                const nextIndex = teamForResolve.findIndex((member, memberIndex) => {
                    if (memberIndex <= currentBattleIndex) return false
                    const hp = member.currentHp ?? member.maxHp ?? 0
                    return hp > 0
                })
                if (nextIndex !== -1) {
                    nextName = teamForResolve[nextIndex]?.name || 'Pokemon'
                    nextBattleState = { ...currentBattleState, team: teamForResolve, currentIndex: nextIndex }
                } else {
                    defeatedAll = true
                    nextBattleState = { ...currentBattleState, team: teamForResolve }
                }
            } else {
                nextBattleState = { ...currentBattleState, team: teamForResolve }
            }

            setBattleOpponent(nextBattleState)

            const logLines = [`${activeName} của bạn dùng ${moveName}! Gây ${damage} sát thương.`]
            if (nextHp <= 0) {
                logLines.push(`${target.name || 'Đối thủ'} đã bại trận.`)
            }
            appendBattleLog(logLines)

            if (defeatedAll) {
                setActionMessage('Bạn đã đánh bại toàn bộ đội hình đối thủ.')
                try {
                    const resResolve = await gameApi.resolveBattle(
                        teamForResolve || battleOpponent.team,
                        currentBattleState?.trainerId || null
                    )
                    setBattleResults(resResolve.results)
                    setCompletedEntries((prev) => {
                        const entry = buildCompletedEntryFromBattle(currentBattleState)
                        if (!entry) return prev
                        if (prev.some((item) => item.id === entry.id)) return prev
                        return [entry, ...prev]
                    })

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
        } finally {
            setIsAttacking(false)
        }
    }

    const handleUseItem = async (entry) => {
        if (!entry?.item?._id) return
        try {
            const res = await gameApi.useItem(entry.item._id, 1, encounter?._id || null)
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
        } catch (err) {
            setActionMessage(err.message)
        }
    }

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
            trainerImage: trainer?.imageUrl || '/assests/08_trainer_female.png',
            trainerQuote: trainer?.quote || 'Good luck!',
            trainerPrize: trainer?.prizePokemonId?.name || 'Không có',
            trainerCoinsReward: Math.max(0, Number(trainer?.platinumCoinsReward) || 0),
            trainerExpReward: Math.max(0, Number(trainer?.expReward) || 0),
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
            image: battleData.trainerImage || '/assests/08_trainer_female.png',
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
                image: trainer.imageUrl || '/assests/08_trainer_female.png',
                quote: trainer.quote || '',
                team,
                prize: trainer.prizePokemonId?.name || 'Không có',
            }
        })
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
                />
                {battleResults && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[520px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">Kết Quả Trận Đấu</div>
                            <div className="p-4 text-center text-xs">
                                <div className="mb-2">Trận đấu đã kết thúc thành công!</div>
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
                                <div className="mt-3 text-sm font-bold text-slate-700">+{battleResults.rewards.coins} Xu</div>
                                <div className="text-xs text-slate-500">+{battleResults.rewards.trainerExp} EXP Huấn luyện viên</div>
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
                                        loadData()
                                    }}
                                    className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm"
                                >
                                    Chiến đấu
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
                            onClick={() => {
                                setBattleResults(null)
                                setBattleLog([])
                                setActionMessage('')
                                setSelectedMoveIndex(0)
                                setActiveTab('fight')
                                const fallbackSelection = getTrainerByOrder(masterPokemon)
                                setBattleOpponent(opponent || buildOpponent(null, fallbackSelection.trainer, fallbackSelection.trainerOrder))
                                setView('battle')
                            }}
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
                        <div className="p-6 flex justify-center gap-6 bg-white relative">
                            {completedEntries.map((entry) => (
                                <div
                                    key={entry.id}
                                    className="relative"
                                    onMouseEnter={() => setHoveredCompletedId(entry.id)}
                                    onMouseLeave={() => setHoveredCompletedId(null)}
                                >
                                    <img
                                        src={entry.image}
                                        className="w-20 h-20 object-contain pixelated"
                                    />
                                    {hoveredCompletedId === entry.id && (
                                        <div className="absolute left-24 top-0 w-[320px] bg-white border border-slate-200 rounded shadow-lg p-3 text-xs z-20">
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
                    </div>

                    <div className="rounded border border-blue-400 bg-blue-100/50 shadow-sm overflow-hidden text-center p-2">
                        <SectionHeader title="Đã Hoàn Thành - Chi Tiết" />
                        <p className="text-xs text-blue-800 mt-2 p-2">
                            Nhấn Z khi rê chuột lên ảnh để xem chi tiết đầy đủ.
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
                Canvas khám phá sẽ mount vào đây (Phase 2).
            </div>
        </div>
    )
}







