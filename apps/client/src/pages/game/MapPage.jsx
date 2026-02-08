import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { mapApi } from '../../services/mapApi'
import { gameApi } from '../../services/gameApi'

// Mock Data for "Retro" UI Stats
const MOCK_STATS = {
    exp: 3,
    totalSearches: 3,
    expToNext: 250,
    mapLevel: 1,
    currentChances: '1 in 415',
    platinumCoins: '102,150',
    moonPoints: 0
}

const NORMAL_RARITIES = new Set(['d', 'c', 'common', 'uncommon'])

export default function MapPage() {
    const { slug } = useParams()
    const [map, setMap] = useState(null)
    const [dropRates, setDropRates] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [unlockInfo, setUnlockInfo] = useState(null)
    const [isLocked, setIsLocked] = useState(false)

    // Game State
    const [searching, setSearching] = useState(false)
    const [lastResult, setLastResult] = useState(null) // { encountered: bool, pokemon?: obj, message?: string }
    const [encounter, setEncounter] = useState(null) // { id, pokemon, level, hp, maxHp }
    const [actionLoading, setActionLoading] = useState(false)
    const [actionMessage, setActionMessage] = useState('')
    const [inventory, setInventory] = useState([])
    const [selectedBallId, setSelectedBallId] = useState('')
    const [mapStats, setMapStats] = useState({
        level: MOCK_STATS.mapLevel,
        exp: MOCK_STATS.exp,
        expToNext: MOCK_STATS.expToNext,
        totalSearches: MOCK_STATS.totalSearches,
    })
    const mapProgressPercent = Math.max(5, Math.round((mapStats.exp / Math.max(1, mapStats.expToNext)) * 100))
    const requiredSearches = Math.max(
        0,
        (isLocked ? unlockInfo?.requiredSearches : map?.requiredSearches) ?? 0
    )
    const currentSearches = Math.max(
        0,
        (isLocked ? unlockInfo?.currentSearches : mapStats.totalSearches) ?? 0
    )
    const unlockRemaining = Math.max(0, requiredSearches - currentSearches)
    const unlockPercent = requiredSearches > 0
        ? Math.min(100, Math.round((currentSearches / requiredSearches) * 100))
        : 100
    const normalDropRates = dropRates.filter(dr => dr.pokemonId && NORMAL_RARITIES.has(dr.pokemonId.rarity))

    useEffect(() => {
        loadMapData()
        setLastResult(null)
        setEncounter(null)
        setActionMessage('')
    }, [slug])

    const loadMapData = async () => {
        try {
            setLoading(true)
            setError('')
            const [mapData, stateData] = await Promise.all([
                mapApi.getBySlug(slug),
                gameApi.getMapState(slug).catch(() => null),
            ])
            setMap(mapData.map)
            setDropRates(mapData.dropRates)
            if (stateData?.mapProgress) {
                setMapStats(stateData.mapProgress)
            }
            if (stateData?.unlock) {
                setUnlockInfo(stateData.unlock)
            }
            setIsLocked(Boolean(stateData?.locked))
            if (stateData?.locked) {
                setMapStats((prev) => ({
                    ...prev,
                    exp: 0,
                    totalSearches: 0,
                }))
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadInventory = async () => {
        try {
            const data = await gameApi.getInventory()
            setInventory(data.inventory || [])
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const handleSearch = async () => {
        if (isLocked) {
            setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Hãy hoàn thành yêu cầu để mở.' })
            return
        }
        try {
            setSearching(true)
            setLastResult(null)
            setEncounter(null)
            setActionMessage('')

            const res = await gameApi.searchMap(slug)
            if (res?.locked) {
                setUnlockInfo(res.unlock || null)
                setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Hãy hoàn thành yêu cầu để mở.' })
                return
            }

            // Artificial delay to mimic "Searching..." feel of old RPGs
            await new Promise(r => setTimeout(r, 600))

            setLastResult(res)
            if (res.encountered) {
                setEncounter({
                    id: res.encounterId,
                    pokemon: res.pokemon,
                    level: res.level,
                    hp: res.hp,
                    maxHp: res.maxHp,
                })
                await loadInventory()
                if (res.itemDrop) {
                    setActionMessage(`Nhặt được: ${res.itemDrop.name}`)
                }
            }
            if (res.mapProgress) {
                setMapStats(res.mapProgress)
            }
        } catch (err) {
            setLastResult({ encountered: false, message: 'Lỗi: ' + err.message })
        } finally {
            setSearching(false)
        }
    }

    const handleAttack = async () => {
        if (!encounter?.id) return
        try {
            setActionLoading(true)
            const res = await gameApi.attackEncounter(encounter.id)
            setEncounter(prev => prev ? { ...prev, hp: res.hp, maxHp: res.maxHp } : prev)
            setActionMessage(res.message || 'Đã tấn công!')
            if (res.defeated) {
                setEncounter(null)
            }
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const handleCatch = async () => {
        if (!encounter?.id) return
        try {
            setActionLoading(true)
            const res = await gameApi.catchEncounter(encounter.id)
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : 'Bắt thất bại!'))
            if (res.caught) {
                setEncounter(null)
            }
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const handleUseBall = async () => {
        if (!encounter?.id || !selectedBallId) return
        try {
            setActionLoading(true)
            const res = await gameApi.useItem(selectedBallId, 1, encounter.id)
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : 'Bắt thất bại!'))
            await loadInventory()
            if (res.caught) {
                setEncounter(null)
            }
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const getBallMultiplier = (item) => {
        if (item?.effectType === 'catchMultiplier' && Number.isFinite(item.effectValue)) {
            return item.effectValue || 1
        }
        return 1
    }

    const calcCatchChance = ({ catchRate, hp, maxHp }) => {
        const rate = Math.min(255, Math.max(1, catchRate || 45))
        const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
        const raw = (rate / 255) * hpFactor
        return Math.min(0.99, Math.max(0.02, raw))
    }

    const handleRun = async () => {
        if (!encounter?.id) return
        try {
            setActionLoading(true)
            const res = await gameApi.runEncounter(encounter.id)
            setActionMessage(res.message || 'Bạn đã bỏ chạy.')
            setEncounter(null)
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }


    if (loading) return <div className="text-center py-8 text-blue-900 font-bold">Loading...</div>
    if (error) return <div className="text-center py-8 text-red-600 font-bold">{error}</div>
    if (!map) return null

    const specialPokemons = Array.isArray(map.specialPokemons) ? map.specialPokemons : []

    if (isLocked) {
        return (
            <div className="max-w-3xl mx-auto font-sans text-sm animate-fadeIn">
                <div className="border-[3px] border-blue-700 rounded-lg bg-blue-900 overflow-hidden shadow-lg min-h-[600px]">
                    <div className="text-center py-3 bg-gradient-to-b from-white to-blue-50 border-b-2 border-slate-300 shadow-sm">
                        <div className="flex flex-col items-center justify-center gap-0.5">
                            <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                                <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/coin-case.png" className="w-4 h-4" alt="Coins" />
                                <span>${MOCK_STATS.platinumCoins} Xu Bạch Kim</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                                <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png" className="w-4 h-4" alt="Points" />
                                <span>{MOCK_STATS.moonPoints} Điểm Nguyệt Các</span>
                            </div>
                        </div>
                        <div className="mt-2 text-slate-800 text-sm">
                            Bạn cần tìm kiếm <span className="font-bold">{unlockInfo?.requiredSearches || 0}</span> lần tại <Link to={unlockInfo?.sourceMap?.slug ? `/map/${unlockInfo.sourceMap.slug}` : '#'} className="font-bold text-blue-700 hover:underline">{unlockInfo?.sourceMap?.name || 'bản đồ trước'}</Link>.
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-3xl mx-auto font-sans text-sm animate-fadeIn">
            {/* Main Blue Border Container */}
            <div className="border-[3px] border-blue-700 rounded-lg bg-white overflow-hidden shadow-lg">

                {/* Header Section (Jirachi's Park style) */}
                <div className="text-center py-2 bg-gradient-to-b from-white to-blue-50 border-b border-blue-200">
                    <div className="flex flex-col items-center justify-center gap-0.5">
                        <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                            <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/coin-case.png" className="w-4 h-4" alt="Coins" />
                            <span>${MOCK_STATS.platinumCoins} Xu Bạch Kim</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                            <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/moon-stone.png" className="w-4 h-4" alt="Points" />
                            <span>{MOCK_STATS.moonPoints} Điểm Nguyệt Các</span>
                        </div>
                    </div>
                </div>

                <div className="text-center py-4 bg-gradient-to-b from-white to-blue-50">
                    <h1 className="text-2xl font-bold text-blue-900 drop-shadow-sm">{map.name}</h1>
                </div>



                {/* Winter Event / Links Section (Mock) */}
                <div className="border-t border-b border-blue-300">
                    <div className="bg-gradient-to-t from-blue-600 to-blue-400 text-white font-bold text-center py-1 border-b border-blue-700">
                        Thông Tin Khu Vực
                    </div>
                    <div className="bg-sky-50 text-center py-2 text-blue-800 font-bold text-xs">
                        [ <Link to="/event" className="hover:underline">Sự Kiện</Link> ]
                        [ <Link to="/shop" className="hover:underline">Cửa Hàng</Link> ]
                    </div>
                </div>

                {/* Sub-Header: Map Info / Battle Skipped */}
                <div className="text-center py-2 bg-blue-50 text-blue-900 font-bold text-xs border-b border-blue-300">
                    <span className="cursor-pointer hover:underline">Chi tiết bản đồ</span> | <span className="cursor-pointer hover:underline">Cài đặt trận đấu</span>
                </div>

                {/* Pokemon Lists Section */}
                <div>
                    <div className="bg-gradient-to-t from-blue-500 to-blue-300 text-white font-bold text-center py-1 border-y border-blue-600">
                        {map.name}
                    </div>

                    {/* Special Pokemon */}
                    {((specialPokemons.length > 0) || (map.specialPokemonImages && map.specialPokemonImages.length > 0)) && (
                        <>
                            <div className="bg-sky-100/50 text-center py-1 text-blue-900 font-bold text-xs border-b border-blue-200">
                                Pokemon Dac Biet
                            </div>
                            <div className="flex justify-center flex-wrap gap-6 py-6 min-h-[120px] items-center bg-gradient-to-b from-purple-50/30 to-white">
                                {specialPokemons.length > 0
                                    ? specialPokemons.map((pokemon) => (
                                        <div key={pokemon.id || pokemon._id} className="flex flex-col items-center">
                                            <img
                                                src={pokemon.imageUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokedexNumber}.png`}
                                                alt={pokemon.name || 'Special Pokemon'}
                                                className="w-32 h-32 object-contain pixelated hover:scale-110 transition-transform drop-shadow-sm"
                                            />
                                            {pokemon.name && (
                                                <p className="text-xs font-bold text-blue-800 mt-1">{pokemon.name}</p>
                                            )}
                                        </div>
                                    ))
                                    : map.specialPokemonImages.map((imageUrl, index) => (
                                        <div key={index} className="flex flex-col items-center">
                                            <img
                                                src={imageUrl}
                                                alt={`Special Pokemon ${index + 1}`}
                                                className="w-32 h-32 object-contain pixelated hover:scale-110 transition-transform drop-shadow-sm"
                                            />
                                        </div>
                                    ))}
                            </div>
                        </>
                    )}
                    {/* Normal Pokemon (Common/Uncommon) */}
                    <div>
                        <div className="bg-sky-100/50 text-center py-1 text-blue-900 font-bold text-xs border-y border-blue-200">
                            Pokemon Thường
                        </div>
                        <div className="flex justify-center flex-wrap gap-6 py-4 min-h-[80px] items-center bg-white">
                            {dropRates
                                .filter(dr => dr.pokemonId && NORMAL_RARITIES.has(dr.pokemonId.rarity))
                                .map(dr => (
                                    <div key={dr._id} className="flex flex-col items-center opacity-90 hover:opacity-100">
                                        <img
                                            src={dr.pokemonId.imageUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dr.pokemonId.pokedexNumber}.png`}
                                            alt={dr.pokemonId.name}
                                            className="w-12 h-12 pixelated hover:scale-110 transition-transform"
                                            title={dr.pokemonId.name}
                                        />
                                    </div>
                                ))}
                            {normalDropRates.length === 0 && (
                                <span className="text-slate-400 text-xs italic">Chưa có Pokemon thường nào...</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Stats Table */}
                <div className="border-t border-slate-300">
                    <table className="w-full text-xs font-bold text-slate-800">
                        <tbody>
                            <tr className="border-b border-slate-300">
                                <td className="w-1/3 bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Tỷ lệ hiện tại:</td>
                                <td className="px-3 py-1 bg-white">1 trong {Math.floor(1000 / (dropRates[0]?.weight || 1))}</td>
                            </tr>
                            <tr className="border-b border-slate-300">
                                <td className="bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Cấp độ bản đồ:</td>
                                <td className="px-3 py-1 bg-white flex items-center gap-2">
                                    <span>{mapStats.level}</span>
                                    {/* Progress Bar */}
                                    <div className="w-48 h-3 bg-white border border-slate-600 rounded-full overflow-hidden relative shadow-inner">
                                        <div
                                            className="absolute top-0 left-0 h-full bg-gradient-to-b from-cyan-300 to-cyan-600"
                                            style={{ width: `${mapProgressPercent}%` }}
                                        ></div>
                                        {/* Shine effect */}
                                        <div className="absolute top-0 left-0 w-full h-[50%] bg-white/30"></div>
                                    </div>
                                </td>
                            </tr>
                            <tr className="border-b border-slate-300">
                                <td className="bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Tổng lượt tìm:</td>
                                <td className="px-3 py-1 text-blue-600">{mapStats.totalSearches}/{mapStats.expToNext}</td>
                            </tr>
                            <tr className="border-b border-slate-300">
                                <td className="bg-sky-100 px-3 py-1 text-right border-r border-slate-300">
                                    {isLocked ? 'Tiến độ mở khóa map:' : 'Tiến độ mở map tiếp theo:'}
                                </td>
                                <td className="px-3 py-1 bg-white flex items-center gap-2">
                                    {requiredSearches > 0 ? (
                                        <>
                                            <span className="text-blue-700 font-bold">{currentSearches}/{requiredSearches}</span>
                                            <div className="w-36 h-2 bg-white border border-slate-600 rounded-full overflow-hidden relative shadow-inner">
                                                <div
                                                    className="absolute top-0 left-0 h-full bg-gradient-to-b from-amber-300 to-amber-600"
                                                    style={{ width: `${Math.max(5, unlockPercent)}%` }}
                                                ></div>
                                            </div>
                                        </>
                                    ) : (
                                        <span className="text-emerald-700 font-bold">Không yêu cầu</span>
                                    )}
                                </td>
                            </tr>
                            <tr className="border-b border-slate-300">
                                <td className="bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Gặp gần nhất:</td>
                                <td className="px-3 py-1 text-slate-500">-</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Map Visualization & Search Button */}
                <div className="p-4 flex flex-col items-center gap-4 bg-white">
                    {/* Map Image container with shadow */}
                    <div className="relative shadow-xl rounded overflow-hidden border-2 border-slate-600">
                        {/* Placeholder Map Image - Using a generic tile visual or the one from screenshot if possible. 
                             Ideally this should come from map.imageUrl in DB. Using a sturdy placeholder. */}
                        <div
                            className="w-[300px] h-[180px] bg-cover bg-center pixelated relative"
                            style={{
                                backgroundImage: `url('${map.mapImageUrl || 'https://i.pinimg.com/originals/2d/e9/87/2de98740c0670868a83416b9b392bead.png'}')`,
                                imageRendering: 'pixelated'
                            }}
                        >


                            {/* Encounter Overlay */}
                            {encounter && (
                                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center animate-fadeIn">
                                    <img
                                        src={encounter.pokemon.imageUrl || encounter.pokemon.sprites?.front_default || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${encounter.pokemon.pokedexNumber}.png`}
                                        className="w-32 h-32 animate-bounce drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {encounter && (
                        <div className="w-full max-w-[300px] text-xs">
                            <div className="flex justify-between text-slate-700 font-bold mb-1">
                                <span>HP</span>
                                <span>{encounter.hp}/{encounter.maxHp}</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
                                <div
                                    className="h-2 bg-green-500"
                                    style={{ width: `${Math.max(5, Math.round((encounter.hp / encounter.maxHp) * 100))}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Search Button */}
                    <button
                        onClick={handleSearch}
                        disabled={searching || Boolean(encounter) || isLocked} // If found, force decision? Or just re-search as user requested simple loop
                        className="px-6 py-1 bg-white border border-slate-400 hover:bg-slate-50 text-black font-bold text-sm shadow-[0_2px_0_#94a3b8] active:translate-y-[2px] active:shadow-none transition-all rounded disabled:opacity-50"
                    >
                        {searching ? 'Đang tìm...' : 'Tìm kiếm'}
                    </button>
                </div>

                {/* Footer / Results Log */}
                <div className="border-t-2 border-slate-200 p-2 text-center min-h-[40px] bg-slate-50">
                    {encounter ? (
                        <div className="text-green-700 font-bold">
                            Một <span className="uppercase">{encounter.pokemon.name}</span> (Lvl {encounter.level}) hoang dã xuất hiện!
                            <div className="mt-2 text-xs font-normal text-slate-600">
                                [ <button
                                    onClick={handleAttack}
                                    disabled={actionLoading}
                                    className="text-blue-600 hover:underline font-bold disabled:opacity-50"
                                >Chiến đấu</button> ]
                                {' - '}
                                [ <button
                                    onClick={handleRun}
                                    disabled={actionLoading}
                                    className="text-slate-600 hover:underline font-bold disabled:opacity-50"
                                >Bỏ chạy</button> ]
                            </div>
                            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
                                <select
                                    value={selectedBallId}
                                    onChange={(e) => setSelectedBallId(e.target.value)}
                                    className="px-2 py-1 border border-slate-300 rounded bg-white"
                                >
                                    <option value="">Chọn bóng để bắt</option>
                                    {inventory
                                        .filter((entry) => entry.item?.type === 'pokeball' && entry.quantity > 0)
                                        .map((entry) => {
                                            const baseChance = calcCatchChance({
                                                catchRate: encounter?.pokemon?.catchRate,
                                                hp: encounter?.hp,
                                                maxHp: encounter?.maxHp,
                                            })
                                            const multiplier = getBallMultiplier(entry.item)
                                            const finalChance = Math.min(0.99, baseChance * multiplier)
                                            const percent = Math.round(finalChance * 100)
                                            return (
                                                <option key={entry.item._id} value={entry.item._id}>
                                                    {entry.item.name} (x{entry.quantity}) - ~{percent}%
                                                </option>
                                            )
                                        })}
                                </select>
                                <button
                                    onClick={handleUseBall}
                                    disabled={actionLoading || !selectedBallId}
                                    className="px-2 py-1 bg-emerald-600 text-white rounded font-bold disabled:opacity-50"
                                >
                                    Dùng bóng
                                </button>
                            </div>
                            {actionMessage && (
                                <div className="mt-2 text-xs font-bold text-blue-700">
                                    {actionMessage}
                                </div>
                            )}
                        </div>
                    ) : actionMessage ? (
                        <div className="text-blue-700 font-bold text-xs">{actionMessage}</div>
                    ) : lastResult ? (
                        lastResult.encountered ? (
                            <div className="text-slate-600 text-xs font-bold">Trận chiến đã kết thúc.</div>
                        ) : (
                            <div className="text-red-500 font-bold text-xs">
                                {lastResult.message || 'Bạn không tìm thấy Pokemon đặc biệt nào.'}
                            </div>
                        )
                    ) : (
                        <div className="text-slate-400 text-xs italic">Nhấn tìm kiếm để bắt đầu...</div>
                    )}

                    {lastResult && !lastResult.encountered && (
                        <div className="text-slate-800 font-bold text-xs mt-1">
                            +3 EXP Bản Đồ
                            {lastResult.itemDrop && (
                                <span className="ml-2 text-emerald-600">Nhặt được {lastResult.itemDrop.name}</span>
                            )}
                        </div>
                    )}
                </div>

            </div>
        </div>
    )
}





