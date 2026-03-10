import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { moveApi } from '../../services/adminApi'
import { parseMoveCsvImport } from '../../utils/moveCsvImport'

const CATEGORY_LABELS = {
    physical: 'Vật lý',
    special: 'Đặc biệt',
    status: 'Trạng thái',
}

const RARITY_LABELS = {
    common: 'Phổ biến',
    uncommon: 'Ít gặp',
    rare: 'Hiếm',
    epic: 'Sử thi',
    legendary: 'Huyền thoại',
}

const RARITY_STYLES = {
    common: 'bg-slate-100 text-slate-600 border-slate-200',
    uncommon: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rare: 'bg-blue-50 text-blue-700 border-blue-200',
    epic: 'bg-amber-50 text-amber-700 border-amber-200',
    legendary: 'bg-red-50 text-red-700 border-red-200',
}

const TYPE_LABELS = {
    normal: 'Normal',
    fire: 'Fire',
    water: 'Water',
    grass: 'Grass',
    electric: 'Electric',
    ice: 'Ice',
    fighting: 'Fighting',
    poison: 'Poison',
    ground: 'Ground',
    flying: 'Flying',
    psychic: 'Psychic',
    bug: 'Bug',
    rock: 'Rock',
    ghost: 'Ghost',
    dragon: 'Dragon',
    dark: 'Dark',
    steel: 'Steel',
    fairy: 'Fairy',
}

const POKEMON_RARITY_LABELS = {
    'sss+': 'SSS+',
    sss: 'SSS',
    ss: 'SS',
    s: 'S',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
}

const MOVE_SORT_OPTIONS = [
    { value: 'createdAt_desc', label: 'Mới nhất' },
    { value: 'implemented_effects_desc', label: 'Có hiệu ứng trước' },
    { value: 'name_asc', label: 'Tên A -> Z' },
    { value: 'name_desc', label: 'Tên Z -> A' },
]

const EFFECT_STATE_OPTIONS = [
    { value: 'all', label: 'Mọi kỹ năng' },
    { value: 'implemented', label: 'Đã có hiệu ứng' },
    { value: 'incomplete', label: 'Chỉ còn hiệu ứng chưa hoàn chỉnh' },
    { value: 'none', label: 'Chưa có effectSpecs' },
]

const describeLearnScope = (move) => {
    const scope = String(move?.learnScope || 'all').toLowerCase()
    if (scope === 'move_type') {
        return 'Tự động theo hệ của kỹ năng'
    }
    if (scope === 'type') {
        const types = Array.isArray(move?.allowedTypes) ? move.allowedTypes : []
        if (types.length === 0) return 'Theo hệ (chưa cấu hình)'
        return `Theo hệ: ${types.map((entry) => TYPE_LABELS[entry] || entry).join(', ')}`
    }
    if (scope === 'species') {
        const species = Array.isArray(move?.allowedPokemonIds) ? move.allowedPokemonIds : []
        if (species.length === 0) return 'Pokemon đặc biệt (chưa cấu hình)'
        return `Pokemon đặc biệt: ${species.length} loài`
    }
    if (scope === 'rarity') {
        const rarities = Array.isArray(move?.allowedRarities) ? move.allowedRarities : []
        if (rarities.length === 0) return 'Theo độ hiếm (chưa cấu hình)'
        return `Theo độ hiếm: ${rarities.map((entry) => POKEMON_RARITY_LABELS[entry] || entry).join(', ')}`
    }
    return 'Mọi Pokemon'
}

export default function MoveListPage() {
    const [moves, setMoves] = useState([])
    const [allMoves, setAllMoves] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('')
    const [rarityFilter, setRarityFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })
    const [meta, setMeta] = useState({ types: [], categories: [], rarities: [] })
    const [sortBy, setSortBy] = useState('createdAt_desc')
    const [effectStateFilter, setEffectStateFilter] = useState('all')

    const [effectProgress, setEffectProgress] = useState(null)
    const [effectProgressLoading, setEffectProgressLoading] = useState(false)
    const [effectProgressError, setEffectProgressError] = useState('')

    const [historyLogs, setHistoryLogs] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyError, setHistoryError] = useState('')
    const [historySearch, setHistorySearch] = useState('')
    const [historyMoveId, setHistoryMoveId] = useState('')
    const [historyPage, setHistoryPage] = useState(1)
    const [historyPagination, setHistoryPagination] = useState({ total: 0, pages: 0 })
    const [historyShopMoves, setHistoryShopMoves] = useState([])

    const [moveCsvImportText, setMoveCsvImportText] = useState('')
    const [moveCsvImporting, setMoveCsvImporting] = useState(false)
    const [moveCsvImportReport, setMoveCsvImportReport] = useState(null)
    const moveCsvImportFileRef = useRef(null)

    const [bulkShopPrice, setBulkShopPrice] = useState('5000')
    const [bulkShopApplying, setBulkShopApplying] = useState(false)
    const [bulkShopHiding, setBulkShopHiding] = useState(false)
    const [bulkShopReport, setBulkShopReport] = useState(null)

    useEffect(() => {
        loadMoves()
    }, [search, typeFilter, categoryFilter, rarityFilter, sortBy, effectStateFilter, page])

    useEffect(() => {
        loadAllMoves()
    }, [])

    useEffect(() => {
        loadEffectProgress()
    }, [])

    useEffect(() => {
        loadPurchaseHistory()
    }, [historySearch, historyMoveId, historyPage])

    const loadMoves = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await moveApi.list({
                search,
                type: typeFilter,
                category: categoryFilter,
                rarity: rarityFilter,
                sortBy,
                effectState: effectStateFilter,
                page,
                limit: 20,
            })
            setMoves(data.moves || [])
            setPagination(data.pagination || { total: 0, pages: 0 })
            setMeta(data.meta || { types: [], categories: [], rarities: [] })
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadEffectProgress = async () => {
        try {
            setEffectProgressLoading(true)
            setEffectProgressError('')
            const data = await moveApi.getEffectProgress()
            setEffectProgress(data)
        } catch (err) {
            setEffectProgressError(err.message)
            setEffectProgress(null)
        } finally {
            setEffectProgressLoading(false)
        }
    }

    const loadPurchaseHistory = async () => {
        try {
            setHistoryLoading(true)
            setHistoryError('')
            const data = await moveApi.getPurchaseHistory({
                search: historySearch,
                moveId: historyMoveId,
                page: historyPage,
                limit: 20,
            })
            setHistoryLogs(data.logs || [])
            setHistoryPagination(data.pagination || { total: 0, pages: 0 })
            setHistoryShopMoves(data?.meta?.shopMoves || [])
        } catch (err) {
            setHistoryError(err.message)
        } finally {
            setHistoryLoading(false)
        }
    }

    const loadAllMoves = async () => {
        try {
            const limit = 100
            let pageCursor = 1
            let totalPages = 1
            const collected = []

            do {
                const data = await moveApi.list({ page: pageCursor, limit })
                if (Array.isArray(data?.moves) && data.moves.length > 0) {
                    collected.push(...data.moves)
                }

                const parsedPages = Number.parseInt(data?.pagination?.pages, 10)
                totalPages = Number.isFinite(parsedPages) && parsedPages > 0 ? parsedPages : 1
                pageCursor += 1
            } while (pageCursor <= totalPages)

            const uniqueById = new Map()
            collected.forEach((entry) => {
                if (!entry?._id || uniqueById.has(entry._id)) return
                uniqueById.set(entry._id, entry)
            })
            setAllMoves([...uniqueById.values()])
        } catch (_err) {
            setAllMoves([])
        }
    }

    const handleMoveCsvFileChange = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        try {
            const text = await file.text()
            setMoveCsvImportText(text)
            setError('')
        } catch (err) {
            setError(`Đọc file import kỹ năng thất bại: ${err.message}`)
        }
    }

    const handleApplyMoveCsvImport = async () => {
        const BATCH_SIZE = 500

        if (!moveCsvImportText.trim()) {
            setError('Vui lòng dán dữ liệu Excel/CSV kỹ năng trước khi import.')
            return
        }

        const parsed = parseMoveCsvImport(moveCsvImportText, allMoves)
        setMoveCsvImportReport(parsed.report)

        if (!Array.isArray(parsed.moves) || parsed.moves.length === 0) {
            setError('Không có kỹ năng hợp lệ để import.')
            return
        }

        try {
            setMoveCsvImporting(true)
            setError('')

            let aggregateRequested = 0
            let aggregateCreated = 0
            let aggregateSkipped = 0
            let aggregateErrors = 0
            const aggregateServerErrors = []
            let aggregateHiddenServerErrors = 0

            for (let index = 0; index < parsed.moves.length; index += BATCH_SIZE) {
                const batch = parsed.moves.slice(index, index + BATCH_SIZE)
                const result = await moveApi.importMoveCsv(batch)

                aggregateRequested += Number.parseInt(result?.requestedCount, 10) || batch.length
                aggregateCreated += Number.parseInt(result?.createdCount, 10) || 0
                aggregateSkipped += Number.parseInt(result?.skippedCount, 10) || 0
                aggregateErrors += Number.parseInt(result?.errorCount, 10) || 0

                if (Array.isArray(result?.errors)) {
                    const remaining = Math.max(0, 100 - aggregateServerErrors.length)
                    if (remaining > 0) {
                        aggregateServerErrors.push(...result.errors.slice(0, remaining))
                    }
                    aggregateHiddenServerErrors += Math.max(0, result.errors.length - remaining)
                }
                aggregateHiddenServerErrors += Number.parseInt(result?.hiddenErrorCount, 10) || 0
            }

            setMoveCsvImportReport((prev) => {
                const base = prev || parsed.report
                return {
                    ...base,
                    requestedCount: aggregateRequested || parsed.moves.length,
                    createdCount: aggregateCreated,
                    skippedCount: aggregateSkipped,
                    errorCount: aggregateErrors,
                    serverErrors: aggregateServerErrors,
                    hiddenServerErrorCount: aggregateHiddenServerErrors,
                }
            })

            await loadAllMoves()
            await loadMoves()
            await loadEffectProgress()

            const createdCount = aggregateCreated
            const errorCount = aggregateErrors
            if (createdCount === 0 && errorCount > 0) {
                setError(`Import hoàn tất nhưng không tạo được kỹ năng nào (${errorCount} lỗi).`)
            }
        } catch (err) {
            setError(`Import kỹ năng thất bại: ${err.message}`)
        } finally {
            setMoveCsvImporting(false)
        }
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa kỹ năng ${name}?`)) return
        try {
            await moveApi.delete(id)
            await Promise.all([loadMoves(), loadEffectProgress()])
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    const handleBulkApplyShop = async () => {
        const parsedPrice = Number.parseInt(String(bulkShopPrice || '').trim(), 10)
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
            setError('Giá bán hàng loạt phải là số nguyên không âm.')
            return
        }

        try {
            setBulkShopApplying(true)
            setError('')
            const data = await moveApi.bulkApplyShop({ shopPrice: parsedPrice })
            setBulkShopReport({ ...(data?.result || {}), action: 'apply' })

            await Promise.all([
                loadMoves(),
                loadAllMoves(),
                loadPurchaseHistory(),
            ])
        } catch (err) {
            setError(err.message)
        } finally {
            setBulkShopApplying(false)
        }
    }

    const handleBulkHideShop = async () => {
        try {
            setBulkShopHiding(true)
            setError('')
            const data = await moveApi.bulkHideShop({ onlyImplemented: true })
            setBulkShopReport({ ...(data?.result || {}), action: 'hide' })

            await Promise.all([
                loadMoves(),
                loadAllMoves(),
                loadPurchaseHistory(),
            ])
        } catch (err) {
            setError(err.message)
        } finally {
            setBulkShopHiding(false)
        }
    }

    const formatDateTime = (value) => {
        if (!value) return '--'
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return '--'
        return date.toLocaleString('vi-VN')
    }

    const eligibleImplementedMovesCount = allMoves.filter((move) => Number(move?.implementedEffectCount || 0) > 0).length

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Kỹ Năng</h1>
                <Link
                    to="/admin/moves/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                        type="text"
                        placeholder="Tìm theo tên kỹ năng..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả hệ</option>
                        {meta.types.map((type) => (
                            <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                        ))}
                    </select>
                    <select
                        value={categoryFilter}
                        onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả nhóm</option>
                        {meta.categories.map((category) => (
                            <option key={category} value={category}>{CATEGORY_LABELS[category] || category}</option>
                        ))}
                    </select>
                    <select
                        value={rarityFilter}
                        onChange={(e) => { setRarityFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả độ hiếm</option>
                        {meta.rarities.map((rarity) => (
                            <option key={rarity} value={rarity}>{RARITY_LABELS[rarity] || rarity}</option>
                        ))}
                    </select>
                    <select
                        value={effectStateFilter}
                        onChange={(e) => { setEffectStateFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        {EFFECT_STATE_OPTIONS.map((entry) => (
                            <option key={entry.value} value={entry.value}>{entry.label}</option>
                        ))}
                    </select>
                    <select
                        value={sortBy}
                        onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        {MOVE_SORT_OPTIONS.map((entry) => (
                            <option key={entry.value} value={entry.value}>{entry.label}</option>
                        ))}
                    </select>
                </div>

                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-bold text-emerald-900">Import kỹ năng từ Excel/CSV/TXT</p>
                        <div className="flex gap-2">
                            <input
                                ref={moveCsvImportFileRef}
                                type="file"
                                accept=".csv,.txt,.tsv"
                                onChange={handleMoveCsvFileChange}
                                className="hidden"
                            />
                            <button
                                type="button"
                                onClick={() => moveCsvImportFileRef.current?.click()}
                                disabled={moveCsvImporting}
                                className="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-bold text-emerald-900"
                            >
                                Tải file CSV/TXT
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyMoveCsvImport}
                                disabled={moveCsvImporting || !moveCsvImportText.trim()}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                            >
                                {moveCsvImporting ? 'Đang import...' : 'Import kỹ năng'}
                            </button>
                        </div>
                    </div>

                    <textarea
                        rows={5}
                        value={moveCsvImportText}
                        onChange={(e) => setMoveCsvImportText(e.target.value)}
                        placeholder={'Tên chiêu\tHệ\tPhân loại\tSức mạnh\tĐộ chính xác\tPP\tMô tả\nThunderbolt\tElectric\tSpecial\t90\t100\t15\tMay cause paralysis.'}
                        className="w-full px-3 py-2 bg-white border border-emerald-200 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-emerald-500"
                    />
                    <p className="mt-2 text-[11px] text-emerald-800">
                        Hỗ trợ dán trực tiếp từ Excel (tab), hoặc file CSV/TXT. Cột bắt buộc: Tên chiêu, Hệ. Cột khuyến nghị: Phân loại, Sức mạnh, Độ chính xác, PP, Mô tả.
                    </p>

                    {moveCsvImportReport && (
                        <div className="mt-2 text-xs text-emerald-900 bg-white/70 border border-emerald-200 rounded p-2">
                            <div className="font-semibold">
                                Đọc {moveCsvImportReport.totalRows} dòng • Hợp lệ {moveCsvImportReport.parsedRows} • Bỏ qua {moveCsvImportReport.skippedRows}
                                {Number.isFinite(moveCsvImportReport.createdCount) ? ` • Đã tạo ${moveCsvImportReport.createdCount}` : ''}
                                {Number.isFinite(moveCsvImportReport.errorCount) ? ` • Lỗi ${moveCsvImportReport.errorCount}` : ''}
                            </div>
                            {Array.isArray(moveCsvImportReport.warnings) && moveCsvImportReport.warnings.length > 0 && (
                                <div className="mt-1">
                                    <div className="font-semibold">Cảnh báo parser:</div>
                                    <ul className="list-disc list-inside">
                                        {moveCsvImportReport.warnings.map((warning, index) => (
                                            <li key={`${warning}-${index}`}>{warning}</li>
                                        ))}
                                        {moveCsvImportReport.hiddenWarningCount > 0 && (
                                            <li>... và {moveCsvImportReport.hiddenWarningCount} cảnh báo khác</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                            {Array.isArray(moveCsvImportReport.serverErrors) && moveCsvImportReport.serverErrors.length > 0 && (
                                <div className="mt-1">
                                    <div className="font-semibold">Lỗi khi lưu:</div>
                                    <ul className="list-disc list-inside">
                                        {moveCsvImportReport.serverErrors.map((message, index) => (
                                            <li key={`${message}-${index}`}>{message}</li>
                                        ))}
                                        {moveCsvImportReport.hiddenServerErrorCount > 0 && (
                                            <li>... và {moveCsvImportReport.hiddenServerErrorCount} lỗi khác</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                        <div>
                            <p className="text-sm font-bold text-indigo-900">Đưa nhanh kỹ năng lên shop (chỉ skill có effect)</p>
                            <p className="text-[11px] text-indigo-700 mt-1">
                                Chỉ áp dụng cho skill có `implementedEffectCount &gt; 0`. Bạn có thể đặt cùng 1 giá bán cho toàn bộ skill đủ điều kiện.
                            </p>
                        </div>
                        <div className="flex items-end gap-2">
                            <div>
                                <label className="block text-[11px] font-bold uppercase text-indigo-800 mb-1">Giá bán hàng loạt</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={bulkShopPrice}
                                    onChange={(e) => setBulkShopPrice(e.target.value)}
                                    className="w-36 px-3 py-1.5 bg-white border border-indigo-300 rounded text-sm text-slate-800 focus:outline-none focus:border-indigo-500"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleBulkApplyShop}
                                disabled={bulkShopApplying || bulkShopHiding || eligibleImplementedMovesCount <= 0}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                            >
                                {bulkShopApplying ? 'Đang áp dụng...' : 'Up shop nhanh'}
                            </button>
                            <button
                                type="button"
                                onClick={handleBulkHideShop}
                                disabled={bulkShopApplying || bulkShopHiding || eligibleImplementedMovesCount <= 0}
                                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                            >
                                {bulkShopHiding ? 'Đang ẩn...' : 'Ẩn khỏi shop hàng loạt'}
                            </button>
                        </div>
                    </div>

                    <div className="text-xs text-indigo-800 bg-white/70 border border-indigo-200 rounded p-2">
                        Skill đủ điều kiện hiện tại: <span className="font-bold">{eligibleImplementedMovesCount.toLocaleString('vi-VN')}</span>
                    </div>

                    {bulkShopReport && (
                        <div className="mt-2 text-xs text-indigo-900 bg-white border border-indigo-200 rounded p-2">
                            <div className="font-semibold">
                                Thao tác: {bulkShopReport.action === 'hide' ? 'Ẩn khỏi shop' : 'Up shop nhanh'} •
                                {bulkShopReport.action !== 'hide' ? `Giá áp dụng: ${Number(bulkShopReport.shopPrice || 0).toLocaleString('vi-VN')} • ` : ''}
                                Đủ điều kiện: {Number(bulkShopReport.eligibleCount || 0).toLocaleString('vi-VN')} •
                                Đã cập nhật: {Number(bulkShopReport.updatedCount || 0).toLocaleString('vi-VN')} •
                                Không đổi: {Number(bulkShopReport.unchangedCount || 0).toLocaleString('vi-VN')}
                            </div>
                        </div>
                    )}
                </div>

                <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-bold text-indigo-900">Tiến độ hiệu ứng kỹ năng</p>
                        <button
                            type="button"
                            onClick={loadEffectProgress}
                            disabled={effectProgressLoading}
                            className="px-3 py-1.5 bg-white border border-indigo-300 hover:bg-indigo-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-bold text-indigo-900"
                        >
                            {effectProgressLoading ? 'Đang tải...' : 'Làm mới tiến độ'}
                        </button>
                    </div>

                    {effectProgressError && (
                        <div className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{effectProgressError}</div>
                    )}

                    {effectProgress && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
                                <div className="bg-white border border-indigo-200 rounded p-2">
                                    <p className="text-[11px] text-indigo-600">Tổng kỹ năng</p>
                                    <p className="text-base font-bold text-indigo-900">{Number(effectProgress?.summary?.totalMoves || 0).toLocaleString('vi-VN')}</p>
                                </div>
                                <div className="bg-white border border-emerald-200 rounded p-2">
                                    <p className="text-[11px] text-emerald-600">Kỹ năng đã có hiệu ứng</p>
                                    <p className="text-base font-bold text-emerald-800">{Number(effectProgress?.summary?.movesWithImplementedEffects || 0).toLocaleString('vi-VN')}</p>
                                </div>
                                <div className="bg-white border border-amber-200 rounded p-2">
                                    <p className="text-[11px] text-amber-600">Kỹ năng chỉ còn chưa hoàn chỉnh</p>
                                    <p className="text-base font-bold text-amber-800">{Number(effectProgress?.summary?.movesOnlyIncompleteEffects || 0).toLocaleString('vi-VN')}</p>
                                </div>
                                <div className="bg-white border border-blue-200 rounded p-2">
                                    <p className="text-[11px] text-blue-600">Tỉ lệ hoàn chỉnh</p>
                                    <p className="text-base font-bold text-blue-800">{Number(effectProgress?.summary?.completionRate || 0).toLocaleString('vi-VN')}%</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <div className="bg-white border border-emerald-200 rounded p-2">
                                    <p className="text-xs font-bold text-emerald-800 mb-1 uppercase">Hiệu ứng đã hoàn chỉnh (id / EN / VI)</p>
                                    <div className="max-h-56 overflow-auto border border-emerald-100 rounded">
                                        <table className="w-full text-xs">
                                            <thead className="bg-emerald-50 sticky top-0">
                                                <tr>
                                                    <th className="px-2 py-1 text-left">ID</th>
                                                    <th className="px-2 py-1 text-left">Tên EN</th>
                                                    <th className="px-2 py-1 text-left">Tên VI</th>
                                                    <th className="px-2 py-1 text-right">Số lần</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(effectProgress.completeEffects || []).map((entry) => (
                                                    <tr key={entry.id} className="border-t border-emerald-100">
                                                        <td className="px-2 py-1 font-mono text-[11px]">{entry.id}</td>
                                                        <td className="px-2 py-1">{entry.nameEn}</td>
                                                        <td className="px-2 py-1">{entry.nameVi}</td>
                                                        <td className="px-2 py-1 text-right font-semibold">{Number(entry.usageCount || 0).toLocaleString('vi-VN')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="bg-white border border-amber-200 rounded p-2">
                                    <p className="text-xs font-bold text-amber-800 mb-1 uppercase">Hiệu ứng chưa hoàn chỉnh (id / EN / VI)</p>
                                    <div className="max-h-56 overflow-auto border border-amber-100 rounded">
                                        <table className="w-full text-xs">
                                            <thead className="bg-amber-50 sticky top-0">
                                                <tr>
                                                    <th className="px-2 py-1 text-left">ID</th>
                                                    <th className="px-2 py-1 text-left">Tên EN</th>
                                                    <th className="px-2 py-1 text-left">Tên VI</th>
                                                    <th className="px-2 py-1 text-right">Số lần</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(effectProgress.incompleteEffects || []).map((entry) => (
                                                    <tr key={entry.id} className="border-t border-amber-100">
                                                        <td className="px-2 py-1 font-mono text-[11px]">{entry.id}</td>
                                                        <td className="px-2 py-1">{entry.nameEn}</td>
                                                        <td className="px-2 py-1">{entry.nameVi}</td>
                                                        <td className="px-2 py-1 text-right font-semibold">{Number(entry.usageCount || 0).toLocaleString('vi-VN')}</td>
                                                    </tr>
                                                ))}
                                                {(effectProgress.incompleteEffects || []).length === 0 && (
                                                    <tr>
                                                        <td colSpan="4" className="px-2 py-2 text-slate-500 italic">Không còn hiệu ứng chưa hoàn chỉnh.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                    <>
                        <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col w-full max-w-full overflow-x-auto overscroll-x-contain">
                            <div className="overflow-auto custom-scrollbar max-h-[60vh] sm:max-h-[500px] w-full">
                                <table className="w-full text-sm whitespace-nowrap min-w-[1100px] lg:min-w-[1300px]">
                                    <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Tên</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Hệ</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Nhóm</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Phân loại học</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Power</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Acc</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">PP</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Độ hiếm</th>
                                            <th className="px-4 py-3 text-left text-blue-900 font-bold uppercase text-xs">Shop</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Giá</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Effects</th>
                                            <th className="px-4 py-3 text-right text-blue-900 font-bold uppercase text-xs">Hành động</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {moves.map((move) => (
                                            <tr key={move._id} className="hover:bg-blue-50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-slate-800">{move.name}</div>
                                                    <div className="text-xs text-slate-500 truncate max-w-[240px]">{move.description || 'Không có mô tả'}</div>
                                                </td>
                                                <td className="px-4 py-3 text-slate-700">{TYPE_LABELS[move.type] || move.type}</td>
                                                <td className="px-4 py-3 text-slate-700">{CATEGORY_LABELS[move.category] || move.category}</td>
                                                <td className="px-4 py-3 text-slate-700 max-w-[260px] truncate" title={describeLearnScope(move)}>{describeLearnScope(move)}</td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">{move.power ?? '--'}</td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">{move.accuracy ?? '--'}</td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">{move.pp ?? '--'}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${RARITY_STYLES[move.rarity] || ''}`}>
                                                        {RARITY_LABELS[move.rarity] || move.rarity}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {move.isShopEnabled ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                            Đang bán
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-slate-100 text-slate-600 border-slate-200">
                                                            Ẩn shop
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right text-slate-700 font-bold">{Number(move.shopPrice || 0).toLocaleString('vi-VN')}</td>
                                                <td className="px-4 py-3 text-right text-slate-700">
                                                    <span className="font-bold text-emerald-700">{Number(move.implementedEffectCount || 0)}</span>
                                                    <span className="text-slate-400"> / </span>
                                                    <span className="font-semibold">{Number(move.effectSpecCount || 0)}</span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <Link
                                                        to={`/admin/moves/${move._id}/edit`}
                                                        className="inline-block px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold mr-2 shadow-sm"
                                                    >
                                                        Sửa
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDelete(move._id, move.name)}
                                                        className="inline-block px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-bold shadow-sm"
                                                    >
                                                        Xóa
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {moves.length === 0 && (
                                            <tr>
                                                <td colSpan="12" className="px-4 py-8 text-center text-slate-500 italic">
                                                    Chưa có kỹ năng nào.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {pagination.pages > 1 && (() => {
                            const totalPages = pagination.pages
                            const SIBLING = 2
                            const pages = []
                            const addPage = (n) => { if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n) }
                            addPage(1)
                            for (let i = page - SIBLING; i <= page + SIBLING; i++) addPage(i)
                            addPage(totalPages)
                            pages.sort((a, b) => a - b)
                            const items = []
                            for (let i = 0; i < pages.length; i++) {
                                if (i > 0 && pages[i] - pages[i - 1] > 1) items.push('...' + i)
                                items.push(pages[i])
                            }
                            return (
                                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-3 text-slate-600 text-xs font-medium">
                                    <div className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
                                        Tổng <span className="font-bold">{pagination.total}</span> bản ghi • Trang <span className="font-bold text-blue-700">{page}</span>/{totalPages}
                                    </div>
                                    <div className="flex flex-wrap justify-center gap-1">
                                        <button
                                            disabled={page === 1}
                                            onClick={() => setPage(page - 1)}
                                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                        >
                                            &laquo;
                                        </button>
                                        {items.map((item) =>
                                            typeof item === 'string' ? (
                                                <span key={item} className="px-1 py-1 text-slate-400 select-none">…</span>
                                            ) : (
                                                <button
                                                    key={item}
                                                    onClick={() => setPage(item)}
                                                    className={`min-w-[32px] px-2 py-1 border rounded text-xs font-bold transition-colors shadow-sm ${page === item
                                                        ? 'bg-blue-600 border-blue-600 text-white'
                                                        : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                                        }`}
                                                >
                                                    {item}
                                                </button>
                                            )
                                        )}
                                        <button
                                            disabled={page >= totalPages}
                                            onClick={() => setPage(page + 1)}
                                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                        >
                                            &raquo;
                                        </button>
                                    </div>
                                </div>
                            )
                        })()}
                    </>
                )}

                <div className="mt-8 border border-blue-200 rounded-lg overflow-hidden shadow-sm bg-white">
                    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 border-b border-blue-600">
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider drop-shadow-sm">Lịch Sử Mua Kỹ Năng</h2>
                    </div>

                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2">
                        <input
                            type="text"
                            placeholder="Tìm theo người mua / kỹ năng..."
                            value={historySearch}
                            onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1) }}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                        />
                        <select
                            value={historyMoveId}
                            onChange={(e) => { setHistoryMoveId(e.target.value); setHistoryPage(1) }}
                            className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
                        >
                            <option value="">Tất cả kỹ năng shop</option>
                            {historyShopMoves.map((entry) => (
                                <option key={entry._id} value={entry._id}>{entry.name}</option>
                            ))}
                        </select>
                    </div>

                    {historyError && (
                        <div className="p-3 bg-red-50 text-red-700 border-b border-red-200 text-sm">{historyError}</div>
                    )}

                    <div className="overflow-auto custom-scrollbar max-h-[400px]">
                        <table className="w-full text-sm min-w-[980px]">
                            <thead className="bg-blue-50 border-b border-blue-100 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Thời gian</th>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Người mua</th>
                                    <th className="px-3 py-2 text-left text-blue-900 font-bold uppercase text-xs">Kỹ năng</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">SL</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Đơn giá</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Tổng</th>
                                    <th className="px-3 py-2 text-right text-blue-900 font-bold uppercase text-xs">Ví trước/sau</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {historyLoading ? (
                                    <tr>
                                        <td colSpan="7" className="px-4 py-8 text-center text-slate-500 italic">Đang tải lịch sử...</td>
                                    </tr>
                                ) : historyLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="px-4 py-8 text-center text-slate-500 italic">Chưa có dữ liệu mua kỹ năng.</td>
                                    </tr>
                                ) : historyLogs.map((log) => (
                                    <tr key={log._id} className="hover:bg-blue-50 transition-colors">
                                        <td className="px-3 py-2 text-slate-700">{formatDateTime(log.createdAt)}</td>
                                        <td className="px-3 py-2 text-slate-800 font-semibold">{log?.buyer?.username || 'Không rõ'}</td>
                                        <td className="px-3 py-2 text-slate-700">{log?.move?.name || 'Kỹ năng đã xóa'}</td>
                                        <td className="px-3 py-2 text-right font-bold text-slate-700">{Number(log.quantity || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right text-slate-700">{Number(log.unitPrice || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right font-bold text-slate-800">{Number(log.totalCost || 0).toLocaleString('vi-VN')}</td>
                                        <td className="px-3 py-2 text-right text-slate-600">{Number(log.walletGoldBefore || 0).toLocaleString('vi-VN')} → {Number(log.walletGoldAfter || 0).toLocaleString('vi-VN')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {historyPagination.pages > 1 && (() => {
                        const totalPages = historyPagination.pages
                        const SIBLING = 2
                        const pages = []
                        const addPage = (n) => { if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n) }
                        addPage(1)
                        for (let i = historyPage - SIBLING; i <= historyPage + SIBLING; i++) addPage(i)
                        addPage(totalPages)
                        pages.sort((a, b) => a - b)
                        const items = []
                        for (let i = 0; i < pages.length; i++) {
                            if (i > 0 && pages[i] - pages[i - 1] > 1) items.push('...' + i)
                            items.push(pages[i])
                        }
                        return (
                            <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 justify-between items-center p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
                                <span className="text-center sm:text-left">Tổng {historyPagination.total} giao dịch • Trang {historyPage}/{totalPages}</span>
                                <div className="flex flex-wrap justify-center gap-1">
                                    <button
                                        disabled={historyPage <= 1}
                                        onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold min-w-[32px] text-center"
                                    >
                                        &laquo;
                                    </button>
                                    {items.map((item) =>
                                        typeof item === 'string' ? (
                                            <span key={item} className="px-1 py-1 text-slate-400 select-none">…</span>
                                        ) : (
                                            <button
                                                key={item}
                                                onClick={() => setHistoryPage(item)}
                                                className={`min-w-[32px] px-2 py-1 border rounded font-bold text-center ${historyPage === item
                                                    ? 'bg-blue-600 border-blue-600 text-white'
                                                    : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                                    }`}
                                            >
                                                {item}
                                            </button>
                                        )
                                    )}
                                    <button
                                        disabled={historyPage >= totalPages}
                                        onClick={() => setHistoryPage((prev) => Math.min(totalPages, prev + 1))}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold min-w-[32px] text-center"
                                    >
                                        &raquo;
                                    </button>
                                </div>
                            </div>
                        )
                    })()}
                </div>
            </div>

            <div className="text-center mt-6">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>
        </div>
    )
}
