import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { mapApi } from '../../services/mapApi'
import { gameApi } from '../../services/gameApi'
import { getRarityStyle } from '../../utils/rarityStyles'
import Modal from '../../components/Modal'
import FeatureUnavailableNotice from '../../components/FeatureUnavailableNotice'
import { getVipTierLevel, hasVipAutoSearchAccess } from '../../utils/vip'
import { getVipAutoLimitConfig } from '../../utils/vipAutoLimits'
import { inventoryQueryOptions } from '../../hooks/queries/gameQueries'

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
const sanitizeObjectIdToken = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^[a-f\d]{24}$/i.test(raw)) return raw
    const objectIdMatch = raw.match(/ObjectId\(["']?([a-f\d]{24})["']?\)/i)
    if (objectIdMatch?.[1]) return objectIdMatch[1]
    return ''
}

const extractObjectIdLike = (value) => {
    if (typeof value === 'string') return sanitizeObjectIdToken(value)
    if (typeof value === 'number' && Number.isFinite(value)) return sanitizeObjectIdToken(String(value))
    if (value && typeof value === 'object') {
        if (typeof value.$oid === 'string') return sanitizeObjectIdToken(value.$oid)
        if (typeof value._id === 'string') return sanitizeObjectIdToken(value._id)
        if (typeof value.id === 'string') return sanitizeObjectIdToken(value.id)
        if (value._id && typeof value._id === 'object') {
            const nestedId = extractObjectIdLike(value._id)
            if (nestedId) return nestedId
        }
        if (typeof value.toHexString === 'function') {
            try {
                return sanitizeObjectIdToken(value.toHexString())
            } catch {
                return ''
            }
        }
    }
    return ''
}
const LAST_ENCOUNTER_STORAGE_PREFIX = 'map:lastEncounter:'
const SEARCH_SPAM_REPOSITION_THRESHOLD = 24
const SEARCH_BUTTON_REPOSITION_COOLDOWN_MS = 5 * 60 * 1000
const SEARCH_CHALLENGE_INTERVAL_MS = 2 * 60 * 1000
const LOCAL_SEARCH_SPAM_COOLDOWN_MS = 300
const SEARCH_VERY_FAST_SPAM_INTERVAL_MS = 180
const SEARCH_VERY_FAST_SPAM_STREAK_THRESHOLD = 3
const SEARCH_VERY_FAST_SPAM_REPOSITION_THRESHOLD = 4

const createSearchChallenge = () => {
    const left = 5 + Math.floor(Math.random() * 20)
    const right = 3 + Math.floor(Math.random() * 15)
    const useAddition = Math.random() < 0.5
    const answer = useAddition ? (left + right) : Math.max(1, left - right)
    const prompt = useAddition
        ? `Mật mã Pokeball: ${left} + ${right} = ?`
        : `Mật mã Pokeball: ${left} - ${right} = ?`
    return {
        id: Date.now(),
        prompt,
        answer,
    }
}
const AUTO_SEARCH_INTERVAL_OPTIONS = [
    { value: 900, label: 'Nhanh (0.9s)' },
    { value: 1200, label: 'Vừa (1.2s)' },
    { value: 1800, label: 'Chậm (1.8s)' },
    { value: 2500, label: 'Rất chậm (2.5s)' },
]
const DEFAULT_AUTO_SEARCH_INTERVAL_MS = AUTO_SEARCH_INTERVAL_OPTIONS[1].value
const AUTO_SEARCH_RARITY_KEYS = ['sss', 'ss', 's', 'a', 'b', 'c', 'd']
const AUTO_SEARCH_ACTION_OPTIONS = [
    { value: 'catch', label: 'Dùng bóng bắt' },
    { value: 'battle', label: 'Chiến đấu' },
    { value: 'run', label: 'Bỏ qua' },
]
const AUTO_CATCH_FORM_OPTIONS = [
    { value: 'all', label: 'Mọi form' },
    { value: 'normal', label: 'Chỉ form normal' },
    { value: 'variant', label: 'Chỉ form đặc biệt' },
]
const DEFAULT_AUTO_ACTION_BY_RARITY = {
    sss: 'catch',
    ss: 'catch',
    s: 'catch',
    a: 'battle',
    b: 'battle',
    c: 'battle',
    d: 'battle',
}
const LOW_HP_CATCH_BONUS_CAP_BY_RARITY = Object.freeze({
    d: 31,
    c: 29,
    b: 27,
    a: 25,
    s: 21,
    ss: 17,
    sss: 14,
})
const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 23
const MAP_RARITY_CATCH_BONUS_KEYS = Object.freeze(['s', 'ss', 'sss'])
const MAP_RARITY_CATCH_BONUS_MIN_PERCENT = -95
const MAP_RARITY_CATCH_BONUS_MAX_PERCENT = 500
const MAP_DETAIL_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const POKEMON_RARITY_ORDER = Object.freeze({ d: 0, c: 1, b: 2, a: 3, s: 4, ss: 5, sss: 6 })
const ITEM_RARITY_ORDER = Object.freeze({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 })
const ITEM_TYPE_LABELS = Object.freeze({
    healing: 'Hồi phục',
    pokeball: 'Pokeball',
    evolution: 'Tiến hóa',
    battle: 'Chiến đấu',
    key: 'Nhiệm vụ',
    misc: 'Khác',
})

const normalizeMapRarityCatchBonusPercent = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return MAP_RARITY_CATCH_BONUS_KEYS.reduce((acc, key) => {
        const parsed = Number(source?.[key])
        acc[key] = Number.isFinite(parsed)
            ? Math.max(MAP_RARITY_CATCH_BONUS_MIN_PERCENT, Math.min(MAP_RARITY_CATCH_BONUS_MAX_PERCENT, parsed))
            : 0
        return acc
    }, {})
}

const resolveMapRarityCatchBonusPercent = (mapLike = null, rarity = '') => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    if (!MAP_RARITY_CATCH_BONUS_KEYS.includes(normalizedRarity)) return 0
    const normalizedMapBonus = normalizeMapRarityCatchBonusPercent(mapLike?.rarityCatchBonusPercent)
    return Number(normalizedMapBonus?.[normalizedRarity] || 0)
}

const isSameAutoActionByRarity = (left = {}, right = {}) => {
    return AUTO_SEARCH_RARITY_KEYS.every((rarityKey) => {
        const leftValue = String(left?.[rarityKey] || '').trim().toLowerCase()
        const rightValue = String(right?.[rarityKey] || '').trim().toLowerCase()
        return leftValue === rightValue
    })
}

const DEFAULT_AUTO_SEARCH_HISTORY = {
    foundPokemonCount: 0,
    itemDropCount: 0,
    itemDropQuantity: 0,
    runCount: 0,
    battleCount: 0,
    catchAttemptCount: 0,
    catchSuccessCount: 0,
}
const formatFriendlyAutoSearchMessage = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return ''

    let message = raw
        .replace(/TIME_BUDGET/gi, 'hệ thống đang bận theo nhịp xử lý')
        .replace(/REQUEST_TIMEOUT/gi, 'kết nối tạm chậm')
        .replace(/SESSION_CONFLICT/gi, 'đang đồng bộ phiên xử lý')
        .replace(/ACTION_COOLDOWN/gi, 'thao tác đang trong thời gian chờ')
        .replace(/DAILY_LIMIT_REACHED/gi, 'đã đạt giới hạn hôm nay')
        .replace(/DURATION_EXPIRED/gi, 'đã hết thời lượng hôm nay')
        .replace(/MAP_LOCKED/gi, 'bản đồ đang bị khóa')
        .replace(/MAP_NOT_FOUND/gi, 'không tìm thấy bản đồ')
        .replace(/NO_BALL_AVAILABLE/gi, 'không đủ bóng để bắt')
        .replace(/PLAYER_DEFEATED/gi, 'Pokemon của bạn đã kiệt sức')

    message = message
        .replace(/Auto tìm kiếm lỗi:/i, 'Tự tìm kiếm gặp lỗi:')
        .replace(/auto tìm kiếm tạm dừng/gi, 'tự tìm kiếm tạm dừng')

    return message
}

const normalizeActionByRaritySnapshot = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return AUTO_SEARCH_RARITY_KEYS.reduce((acc, rarityKey) => {
        const normalized = String(source?.[rarityKey] || DEFAULT_AUTO_ACTION_BY_RARITY[rarityKey] || 'battle').trim().toLowerCase()
        acc[rarityKey] = (normalized === 'catch' || normalized === 'run') ? normalized : 'battle'
        return acc
    }, {})
}

const buildAutoSearchConfigSnapshot = ({
    enabled,
    mapSlug,
    searchIntervalMs,
    actionByRarity,
    catchFormMode,
    catchBallItemId,
}) => {
    return JSON.stringify({
        enabled: Boolean(enabled),
        mapSlug: String(mapSlug || '').trim().toLowerCase(),
        searchIntervalMs: Math.max(900, Number(searchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS),
        actionByRarity: normalizeActionByRaritySnapshot(actionByRarity),
        catchFormMode: String(catchFormMode || 'all').trim().toLowerCase() || 'all',
        catchBallItemId: String(catchBallItemId || '').trim(),
    })
}

const isSearchDebugModeEnabled = () => {
    return Boolean(import.meta.env.DEV)
}

const formatPercent = (value) => `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 4 })}%`
const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), 'vi', { sensitivity: 'base' })
const capitalizeWords = (value = '') => String(value || '')
    .split(/[-\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')

const buildPokemonEncounterFallback = (mapLike = null, dropRateEntries = []) => {
    const encounterRate = Math.max(0, Math.min(1, Number(mapLike?.encounterRate) || 0))
    const totalWeight = dropRateEntries.reduce((sum, entry) => sum + (Number(entry?.weight) > 0 ? Number(entry.weight) : 0), 0)

    return dropRateEntries.map((entry) => {
        const weight = Number(entry?.weight) > 0 ? Number(entry.weight) : 0
        const poolPercent = totalWeight > 0 ? (weight / totalWeight) * 100 : 0
        return {
            ...entry,
            source: entry?.source || 'normal',
            poolPercent,
            encounterPercent: encounterRate * poolPercent,
        }
    })
}

const getLastEncounterStorageKey = (slug = '') => `${LAST_ENCOUNTER_STORAGE_PREFIX}${String(slug || '').trim().toLowerCase()}`

const buildEncounterSummary = (result = {}) => {
    const pokemon = result?.pokemon
    if (!pokemon) return null

    const name = String(pokemon?.name || '').trim() || 'Không rõ'
    const level = Math.max(1, Number(result?.level || result?.pokemon?.level || 1))
    const rarity = String(pokemon?.rarity || '').trim().toLowerCase()
    const resolvedFormId = normalizeFormId(pokemon?.formId || pokemon?.form?.formId || 'normal')
    const formNameRaw = String(pokemon?.form?.formName || pokemon?.form?.formId || resolvedFormId).trim()
    const formName = resolvedFormId !== 'normal' ? (formNameRaw || resolvedFormId) : ''

    return {
        name,
        level,
        rarity,
        formId: resolvedFormId,
        formName,
        updatedAt: Date.now(),
    }
}

const isEventMapLike = (mapLike = null) => {
    if (!mapLike || typeof mapLike !== 'object') return false
    return Boolean(mapLike.isEventMap)
}

export default function MapPage() {
    const { slug } = useParams()
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const isSearchDebugMode = isSearchDebugModeEnabled()
    const [map, setMap] = useState(null)
    const [dropRates, setDropRates] = useState([])
    const [pokemonEncounters, setPokemonEncounters] = useState([])
    const [itemDropRates, setItemDropRates] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [unlockInfo, setUnlockInfo] = useState(null)
    const [isLocked, setIsLocked] = useState(false)
    const [featureNotice, setFeatureNotice] = useState('')
    const [searching, setSearching] = useState(false)
    const [lastResult, setLastResult] = useState(null)
    const [encounter, setEncounter] = useState(null)
    const [catchAttemptInfo, setCatchAttemptInfo] = useState({ attempts: 0, maxAttempts: 3 })
    const [actionLoading, setActionLoading] = useState(false)
    const [actionMessage, setActionMessage] = useState('')
    const [inventory, setInventory] = useState([])
    const [selectedBallId, setSelectedBallId] = useState('')
    const [playerBattle, setPlayerBattle] = useState(null)
    const [playerState, setPlayerState] = useState({
        platinumCoins: 0,
        moonPoints: 0,
        level: 1,
    })
    const [mapStats, setMapStats] = useState({
        level: 1,
        exp: 0,
        expToNext: 250,
        totalSearches: 0,
    })
    const [autoSearchEnabled, setAutoSearchEnabled] = useState(false)
    const [autoSearchIntervalMs, setAutoSearchIntervalMs] = useState(DEFAULT_AUTO_SEARCH_INTERVAL_MS)
    const [autoActionByRarity, setAutoActionByRarity] = useState(DEFAULT_AUTO_ACTION_BY_RARITY)
    const [autoCatchFormMode, setAutoCatchFormMode] = useState('all')
    const [autoCatchBallId, setAutoCatchBallId] = useState('')
    const [isAutoSearchConfigExpanded, setIsAutoSearchConfigExpanded] = useState(false)
    const [autoSearchServerStatus, setAutoSearchServerStatus] = useState('')
    const [autoSearchServerLogs, setAutoSearchServerLogs] = useState([])
    const [autoSearchHistory, setAutoSearchHistory] = useState(DEFAULT_AUTO_SEARCH_HISTORY)
    const [isAutoSearchConfigDirty, setIsAutoSearchConfigDirty] = useState(false)
    const [autoSearchUsageToday, setAutoSearchUsageToday] = useState(0)
    const [autoSearchUsesPerDayLimit, setAutoSearchUsesPerDayLimit] = useState(0)
    const [autoSearchRuntimeTodayMinutes, setAutoSearchRuntimeTodayMinutes] = useState(0)
    const [autoSearchRuntimeLimitMinutes, setAutoSearchRuntimeLimitMinutes] = useState(0)
    const [searchButtonOffset, setSearchButtonOffset] = useState({ x: 0, y: 0 })
    const [searchChallenge, setSearchChallenge] = useState(null)
    const [searchChallengeInput, setSearchChallengeInput] = useState('')
    const [searchChallengeError, setSearchChallengeError] = useState('')
    const [lastEncounterSummary, setLastEncounterSummary] = useState(null)
    const [isEncounterDetailExpanded, setIsEncounterDetailExpanded] = useState(true)
    const [detailTab, setDetailTab] = useState('pokemon')
    const [pokemonSortKey, setPokemonSortKey] = useState('name')
    const [pokemonSortDirection, setPokemonSortDirection] = useState('desc')
    const [pokemonPage, setPokemonPage] = useState(1)
    const [pokemonPageSize, setPokemonPageSize] = useState(MAP_DETAIL_PAGE_SIZE_OPTIONS[0])
    const [pokemonSearch, setPokemonSearch] = useState('')
    const [pokemonRarityFilter, setPokemonRarityFilter] = useState('')
    const [pokemonTypeFilter, setPokemonTypeFilter] = useState('')
    const [pokemonSourceFilter, setPokemonSourceFilter] = useState('')
    const [itemSortKey, setItemSortKey] = useState('dropPercent')
    const [itemSortDirection, setItemSortDirection] = useState('desc')
    const [itemPage, setItemPage] = useState(1)
    const [itemPageSize, setItemPageSize] = useState(MAP_DETAIL_PAGE_SIZE_OPTIONS[0])
    const [itemSearch, setItemSearch] = useState('')
    const [itemRarityFilter, setItemRarityFilter] = useState('')
    const [itemTypeFilter, setItemTypeFilter] = useState('')
    const searchScrollYRef = useRef(0)
    const shouldRestoreSearchScrollRef = useRef(false)
    const searchSpamCountRef = useRef(0)
    const lastSearchRequestAtRef = useRef(0)
    const autoSearchConfigDirtyRef = useRef(false)
    const lastAutoSearchServerSnapshotRef = useRef('')
    const lastSearchChallengeAtRef = useRef(Date.now())
    const lastSearchButtonRepositionAtRef = useRef(0)
    const lastSearchSpamAttemptAtRef = useRef(0)
    const searchVeryFastSpamStreakRef = useRef(0)
    const formattedGold = Number(playerState.platinumCoins || 0).toLocaleString('vi-VN')
    const formattedMoonPoints = Number(playerState.moonPoints || 0).toLocaleString('vi-VN')
    const mapProgressPercent = Math.max(5, Math.round((mapStats.exp / Math.max(1, mapStats.expToNext)) * 100))
    const requiredSearches = Math.max(
        0,
        (isLocked ? unlockInfo?.requiredSearches : map?.requiredSearches) ?? 0
    )
    const currentSearches = Math.max(
        0,
        (isLocked ? unlockInfo?.currentSearches : mapStats.totalSearches) ?? 0
    )
    const unlockPercent = requiredSearches > 0
        ? Math.min(100, Math.round((currentSearches / requiredSearches) * 100))
        : 100
    const requiredPlayerLevel = Math.max(
        1,
        (isLocked ? unlockInfo?.requiredPlayerLevel : map?.requiredPlayerLevel) ?? 1
    )
    const currentPlayerLevel = Math.max(
        1,
        (isLocked ? unlockInfo?.currentPlayerLevel : playerState?.level) ?? 1
    )
    const unlockRemainingLevels = Math.max(0, requiredPlayerLevel - currentPlayerLevel)
    const requiredVipLevel = Math.max(
        0,
        (isLocked ? unlockInfo?.requiredVipLevel : map?.requiredVipLevel) ?? 0
    )
    const currentVipLevel = Math.max(
        0,
        (isLocked ? unlockInfo?.currentVipLevel : user?.vipTierLevel) ?? 0
    )
    const unlockRemainingVipLevels = Math.max(0, requiredVipLevel - currentVipLevel)
    const isCurrentMapEvent = isEventMapLike(map)
    const canUseVipAutoSearch = hasVipAutoSearchAccess(user)
    const effectiveVipLevel = Math.max(0, getVipTierLevel(user))
    const autoSearchRequiredVipLevel = Math.max(0, Number(map?.autoSearchRequiredVipLevel) || 0)
    const remainingAutoSearchVipLevels = Math.max(0, autoSearchRequiredVipLevel - effectiveVipLevel)
    const canUseCurrentMapAutoSearch = canUseVipAutoSearch && !isCurrentMapEvent && remainingAutoSearchVipLevels === 0
    const autoSearchLimitConfig = getVipAutoLimitConfig(user, 'map-search')
    const autoSearchDurationLimitMinutes = autoSearchLimitConfig.durationMinutes
    const availablePokeballs = (Array.isArray(inventory) ? inventory : [])
        .filter((entry) => entry?.item?.type === 'pokeball' && Number(entry?.quantity) > 0)
    const resolvedAutoCatchBallEntry = availablePokeballs.find((entry) => {
        return extractObjectIdLike(entry?.item?._id || entry?.item?.id || entry?.item) === String(autoCatchBallId || '').trim()
    })
        || availablePokeballs[0]
        || null
    const hasCatchActionConfigured = AUTO_SEARCH_RARITY_KEYS.some((rarityKey) => {
        return String(autoActionByRarity?.[rarityKey] || '').trim().toLowerCase() === 'catch'
    })

    const markAutoSearchConfigDirty = () => {
        autoSearchConfigDirtyRef.current = true
        setIsAutoSearchConfigDirty(true)
    }

    const syncAutoSearchConfigDirty = (nextDirty) => {
        const normalizedDirty = Boolean(nextDirty)
        autoSearchConfigDirtyRef.current = normalizedDirty
        setIsAutoSearchConfigDirty((prev) => (prev === normalizedDirty ? prev : normalizedDirty))
    }

    useEffect(() => {
        setAutoSearchUsesPerDayLimit(autoSearchLimitConfig.usesPerDay)
        setAutoSearchRuntimeLimitMinutes(autoSearchLimitConfig.durationMinutes)
    }, [autoSearchLimitConfig.usesPerDay, autoSearchLimitConfig.durationMinutes])

    useEffect(() => {
        if (typeof window === 'undefined') {
            setLastEncounterSummary(null)
            return
        }

        try {
            const raw = window.localStorage.getItem(getLastEncounterStorageKey(slug))
            if (!raw) {
                setLastEncounterSummary(null)
                return
            }
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') {
                setLastEncounterSummary(parsed)
            } else {
                setLastEncounterSummary(null)
            }
        } catch (_error) {
            setLastEncounterSummary(null)
        }
    }, [slug])

    useEffect(() => {
        loadMapData()
        setLastResult(null)
        setEncounter(null)
        setCatchAttemptInfo({ attempts: 0, maxAttempts: 3 })
        setPlayerBattle(null)
        setActionMessage('')
        setFeatureNotice('')
        searchSpamCountRef.current = 0
        searchVeryFastSpamStreakRef.current = 0
        lastSearchSpamAttemptAtRef.current = 0
        setSearchButtonOffset({ x: 0, y: 0 })
        setSearchChallenge(null)
        setSearchChallengeInput('')
        setSearchChallengeError('')
        lastSearchChallengeAtRef.current = Date.now()
        setIsEncounterDetailExpanded(true)
        setDetailTab('pokemon')
        setPokemonPage(1)
        setItemPage(1)
        setPokemonSearch('')
        setPokemonRarityFilter('')
        setPokemonTypeFilter('')
        setPokemonSourceFilter('')
        setItemSearch('')
        setItemRarityFilter('')
        setItemTypeFilter('')
    }, [slug])

    useEffect(() => {
        setPokemonPage(1)
    }, [pokemonSortKey, pokemonSortDirection, pokemonPageSize, pokemonEncounters.length, dropRates.length, pokemonSearch, pokemonRarityFilter, pokemonTypeFilter, pokemonSourceFilter])

    useEffect(() => {
        setItemPage(1)
    }, [itemSortKey, itemSortDirection, itemPageSize, itemDropRates.length, itemSearch, itemRarityFilter, itemTypeFilter])

    useEffect(() => {
        if (availablePokeballs.length === 0) {
            if (autoCatchBallId) setAutoCatchBallId('')
            return
        }

        const exists = availablePokeballs.some((entry) => String(entry?.item?._id || '') === String(autoCatchBallId || ''))
        if (!exists) {
            setAutoCatchBallId(String(availablePokeballs[0]?.item?._id || ''))
        }
    }, [availablePokeballs, autoCatchBallId])

    useEffect(() => {
        if (searching || !shouldRestoreSearchScrollRef.current) return
        if (typeof window === 'undefined') return

        const targetY = Math.max(0, Number(searchScrollYRef.current) || 0)
        shouldRestoreSearchScrollRef.current = false

        window.requestAnimationFrame(() => {
            window.scrollTo(0, targetY)
            window.requestAnimationFrame(() => {
                window.scrollTo(0, targetY)
            })
        })
    }, [searching, encounter, lastResult])

    const loadMapData = async () => {
        try {
            setLoading(true)
            setError('')
            const [mapData, stateData, activeEncounterData] = await Promise.all([
                mapApi.getBySlug(slug),
                gameApi.getMapState(slug).catch(() => null),
                gameApi.getActiveEncounter().catch(() => null),
            ])
            setMap(mapData.map)
            setDropRates(mapData.dropRates)
            setPokemonEncounters(Array.isArray(mapData.pokemonEncounters) ? mapData.pokemonEncounters : [])
            setItemDropRates(Array.isArray(mapData.itemDropRates) ? mapData.itemDropRates : [])
            if (stateData?.mapProgress) {
                setMapStats(stateData.mapProgress)
            }
            if (stateData?.playerState) {
                setPlayerState({
                    platinumCoins: stateData.playerState.platinumCoins ?? 0,
                    moonPoints: stateData.playerState.moonPoints || 0,
                    level: Math.max(1, Number(stateData.playerState.level) || 1),
                })
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

            const activeEncounter = activeEncounterData?.encounter || null
            const activeEncounterMapId = String(activeEncounter?.mapId || '')
            const currentMapId = String(mapData?.map?._id || '')
            if (activeEncounter && activeEncounterMapId && currentMapId && activeEncounterMapId === currentMapId) {
                setEncounter({
                    id: activeEncounter._id,
                    pokemon: activeEncounter.pokemon,
                    level: activeEncounter.level,
                    hp: activeEncounter.hp,
                    maxHp: activeEncounter.maxHp,
                })
                setCatchAttemptInfo({
                    attempts: Math.max(0, Number(activeEncounter.catchAttempts || 0)),
                    maxAttempts: Math.max(1, Number(activeEncounter.maxCatchAttempts || 3)),
                })
                setPlayerBattle(activeEncounter.playerBattle || null)
                setActionMessage('Đã khôi phục Pokemon hoang dã bạn đang gặp.')
                await loadInventory({ force: true })
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadInventory = async ({ force = false } = {}) => {
        try {
            if (force) {
                await queryClient.invalidateQueries({ queryKey: inventoryQueryOptions().queryKey })
            }
            const data = await queryClient.fetchQuery(inventoryQueryOptions())
            setInventory(data.inventory || [])
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const resetSearchButtonOffset = () => {
        setSearchButtonOffset({ x: 0, y: 0 })
    }

    const shouldUseSearchChallenge = () => {
        return !autoSearchEnabled
    }

    const openSearchChallenge = () => {
        lastSearchChallengeAtRef.current = Date.now()
        setSearchChallenge(createSearchChallenge())
        setSearchChallengeInput('')
        setSearchChallengeError('')
    }

    const handleSearchChallengeAnswer = () => {
        if (!searchChallenge) return

        const numericChoice = Number.parseInt(String(searchChallengeInput || '').trim(), 10)
        const correctAnswer = Number(searchChallenge.answer)

        if (!Number.isFinite(numericChoice)) {
            setSearchChallengeError('Nhập đáp án hợp lệ để tiếp tục.')
            return
        }

        if (numericChoice === correctAnswer) {
            setSearchChallenge(null)
            setSearchChallengeInput('')
            setSearchChallengeError('')
            searchSpamCountRef.current = 0
            searchVeryFastSpamStreakRef.current = 0
            lastSearchSpamAttemptAtRef.current = 0
            resetSearchButtonOffset()
            setLastResult({ encountered: false, message: 'Chú ý: Xác minh thành công, bạn có thể tiếp tục tìm kiếm.' })
            return
        }

        setSearchChallengeError('Sai mật mã. Hãy thử lại câu khác.')
        setSearchChallenge(createSearchChallenge())
        setSearchChallengeInput('')
    }

    const nudgeSearchButton = ({ veryFastSpam = false } = {}) => {
        if (typeof window === 'undefined') return

        lastSearchButtonRepositionAtRef.current = Date.now()

        const viewportWidth = Number(window.innerWidth || 1024)
        const isMobileViewport = viewportWidth < 640
        const useExtraFarOffset = veryFastSpam && isMobileViewport
        const minX = useExtraFarOffset ? 90 : (isMobileViewport ? 26 : 90)
        const maxX = useExtraFarOffset ? 170 : (isMobileViewport ? 50 : 150)
        const minY = useExtraFarOffset ? 34 : (isMobileViewport ? 12 : 28)
        const maxY = useExtraFarOffset ? 95 : (isMobileViewport ? 30 : 70)
        const randomFarOffset = (min, max) => {
            const distance = min + Math.floor(Math.random() * Math.max(1, (max - min + 1)))
            return (Math.random() < 0.5 ? -1 : 1) * distance
        }

        const nextX = randomFarOffset(minX, maxX)
        const nextY = randomFarOffset(minY, maxY)

        setSearchButtonOffset({ x: nextX, y: nextY })
    }

    const registerSearchSpamAttempt = (retryAfterMs = 0) => {
        const nowMs = Date.now()
        const elapsedSinceLastSpamAttempt = nowMs - Number(lastSearchSpamAttemptAtRef.current || 0)
        const isVeryFastAttempt = lastSearchSpamAttemptAtRef.current > 0 && elapsedSinceLastSpamAttempt <= SEARCH_VERY_FAST_SPAM_INTERVAL_MS
        searchVeryFastSpamStreakRef.current = isVeryFastAttempt
            ? (searchVeryFastSpamStreakRef.current + 1)
            : 1
        lastSearchSpamAttemptAtRef.current = nowMs
        const isVeryFastSpamBurst = searchVeryFastSpamStreakRef.current >= SEARCH_VERY_FAST_SPAM_STREAK_THRESHOLD
        const nextSpamCount = searchSpamCountRef.current + 1
        searchSpamCountRef.current = nextSpamCount

        if (searchChallenge) {
            setLastResult({ encountered: false, message: 'Chú ý: Trả lời mật mã để tiếp tục tìm kiếm.' })
            return
        }

        const isButtonCurrentlyShifted = searchButtonOffset.x !== 0 || searchButtonOffset.y !== 0
        const canRepositionButton = (nowMs - Number(lastSearchButtonRepositionAtRef.current || 0)) >= SEARCH_BUTTON_REPOSITION_COOLDOWN_MS
        const shouldForceReposition = isVeryFastSpamBurst && (nextSpamCount % SEARCH_VERY_FAST_SPAM_REPOSITION_THRESHOLD === 0)
        if (shouldForceReposition) {
            nudgeSearchButton({ veryFastSpam: true })
        } else if (!isButtonCurrentlyShifted && canRepositionButton && (nextSpamCount % SEARCH_SPAM_REPOSITION_THRESHOLD === 0)) {
            nudgeSearchButton()
        }

        if (retryAfterMs > 0) {
            const safeRetryAfterMs = Math.max(50, Math.floor(retryAfterMs))
            const retryAfterLabel = safeRetryAfterMs >= 1000
                ? `${Math.ceil(safeRetryAfterMs / 100) / 10}s`
                : `${Math.ceil(safeRetryAfterMs / 50) * 50}ms`
            setLastResult({ encountered: false, message: `Chú ý: Tìm kiếm quá nhanh. Vui lòng đợi ${retryAfterLabel}.` })
            return
        }

        setLastResult({ encountered: false, message: 'Chú ý: Tìm kiếm quá nhanh. Vui lòng đợi một chút.' })
    }

    const handleSearch = async () => {
        if (searchChallenge) {
            setLastResult({ encountered: false, message: 'Chú ý: Trả lời mật mã để tiếp tục tìm kiếm.' })
            return
        }

        if (isLocked) {
            setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Hãy hoàn thành yêu cầu để mở.' })
            return
        }

        if (searching) {
            registerSearchSpamAttempt(LOCAL_SEARCH_SPAM_COOLDOWN_MS)
            return
        }

        const nowMs = Date.now()
        if (shouldUseSearchChallenge()) {
            const shouldTriggerPeriodicChallenge = (nowMs - Number(lastSearchChallengeAtRef.current || 0)) >= SEARCH_CHALLENGE_INTERVAL_MS
            if (shouldTriggerPeriodicChallenge) {
                openSearchChallenge()
                setLastResult({ encountered: false, message: 'Chú ý: Trả lời mật mã để tiếp tục tìm kiếm.' })
                return
            }
        }

        const elapsedSinceLastRequest = nowMs - Number(lastSearchRequestAtRef.current || 0)
        if (lastSearchRequestAtRef.current > 0 && elapsedSinceLastRequest < LOCAL_SEARCH_SPAM_COOLDOWN_MS) {
            registerSearchSpamAttempt(LOCAL_SEARCH_SPAM_COOLDOWN_MS - elapsedSinceLastRequest)
            return
        }
        const shouldResetSearchButtonAfterRequest = searchButtonOffset.x !== 0 || searchButtonOffset.y !== 0

        lastSearchRequestAtRef.current = nowMs

        try {
            if (typeof window !== 'undefined') {
                searchScrollYRef.current = window.scrollY || window.pageYOffset || 0
                shouldRestoreSearchScrollRef.current = true
            }
            setSearching(true)

            const res = await gameApi.searchMap(slug)
            if (res?.locked) {
                setUnlockInfo(res.unlock || null)
                setIsLocked(true)
                setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Hãy hoàn thành yêu cầu để mở.' })
                searchSpamCountRef.current = 0
                searchVeryFastSpamStreakRef.current = 0
                lastSearchSpamAttemptAtRef.current = 0
                if (shouldResetSearchButtonAfterRequest) {
                    resetSearchButtonOffset()
                }
                setSearchChallenge(null)
                setSearchChallengeError('')
                return
            }

            setIsLocked(false)
            searchSpamCountRef.current = 0
            searchVeryFastSpamStreakRef.current = 0
            lastSearchSpamAttemptAtRef.current = 0
            if (shouldResetSearchButtonAfterRequest) {
                resetSearchButtonOffset()
            }

            setLastResult(res)
            if (res.encountered) {
                setSearchChallenge(null)
                setSearchChallengeError('')
                const encounterSummary = buildEncounterSummary(res)
                if (encounterSummary) {
                    setLastEncounterSummary(encounterSummary)
                    if (typeof window !== 'undefined') {
                        try {
                            window.localStorage.setItem(
                                getLastEncounterStorageKey(slug),
                                JSON.stringify(encounterSummary)
                            )
                        } catch (_error) {
                            // Ignore storage errors in non-critical UI feature
                        }
                    }
                }
                setEncounter({
                    id: res.encounterId,
                    pokemon: res.pokemon,
                    level: res.level,
                    hp: res.hp,
                    maxHp: res.maxHp,
                })
                setPlayerBattle(res.playerBattle || null)
                await loadInventory()
                if (res.itemDrop) {
                    setActionMessage(`Nhặt được: ${res.itemDrop.name}`)
                }
            } else {
                setEncounter(null)
                setPlayerBattle(null)
                if (!res.itemDrop) {
                    setActionMessage('')
                }
            }
            if (res.mapProgress) {
                setMapStats(res.mapProgress)
            }

            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('game:map-progress-updated'))
            }
        } catch (err) {
            const isCooldownError = err?.code === 'ACTION_COOLDOWN' || /quá nhanh/i.test(String(err?.message || ''))
            if (isCooldownError) {
                const retryAfterMs = Math.max(0, Number(err?.retryAfterMs || 0))
                registerSearchSpamAttempt(retryAfterMs)
            } else {
                searchSpamCountRef.current = 0
                searchVeryFastSpamStreakRef.current = 0
                lastSearchSpamAttemptAtRef.current = 0
                setLastResult({ encountered: false, message: 'Chú ý: ' + err.message })
            }
        } finally {
            setSearching(false)
        }
    }

    const applyAutoSearchStatus = (status = {}, options = {}) => {
        const forceConfig = Boolean(options?.forceConfig)
        const serverSnapshot = buildAutoSearchConfigSnapshot({
            enabled: Boolean(status?.enabled),
            mapSlug: String(status?.mapSlug || slug || '').trim().toLowerCase(),
            searchIntervalMs: Math.max(900, Number(status?.searchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS),
            actionByRarity: status?.actionByRarity || DEFAULT_AUTO_ACTION_BY_RARITY,
            catchFormMode: String(status?.catchFormMode || 'all').trim().toLowerCase() || 'all',
            catchBallItemId: String(status?.catchBallItemId || '').trim(),
        })
        lastAutoSearchServerSnapshotRef.current = serverSnapshot

        const shouldApplyConfig = forceConfig || !autoSearchConfigDirtyRef.current
        if (shouldApplyConfig) {
            setAutoSearchEnabled(Boolean(status?.enabled))
            setAutoSearchIntervalMs(Math.max(900, Number(status?.searchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS))
            const nextActionByRarity = {
                ...DEFAULT_AUTO_ACTION_BY_RARITY,
                ...(status?.actionByRarity || {}),
            }
            setAutoActionByRarity((prev) => (isSameAutoActionByRarity(prev, nextActionByRarity) ? prev : nextActionByRarity))
            setAutoCatchFormMode(String(status?.catchFormMode || 'all').trim().toLowerCase() || 'all')
            setAutoCatchBallId(String(status?.catchBallItemId || '').trim())
            syncAutoSearchConfigDirty(false)
        }

        setAutoSearchUsageToday(Math.max(0, Number(status?.daily?.count) || 0))
        setAutoSearchUsesPerDayLimit(Math.max(0, Number(status?.daily?.limit) || autoSearchLimitConfig.usesPerDay || 0))
        setAutoSearchRuntimeTodayMinutes(Math.max(0, Number(status?.daily?.runtimeMinutes) || 0))
        setAutoSearchRuntimeLimitMinutes(Math.max(0, Number(status?.daily?.runtimeLimitMinutes) || autoSearchDurationLimitMinutes || 0))
        setAutoSearchHistory({
            ...DEFAULT_AUTO_SEARCH_HISTORY,
            ...(status?.history || {}),
        })

        const logs = Array.isArray(status?.logs) ? status.logs : []
        setAutoSearchServerLogs(logs)
        const mapName = String(status?.map?.name || '').trim()
        const latestLogMessage = formatFriendlyAutoSearchMessage(logs[0]?.message)
        setAutoSearchServerStatus(
            (Boolean(status?.enabled)
                ? `Đang chạy ngầm${mapName ? ` tại ${mapName}` : ''}. ${latestLogMessage || 'Đang tự tìm theo cấu hình.'}`
                : (latestLogMessage || 'Tự tìm kiếm đang tắt.'))
        )
    }

    useEffect(() => {
        const serverSnapshot = String(lastAutoSearchServerSnapshotRef.current || '')
        if (!serverSnapshot) return

        const localSnapshot = buildAutoSearchConfigSnapshot({
            enabled: autoSearchEnabled,
            mapSlug: slug,
            searchIntervalMs: autoSearchIntervalMs,
            actionByRarity: autoActionByRarity,
            catchFormMode: autoCatchFormMode,
            catchBallItemId: autoCatchBallId,
        })

        const isDirty = localSnapshot !== serverSnapshot
        syncAutoSearchConfigDirty(isDirty)
    }, [
        autoSearchEnabled,
        slug,
        autoSearchIntervalMs,
        autoActionByRarity,
        autoCatchFormMode,
        autoCatchBallId,
    ])

    useEffect(() => {
        if (!user || typeof window === 'undefined') return undefined
        let cancelled = false
        let timerId = null

        const resolveNextDelayMs = (hadError = false) => {
            if (document.hidden) return 15000
            const baseDelay = autoSearchEnabled ? 5000 : 10000
            return hadError ? Math.min(baseDelay * 2, 20000) : baseDelay
        }

        const scheduleNext = (hadError = false) => {
            if (cancelled) return
            timerId = window.setTimeout(() => {
                void syncAutoSearchStatus()
            }, resolveNextDelayMs(hadError))
        }

        const syncAutoSearchStatus = async () => {
            try {
                const [statusRes, inventoryRes] = await Promise.all([
                    gameApi.getAutoSearchStatus(),
                    queryClient.fetchQuery(inventoryQueryOptions()).catch(() => null),
                ])
                if (cancelled) return
                applyAutoSearchStatus(statusRes?.autoSearch || {})

                if (inventoryRes?.inventory) {
                    setInventory(Array.isArray(inventoryRes.inventory) ? inventoryRes.inventory : [])
                }
                if (inventoryRes?.playerState) {
                    setPlayerState((prev) => ({
                        ...prev,
                        ...inventoryRes.playerState,
                    }))
                }
                scheduleNext(false)
            } catch (error) {
                if (!cancelled) {
                    setAutoSearchServerStatus(formatFriendlyAutoSearchMessage(String(error?.message || 'Không thể tải trạng thái tự tìm kiếm.')))
                }
                scheduleNext(true)
            }
        }

        const handleVisibilityChange = () => {
            if (cancelled) return
            if (timerId) {
                window.clearTimeout(timerId)
                timerId = null
            }
            scheduleNext(false)
        }

        void syncAutoSearchStatus()
        window.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            cancelled = true
            if (timerId) {
                window.clearTimeout(timerId)
                timerId = null
            }
            window.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [user?.id, slug, autoSearchEnabled, queryClient])

    useEffect(() => {
        if (!user || !isAutoSearchConfigDirty) return undefined

        const timer = window.setTimeout(async () => {
            try {
                const res = await gameApi.updateAutoSearchSettings({
                    enabled: autoSearchEnabled,
                    mapSlug: slug,
                    searchIntervalMs: Math.max(900, Number(autoSearchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS),
                    actionByRarity: autoActionByRarity,
                    catchFormMode: autoCatchFormMode,
                    catchBallItemId: String(autoCatchBallId || '').trim(),
                })
                applyAutoSearchStatus(res?.autoSearch || {}, { forceConfig: true })
            } catch (error) {
                setActionMessage(String(error?.message || 'Không thể đồng bộ cấu hình tự tìm kiếm.'))
            }
        }, 500)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        user?.id,
        isAutoSearchConfigDirty,
        autoSearchEnabled,
        slug,
        autoSearchIntervalMs,
        autoActionByRarity,
        autoCatchFormMode,
        autoCatchBallId,
    ])

    const handleAttack = async () => {
        if (!encounter?.id) return
        try {
            setActionLoading(true)
            const res = await gameApi.attackEncounter(encounter.id)
            setEncounter(prev => prev ? { ...prev, hp: res.hp, maxHp: res.maxHp } : prev)
            setPlayerBattle(res?.playerBattle || null)
            if (res?.playerState) {
                setPlayerState((prev) => ({
                    ...prev,
                    platinumCoins: Number(res.playerState.platinumCoins ?? prev.platinumCoins ?? 0),
                    moonPoints: Number(res.playerState.moonPoints ?? prev.moonPoints ?? 0),
                    level: Math.max(1, Number(res.playerState.level ?? prev.level) || 1),
                }))
            }
            setActionMessage(res.message || 'Đã tấn công!')
            if (res.defeated || res.playerDefeated) {
                setEncounter(null)
                setPlayerBattle(null)
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
            if (Number.isFinite(res.catchAttempts)) {
                setCatchAttemptInfo({
                    attempts: res.catchAttempts,
                    maxAttempts: res.maxCatchAttempts || 3,
                })
            }
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : res.fled ? 'Pokemon đã bỏ chạy!' : 'Bắt thất bại!'))
            if (res.caught || res.fled) {
                setEncounter(null)
                setPlayerBattle(null)
                setCatchAttemptInfo({ attempts: 0, maxAttempts: 3 })
            }
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const handleUseBall = async (forcedBallId = '') => {
        const normalizedForcedBallId = extractObjectIdLike(forcedBallId)
        const resolvedBallId = normalizedForcedBallId || extractObjectIdLike(selectedBallId)
        if (!encounter?.id || !resolvedBallId) return
        try {
            setActionLoading(true)
            const res = await gameApi.useItem(resolvedBallId, 1, encounter.id)
            if (Number.isFinite(res.catchAttempts)) {
                setCatchAttemptInfo({
                    attempts: res.catchAttempts,
                    maxAttempts: res.maxCatchAttempts || 3,
                })
            }
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : res.fled ? 'Pokemon đã bỏ chạy!' : 'Bắt thất bại!'))
            await loadInventory({ force: true })
            if (res.caught || res.fled) {
                setEncounter(null)
                setPlayerBattle(null)
                setCatchAttemptInfo({ attempts: 0, maxAttempts: 3 })
            }
        } catch (err) {
            setActionMessage(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const resolveLowHpCatchBonusCapPercent = (rarity = '') => {
        const normalizedRarity = String(rarity || '').trim().toLowerCase()
        const capFromRarity = Number(LOW_HP_CATCH_BONUS_CAP_BY_RARITY[normalizedRarity])
        if (Number.isFinite(capFromRarity) && capFromRarity >= 0) return capFromRarity
        return LOW_HP_CATCH_BONUS_CAP_FALLBACK
    }

    const calcLowHpCatchBonusPercent = ({ hp, maxHp, rarity }) => {
        const normalizedMaxHp = Math.max(1, Number(maxHp) || 1)
        const resolvedHp = Number.isFinite(Number(hp)) ? Number(hp) : normalizedMaxHp
        const normalizedHp = Math.min(normalizedMaxHp, Math.max(0, resolvedHp))
        const missingHpRatio = (normalizedMaxHp - normalizedHp) / normalizedMaxHp
        const capPercent = resolveLowHpCatchBonusCapPercent(rarity)
        return Math.max(0, missingHpRatio * capPercent)
    }

    const getBallCatchChance = ({ item, baseChance, hp, maxHp, rarity, rarityCatchBonusPercent = 0 }) => {
        const hasFixedCatchRate = item?.effectType === 'catchMultiplier' && Number.isFinite(Number(item.effectValue))
        const safeBaseChance = Number.isFinite(Number(baseChance)) ? Number(baseChance) : 0.02
        const chanceBeforeLowHpBonus = hasFixedCatchRate
            ? Math.min(1, Math.max(0, Number(item.effectValue) / 100))
            : Math.min(
                0.95,
                Math.max(0.02, safeBaseChance) * (1 + ((Number(rarityCatchBonusPercent) || 0) / 100))
            )
        const lowHpCatchBonusPercent = calcLowHpCatchBonusPercent({ hp, maxHp, rarity })
        const minChance = hasFixedCatchRate ? 0 : 0.02
        return Math.min(0.99, Math.max(minChance, chanceBeforeLowHpBonus * (1 + (lowHpCatchBonusPercent / 100))))
    }

    const calcCatchChance = ({ catchRate, hp, maxHp }) => {
        const rate = Math.min(255, Math.max(1, catchRate || 45))
        const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
        const raw = (rate / 255) * hpFactor
        return Math.min(0.95, Math.max(0.02, raw))
    }

    const handleRun = async () => {
        if (!encounter?.id) return
        try {
            setActionLoading(true)
            const res = await gameApi.runEncounter(encounter.id)
            setActionMessage(res.message || 'Bạn đã bỏ chạy.')
            setEncounter(null)
            setPlayerBattle(null)
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
    const basePokemonEncounterEntries = (() => {
        const source = pokemonEncounters.length > 0 ? pokemonEncounters : buildPokemonEncounterFallback(map, dropRates)
        return [...source].sort((left, right) => {
            const leftPokemon = left?.pokemonId || {}
            const rightPokemon = right?.pokemonId || {}
            const leftValueByKey = {
                name: String(leftPokemon?.name || ''),
                pokedexNumber: Number(leftPokemon?.pokedexNumber || 0),
                rarity: POKEMON_RARITY_ORDER[String(leftPokemon?.rarity || '').trim().toLowerCase()] ?? -1,
                source: String(left?.source || ''),
                form: String(left?.form?.formName || left?.formId || ''),
                type: String(Array.isArray(leftPokemon?.types) ? leftPokemon.types[0] : ''),
            }
            const rightValueByKey = {
                name: String(rightPokemon?.name || ''),
                pokedexNumber: Number(rightPokemon?.pokedexNumber || 0),
                rarity: POKEMON_RARITY_ORDER[String(rightPokemon?.rarity || '').trim().toLowerCase()] ?? -1,
                source: String(right?.source || ''),
                form: String(right?.form?.formName || right?.formId || ''),
                type: String(Array.isArray(rightPokemon?.types) ? rightPokemon.types[0] : ''),
            }
            const direction = pokemonSortDirection === 'asc' ? 1 : -1
            const leftValue = leftValueByKey[pokemonSortKey]
            const rightValue = rightValueByKey[pokemonSortKey]
            const comparison = (typeof leftValue === 'string' || typeof rightValue === 'string')
                ? compareText(leftValue, rightValue)
                : ((Number(leftValue) || 0) - (Number(rightValue) || 0))
            if (comparison !== 0) return comparison * direction
            return compareText(leftPokemon?.name, rightPokemon?.name)
        })
    })()
    const pokemonTypeOptions = [...new Set(basePokemonEncounterEntries.flatMap((entry) => {
        const pokemon = entry?.pokemonId || {}
        return Array.isArray(pokemon?.types) ? pokemon.types.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean) : []
    }))].sort((left, right) => compareText(left, right))
    const pokemonEncounterEntries = basePokemonEncounterEntries.filter((entry) => {
        const pokemon = entry?.pokemonId || {}
        const normalizedSearch = String(pokemonSearch || '').trim().toLowerCase()
        const normalizedRarity = String(pokemonRarityFilter || '').trim().toLowerCase()
        const normalizedType = String(pokemonTypeFilter || '').trim().toLowerCase()
        const normalizedSource = String(pokemonSourceFilter || '').trim().toLowerCase()
        const types = Array.isArray(pokemon?.types) ? pokemon.types.map((type) => String(type || '').trim().toLowerCase()) : []
        const formName = String(entry?.form?.formName || entry?.formId || '').trim().toLowerCase()

        if (normalizedSearch && !String(pokemon?.name || '').toLowerCase().includes(normalizedSearch) && !formName.includes(normalizedSearch)) return false
        if (normalizedRarity && String(pokemon?.rarity || '').trim().toLowerCase() !== normalizedRarity) return false
        if (normalizedType && !types.includes(normalizedType)) return false
        if (normalizedSource && String(entry?.source || '').trim().toLowerCase() !== normalizedSource) return false
        return true
    })
    const baseItemDropEntries = (() => {
        return [...itemDropRates].sort((left, right) => {
            const leftItem = left?.itemId || {}
            const rightItem = right?.itemId || {}
            const leftValueByKey = {
                dropPercent: Number(left?.dropPercent || 0),
                name: String(leftItem?.name || ''),
                type: String(leftItem?.type || ''),
                rarity: ITEM_RARITY_ORDER[String(leftItem?.rarity || '').trim().toLowerCase()] ?? -1,
            }
            const rightValueByKey = {
                dropPercent: Number(right?.dropPercent || 0),
                name: String(rightItem?.name || ''),
                type: String(rightItem?.type || ''),
                rarity: ITEM_RARITY_ORDER[String(rightItem?.rarity || '').trim().toLowerCase()] ?? -1,
            }
            const direction = itemSortDirection === 'asc' ? 1 : -1
            const leftValue = leftValueByKey[itemSortKey]
            const rightValue = rightValueByKey[itemSortKey]
            const comparison = (typeof leftValue === 'string' || typeof rightValue === 'string')
                ? compareText(leftValue, rightValue)
                : ((Number(leftValue) || 0) - (Number(rightValue) || 0))
            if (comparison !== 0) return comparison * direction
            return compareText(leftItem?.name, rightItem?.name)
        })
    })()
    const itemDropEntries = baseItemDropEntries.filter((entry) => {
        const item = entry?.itemId || {}
        const normalizedSearch = String(itemSearch || '').trim().toLowerCase()
        const normalizedRarity = String(itemRarityFilter || '').trim().toLowerCase()
        const normalizedType = String(itemTypeFilter || '').trim().toLowerCase()

        if (normalizedSearch && !String(item?.name || '').toLowerCase().includes(normalizedSearch) && !String(item?.description || '').toLowerCase().includes(normalizedSearch)) return false
        if (normalizedRarity && String(item?.rarity || '').trim().toLowerCase() !== normalizedRarity) return false
        if (normalizedType && String(item?.type || '').trim().toLowerCase() !== normalizedType) return false
        return true
    })
    const pokemonTotalPages = Math.max(1, Math.ceil(pokemonEncounterEntries.length / pokemonPageSize))
    const itemTotalPages = Math.max(1, Math.ceil(itemDropEntries.length / itemPageSize))
    const normalizedPokemonPage = Math.min(pokemonPage, pokemonTotalPages)
    const normalizedItemPage = Math.min(itemPage, itemTotalPages)
    const paginatedPokemonEncounters = pokemonEncounterEntries.slice((normalizedPokemonPage - 1) * pokemonPageSize, normalizedPokemonPage * pokemonPageSize)
    const paginatedItemDrops = itemDropEntries.slice((normalizedItemPage - 1) * itemPageSize, normalizedItemPage * itemPageSize)
    const enemyHpPercent = encounter
        ? Math.max(5, Math.round((encounter.hp / Math.max(1, encounter.maxHp)) * 100))
        : 0
    const playerHpPercent = playerBattle
        ? Math.max(0, Math.round((playerBattle.currentHp / Math.max(1, playerBattle.maxHp)) * 100))
        : 0

    if (isLocked) {
        return (
            <div className="max-w-3xl mx-auto font-sans text-sm animate-fadeIn">
                <div className="border-[3px] border-blue-700 rounded-lg bg-blue-900 overflow-hidden shadow-lg min-h-[600px]">
                    <div className="text-center py-3 bg-gradient-to-b from-white to-blue-50 border-b-2 border-slate-300 shadow-sm">
                        <div className="flex flex-col items-center justify-center gap-0.5">
                            <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                                <span>🪙</span>
                                <span>${formattedGold} Xu Bạch Kim</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                                <span>🌑</span>
                                <span>{formattedMoonPoints} Điểm Nguyệt Các</span>
                            </div>
                        </div>
                        <div className="mt-2 text-slate-800 text-sm">
                            <div>
                                Yêu cầu cấp: <span className="font-bold">Lv {requiredPlayerLevel}</span> (hiện tại Lv {currentPlayerLevel})
                                {unlockRemainingLevels > 0 ? <span className="ml-1 text-red-600 font-bold">- thiếu {unlockRemainingLevels} cấp</span> : null}
                            </div>
                            {requiredVipLevel > 0 && (
                                <div className="mt-1">
                                    Yêu cầu VIP: <span className="font-bold">VIP {requiredVipLevel}</span> (hiện tại VIP {currentVipLevel})
                                    {unlockRemainingVipLevels > 0 ? <span className="ml-1 text-red-600 font-bold">- thiếu {unlockRemainingVipLevels} cấp VIP</span> : null}
                                </div>
                            )}
                            {autoSearchRequiredVipLevel > 0 && (
                                <div className="mt-1 text-blue-800">
                                    Mở auto tìm: <span className="font-bold">VIP {autoSearchRequiredVipLevel}</span> trở lên
                                    {remainingAutoSearchVipLevels > 0 ? <span className="ml-1 text-red-600 font-bold">- còn thiếu {remainingAutoSearchVipLevels} cấp VIP</span> : null}
                                </div>
                            )}
                            {requiredSearches > 0 && (
                                <div className="mt-1">
                                    Yêu cầu tìm kiếm: <span className="font-bold">{requiredSearches}</span> lần tại <Link to={unlockInfo?.sourceMap?.slug ? `/map/${unlockInfo.sourceMap.slug}` : '#'} className="font-bold text-blue-700 hover:underline">{unlockInfo?.sourceMap?.name || 'bản đồ trước'}</Link>.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-3xl mx-auto font-sans text-sm animate-fadeIn">
            <div className="border-[3px] border-blue-700 rounded-lg bg-white overflow-hidden shadow-lg">
                <div className="text-center py-2 bg-gradient-to-b from-white to-blue-50 border-b border-blue-200">
                    <div className="flex flex-col items-center justify-center gap-0.5">
                        <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                            <span>🪙</span>
                            <span>${formattedGold} Xu Bạch Kim</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs">
                            <span>🌑</span>
                            <span>{formattedMoonPoints} Điểm Nguyệt Các</span>
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
                        [
                        {' '}
                        <button
                            type="button"
                            className="hover:underline"
                            onClick={() => setFeatureNotice('Tính năng Sự Kiện trên bản đồ chưa được cập nhật.')}
                        >
                            Sự Kiện
                        </button>
                        {' '}
                        ]
                        {' '}
                        [ <Link to="/shop/buy" className="hover:underline">Cửa Hàng</Link> ]
                    </div>
                </div>

                {featureNotice && (
                    <div className="p-2 border-b border-blue-300 bg-white">
                        <FeatureUnavailableNotice compact message={featureNotice} />
                    </div>
                )}

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
                                Pokemon Đặc Biệt
                            </div>
                            <div className="flex justify-center flex-wrap gap-4 sm:gap-6 py-6 min-h-[120px] items-center bg-gradient-to-b from-purple-50/30 to-white">
                                {specialPokemons.length > 0
                                    ? specialPokemons.map((pokemon) => (
                                        <div key={pokemon.id || pokemon._id} className="flex flex-col items-center">
                                            <img
                                                src={pokemon.imageUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokedexNumber}.png`}
                                                alt={pokemon.name || 'Special Pokemon'}
                                                className="w-24 h-24 sm:w-32 sm:h-32 object-contain pixelated hover:scale-110 transition-transform drop-shadow-sm"
                                            />
                                            {pokemon.name && (
                                                <p className="text-xs font-bold text-blue-800 mt-1 text-center">
                                                    {pokemon.name}
                                                    {pokemon.formName && pokemon.formName !== 'normal' ? ` (${pokemon.formName})` : ''}
                                                </p>
                                            )}
                                        </div>
                                    ))
                                    : map.specialPokemonImages.map((imageUrl, index) => (
                                        <div key={index} className="flex flex-col items-center">
                                            <img
                                                src={imageUrl}
                                                alt={`Special Pokemon ${index + 1}`}
                                                className="w-24 h-24 sm:w-32 sm:h-32 object-contain pixelated hover:scale-110 transition-transform drop-shadow-sm"
                                            />
                                        </div>
                                    ))}
                            </div>
                        </>
                    )}
                    {/* Normal Pokemon SECTION HIDDEN AS REQUESTED */}
                    {/* 
                    <div>
                        <div className="bg-sky-100/50 text-center py-1 text-blue-900 font-bold text-xs border-y border-blue-200">
                            Pokemon Thường
                        </div>
                        <div className="flex justify-center flex-wrap gap-3 sm:gap-6 py-4 min-h-[80px] items-center bg-white">
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
                    */}

                    <div className="border-t border-blue-200 bg-slate-50">
                        <div className="bg-sky-100/60 py-1 px-3 text-blue-900 font-bold text-xs border-y border-blue-200 flex items-center justify-between gap-3">
                            <span>Chi Tiết Tỷ Lệ Xuất Hiện</span>
                            <button
                                type="button"
                                onClick={() => setIsEncounterDetailExpanded((prev) => !prev)}
                                className="rounded border border-blue-300 bg-white px-2 py-1 text-[11px] font-bold text-blue-800 hover:bg-blue-50"
                            >
                                {isEncounterDetailExpanded ? 'Thu gọn' : 'Mở rộng'}
                            </button>
                        </div>
                        {isEncounterDetailExpanded && <div className="p-3 sm:p-4 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setDetailTab('pokemon')}
                                    className={`px-3 py-1.5 rounded border text-xs font-bold ${detailTab === 'pokemon' ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-50'}`}
                                >
                                    Pokemon ({pokemonEncounterEntries.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDetailTab('item')}
                                    className={`px-3 py-1.5 rounded border text-xs font-bold ${detailTab === 'item' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'}`}
                                >
                                    Vật phẩm ({itemDropEntries.length})
                                </button>
                            </div>

                            {detailTab === 'pokemon' ? (
                                <>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                        <div className="text-xs font-semibold text-slate-600">
                                            Tỷ lệ gặp Pokemon tổng: <span className="text-blue-700">{formatPercent((Number(map.encounterRate) || 0) * 100)}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <input value={pokemonSearch} onChange={(e) => setPokemonSearch(e.target.value)} placeholder="Tìm Pokemon hoặc form" className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700" />
                                            <select value={pokemonRarityFilter} onChange={(e) => setPokemonRarityFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="">Tất cả độ hiếm</option>
                                                {Object.keys(POKEMON_RARITY_ORDER).map((rarityKey) => <option key={rarityKey} value={rarityKey}>{rarityKey.toUpperCase()}</option>)}
                                            </select>
                                            <select value={pokemonTypeFilter} onChange={(e) => setPokemonTypeFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="">Tất cả hệ</option>
                                                {pokemonTypeOptions.map((type) => <option key={type} value={type}>{capitalizeWords(type)}</option>)}
                                            </select>
                                            <select value={pokemonSourceFilter} onChange={(e) => setPokemonSourceFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="">Tất cả loại</option>
                                                <option value="normal">Thường</option>
                                                <option value="special">Đặc biệt</option>
                                            </select>
                                            <select value={pokemonSortKey} onChange={(e) => setPokemonSortKey(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="name">Tên</option>
                                                <option value="pokedexNumber">Pokedex</option>
                                                <option value="rarity">Độ hiếm</option>
                                                <option value="source">Loại</option>
                                                <option value="form">Dạng</option>
                                                <option value="type">Hệ</option>
                                            </select>
                                            <select value={pokemonSortDirection} onChange={(e) => setPokemonSortDirection(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="desc">Giảm dần</option>
                                                <option value="asc">Tăng dần</option>
                                            </select>
                                            <select value={pokemonPageSize} onChange={(e) => setPokemonPageSize(Number(e.target.value) || MAP_DETAIL_PAGE_SIZE_OPTIONS[0])} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                {MAP_DETAIL_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}/trang</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                                        <table className="w-full min-w-[760px] text-xs">
                                            <thead>
                                                <tr className="bg-blue-50 text-blue-900">
                                                    <th className="px-3 py-2 text-left font-bold">Pokemon</th>
                                                    <th className="px-3 py-2 text-center font-bold">Loại</th>
                                                    <th className="px-3 py-2 text-center font-bold">Độ hiếm</th>
                                                    <th className="px-3 py-2 text-center font-bold">Hệ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {paginatedPokemonEncounters.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="px-3 py-8 text-center text-slate-500">Không tìm thấy Pokemon phù hợp bộ lọc.</td>
                                                    </tr>
                                                ) : paginatedPokemonEncounters.map((entry) => {
                                                    const pokemon = entry?.pokemonId || {}
                                                    const rarityMeta = getRarityStyle(pokemon?.rarity)
                                                    const formName = String(entry?.form?.formName || entry?.formId || '').trim().toLowerCase() !== 'normal'
                                                        ? (entry?.form?.formName || entry?.formId)
                                                        : ''
                                                    const types = Array.isArray(pokemon?.types) ? pokemon.types : []

                                                    return (
                                                        <tr key={entry?._id || `${pokemon?._id || pokemon?.name}-${entry?.formId || 'normal'}-${entry?.source || 'normal'}`} className="border-t border-slate-100 hover:bg-slate-50">
                                                            <td className="px-3 py-2">
                                                                <div className="flex items-center gap-3">
                                                                    <img src={entry?.resolvedImageUrl || pokemon?.imageUrl || pokemon?.sprites?.normal || ''} alt={pokemon?.name || 'Pokemon'} className="h-12 w-12 object-contain pixelated" />
                                                                    <div>
                                                                        <div className="font-bold text-slate-800">{pokemon?.name || 'Pokemon'}{formName ? ` (${formName})` : ''}</div>
                                                                        <div className="text-[11px] text-slate-500">#{pokemon?.pokedexNumber || '-'}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center"><span className={`inline-flex rounded-full px-2 py-1 font-bold ${entry?.source === 'special' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{entry?.source === 'special' ? 'Đặc biệt' : 'Thường'}</span></td>
                                                            <td className="px-3 py-2 text-center"><span className={`font-bold ${rarityMeta.text}`}>{rarityMeta.label}</span></td>
                                                            <td className="px-3 py-2 text-center text-slate-700">{types.length > 0 ? types.map((type) => capitalizeWords(type)).join(', ') : '-'}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
                                        <div className="text-slate-600">
                                            Hiển thị {pokemonEncounterEntries.length === 0 ? 0 : ((normalizedPokemonPage - 1) * pokemonPageSize) + 1}-{Math.min(pokemonEncounterEntries.length, normalizedPokemonPage * pokemonPageSize)} / {pokemonEncounterEntries.length} Pokemon
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => setPokemonPage((prev) => Math.max(1, prev - 1))} disabled={normalizedPokemonPage <= 1} className="rounded border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang trước</button>
                                            <span className="font-semibold text-slate-700">Trang {normalizedPokemonPage}/{pokemonTotalPages}</span>
                                            <button type="button" onClick={() => setPokemonPage((prev) => Math.min(pokemonTotalPages, prev + 1))} disabled={normalizedPokemonPage >= pokemonTotalPages} className="rounded border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang sau</button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                                        <div className="text-xs font-semibold text-slate-600">
                                            Tỷ lệ rơi vật phẩm tổng: <span className="text-emerald-700">{formatPercent((Number(map.itemDropRate) || 0) * 100)}</span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Tìm vật phẩm" className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700" />
                                            <select value={itemRarityFilter} onChange={(e) => setItemRarityFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="">Tất cả độ hiếm</option>
                                                {Object.keys(ITEM_RARITY_ORDER).map((rarityKey) => <option key={rarityKey} value={rarityKey}>{capitalizeWords(rarityKey)}</option>)}
                                            </select>
                                            <select value={itemTypeFilter} onChange={(e) => setItemTypeFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="">Tất cả loại</option>
                                                {Object.keys(ITEM_TYPE_LABELS).map((type) => <option key={type} value={type}>{ITEM_TYPE_LABELS[type]}</option>)}
                                            </select>
                                            <select value={itemSortKey} onChange={(e) => setItemSortKey(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="dropPercent">Tỷ lệ rơi</option>
                                                <option value="name">Tên</option>
                                                <option value="type">Loại</option>
                                                <option value="rarity">Độ hiếm</option>
                                            </select>
                                            <select value={itemSortDirection} onChange={(e) => setItemSortDirection(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                <option value="desc">Giảm dần</option>
                                                <option value="asc">Tăng dần</option>
                                            </select>
                                            <select value={itemPageSize} onChange={(e) => setItemPageSize(Number(e.target.value) || MAP_DETAIL_PAGE_SIZE_OPTIONS[0])} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                                                {MAP_DETAIL_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}/trang</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                                        <table className="w-full min-w-[720px] text-xs">
                                            <thead>
                                                <tr className="bg-emerald-50 text-emerald-900">
                                                    <th className="px-3 py-2 text-left font-bold">Vật phẩm</th>
                                                    <th className="px-3 py-2 text-center font-bold">Loại</th>
                                                    <th className="px-3 py-2 text-center font-bold">Độ hiếm</th>
                                                    <th className="px-3 py-2 text-right font-bold">Tỷ lệ rơi</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {paginatedItemDrops.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="px-3 py-8 text-center text-slate-500">Không tìm thấy vật phẩm phù hợp bộ lọc.</td>
                                                    </tr>
                                                ) : paginatedItemDrops.map((entry) => {
                                                    const item = entry?.itemId || {}
                                                    return (
                                                        <tr key={entry?._id || item?._id || item?.name} className="border-t border-slate-100 hover:bg-slate-50">
                                                            <td className="px-3 py-2">
                                                                <div className="flex items-center gap-3">
                                                                    <img src={item?.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'} alt={item?.name || 'Vật phẩm'} className="h-10 w-10 object-contain" />
                                                                    <div>
                                                                        <div className="font-bold text-slate-800">{item?.name || 'Vật phẩm'}</div>
                                                                        <div className="text-[11px] text-slate-500">{item?.description || 'Không có mô tả.'}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-center text-slate-700">{ITEM_TYPE_LABELS[item?.type] || item?.type || '-'}</td>
                                                            <td className="px-3 py-2 text-center font-bold uppercase text-emerald-700">{item?.rarity || '-'}</td>
                                                            <td className="px-3 py-2 text-right font-bold text-emerald-700">{formatPercent(entry?.dropPercent)}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
                                        <div className="text-slate-600">
                                            Hiển thị {itemDropEntries.length === 0 ? 0 : ((normalizedItemPage - 1) * itemPageSize) + 1}-{Math.min(itemDropEntries.length, normalizedItemPage * itemPageSize)} / {itemDropEntries.length} vật phẩm
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => setItemPage((prev) => Math.max(1, prev - 1))} disabled={normalizedItemPage <= 1} className="rounded border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang trước</button>
                                            <span className="font-semibold text-slate-700">Trang {normalizedItemPage}/{itemTotalPages}</span>
                                            <button type="button" onClick={() => setItemPage((prev) => Math.min(itemTotalPages, prev + 1))} disabled={normalizedItemPage >= itemTotalPages} className="rounded border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang sau</button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>}
                    </div>
                </div>

                {/* Stats Table */}
                <div className="border-t border-slate-300 overflow-x-auto">
                    <table className="w-full text-xs font-bold text-slate-800 min-w-[300px]">
                        <tbody>
                            <tr className="border-b border-slate-300">
                                <td className="w-1/3 bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Tỷ lệ gặp Pokemon:</td>
                                <td className="px-3 py-1 bg-white">{formatPercent((Number(map.encounterRate) || 0) * 100)}</td>
                            </tr>
                            <tr className="border-b border-slate-300">
                                <td className="w-1/3 bg-sky-100 px-3 py-1 text-right border-r border-slate-300">Tỷ lệ rơi vật phẩm:</td>
                                <td className="px-3 py-1 bg-white">{formatPercent((Number(map.itemDropRate) || 0) * 100)}</td>
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
                                <td className="px-3 py-1 text-slate-700">
                                    {lastEncounterSummary ? (
                                        <span>
                                            <span className="font-bold text-blue-800">{lastEncounterSummary.name}</span>
                                            {lastEncounterSummary.formName ? ` (${lastEncounterSummary.formName})` : ''}
                                            {Array.isArray(lastEncounterSummary.types) && lastEncounterSummary.types.length > 0 ? ` - ${lastEncounterSummary.types.map((type) => capitalizeWords(type)).join(', ')}` : ''}
                                            {' '}
                                            <span className="text-slate-500">Lv {lastEncounterSummary.level}</span>
                                            {' '}
                                            {lastEncounterSummary.rarity ? (
                                                <span className={`font-bold ${getRarityStyle(lastEncounterSummary.rarity).text}`}>
                                                    [{getRarityStyle(lastEncounterSummary.rarity).label}]
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : (
                                        <span className="text-slate-500">-</span>
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="p-4 flex flex-col items-center gap-4 bg-white">
                    <div className="relative shadow-xl rounded overflow-hidden border-2 border-slate-600 w-full max-w-[300px]">
                        <img
                            src={map.mapImageUrl || 'https://i.pinimg.com/originals/2d/e9/87/2de98740c0670868a83416b9b392bead.png'}
                            alt={`Bản đồ ${map.name}`}
                            className="w-full h-auto aspect-[5/3] object-cover pixelated bg-slate-200"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = 'https://i.pinimg.com/originals/2d/e9/87/2de98740c0670868a83416b9b392bead.png';
                            }}
                        />

                        {/* Encounter Overlay */}
                        <div className={`absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20 transition-opacity duration-150 ${encounter ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                            {encounter && (
                                <img
                                    src={encounter.pokemon.resolvedImageUrl
                                        || encounter.pokemon.form?.imageUrl
                                        || encounter.pokemon.form?.sprites?.normal
                                        || encounter.pokemon.imageUrl
                                        || encounter.pokemon.sprites?.front_default
                                        || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${encounter.pokemon.pokedexNumber}.png`}
                                    alt={encounter.pokemon.name}
                                    className="w-32 h-32 animate-bounce drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                                />
                            )}
                        </div>
                    </div>

                    <div className="w-full max-w-[300px] text-xs min-h-[56px]">
                        <div className={`transition-opacity ${encounter ? 'opacity-100' : 'opacity-0'}`}>
                            <div className="flex justify-between text-slate-700 font-bold mb-1">
                                <span>HP</span>
                                <span>{encounter ? `${encounter.hp}/${encounter.maxHp}` : '0/0'}</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
                                <div
                                    className="h-2 bg-green-500"
                                    style={{ width: `${enemyHpPercent}%` }}
                                />
                            </div>
                        </div>

                        <div className={`mt-3 transition-opacity ${playerBattle ? 'opacity-100' : 'opacity-0'}`}>
                            <div className="flex justify-between text-blue-800 font-bold mb-1">
                                <span>{playerBattle?.name || 'Pokemon của bạn'}</span>
                                <span>{playerBattle ? `${playerBattle.currentHp}/${playerBattle.maxHp}` : '0/0'}</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
                                <div
                                    className="h-2 bg-blue-500"
                                    style={{ width: `${playerHpPercent}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Search Button */}
                    <button
                        onClick={handleSearch}
                        disabled={Boolean(encounter) || isLocked} 
                        className="px-8 py-3 bg-white border border-slate-400 hover:bg-slate-50 text-black font-bold text-base shadow-[0_2px_0_#94a3b8] active:translate-y-[2px] active:shadow-none transition-all rounded touch-manipulation"
                        style={{ transform: `translate(${searchButtonOffset.x}px, ${searchButtonOffset.y}px)` }}
                    >
                        Tìm kiếm{searching ? '...' : ''}
                    </button>

                    {canUseVipAutoSearch && (
                        <div className="w-full max-w-[420px] border border-slate-300 rounded bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="font-bold text-slate-800">Tự tìm kiếm</div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsAutoSearchConfigExpanded((prev) => !prev)}
                                        className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold"
                                    >
                                        {isAutoSearchConfigExpanded ? 'Thu gọn' : 'Mở rộng'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                if (autoSearchEnabled) {
                                                    const res = await gameApi.updateAutoSearchSettings({
                                                        enabled: false,
                                                        mapSlug: slug,
                                                        searchIntervalMs: Math.max(900, Number(autoSearchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS),
                                                        actionByRarity: autoActionByRarity,
                                                        catchFormMode: autoCatchFormMode,
                                                        catchBallItemId: String(autoCatchBallId || '').trim(),
                                                    })
                                                    applyAutoSearchStatus(res?.autoSearch || {}, { forceConfig: true })
                                                    setActionMessage('Đã tắt tự tìm kiếm.')
                                                    return
                                                }

                                                if (!canUseVipAutoSearch) {
                                                    setActionMessage('Chỉ tài khoản VIP mới có thể bật tự tìm kiếm.')
                                                    return
                                                }

                                                if (isCurrentMapEvent) {
                                                    setLastResult({ encountered: false, message: 'Bản đồ sự kiện không hỗ trợ tự tìm kiếm.' })
                                                    return
                                                }

                                                if (remainingAutoSearchVipLevels > 0) {
                                                    setLastResult({ encountered: false, message: `Map này yêu cầu VIP ${autoSearchRequiredVipLevel} để bật tự tìm kiếm.` })
                                                    return
                                                }

                                                if (isLocked) {
                                                    setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Không thể bật tự tìm kiếm.' })
                                                    return
                                                }

                                                if (encounter) {
                                                    setActionMessage('Đang có Pokemon hoang dã. Hãy xử lý trận hiện tại trước khi bật tự tìm kiếm.')
                                                    return
                                                }

                                                if (hasCatchActionConfigured && !resolvedAutoCatchBallEntry?.item?._id && !autoCatchBallId) {
                                                    setActionMessage('Có thiết lập tự bắt nhưng không có bóng. Vui lòng chuẩn bị bóng trước khi bật tự tìm kiếm.')
                                                    return
                                                }

                                                const res = await gameApi.updateAutoSearchSettings({
                                                    enabled: true,
                                                    mapSlug: slug,
                                                    searchIntervalMs: Math.max(900, Number(autoSearchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS),
                                                    actionByRarity: autoActionByRarity,
                                                    catchFormMode: autoCatchFormMode,
                                                    catchBallItemId: String(autoCatchBallId || '').trim(),
                                                })
                                                applyAutoSearchStatus(res?.autoSearch || {}, { forceConfig: true })

                                                const remaining = Number(res?.autoSearch?.daily?.remaining)
                                                if (Number.isFinite(remaining)) {
                                                    setActionMessage(`Đã bật tự tìm kiếm. Còn ${remaining} lượt trong hôm nay.`)
                                                } else {
                                                    setActionMessage('Đã bật tự tìm kiếm. Hệ thống sẽ chạy ngầm trên máy chủ.')
                                                }
                                            } catch (error) {
                                                setActionMessage(String(error?.message || 'Không thể cập nhật tự tìm kiếm.'))
                                            }
                                        }}
                                        disabled={isLocked || !canUseCurrentMapAutoSearch}
                                    className={`px-3 py-1.5 rounded font-bold border transition-colors ${autoSearchEnabled
                                        ? 'bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'} disabled:opacity-50`}
                                    >
                                        {autoSearchEnabled ? 'Đang chạy' : 'Bật auto'}
                                    </button>
                                </div>
                            </div>

                            {isAutoSearchConfigExpanded && (
                                <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-semibold text-slate-700">Tốc độ tìm kiếm</span>
                                    <select
                                        value={autoSearchIntervalMs}
                                        onChange={(e) => {
                                            const nextValue = Number.parseInt(e.target.value, 10)
                                            markAutoSearchConfigDirty()
                                            setAutoSearchIntervalMs(Number.isFinite(nextValue) ? nextValue : DEFAULT_AUTO_SEARCH_INTERVAL_MS)
                                        }}
                                        disabled={!canUseCurrentMapAutoSearch}
                                        className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                                    >
                                        {AUTO_SEARCH_INTERVAL_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-semibold text-slate-700">Dạng sẽ bắt</span>
                                    <select
                                        value={autoCatchFormMode}
                                        onChange={(e) => {
                                            markAutoSearchConfigDirty()
                                            setAutoCatchFormMode(String(e.target.value || 'all'))
                                        }}
                                        disabled={!canUseCurrentMapAutoSearch}
                                        className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                                    >
                                        {AUTO_CATCH_FORM_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                    </div>

                                    <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-slate-700">Bóng dùng để bắt</span>
                                <select
                                    value={autoCatchBallId}
                                    onChange={(e) => {
                                        markAutoSearchConfigDirty()
                                        setAutoCatchBallId(String(e.target.value || ''))
                                    }}
                                    disabled={!canUseCurrentMapAutoSearch}
                                    className="px-2 py-1 border border-slate-300 rounded bg-white text-xs min-w-[200px]"
                                >
                                    {availablePokeballs.length === 0 && <option value="">Hết bóng</option>}
                                    {availablePokeballs.map((entry) => (
                                        <option key={entry.item._id} value={entry.item._id}>
                                            {entry.item.name} (x{entry.quantity})
                                        </option>
                                    ))}
                                </select>
                                    </div>

                                    <div className="rounded border border-slate-200 bg-white p-2">
                                <div className="text-[11px] font-semibold text-slate-700 mb-2">Tùy chọn hành động theo độ hiếm Pokemon</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {AUTO_SEARCH_RARITY_KEYS.map((rarityKey) => {
                                        const rarityMeta = getRarityStyle(rarityKey)
                                        const currentAction = String(autoActionByRarity?.[rarityKey] || 'battle')
                                        return (
                                            <div key={rarityKey} className="flex items-center justify-between gap-2 border border-slate-100 rounded p-1.5">
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${rarityMeta.badge}`}>
                                                    {rarityMeta.label}
                                                </span>
                                                <select
                                                    value={currentAction}
                                                    onChange={(e) => {
                                                        const nextAction = String(e.target.value || 'battle')
                                                        markAutoSearchConfigDirty()
                                                        setAutoActionByRarity((prev) => ({
                                                            ...prev,
                                                            [rarityKey]: nextAction,
                                                        }))
                                                    }}
                                                    disabled={!canUseCurrentMapAutoSearch}
                                                    className="px-2 py-1 border border-slate-300 rounded bg-white text-[11px]"
                                                >
                                                    {AUTO_SEARCH_ACTION_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )
                                    })}
                                </div>
                                    </div>
                                </>
                            )}

                            {isAutoSearchConfigExpanded && (
                                <>
                                    <div className="text-[10px] text-slate-500">
                                        {canUseVipAutoSearch && (
                                            <div>
                                                Giới hạn tự tìm: {(autoSearchRuntimeLimitMinutes > 0 ? `${autoSearchRuntimeLimitMinutes} phút/ngày` : (autoSearchDurationLimitMinutes > 0 ? `${autoSearchDurationLimitMinutes} phút/ngày` : 'không giới hạn'))}
                                                {' · '}
                                                Lượt chạy hôm nay: {autoSearchUsageToday}/{autoSearchUsesPerDayLimit > 0 ? autoSearchUsesPerDayLimit : '∞'}
                                                {' · '}
                                                Đã dùng: {autoSearchRuntimeTodayMinutes} phút
                                            </div>
                                        )}
                                        {isCurrentMapEvent
                                            ? 'Bản đồ này là sự kiện nên tự tìm bị khóa.'
                                            : (!canUseVipAutoSearch
                                                ? 'Tự tìm kiếm là quyền lợi dành cho tài khoản VIP.'
                                                : (remainingAutoSearchVipLevels > 0
                                                    ? `Map này yêu cầu VIP ${autoSearchRequiredVipLevel} để bật tự tìm kiếm. Bạn còn thiếu ${remainingAutoSearchVipLevels} cấp VIP.`
                                                : (autoSearchEnabled
                                                    ? `Đang tự tìm: mỗi ${Math.max(0.9, Number(autoSearchIntervalMs) / 1000).toFixed(1)} giây. Hết bóng sẽ tự dừng.`
                                                    : 'Tự tìm đang tắt. Bạn vẫn có thể tìm thủ công.')))}
                                    </div>

                                    {autoSearchServerStatus && (
                                        <div className="text-[10px] font-semibold text-slate-600">
                                            Trạng thái tự chạy: {autoSearchServerStatus}
                                        </div>
                                    )}
                                    <div className="rounded border border-slate-200 bg-white p-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                                        <div className="text-slate-700">Tìm thấy: <span className="font-bold">{Number(autoSearchHistory.foundPokemonCount || 0).toLocaleString('vi-VN')}</span></div>
                                        <div className="text-slate-700">Bỏ qua: <span className="font-bold">{Number(autoSearchHistory.runCount || 0).toLocaleString('vi-VN')}</span></div>
                                        <div className="text-slate-700">Chiến đấu: <span className="font-bold">{Number(autoSearchHistory.battleCount || 0).toLocaleString('vi-VN')}</span></div>
                                        <div className="text-slate-700">Bắt được: <span className="font-bold">{Number(autoSearchHistory.catchSuccessCount || 0).toLocaleString('vi-VN')}</span></div>
                                        <div className="text-slate-700 col-span-2 sm:col-span-4">
                                            Nhặt đồ: <span className="font-bold">{Number(autoSearchHistory.itemDropCount || 0).toLocaleString('vi-VN')}</span> lượt,
                                            tổng <span className="font-bold">{Number(autoSearchHistory.itemDropQuantity || 0).toLocaleString('vi-VN')}</span> món
                                        </div>
                                    </div>

                                    {autoSearchServerLogs.length > 0 && (
                                        <div className="border border-slate-200 rounded bg-white p-2 space-y-1 max-h-24 overflow-y-auto">
                                            {autoSearchServerLogs.slice(0, 4).map((entry) => (
                                                <div key={entry._id || entry.id} className={`text-[10px] ${entry.type === 'success'
                                                    ? 'text-emerald-700'
                                                    : (entry.type === 'error' ? 'text-rose-700' : (entry.type === 'warn' ? 'text-amber-700' : 'text-slate-600'))}`}>
                                                    • {formatFriendlyAutoSearchMessage(entry.message)}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {isSearchDebugMode && (
                        <button
                            type="button"
                            onClick={nudgeSearchButton}
                            className="px-4 py-1.5 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
                        >
                            Debug: Di chuyển nút tìm kiếm
                        </button>
                    )}
                </div>

                {/* Footer / Results Log */}
                <div className="border-t-2 border-slate-200 p-2 text-center min-h-[40px] bg-slate-50">
                    {encounter ? (
                        <div className="text-green-700 font-bold">
                            Một <span className="uppercase">{encounter.pokemon.name}</span>
                            {Array.isArray(encounter?.pokemon?.types) && encounter.pokemon.types.length > 0 ? ` - ${encounter.pokemon.types.map((type) => capitalizeWords(type)).join(', ')}` : ''}
                            {' '}(Lvl {encounter.level}) <span className={`font-bold ${getRarityStyle(encounter.pokemon.rarity).text}`}>[{getRarityStyle(encounter.pokemon.rarity).label}]</span> hoang dã xuất hiện!
                            {encounter?.pokemon?.isNewPokedexEntry && (
                                <div className="mt-1 text-xs font-bold text-rose-600 uppercase tracking-wide">
                                    New - chưa có trong Pokedex
                                </div>
                            )}
                            <div className="mt-2 text-xs font-normal text-slate-600">
                                [ <button
                                    onClick={handleAttack}
                                    disabled={actionLoading || !playerBattle}
                                    className="text-blue-600 hover:underline font-bold disabled:opacity-50 px-2 py-1"
                                >Chiến đấu</button> ]
                                {' - '}
                                [ <button
                                    onClick={handleRun}
                                    disabled={actionLoading}
                                    className="text-slate-600 hover:underline font-bold disabled:opacity-50 px-2 py-1"
                                >Bỏ chạy</button> ]
                            </div>
                            {!playerBattle && (
                                <div className="mt-2 text-[11px] font-bold text-amber-600">
                                    Cần có Pokemon trong đội hình để chiến đấu.
                                </div>
                            )}
                            <div className="mt-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded px-2 py-1 text-center inline-block">
                                Lượt thử bắt: {catchAttemptInfo.attempts}/{catchAttemptInfo.maxAttempts}
                                {' · '}còn {Math.max(0, catchAttemptInfo.maxAttempts - catchAttemptInfo.attempts)} lần
                            </div>
                            <div className="mt-2 flex flex-col sm:flex-row items-center justify-center gap-2 text-xs w-full">
                                <select
                                    value={selectedBallId}
                                    onChange={(e) => setSelectedBallId(e.target.value)}
                                    className="px-3 py-2 border border-slate-300 rounded bg-white w-full sm:w-auto text-sm"
                                >
                                    <option value="">Chọn bóng để bắt</option>
                                    {inventory
                                        .filter((entry) => entry.item?.type === 'pokeball' && entry.quantity > 0)
                                        .map((entry) => {
                                            const optionBallId = extractObjectIdLike(entry?.item?._id || entry?.item?.id || entry?.item)
                                            if (!optionBallId) return null
                                            const baseChance = calcCatchChance({
                                                catchRate: encounter?.pokemon?.catchRate,
                                                hp: encounter?.hp,
                                                maxHp: encounter?.maxHp,
                                            })
                                            const mapRarityCatchBonusPercent = resolveMapRarityCatchBonusPercent(
                                                map,
                                                encounter?.pokemon?.rarity
                                            )
                                            const finalChance = getBallCatchChance({
                                                item: entry.item,
                                                baseChance,
                                                hp: encounter?.hp,
                                                maxHp: encounter?.maxHp,
                                                rarity: encounter?.pokemon?.rarity,
                                                rarityCatchBonusPercent: mapRarityCatchBonusPercent,
                                            })
                                            const percent = Math.round(finalChance * 100)
                                            return (
                                                <option key={optionBallId} value={optionBallId}>
                                                    {entry.item.name} (x{entry.quantity}) - ~{percent}%
                                                </option>
                                            )
                                        })}
                                </select>
                                <button
                                    onClick={() => handleUseBall()}
                                    disabled={actionLoading || !selectedBallId}
                                    className="px-4 py-2 bg-emerald-600 text-white rounded font-bold disabled:opacity-50 w-full sm:w-auto"
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
                            +1 EXP Bản Đồ
                            {lastResult.itemDrop && (
                                <span className="ml-2 text-emerald-600">Nhặt được {lastResult.itemDrop.name}</span>
                            )}
                        </div>
                    )}
                </div>

            </div>

            {searchChallenge && (
                <Modal
                    isOpen
                    onClose={() => {}}
                    title="Xác minh thao tác"
                    maxWidth="sm"
                    showCloseButton={false}
                >
                    <div className="space-y-4" key={searchChallenge.id}>
                        <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 text-center">
                            <div className="text-[11px] font-black uppercase tracking-wide text-blue-700">Kiểm tra anti auto click</div>
                            <div className="mt-2 text-sm font-bold text-slate-800">{searchChallenge.prompt}</div>
                            <div className="mt-1 text-xs text-slate-600">Nhập đáp án đúng để tiếp tục tìm kiếm.</div>
                        </div>

                        <form
                            className="space-y-2"
                            onSubmit={(event) => {
                                event.preventDefault()
                                handleSearchChallengeAnswer()
                            }}
                        >
                            <input
                                type="text"
                                inputMode="numeric"
                                value={searchChallengeInput}
                                onChange={(event) => setSearchChallengeInput(event.target.value)}
                                className="w-full rounded border-2 border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-blue-400"
                                placeholder="Nhập kết quả"
                                autoFocus
                            />
                            <button
                                type="submit"
                                className="w-full rounded border-2 border-blue-400 bg-blue-500 py-2 text-sm font-bold text-white hover:bg-blue-600"
                            >
                                Xác nhận
                            </button>
                        </form>

                        {searchChallengeError && (
                            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-center text-xs font-bold text-rose-700">
                                {searchChallengeError}
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    )
}
