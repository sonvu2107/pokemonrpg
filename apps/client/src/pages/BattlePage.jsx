import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'

export function BattlePage() {
    const [maps, setMaps] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadMaps()
    }, [])

    const loadMaps = async () => {
        try {
            const allMaps = await gameApi.getMaps()
            setMaps(allMaps)
        } catch (error) {
            console.error('Failed to load maps', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-3 border-b border-blue-500">
                    <h1 className="text-xl font-bold text-white drop-shadow-sm uppercase tracking-wide">
                        Khu Vực Chiến Đấu
                    </h1>
                </div>

                <div className="p-6 bg-slate-50 min-h-[300px]">
                    {loading ? (
                        <div className="text-center py-12 text-blue-800 font-medium animate-pulse">Đang tải danh sách bản đồ...</div>
                    ) : maps.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 italic">Chưa có bản đồ nào được khám phá.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {maps.map(map => {
                                const isLocked = !map.isUnlocked
                                const requiredSearches = map.unlockRequirement?.requiredSearches || 0
                                const currentSearches = map.unlockRequirement?.currentSearches || 0
                                const remainingSearches = map.unlockRequirement?.remainingSearches || 0
                                const sourceMapName = map.unlockRequirement?.sourceMap?.name
                                const unlockSoon = isLocked && remainingSearches > 0 && remainingSearches <= 5
                                const tooltip = isLocked
                                    ? `Cần ${remainingSearches} lượt tìm kiếm tại ${sourceMapName || 'map trước'} (${currentSearches}/${requiredSearches})`
                                    : 'Đã mở'
                                const cardClasses = `group block bg-white rounded-lg border overflow-hidden shadow-sm transition-all duration-200 ${isLocked
                                    ? 'border-slate-200 opacity-70 cursor-not-allowed'
                                    : 'border-slate-200 hover:shadow-md hover:border-blue-400'
                                    }`

                                return isLocked ? (
                                    <div
                                        key={map._id}
                                        title={tooltip}
                                        className={cardClasses}
                                    >
                                        <div className="px-3 py-2 bg-gradient-to-r from-slate-100 to-white border-b border-slate-100 flex justify-between items-center group-hover:from-blue-50 group-hover:to-white transition-colors">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <h3 className="font-bold text-slate-700 group-hover:text-blue-700 truncate">{map.name}</h3>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {unlockSoon && (
                                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                        Sắp mở
                                                    </span>
                                                )}
                                                {map.isLegendary && (
                                                    <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                                                        Săn Bắt
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="p-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200">
                                                    {map.iconId ? (
                                                        <img
                                                            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${map.iconId}.png`}
                                                            className="w-10 h-10 pixelated"
                                                            alt="icon"
                                                        />
                                                    ) : (
                                                        <span className="text-xl">🗺️</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 space-y-1">
                                                    <p>Cấp độ: <span className="font-bold text-slate-700">{map.levelMin} - {map.levelMax}</span></p>
                                                    <p className="text-[11px] font-semibold text-slate-500">
                                                        {currentSearches}/{requiredSearches} lượt để mở
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <Link
                                        key={map._id}
                                        to={`/map/${map.slug}`}
                                        title={tooltip}
                                        className={cardClasses}
                                    >
                                        <div className="px-3 py-2 bg-gradient-to-r from-slate-100 to-white border-b border-slate-100 flex justify-between items-center group-hover:from-blue-50 group-hover:to-white transition-colors">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <h3 className="font-bold text-slate-700 group-hover:text-blue-700 truncate">{map.name}</h3>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {map.isLegendary && (
                                                    <span className="text-[10px] uppercase font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                                                        Săn Bắt
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="p-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200">
                                                    {map.iconId ? (
                                                        <img
                                                            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${map.iconId}.png`}
                                                            className="w-10 h-10 pixelated"
                                                            alt="icon"
                                                        />
                                                    ) : (
                                                        <span className="text-xl">🗺️</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 space-y-1">
                                                    <p>Cấp độ: <span className="font-bold text-slate-700">{map.levelMin} - {map.levelMax}</span></p>
                                                    <p className="opacity-75">Nhấn để thám hiểm &raquo;</p>
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                </div>
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

