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
    const percent = Math.min(100, Math.max(0, (current / max) * 100))
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

const ActiveBattleView = ({ party }) => {
    const [selectedMove, setSelectedMove] = useState(0) // Index of selected move
    const [difficulty, setDifficulty] = useState('very_easy')

    // Find first alive pokemon (for now just first slot)
    const activePokemon = party.find(p => p) || null

    const playerMon = activePokemon ? {
        name: activePokemon.pokemonId?.name || 'Unknown',
        level: activePokemon.level,
        maxHp: activePokemon.stats?.hp || 100,
        hp: activePokemon.stats?.hp || 100, // No current HP yet, assume full
        maxMp: 100, // Mock MP
        mp: 100,    // Mock MP
        exp: activePokemon.experience,
        maxExp: activePokemon.level * 100, // Simple formula for now
        sprite: activePokemon.pokemonId?.sprites?.back_default || activePokemon.pokemonId?.sprites?.front_default,
        moves: activePokemon.moves || []
    } : {
        name: 'Bulbasaur',
        level: 12,
        maxHp: 45,
        hp: 45,
        maxMp: 20,
        mp: 20,
        exp: 40,
        maxExp: 100,
        sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/1.png',
        moves: []
    }

    const enemyMon = {
        name: 'Starly',
        owner: 'Allisha',
        level: 8,
        maxHp: 30,
        hp: 30,
        maxMp: 15,
        mp: 15,
        sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/396.png'
    }

    // Map real moves to UI structure, or use placeholders if string only
    const moves = playerMon.moves.length > 0
        ? playerMon.moves.map((m, i) => ({
            id: i,
            name: typeof m === 'string' ? m : m.name,
            type: 'normal', // Placeholder type
            mp: 5,         // Placeholder MP
            power: 50,     // Placeholder Power
            icon: '👊'
        }))
        : [
            { id: 0, name: 'Struggle', type: 'normal', mp: 0, power: 35, icon: '😫' }
        ]

    return (
        <div className="space-y-4 animate-fadeIn">
            {/* Battle Event Header */}
            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden text-center">
                <SectionHeader title="Winter Event" />
                <div className="bg-blue-50 py-1 text-xs font-bold text-slate-700 border-b border-blue-200">Links</div>
                <div className="p-2 text-xs">
                    <span className="text-blue-600 font-bold hover:underline cursor-pointer">[ Winter Event ]</span>
                    <span className="mx-1">|</span>
                    <span className="text-blue-600 font-bold hover:underline cursor-pointer">[ Snowflake Shop ]</span>
                </div>
                <div className="bg-blue-50 py-1 text-xs font-bold text-slate-700 border-y border-blue-200">Owned Presents</div>
                <div className="flex justify-around p-2 bg-slate-100">
                    {['Easy', 'Medium', 'Hard', 'Elite'].map(tier => (
                        <div key={tier} className="flex items-center gap-1 opacity-50">
                            <span className="text-xl">🎁</span>
                            <span className="text-xs font-bold">{tier}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Battle Arena */}
            <div className="grid grid-cols-2 gap-1 bg-white border border-slate-400 p-1 rounded">
                {/* Player Side */}
                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">Your {playerMon.name}</h3>

                    {/* Bars */}
                    <div className="w-full grid grid-cols-2 gap-1 mb-2">
                        <ProgressBar current={playerMon.hp} max={playerMon.maxHp} colorClass="bg-green-500" label="HP" />
                        <ProgressBar current={playerMon.mp} max={playerMon.maxMp} colorClass="bg-blue-500" label="MP" />
                    </div>

                    <div className="w-full mb-4">
                        <div className="text-[10px] font-bold text-center mb-0.5">Level {playerMon.level}</div>
                        <div className="h-1.5 w-full bg-slate-200 border border-slate-300">
                            <div className="h-full bg-yellow-400" style={{ width: `${(playerMon.exp / playerMon.maxExp) * 100}%` }}></div>
                        </div>
                    </div>

                    <img src={playerMon.sprite} className="w-24 h-24 pixelated object-contain" />
                </div>

                {/* Enemy Side */}
                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">{enemyMon.owner}'s {enemyMon.name}</h3>

                    <img src={enemyMon.sprite} className="w-24 h-24 pixelated object-contain mb-2" />

                    <div className="w-full mt-auto">
                        <div className="text-[10px] font-bold text-center mb-0.5">Level {enemyMon.level}</div>
                        <div className="h-1.5 w-full bg-slate-200 border border-slate-300 mb-2"></div>

                        <div className="w-full grid grid-cols-2 gap-1">
                            <ProgressBar current={enemyMon.hp} max={enemyMon.maxHp} colorClass="bg-green-500" label="HP" />
                            <ProgressBar current={enemyMon.mp} max={enemyMon.maxMp} colorClass="bg-blue-500" label="MP" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Menu */}
            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b border-slate-300 text-xs font-bold bg-slate-50">
                    <button className="flex-1 py-1 px-2 text-green-700 border-b-2 border-green-500 bg-white">Fight</button>
                    <button className="flex-1 py-1 px-2 text-slate-500 hover:bg-slate-100">Item</button>
                    <button className="flex-1 py-1 px-2 text-blue-700 hover:bg-slate-100">Concentrate</button>
                    <button className="flex-1 py-1 px-2 text-blue-700 hover:bg-slate-100">Alter Party</button>
                    <button className="flex-1 py-1 px-2 text-red-700 hover:bg-slate-100">Escape</button>
                </div>

                {/* Moves Grid */}
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

                {/* Footer Action */}
                <div className="p-2 text-center border-t border-slate-200 bg-slate-50">
                    <div className="text-xs text-slate-500 mb-2">Choose a move to use or an action, then click below.</div>
                    <button className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm text-sm flex items-center justify-center gap-2 mx-auto">
                        <span className="text-lg">🍃</span> Attack
                    </button>
                </div>
            </div>

            {/* Difficulty Selector */}
            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                <div className="bg-yellow-50 px-2 py-1 text-xs font-bold text-center border-b border-yellow-200">
                    Battle Difficulty
                </div>
                <div className="p-2 text-center">
                    <p className="text-[10px] mb-2">Higher battle difficulty makes battles harder but increases EXP and Platinum Coins earned.</p>
                    <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="w-full max-w-xs text-xs border border-slate-300 rounded p-1"
                    >
                        <option value="very_easy">Very Easy Mode</option>
                        <option value="easy">Easy Mode</option>
                        <option value="normal">Normal Mode</option>
                        <option value="hard">Hard Mode</option>
                    </select>
                </div>
            </div>
        </div>
    )
}

export function BattlePage() {
    const [maps, setMaps] = useState([])
    const [party, setParty] = useState([])
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState('lobby') // 'lobby' | 'battle'

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            const [allMaps, partyData] = await Promise.all([
                gameApi.getMaps(),
                gameApi.getParty()
            ])
            setMaps(allMaps)
            setParty(partyData)
        } catch (error) {
            console.error('Failed to load data', error)
        } finally {
            setLoading(false)
        }
    }

    if (view === 'battle') {
        return (
            <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">
                {/* Main Header (Persists) */}
                <div className="text-center space-y-2">
                    <div className="text-amber-400 font-bold tracking-wider text-xs uppercase drop-shadow-sm">
                        ⭐ A 2x EXP boost is currently active!
                    </div>
                    <div className="text-slate-600 font-bold text-sm">
                        🪙 $102,526 Platinum Coins <span className="mx-2">•</span> 🌑 0 Moon Points
                    </div>
                    <div className="text-pink-500 font-bold text-sm mt-1">
                        2x Battle EXP Boost! <br />
                        <span className="text-xs text-pink-700">+15 Level Limit!</span> <br />
                        <span className="text-xs text-blue-700">+90 Moon Points Boost!</span> <br />
                        <span className="text-xs text-orange-600">11 hours 39 min remaining</span>
                    </div>
                </div>

                <ActiveBattleView party={party} />
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">

            {/* Main Header */}
            <div className="text-center space-y-2">
                <div className="text-amber-400 font-bold tracking-wider text-xs uppercase drop-shadow-sm">
                    ⭐ A 2x EXP boost is currently active!
                </div>
                <div className="text-slate-600 font-bold text-sm">
                    🪙 $102,526 Platinum Coins <span className="mx-2">•</span> 🌑 0 Moon Points
                </div>
                <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm uppercase tracking-wide">
                    Battle Area
                </h1>
            </div>

            {/* Storylines Section */}
            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Storylines" />
                <div className="p-4 bg-slate-50 text-center">
                    <div className="inline-block font-bold text-slate-700 hover:text-blue-600 cursor-pointer">
                        [ Galactic Story ]
                    </div>
                    {/* Access to old maps for now */}
                    <div className="mt-4 border-t border-slate-200 pt-2">
                        <p className="text-xs text-slate-400 font-bold mb-2 uppercase">Wild Areas (Old Maps)</p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {loading ? (
                                <span className="text-xs text-slate-400">Loading...</span>
                            ) : (
                                maps.map(map => (
                                    <Link
                                        key={map._id}
                                        to={`/map/${map.slug}`}
                                        className={`text-xs px-2 py-1 rounded border ${!map.isUnlocked ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                                    >
                                        {map.name}
                                    </Link>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Current Battle Section */}
            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Current Battle" />
                <div className="p-6 bg-white flex flex-col items-center text-center">
                    <div className="mb-4">
                        <img
                            src="/assests/08_trainer_female.png"
                            alt="Trainer"
                            className="w-24 h-24 object-contain pixelated"
                        />
                    </div>

                    <div className="mb-2">
                        <span className="font-bold text-slate-800">Trainer Allisha:</span>
                        <span className="text-slate-600 italic ml-1">"Are we allowed to swear in this RPG?"</span>
                    </div>

                    <button
                        onClick={() => setView('battle')}
                        className="text-3xl font-extrabold text-blue-800 hover:text-blue-600 hover:scale-105 transition-transform drop-shadow-sm my-2"
                    >
                        Fight!
                    </button>

                    <div className="w-full mt-4 border-t border-blue-100"></div>

                    {/* Opponent Team */}
                    <div className="w-full bg-blue-50/50 py-2 border-b border-blue-100">
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Pokémon Team</div>
                        <div className="flex justify-center gap-8">
                            {[
                                { id: 74, name: 'Geodude', level: 8 },
                                { id: 27, name: 'Sandshrew', level: 12 },
                                { id: 21, name: 'Spearow', level: 11 }
                            ].map((poke, idx) => (
                                <div key={idx} className="flex flex-col items-center">
                                    <img
                                        src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${poke.id}.png`}
                                        className="w-10 h-10 pixelated"
                                    />
                                    <span className="text-[10px] font-bold text-slate-700">L. {poke.level}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Prize */}
                    <div className="w-full py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Pokémon Prize</div>
                        <div className="text-sm font-bold text-slate-400 mt-1">None</div>
                    </div>
                </div>
            </div>

            {/* Completed Section */}
            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Completed" />
                <div className="p-8 flex justify-center bg-white">
                    <img
                        src="/assests/15_trainer_male.png"
                        className="w-32 h-32 object-contain pixelated"
                    />
                </div>
            </div>

            {/* Completed Details Footer */}
            <div className="rounded border border-blue-400 bg-blue-100/50 shadow-sm overflow-hidden text-center p-2">
                <SectionHeader title="Completed - Full Details" />
                <p className="text-xs text-blue-800 mt-2 p-2">
                    Press Z while your mouse is over an image below to view full details.
                </p>
            </div>

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

