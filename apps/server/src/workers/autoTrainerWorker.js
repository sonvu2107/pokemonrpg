import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import BattleTrainer from '../models/BattleTrainer.js'
import WorkerLock from '../models/WorkerLock.js'
import {
    hasVipAutoTrainerAccess,
    normalizeAutoTrainerState,
    normalizeId,
    normalizeSearchText,
    resolveDailyState,
    toSafeInt,
} from '../utils/autoTrainerUtils.js'

const WORKER_LOCK_KEY = 'auto-trainer:tick-lock'
const OWNER_ID = `auto-trainer-worker:${process.pid}:${crypto.randomBytes(5).toString('hex')}`

const TICK_INTERVAL_MS = toSafeInt(process.env.AUTO_TRAINER_TICK_MS, 7000, 3000, 60000)
const LOCK_TTL_MS = toSafeInt(process.env.AUTO_TRAINER_LOCK_TTL_MS, 25000, 5000, 300000)
const BATCH_SIZE = toSafeInt(process.env.AUTO_TRAINER_BATCH_SIZE, 100, 10, 500)
const CONCURRENCY = toSafeInt(process.env.AUTO_TRAINER_CONCURRENCY, 8, 1, 50)
const TIME_BUDGET_MS = toSafeInt(process.env.AUTO_TRAINER_TIME_BUDGET_MS, 18000, 1000, 120000)
const MAX_BATTLE_TURNS = toSafeInt(process.env.AUTO_TRAINER_MAX_BATTLE_TURNS, 260, 60, 1000)
const BETWEEN_BATTLE_DELAY_MS = 900
const AUTO_TRAINER_LOGS_LIMIT = 12

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
            'x-internal-worker': 'auto-trainer',
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
        throw error
    }

    return data
}

const resolveTrainerAverageLevel = (trainerLike = {}) => {
    const levels = (Array.isArray(trainerLike?.team) ? trainerLike.team : [])
        .map((entry) => Math.max(1, Number(entry?.level || 1)))
    if (levels.length === 0) return 1
    return Math.max(1, Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length))
}

const normalizePartyMoves = (moves = []) => {
    const list = Array.isArray(moves) ? moves : []
    const normalized = list
        .map((entry) => {
            if (typeof entry === 'string') {
                const name = String(entry || '').trim()
                if (!name) return null
                return { name, currentPp: 10, maxPp: 10 }
            }

            const name = String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null
            const maxPpRaw = Number(entry?.maxPp ?? entry?.pp)
            const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0 ? Math.floor(maxPpRaw) : 10
            const currentPpRaw = Number(entry?.currentPp ?? entry?.pp)
            const currentPp = Number.isFinite(currentPpRaw)
                ? Math.max(0, Math.min(maxPp, Math.floor(currentPpRaw)))
                : maxPp

            return {
                ...entry,
                name,
                currentPp,
                maxPp,
            }
        })
        .filter(Boolean)

    return normalized.length > 0
        ? normalized
        : [{ name: 'Struggle', currentPp: 99, maxPp: 99 }]
}

const pickPreferredMove = (moves = []) => {
    const pool = (Array.isArray(moves) ? moves : [])
        .filter((entry) => Number(entry?.currentPp) > 0)

    if (pool.length === 0) {
        return { name: 'Struggle', currentPp: 99, maxPp: 99 }
    }

    const offensiveMoves = pool
        .filter((entry) => {
            const category = String(entry?.category || '').trim().toLowerCase()
            const power = Number(entry?.power)
            return category !== 'status' && Number.isFinite(power) && power > 0
        })
        .sort((a, b) => {
            const powerDiff = (Number(b?.power) || 0) - (Number(a?.power) || 0)
            if (powerDiff !== 0) return powerDiff
            return (Number(b?.accuracy) || 100) - (Number(a?.accuracy) || 100)
        })

    if (offensiveMoves.length > 0) {
        return offensiveMoves[0]
    }

    return pool[0]
}

const isTrainerBattleFinished = (opponentState = {}) => {
    if (Boolean(opponentState?.defeatedAll)) return true

    const team = Array.isArray(opponentState?.team) ? opponentState.team : []
    if (team.length === 0) return false

    const currentIndex = Number(opponentState?.currentIndex)
    if (Number.isFinite(currentIndex) && currentIndex >= team.length) return true

    return team.every((entry) => Number(entry?.currentHp ?? entry?.maxHp ?? 0) <= 0)
}

const buildOpponentPayload = (opponentState = {}, fallback = null) => {
    const team = Array.isArray(opponentState?.team) ? opponentState.team : []
    const currentIndex = Number.isFinite(Number(opponentState?.currentIndex))
        ? Math.max(0, Math.floor(Number(opponentState.currentIndex)))
        : 0

    const activeTarget = team[currentIndex]
        || team.find((entry) => Number(entry?.currentHp ?? entry?.maxHp ?? 0) > 0)
        || fallback

    const maxHp = Math.max(1, Number(activeTarget?.maxHp || 1))
    const currentHpRaw = Number(activeTarget?.currentHp)
    const currentHp = Number.isFinite(currentHpRaw)
        ? Math.max(0, Math.min(maxHp, Math.floor(currentHpRaw)))
        : maxHp

    return {
        name: String(activeTarget?.name || 'Opponent').trim() || 'Opponent',
        level: Math.max(1, Number(activeTarget?.level || 1)),
        currentHp,
        maxHp,
        baseStats: activeTarget?.baseStats && typeof activeTarget.baseStats === 'object' ? activeTarget.baseStats : {},
        status: String(activeTarget?.status || '').trim(),
        statusTurns: Math.max(0, Number(activeTarget?.statusTurns || 0)),
        statStages: activeTarget?.statStages && typeof activeTarget.statStages === 'object' ? activeTarget.statStages : {},
        damageGuards: activeTarget?.damageGuards && typeof activeTarget.damageGuards === 'object' ? activeTarget.damageGuards : {},
        wasDamagedLastTurn: Boolean(activeTarget?.wasDamagedLastTurn),
        volatileState: activeTarget?.volatileState && typeof activeTarget.volatileState === 'object' ? activeTarget.volatileState : {},
        types: Array.isArray(activeTarget?.types) ? activeTarget.types : [],
    }
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

const runSingleBattle = async ({ token, trainerId, trainerMeta, attackIntervalMs, resetTrainerSession, deadlineAt }) => {
    const partyResponse = await callApi({ token, path: '/api/party' })
    const partyData = Array.isArray(partyResponse?.party) ? partyResponse.party : []

    const partyState = partyData
        .filter(Boolean)
        .map((slot) => {
            const maxHp = Math.max(1, Number(slot?.stats?.hp || 1))
            return {
                id: normalizeId(slot?._id),
                level: Math.max(1, Number(slot?.level || 1)),
                maxHp,
                currentHp: maxHp,
                baseStats: slot?.stats && typeof slot.stats === 'object'
                    ? slot.stats
                    : (slot?.pokemonId?.baseStats && typeof slot.pokemonId.baseStats === 'object' ? slot.pokemonId.baseStats : {}),
                moves: normalizePartyMoves(slot?.moves),
            }
        })

    if (partyState.length === 0) {
        return { ok: false, code: 'NO_PARTY', reason: 'Bạn cần có Pokemon trong đội hình để auto battle trainer.' }
    }

    const findNextAliveSlotIndex = (startIndex = -1) => {
        const total = partyState.length
        for (let step = 1; step <= total; step += 1) {
            const idx = (startIndex + step + total) % total
            if (Number(partyState[idx]?.currentHp || 0) > 0) return idx
        }
        return -1
    }

    let activeSlotIndex = findNextAliveSlotIndex(-1)
    if (activeSlotIndex === -1) {
        return { ok: false, code: 'NO_AVAILABLE_POKEMON', reason: 'Không có Pokemon nào còn HP để chiến đấu.' }
    }

    let shouldResetTrainerSession = Boolean(resetTrainerSession)
    let fieldState = {}
    let opponentPayload = {
        name: trainerMeta?.name || 'Trainer',
        level: Math.max(1, Number(trainerMeta?.level || 1)),
        currentHp: 1,
        maxHp: 1,
        baseStats: {},
        status: '',
        statusTurns: 0,
        statStages: {},
        damageGuards: {},
        wasDamagedLastTurn: false,
        volatileState: {},
        types: [],
    }

    for (let turn = 0; turn < MAX_BATTLE_TURNS; turn += 1) {
        if (Date.now() >= deadlineAt) {
            return { ok: false, code: 'TIME_BUDGET', reason: 'TIME_BUDGET' }
        }

        const activeSlot = partyState[activeSlotIndex]
        if (!activeSlot) {
            return { ok: false, code: 'NO_ACTIVE_SLOT', reason: 'Không tìm thấy Pokemon đang chiến đấu.' }
        }

        if (activeSlot.currentHp <= 0) {
            const switchedIndex = findNextAliveSlotIndex(activeSlotIndex)
            if (switchedIndex === -1) {
                return { ok: false, code: 'PLAYER_DEFEATED', reason: 'Pokemon của bạn đã bại trận.' }
            }
            activeSlotIndex = switchedIndex
            continue
        }

        const selectedMove = pickPreferredMove(activeSlot.moves)

        try {
            const attackResponse = await callApi({
                token,
                path: '/api/game/battle/attack',
                method: 'POST',
                body: {
                    moveName: selectedMove?.name,
                    move: selectedMove,
                    trainerId,
                    activePokemonId: activeSlot.id,
                    fieldState,
                    opponent: opponentPayload,
                    player: {
                        level: activeSlot.level,
                        currentHp: Math.max(0, Math.min(activeSlot.maxHp, Number(activeSlot.currentHp || 0))),
                        maxHp: activeSlot.maxHp,
                        baseStats: activeSlot.baseStats || {},
                        status: '',
                        statusTurns: 0,
                        statStages: {},
                        damageGuards: {},
                        wasDamagedLastTurn: false,
                        volatileState: {},
                    },
                    resetTrainerSession: shouldResetTrainerSession,
                },
            })

            shouldResetTrainerSession = false
            const battle = attackResponse?.battle || {}
            const battlePlayer = battle?.player || {}
            const battleOpponent = battle?.opponent || {}

            const nextPlayerMaxHp = Math.max(1, Number(battlePlayer?.maxHp || activeSlot.maxHp || 1))
            const nextPlayerCurrentHpRaw = Number(battlePlayer?.currentHp)
            const nextPlayerCurrentHp = Number.isFinite(nextPlayerCurrentHpRaw)
                ? Math.max(0, Math.min(nextPlayerMaxHp, Math.floor(nextPlayerCurrentHpRaw)))
                : activeSlot.currentHp

            activeSlot.maxHp = nextPlayerMaxHp
            activeSlot.currentHp = nextPlayerCurrentHp

            const movePpState = Array.isArray(battlePlayer?.movePpState) ? battlePlayer.movePpState : []
            if (movePpState.length > 0) {
                const ppMap = new Map(
                    movePpState.map((entry) => [
                        String(entry?.moveName || '').trim().toLowerCase(),
                        {
                            currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                            maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                        },
                    ])
                )

                activeSlot.moves = activeSlot.moves.map((entry) => {
                    const key = String(entry?.name || '').trim().toLowerCase()
                    const patch = ppMap.get(key)
                    return patch ? { ...entry, ...patch } : entry
                })
            }

            if (isTrainerBattleFinished(battleOpponent)) {
                return { ok: true, code: 'WIN' }
            }

            fieldState = battle?.fieldState && typeof battle.fieldState === 'object' ? battle.fieldState : fieldState
            opponentPayload = buildOpponentPayload(battleOpponent, opponentPayload)

            if (activeSlot.currentHp <= 0) {
                const switchedIndex = findNextAliveSlotIndex(activeSlotIndex)
                if (switchedIndex === -1) {
                    return { ok: false, code: 'PLAYER_DEFEATED', reason: 'Pokemon của bạn đã bại trận.' }
                }
                activeSlotIndex = switchedIndex
            }
        } catch (error) {
            const message = String(error?.message || '').trim()
            const normalized = normalizeSearchText(message)
            if (normalized.includes('doi hinh huan luyen vien da bi danh bai') || normalized.includes('nhan ket qua tran dau')) {
                return { ok: true, code: 'WIN' }
            }
            if (normalized.includes('pokemon cua ban da bai tran')) {
                return { ok: false, code: 'PLAYER_DEFEATED', reason: message || 'Pokemon của bạn đã bại trận.' }
            }
            if (normalized.includes('qua nhanh')) {
                await sleep(Math.max(500, attackIntervalMs))
                continue
            }
            return { ok: false, code: 'ATTACK_ERROR', reason: message || 'Battle thất bại.' }
        }

        await sleep(Math.max(450, attackIntervalMs))
    }

    return { ok: false, code: 'MAX_TURNS', reason: 'Quá số lượt tối đa khi auto battle trainer.' }
}

const runAutoTrainerBattleFlow = async ({ token, trainerId, trainerMeta, attackIntervalMs, deadlineAt }) => {
    const resumed = await runSingleBattle({
        token,
        trainerId,
        trainerMeta,
        attackIntervalMs,
        resetTrainerSession: false,
        deadlineAt,
    })

    let outcome = resumed
    if (!resumed.ok && resumed.code === 'PLAYER_DEFEATED') {
        outcome = await runSingleBattle({
            token,
            trainerId,
            trainerMeta,
            attackIntervalMs,
            resetTrainerSession: true,
            deadlineAt,
        })
    }

    if (!outcome.ok) {
        return outcome
    }

    try {
        await callApi({ token, path: '/api/game/battle/resolve', method: 'POST', body: { trainerId } })
    } catch (error) {
        const normalized = normalizeSearchText(error?.message || '')
        if (!normalized.includes('da duoc nhan') && !normalized.includes('phan thuong battle da duoc nhan')) {
            return {
                ok: false,
                code: 'RESOLVE_ERROR',
                reason: String(error?.message || 'Không thể nhận kết quả battle').trim(),
            }
        }
    }

    return { ok: true, code: 'SUCCESS' }
}

const shouldDisableOnFailureCode = (code = '') => {
    const normalized = String(code || '').trim().toUpperCase()
    return (
        normalized === 'NO_PARTY'
        || normalized === 'NO_AVAILABLE_POKEMON'
        || normalized === 'NO_ACTIVE_SLOT'
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

    const baseSyncPatch = {
        'autoTrainer.dayKey': dailyState.dayKey,
        'autoTrainer.dayCount': dailyState.count,
        'autoTrainer.dayLimit': dailyState.limit,
    }

    if (!hasVipAutoTrainerAccess(userDoc)) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
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

    if (durationLimitMinutes > 0) {
        const startedAtMs = autoState.startedAt ? new Date(autoState.startedAt).getTime() : Date.now()
        const elapsedMs = Date.now() - startedAtMs
        if (elapsedMs >= durationLimitMinutes * 60 * 1000) {
            await updateAutoTrainerState({
                userId,
                setPatch: {
                    ...baseSyncPatch,
                    'autoTrainer.enabled': false,
                    'autoTrainer.startedAt': null,
                },
                lastAction: {
                    action: 'duration',
                    result: 'skipped',
                    reason: 'DURATION_EXPIRED',
                    targetId: autoState.trainerId,
                    at: now,
                },
                logMessage: 'Đã hết thời gian dùng auto battle trainer theo gói VIP.',
                logType: 'warn',
            })
            stats.skipped += 1
            return
        }
    }

    const trainerId = normalizeId(autoState.trainerId)
    if (!trainerId) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
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

    const completedTrainerSet = new Set(
        (Array.isArray(userDoc?.completedBattleTrainers) ? userDoc.completedBattleTrainers : [])
            .map((entry) => normalizeId(entry))
            .filter(Boolean)
    )
    if (!completedTrainerSet.has(trainerId)) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
            },
            lastAction: {
                action: 'eligibility',
                result: 'skipped',
                reason: 'TRAINER_NOT_COMPLETED',
                targetId: trainerId,
                at: now,
            },
            logMessage: 'Đã dừng auto battle trainer: trainer đã chọn chưa được hoàn thành.',
            logType: 'warn',
        })
        stats.skipped += 1
        return
    }

    const trainer = await BattleTrainer.findOne({ _id: trainerId, isActive: true })
        .select('_id name team.level')
        .lean()
    if (!trainer) {
        await updateAutoTrainerState({
            userId,
            setPatch: {
                ...baseSyncPatch,
                'autoTrainer.enabled': false,
                'autoTrainer.startedAt': null,
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

    if (Date.now() >= deadlineAt) {
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
    }

    const attackIntervalMs = Math.max(450, toSafeInt(autoState.attackIntervalMs, 700))
    const outcome = await runAutoTrainerBattleFlow({
        token,
        trainerId,
        trainerMeta,
        attackIntervalMs,
        deadlineAt,
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
                ? `Auto battle trainer dừng: ${outcome.reason || 'Không thể tiếp tục battle.'}`
                : `Auto battle trainer lỗi tạm thời: ${outcome.reason || 'Battle thất bại.'}`,
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
        if (!acquired) {
            return
        }

        try {
            const users = await fetchEligibleUsers()
            stats.fetched = users.length
            if (users.length === 0) return

            const deadlineAt = Date.now() + TIME_BUDGET_MS
            await runWithConcurrency(users, CONCURRENCY, async (user) => {
                try {
                    await processUser(user, deadlineAt, stats)
                    await sleep(BETWEEN_BATTLE_DELAY_MS)
                } catch (error) {
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

    console.log(`[auto-trainer-worker] started (tick=${TICK_INTERVAL_MS}ms, batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})`)
}

export const stopAutoTrainerWorker = () => {
    if (!intervalRef) return
    clearInterval(intervalRef)
    intervalRef = null
}
