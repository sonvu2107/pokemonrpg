import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'

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
    normal: 'bg-slate-100 text-slate-800 border-slate-300',
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

const ActiveBattleView = ({ party, encounter, playerState, opponent, onAttack, actionMessage }) => {
    const [selectedMove, setSelectedMove] = useState(0) // Index of selected move

    // Find first alive pokemon (for now just first slot)
    const activePokemon = party.find(p => p) || null

    const playerMon = activePokemon ? {
        name: activePokemon.pokemonId?.name || 'Không rõ',
        level: activePokemon.level,
        maxHp: activePokemon.stats?.hp || 100,
        hp: activePokemon.stats?.hp || 100, // No current HP yet, assume full
        maxMp: playerState?.maxMp || 0,
        mp: playerState?.mp || 0,
        exp: activePokemon.experience,
        maxExp: activePokemon.level * 100, // Simple formula for now
        sprite: activePokemon.pokemonId?.sprites?.back_default || activePokemon.pokemonId?.imageUrl || activePokemon.pokemonId?.sprites?.normal || activePokemon.pokemonId?.sprites?.front_default,
        moves: activePokemon.moves || []
    } : null

    const activeOpponent = opponent?.team?.[opponent.currentIndex || 0] || null
    const enemyMon = activeOpponent ? {
        name: activeOpponent.name || 'Pokémon hoang dã',
        owner: opponent?.trainerName || 'Hoang dã',
        level: activeOpponent.level,
        maxHp: activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1,
        hp: activeOpponent.currentHp ?? (activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1),
        maxMp: activeOpponent.maxMp || 0,
        mp: activeOpponent.currentMp || 0,
        sprite: activeOpponent.sprite || '',
    } : {
        name: 'Pokémon hoang dã',
        owner: 'Hoang dã',
        level: 1,
        maxHp: 1,
        hp: 1,
        maxMp: 0,
        mp: 0,
        sprite: ''
    }

    // Map real moves to UI structure, or use placeholders if string only
    const moves = playerMon?.moves?.length > 0
        ? playerMon.moves.map((m, i) => ({
            id: i,
            name: typeof m === 'string' ? m : m.name,
            type: 'normal',
            mp: 5,
            power: 50,
            icon: '👊'
        }))
        : []

    return (
        <div className="space-y-4 animate-fadeIn">
            {/* Battle Arena */}
            <div className="grid grid-cols-2 gap-1 bg-white border border-slate-400 p-1 rounded">
                {/* Player Side */}
                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">
                        {playerMon ? `Của bạn: ${playerMon.name}` : 'Chưa có Pokémon trong đội'}
                    </h3>

                    {/* Bars */}
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

                {/* Enemy Side */}
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

            {/* Action Menu */}
            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-slate-300 text-xs font-bold bg-slate-50">
                    <button className="flex-1 py-1 px-2 text-green-700 border-b-2 border-green-500 bg-white">Chiến đấu</button>
                    <button className="flex-1 py-1 px-2 text-slate-500 hover:bg-slate-100">Vật phẩm</button>
                    <button className="flex-1 py-1 px-2 text-blue-700 hover:bg-slate-100">Tập trung</button>
                    <button className="flex-1 py-1 px-2 text-blue-700 hover:bg-slate-100">Đổi đội</button>
                    <button className="flex-1 py-1 px-2 text-red-700 hover:bg-slate-100">Bỏ chạy</button>
                </div>

                {/* Moves Grid */}
                {moves.length > 0 ? (
                    <div className="p-2 grid grid-cols-2 gap-2">
                        {moves.map((move, idx) => {
                            const isSelected = selectedMove === idx
                            return (
                                <button
                                    key={move.id}
                                    onClick={() => setSelectedMove(idx)}
                                    className={`text-left p-1 border rounded flex justify-between items-center ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'}`}
                                >
                                    <div>
                                        <span className={`text-[9px] uppercase font-bold px-1 rounded mr-1 ${typeColors[move.type] || 'bg-slate-100'}`}>
                                            {move.type}
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">{move.name}</span>
                                        <div className="text-[10px] text-slate-500 mt-0.5">{move.mp} MP</div>
                                    </div>
                                    <div className="text-xs font-bold">
                                        {move.type === 'grass' ? '🍃' : move.type === 'fire' ? '🔥' : move.type === 'water' ? '💧' : '👊'} {move.power}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <div className="p-3 text-center text-xs text-slate-500">Chưa có kỹ năng để hiển thị.</div>
                )}

                {/* Footer Action */}
                <div className="p-2 text-center border-t border-slate-200 bg-slate-50">
                    {moves.length > 0 ? (
                        <div className="text-xs text-slate-500 mb-2">Chọn kỹ năng hoặc hành động rồi nhấn nút bên dưới.</div>
                    ) : (
                        <div className="text-xs text-slate-500 mb-2">Chưa có kỹ năng. Bạn vẫn có thể tấn công cơ bản.</div>
                    )}
                    <button
                        onClick={() => onAttack?.(playerMon)}
                        disabled={!playerMon}
                        className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm text-sm flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                    >
                        <span className="text-lg">🍃</span> Tấn công
                    </button>
                    {actionMessage && (
                        <div className="mt-2 text-xs font-bold text-blue-700">{actionMessage}</div>
                    )}
                </div>
            </div>

            {!encounter && (
                <div className="border border-slate-400 bg-white rounded overflow-hidden">
                    <div className="p-3 text-center text-xs text-slate-500">
                        Chưa có trận chiến nào. Hãy vào bản đồ để gặp Pokemon.
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

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            const [allMaps, partyData, encounterData, profileData, trainerData] = await Promise.all([
                gameApi.getMaps(),
                gameApi.getParty(),
                gameApi.getActiveEncounter(),
                gameApi.getProfile(),
                gameApi.getBattleTrainers(),
            ])
            setMaps(allMaps)
            setParty(partyData)
            setEncounter(encounterData?.encounter || null)
            setPlayerState(profileData?.playerState || null)
            setMasterPokemon(trainerData?.trainers || [])
            if (!opponent) {
                const builtOpponent = buildOpponent(encounterData?.encounter || null, trainerData?.trainers || [])
                setOpponent(builtOpponent)
                setBattleOpponent(builtOpponent)
            }
            if ((profileData?.playerState?.wins || 0) > 0 && completedEntries.length === 0) {
                setCompletedEntries(buildCompletedEntries(trainerData?.trainers || []))
            }
        } catch (error) {
            console.error('Failed to load data', error)
        } finally {
            setLoading(false)
        }
    }

    const handleAttack = async () => {
        if (!battleOpponent?.team?.length) return
        let resolveBattle = false
        setBattleOpponent((prev) => {
            if (!prev) return prev
            const currentIndex = prev.currentIndex || 0
            const team = prev.team.map((member, idx) => {
                if (idx !== currentIndex) return member
                const baseHp = member.maxHp || member.baseStats?.hp || 1
                const currentHp = member.currentHp ?? baseHp
                const nextHp = Math.max(0, currentHp - 10)
                return {
                    ...member,
                    currentHp: nextHp,
                }
            })

            const active = team[currentIndex]
            if (active && active.currentHp === 0) {
                const nextIndex = Math.min(team.length - 1, currentIndex + 1)
                if (nextIndex !== currentIndex) {
                    setActionMessage(`Đã hạ ${active.name}. ${team[nextIndex]?.name || 'Đối thủ mới'} xuất hiện!`)
                    return { ...prev, team, currentIndex: nextIndex }
                }
                setActionMessage('Bạn đã đánh bại toàn bộ đội hình!')
                resolveBattle = true
                return { ...prev, team }
            }

            setActionMessage('Bạn tấn công và gây sát thương!')
            return { ...prev, team }
        })
        if (resolveBattle) {
            try {
                const res = await gameApi.resolveBattle(battleOpponent.team)
                setBattleResults(res.results)
            } catch (err) {
                setActionMessage(err.message)
            }
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

    const buildOpponent = (currentEncounter, trainers = []) => {
        const trainer = trainers.length
            ? trainers[Math.floor(Math.random() * trainers.length)]
            : null

        const team = (trainer?.team || []).map((entry) => {
            const poke = entry.pokemonId || entry.pokemon || null
            const baseStats = poke?.baseStats || {}
            const hp = Math.max(1, (baseStats.hp || 1) + ((entry.level || 1) - 1))
            return {
                id: poke?._id || entry.pokemonId,
                name: poke?.name || 'Pokemon',
                level: entry.level || 1,
                sprite: getPokemonSprite(poke),
                baseStats,
                pokemon: poke,
                currentHp: hp,
                maxHp: hp,
                currentMp: 10,
                maxMp: 10,
            }
        })

        return {
            trainerName: trainer?.name || 'Trainer',
            trainerImage: trainer?.imageUrl || '/assests/08_trainer_female.png',
            trainerQuote: trainer?.quote || 'Chúc bạn may mắn!',
            currentIndex: 0,
            level: currentEncounter?.level || 1,
            hp: currentEncounter?.hp || 1,
            maxHp: currentEncounter?.maxHp || 1,
            pokemon: currentEncounter?.pokemon || null,
            team,
        }
    }

    const buildCompletedEntries = (trainerList) => {
        return trainerList.map((trainer) => {
            const team = (trainer.team || []).map((entry) => {
                const poke = entry.pokemonId || entry.pokemon || null
                return {
                    id: poke?._id || entry.pokemonId,
                    name: poke?.name || 'Pokemon',
                    level: entry.level || 1,
                    sprite: getPokemonSprite(poke),
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
                        🪙 {playerState?.gold ?? 0} Platinum Coins <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Moon Points
                    </div>
                </div>

                <ActiveBattleView
                    party={party}
                    encounter={encounter}
                    playerState={playerState}
                    opponent={battleOpponent || opponent}
                    onAttack={handleAttack}
                    actionMessage={actionMessage}
                />
                {battleResults && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[520px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">Kết Quả Trận Đấu</div>
                            <div className="p-4 text-center text-xs">
                                <div className="mb-2">Trận đấu đã kết thúc thành công!</div>
                                <div className="border border-slate-200 rounded p-3 flex items-center gap-3 justify-center">
                                    <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200" />
                                    <div className="text-left">
                                        <div className="font-bold text-sm">{battleResults.pokemon.name}</div>
                                        <div>+{battleResults.pokemon.levelsGained} cấp</div>
                                        <div>+{battleResults.pokemon.happinessGained} Hạnh phúc</div>
                                        <div className="text-slate-500">EXP: {battleResults.pokemon.exp}/{battleResults.pokemon.expToNext}</div>
                                    </div>
                                </div>
                                <div className="mt-3 text-sm font-bold text-slate-700">+{battleResults.rewards.coins} Coins</div>
                                <div className="text-xs text-slate-500">+{battleResults.rewards.trainerExp} EXP Huấn luyện viên</div>
                            </div>
                            <div className="border-t border-slate-200 p-3 text-center">
                                <button
                                    onClick={() => {
                                        setBattleResults(null)
                                        setView('lobby')
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
                    🪙 {playerState?.gold ?? 0} Platinum Coins <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Moon Points
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

                    {encounter ? (
                        <button
                            onClick={() => setView('battle')}
                            className="text-3xl font-extrabold text-blue-800 hover:text-blue-600 hover:scale-105 transition-transform drop-shadow-sm my-2"
                        >
                            Chiến đấu!
                        </button>
                    ) : (
                        <div className="text-slate-500 text-sm">Chưa có trận chiến nào. Hãy vào bản đồ để gặp Pokemon.</div>
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
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="w-full py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Phần Thưởng Pokémon</div>
                        {encounter ? (
                            <div className="text-sm font-bold text-slate-700 mt-1">
                                {encounter.pokemon?.name || 'Pokemon'} (Lv. {encounter.level})
                            </div>
                        ) : (
                            <div className="text-sm font-bold text-slate-400 mt-1">Không có</div>
                        )}
                    </div>
                </div>
            </div>

            {(playerState?.wins || 0) > 0 && (
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
