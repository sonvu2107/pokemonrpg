import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import BattleTrainer from '../models/BattleTrainer.js'
import WorkerLock from '../models/WorkerLock.js'
import { getPartyDirect } from '../services/workerService.js'
import { createCompletedTrainerBattleSession } from '../services/trainerBattleSessionService.js'
import {
    getGameDayKey,
    hasVipAutoTrainerAccess,
    normalizeAutoTrainerState,
    normalizeId,
    normalizeSearchText,
    resolveDailyState,
    toSafeInt,
} from '../utils/autoTrainerUtils.js'

const WORKER_LOCK_KEY_PREFIX = 'auto-trainer:tick-lock'
const OWNER_ID = `auto-trainer-worker:${process.pid}:${crypto.randomBytes(5).toString('hex')}`

const TICK_INTERVAL_MS = toSafeInt(process.env.AUTO_TRAINER_TICK_MS, 5000, 3000, 60000)
const LOCK_TTL_MS = toSafeInt(process.env.AUTO_TRAINER_LOCK_TTL_MS, 35000, 5000, 300000)
const BATCH_SIZE = toSafeInt(process.env.AUTO_TRAINER_BATCH_SIZE, 120, 10, 500)
const CONCURRENCY = toSafeInt(process.env.AUTO_TRAINER_CONCURRENCY, 12, 1, 50)
const TIME_BUDGET_MS = toSafeInt(process.env.AUTO_TRAINER_TIME_BUDGET_MS, 90000, 5000, 300000)
const POST_USER_COOLDOWN_MS = toSafeInt(process.env.AUTO_TRAINER_POST_USER_COOLDOWN_MS, 0, 0, 5000)
const TRAINER_META_CACHE_TTL_MS = toSafeInt(process.env.AUTO_TRAINER_META_CACHE_TTL_MS, 60000, 5000, 600000)
const AUTO_TRAINER_LOGS_LIMIT = 12
const MIN_EFFECTIVE_USER_BUDGET_MS = toSafeInt(process.env.AUTO_TRAINER_MIN_EFFECTIVE_USER_BUDGET_MS, 30000, 10000, 300000)

let intervalRef = null
let localBusy = false
let lastCursorId = ''
let apiBaseUrl = ''
const trainerMetaCache = new Map()

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
                'x-internal-worker': 'auto-trainer',
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

const RETRYABLE_CODES = new Set(['REQUEST_TIMEOUT', 'BATTLE_SESSION_CONFLICT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'])

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

const resolveTrainerAverageLevel = (trainerLike = {}) => {
    const levels = (Array.isArray(trainerLike?.team) ? trainerLike.team : [])
        .map((entry) => Math.max(1, Number(entry?.level || 1)))
    if (levels.length === 0) return 1
    return Math.max(1, Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length))
}

const getTrainerMetaCached = async (trainerId = '') => {
    const normalizedTrainerId = normalizeId(trainerId)
    if (!normalizedTrainerId) return null

    const nowMs = Date.now()
    const cached = trainerMetaCache.get(normalizedTrainerId)
    if (cached && (nowMs - Number(cached.cachedAtMs || 0)) < TRAINER_META_CACHE_TTL_MS) {
        return cached.data || null
    }

    const trainer = await BattleTrainer.findOne({
        _id: normalizedTrainerId,
        $or: [
            { isActive: true },
            { isActive: { $exists: false } },
            { isActive: null },
        ],
    })
        .select('_id name team')
        .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types')
        .lean()

    const normalizedTrainer = trainer
        ? {
            ...trainer,
            level: resolveTrainerAverageLevel(trainer),
        }
        : null

    trainerMetaCache.set(normalizedTrainerId, {
        cachedAtMs: nowMs,
        data: normalizedTrainer,
    })

    return normalizedTrainer
}

const formatTrainerOutcomeReasonForLog = (reason = '') => {
    const raw = String(reason || '').trim()
    if (!raw) return 'Battle thất bại.'
    const normalized = normalizeSearchText(raw)

    if (normalized === 'session_conflict') return 'Phiên chiến đấu đang được đồng bộ.'
    if (normalized === 'request_timeout') return 'Kết nối tạm chậm, hệ thống sẽ tự thử lại.'
    if (normalized === 'time_budget') return 'Hệ thống đang bận theo nhịp xử lý, sẽ tự thử lại.'
    if (normalized.includes('pokemon cua ban da bai tran')) return 'Pokemon của bạn đã bại trận.'
    if (normalized.includes('khong tim thay pokemon')) return 'Không tìm thấy Pokemon đang chiến đấu.'
    return raw
}

const updateAutoTrainerState = async ({ userId, setPatch = {}, lastAction = null, logMessage = '', logType = 'info' }) => {
    const updateDoc = {
        $set: {
            ...setPatch,
        },
    }

    if (lastAction) {
        updateDoc.$set['autoTrainer.lastAction'] = {
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
            'autoTrainer.logs': {
                $each: [{
                    message: normalizedLogMessage,
                    type: String(logType || 'info').trim() || 'info',
                    at: new Date(),
                }],
                $position: 0,
                $slice: AUTO_TRAINER_LOGS_LIMIT,
            },
        }
    }

    await User.updateOne({ _id: userId }, updateDoc)
}

const runAutoTrainerBattleFlow = async ({ userId, token, trainerId, trainerMeta, attackIntervalMs, deadlineAt }) => {
    void attackIntervalMs

    const partyResponse = await getPartyDirect(userId)
    const partyData = (Array.isArray(partyResponse?.party) ? partyResponse.party : []).filter(Boolean)
    if (partyData.length === 0) {
        return { ok: false, code: 'NO_PARTY', reason: 'Bạn cần có Pokemon trong đội hình để auto battle trainer.' }
    }

    const activeSlot = partyData[0] || null
    const activePokemonId = normalizeId(activeSlot?._id)
    if (!activePokemonId) {
        return { ok: false, code: 'MISSING_ACTIVE_POKEMON', reason: 'Không xác định được Pokemon nhận EXP.' }
    }

    if (!Array.isArray(trainerMeta?.team) || trainerMeta.team.length === 0) {
        return { ok: false, code: 'TRAINER_UNAVAILABLE', reason: 'Trainer đã chọn không còn khả dụng.' }
    }

    await createCompletedTrainerBattleSession({
        userId,
        trainer: trainerMeta,
        activePokemonId,
    })

    try {
        await callApiWithRetry({ token, path: '/api/game/battle/resolve', method: 'POST', body: { trainerId }, deadlineAt })
    } catch (error) {
        const normalized = normalizeSearchText(error?.message || '')
        if (normalized.includes('da duoc nhan') || normalized.includes('phan thuong battle da duoc nhan')) {
            return { ok: true, code: 'SUCCESS' }
        }

        const normalizedCode = String(error?.code || '').trim().toUpperCase()
        if (normalizedCode === 'TIME_BUDGET' || normalizedCode === 'REQUEST_TIMEOUT') {
            return {
                ok: false,
                code: normalizedCode,
                reason: normalizedCode,
            }
        }
        if (error?.status === 404) {
            return {
                ok: false,
                code: 'TRAINER_UNAVAILABLE',
                reason: 'Trainer đã chọn không còn khả dụng.',
            }
        }

        return {
            ok: false,
            code: 'RESOLVE_ERROR',
            reason: String(error?.message || 'Không thể nhận kết quả battle').trim(),
        }
    }

    return { ok: true, code: 'SUCCESS' }
}

const shouldDisableOnFailureCode = (code = '') => {
    const normalized = String(code || '').trim().toUpperCase()
    return (
        normalized === 'NO_PARTY'
        || normalized === 'MISSING_ACTIVE_POKEMON'
    )
}

const processUser = async (userDoc, deadlineAt, stats) => {
    const userId = String(userDoc?._id || '').trim()
    if (!userId) return

    const autoState = normalizeAutoTrainerState(userDoc?.autoTrainer)
    const dailyLimit = toSafeInt(userDoc?.vipBenefits?.autoBattleTrainerUsesPerDay, 0)
    const durationLimitMinutes = toSafeInt(userDoc?.vipBenefits?.autoBattleTrainerDurationMinutes, 0)
    const dailyState = resolveDailyState(autoState, dailyLimit)
    const now = new Date()
    const nowMs = now.getTime()
    const isSameRuntimeDay = String(autoState.dayKey || '') === dailyState.dayKey
    const storedRuntimeMs = isSameRuntimeDay ? Math.max(0, Number(autoState.dayRuntimeMs || 0)) : 0
    const lastRuntimeAtMs = (isSameRuntimeDay && autoState.lastRuntimeAt)
        ? new Date(autoState.lastRuntimeAt).getTime()
        : nowMs
    const runtimeDeltaMs = Math.max(0, Math.min(60000, nowMs - lastRuntimeAtMs))
    const runtimeMsToday = Math.max(0, storedRuntimeMs + runtimeDeltaMs)
    const runtimeMinutesToday = Math.floor(runtimeMsToday / 60000)

    const baseSyncPatch = {
        'autoTrainer.dayKey': dailyState.dayKey,
        'autoTrainer.dayCount': dailyState.count,
        'autoTrainer.dayLimit': dailyState.limit,
        'autoTrainer.dayRuntimeMs': runtimeMsToday,
        'autoTrainer.lastRuntimeAt': now,
    }

    if (!hasVipAutoTrainerAccess(userDoc)) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
                'autoTrainer.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'VIP_REQUIRED',
                targetId: autoState.trainerId,
                at: now,
            },
            logMessage: 'Đã dừng auto battle trainer vì tài khoản không còn quyền VIP.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    if (dailyState.limit > 0 && dailyState.count >= dailyState.limit) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
                'autoTrainer.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'quota',
                result: 'skipped',
                reason: 'DAILY_LIMIT_REACHED',
                targetId: autoState.trainerId,
                at: now,
            },
            logMessage: `Đã hết lượt auto battle hôm nay (${dailyState.count}/${dailyState.limit}).`,
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    if (durationLimitMinutes > 0 && runtimeMinutesToday >= durationLimitMinutes) {
            await updateAutoTrainerState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoTrainer.enabled': false,
                    'autoTrainer.startedAt': null,
                    'autoTrainer.lastRuntimeAt': null,
                },
                lastAction: {
                    action: 'duration',
                    result: 'skipped',
                    reason: 'DURATION_EXPIRED',
                    targetId: autoState.trainerId,
                    at: now,
                },
                logMessage: `Đã hết thời lượng auto battle hôm nay (${runtimeMinutesToday}/${durationLimitMinutes} phút).`,
                logType: 'warn',
            })
            stats.skipped += 1
            return
    }

    const trainerId = normalizeId(autoState.trainerId)
    if (!trainerId) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
                'autoTrainer.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'NO_TRAINER_SELECTED',
                targetId: '',
                at: now,
            },
            logMessage: 'Đã dừng auto battle trainer: chưa chọn trainer đã pass.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const trainer = await getTrainerMetaCached(trainerId)
    if (!trainer) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
                'autoTrainer.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'TRAINER_UNAVAILABLE',
                targetId: trainerId,
                at: now,
            },
            logMessage: 'Đã dừng auto battle trainer: trainer đã chọn không còn khả dụng.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const completedTrainerSet = new Set(
        (Array.isArray(userDoc?.completedBattleTrainers) ? userDoc.completedBattleTrainers : [])
            .map((entry) => normalizeId(entry))
            .filter(Boolean)
    )
    if (!completedTrainerSet.has(trainerId)) {
        console.warn(`[auto-trainer-worker] auto-repair: adding trainer ${trainerId} to completedBattleTrainers for user ${userId}`)
        await User.updateOne(
            { _id: userId },
            { $addToSet: { completedBattleTrainers: trainerId } }
        )
    }

    const attackIntervalMs = Math.max(100, toSafeInt(autoState.attackIntervalMs, 200))
    const estimatedBattleBudgetMs = Math.min(
        300000,
        Math.max(MIN_EFFECTIVE_USER_BUDGET_MS, attackIntervalMs * 220 + 15000)
    )
    const effectiveDeadlineAt = Math.min(deadlineAt, Date.now() + estimatedBattleBudgetMs)

    if (Date.now() >= effectiveDeadlineAt) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
            lastAction: {
                action: 'tick',
                result: 'skipped',
                reason: 'TIME_BUDGET',
                targetId: trainerId,
                at: now,
            },
        })
        stats.skipped += 1
        return
    }

    const token = createInternalToken(userId)
    const trainerMeta = {
        id: trainerId,
        name: String(trainer?.name || 'Trainer').trim() || 'Trainer',
        level: resolveTrainerAverageLevel(trainer),
        team: Array.isArray(trainer?.team) ? trainer.team : [],
    }

    const outcome = await runAutoTrainerBattleFlow({
        userId,
        token,
        trainerId,
        trainerMeta,
        attackIntervalMs,
        deadlineAt: effectiveDeadlineAt,
    })

    if (!outcome.ok && String(outcome.code || '').trim().toUpperCase() === 'TIME_BUDGET') {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
            lastAction: {
                action: 'tick',
                result: 'skipped',
                reason: 'TIME_BUDGET',
                targetId: trainerId,
                at: now,
            },
        })
        stats.skipped += 1
        stats.skippedReasons.TIME_BUDGET = (stats.skippedReasons.TIME_BUDGET || 0) + 1
        return
    }

    if (!outcome.ok && String(outcome.code || '').trim().toUpperCase() === 'REQUEST_TIMEOUT') {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
            },
            lastAction: {
                action: 'tick',
                result: 'skipped',
                reason: 'REQUEST_TIMEOUT',
                targetId: trainerId,
                at: now,
            },
        })
        stats.skipped += 1
        stats.skippedReasons.REQUEST_TIMEOUT = (stats.skippedReasons.REQUEST_TIMEOUT || 0) + 1
        return
    }

    if (!outcome.ok && String(outcome.code || '').trim().toUpperCase() === 'TRAINER_UNAVAILABLE') {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
                'autoTrainer.lastRuntimeAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'TRAINER_UNAVAILABLE',
                targetId: trainerId,
                at: now,
            },
            logMessage: 'Đã dừng auto battle trainer: trainer đã chọn không còn khả dụng.',
            logType: 'warn',
        })
        stats.skipped += 1
        stats.skippedReasons.TRAINER_UNAVAILABLE = (stats.skippedReasons.TRAINER_UNAVAILABLE || 0) + 1
        return
    }

    if (!outcome.ok) {
        const shouldDisable = shouldDisableOnFailureCode(outcome.code)
        const normalizedErrorCode = String(outcome.code || 'BATTLE_ERROR').trim().toUpperCase() || 'BATTLE_ERROR'
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                ...(shouldDisable ? {
                    'autoTrainer.enabled': false,
                    'autoTrainer.startedAt': null,
                    'autoTrainer.lastRuntimeAt': null,
                } : {}),
            },
            lastAction: {
                action: 'battle',
                result: 'error',
                reason: outcome.code || 'BATTLE_ERROR',
                targetId: trainerId,
                at: now,
            },
            logMessage: shouldDisable
                ? `Auto battle trainer dừng: ${formatTrainerOutcomeReasonForLog(outcome.reason || 'Không thể tiếp tục battle.')}`
                : `Auto battle trainer đang xử lý, sẽ tự thử lại: ${formatTrainerOutcomeReasonForLog(outcome.reason || 'Battle thất bại.')}`,
            logType: shouldDisable ? 'warn' : 'error',
        })
        stats.errors += 1
        stats.errorReasons[normalizedErrorCode] = (stats.errorReasons[normalizedErrorCode] || 0) + 1
        return
    }

    const nextDailyCount = dailyState.count + 1
    const reachedLimit = dailyState.limit > 0 && nextDailyCount >= dailyState.limit
    const successMessage = `Đã đánh bại huấn luyện viên ${trainerMeta.name} Lv ${trainerMeta.level}.`

    await updateAutoTrainerState({
        userId,
        setPatch: {
            'autoTrainer.enabled': reachedLimit ? false : true,
            'autoTrainer.trainerId': trainerId,
            'autoTrainer.attackIntervalMs': attackIntervalMs,
            'autoTrainer.startedAt': reachedLimit ? null : (autoState.startedAt || now),
            'autoTrainer.dayKey': dailyState.dayKey,
            'autoTrainer.dayCount': nextDailyCount,
            'autoTrainer.dayLimit': dailyState.limit,
            'autoTrainer.dayRuntimeMs': runtimeMsToday,
            'autoTrainer.lastRuntimeAt': reachedLimit ? null : now,
        },
        lastAction: {
            action: 'auto_run',
            result: 'success',
            reason: reachedLimit ? 'DAILY_LIMIT_REACHED' : '',
            targetId: trainerId,
            at: now,
        },
        logMessage: reachedLimit
            ? `${successMessage} Đã đạt giới hạn lượt hôm nay (${nextDailyCount}/${dailyState.limit}).`
            : successMessage,
        logType: 'success',
    })

    stats.success += 1
}

const fetchEligibleUsers = async () => {
    const baseFilter = {
        'autoTrainer.enabled': true,
        isBanned: { $ne: true },
        'vipBenefits.autoBattleTrainerEnabled': { $ne: false },
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
        .select('_id role vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean()

    if (users.length === 0 && lastCursorId) {
        lastCursorId = ''
        users = await User.find(baseFilter)
            .select('_id role vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
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
        if (!acquired) {
            return
        }

        try {
            const users = await fetchEligibleUsers()
            stats.fetched = users.length
            if (users.length === 0) return

            await runWithConcurrency(users, CONCURRENCY, async (user) => {
                try {
                    const deadlineAt = Date.now() + TIME_BUDGET_MS
                    await processUser(user, deadlineAt, stats)
                    if (POST_USER_COOLDOWN_MS > 0) {
                        await sleep(POST_USER_COOLDOWN_MS)
                    }
                } catch (error) {
                    const normalizedCode = String(error?.code || '').trim().toUpperCase()
                    if (normalizedCode === 'TIME_BUDGET' || normalizedCode === 'REQUEST_TIMEOUT') {
                        stats.skipped += 1
                        stats.skippedReasons[normalizedCode || 'TIME_BUDGET'] = (stats.skippedReasons[normalizedCode || 'TIME_BUDGET'] || 0) + 1
                        return
                    }

                    stats.errors += 1
                    stats.errorReasons.EXCEPTION = (stats.errorReasons.EXCEPTION || 0) + 1
                    console.error('[auto-trainer-worker] process user failed:', {
                        userId: String(user?._id || ''),
                        message: error?.message,
                    })
                }
            })
        } finally {
            await releaseDistributedLock()
        }
    } catch (error) {
        console.error('[auto-trainer-worker] tick failed:', error)
    } finally {
        localBusy = false
        const durationMs = Date.now() - startedAt

        if (trainerMetaCache.size > 5000) {
            const gcThresholdMs = Date.now() - (TRAINER_META_CACHE_TTL_MS * 2)
            for (const [trainerId, payload] of trainerMetaCache.entries()) {
                if (Number(payload?.cachedAtMs || 0) < gcThresholdMs) {
                    trainerMetaCache.delete(trainerId)
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
                `[auto-trainer-worker] tick done: fetched=${stats.fetched} success=${stats.success} skipped=${stats.skipped}${skippedReasonsText ? ` (${skippedReasonsText})` : ''} errors=${stats.errors}${errorReasonsText ? ` (${errorReasonsText})` : ''} durationMs=${durationMs}`
            )
        }
    }
}

export const startAutoTrainerWorker = ({ baseUrl }) => {
    apiBaseUrl = String(baseUrl || '').trim()
    if (!apiBaseUrl) {
        console.warn('[auto-trainer-worker] skip start: missing baseUrl')
        return
    }

    if (intervalRef) return
    intervalRef = setInterval(() => {
        runTick()
    }, TICK_INTERVAL_MS)
    setTimeout(() => {
        runTick()
    }, 1200)

    console.log(`[auto-trainer-worker] started (mode=resolve_only, tick=${TICK_INTERVAL_MS}ms, budget=${TIME_BUDGET_MS}ms, minUserBudget=${MIN_EFFECTIVE_USER_BUDGET_MS}ms, batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})`)
}

export const stopAutoTrainerWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
