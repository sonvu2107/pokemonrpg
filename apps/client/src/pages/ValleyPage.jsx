import { useState, useEffect, useCallback } from 'react'
import { valleyApi } from '../services/valleyApi'
import { gameApi } from '../services/gameApi'
import { getRarityStyle } from '../utils/rarityStyles'
import { useToast } from '../context/ToastContext'
import SmartImage from '../components/SmartImage'
import VipCaughtStar from '../components/VipCaughtStar'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const normalizeFormId = (v = 'normal') => String(v || '').trim().toLowerCase() || 'normal'

const resolvePokemonDisplay = (entry) => {
    const species = entry?.pokemonId || {}
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const requestedFormId = normalizeFormId(entry?.formId || species?.defaultFormId || 'normal')
    const resolvedForm = forms.find((c) => normalizeFormId(c?.formId) === requestedFormId) || null
    const baseNormal = species?.imageUrl || species?.sprites?.normal || species?.sprites?.icon || ''
    const formNormal = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || baseNormal
    const shinySprite = resolvedForm?.sprites?.shiny || species?.sprites?.shiny || formNormal
    return {
        species,
        sprite: entry?.isShiny ? shinySprite : formNormal,
    }
}

const formatCountdown = (expiresAt) => {
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (ms <= 0) return 'Hết hạn'
    const days = Math.floor(ms / 86_400_000)
    const hours = Math.floor((ms % 86_400_000) / 3_600_000)
    if (days > 0) return `${days}n ${hours}h`
    const mins = Math.floor((ms % 3_600_000) / 60_000)
    return `${hours}g ${mins}p`
}

const CHANCE_LABEL_COLOR = {
    'Rất cao': 'text-emerald-600',
    'Cao': 'text-blue-600',
    'Trung bình': 'text-amber-600',
    'Thấp': 'text-rose-600',
}

// ─── Catch Modal ──────────────────────────────────────────────────────────────

function CatchModal({ target, balls, onClose, onCaught }) {
    const toast = useToast()
    const [selectedBall, setSelectedBall] = useState(null)
    const [chanceLabel, setChanceLabel] = useState(null)
    const [loadingChance, setLoadingChance] = useState(false)
    const [catching, setCatching] = useState(false)
    const [result, setResult] = useState(null) // null | 'success' | 'fail'

    const availableBalls = balls.filter(
        (b) => b.item?.type === 'ball' || /ball/i.test(b.item?.name || '')
    )

    useEffect(() => {
        if (!selectedBall) { setChanceLabel(null); return }
        let cancelled = false
        setLoadingChance(true)
        valleyApi.getChanceLabel(target._id, selectedBall.item._id)
            .then((data) => { if (!cancelled) setChanceLabel(data.label) })
            .catch(() => { if (!cancelled) setChanceLabel(null) })
            .finally(() => { if (!cancelled) setLoadingChance(false) })
        return () => { cancelled = true }
    }, [selectedBall, target._id])

    const handleCatch = async () => {
        if (!selectedBall || catching) return
        setCatching(true)
        try {
            const data = await valleyApi.catchPokemon(target._id, selectedBall.item._id)
            if (data.caught) {
                setResult('success')
                onCaught()
            } else {
                setResult('fail')
            }
        } catch (err) {
            toast.showError(err.message || 'Bắt Pokémon thất bại')
            onClose()
        } finally {
            setCatching(false)
        }
    }

    const display = resolvePokemonDisplay(target)
    const style = getRarityStyle(target.rarity)
    const speciesName = display.species?.name || 'Pokémon'

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 relative"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute top-3 right-4 text-slate-400 hover:text-slate-600 text-xl font-bold"
                >
                    ×
                </button>

                {result === null && (
                    <>
                        <h2 className="text-center text-base font-bold text-slate-800 mb-3">
                            Bắt Pokémon
                        </h2>

                        {/* Target card */}
                        <div className={`flex items-center gap-3 p-3 rounded-lg mb-4 border ${style.border} ${style.bg}`}>
                            <SmartImage
                                src={display.sprite || '/placeholder.png'}
                                alt={speciesName}
                                width={56}
                                height={56}
                                className="w-14 h-14 object-contain pixelated rendering-pixelated"
                                fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                            />
                            <div>
                                <div className={`font-bold text-sm ${style.text}`}>
                                    {target.nickname || speciesName}
                                    {target.isShiny && <span className="ml-1 text-amber-500 text-[10px]">SHINY</span>}
                                </div>
                                <div className="text-xs text-slate-500">Lv.{target.level}</div>
                                <div className="text-xs text-slate-400">Trainer: {target.releasedByUsername}</div>
                            </div>
                            <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${style.badge}`}>
                                {style.label}
                            </span>
                        </div>

                        {/* Ball picker */}
                        <p className="text-xs font-bold text-slate-600 mb-2">Chọn Poké Ball:</p>
                        {availableBalls.length === 0 ? (
                            <p className="text-xs text-rose-500 italic mb-3">Bạn không có Poké Ball nào.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2 mb-4">
                                {availableBalls.map((entry) => {
                                    const isSelected = selectedBall?.item._id === entry.item._id
                                    return (
                                        <button
                                            key={entry.item._id}
                                            onClick={() => setSelectedBall(entry)}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-bold transition-colors ${
                                                isSelected
                                                    ? 'border-blue-500 bg-blue-100 text-blue-700'
                                                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50'
                                            }`}
                                        >
                                            <SmartImage
                                                src={entry.item.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'}
                                                alt={entry.item.name}
                                                width={20}
                                                height={20}
                                                className="w-5 h-5 object-contain"
                                            />
                                            {entry.item.name}
                                            <span className="text-slate-400 font-normal">×{entry.quantity}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                        {/* Chance label */}
                        {selectedBall && (
                            <div className="text-center text-sm font-bold mb-4">
                                {loadingChance ? (
                                    <span className="text-slate-400 animate-pulse">Đang tính tỉ lệ...</span>
                                ) : chanceLabel ? (
                                    <span>
                                        Tỉ lệ bắt: <span className={CHANCE_LABEL_COLOR[chanceLabel] || 'text-slate-600'}>{chanceLabel}</span>
                                    </span>
                                ) : null}
                            </div>
                        )}

                        <button
                            onClick={handleCatch}
                            disabled={!selectedBall || catching || availableBalls.length === 0}
                            className="w-full py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {catching ? 'Đang ném bóng...' : 'Ném Bóng!'}
                        </button>
                    </>
                )}

                {result === 'success' && (
                    <div className="text-center py-4">
                        <div className="text-4xl mb-2">🎉</div>
                        <p className="font-bold text-emerald-600 text-lg">Bắt thành công!</p>
                        <p className="text-sm text-slate-500 mt-1">{target.nickname || speciesName} đã vào kho của bạn.</p>
                        <button onClick={onClose} className="mt-4 px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 text-sm">
                            Tuyệt vời!
                        </button>
                    </div>
                )}

                {result === 'fail' && (
                    <div className="text-center py-4">
                        <div className="text-4xl mb-2">💨</div>
                        <p className="font-bold text-rose-600 text-lg">Thoát ra rồi!</p>
                        <p className="text-sm text-slate-500 mt-1">Pokémon đã vượt khỏi bóng. Bóng đã bị tiêu.</p>
                        <button onClick={onClose} className="mt-4 px-5 py-2 rounded-lg bg-slate-600 text-white font-bold hover:bg-slate-700 text-sm">
                            Thử lại sau
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Valley Browser Tab ───────────────────────────────────────────────────────

function ValleyBrowseTab() {
    const toast = useToast()
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [rarity, setRarity] = useState('')
    const [balls, setBalls] = useState([])
    const [catchTarget, setCatchTarget] = useState(null)

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 500)
        return () => clearTimeout(t)
    }, [search])

    useEffect(() => { setPage(1) }, [debouncedSearch, rarity])

    const loadValley = useCallback(async () => {
        setLoading(true)
        try {
            const data = await valleyApi.listAvailable({ page, limit: 20, rarity: rarity || undefined, search: debouncedSearch || undefined })
            setItems(data.items || [])
            setTotalPages(data.totalPages || 1)
        } catch (err) {
            toast.showError(err.message || 'Không thể tải Thung Lũng')
        } finally {
            setLoading(false)
        }
    }, [page, rarity, debouncedSearch])

    useEffect(() => { loadValley() }, [loadValley])

    const loadBalls = useCallback(async () => {
        try {
            const data = await gameApi.getInventory()
            const inventory = data.inventory || []
            setBalls(inventory.filter((e) => e.item?.type === 'ball' || /ball/i.test(e.item?.name || '')))
        } catch (_) {
            // silently fail — user will see error when opening catch modal
        }
    }, [])

    useEffect(() => { loadBalls() }, [loadBalls])

    const rarityOptions = ['', 'd', 'c', 'b', 'a', 's', 'ss', 'sss', 'sss+']
    const rarityLabels = { '': 'Tất cả', d: 'D', c: 'C', b: 'B', a: 'A', s: 'S', ss: 'SS', sss: 'SSS', 'sss+': 'SSS+' }

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="border border-blue-300 rounded-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title="Tìm Kiếm" />
                <div className="p-3 flex flex-wrap gap-3 items-center">
                    <input
                        type="text"
                        placeholder="Tên Pokémon..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:border-blue-400"
                    />
                    <div className="flex gap-1 flex-wrap">
                        {rarityOptions.map((r) => {
                            const style = r ? getRarityStyle(r) : null
                            return (
                                <button
                                    key={r}
                                    onClick={() => setRarity(r)}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-colors ${
                                        rarity === r
                                            ? 'bg-blue-600 border-blue-700 text-white'
                                            : style
                                                ? `${style.badge} border-transparent opacity-80 hover:opacity-100`
                                                : 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {rarityLabels[r]}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Grid */}
            <div className="border border-blue-400 rounded-lg overflow-hidden shadow-sm bg-blue-50">
                <SectionHeader title="Pokémon Trong Thung Lũng" />
                <div className="p-4 bg-white min-h-[280px]">
                    {loading ? (
                        <div className="text-center py-12 text-slate-400 font-bold animate-pulse">Đang tải...</div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 italic text-sm">
                            Thung Lũng đang trống. Hãy thả Pokémon vào đây!
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {items.map((item) => {
                                const display = resolvePokemonDisplay(item)
                                const style = getRarityStyle(item.rarity)
                                const speciesName = display.species?.name || 'Pokémon'

                                return (
                                    <div
                                        key={item._id}
                                        className={`group relative flex flex-col items-center p-2 rounded transition-all hover:scale-105 ${style.border} ${style.bg} ${style.shadow} ${style.frameClass}`}
                                    >
                                        {/* Rarity badge */}
                                        <span className={`absolute top-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-bl z-20 shadow-sm opacity-90 ${style.badge}`}>
                                            {style.label}
                                        </span>

                                        <SmartImage
                                            src={display.sprite || '/placeholder.png'}
                                            alt={speciesName}
                                            width={72}
                                            height={72}
                                            className="w-16 h-16 object-contain pixelated rendering-pixelated drop-shadow-sm transition-transform group-hover:scale-110 mt-2"
                                            fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                                        />

                                        <div className={`mt-1 flex w-full items-center justify-center gap-1 text-[10px] font-bold ${style.text}`}>
                                            <span className="truncate">{item.nickname || speciesName}</span>
                                            <VipCaughtStar level={item.obtainedVipMapLevel} className="text-[10px] shrink-0" />
                                        </div>

                                        <div className="flex flex-wrap items-center justify-center gap-1 mt-0.5 text-center w-full">
                                            <span className="text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-slate-700 font-bold border border-slate-200">
                                                Lv.{item.level}
                                            </span>
                                            {item.isShiny && (
                                                <span className="text-[9px] text-amber-500 font-bold bg-amber-50/80 px-1 py-0.5 rounded border border-amber-200">SHINY</span>
                                            )}
                                        </div>

                                        <div className="mt-0.5 text-[9px] text-slate-400 truncate w-full text-center">
                                            Từ: {item.releasedByUsername}
                                        </div>
                                        <div className="text-[9px] text-slate-400 text-center">
                                            ⏳ {formatCountdown(item.expiresAt)}
                                        </div>

                                        <button
                                            onClick={() => setCatchTarget(item)}
                                            className="mt-2 w-full text-center px-2 py-1.5 text-[11px] font-bold uppercase rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-400 transition-colors shadow-sm"
                                        >
                                            Bắt
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="bg-slate-50 border-t border-blue-200 p-3 text-center flex justify-center flex-wrap gap-1.5">
                        {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                className={`w-9 h-9 flex items-center justify-center text-xs font-bold rounded border shadow-sm transition-colors ${
                                    page === p
                                        ? 'bg-blue-600 border-blue-700 text-white'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {catchTarget && (
                <CatchModal
                    target={catchTarget}
                    balls={balls}
                    onClose={() => { setCatchTarget(null); loadBalls() }}
                    onCaught={() => { loadValley(); loadBalls() }}
                />
            )}
        </div>
    )
}

// ─── Release Tab ──────────────────────────────────────────────────────────────

function ValleyReleaseTab() {
    const toast = useToast()
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [confirmId, setConfirmId] = useState(null) // pokemon _id pending confirm
    const [releasing, setReleasing] = useState(null) // pokemon _id being released

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 500)
        return () => clearTimeout(t)
    }, [search])

    useEffect(() => { setPage(1) }, [debouncedSearch])

    const loadBox = useCallback(async () => {
        setLoading(true)
        try {
            const data = await valleyApi.getMyBox({ page, limit: 20, search: debouncedSearch || undefined })
            setItems(data.items || [])
            setTotalPages(data.totalPages || 1)
        } catch (err) {
            toast.showError(err.message || 'Không thể tải kho Pokémon')
        } finally {
            setLoading(false)
        }
    }, [page, debouncedSearch])

    useEffect(() => { loadBox() }, [loadBox])

    const handleRelease = async (pokemonId) => {
        setReleasing(pokemonId)
        try {
            const data = await valleyApi.release(pokemonId)
            toast.showSuccess(data.message || 'Đã thả vào Thung Lũng!')
            setConfirmId(null)
            loadBox()
        } catch (err) {
            toast.showError(err.message || 'Thả Pokémon thất bại')
        } finally {
            setReleasing(null)
        }
    }

    return (
        <div className="space-y-4">
            <div className="border border-blue-300 rounded-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title="Thả Pokémon Vào Thung Lũng" />
                <div className="p-3 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 font-medium">
                    Pokémon được thả sẽ tồn tại trong Thung Lũng <strong>30 ngày</strong>. Người chơi khác có thể bắt lại. Miễn phí, chỉ tốn bóng khi bắt.
                </div>
                <div className="p-3">
                    <input
                        type="text"
                        placeholder="Tìm Pokémon trong kho..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:border-blue-400"
                    />
                </div>
            </div>

            <div className="border border-blue-400 rounded-lg overflow-hidden shadow-sm bg-blue-50">
                <SectionHeader title="Kho Pokémon (Hộp)" />
                <div className="p-4 bg-white min-h-[280px]">
                    {loading ? (
                        <div className="text-center py-12 text-slate-400 font-bold animate-pulse">Đang tải...</div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 italic text-sm">
                            Kho trống hoặc không tìm thấy Pokémon.
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {items.map((p) => {
                                const display = resolvePokemonDisplay(p)
                                const style = getRarityStyle(p.pokemonId?.rarity || 'd')
                                const speciesName = display.species?.name || 'Pokémon'
                                const isConfirming = confirmId === p._id
                                const isReleasing = releasing === p._id

                                return (
                                    <div
                                        key={p._id}
                                        className={`group relative flex flex-col items-center p-2 rounded transition-all ${style.border} ${style.bg} ${style.shadow} ${style.frameClass}`}
                                    >
                                        <span className={`absolute top-0 right-0 text-[9px] font-bold px-1.5 py-0.5 rounded-bl z-20 shadow-sm opacity-90 ${style.badge}`}>
                                            {style.label}
                                        </span>

                                        <SmartImage
                                            src={display.sprite || '/placeholder.png'}
                                            alt={speciesName}
                                            width={72}
                                            height={72}
                                            className="w-16 h-16 object-contain pixelated rendering-pixelated drop-shadow-sm mt-2"
                                            fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                                        />

                                        <div className={`mt-1 flex w-full items-center justify-center gap-1 text-[10px] font-bold ${style.text}`}>
                                            <span className="truncate">{p.nickname || speciesName}</span>
                                            <VipCaughtStar level={p.obtainedVipMapLevel} className="text-[10px] shrink-0" />
                                        </div>

                                        <div className="flex flex-wrap items-center justify-center gap-1 mt-0.5 text-center w-full">
                                            <span className="text-[10px] bg-white/80 px-1.5 py-0.5 rounded text-slate-700 font-bold border border-slate-200">
                                                Lv.{p.level}
                                            </span>
                                            {p.isShiny && (
                                                <span className="text-[9px] text-amber-500 font-bold bg-amber-50/80 px-1 py-0.5 rounded border border-amber-200">SHINY</span>
                                            )}
                                        </div>

                                        {!isConfirming ? (
                                            <button
                                                onClick={() => setConfirmId(p._id)}
                                                className="mt-2 w-full text-center px-2 py-1.5 text-[11px] font-bold uppercase rounded border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-500 transition-colors shadow-sm"
                                            >
                                                Thả
                                            </button>
                                        ) : (
                                            <div className="mt-2 w-full flex gap-1">
                                                <button
                                                    onClick={() => handleRelease(p._id)}
                                                    disabled={isReleasing}
                                                    className="flex-1 text-center px-1 py-1.5 text-[10px] font-bold uppercase rounded border border-rose-400 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 transition-colors shadow-sm"
                                                >
                                                    {isReleasing ? '...' : 'Xác nhận'}
                                                </button>
                                                <button
                                                    onClick={() => setConfirmId(null)}
                                                    className="flex-1 text-center px-1 py-1.5 text-[10px] font-bold uppercase rounded border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors shadow-sm"
                                                >
                                                    Hủy
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="bg-slate-50 border-t border-blue-200 p-3 text-center flex justify-center flex-wrap gap-1.5">
                        {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                className={`w-9 h-9 flex items-center justify-center text-xs font-bold rounded border shadow-sm transition-colors ${
                                    page === p
                                        ? 'bg-blue-600 border-blue-700 text-white'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ValleyPage() {
    const [activeTab, setActiveTab] = useState('browse')

    const tabs = [
        { key: 'browse', label: 'Thung Lũng' },
        { key: 'release', label: 'Thả Pokémon' },
    ]

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12">
            <div className="text-center mb-6">
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Thung Lũng Pokémon</h1>
                <p className="text-slate-500 text-sm mt-1">Thả Pokémon vào tự nhiên, người chơi khác có thể bắt lại</p>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-blue-200 mb-4">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-5 py-2 text-sm font-bold border-b-2 transition-colors ${
                            activeTab === tab.key
                                ? 'border-blue-600 text-blue-700'
                                : 'border-transparent text-slate-500 hover:text-blue-600 hover:border-blue-300'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'browse' && <ValleyBrowseTab />}
            {activeTab === 'release' && <ValleyReleaseTab />}
        </div>
    )
}
