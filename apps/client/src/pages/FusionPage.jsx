import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'
import { resolvePokemonSprite } from '../utils/pokemonFormUtils'
import { getRarityStyle } from '../utils/rarityStyles'

const LIST_PAGE_LIMIT = 24
const MATERIAL_PAGE_LIMIT = 24

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const normalizeId = (value = '') => String(value || '').trim()
const formatDisplayForm = (value = 'normal') => {
    const normalized = normalizeFormId(value)
    if (normalized === 'normal') return 'thường'
    return normalized
}
const resolveMilestoneLabel = (fusionLevel = 0, milestones = []) => {
    const normalizedLevel = Math.max(0, Number(fusionLevel || 0))
    const rows = Array.isArray(milestones) ? milestones : []
    const matched = rows.find((entry) => {
        const from = Number.parseInt(entry?.from, 10)
        const to = entry?.to === null || entry?.to === undefined ? null : Number.parseInt(entry?.to, 10)
        if (!Number.isFinite(from)) return false
        if (to === null) return normalizedLevel >= from
        if (!Number.isFinite(to)) return false
        return normalizedLevel >= from && normalizedLevel <= to
    })
    return String(matched?.label || '').trim()
}

const buildPageItems = (currentPage, totalPages) => {
    const safeCurrent = Math.max(1, Number(currentPage || 1))
    const safeTotal = Math.max(1, Number(totalPages || 1))
    if (safeTotal <= 1) return [1]

    const rows = [1]
    const start = Math.max(2, safeCurrent - 2)
    const end = Math.min(safeTotal - 1, safeCurrent + 2)
    if (start > 2) rows.push('...')
    for (let page = start; page <= end; page += 1) rows.push(page)
    if (end < safeTotal - 1) rows.push('...')
    rows.push(safeTotal)
    return rows
}

const resolvePokemonDisplayName = (entry = null) => {
    const nickname = String(entry?.nickname || '').trim()
    const speciesName = String(entry?.pokemonId?.name || '').trim()
    return nickname || speciesName || 'Pokémon'
}

const resolvePokemonDisplaySprite = (entry = null) => resolvePokemonSprite({
    species: entry?.pokemonId || {},
    formId: entry?.formId,
    isShiny: Boolean(entry?.isShiny),
})

const resolveRarityRank = (rarity = 'd') => {
    const normalized = String(rarity || '').trim().toLowerCase()
    const ranking = {
        'sss+': 8,
        sss: 7,
        ss: 6,
        s: 5,
        a: 4,
        b: 3,
        c: 2,
        d: 1,
        e: 0,
    }
    return Number(ranking[normalized] || 0)
}

const resolveMaterialServerSort = (value = 'recommended') => {
    const normalized = String(value || '').trim()
    if (normalized === 'fusionDesc') return 'fusion'
    if (normalized === 'rarityDesc') return 'rarity'
    return 'level'
}

export default function FusionPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { showSuccess, showError } = useToast()
    const isDetailMode = Boolean(id)
    const materialSectionRef = useRef(null)

    const [fusionConfigLoading, setFusionConfigLoading] = useState(true)
    const [fusionConfigError, setFusionConfigError] = useState('')
    const [fusionConfig, setFusionConfig] = useState(null)
    const [selectedFusionItemByField, setSelectedFusionItemByField] = useState({})

    const [zoneLoading, setZoneLoading] = useState(false)
    const [zoneError, setZoneError] = useState('')
    const [zoneRows, setZoneRows] = useState([])
    const [zoneSearchInput, setZoneSearchInput] = useState('')
    const [zoneSearch, setZoneSearch] = useState('')
    const [zonePage, setZonePage] = useState(1)
    const [zonePagination, setZonePagination] = useState({ page: 1, pages: 1, total: 0, limit: LIST_PAGE_LIMIT })

    const [targetLoading, setTargetLoading] = useState(false)
    const [targetError, setTargetError] = useState('')
    const [targetPokemon, setTargetPokemon] = useState(null)

    const [materialLoading, setMaterialLoading] = useState(false)
    const [materialError, setMaterialError] = useState('')
    const [materialRows, setMaterialRows] = useState([])
    const [materialSearchInput, setMaterialSearchInput] = useState('')
    const [materialSearch, setMaterialSearch] = useState('')
    const [materialSort, setMaterialSort] = useState('recommended')
    const [materialPage, setMaterialPage] = useState(1)
    const [materialPagination, setMaterialPagination] = useState({ page: 1, pages: 1, total: 0, limit: MATERIAL_PAGE_LIMIT })
    const [selectedMaterialPokemonId, setSelectedMaterialPokemonId] = useState('')

    const [fusing, setFusing] = useState(false)
    const [lastFusionResult, setLastFusionResult] = useState(null)

    const itemSlots = Array.isArray(fusionConfig?.fusion?.itemSlots) ? fusionConfig.fusion.itemSlots : []
    const rulePreview = fusionConfig?.fusion?.rulePreview || {}
    const milestones = Array.isArray(rulePreview?.milestones) ? rulePreview.milestones : []

    const luckySlot = itemSlots.find((entry) => entry?.effectType === 'fusionLuckyStone') || null
    const superSlot = itemSlots.find((entry) => entry?.effectType === 'superFusionStone') || null
    const protectionSlot = itemSlots.find((entry) => entry?.effectType === 'fusionProtectionStone') || null

    const selectedLuckyItem = luckySlot
        ? (luckySlot.items || []).find((entry) => normalizeId(entry?._id) === normalizeId(selectedFusionItemByField?.[luckySlot.requestField])) || null
        : null
    const selectedSuperItem = superSlot
        ? (superSlot.items || []).find((entry) => normalizeId(entry?._id) === normalizeId(selectedFusionItemByField?.[superSlot.requestField])) || null
        : null
    const selectedProtectionItem = protectionSlot
        ? (protectionSlot.items || []).find((entry) => normalizeId(entry?._id) === normalizeId(selectedFusionItemByField?.[protectionSlot.requestField])) || null
        : null

    const targetFusionLevel = Math.max(0, Number(targetPokemon?.fusionLevel || 0))
    const baseSuccessRateByLevel = Array.isArray(rulePreview?.baseSuccessRateByFusionLevel) ? rulePreview.baseSuccessRateByFusionLevel : []
    const totalStatBonusByLevel = Array.isArray(rulePreview?.totalStatBonusPercentByFusionLevel)
        ? rulePreview.totalStatBonusPercentByFusionLevel
        : []
    const baseSuccessRate = baseSuccessRateByLevel.length > 0
        ? Number(baseSuccessRateByLevel[Math.min(targetFusionLevel, baseSuccessRateByLevel.length - 1)] || 0)
        : 0
    const currentTotalStatBonusPercent = totalStatBonusByLevel.length > 0
        ? Number(totalStatBonusByLevel[Math.min(targetFusionLevel, totalStatBonusByLevel.length - 1)] || 0)
        : 0
    const luckyBonusPercent = Math.min(100, Math.max(0, Number(selectedLuckyItem?.effectValue || 0)))
    const superBonusPercent = selectedSuperItem
        ? Math.max(0, Number(rulePreview?.superFusionStoneBonusPercent || 0))
        : 0
    const finalSuccessRateCapPercent = Math.max(0, Math.min(100, Number(rulePreview?.finalSuccessRateCapPercent ?? 99)))
    const finalSuccessRate = Math.min(finalSuccessRateCapPercent, Math.max(0, baseSuccessRate + luckyBonusPercent + superBonusPercent))
    const failurePenaltyByBracket = rulePreview?.failurePenaltyByLevelBracket || {}
    const failureLevelThresholdByBracket = rulePreview?.failureLevelThresholdByBracket || {}
    const failurePenaltyRows = [
        {
            threshold: Math.max(0, Number(failureLevelThresholdByBracket?.fromLevel5 ?? 5)),
            penalty: Math.max(0, Number(failurePenaltyByBracket?.fromLevel5 || 0)),
        },
        {
            threshold: Math.max(0, Number(failureLevelThresholdByBracket?.fromLevel10 ?? 10)),
            penalty: Math.max(0, Number(failurePenaltyByBracket?.fromLevel10 || 0)),
        },
        {
            threshold: Math.max(0, Number(failureLevelThresholdByBracket?.fromLevel15 ?? 15)),
            penalty: Math.max(0, Number(failurePenaltyByBracket?.fromLevel15 || 0)),
        },
    ].sort((left, right) => right.threshold - left.threshold)
    const matchedFailurePenalty = failurePenaltyRows.find((entry) => targetFusionLevel >= entry.threshold) || null
    const failurePenaltyPreview = Number(matchedFailurePenalty?.penalty || 0)
    const currentMilestoneLabel = resolveMilestoneLabel(targetFusionLevel, milestones)

    const zonePageItems = useMemo(
        () => buildPageItems(zonePagination?.page || 1, zonePagination?.pages || 1),
        [zonePagination]
    )
    const materialPageItems = useMemo(
        () => buildPageItems(materialPagination?.page || 1, materialPagination?.pages || 1),
        [materialPagination]
    )

    const loadFusionConfig = async () => {
        try {
            setFusionConfigLoading(true)
            setFusionConfigError('')
            const data = await gameApi.getFusionConfig()
            setFusionConfig(data)

            const nextSelection = {}
            const nextSlots = Array.isArray(data?.fusion?.itemSlots) ? data.fusion.itemSlots : []
            for (const slot of nextSlots) {
                const requestField = String(slot?.requestField || '').trim()
                if (!requestField) continue
                const slotItems = Array.isArray(slot?.items) ? slot.items : []
                const firstAvailableItem = slotItems.find((entry) => Number(entry?.inventoryQuantity || 0) > 0) || null
                nextSelection[requestField] = slot.required ? normalizeId(firstAvailableItem?._id) : ''
            }

            setSelectedFusionItemByField((current) => {
                const merged = { ...nextSelection }
                for (const slot of nextSlots) {
                    const requestField = String(slot?.requestField || '').trim()
                    if (!requestField) continue
                    const slotItems = Array.isArray(slot?.items) ? slot.items : []
                    const currentSelection = normalizeId(current?.[requestField])
                    const hasCurrentSelection = slotItems.some((entry) => normalizeId(entry?._id) === currentSelection && Number(entry?.inventoryQuantity || 0) > 0)
                    if (hasCurrentSelection) {
                        merged[requestField] = currentSelection
                    }
                }
                return merged
            })
        } catch (error) {
            setFusionConfig(null)
            setFusionConfigError(error.message || 'Không thể tải cấu hình ghép Pokémon')
        } finally {
            setFusionConfigLoading(false)
        }
    }

    const loadFusionZone = async (targetPage = 1, searchText = zoneSearch) => {
        try {
            setZoneLoading(true)
            setZoneError('')
            const data = await gameApi.getBox({
                page: targetPage,
                limit: LIST_PAGE_LIMIT,
                search: searchText,
                sort: 'level',
                filter: 'all',
            })
            const nextRows = Array.isArray(data?.pokemon) ? data.pokemon : []
            const nextPagination = data?.pagination || { page: 1, pages: 1, total: nextRows.length, limit: LIST_PAGE_LIMIT }
            setZoneRows(nextRows)
            setZonePagination({
                page: Math.max(1, Number(nextPagination.page || targetPage)),
                pages: Math.max(1, Number(nextPagination.pages || 1)),
                total: Math.max(0, Number(nextPagination.total || 0)),
                limit: Math.max(1, Number(nextPagination.limit || LIST_PAGE_LIMIT)),
            })
        } catch (error) {
            setZoneRows([])
            setZoneError(error.message || 'Không thể tải khu ghép Pokémon')
        } finally {
            setZoneLoading(false)
        }
    }

    const loadTargetPokemon = async () => {
        if (!id) return
        try {
            setTargetLoading(true)
            setTargetError('')
            const data = await gameApi.getPokemonDetail(id)
            setTargetPokemon(data)
        } catch (error) {
            setTargetPokemon(null)
            setTargetError(error.message || 'Không thể tải Pokémon đích')
        } finally {
            setTargetLoading(false)
        }
    }

    const loadMaterialPokemon = async (targetPage = 1, searchText = materialSearch) => {
        if (!id) return
        try {
            setMaterialLoading(true)
            setMaterialError('')
            const data = await gameApi.getBox({
                page: targetPage,
                limit: MATERIAL_PAGE_LIMIT,
                search: searchText,
                sort: resolveMaterialServerSort(materialSort),
                filter: 'all',
            })
            const allRows = Array.isArray(data?.pokemon) ? data.pokemon : []
            const filteredRows = allRows.filter((entry) => normalizeId(entry?._id) !== normalizeId(id))
            const nextPagination = data?.pagination || { page: 1, pages: 1, total: filteredRows.length, limit: MATERIAL_PAGE_LIMIT }
            setMaterialRows(filteredRows)
            setMaterialPagination({
                page: Math.max(1, Number(nextPagination.page || targetPage)),
                pages: Math.max(1, Number(nextPagination.pages || 1)),
                total: Math.max(0, Number(nextPagination.total || 0)),
                limit: Math.max(1, Number(nextPagination.limit || MATERIAL_PAGE_LIMIT)),
            })
            setSelectedMaterialPokemonId((current) => {
                const currentId = normalizeId(current)
                if (filteredRows.some((entry) => normalizeId(entry?._id) === currentId)) {
                    return currentId
                }
                return normalizeId(filteredRows[0]?._id)
            })
        } catch (error) {
            setMaterialRows([])
            setMaterialError(error.message || 'Không thể tải danh sách Pokémon hiến tế')
        } finally {
            setMaterialLoading(false)
        }
    }

    useEffect(() => {
        loadFusionConfig()
    }, [])

    useEffect(() => {
        if (isDetailMode) {
            setLastFusionResult(null)
            loadTargetPokemon()
            loadMaterialPokemon(materialPage, materialSearch)
        } else {
            loadFusionZone(zonePage, zoneSearch)
        }
    }, [id, isDetailMode, zonePage, zoneSearch, materialPage, materialSearch, materialSort])

    const handleZoneSearch = () => {
        const normalized = String(zoneSearchInput || '').trim()
        setZonePage(1)
        setZoneSearch(normalized)
    }

    const handleMaterialSearch = () => {
        const normalized = String(materialSearchInput || '').trim()
        setMaterialPage(1)
        setMaterialSearch(normalized)
    }

    const handleSelectFusionItem = (requestField, itemId) => {
        setSelectedFusionItemByField((current) => ({
            ...current,
            [requestField]: normalizeId(itemId),
        }))
    }

    const handleFusePokemon = async () => {
        if (!id || !selectedMaterialPokemonId) {
            showError('Vui lòng chọn Pokémon hiến tế trước khi ghép')
            return
        }

        const payload = {
            materialPokemonId: normalizeId(selectedMaterialPokemonId),
        }

        for (const slot of itemSlots) {
            const requestField = String(slot?.requestField || '').trim()
            if (!requestField) continue
            const selectedItemId = normalizeId(selectedFusionItemByField?.[requestField])
            if (slot?.required === true && !selectedItemId) {
                showError(`Thiếu ${slot?.label || 'vật phẩm bắt buộc'}`)
                return
            }
            if (selectedItemId) {
                payload[requestField] = selectedItemId
            }
        }

        try {
            setFusing(true)
            const result = await gameApi.fusePokemon(id, payload)
            if (result?.fusion?.success) {
                showSuccess(result?.message || 'Ghép Pokémon thành công')
            } else {
                showError(result?.message || 'Ghép Pokémon thất bại')
            }
            setLastFusionResult(result?.fusion || null)

            await Promise.all([
                loadTargetPokemon(),
                loadMaterialPokemon(materialPage, materialSearch),
                loadFusionConfig(),
            ])
        } catch (error) {
            showError(error.message || 'Ghép Pokémon thất bại')
        } finally {
            setFusing(false)
        }
    }

    if (!isDetailMode) {
        return (
            <div className="max-w-5xl mx-auto pb-12">
                <div className="text-center mb-6">
                    <h1 className="text-4xl font-bold text-blue-900 mb-2 drop-shadow-sm">Khu Vực Ghép Pokémon</h1>
                    <p className="text-sm text-slate-600 font-semibold">Chọn Pokémon đích để bắt đầu ghép và tăng mốc.</p>
                </div>

                <div className="border-2 border-slate-800 bg-white shadow-lg">
                    <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-center font-bold px-4 py-2 border-b border-blue-700">
                        Danh Sách Pokémon Trong Kho
                    </div>

                    <div className="p-3 border-b border-slate-300 bg-slate-50 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                        <input
                            value={zoneSearchInput}
                            onChange={(event) => setZoneSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleZoneSearch()
                            }}
                            placeholder="Tìm theo tên Pokémon..."
                            className="border border-slate-400 px-3 py-2 text-sm"
                        />
                        <button
                            type="button"
                            onClick={handleZoneSearch}
                            className="px-5 py-2 border border-blue-700 bg-white font-bold text-blue-800 hover:bg-blue-50"
                        >
                            Tìm
                        </button>
                    </div>

                    <div className="px-4 py-3 bg-slate-50 text-sm font-semibold text-slate-700 border-b border-slate-300">
                        Tổng số Pokémon trong kho: <span className="text-blue-700">{formatNumber(zonePagination.total)}</span>
                    </div>

                    <div className="p-4 bg-white min-h-[280px]">
                        {zoneLoading ? (
                            <div className="text-center py-10 font-bold text-slate-500">Đang tải danh sách Pokémon...</div>
                        ) : zoneError ? (
                            <div className="text-center py-10 font-bold text-red-600">{zoneError}</div>
                        ) : zoneRows.length === 0 ? (
                            <div className="text-center py-10 text-slate-500 italic">Không có Pokémon nào phù hợp.</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {zoneRows.map((entry) => {
                                    const species = entry?.pokemonId || {}
                                    const displayName = resolvePokemonDisplayName(entry)
                                    const baseName = String(species?.name || '').trim()
                                    const rarityStyle = getRarityStyle(species?.rarity || 'd')
                                    const sprite = resolvePokemonDisplaySprite(entry)
                                    const fusionLevel = Math.max(0, Number(entry?.fusionLevel || 0))

                                    return (
                                        <div
                                            key={normalizeId(entry?._id)}
                                            className={`border rounded p-3 shadow-sm transition-transform hover:-translate-y-0.5 ${rarityStyle.border} ${rarityStyle.bg}`}
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-900 truncate">{displayName}</div>
                                                    {baseName && baseName !== displayName && (
                                                        <div className="text-xs text-slate-500 truncate">{baseName}</div>
                                                    )}
                                                </div>
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${rarityStyle.badge}`}>
                                                    {rarityStyle.label}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-center py-1">
                                                <img src={sprite} alt={displayName} className="w-16 h-16 object-contain pixelated" />
                                            </div>

                                            <div className="text-xs text-slate-600 text-center mt-1">
                                                Cấp {Math.max(1, Number(entry?.level || 1))} • Mốc ghép <span className="font-bold text-indigo-700">+{fusionLevel}</span>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => navigate(`/pokemon/${normalizeId(entry?._id)}/fusion`)}
                                                className="mt-3 w-full px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wide"
                                            >
                                                Vào khu ghép
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {zonePagination.pages > 1 && (
                        <div className="border-t border-slate-300 bg-slate-50 px-3 py-2 text-center font-bold text-blue-800">
                            <button
                                type="button"
                                onClick={() => setZonePage((prev) => Math.max(1, prev - 1))}
                                disabled={zonePagination.page <= 1}
                                className={`mx-0.5 px-2 py-1 border rounded ${zonePagination.page > 1 ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                Trước
                            </button>
                            {zonePageItems.map((item, index) => (
                                item === '...'
                                    ? <span key={`zone-ellipsis-${index}`} className="mx-1 text-slate-500">...</span>
                                    : (
                                        <button
                                            type="button"
                                            key={`zone-page-${item}`}
                                            onClick={() => setZonePage(Number(item))}
                                            className={`mx-0.5 px-2 py-1 border rounded ${Number(item) === zonePagination.page ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 hover:bg-blue-50'}`}
                                        >
                                            {item}
                                        </button>
                                    )
                            ))}
                            <button
                                type="button"
                                onClick={() => setZonePage((prev) => prev + 1)}
                                disabled={zonePagination.page >= zonePagination.pages}
                                className={`mx-0.5 px-2 py-1 border rounded ${zonePagination.page < zonePagination.pages ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                Sau
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    if (targetLoading || fusionConfigLoading) {
        return <div className="p-10 text-center">Đang tải khu ghép...</div>
    }

    if (!targetPokemon || targetError || fusionConfigError) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="text-red-500 font-bold text-lg mb-4">⚠️ {targetError || fusionConfigError || 'Không thể tải khu ghép Pokémon'}</div>
                <div className="space-x-3 text-sm">
                    <Link to="/fusion" className="text-blue-600 hover:underline">Về khu ghép</Link>
                    <span className="text-slate-300">|</span>
                    <Link to="/box" className="text-blue-600 hover:underline">Về kho Pokémon</Link>
                </div>
            </div>
        )
    }

    const targetName = resolvePokemonDisplayName(targetPokemon)
    const targetSprite = resolvePokemonDisplaySprite(targetPokemon)
    const targetSpecies = targetPokemon?.pokemonId || {}
    const targetRarityStyle = getRarityStyle(targetSpecies?.rarity || 'd')
    const strictMaterialUntilLevel = Math.max(0, Number(rulePreview?.strictMaterialUntilFusionLevel || 0))
    const targetStrictRule = targetFusionLevel < strictMaterialUntilLevel
    const selectedMaterial = materialRows.find((entry) => normalizeId(entry?._id) === normalizeId(selectedMaterialPokemonId)) || null
    const targetSpeciesId = normalizeId(targetSpecies?._id || targetSpecies?.id)
    const targetFormId = normalizeFormId(targetPokemon?.formId || targetSpecies?.defaultFormId || 'normal')
    const targetLevel = Math.max(1, Number(targetPokemon?.level || 1))
    const targetRarityRank = resolveRarityRank(targetSpecies?.rarity || 'd')

    const isMaterialCompatiblePreview = (entry = null) => {
        if (!entry) return false
        if (targetStrictRule) {
            const sameSpecies = normalizeId(entry?.pokemonId?._id || entry?.pokemonId?.id) === targetSpeciesId
            const sameForm = normalizeFormId(entry?.formId || entry?.pokemonId?.defaultFormId || 'normal') === targetFormId
            const sameLevel = Math.max(1, Number(entry?.level || 1)) === targetLevel
            return sameSpecies && sameForm && sameLevel
        }

        const entryRarityRank = resolveRarityRank(entry?.pokemonId?.rarity || 'd')
        return entryRarityRank >= targetRarityRank
    }

    const displayedMaterialRows = materialSort !== 'recommended'
        ? materialRows
        : [...materialRows].sort((left, right) => {
        const leftCompatible = isMaterialCompatiblePreview(left)
        const rightCompatible = isMaterialCompatiblePreview(right)
        const leftLevel = Math.max(1, Number(left?.level || 1))
        const rightLevel = Math.max(1, Number(right?.level || 1))
        const leftFusionLevel = Math.max(0, Number(left?.fusionLevel || 0))
        const rightFusionLevel = Math.max(0, Number(right?.fusionLevel || 0))
        const leftRarityRank = resolveRarityRank(left?.pokemonId?.rarity || 'd')
        const rightRarityRank = resolveRarityRank(right?.pokemonId?.rarity || 'd')
        const leftName = resolvePokemonDisplayName(left)
        const rightName = resolvePokemonDisplayName(right)

        if (leftCompatible !== rightCompatible) return rightCompatible ? 1 : -1
        if (rightRarityRank !== leftRarityRank) return rightRarityRank - leftRarityRank
        if (rightLevel !== leftLevel) return rightLevel - leftLevel
        if (rightFusionLevel !== leftFusionLevel) return rightFusionLevel - leftFusionLevel
        return leftName.localeCompare(rightName)
    })

    const selectedMaterialCompatible = selectedMaterial ? isMaterialCompatiblePreview(selectedMaterial) : false
    const missingRequiredSlot = itemSlots.find((slot) => {
        if (!slot?.required) return false
        const requestField = String(slot?.requestField || '').trim()
        if (!requestField) return false
        return !normalizeId(selectedFusionItemByField?.[requestField])
    }) || null
    const canFuse = Boolean(selectedMaterialPokemonId) && !missingRequiredSlot && !fusing

    const scrollToMaterialSection = () => {
        materialSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    return (
        <div className="max-w-5xl mx-auto pb-24 md:pb-12">
            <div className="text-center mb-4">
                <h1 className="text-3xl font-bold text-blue-900">Khu Ghép Pokémon</h1>
                <p className="text-sm text-slate-600 font-semibold mt-1">Đang ghép cho {targetName} • Mốc ghép {targetFusionLevel}</p>
            </div>

            <div className="mb-4 overflow-hidden rounded-xl border-2 border-blue-200 bg-white shadow-sm">
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 text-white">
                    <div className="text-sm font-bold">Xem trước ghép Pokémon</div>
                </div>

                <div className="p-4 md:p-5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 md:gap-4 items-center bg-gradient-to-b from-indigo-50 via-blue-50 to-cyan-50">
                    <div className={`rounded-xl border-2 p-3 md:p-4 ${targetRarityStyle.border} ${targetRarityStyle.bg}`}>
                        <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">Pokémon Đích</div>
                        <div className="mt-3 flex items-center gap-3">
                            <img src={targetSprite} alt={targetName} className="w-20 h-20 object-contain pixelated shrink-0" />
                            <div className="min-w-0">
                                <div className="font-bold text-slate-900 truncate">{targetName}</div>
                                <div className="text-xs text-slate-600">Cấp {targetLevel}</div>
                                <div className="text-xs font-semibold text-indigo-700">Mốc ghép +{targetFusionLevel}</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-center">
                        <div className="relative w-12 h-12 rounded-full border-2 border-indigo-300 bg-white shadow-sm" aria-hidden="true">
                            <span className="absolute left-1/2 top-1/2 h-1 w-5 -translate-x-1/2 -translate-y-1/2 rounded bg-indigo-700" />
                            <span className="absolute left-1/2 top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-indigo-700" />
                        </div>
                    </div>

                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 md:p-4">
                        <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Pokémon Hiến Tế</div>
                        {selectedMaterial ? (
                            <div className="mt-3 flex items-center gap-3">
                                <img src={resolvePokemonDisplaySprite(selectedMaterial)} alt={resolvePokemonDisplayName(selectedMaterial)} className="w-20 h-20 object-contain pixelated shrink-0" />
                                <div className="min-w-0">
                                    <div className="font-bold text-slate-900 truncate">{resolvePokemonDisplayName(selectedMaterial)}</div>
                                    <div className="text-xs text-slate-600">Cấp {Math.max(1, Number(selectedMaterial?.level || 1))}</div>
                                    <div className="text-xs text-slate-600">Mốc ghép +{Math.max(0, Number(selectedMaterial?.fusionLevel || 0))}</div>
                                    <div className={`mt-1 text-xs font-semibold ${selectedMaterialCompatible ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        {selectedMaterialCompatible ? 'Phù hợp điều kiện ghép hiện tại' : 'Có thể không phù hợp điều kiện ghép hiện tại'}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={scrollToMaterialSection}
                                className="mt-3 w-full rounded-lg border-2 border-dashed border-amber-300 bg-white px-3 py-4 text-left hover:border-amber-400 hover:bg-amber-100/40"
                            >
                                <div className="text-sm font-bold text-amber-900">Chưa chọn Pokémon hiến tế</div>
                                <div className="text-xs text-amber-700 mt-1">Chọn từ danh sách bên dưới để bắt đầu ghép.</div>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="mb-4 overflow-hidden rounded-xl border-2 border-blue-200 bg-white shadow-sm">
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2 text-white">
                    <div className="text-sm font-bold">Thiết lập ghép Pokémon</div>
                </div>

                <div className="p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div className="font-bold text-slate-800 mb-2">Tỉ lệ và rủi ro</div>
                        {currentMilestoneLabel && <div className="text-xs text-slate-500 mb-1">Mốc hiện tại: {currentMilestoneLabel}</div>}
                        <div>Tỉ lệ gốc: <span className="font-bold">{baseSuccessRate}%</span></div>
                        <div>Thưởng đá may mắn: <span className="font-bold">+{luckyBonusPercent}%</span></div>
                        <div>Thưởng Super Fusion Stone: <span className="font-bold">+{superBonusPercent}%</span></div>
                        <div>Giới hạn tối đa: <span className="font-bold">{finalSuccessRateCapPercent}%</span></div>
                        <div>Buff tổng chỉ số hiện tại: <span className="font-bold text-emerald-700">+{currentTotalStatBonusPercent}%</span></div>
                        <div className="mt-1 text-indigo-700">Tỉ lệ cuối: <span className="font-extrabold text-lg">{finalSuccessRate}%</span></div>

                        {milestones.length > 0 && (
                            <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                <div className="font-bold text-slate-700 mb-1">Mốc sao</div>
                                <div className="space-y-1">
                                    {milestones.map((entry, index) => {
                                        const from = Number.parseInt(entry?.from, 10)
                                        const to = entry?.to === null || entry?.to === undefined ? null : Number.parseInt(entry?.to, 10)
                                        const isCurrent = Number.isFinite(from)
                                            && (to === null
                                                ? targetFusionLevel >= from
                                                : (Number.isFinite(to) && targetFusionLevel >= from && targetFusionLevel <= to))
                                        return (
                                            <div key={`milestone-${index}`} className={isCurrent ? 'font-bold text-indigo-700' : ''}>
                                                {String(entry?.label || '').trim() || `Mốc ${index + 1}`}
                                                {Number.isFinite(from)
                                                    ? ` (từ +${from}${to === null || !Number.isFinite(to) ? ' trở lên' : ` đến +${to}`})`
                                                    : ''}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            {targetStrictRule
                                ? `Mốc hiện tại (+${targetFusionLevel}) yêu cầu Pokémon hiến tế cùng loài, cùng dạng và cùng cấp.`
                                : `Mốc hiện tại (+${targetFusionLevel}) đã mở rộng: Pokémon hiến tế cần có độ hiếm bằng hoặc cao hơn Pokémon đích.`}
                        </div>

                        <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                            Thất bại không bảo hộ sẽ trừ {failurePenaltyPreview} mốc ở mức +{targetFusionLevel}.
                            {matchedFailurePenalty ? ` (Áp dụng từ mốc +${matchedFailurePenalty.threshold})` : ''}
                            {' '}
                            {selectedProtectionItem ? 'Đá bảo hộ đang được chọn, sẽ không bị trừ mốc nếu thất bại.' : 'Có thể dùng đá bảo hộ để giữ nguyên mốc khi thất bại.'}
                        </div>
                    </div>

                    <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                        <div className="font-bold text-slate-800 mb-2">Chọn đá ghép (nguyên liệu)</div>

                        <div className="space-y-2">
                            {itemSlots.map((slot) => {
                                const requestField = String(slot?.requestField || '').trim()
                                const selectedValue = normalizeId(selectedFusionItemByField?.[requestField])
                                const slotItems = Array.isArray(slot?.items) ? slot.items : []

                                return (
                                    <div key={requestField} className="grid grid-cols-1 gap-1 border border-slate-200 rounded p-2 bg-white">
                                        <div className="font-bold text-slate-800 text-xs">
                                            {slot?.label || requestField}
                                            {slot?.required ? <span className="text-red-600"> *</span> : null}
                                        </div>
                                        <div className="text-xs text-slate-500">{slot?.description || ''}</div>
                                        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {!slot?.required && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectFusionItem(requestField, '')}
                                                    className={`rounded border px-2 py-2 text-left text-xs transition ${!selectedValue ? 'border-slate-500 bg-slate-100 text-slate-800 font-bold' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}
                                                >
                                                    <div>Không dùng</div>
                                                    <div className="text-[11px] opacity-75">Không áp dụng đá ở ô này</div>
                                                </button>
                                            )}

                                            {slotItems.map((entry) => {
                                                const itemId = normalizeId(entry?._id)
                                                const isSelected = selectedValue === itemId
                                                const inventoryQuantity = Number(entry?.inventoryQuantity || 0)
                                                const outOfStock = inventoryQuantity <= 0
                                                return (
                                                    <button
                                                        type="button"
                                                        key={itemId}
                                                        disabled={outOfStock}
                                                        onClick={() => handleSelectFusionItem(requestField, itemId)}
                                                        className={`rounded border px-2 py-2 text-left text-xs transition ${isSelected ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-200' : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-300'} ${outOfStock ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        <div className="font-bold truncate">{entry?.name || 'Vật phẩm'}</div>
                                                        <div className="mt-0.5 text-[11px] text-slate-600">
                                                            Tồn kho x{formatNumber(inventoryQuantity)}
                                                            {slot?.effectType === 'fusionLuckyStone' ? ` • +${Number(entry?.effectValue || 0)}%` : ''}
                                                        </div>
                                                        {isSelected && <div className="mt-1 text-[11px] font-bold text-indigo-700">Đang chọn</div>}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                            <div className="font-bold">Tóm tắt trước khi ghép</div>
                            <div className="mt-1">Tỉ lệ cuối: <span className="font-bold">{finalSuccessRate}%</span></div>
                            <div>
                                Pokémon hiến tế:{' '}
                                {selectedMaterial
                                    ? <span className="font-bold">{resolvePokemonDisplayName(selectedMaterial)}</span>
                                    : <span className="font-semibold text-rose-700">Chưa chọn</span>}
                            </div>
                            {missingRequiredSlot && (
                                <div className="mt-1 text-rose-700 font-semibold">Thiếu vật phẩm bắt buộc: {missingRequiredSlot?.label || 'vật phẩm bắt buộc'}</div>
                            )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={handleFusePokemon}
                                disabled={!canFuse}
                                className="px-5 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black tracking-wide disabled:opacity-60"
                            >
                                {fusing ? 'Đang ghép...' : 'GHÉP POKÉMON'}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/fusion')}
                                className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold"
                            >
                                Về khu ghép
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate(`/pokemon/${normalizeId(id)}`)}
                                className="px-4 py-2 rounded border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-bold"
                            >
                                Về trang Pokémon
                            </button>
                        </div>

                        {selectedMaterial && (
                            <div className="mt-2 text-xs font-semibold text-slate-600">
                                Pokémon hiến tế đang chọn: <span className="text-indigo-700">{resolvePokemonDisplayName(selectedMaterial)}</span>
                            </div>
                        )}

                        {!selectedMaterial && (
                            <button
                                type="button"
                                onClick={scrollToMaterialSection}
                                className="mt-2 text-xs font-bold text-indigo-700 hover:underline"
                            >
                                Chọn Pokémon hiến tế từ danh sách bên dưới
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {lastFusionResult && (
                <details className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    <summary className="cursor-pointer font-bold">Kết quả lần ghép gần nhất</summary>
                    <div className="mt-2">
                        <div>
                            {lastFusionResult.success ? 'Thành công' : 'Thất bại'} • Kết quả quay {Number(lastFusionResult.rollPercent || 0).toLocaleString('vi-VN', { maximumFractionDigits: 4 })}% / {Number(lastFusionResult.finalSuccessRate || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%
                        </div>
                        <div>Mốc ghép: +{Number(lastFusionResult?.target?.fusionLevelBefore || 0)} {'->'} +{Number(lastFusionResult?.target?.fusionLevelAfter || 0)}</div>
                        <div>Đã tiêu hao Pokémon hiến tế: {lastFusionResult.consumedMaterialPokemonName || 'Pokémon'}</div>
                    </div>
                </details>
            )}

            <div ref={materialSectionRef} className="mt-4 border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-center font-bold px-4 py-2 border-b border-blue-700">
                    Chọn Pokémon hiến tế
                </div>

                <div className="p-3 border-b border-slate-300 bg-slate-50 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                        <input
                            value={materialSearchInput}
                            onChange={(event) => setMaterialSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleMaterialSearch()
                            }}
                            placeholder="Tìm Pokémon hiến tế..."
                            className="border border-slate-400 px-3 py-2 text-sm"
                        />
                        <select
                            value={materialSort}
                            onChange={(event) => {
                                setMaterialPage(1)
                                setMaterialSort(String(event.target.value || 'recommended'))
                            }}
                            className="border border-slate-400 px-3 py-2 text-sm bg-white"
                        >
                            <option value="recommended">Phù hợp nhất</option>
                            <option value="levelDesc">Cấp cao nhất</option>
                            <option value="fusionDesc">Mốc ghép cao nhất</option>
                            <option value="rarityDesc">Độ hiếm cao nhất</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleMaterialSearch}
                            className="px-5 py-2 border border-blue-700 bg-white font-bold text-blue-800 hover:bg-blue-50"
                        >
                            Tìm
                        </button>
                    </div>
                    <div className="text-xs font-semibold text-slate-600 text-right">
                        Đang chọn: {selectedMaterial ? resolvePokemonDisplayName(selectedMaterial) : 'Chưa chọn'}
                    </div>
                </div>

                <div className="p-4 bg-white min-h-[230px]">
                    {materialLoading ? (
                        <div className="text-center py-10 font-bold text-slate-500">Đang tải Pokémon hiến tế...</div>
                    ) : materialError ? (
                        <div className="text-center py-10 font-bold text-red-600">{materialError}</div>
                    ) : materialRows.length === 0 ? (
                        <div className="text-center py-10 text-slate-500 italic">Không còn Pokémon nào trong kho để làm hiến tế.</div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {displayedMaterialRows.map((entry) => {
                                const species = entry?.pokemonId || {}
                                const displayName = resolvePokemonDisplayName(entry)
                                const sprite = resolvePokemonDisplaySprite(entry)
                                const rarityStyle = getRarityStyle(species?.rarity || 'd')
                                const materialId = normalizeId(entry?._id)
                                const isSelected = materialId === normalizeId(selectedMaterialPokemonId)
                                const compatible = isMaterialCompatiblePreview(entry)
                                const entryFormId = normalizeFormId(entry?.formId || species?.defaultFormId || 'normal')
                                const entryFormLabel = formatDisplayForm(entryFormId)

                                return (
                                    <button
                                        type="button"
                                        key={materialId}
                                        onClick={() => setSelectedMaterialPokemonId(materialId)}
                                        className={`relative border rounded p-3 text-left transition ${isSelected ? 'ring-2 ring-offset-1 ring-indigo-500 border-indigo-500 shadow-md' : 'hover:border-indigo-300'} ${rarityStyle.border} ${rarityStyle.bg}`}
                                    >
                                        {isSelected && (
                                            <span className="absolute right-2 top-2 rounded-full bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5">Đã chọn</span>
                                        )}
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <div className="font-bold text-slate-900 truncate">{displayName}</div>
                                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${rarityStyle.badge}`}>
                                                {rarityStyle.label}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1">
                                            <img src={sprite} alt={displayName} className="w-14 h-14 object-contain pixelated" />
                                            <div className="text-xs text-slate-700">
                                                <div>Cấp {Math.max(1, Number(entry?.level || 1))}</div>
                                                <div>Dạng: {entryFormLabel}</div>
                                                <div>Mốc ghép +{Math.max(0, Number(entry?.fusionLevel || 0))}</div>
                                                <div className={`font-semibold ${compatible ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                    {compatible ? 'Phù hợp điều kiện hiện tại' : 'Có thể không phù hợp'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-2 text-[11px] font-bold text-indigo-700">
                                            {isSelected ? 'Đang dùng làm hiến tế' : 'Bấm để chọn làm hiến tế'}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {materialPagination.pages > 1 && (
                    <div className="border-t border-slate-300 bg-slate-50 px-3 py-2 text-center font-bold text-blue-800">
                        <button
                            type="button"
                            onClick={() => setMaterialPage((prev) => Math.max(1, prev - 1))}
                            disabled={materialPagination.page <= 1}
                            className={`mx-0.5 px-2 py-1 border rounded ${materialPagination.page > 1 ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                            Trước
                        </button>
                        {materialPageItems.map((item, index) => (
                            item === '...'
                                ? <span key={`material-ellipsis-${index}`} className="mx-1 text-slate-500">...</span>
                                : (
                                    <button
                                        type="button"
                                        key={`material-page-${item}`}
                                        onClick={() => setMaterialPage(Number(item))}
                                        className={`mx-0.5 px-2 py-1 border rounded ${Number(item) === materialPagination.page ? 'border-blue-700 bg-blue-600 text-white' : 'border-slate-300 hover:bg-blue-50'}`}
                                    >
                                        {item}
                                    </button>
                                )
                        ))}
                        <button
                            type="button"
                            onClick={() => setMaterialPage((prev) => prev + 1)}
                            disabled={materialPagination.page >= materialPagination.pages}
                            className={`mx-0.5 px-2 py-1 border rounded ${materialPagination.page < materialPagination.pages ? 'border-slate-300 hover:bg-blue-50' : 'border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        >
                            Sau
                        </button>
                    </div>
                )}
            </div>

            <div className="fixed inset-x-0 bottom-3 z-40 px-3 md:hidden pointer-events-none">
                <div className="mx-auto max-w-md rounded-xl border-2 border-indigo-300 bg-white/95 shadow-lg px-3 py-2 pointer-events-auto backdrop-blur">
                    <div className="text-xs font-semibold text-slate-700">{selectedMaterial ? `Hiến tế: ${resolvePokemonDisplayName(selectedMaterial)}` : 'Chưa chọn Pokémon hiến tế'}</div>
                    <div className="text-sm font-bold text-indigo-800">Tỉ lệ cuối: {finalSuccessRate}%</div>
                    <button
                        type="button"
                        onClick={handleFusePokemon}
                        disabled={!canFuse}
                        className="mt-2 w-full rounded bg-indigo-600 py-2 text-white text-sm font-black tracking-wide disabled:opacity-60"
                    >
                        {fusing ? 'Đang ghép...' : 'GHÉP POKÉMON'}
                    </button>
                </div>
            </div>

        </div>
    )
}
