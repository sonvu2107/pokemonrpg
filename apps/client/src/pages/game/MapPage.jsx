import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { mapApi } from '../../services/mapApi'
import { gameApi } from '../../services/gameApi'
import { getRarityStyle } from '../../utils/rarityStyles'
import Modal from '../../components/Modal'
import FeatureUnavailableNotice from '../../components/FeatureUnavailableNotice'
import { hasVipAutoSearchAccess } from '../../utils/vip'
import { getVipAutoLimitConfig } from '../../utils/vipAutoLimits'

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
const SEARCH_BUTTON_REPOSITION_INTERVAL_MS = 10 * 60 * 1000
const SEARCH_ANTI_SPAM_UI_COOLDOWN_MS = 10 * 60 * 1000
const LOCAL_SEARCH_SPAM_COOLDOWN_MS = 300
const SEARCH_MOBILE_CHALLENGE_THRESHOLD = 8
const SEARCH_VERY_FAST_SPAM_INTERVAL_MS = 180
const SEARCH_VERY_FAST_SPAM_STREAK_THRESHOLD = 3
const SEARCH_VERY_FAST_SPAM_REPOSITION_THRESHOLD = 4
const shuffleList = (list = []) => {
    const copied = Array.isArray(list) ? [...list] : []
    for (let index = copied.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        const tmp = copied[index]
        copied[index] = copied[swapIndex]
        copied[swapIndex] = tmp
    }
    return copied
}

const isMobileClient = () => {
    if (typeof window === 'undefined') return false
    return Number(window.innerWidth || 1024) <= 768
}

const createSearchChallenge = () => {
    const left = 5 + Math.floor(Math.random() * 20)
    const right = 3 + Math.floor(Math.random() * 15)
    const useAddition = Math.random() < 0.5
    const answer = useAddition ? (left + right) : Math.max(1, left - right)
    const prompt = useAddition
        ? `Mật mã Pokeball: ${left} + ${right} = ?`
        : `Mật mã Pokeball: ${left} - ${right} = ?`
    const wrongCandidates = [
        answer + 1,
        answer + 2,
        Math.max(0, answer - 1),
        Math.max(0, answer - 2),
        answer + 4,
    ].filter((value) => value !== answer)
    const uniqueWrongs = [...new Set(wrongCandidates)].slice(0, 3)
    const options = shuffleList([answer, ...uniqueWrongs])

    return {
        id: Date.now(),
        prompt,
        answer,
        options,
    }
}
const AUTO_SEARCH_INTERVAL_OPTIONS = [
    { value: 900, label: 'Nhanh (0.9s)' },
    { value: 1200, label: 'Vừa (1.2s)' },
    { value: 1800, label: 'Chậm (1.8s)' },
    { value: 2500, label: 'Rất chậm (2.5s)' },
]
const DEFAULT_AUTO_SEARCH_INTERVAL_MS = AUTO_SEARCH_INTERVAL_OPTIONS[1].value
const EVENT_MAP_PATTERN = /(^|[\s_-])(event|su-kien|sukien)($|[\s_-])/i
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
    d: 24,
    c: 22,
    b: 20,
    a: 18,
    s: 14,
    ss: 10,
    sss: 7,
})
const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 16

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
    if (Boolean(mapLike.isEventMap)) return true

    const slug = String(mapLike.slug || '').trim().toLowerCase()
    const name = String(mapLike.name || '').trim().toLowerCase()
    return EVENT_MAP_PATTERN.test(slug) || EVENT_MAP_PATTERN.test(name)
}

export default function MapPage() {
    const { slug } = useParams()
    const { user } = useAuth()
    const isSearchDebugMode = isSearchDebugModeEnabled()
    const [map, setMap] = useState(null)
    const [dropRates, setDropRates] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [unlockInfo, setUnlockInfo] = useState(null)
    const [isLocked, setIsLocked] = useState(false)
    const [featureNotice, setFeatureNotice] = useState('')
    const [searching, setSearching] = useState(false)
    const [lastResult, setLastResult] = useState(null)
    const [encounter, setEncounter] = useState(null)
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
    const [searchButtonOffset, setSearchButtonOffset] = useState({ x: 0, y: 0 })
    const [searchChallenge, setSearchChallenge] = useState(null)
    const [searchChallengeError, setSearchChallengeError] = useState('')
    const [lastEncounterSummary, setLastEncounterSummary] = useState(null)
    const searchScrollYRef = useRef(0)
    const shouldRestoreSearchScrollRef = useRef(false)
    const searchSpamCountRef = useRef(0)
    const lastSearchRequestAtRef = useRef(0)
    const searchButtonRepositionTimerRef = useRef(null)
    const autoSearchConfigDirtyRef = useRef(false)
    const lastAutoSearchServerSnapshotRef = useRef('')
    const lastSearchChallengeAtRef = useRef(0)
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
    const isCurrentMapEvent = isEventMapLike(map)
    const canUseVipAutoSearch = hasVipAutoSearchAccess(user)
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
    }, [autoSearchLimitConfig.usesPerDay])

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
        setPlayerBattle(null)
        setActionMessage('')
        setFeatureNotice('')
        searchSpamCountRef.current = 0
        searchVeryFastSpamStreakRef.current = 0
        lastSearchSpamAttemptAtRef.current = 0
        setSearchButtonOffset({ x: 0, y: 0 })
        setSearchChallenge(null)
        setSearchChallengeError('')
    }, [slug])

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

    useEffect(() => () => {
        if (typeof window === 'undefined') return
        if (searchButtonRepositionTimerRef.current) {
            window.clearTimeout(searchButtonRepositionTimerRef.current)
            searchButtonRepositionTimerRef.current = null
        }
    }, [])

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
                setPlayerBattle(activeEncounter.playerBattle || null)
                setActionMessage('Đã khôi phục Pokemon hoang dã bạn đang gặp.')
                await loadInventory()
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

    const resetSearchButtonOffset = () => {
        if (typeof window !== 'undefined' && searchButtonRepositionTimerRef.current) {
            window.clearTimeout(searchButtonRepositionTimerRef.current)
            searchButtonRepositionTimerRef.current = null
        }
        setSearchButtonOffset({ x: 0, y: 0 })
    }

    const shouldUseSearchChallenge = () => {
        return !autoSearchEnabled && isMobileClient()
    }

    const openSearchChallenge = () => {
        lastSearchChallengeAtRef.current = Date.now()
        setSearchChallenge(createSearchChallenge())
        setSearchChallengeError('')
    }

    const handleSearchChallengeAnswer = (selectedValue) => {
        if (!searchChallenge) return

        const numericChoice = Number(selectedValue)
        const correctAnswer = Number(searchChallenge.answer)

        if (numericChoice === correctAnswer) {
            setSearchChallenge(null)
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
    }

    const scheduleSearchButtonReposition = () => {
        if (typeof window === 'undefined') return

        if (searchButtonRepositionTimerRef.current) {
            window.clearTimeout(searchButtonRepositionTimerRef.current)
        }

        searchButtonRepositionTimerRef.current = window.setTimeout(() => {
            searchButtonRepositionTimerRef.current = null
            setSearchButtonOffset({ x: 0, y: 0 })
        }, SEARCH_BUTTON_REPOSITION_INTERVAL_MS)
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
        scheduleSearchButtonReposition()
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

        if (shouldUseSearchChallenge()) {
            const shouldTriggerChallenge = nextSpamCount % SEARCH_MOBILE_CHALLENGE_THRESHOLD === 0
            const canTriggerChallenge = (nowMs - Number(lastSearchChallengeAtRef.current || 0)) >= SEARCH_ANTI_SPAM_UI_COOLDOWN_MS
            if (!searchChallenge && shouldTriggerChallenge && canTriggerChallenge) {
                openSearchChallenge()
            }

            if (searchChallenge || (shouldTriggerChallenge && canTriggerChallenge)) {
                setLastResult({ encountered: false, message: 'Chú ý: Trả lời mật mã để tiếp tục tìm kiếm.' })
                return
            }
        }

        const isButtonCurrentlyShifted = searchButtonOffset.x !== 0 || searchButtonOffset.y !== 0
        const canRepositionButton = (nowMs - Number(lastSearchButtonRepositionAtRef.current || 0)) >= SEARCH_ANTI_SPAM_UI_COOLDOWN_MS
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

        if (searchButtonOffset.x !== 0 || searchButtonOffset.y !== 0) {
            resetSearchButtonOffset()
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
        const elapsedSinceLastRequest = nowMs - Number(lastSearchRequestAtRef.current || 0)
        if (lastSearchRequestAtRef.current > 0 && elapsedSinceLastRequest < LOCAL_SEARCH_SPAM_COOLDOWN_MS) {
            registerSearchSpamAttempt(LOCAL_SEARCH_SPAM_COOLDOWN_MS - elapsedSinceLastRequest)
            return
        }

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
                resetSearchButtonOffset()
                setSearchChallenge(null)
                setSearchChallengeError('')
                return
            }

            setIsLocked(false)
            searchSpamCountRef.current = 0
            searchVeryFastSpamStreakRef.current = 0
            lastSearchSpamAttemptAtRef.current = 0
            resetSearchButtonOffset()

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
        setAutoSearchHistory({
            ...DEFAULT_AUTO_SEARCH_HISTORY,
            ...(status?.history || {}),
        })

        const logs = Array.isArray(status?.logs) ? status.logs : []
        setAutoSearchServerLogs(logs)
        const mapName = String(status?.map?.name || '').trim()
        setAutoSearchServerStatus(
            (Boolean(status?.enabled)
                ? `Đang chạy ngầm${mapName ? ` tại ${mapName}` : ''}. ${String(logs[0]?.message || '').trim() || 'Đang tự tìm theo cấu hình.'}`
                : (String(logs[0]?.message || '').trim() || 'Tự tìm kiếm đang tắt.'))
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
        if (!user) return undefined
        let cancelled = false

        const syncAutoSearchStatus = async () => {
            try {
                const [statusRes, inventoryRes] = await Promise.all([
                    gameApi.getAutoSearchStatus(),
                    gameApi.getInventory().catch(() => null),
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
            } catch (error) {
                if (!cancelled) {
                    setAutoSearchServerStatus(String(error?.message || 'Không thể tải trạng thái tự tìm kiếm.'))
                }
            }
        }

        syncAutoSearchStatus()
        const timer = window.setInterval(syncAutoSearchStatus, autoSearchEnabled ? 2000 : 5000)

        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [user?.id, slug, autoSearchEnabled])

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
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : 'Bắt thất bại!'))
            if (res.caught) {
                setEncounter(null)
                setPlayerBattle(null)
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
            setActionMessage(res.message || (res.caught ? 'Bắt thành công!' : 'Bắt thất bại!'))
            await loadInventory()
            if (res.caught) {
                setEncounter(null)
                setPlayerBattle(null)
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

    const getBallCatchChance = ({ item, baseChance, hp, maxHp, rarity }) => {
        const hasFixedCatchRate = item?.effectType === 'catchMultiplier' && Number.isFinite(Number(item.effectValue))
        const safeBaseChance = Number.isFinite(Number(baseChance)) ? Number(baseChance) : 0.02
        const chanceBeforeLowHpBonus = hasFixedCatchRate
            ? Math.min(1, Math.max(0, Number(item.effectValue) / 100))
            : Math.min(0.99, Math.max(0.02, safeBaseChance))
        const lowHpCatchBonusPercent = calcLowHpCatchBonusPercent({ hp, maxHp, rarity })
        const minChance = hasFixedCatchRate ? 0 : 0.02
        return Math.min(0.99, Math.max(minChance, chanceBeforeLowHpBonus * (1 + (lowHpCatchBonusPercent / 100))))
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
                </div>

                {/* Stats Table */}
                <div className="border-t border-slate-300 overflow-x-auto">
                    <table className="w-full text-xs font-bold text-slate-800 min-w-[300px]">
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
                                        disabled={isLocked || !canUseVipAutoSearch}
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
                                        disabled={!canUseVipAutoSearch}
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
                                        disabled={!canUseVipAutoSearch}
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
                                    disabled={!canUseVipAutoSearch}
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
                                                    disabled={!canUseVipAutoSearch}
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
                                                Giới hạn tự tìm: {autoSearchDurationLimitMinutes > 0 ? `${autoSearchDurationLimitMinutes} phút/lượt` : 'không giới hạn'}
                                                {' · '}
                                                Lượt chạy hôm nay: {autoSearchUsageToday}/{autoSearchUsesPerDayLimit > 0 ? autoSearchUsesPerDayLimit : '∞'}
                                            </div>
                                        )}
                                        {isCurrentMapEvent
                                            ? 'Bản đồ này là sự kiện nên tự tìm bị khóa.'
                                            : (!canUseVipAutoSearch
                                                ? 'Tự tìm kiếm là quyền lợi dành cho tài khoản VIP.'
                                                : (autoSearchEnabled
                                                    ? `Đang tự tìm: mỗi ${Math.max(0.9, Number(autoSearchIntervalMs) / 1000).toFixed(1)} giây. Hết bóng sẽ tự dừng.`
                                                    : 'Tự tìm đang tắt. Bạn vẫn có thể tìm thủ công.'))}
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
                                                    • {entry.message}
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
                            Một <span className="uppercase">{encounter.pokemon.name}</span> (Lvl {encounter.level}) <span className={`font-bold ${getRarityStyle(encounter.pokemon.rarity).text}`}>[{getRarityStyle(encounter.pokemon.rarity).label}]</span> hoang dã xuất hiện!
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
                                            const finalChance = getBallCatchChance({
                                                item: entry.item,
                                                baseChance,
                                                hp: encounter?.hp,
                                                maxHp: encounter?.maxHp,
                                                rarity: encounter?.pokemon?.rarity,
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
                            <div className="mt-1 text-xs text-slate-600">Chọn đáp án đúng để tiếp tục tìm kiếm.</div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            {searchChallenge.options.map((option) => (
                                <button
                                    key={`${searchChallenge.id}-${option}`}
                                    type="button"
                                    onClick={() => handleSearchChallengeAnswer(option)}
                                    className="rounded border-2 border-slate-300 bg-white py-2 text-sm font-bold text-slate-800 hover:border-blue-400 hover:bg-blue-50"
                                >
                                    {option}
                                </button>
                            ))}
                        </div>

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
