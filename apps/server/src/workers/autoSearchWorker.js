import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import MapModel from '../models/Map.js'
import WorkerLock from '../models/WorkerLock.js'
import {
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

const WORKER_LOCK_KEY = 'auto-search:tick-lock'
const OWNER_ID = `auto-search-worker:${process.pid}:${crypto.randomBytes(5).toString('hex')}`

const TICK_INTERVAL_MS = toSafeInt(process.env.AUTO_SEARCH_TICK_MS, 6000, 3000, 60000)
const LOCK_TTL_MS = toSafeInt(process.env.AUTO_SEARCH_LOCK_TTL_MS, 25000, 5000, 300000)
const BATCH_SIZE = toSafeInt(process.env.AUTO_SEARCH_BATCH_SIZE, 120, 10, 500)
const CONCURRENCY = toSafeInt(process.env.AUTO_SEARCH_CONCURRENCY, 10, 1, 50)
const TIME_BUDGET_MS = toSafeInt(process.env.AUTO_SEARCH_TIME_BUDGET_MS, 14000, 1000, 120000)
const AUTO_SEARCH_LOGS_LIMIT = 12

let intervalRef = null
let localBusy = false
let lastCursorId = ''
let apiBaseUrl = ''

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
})

const createInternalToken = (userId) => {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    if (!jwtSecret) {
        throw new Error('JWT_SECRET chưa được cấu hình')
    }
    return jwt.sign({ userId: String(userId) }, jwtSecret, { expiresIn: '30m' })
}

const buildUrl = (path) => {
    const base = String(apiBaseUrl || '').replace(/\/$/, '')
    const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`
    return `${base}${normalizedPath}`
}

const callApi = async ({ token, path, method = 'GET', body = null }) => {
    const response = await fetch(buildUrl(path), {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'x-internal-worker': 'auto-search',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })

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

const updateAutoSearchState = async ({ userId, setPatch = {}, lastAction = null, logMessage = '', logType = 'info' }) => {
    const updateDoc = {
        $set: {
            ...setPatch,
        },
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

const findAutoCatchBallItemId = async (token, preferredBallId = '') => {
    const preferred = normalizeId(preferredBallId)
    const inventoryRes = await callApi({ token, path: '/api/inventory' })
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

    const now = new Date()
    const autoState = normalizeAutoSearchState(userDoc?.autoSearch)
    const dailyLimit = toSafeInt(userDoc?.vipBenefits?.autoSearchUsesPerDay, 0)
    const durationLimitMinutes = toSafeInt(userDoc?.vipBenefits?.autoSearchDurationMinutes, 0)
    const dailyState = resolveDailyState(autoState, dailyLimit)

    const baseSyncPatch = {
        'autoSearch.dayKey': dailyState.dayKey,
        'autoSearch.dayCount': dailyState.count,
        'autoSearch.dayLimit': dailyState.limit,
    }

    if (!hasVipAutoSearchAccess(userDoc)) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
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
                ...baseSyncPatch,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
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

    if (durationLimitMinutes > 0) {
        const startedAtMs = autoState.startedAt ? new Date(autoState.startedAt).getTime() : Date.now()
        const elapsedMs = Date.now() - startedAtMs
        if (elapsedMs >= durationLimitMinutes * 60 * 1000) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                },
                lastAction: {
                    action: 'duration',
                    result: 'skipped',
                    reason: 'DURATION_EXPIRED',
                    targetId: autoState.mapSlug,
                    at: now,
                },
                logMessage: 'Đã hết thời gian dùng auto tìm kiếm theo gói VIP.',
                logType: 'warn',
            })
            stats.skipped += 1
            return
        }
    }

    const mapSlug = String(autoState.mapSlug || '').trim().toLowerCase()
    if (!mapSlug) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
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

    const map = await MapModel.findOne({ slug: mapSlug })
        .select('_id slug name isEventMap')
        .lean()
    if (!map) {
        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
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
                ...baseSyncPatch,
                'autoSearch.enabled': false,
                'autoSearch.startedAt': null,
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

    const lastActionAtMs = autoState.lastAction?.at ? new Date(autoState.lastAction.at).getTime() : 0
    const intervalMs = Math.max(900, toSafeInt(autoState.searchIntervalMs, 1200))
    if (lastActionAtMs > 0 && (Date.now() - lastActionAtMs) < intervalMs) {
        stats.skipped += 1
        stats.skippedReasons.WAIT_INTERVAL = (stats.skippedReasons.WAIT_INTERVAL || 0) + 1
        return
    }

    if (Date.now() >= deadlineAt) {
        stats.skipped += 1
        stats.skippedReasons.TIME_BUDGET = (stats.skippedReasons.TIME_BUDGET || 0) + 1
        return
    }

    const token = createInternalToken(userId)

    try {
        await callApi({ token, path: `/api/game/map/${encodeURIComponent(mapSlug)}/state` })
    } catch (error) {
        if (Number(error?.status) === 403) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                },
                lastAction: {
                    action: 'eligibility',
                    result: 'skipped',
                    reason: 'MAP_LOCKED',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: 'Đã dừng auto tìm kiếm: map đang bị khóa.',
                logType: 'warn',
            })
            stats.skipped += 1
            return
        }
    }

    let activeEncounter = null
    try {
        const encounterRes = await callApi({ token, path: '/api/game/encounter/active' })
        activeEncounter = encounterRes?.encounter || null
    } catch (error) {
        if (Number(error?.status) !== 404) {
            throw error
        }
    }

    if (!activeEncounter) {
        try {
            const searchRes = await callApi({
                token,
                path: '/api/game/search',
                method: 'POST',
                body: { mapSlug },
            })

            if (Boolean(searchRes?.encountered)) {
                activeEncounter = {
                    _id: searchRes?.encounterId,
                    hp: searchRes?.hp,
                    maxHp: searchRes?.maxHp,
                    level: searchRes?.level,
                    pokemon: searchRes?.pokemon || null,
                }
            } else {
                await updateAutoSearchState({
                    userId,
                    setPatch: {
                        ...baseSyncPatch,
                    },
                    lastAction: {
                        action: 'search',
                        result: 'success',
                        reason: 'NO_ENCOUNTER',
                        targetId: mapSlug,
                        at: now,
                    },
                })
                stats.success += 1
                return
            }
        } catch (error) {
            if (shouldTreatAsCooldown(error)) {
                stats.skipped += 1
                stats.skippedReasons.ACTION_COOLDOWN = (stats.skippedReasons.ACTION_COOLDOWN || 0) + 1
                return
            }
            throw error
        }
    }

    const action = resolveAutoActionForEncounter(activeEncounter, autoState)
    const encounterId = String(activeEncounter?._id || '').trim()
    if (!encounterId) {
        stats.skipped += 1
        stats.skippedReasons.NO_ENCOUNTER_ID = (stats.skippedReasons.NO_ENCOUNTER_ID || 0) + 1
        return
    }

    if (action === 'run') {
        try {
            await callApi({ token, path: `/api/game/encounter/${encounterId}/run`, method: 'POST' })
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                },
                lastAction: {
                    action: 'run',
                    result: 'success',
                    reason: '',
                    targetId: mapSlug,
                    at: now,
                },
            })
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
        const ballItemId = await findAutoCatchBallItemId(token, autoState.catchBallItemId)
        if (!ballItemId) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                },
                lastAction: {
                    action: 'catch',
                    result: 'skipped',
                    reason: 'NO_BALL_AVAILABLE',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: 'Đã dừng auto tìm kiếm: hết bóng để auto bắt.',
                logType: 'warn',
            })
            stats.skipped += 1
            return
        }

        try {
            const catchRes = await callApi({
                token,
                path: '/api/inventory/use',
                method: 'POST',
                body: {
                    itemId: ballItemId,
                    quantity: 1,
                    encounterId,
                },
            })

            const isCaught = Boolean(catchRes?.caught)
            const pokemonName = String(activeEncounter?.pokemon?.name || '').trim() || 'Pokemon hoang dã'
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoSearch.catchBallItemId': ballItemId,
                },
                lastAction: {
                    action: 'catch',
                    result: isCaught ? 'success' : 'attempted',
                    reason: isCaught ? 'CAUGHT' : 'ESCAPED',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: isCaught
                    ? `Auto bắt thành công ${pokemonName}.`
                    : `Auto bắt thất bại với ${pokemonName}.`,
                logType: isCaught ? 'success' : 'info',
            })
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
                        ...baseSyncPatch,
                        'autoSearch.enabled': false,
                        'autoSearch.startedAt': null,
                    },
                    lastAction: {
                        action: 'catch',
                        result: 'skipped',
                        reason: 'NO_BALL_AVAILABLE',
                        targetId: mapSlug,
                        at: now,
                    },
                    logMessage: 'Đã dừng auto tìm kiếm: không đủ bóng để auto bắt.',
                    logType: 'warn',
                })
                stats.skipped += 1
                return
            }

            throw error
        }
    }

    try {
        const attackRes = await callApi({ token, path: `/api/game/encounter/${encounterId}/attack`, method: 'POST' })
        const playerDefeated = Boolean(attackRes?.playerDefeated)
        const defeated = Boolean(attackRes?.defeated)
        const pokemonName = String(activeEncounter?.pokemon?.name || '').trim() || 'Pokemon hoang dã'

        if (playerDefeated) {
            await updateAutoSearchState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoSearch.enabled': false,
                    'autoSearch.startedAt': null,
                },
                lastAction: {
                    action: 'battle',
                    result: 'error',
                    reason: 'PLAYER_DEFEATED',
                    targetId: mapSlug,
                    at: now,
                },
                logMessage: 'Đã dừng auto tìm kiếm: Pokemon của bạn đã kiệt sức khi chiến đấu.',
                logType: 'warn',
            })
            stats.errors += 1
            stats.errorReasons.PLAYER_DEFEATED = (stats.errorReasons.PLAYER_DEFEATED || 0) + 1
            return
        }

        await updateAutoSearchState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
            lastAction: {
                action: 'battle',
                result: defeated ? 'success' : 'attempted',
                reason: defeated ? 'DEFEATED_WILD' : 'DAMAGE',
                targetId: mapSlug,
                at: now,
            },
            logMessage: defeated
                ? `Đã đánh bại ${pokemonName} Lv ${Math.max(1, Number(activeEncounter?.level || 1))}.`
                : '',
            logType: defeated ? 'success' : 'info',
        })
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
        'vipBenefits.autoSearchEnabled': { $ne: false },
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
        .select('_id role vipTierLevel vipBenefits autoSearch isBanned')
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean()

    if (users.length === 0 && lastCursorId) {
        lastCursorId = ''
        users = await User.find(baseFilter)
            .select('_id role vipTierLevel vipBenefits autoSearch isBanned')
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
    const now = new Date()
    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS)

    try {
        const lock = await WorkerLock.findOneAndUpdate(
            {
                key: WORKER_LOCK_KEY,
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
                    key: WORKER_LOCK_KEY,
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
    await WorkerLock.deleteOne({ key: WORKER_LOCK_KEY, ownerId: OWNER_ID })
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
                    await sleep(180)
                } catch (error) {
                    const normalizedErrorCode = String(error?.code || 'EXCEPTION').trim().toUpperCase() || 'EXCEPTION'
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
