import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import MapModel from '../models/Map.js'
import WorkerLock from '../models/WorkerLock.js'
import { getActiveEncounterDirect, runFromEncounterDirect, getInventoryDirect } from '../services/workerService.js'
import {
    getGameDayKey,
    hasVipAutoSearchAccess,
    isEventMapLike,
    isFormAllowedForCatch,
    normalizeAutoSearchState,
    normalizeFormId,
    normalizeId,
    normalizeRarityToken,
    normalizeSearchText,
    resolveDailyState,
    toSafeInt,
} from '../utils/autoTrainerUtils.js'
import { resolveEffectiveVipBenefits } from '../services/vipBenefitService.js'

const WORKER_LOCK_KEY_PREFIX = 'auto-search:tick-lock'
const OWNER_ID = `auto-search-worker:${process.pid}:${crypto.randomBytes(5).toString('hex')}`

const TICK_INTERVAL_MS = toSafeInt(process.env.AUTO_SEARCH_TICK_MS, 4000, 3000, 60000)
const LOCK_TTL_MS = toSafeInt(process.env.AUTO_SEARCH_LOCK_TTL_MS, 30000, 5000, 300000)
const BATCH_SIZE = toSafeInt(process.env.AUTO_SEARCH_BATCH_SIZE, 150, 10, 500)
const CONCURRENCY = toSafeInt(process.env.AUTO_SEARCH_CONCURRENCY, 15, 1, 50)
const TIME_BUDGET_MS = toSafeInt(process.env.AUTO_SEARCH_TIME_BUDGET_MS, 22000, 1000, 120000)
const POST_USER_COOLDOWN_MS = toSafeInt(process.env.AUTO_SEARCH_POST_USER_COOLDOWN_MS, 0, 0, 5000)
const MAP_META_CACHE_TTL_MS = toSafeInt(process.env.AUTO_SEARCH_MAP_CACHE_TTL_MS, 60000, 5000, 600000)
const AUTO_SEARCH_LOGS_LIMIT = 12

let intervalRef = null
let localBusy = false
let lastCursorId = ''
let apiBaseUrl = ''
const mapMetaCache = new Map()
const userNextActionAtMs = new Map()
const userLastBattleEncounterId = new Map()

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
})

const createInternalToken = (userId) => {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    if (!jwtSecret) {
        throw new Error('JWT_SECRET chưa được cấu hình')
    }
    return jwt.sign({ userId: String(userId), tokenType: 'internal' }, jwtSecret, { expiresIn: '30m' })
}

const buildUrl = (path) => {
    const base = String(apiBaseUrl || '').replace(/\/$/, '')
    const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`
    return `${base}${normalizedPath}`
}

const createBudgetError = (message = 'TIME_BUDGET') => {
    const error = new Error(message)
    error.code = 'TIME_BUDGET'
    return error
}

const callApi = async ({ token, path, method = 'GET', body = null, deadlineAt = null, timeoutMs = 6000 }) => {
    const hasDeadline = Number.isFinite(Number(deadlineAt))
    const remainingBudgetMs = hasDeadline ? (Number(deadlineAt) - Date.now()) : Infinity
    if (hasDeadline && remainingBudgetMs <= 150) {
        throw createBudgetError('TIME_BUDGET')
    }

    const rawTimeout = Math.max(300, Number(timeoutMs) || 6000)
    const effectiveTimeoutMs = hasDeadline
        ? Math.max(250, Math.min(rawTimeout, remainingBudgetMs))
        : rawTimeout

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
        controller.abort()
    }, effectiveTimeoutMs)

    let response
    try {
        response = await fetch(buildUrl(path), {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'x-internal-worker': 'auto-search',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        })
    } catch (error) {
        clearTimeout(timeoutId)
        if (error?.name === 'AbortError') {
            if (hasDeadline && Date.now() >= Number(deadlineAt)) {
                throw createBudgetError('TIME_BUDGET')
            }
            const timeoutError = new Error(`Request timeout for ${path}`)
            timeoutError.code = 'REQUEST_TIMEOUT'
            throw timeoutError
        }
        throw error
    }
    clearTimeout(timeoutId)

    let data = null
    try {
        data = await response.json()
    } catch {
        data = null
    }

    if (!response.ok) {
        const error = new Error(String(data?.message || `API ${path} thất bại`).trim())
        error.status = response.status
        error.code = String(data?.code || '').trim()
        error.payload = data
        throw error
    }

    return data
}

const RETRYABLE_CODES = new Set(['REQUEST_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'])

const callApiWithRetry = async (opts, maxRetries = 2) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await callApi(opts)
        } catch (error) {
            const code = String(error?.code || '').trim().toUpperCase()
            const isRetryable = RETRYABLE_CODES.has(code)
                || (code === '' && String(error?.message || '').includes('fetch failed'))
            if (attempt < maxRetries && isRetryable) {
                await sleep(250 * (attempt + 1))
                continue
            }
            throw error
        }
    }
}

const getMapMetaCached = async (mapSlug = '') => {
    const normalizedSlug = String(mapSlug || '').trim().toLowerCase()
    if (!normalizedSlug) return null

    const nowMs = Date.now()
    const cached = mapMetaCache.get(normalizedSlug)
    if (cached && (nowMs - Number(cached.cachedAtMs || 0)) < MAP_META_CACHE_TTL_MS) {
        return cached.data || null
    }

    const map = await MapModel.findOne({ slug: normalizedSlug })
        .select('_id slug name isEventMap autoSearchRequiredVipLevel')
        .lean()

    mapMetaCache.set(normalizedSlug, {
        cachedAtMs: nowMs,
        data: map || null,
    })

    return map || null
}

const updateAutoSearchState = async ({ userId, setPatch = {}, incPatch = {}, lastAction = null, logMessage = '', logType = 'info' }) => {
    const updateDoc = {
        $set: {
            ...setPatch,
        },
    }

    const normalizedIncPatch = incPatch && typeof incPatch === 'object' ? incPatch : {}
    const hasIncPatch = Object.keys(normalizedIncPatch).length > 0
    if (hasIncPatch) {
        updateDoc.$inc = normalizedIncPatch
    }

    if (lastAction) {
        updateDoc.$set['autoSearch.lastAction'] = {
            action: String(lastAction?.action || '').trim(),
            result: String(lastAction?.result || '').trim(),
            reason: String(lastAction?.reason || '').trim(),
            targetId: normalizeId(lastAction?.targetId),
            at: lastAction?.at || new Date(),
        }
    }

    const normalizedLogMessage = String(logMessage || '').trim()
    if (normalizedLogMessage) {
        updateDoc.$push = {
            'autoSearch.logs': {
                $each: [{
                    message: normalizedLogMessage,
                    type: String(logType || 'info').trim() || 'info',
                    at: new Date(),
                }],
                $position: 0,
                $slice: AUTO_SEARCH_LOGS_LIMIT,
            },
        }
    }

    await User.updateOne({ _id: userId }, updateDoc)
}

const shouldTreatAsCooldown = (error = null) => {
    const code = String(error?.code || '').trim().toUpperCase()
    if (code === 'ACTION_COOLDOWN') return true
    const message = normalizeSearchText(error?.message || '')
    return message.includes('qua nhanh') || message.includes('thao tac qua nhanh')
}

const resolveAutoActionForEncounter = (encounterLike = null, autoSearchState = {}) => {
    const rarity = normalizeRarityToken(encounterLike?.pokemon?.rarity)
    const configuredAction = String(autoSearchState?.actionByRarity?.[rarity] || 'battle').trim().toLowerCase()
    const encounterFormId = normalizeFormId(
        encounterLike?.pokemon?.formId
        || encounterLike?.pokemon?.form?.formId
        || 'normal'
    )
    if (configuredAction === 'catch' && !isFormAllowedForCatch(encounterFormId, autoSearchState?.catchFormMode)) {
        return 'battle'
    }
    if (configuredAction === 'catch') return 'catch'
    if (configuredAction === 'run') return 'run'
    return 'battle'
}

const buildEncounterLogLabel = (encounterLike = null) => {
    const pokemonName = String(encounterLike?.pokemon?.name || '').trim() || 'Pokemon hoang dã'
    const level = Math.max(1, Number(encounterLike?.level || 1))
    const rarity = String(encounterLike?.pokemon?.rarity || '').trim().toUpperCase()
    const formId = normalizeFormId(encounterLike?.pokemon?.formId || encounterLike?.pokemon?.form?.formId || 'normal')

    let label = `${pokemonName} Lv ${level}`
    if (rarity) {
        label += ` [${rarity}]`
    }
    if (formId !== 'normal') {
        label += ` (${formId})`
    }
    return label
}

const resolveItemDropInfo = (itemDropLike = null) => {
    if (!itemDropLike || typeof itemDropLike !== 'object') return null
    const name = String(
        itemDropLike?.name
        || itemDropLike?.item?.name
        || itemDropLike?.itemName
        || ''
    ).trim()
    if (!name) return null

    const quantity = Math.max(
        1,
        Number(itemDropLike?.quantity)
        || Number(itemDropLike?.qty)
        || Number(itemDropLike?.count)
        || 1
    )

    return { name, quantity }
}

const formatItemDropLabel = (itemDropInfo = null) => {
    if (!itemDropInfo) return ''
    const quantity = Math.max(1, Number(itemDropInfo?.quantity || 1))
    return quantity > 1
        ? `${itemDropInfo.name} x${quantity}`
        : itemDropInfo.name
}

const findAutoCatchBallItemId = async (userId, preferredBallId = '') => {
    const preferred = normalizeId(preferredBallId)
    const inventoryRes = await getInventoryDirect(userId)
    const entries = Array.isArray(inventoryRes?.inventory) ? inventoryRes.inventory : []
    const pokeballs = entries.filter((entry) => {
        const itemType = String(entry?.item?.type || '').trim().toLowerCase()
        return itemType === 'pokeball' && Number(entry?.quantity || 0) > 0
    })

    if (pokeballs.length === 0) return ''
    if (preferred) {
        const matched = pokeballs.find((entry) => String(entry?.item?._id || '') === preferred)
        if (matched?.item?._id) return String(matched.item._id)
    }
    return String(pokeballs[0]?.item?._id || '').trim()
}

const processUser = async (userDoc, deadlineAt, stats) => {
    const userId = String(userDoc?._id || '').trim()
    if (!userId) return

    const effectiveVipBenefits = await resolveEffectiveVipBenefits(userDoc)
    const effectiveUser = {
        ...userDoc,
        vipBenefits: effectiveVipBenefits,
    }
    const now = new Date()
    const nowMs = Date.now()
    const autoState = normalizeAutoSearchState(userDoc?.autoSearch)
    const dailyLimit = toSafeInt(effectiveVipBenefits?.autoSearchUsesPerDay, 0)
    const durationLimitMinutes = toSafeInt(effectiveVipBenefits?.autoSearchDurationMinutes, 0)
    const dailyState = resolveDailyState(autoState, dailyLimit)
    const isSameRuntimeDay = String(autoState.dayKey || '') === dailyState.dayKey
    const storedRuntimeMs = isSameRuntimeDay ? Math.max(0, Number(autoState.dayRuntimeMs || 0)) : 0
    const lastRuntimeAtMs = (isSameRuntimeDay && autoState.lastRuntimeAt)
        ? new Date(autoState.lastRuntimeAt).getTime()
        : nowMs
    const runtimeDeltaMs = Math.max(0, Math.min(60000, nowMs - lastRuntimeAtMs))
    const runtimeMsToday = Math.max(0, storedRuntimeMs + runtimeDeltaMs)
    const runtimeMinutesToday = Math.floor(runtimeMsToday / 60000)

    const baseSyncPatch = {
        'autoSearch.dayKey': dailyState.dayKey,
        'autoSearch.dayLimit': dailyState.limit,
        'autoSearch.dayRuntimeMs': runtimeMsToday,
        'autoSearch.lastRuntimeAt': now,
    }
    const baseSyncPatchWithCount = {
        ...baseSyncPatch,
        'autoSearch.dayCount': dailyState.count,
    }

    if (!hasVipAutoSearchAccess(effectiveUser)) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'VIP_REQUIRED',
                targetId: autoState.mapSlug,
                at: now,
            },
            logMessage: 'Đã dừng auto tìm kiếm vì tài khoản không còn quyền VIP.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    if (dailyState.limit > 0 && dailyState.count >= dailyState.limit) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'quota',
                result: 'skipped',
                reason: 'DAILY_LIMIT_REACHED',
                targetId: autoState.mapSlug,
                at: now,
            },
            logMessage: `Đã hết lượt auto tìm kiếm hôm nay (${dailyState.count}/${dailyState.limit}).`,
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    if (durationLimitMinutes > 0 && runtimeMinutesToday >= durationLimitMinutes) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                    'autoSearch.lastRuntimeAt': null,
                },
                lastAction: {
                    action: 'duration',
                    result: 'skipped',
                    reason: 'DURATION_EXPIRED',
                    targetId: autoState.mapSlug,
                    at: now,
                },
                logMessage: `Đã hết thời lượng tự tìm kiếm hôm nay (${runtimeMinutesToday}/${durationLimitMinutes} phút).`,
                logType: 'warn',
            })
            stats.skipped += 1
            return
    }

    const mapSlug = String(autoState.mapSlug || '').trim().toLowerCase()
    if (!mapSlug) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'NO_MAP_SELECTED',
                targetId: '',
                at: now,
            },
            logMessage: 'Đã dừng auto tìm kiếm: chưa chọn map.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const map = await getMapMetaCached(mapSlug)
    if (!map) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'MAP_NOT_FOUND',
                targetId: mapSlug,
                at: now,
            },
            logMessage: 'Đã dừng auto tìm kiếm: không tìm thấy map đã chọn.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    if (isEventMapLike(map)) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'EVENT_MAP_NOT_SUPPORTED',
                targetId: mapSlug,
                at: now,
            },
            logMessage: 'Đã dừng auto tìm kiếm: map event không hỗ trợ auto.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const currentVipLevel = Math.max(0, Number(userDoc?.vipTierLevel) || 0)
    const autoSearchRequiredVipLevel = Math.max(0, Number(map?.autoSearchRequiredVipLevel) || 0)
    if (currentVipLevel < autoSearchRequiredVipLevel) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatchWithCount,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
                'autoSearch.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'MAP_VIP_REQUIREMENT_NOT_MET',
                targetId: mapSlug,
                at: now,
            },
            logMessage: `Đã dừng auto tìm kiếm: map yêu cầu VIP ${autoSearchRequiredVipLevel}.`,
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const inMemoryNextActionAt = Number(userNextActionAtMs.get(userId) || 0)
    if (inMemoryNextActionAt > nowMs) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
        })
        stats.skipped += 1
        stats.skippedReasons.WAIT_INTERVAL = (stats.skippedReasons.WAIT_INTERVAL || 0) + 1
        return
    }

    const lastActionAtMs = autoState.lastAction?.at ? new Date(autoState.lastAction.at).getTime() : 0
    const intervalMs = Math.max(400, toSafeInt(autoState.searchIntervalMs, 600))
    if (lastActionAtMs > 0 && (nowMs - lastActionAtMs) < intervalMs) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
        })
        stats.skipped += 1
        stats.skippedReasons.WAIT_INTERVAL = (stats.skippedReasons.WAIT_INTERVAL || 0) + 1
        return
    }

    if (Date.now() >= deadlineAt) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
        })
        stats.skipped += 1
        stats.skippedReasons.TIME_BUDGET = (stats.skippedReasons.TIME_BUDGET || 0) + 1
        return
    }

    const token = createInternalToken(userId)

    let activeEncounter = null
    try {
        const encounterRes = await getActiveEncounterDirect(userId)
        activeEncounter = encounterRes?.encounter || null
    } catch (error) {
        if (Number(error?.status) !== 404) {
            throw error
        }
    }

    if (!activeEncounter) {
        try {
            const searchRes = await callApiWithRetry({
                token,
                path: '/api/game/search',
                method: 'POST',
                body: { mapSlug },
                deadlineAt,
            })

            const itemDropInfo = resolveItemDropInfo(searchRes?.itemDrop)
            const itemDropLabel = formatItemDropLabel(itemDropInfo)
            const itemDropIncPatch = itemDropInfo
                ? {
                    'autoSearch.history.itemDropCount': 1,
                    'autoSearch.history.itemDropQuantity': Math.max(1, Number(itemDropInfo.quantity || 1)),
                }
                : {}

            if (Boolean(searchRes?.encountered)) {
                activeEncounter = {
                    _id: searchRes?.encounterId,
                    hp: searchRes?.hp,
                    maxHp: searchRes?.maxHp,
                    level: searchRes?.level,
                    pokemon: searchRes?.pokemon || null,
                }

                await updateAutoSearchState({
                    userId,
                    setPatch: {
                        ...baseSyncPatch,
                    },
                    incPatch: {
                        'autoSearch.dayCount': 1,
                        'autoSearch.history.foundPokemonCount': 1,
                        ...itemDropIncPatch,
                    },
                    lastAction: {
                        action: 'search',
                        result: 'success',
                        reason: 'ENCOUNTER_FOUND',
                        targetId: mapSlug,
                        at: now,
                    },
                    logMessage: itemDropLabel
                        ? `Tìm thấy ${buildEncounterLogLabel(activeEncounter)}. Nhặt được ${itemDropLabel}.`
                        : `Tìm thấy ${buildEncounterLogLabel(activeEncounter)}.`,
                    logType: 'info',
                })
            } else {
                if (itemDropInfo) {
                    await updateAutoSearchState({
                        userId,
                        setPatch: {
                            ...baseSyncPatch,
                        },
                        incPatch: {
                            'autoSearch.dayCount': 1,
                            ...itemDropIncPatch,
                        },
                        lastAction: {
                            action: 'search',
                            result: 'success',
                            reason: 'ITEM_DROPPED',
                            targetId: mapSlug,
                            at: now,
                        },
                        logMessage: `Không gặp Pokemon. Nhặt được ${itemDropLabel}.`,
                        logType: 'info',
                    })
                } else {
                    await updateAutoSearchState({
                        userId,
                        setPatch: {
                            ...baseSyncPatch,
                        },
                        incPatch: {
                            'autoSearch.dayCount': 1,
                        },
                    })
                }
                userNextActionAtMs.set(userId, Date.now() + intervalMs)
                stats.success += 1
                return
            }
        } catch (error) {
            if (shouldTreatAsCooldown(error)) {
                stats.skipped += 1
                stats.skippedReasons.ACTION_COOLDOWN = (stats.skippedReasons.ACTION_COOLDOWN || 0) + 1
                return
            }

            if (Number(error?.status) === 403) {
                await updateAutoSearchState({
                    userId,
                    setPatch: {
                        ...baseSyncPatchWithCount,
                        'autoSearch.enabled': false,
                        'autoSearch.startedAt': null,
                        'autoSearch.lastRuntimeAt': null,
                    },
                    lastAction: {
                        action: 'eligibility',
                        result: 'skipped',
                        reason: 'MAP_LOCKED',
                        targetId: mapSlug,
                        at: now,
                    },
                    logMessage: 'Đã dừng tự tìm kiếm: bản đồ đang bị khóa.',
                    logType: 'warn',
                })
                stats.skipped += 1
                return
            }

            if (Number(error?.status) === 404) {
                await updateAutoSearchState({
                    userId,
                    setPatch: {
                        ...baseSyncPatchWithCount,
                        'autoSearch.enabled': false,
                        'autoSearch.startedAt': null,
                        'autoSearch.lastRuntimeAt': null,
                    },
                    lastAction: {
                        action: 'eligibility',
                        result: 'skipped',
                        reason: 'MAP_NOT_FOUND',
                        targetId: mapSlug,
                        at: now,
                    },
                    logMessage: 'Đã dừng tự tìm kiếm: không tìm thấy bản đồ đã chọn.',
                    logType: 'warn',
                })
                stats.skipped += 1
                return
            }

            throw error
        }
    }

    const action = resolveAutoActionForEncounter(activeEncounter, autoState)
    const encounterId = String(activeEncounter?._id || '').trim()
    const encounterLabel = buildEncounterLogLabel(activeEncounter)
    if (!encounterId) {
        stats.skipped += 1
        stats.skippedReasons.NO_ENCOUNTER_ID = (stats.skippedReasons.NO_ENCOUNTER_ID || 0) + 1
        return
    }

    if (action === 'run') {
        try {
            await runFromEncounterDirect(userId, encounterId)
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                },
                incPatch: {
                    'autoSearch.history.runCount': 1,
                },
                lastAction: {
                    action: 'run',
                    result: 'success',
                    reason: '',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: `Tìm thấy ${encounterLabel} và đã bỏ qua.`,
                logType: 'info',
            })
            userLastBattleEncounterId.delete(userId)
            userNextActionAtMs.set(userId, Date.now() + intervalMs)
            stats.success += 1
            return
        } catch (error) {
            if (shouldTreatAsCooldown(error)) {
                stats.skipped += 1
                stats.skippedReasons.ACTION_COOLDOWN = (stats.skippedReasons.ACTION_COOLDOWN || 0) + 1
                return
            }
            throw error
        }
    }

    if (action === 'catch') {
        const ballItemId = await findAutoCatchBallItemId(userId, autoState.catchBallItemId)
        if (!ballItemId) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                    'autoSearch.lastRuntimeAt': null,
                },
                lastAction: {
                    action: 'catch',
                    result: 'skipped',
                    reason: 'NO_BALL_AVAILABLE',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: `Tìm thấy ${encounterLabel} nhưng đã hết bóng, auto tìm kiếm tạm dừng.`,
                logType: 'warn',
            })
            stats.skipped += 1
            return
        }

        try {
            const catchRes = await callApiWithRetry({
                token,
                path: '/api/inventory/use',
                method: 'POST',
                body: {
                    itemId: ballItemId,
                    quantity: 1,
                    encounterId,
                },
                deadlineAt,
            })

            const isCaught = Boolean(catchRes?.caught)
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                    'autoSearch.catchBallItemId': ballItemId,
                },
                incPatch: {
                    'autoSearch.history.catchAttemptCount': 1,
                    ...(isCaught ? { 'autoSearch.history.catchSuccessCount': 1 } : {}),
                },
                lastAction: {
                    action: 'catch',
                    result: isCaught ? 'success' : 'attempted',
                    reason: isCaught ? 'CAUGHT' : 'ESCAPED',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: isCaught
                    ? `Tìm thấy ${encounterLabel} và đã bắt thành công.`
                    : `Tìm thấy ${encounterLabel} nhưng bắt chưa thành công.`,
                logType: isCaught ? 'success' : 'info',
            })
            userLastBattleEncounterId.delete(userId)
            userNextActionAtMs.set(userId, Date.now() + intervalMs)
            stats.success += 1
            return
        } catch (error) {
            if (shouldTreatAsCooldown(error)) {
                stats.skipped += 1
                stats.skippedReasons.ACTION_COOLDOWN = (stats.skippedReasons.ACTION_COOLDOWN || 0) + 1
                return
            }

            const normalizedMessage = normalizeSearchText(error?.message || '')
            if (normalizedMessage.includes('khong du vat pham')) {
                await updateAutoSearchState({
                    userId,
                    setPatch: {
                        ...baseSyncPatchWithCount,
                        'autoSearch.enabled': false,
                        'autoSearch.startedAt': null,
                        'autoSearch.lastRuntimeAt': null,
                    },
                    lastAction: {
                        action: 'catch',
                        result: 'skipped',
                        reason: 'NO_BALL_AVAILABLE',
                        targetId: mapSlug,
                        at: now,
                    },
                    logMessage: `Tìm thấy ${encounterLabel} nhưng không đủ bóng, auto tìm kiếm tạm dừng.`,
                    logType: 'warn',
                })
                stats.skipped += 1
                return
            }

            throw error
        }
    }

    try {
        const attackRes = await callApiWithRetry({ token, path: `/api/game/encounter/${encounterId}/attack`, method: 'POST', deadlineAt })
        const playerDefeated = Boolean(attackRes?.playerDefeated)
        const defeated = Boolean(attackRes?.defeated)
        const isFirstBattleForEncounter = userLastBattleEncounterId.get(userId) !== encounterId
        if (isFirstBattleForEncounter) {
            userLastBattleEncounterId.set(userId, encounterId)
        }
        if (playerDefeated) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                    'autoSearch.lastRuntimeAt': null,
                },
                incPatch: {
                    ...(isFirstBattleForEncounter ? { 'autoSearch.history.battleCount': 1 } : {}),
                },
                lastAction: {
                    action: 'battle',
                    result: 'error',
                    reason: 'PLAYER_DEFEATED',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: `Tìm thấy ${encounterLabel} nhưng Pokemon của bạn đã kiệt sức, auto tìm kiếm tạm dừng.`,
                logType: 'warn',
            })
            userLastBattleEncounterId.delete(userId)
            stats.errors += 1
            stats.errorReasons.PLAYER_DEFEATED = (stats.errorReasons.PLAYER_DEFEATED || 0) + 1
            return
        }

        if (defeated || isFirstBattleForEncounter) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatchWithCount,
                },
                incPatch: {
                    ...(isFirstBattleForEncounter ? { 'autoSearch.history.battleCount': 1 } : {}),
                },
                lastAction: {
                    action: 'battle',
                    result: defeated ? 'success' : 'attempted',
                    reason: defeated ? 'DEFEATED_WILD' : 'DAMAGE',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: defeated ? `Đã đánh bại ${encounterLabel}.` : '',
                logType: defeated ? 'success' : 'info',
            })
        }

        if (defeated) {
            userLastBattleEncounterId.delete(userId)
        }

        userNextActionAtMs.set(userId, Date.now() + intervalMs)
        stats.success += 1
    } catch (error) {
        if (shouldTreatAsCooldown(error)) {
            stats.skipped += 1
            stats.skippedReasons.ACTION_COOLDOWN = (stats.skippedReasons.ACTION_COOLDOWN || 0) + 1
            return
        }
        throw error
    }
}

const fetchEligibleUsers = async () => {
    const baseFilter = {
        'autoSearch.enabled': true,
        isBanned: { $ne: true },
        role: { $in: ['vip', 'admin'] },
    }

    const buildFilterWithCursor = () => (
        lastCursorId
            ? {
                ...baseFilter,
                _id: { $gt: lastCursorId },
            }
            : baseFilter
    )

    let users = await User.find(buildFilterWithCursor())
        .select('_id role vipTierId vipTierLevel vipBenefits autoSearch isBanned')
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean()

    if (users.length === 0 && lastCursorId) {
        lastCursorId = ''
        users = await User.find(baseFilter)
            .select('_id role vipTierId vipTierLevel vipBenefits autoSearch isBanned')
            .sort({ _id: 1 })
            .limit(BATCH_SIZE)
            .lean()
    }

    if (users.length > 0) {
        lastCursorId = String(users[users.length - 1]._id)
    }

    return users
}

const runWithConcurrency = async (items, limit, handler) => {
    const maxWorkers = Math.max(1, Math.min(limit, items.length))
    if (maxWorkers === 0) return

    let cursor = 0
    const workers = Array.from({ length: maxWorkers }, async () => {
        while (cursor < items.length) {
            const currentIndex = cursor
            cursor += 1
            await handler(items[currentIndex])
        }
    })

    await Promise.all(workers)
}

const acquireDistributedLock = async () => {
    const lockKey = `${WORKER_LOCK_KEY_PREFIX}:${getGameDayKey()}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

    try {
        const lock = await WorkerLock.findOneAndUpdate(
            {
                key: lockKey,
                $or: [
                    { expiresAt: { $lte: now } },
                    { ownerId: OWNER_ID },
                ],
            },
            {
                $set: {
                    ownerId: OWNER_ID,
                    expiresAt,
                    touchedAt: now,
                },
                $setOnInsert: {
                    key: lockKey,
                },
            },
            {
                new: true,
                upsert: true,
            }
        ).lean()

        return Boolean(lock && String(lock.ownerId) === OWNER_ID)
    } catch (error) {
        if (error?.code === 11000) {
            return false
        }
        throw error
    }
}

const releaseDistributedLock = async () => {
    const lockKey = `${WORKER_LOCK_KEY_PREFIX}:${getGameDayKey()}`
    await WorkerLock.deleteOne({ key: lockKey, ownerId: OWNER_ID })
}

const runTick = async () => {
    if (localBusy) return
    localBusy = true

    const startedAt = Date.now()
    const stats = {
        fetched: 0,
        success: 0,
        skipped: 0,
        errors: 0,
        skippedReasons: {},
        errorReasons: {},
    }

    try {
        const acquired = await acquireDistributedLock()
        if (!acquired) return

        try {
            const users = await fetchEligibleUsers()
            stats.fetched = users.length
            if (users.length === 0) return

            const deadlineAt = Date.now() + TIME_BUDGET_MS
            await runWithConcurrency(users, CONCURRENCY, async (user) => {
                try {
                    await processUser(user, deadlineAt, stats)
                    if (POST_USER_COOLDOWN_MS > 0) {
                        await sleep(POST_USER_COOLDOWN_MS)
                    }
                } catch (error) {
                    const normalizedErrorCode = String(error?.code || 'EXCEPTION').trim().toUpperCase() || 'EXCEPTION'
                    if (normalizedErrorCode === 'TIME_BUDGET' || normalizedErrorCode === 'REQUEST_TIMEOUT') {
                        stats.skipped += 1
                        stats.skippedReasons[normalizedErrorCode] = (stats.skippedReasons[normalizedErrorCode] || 0) + 1
                        return
                    }
                    stats.errors += 1
                    stats.errorReasons[normalizedErrorCode] = (stats.errorReasons[normalizedErrorCode] || 0) + 1

                    await updateAutoSearchState({
                        userId: String(user?._id || ''),
                        setPatch: {},
                        lastAction: {
                            action: 'tick',
                            result: 'error',
                            reason: normalizedErrorCode,
                            targetId: String(user?.autoSearch?.mapSlug || '').trim().toLowerCase(),
                            at: new Date(),
                        },
                        logMessage: `Auto tìm kiếm lỗi: ${String(error?.message || 'Lỗi không xác định')}`,
                        logType: 'error',
                    })

                    console.error('[auto-search-worker] process user failed:', {
                        userId: String(user?._id || ''),
                        code: normalizedErrorCode,
                        message: error?.message,
                    })
                }
            })
        } finally {
            await releaseDistributedLock()
        }
    } catch (error) {
        console.error('[auto-search-worker] tick failed:', error)
    } finally {
        localBusy = false
        const durationMs = Date.now() - startedAt

        if (mapMetaCache.size > 5000) {
            const gcThresholdMs = Date.now() - (MAP_META_CACHE_TTL_MS * 2)
            for (const [mapSlug, payload] of mapMetaCache.entries()) {
                if (Number(payload?.cachedAtMs || 0) < gcThresholdMs) {
                    mapMetaCache.delete(mapSlug)
                }
            }
        }

        if (userNextActionAtMs.size > 5000) {
            const gcThresholdMs = Date.now() - 60000
            for (const [userId, nextAtMs] of userNextActionAtMs.entries()) {
                if (Number(nextAtMs) < gcThresholdMs) {
                    userNextActionAtMs.delete(userId)
                }
            }
        }

        if (userLastBattleEncounterId.size > 5000) {
            for (const [userId] of userLastBattleEncounterId.entries()) {
                if (!userNextActionAtMs.has(userId)) {
                    userLastBattleEncounterId.delete(userId)
                }
            }
        }

        if (stats.fetched > 0 || stats.errors > 0) {
            const skippedReasonsText = Object.entries(stats.skippedReasons)
                .map(([key, count]) => `${key}:${count}`)
                .join(',')
            const errorReasonsText = Object.entries(stats.errorReasons)
                .map(([key, count]) => `${key}:${count}`)
                .join(',')
            console.log(
                `[auto-search-worker] tick done: fetched=${stats.fetched} success=${stats.success} skipped=${stats.skipped}${skippedReasonsText ? ` (${skippedReasonsText})` : ''} errors=${stats.errors}${errorReasonsText ? ` (${errorReasonsText})` : ''} durationMs=${durationMs}`
            )
        }
    }
}

export const startAutoSearchWorker = ({ baseUrl }) => {
    apiBaseUrl = String(baseUrl || '').trim()
    if (!apiBaseUrl) {
        console.warn('[auto-search-worker] skip start: missing baseUrl')
        return
    }

    if (intervalRef) return
    intervalRef = setInterval(() => {
        runTick()
    }, TICK_INTERVAL_MS)
    setTimeout(() => {
        runTick()
    }, 1500)

    console.log(`[auto-search-worker] started (tick=${TICK_INTERVAL_MS}ms, batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})`)
}

export const stopAutoSearchWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
