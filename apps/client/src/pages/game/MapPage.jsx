import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { mapApi } from '../../services/mapApi'
import { gameApi } from '../../services/gameApi'
import { getRarityStyle } from '../../utils/rarityStyles'
import FeatureUnavailableNotice from '../../components/FeatureUnavailableNotice'
import { hasVipAutoSearchAccess } from '../../utils/vip'
import { consumeVipAutoUse, getVipAutoLimitConfig, getVipAutoUsageToday } from '../../utils/vipAutoLimits'

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
const LAST_ENCOUNTER_STORAGE_PREFIX = 'map:lastEncounter:'
const SEARCH_SPAM_REPOSITION_THRESHOLD = 10
const SEARCH_BUTTON_REPOSITION_INTERVAL_MS = 10 * 60 * 1000
const LOCAL_SEARCH_SPAM_COOLDOWN_MS = 650
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

const normalizeRarityToken = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    return AUTO_SEARCH_RARITY_KEYS.includes(normalized) ? normalized : 'd'
}

const resolveEncounterFormId = (encounterLike = null) => {
    return normalizeFormId(encounterLike?.pokemon?.formId || encounterLike?.pokemon?.form?.formId || 'normal')
}

const isFormAllowedForCatch = (formId = 'normal', mode = 'all') => {
    const normalizedFormId = normalizeFormId(formId)
    const normalizedMode = String(mode || 'all').trim().toLowerCase()
    if (normalizedMode === 'all') return true
    if (normalizedMode === 'normal') return normalizedFormId === 'normal'
    if (normalizedMode === 'variant') return normalizedFormId !== 'normal'
    return true
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
    const [autoSearchStartedAtMs, setAutoSearchStartedAtMs] = useState(0)
    const [autoSearchIntervalMs, setAutoSearchIntervalMs] = useState(DEFAULT_AUTO_SEARCH_INTERVAL_MS)
    const [autoActionByRarity, setAutoActionByRarity] = useState(DEFAULT_AUTO_ACTION_BY_RARITY)
    const [autoCatchFormMode, setAutoCatchFormMode] = useState('all')
    const [autoCatchBallId, setAutoCatchBallId] = useState('')
    const [searchButtonOffset, setSearchButtonOffset] = useState({ x: 0, y: 0 })
    const [lastEncounterSummary, setLastEncounterSummary] = useState(null)
    const searchScrollYRef = useRef(0)
    const shouldRestoreSearchScrollRef = useRef(false)
    const searchSpamCountRef = useRef(0)
    const lastSearchRequestAtRef = useRef(0)
    const searchButtonRepositionTimerRef = useRef(null)
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
    const normalizedAuthUserId = String(user?.id || user?._id || '').trim()
    const autoSearchLimitConfig = getVipAutoLimitConfig(user, 'map-search')
    const autoSearchDurationLimitMinutes = autoSearchLimitConfig.durationMinutes
    const autoSearchUsesPerDayLimit = autoSearchLimitConfig.usesPerDay
    const autoSearchUsageToday = getVipAutoUsageToday(normalizedAuthUserId, 'map-search').used
    const availablePokeballs = (Array.isArray(inventory) ? inventory : [])
        .filter((entry) => entry?.item?.type === 'pokeball' && Number(entry?.quantity) > 0)
    const resolvedAutoCatchBallEntry = availablePokeballs.find((entry) => String(entry?.item?._id || '') === String(autoCatchBallId || ''))
        || availablePokeballs[0]
        || null
    const hasCatchActionConfigured = AUTO_SEARCH_RARITY_KEYS.some((rarityKey) => {
        return String(autoActionByRarity?.[rarityKey] || '').trim().toLowerCase() === 'catch'
    })

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
        setAutoSearchEnabled(false)
        searchSpamCountRef.current = 0
        setSearchButtonOffset({ x: 0, y: 0 })
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

    const scheduleSearchButtonReposition = () => {
        if (typeof window === 'undefined') return

        if (searchButtonRepositionTimerRef.current) {
            window.clearTimeout(searchButtonRepositionTimerRef.current)
        }

        searchButtonRepositionTimerRef.current = window.setTimeout(() => {
            nudgeSearchButton()
        }, SEARCH_BUTTON_REPOSITION_INTERVAL_MS)
    }

    const nudgeSearchButton = () => {
        if (typeof window === 'undefined') return

        const viewportWidth = Number(window.innerWidth || 1024)
        const minX = viewportWidth < 640 ? 26 : 90
        const maxX = viewportWidth < 640 ? 50 : 150
        const minY = viewportWidth < 640 ? 12 : 28
        const maxY = viewportWidth < 640 ? 30 : 70
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
        const nextSpamCount = searchSpamCountRef.current + 1
        searchSpamCountRef.current = nextSpamCount

        const isButtonCurrentlyShifted = searchButtonOffset.x !== 0 || searchButtonOffset.y !== 0
        if (!isButtonCurrentlyShifted && (nextSpamCount % SEARCH_SPAM_REPOSITION_THRESHOLD === 0)) {
            nudgeSearchButton()
        }

        if (retryAfterMs > 0) {
            const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000))
            setLastResult({ encountered: false, message: `Chú ý: Tìm kiếm quá nhanh. Vui lòng đợi ${retryAfterSec}s.` })
            return
        }

        setLastResult({ encountered: false, message: 'Chú ý: Tìm kiếm quá nhanh. Vui lòng đợi một chút.' })
    }

    const handleSearch = async () => {
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
                resetSearchButtonOffset()
                return
            }

            setIsLocked(false)
            searchSpamCountRef.current = 0
            resetSearchButtonOffset()

            setLastResult(res)
            if (res.encountered) {
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
                setLastResult({ encountered: false, message: 'Chú ý: ' + err.message })
            }
        } finally {
            setSearching(false)
        }
    }

    const resolveAutoActionForEncounter = (encounterLike = null) => {
        const rarity = normalizeRarityToken(encounterLike?.pokemon?.rarity)
        const configuredAction = String(autoActionByRarity?.[rarity] || 'battle').trim().toLowerCase()
        const encounterFormId = resolveEncounterFormId(encounterLike)
        const catchAllowedByForm = isFormAllowedForCatch(encounterFormId, autoCatchFormMode)

        if (configuredAction === 'catch' && !catchAllowedByForm) {
            return 'battle'
        }
        if (configuredAction === 'run') return 'run'
        if (configuredAction === 'catch') return 'catch'
        return 'battle'
    }

    useEffect(() => {
        if (!autoSearchEnabled || !isCurrentMapEvent) return
        setAutoSearchEnabled(false)
        setLastResult({
            encountered: false,
            message: 'Auto tìm kiếm không áp dụng cho bản đồ event.',
        })
    }, [autoSearchEnabled, isCurrentMapEvent])

    useEffect(() => {
        if (!autoSearchEnabled || canUseVipAutoSearch) return
        setAutoSearchEnabled(false)
        setActionMessage('Tài khoản hiện không có quyền lợi VIP để dùng auto tìm kiếm.')
    }, [autoSearchEnabled, canUseVipAutoSearch])

    useEffect(() => {
        if (!autoSearchEnabled) {
            if (autoSearchStartedAtMs !== 0) {
                setAutoSearchStartedAtMs(0)
            }
            return
        }

        if (!autoSearchStartedAtMs) {
            setAutoSearchStartedAtMs(Date.now())
        }
    }, [autoSearchEnabled, autoSearchStartedAtMs])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        if (!autoSearchEnabled) return undefined
        if (autoSearchDurationLimitMinutes <= 0) return undefined

        const startedAt = autoSearchStartedAtMs || Date.now()
        const limitMs = autoSearchDurationLimitMinutes * 60 * 1000
        const elapsedMs = Date.now() - startedAt
        const remainingMs = limitMs - elapsedMs

        if (remainingMs <= 0) {
            setAutoSearchEnabled(false)
            setActionMessage('Đã hết thời gian dùng auto tìm kiếm theo gói VIP.')
            return undefined
        }

        const timer = window.setTimeout(() => {
            setAutoSearchEnabled(false)
            setActionMessage('Đã hết thời gian dùng auto tìm kiếm theo gói VIP.')
        }, remainingMs)

        return () => {
            window.clearTimeout(timer)
        }
    }, [autoSearchEnabled, autoSearchStartedAtMs, autoSearchDurationLimitMinutes])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        if (!canUseVipAutoSearch || !autoSearchEnabled || isCurrentMapEvent || isLocked || searching || encounter || actionLoading) return undefined

        const normalizedDelay = Math.max(900, Number(autoSearchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS)
        const timer = window.setTimeout(() => {
            handleSearch()
        }, normalizedDelay)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        autoSearchEnabled,
        canUseVipAutoSearch,
        autoSearchIntervalMs,
        isCurrentMapEvent,
        isLocked,
        searching,
        encounter,
        actionLoading,
        slug,
        handleSearch,
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
        const resolvedBallId = String(forcedBallId || selectedBallId || '').trim()
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

    const getBallCatchChance = (item, baseChance) => {
        if (item?.effectType === 'catchMultiplier' && Number.isFinite(Number(item.effectValue))) {
            return Math.min(1, Math.max(0, Number(item.effectValue) / 100))
        }
        const safeBaseChance = Number.isFinite(Number(baseChance)) ? Number(baseChance) : 0.02
        return Math.min(0.99, Math.max(0.02, safeBaseChance))
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

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        if (!canUseVipAutoSearch || !autoSearchEnabled || isCurrentMapEvent || isLocked || searching || actionLoading || !encounter) return undefined

        const resolvedAction = resolveAutoActionForEncounter(encounter)
        const actionDelay = Math.max(320, Math.floor((Number(autoSearchIntervalMs) || DEFAULT_AUTO_SEARCH_INTERVAL_MS) * 0.5))

        const timer = window.setTimeout(() => {
            if (resolvedAction === 'catch') {
                if (!resolvedAutoCatchBallEntry?.item?._id) {
                    setAutoSearchEnabled(false)
                    setActionMessage('Đã hết bóng để auto bắt. Auto tìm kiếm tự dừng.')
                    return
                }

                const ballId = String(resolvedAutoCatchBallEntry.item._id)
                setSelectedBallId(ballId)
                handleUseBall(ballId)
                return
            }

            if (resolvedAction === 'run') {
                handleRun()
                return
            }

            if (!playerBattle) {
                setAutoSearchEnabled(false)
                setActionMessage('Không có Pokemon trong đội để auto chiến đấu. Auto tìm kiếm tự dừng.')
                return
            }

            handleAttack()
        }, actionDelay)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        autoSearchEnabled,
        canUseVipAutoSearch,
        isCurrentMapEvent,
        isLocked,
        searching,
        actionLoading,
        encounter,
        autoSearchIntervalMs,
        autoActionByRarity,
        autoCatchFormMode,
        resolvedAutoCatchBallEntry,
        playerBattle,
        handleUseBall,
        handleRun,
        handleAttack,
    ])


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

                {/* Map Visualization & Search Button */}
                <div className="p-4 flex flex-col items-center gap-4 bg-white">
                    {/* Map Image container with shadow */}
                    {/* Map Image container with shadow */}
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
                        disabled={Boolean(encounter) || isLocked} // Keep clickable while searching to detect UI spam attempts
                        className="px-8 py-3 bg-white border border-slate-400 hover:bg-slate-50 text-black font-bold text-base shadow-[0_2px_0_#94a3b8] active:translate-y-[2px] active:shadow-none transition-all rounded touch-manipulation"
                        style={{ transform: `translate(${searchButtonOffset.x}px, ${searchButtonOffset.y}px)` }}
                    >
                        Tìm kiếm{searching ? '...' : ''}
                    </button>

                    <div className="w-full max-w-[420px] border border-slate-300 rounded bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <div className="font-bold text-slate-800">Auto tìm kiếm nâng cao</div>
                                <div className="text-[10px] text-slate-500">Theo rarity/form: bắt bằng bóng, chiến đấu hoặc bỏ qua.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    if (autoSearchEnabled) {
                                        setAutoSearchEnabled(false)
                                        setActionMessage('Đã tắt auto tìm kiếm.')
                                        return
                                    }

                                    if (!canUseVipAutoSearch) {
                                        setActionMessage('Chỉ tài khoản VIP mới có thể bật auto tìm kiếm.')
                                        return
                                    }

                                    if (isCurrentMapEvent) {
                                        setLastResult({ encountered: false, message: 'Map event không hỗ trợ auto tìm kiếm.' })
                                        return
                                    }

                                    if (isLocked) {
                                        setLastResult({ encountered: false, message: 'Bản đồ đang bị khóa. Không thể bật auto.' })
                                        return
                                    }

                                    if (encounter) {
                                        setActionMessage('Đang có Pokemon hoang dã. Hãy xử lý trận hiện tại trước khi bật auto.')
                                        return
                                    }

                                    if (hasCatchActionConfigured && !resolvedAutoCatchBallEntry?.item?._id) {
                                        setActionMessage('Có cấu hình auto bắt nhưng không có bóng. Vui lòng chuẩn bị bóng trước khi bật auto.')
                                        return
                                    }

                                    const consumeResult = consumeVipAutoUse(
                                        normalizedAuthUserId,
                                        'map-search',
                                        autoSearchUsesPerDayLimit
                                    )
                                    if (!consumeResult.ok) {
                                        setActionMessage(`Đã hết lượt dùng auto tìm kiếm trong hôm nay (${consumeResult.used}/${consumeResult.limit}).`)
                                        return
                                    }

                                    setAutoSearchEnabled(true)
                                    setAutoSearchStartedAtMs(Date.now())
                                    if (Number.isFinite(consumeResult.remaining)) {
                                        setActionMessage(`Đã bật auto tìm kiếm. Còn ${consumeResult.remaining} lượt trong hôm nay.`)
                                    } else {
                                        setActionMessage('Đã bật auto tìm kiếm.')
                                    }
                                }}
                                disabled={isLocked || !canUseVipAutoSearch}
                                className={`px-3 py-1.5 rounded font-bold border transition-colors ${autoSearchEnabled
                                    ? 'bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700'
                                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'} disabled:opacity-50`}
                            >
                                {autoSearchEnabled ? 'Đang bật' : 'Bật auto'}
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-slate-700">Tốc độ tìm</span>
                                <select
                                    value={autoSearchIntervalMs}
                                    onChange={(e) => {
                                        const nextValue = Number.parseInt(e.target.value, 10)
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
                                <span className="text-[11px] font-semibold text-slate-700">Form auto bắt</span>
                                <select
                                    value={autoCatchFormMode}
                                    onChange={(e) => setAutoCatchFormMode(String(e.target.value || 'all'))}
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
                            <span className="text-[11px] font-semibold text-slate-700">Bóng dùng auto bắt</span>
                            <select
                                value={autoCatchBallId}
                                onChange={(e) => setAutoCatchBallId(String(e.target.value || ''))}
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
                            <div className="text-[11px] font-semibold text-slate-700 mb-2">Hành động theo rarity</div>
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

                        <div className="text-[10px] text-slate-500">
                            {canUseVipAutoSearch && (
                                <div>
                                    Giới hạn auto tìm: {autoSearchDurationLimitMinutes > 0 ? `${autoSearchDurationLimitMinutes} phút/lượt` : 'không giới hạn'}
                                    {' · '}
                                    Lượt hôm nay: {autoSearchUsageToday}/{autoSearchUsesPerDayLimit > 0 ? autoSearchUsesPerDayLimit : '∞'}
                                </div>
                            )}
                            {isCurrentMapEvent
                                ? 'Map này đang được đánh dấu event nên auto bị khóa.'
                                : (!canUseVipAutoSearch
                                    ? 'Auto tìm kiếm là quyền lợi dành cho tài khoản VIP.'
                                    : (autoSearchEnabled
                                    ? `Đang auto: tìm mỗi ${Math.max(0.9, Number(autoSearchIntervalMs) / 1000).toFixed(1)} giây. Hết bóng sẽ tự dừng nếu gặp rule auto bắt.`
                                    : 'Auto đang tắt. Bạn vẫn có thể tìm thủ công.'))}
                        </div>
                    </div>

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
                                            const baseChance = calcCatchChance({
                                                catchRate: encounter?.pokemon?.catchRate,
                                                hp: encounter?.hp,
                                                maxHp: encounter?.maxHp,
                                            })
                                            const finalChance = getBallCatchChance(entry.item, baseChance)
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
        </div>
    )
}





