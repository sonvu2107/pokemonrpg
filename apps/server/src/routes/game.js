import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { createActionGuard } from '../middleware/actionGuard.js'
import PlayerState from '../models/PlayerState.js'
import { emitPlayerState, getIO } from '../socket/index.js'
import Encounter from '../models/Encounter.js'
import User from '../models/User.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import MapProgress from '../models/MapProgress.js'
import MapModel from '../models/Map.js'
import BattleTrainer from '../models/BattleTrainer.js'
import BattleSession from '../models/BattleSession.js'
import DailyActivity from '../models/DailyActivity.js'
import Pokemon from '../models/Pokemon.js'

const router = express.Router()

import {
    EXP_PER_SEARCH,
    expToNext,
    calcStatsForLevel,
    calcMaxHp,
    getRarityExpMultiplier,
} from '../utils/gameUtils.js'
import { getOrderedMapsCached } from '../utils/orderedMapsCache.js'
import { getPokemonDropRatesCached, getItemDropRatesCached } from '../utils/dropRateCache.js'
import { applyEffectSpecs } from '../battle/effects/effectRegistry.js'
import {
    inferMoveType,
    normalizePokemonTypes,
    normalizeTypeToken,
    resolveEffectivenessText,
    resolveTypeEffectiveness,
} from '../battle/typeSystem.js'
import { calcBattleDamage, estimateBattleDamage } from '../battle/battleCalc.js'
import {
    applyPercentBonus,
    applyPercentMultiplier,
    isImmuneToWeatherChip,
    rollDamage,
} from '../battle/battleRuntimeUtils.js'
import {
    createEmptyEffectAggregate,
    effectSpecsByTrigger,
    isMovePpStateEqual,
    mergeEffectAggregate,
    mergeEffectStatePatches,
    mergeMovePpStateEntries,
    normalizeEffectSpecs,
} from '../battle/effectAggregate.js'
import {
    applyAbsoluteStatStages,
    applyDamageGuardsToDamage,
    applyStatStageToValue,
    applyStatusPatch,
    calcResidualStatusDamage,
    clampFraction,
    combineStatStageDeltas,
    decrementDamageGuards,
    decrementFieldState,
    decrementVolatileTurnState,
    filterNegativeStatStageDeltas,
    mergeDamageGuards,
    mergeFieldState,
    mergeVolatileState,
    normalizeBattleStatus,
    normalizeDamageGuards,
    normalizeFieldState,
    normalizeStatStages,
    normalizeStatusTurns,
    normalizeVolatileState,
    resolveActionAvailabilityByStatus,
    resolveBattleTurnOrder,
} from '../battle/battleState.js'
import {
    applyCounterMovePpConsumption,
    normalizeCounterMoveEntry,
    resolveCounterMoveSelection,
} from '../battle/counterMoveAI.js'
import {
    resolveMoveAccuracy,
    resolveMoveCategory,
    resolveMoveCriticalChance,
    resolveMovePriority,
} from '../battle/moveHelpers.js'
import {
    AUTO_SEARCH_RARITY_KEYS,
    hasVipAutoTrainerAccess,
    hasVipAutoSearchAccess,
    isEventMapLike,
    normalizeAutoSearchActionByRarity,
    normalizeAutoSearchState,
    normalizeAutoTrainerState,
    normalizeAutoCatchFormMode,
    normalizeId as normalizeAutoTrainerId,
    resolveDailyState as resolveAutoSearchDailyState,
    resolveDailyState as resolveAutoTrainerDailyState,
    toSafeInt as toSafeAutoTrainerInt,
    getMaxCatchAttempts,
} from '../utils/autoTrainerUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { mergeKnownMovesWithFallback } from '../utils/movePpUtils.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'
import { loadBattleBadgeBonusStateForUser } from '../utils/badgeUtils.js'
import {
    buildTrainerBattleTeam,
    getOrCreateTrainerBattleSession,
    getTrainerBattleSessionExpiryDate as getBattleSessionExpiryDate,
} from '../services/trainerBattleSessionService.js'
import { applyTrainerPenaltyTurn } from '../services/trainerPenaltyTurnService.js'
import {
    getAliveOpponentIndex,
    getSpecialAttackStat,
    getSpecialDefenseStat,
    normalizeTrainerPokemonDamagePercent,
    serializeTrainerBattleState,
} from '../services/trainerBattleStateService.js'
import {
    buildAutoSearchStatusPayload,
    buildAutoTrainerStatusPayload,
} from '../services/autoStatusService.js'
import {
    resolveEffectiveVipBonusBenefits,
    resolveEffectiveVipVisualBenefits,
} from '../services/vipBenefitService.js'
import {
    calcCatchChance,
    calcLowHpCatchBonusPercent,
    calcWildRewardPlatinumCoins,
    formatWildPlayerBattleState,
    resolveMapRarityCatchBonusPercent,
    resolvePokemonForm,
    resolvePokemonImageForForm,
    resolveWildPlayerBattleSnapshot,
    serializePlayerWallet,
} from '../services/wildEncounterService.js'
import {
    buildProgressIndex,
    buildUnlockRequirement,
    distributeExpByDefeats,
    ensureMapUnlocked,
    ensureTrainerCompletionTracked,
    formatMapProgress,
    normalizeLevelExpState,
    resolveNextMapInTrack,
    resolveSourceMapForUnlock,
    toDailyDateKey,
    trackDailyActivity,
    unlockMapsInBulk,
    updateMapProgress,
    updatePlayerLevel,
} from '../services/mapProgressionService.js'
import { hasOwnedPokemonForm } from '../services/userPokemonOwnershipService.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const canViewVipMap = (mapLike = {}, currentVipLevel = 0, isAdmin = false) => {
    if (isAdmin) return true
    const requiredVipLevel = Math.max(0, Number(mapLike?.vipVisibilityLevel) || 0)
    return requiredVipLevel === 0 || currentVipLevel === requiredVipLevel
}

const buildVisibleMapsResponse = async ({ userId, isAdmin = false, currentVipLevel = 0, eventOnly = false } = {}) => {
    const orderedMaps = await getOrderedMaps({ forceRefresh: eventOnly })
    const filteredMaps = eventOnly
        ? orderedMaps.filter((map) => Boolean(map?.isEventMap))
        : orderedMaps
    const mapIds = filteredMaps.map((map) => map._id)
    const playerLevelState = await PlayerState.findOne({ userId })
        .select('level')
        .lean()
    const currentPlayerLevel = Math.max(1, Number(playerLevelState?.level) || 1)
    const progresses = await MapProgress.find({ userId, mapId: { $in: mapIds } })
        .select('mapId totalSearches isUnlocked')
        .lean()
    const progressById = buildProgressIndex(progresses)

    const mapsWithUnlockState = filteredMaps.map((map, index) => {
        const unlockRequirement = buildUnlockRequirement(filteredMaps, index, progressById, currentPlayerLevel, currentVipLevel)
        const isUnlocked = isAdmin || (
            unlockRequirement.remainingSearches === 0
            && unlockRequirement.remainingPlayerLevels === 0
            && unlockRequirement.remainingVipLevels === 0
        )
        return { map, unlockRequirement, isUnlocked }
    })

    if (!isAdmin) {
        const mapIdsToUnlock = mapsWithUnlockState
            .filter(({ map, isUnlocked }) => {
                if (!isUnlocked) return false
                const existing = progressById.get(map._id.toString())
                return !existing || !existing.isUnlocked
            })
            .map(({ map }) => map._id)

        const unlockedProgressById = await unlockMapsInBulk(userId, mapIdsToUnlock)
        unlockedProgressById.forEach((progress, key) => {
            progressById.set(key, progress)
        })
    }

    return mapsWithUnlockState
        .filter(({ map }) => canViewVipMap(map, currentVipLevel, isAdmin))
        .map(({ map, unlockRequirement, isUnlocked }) => {
            const progress = progressById.get(map._id.toString())
            return {
                ...map,
                isUnlocked,
                unlockRequirement,
                progress: {
                    totalSearches: progress?.totalSearches || 0,
                },
            }
        })
}

const buildEffectiveBattleStats = ({
    baseStats = {},
    statStages = {},
    badgeBonusState = null,
} = {}) => {
    const normalizedBaseHp = Math.max(1, Math.floor(Number(baseStats?.hp) || 1))
    const normalizedBaseAtk = Math.max(1, Math.floor(Number(baseStats?.atk) || 1))
    const normalizedBaseDef = Math.max(1, Math.floor(Number(baseStats?.def) || 1))
    const normalizedBaseSpAtk = Math.max(1, Math.floor(Number(baseStats?.spatk) || 1))
    const normalizedBaseSpDef = Math.max(1, Math.floor(Number(baseStats?.spdef) || Number(baseStats?.spldef) || 1))
    const normalizedBaseSpd = Math.max(1, Math.floor(Number(baseStats?.spd) || 1))
    const normalizedStages = normalizeStatStages(statStages)
    const normalizedBadgeBonuses = badgeBonusState && typeof badgeBonusState === 'object'
        ? badgeBonusState
        : { hpBonusPercent: 0, speedBonusPercent: 0 }

    return {
        hp: Math.max(1, applyPercentBonus(normalizedBaseHp, normalizedBadgeBonuses?.hpBonusPercent || 0)),
        atk: applyStatStageToValue(normalizedBaseAtk, normalizedStages?.atk),
        def: applyStatStageToValue(normalizedBaseDef, normalizedStages?.def),
        spatk: applyStatStageToValue(normalizedBaseSpAtk, normalizedStages?.spatk),
        spdef: applyStatStageToValue(normalizedBaseSpDef, normalizedStages?.spdef),
        spd: applyStatStageToValue(
            Math.max(1, Math.floor(applyPercentMultiplier(normalizedBaseSpd, normalizedBadgeBonuses?.speedBonusPercent || 0))),
            normalizedStages?.spd
        ),
    }
}

const WILD_POKEMON_EXP_SCALE = 0.8
const DEFAULT_TRAINER_PRIZE_LEVEL = 5
const USER_POKEMON_MAX_LEVEL = 2000
const WILD_COUNTER_MOVE = {
    name: 'Tackle',
    type: 'normal',
    category: 'physical',
    power: 40,
    accuracy: 95,
    criticalChance: 0.0625,
}

const searchActionGuard = createActionGuard({
    actionKey: 'game:search',
    cooldownMs: 300,
    message: 'Tìm kiếm quá nhanh. Vui lòng đợi một chút.',
})

const encounterAttackActionGuard = createActionGuard({
    actionKey: 'game:encounter-attack',
    cooldownMs: 250,
    message: 'Tấn công quá nhanh. Vui lòng đợi một chút.',
})

const battleAttackActionGuard = createActionGuard({
    actionKey: 'game:battle-attack',
    cooldownMs: 200,
    message: 'Ra đòn quá nhanh. Vui lòng đợi một chút.',
})

const AUTO_TRAINER_LOGS_LIMIT = 12
const AUTO_SEARCH_LOGS_LIMIT = 12

const normalizeMoveName = (value) => String(value || '').trim().toLowerCase()

const isVersionConflictError = (error) => {
    if (!error) return false
    if (String(error?.name || '').trim() === 'VersionError') return true
    const message = String(error?.message || '').trim().toLowerCase()
    return message.includes('no matching document found for id')
}

const getOrderedMaps = getOrderedMapsCached

// GET /api/game/auto-search/status (protected)
router.get('/auto-search/status', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits autoSearch isBanned')
            .lean()

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const normalizedState = normalizeAutoSearchState(user.autoSearch)
        const dailyLimit = toSafeAutoTrainerInt(user?.vipBenefits?.autoSearchUsesPerDay, 0)
        const dailyState = resolveAutoSearchDailyState(normalizedState, dailyLimit)
        const runtimeMsToday = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0

        const shouldSyncState = (
            String(normalizedState.dayKey || '') !== dailyState.dayKey
            || Number(normalizedState.dayCount || 0) !== dailyState.count
            || Number(normalizedState.dayLimit || 0) !== dailyState.limit
            || Number(normalizedState.dayRuntimeMs || 0) !== runtimeMsToday
        )

        if (shouldSyncState) {
            await User.updateOne(
                { _id: req.user.userId },
                {
                    $set: {
                        'autoSearch.dayKey': dailyState.dayKey,
                        'autoSearch.dayCount': dailyState.count,
                        'autoSearch.dayLimit': dailyState.limit,
                        'autoSearch.dayRuntimeMs': runtimeMsToday,
                        'autoSearch.lastRuntimeAt': runtimeMsToday > 0 ? normalizedState.lastRuntimeAt : null,
                    },
                }
            )
        }

        const payload = await buildAutoSearchStatusPayload({
            ...user,
            autoSearch: {
                ...(user.autoSearch || {}),
                dayKey: dailyState.dayKey,
                dayCount: dailyState.count,
                dayLimit: dailyState.limit,
                dayRuntimeMs: runtimeMsToday,
            },
        })

        return res.json({ ok: true, autoSearch: payload })
    } catch (error) {
        return next(error)
    }
})

// POST /api/game/auto-search/settings (protected)
router.post('/auto-search/settings', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits autoSearch isBanned')

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const incomingEnabled = req.body?.enabled
        const shouldUpdateEnabled = incomingEnabled === true || incomingEnabled === false
        const hasMapSlugPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'mapSlug')
        const requestedMapSlug = String(req.body?.mapSlug || '').trim().toLowerCase()
        const requestedIntervalRaw = Number(req.body?.searchIntervalMs)
        const hasIntervalPatch = Number.isFinite(requestedIntervalRaw)
        const hasActionPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'actionByRarity')
        const hasCatchFormPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'catchFormMode')
        const hasCatchBallPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'catchBallItemId')

        const normalizedState = normalizeAutoSearchState(user.autoSearch)
        const canUseVipAutoSearch = hasVipAutoSearchAccess(user)
        const dailyLimit = toSafeAutoTrainerInt(user?.vipBenefits?.autoSearchUsesPerDay, 0)
        const durationLimitMinutes = toSafeAutoTrainerInt(user?.vipBenefits?.autoSearchDurationMinutes, 0)
        const dailyState = resolveAutoSearchDailyState(normalizedState, dailyLimit)
        const currentDayRuntimeMs = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0
        const currentDayRuntimeMinutes = Math.floor(currentDayRuntimeMs / 60000)

        const nextEnabled = shouldUpdateEnabled
            ? Boolean(incomingEnabled)
            : Boolean(normalizedState.enabled)
        const nextMapSlug = hasMapSlugPatch
            ? requestedMapSlug
            : String(normalizedState.mapSlug || '').trim().toLowerCase()
        const nextIntervalMs = hasIntervalPatch
            ? Math.max(900, Math.min(10000, Math.floor(requestedIntervalRaw)))
            : Math.max(900, toSafeAutoTrainerInt(normalizedState.searchIntervalMs, 1200))
        const nextActionByRarity = hasActionPatch
            ? normalizeAutoSearchActionByRarity(req.body?.actionByRarity)
            : normalizeAutoSearchActionByRarity(normalizedState.actionByRarity)
        const nextCatchFormMode = hasCatchFormPatch
            ? normalizeAutoCatchFormMode(req.body?.catchFormMode)
            : normalizeAutoCatchFormMode(normalizedState.catchFormMode)
        const nextCatchBallItemId = hasCatchBallPatch
            ? normalizeAutoTrainerId(req.body?.catchBallItemId)
            : normalizeAutoTrainerId(normalizedState.catchBallItemId)

        if (nextEnabled && !canUseVipAutoSearch) {
            return res.status(403).json({
                ok: false,
                message: 'Tài khoản hiện không có quyền lợi VIP để bật tự tìm kiếm.',
            })
        }

        if (nextEnabled && !nextMapSlug) {
            return res.status(400).json({ ok: false, message: 'Cần chọn bản đồ khi bật tự tìm kiếm.' })
        }

        let resolvedMap = null
        if (nextMapSlug) {
            resolvedMap = await MapModel.findOne({ slug: nextMapSlug })
                .select('_id slug name isEventMap autoSearchRequiredVipLevel')
                .lean()
            if (!resolvedMap && nextEnabled) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ đã chọn cho tự tìm kiếm.' })
            }
        }

        if (nextEnabled && resolvedMap && isEventMapLike(resolvedMap)) {
            return res.status(400).json({ ok: false, message: 'Bản đồ sự kiện không hỗ trợ tự tìm kiếm.' })
        }

        const currentVipLevel = Math.max(0, Number(user?.vipTierLevel) || 0)
        const autoSearchRequiredVipLevel = Math.max(0, Number(resolvedMap?.autoSearchRequiredVipLevel) || 0)
        if (nextEnabled && resolvedMap && currentVipLevel < autoSearchRequiredVipLevel) {
            return res.status(403).json({
                ok: false,
                message: `Map này yêu cầu VIP ${autoSearchRequiredVipLevel} để bật tự tìm kiếm.`,
            })
        }

        const isCatchConfigured = AUTO_SEARCH_RARITY_KEYS.some(
            (rarityKey) => String(nextActionByRarity?.[rarityKey] || '').trim().toLowerCase() === 'catch'
        )
        if (nextEnabled && isCatchConfigured && !nextCatchBallItemId) {
            return res.status(400).json({ ok: false, message: 'Có thiết lập tự bắt nhưng chưa chọn bóng.' })
        }

        if (nextEnabled && dailyLimit > 0 && dailyState.count >= dailyLimit) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết lượt tự tìm kiếm trong hôm nay (${dailyState.count}/${dailyLimit}).`,
            })
        }

        if (nextEnabled && durationLimitMinutes > 0 && currentDayRuntimeMinutes >= durationLimitMinutes) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết thời lượng tự tìm kiếm hôm nay (${currentDayRuntimeMinutes}/${durationLimitMinutes} phút).`,
            })
        }

        const now = new Date()
        const resolvedMapName = String(resolvedMap?.name || nextMapSlug || '').trim() || nextMapSlug
        const nextDayCount = dailyState.count
        const nextStartedAt = nextEnabled
            ? (normalizedState.startedAt || now)
            : null

        const updateDoc = {
            $set: {
                'autoSearch.enabled': nextEnabled,
                'autoSearch.mapSlug': nextMapSlug,
                'autoSearch.searchIntervalMs': nextIntervalMs,
                'autoSearch.actionByRarity': nextActionByRarity,
                'autoSearch.catchFormMode': nextCatchFormMode,
                'autoSearch.catchBallItemId': nextCatchBallItemId,
                'autoSearch.startedAt': nextStartedAt,
                'autoSearch.dayKey': dailyState.dayKey,
                'autoSearch.dayCount': nextDayCount,
                'autoSearch.dayLimit': dailyState.limit,
                'autoSearch.dayRuntimeMs': currentDayRuntimeMs,
                'autoSearch.lastRuntimeAt': nextEnabled ? now : null,
                'autoSearch.lastAction': {
                    action: 'toggle',
                    result: nextEnabled ? 'enabled' : 'disabled',
                    reason: '',
                    targetId: resolvedMapName,
                    at: now,
                },
            },
            $push: {
                'autoSearch.logs': {
                    $each: [{
                        message: nextEnabled
                            ? `Đã bật tự tìm kiếm tại ${resolvedMapName}.`
                            : 'Đã tắt tự tìm kiếm.',
                        type: nextEnabled ? 'success' : 'info',
                        at: now,
                    }],
                    $position: 0,
                    $slice: AUTO_SEARCH_LOGS_LIMIT,
                },
            },
        }

        await User.updateOne({ _id: req.user.userId }, updateDoc)
        const refreshedUser = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits autoSearch isBanned')
            .lean()
        const payload = await buildAutoSearchStatusPayload(refreshedUser || user.toObject())

        return res.json({ ok: true, autoSearch: payload })
    } catch (error) {
        return next(error)
    }
})

// GET /api/game/auto-trainer/status (protected)
router.get('/auto-trainer/status', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
            .lean()

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const normalizedState = normalizeAutoTrainerState(user.autoTrainer)
        const dailyLimit = toSafeAutoTrainerInt(user?.vipBenefits?.autoBattleTrainerUsesPerDay, 0)
        const dailyState = resolveAutoTrainerDailyState(normalizedState, dailyLimit)
        const runtimeMsToday = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0

        const shouldSyncState = (
            String(normalizedState.dayKey || '') !== dailyState.dayKey
            || Number(normalizedState.dayCount || 0) !== dailyState.count
            || Number(normalizedState.dayLimit || 0) !== dailyState.limit
            || Number(normalizedState.dayRuntimeMs || 0) !== runtimeMsToday
        )

        if (shouldSyncState) {
            await User.updateOne(
                { _id: req.user.userId },
                {
                    $set: {
                        'autoTrainer.dayKey': dailyState.dayKey,
                        'autoTrainer.dayCount': dailyState.count,
                        'autoTrainer.dayLimit': dailyState.limit,
                        'autoTrainer.dayRuntimeMs': runtimeMsToday,
                        'autoTrainer.lastRuntimeAt': runtimeMsToday > 0 ? normalizedState.lastRuntimeAt : null,
                    },
                }
            )
        }

        const payload = await buildAutoTrainerStatusPayload({
            ...user,
            autoTrainer: {
                ...(user.autoTrainer || {}),
                dayKey: dailyState.dayKey,
                dayCount: dailyState.count,
                dayLimit: dailyState.limit,
                dayRuntimeMs: runtimeMsToday,
            },
        })

        return res.json({ ok: true, autoTrainer: payload })
    } catch (error) {
        return next(error)
    }
})

// POST /api/game/auto-trainer/settings (protected)
router.post('/auto-trainer/settings', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const incomingEnabled = req.body?.enabled
        const shouldUpdateEnabled = incomingEnabled === true || incomingEnabled === false
        const requestedTrainerId = normalizeAutoTrainerId(req.body?.trainerId)
        const requestedClientInstanceId = normalizeAutoTrainerId(req.body?.clientInstanceId)
        const hasTrainerIdPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'trainerId')
        const requestedIntervalRaw = Number(req.body?.attackIntervalMs)
        const hasIntervalPatch = Number.isFinite(requestedIntervalRaw)
        const requestedInterval = hasIntervalPatch
            ? Math.max(450, Math.min(10000, Math.floor(requestedIntervalRaw)))
            : Math.max(450, toSafeAutoTrainerInt(user?.autoTrainer?.attackIntervalMs, 700))

        const normalizedState = normalizeAutoTrainerState(user.autoTrainer)
        const canUseVipAutoTrainer = hasVipAutoTrainerAccess(user)
        const dailyLimit = toSafeAutoTrainerInt(user?.vipBenefits?.autoBattleTrainerUsesPerDay, 0)
        const durationLimitMinutes = toSafeAutoTrainerInt(user?.vipBenefits?.autoBattleTrainerDurationMinutes, 0)
        const dailyState = resolveAutoTrainerDailyState(normalizedState, dailyLimit)
        const currentDayRuntimeMs = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0
        const currentDayRuntimeMinutes = Math.floor(currentDayRuntimeMs / 60000)

        const targetTrainerId = hasTrainerIdPatch
            ? requestedTrainerId
            : normalizeAutoTrainerId(normalizedState.trainerId)

        const nextEnabled = shouldUpdateEnabled
            ? Boolean(incomingEnabled)
            : Boolean(normalizedState.enabled)
        const storedClientInstanceId = normalizeAutoTrainerId(normalizedState.clientInstanceId)

        if (shouldUpdateEnabled && !nextEnabled) {
            console.warn('[auto-trainer-settings] disable request received:', {
                userId: req.user.userId,
                requestedTrainerId,
                targetTrainerId,
                requestedClientInstanceId,
                storedClientInstanceId,
                incomingEnabled,
                normalizedStateEnabled: Boolean(normalizedState.enabled),
                body: req.body,
                userAgent: req.get('user-agent') || '',
                referer: req.get('referer') || '',
                origin: req.get('origin') || '',
            })
        }

        if (shouldUpdateEnabled && !nextEnabled && storedClientInstanceId && requestedClientInstanceId !== storedClientInstanceId) {
            const payload = await buildAutoTrainerStatusPayload(user.toObject())
            return res.status(409).json({
                ok: false,
                message: 'Phiên auto battle đang được điều khiển từ thiết bị/tab khác.',
                autoTrainer: payload,
            })
        }

        if (nextEnabled && !canUseVipAutoTrainer) {
            return res.status(403).json({
                ok: false,
                message: 'Tài khoản hiện không có quyền lợi VIP để bật auto battle trainer.',
            })
        }

        if (nextEnabled && dailyLimit > 0 && dailyState.count >= dailyLimit) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết lượt auto battle trong hôm nay (${dailyState.count}/${dailyLimit}).`,
            })
        }

        if (nextEnabled && durationLimitMinutes > 0 && currentDayRuntimeMinutes >= durationLimitMinutes) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết thời lượng auto battle hôm nay (${currentDayRuntimeMinutes}/${durationLimitMinutes} phút).`,
            })
        }

        if (nextEnabled) {
            if (!targetTrainerId) {
                return res.status(400).json({ ok: false, message: 'Hãy chọn trainer đã pass để bật auto battle.' })
            }

            const trainerExists = await BattleTrainer.exists({
                _id: targetTrainerId,
                $or: [
                    { isActive: true },
                    { isActive: { $exists: false } },
                    { isActive: null },
                ],
            })
            if (!trainerExists) {
                return res.status(404).json({ ok: false, message: 'Trainer đã chọn không còn khả dụng.' })
            }

            const completedList = (Array.isArray(user.completedBattleTrainers) ? user.completedBattleTrainers : [])
                .map((entry) => normalizeAutoTrainerId(entry))
            const isCompletedTrainer = completedList.includes(targetTrainerId)
            if (!isCompletedTrainer) {
                console.warn('[auto-trainer-settings] auto-repair: adding trainer to completedBattleTrainers:', {
                    targetTrainerId,
                    completedCount: completedList.length,
                    userId: req.user.userId,
                })
                await ensureTrainerCompletionTracked(req.user.userId, targetTrainerId)
            }
        }

        const now = new Date()
        const updateDoc = {
            $set: {
                'autoTrainer.enabled': nextEnabled,
                'autoTrainer.trainerId': targetTrainerId,
                'autoTrainer.clientInstanceId': shouldUpdateEnabled
                    ? (nextEnabled ? requestedClientInstanceId : '')
                    : storedClientInstanceId,
                'autoTrainer.attackIntervalMs': requestedInterval,
                'autoTrainer.startedAt': nextEnabled ? (normalizedState.startedAt || now) : null,
                'autoTrainer.dayKey': dailyState.dayKey,
                'autoTrainer.dayCount': dailyState.count,
                'autoTrainer.dayLimit': dailyState.limit,
                'autoTrainer.dayRuntimeMs': currentDayRuntimeMs,
                'autoTrainer.lastRuntimeAt': nextEnabled ? now : null,
                'autoTrainer.lastAction': {
                    action: 'toggle',
                    result: nextEnabled ? 'enabled' : 'disabled',
                    reason: '',
                    targetId: targetTrainerId,
                    at: now,
                },
            },
            $push: {
                'autoTrainer.logs': {
                    $each: [{
                        message: nextEnabled
                            ? `Đã bật auto battle trainer với trainer ${targetTrainerId}.`
                            : 'Đã tắt auto battle trainer.',
                        type: nextEnabled ? 'success' : 'info',
                        at: now,
                    }],
                    $position: 0,
                    $slice: AUTO_TRAINER_LOGS_LIMIT,
                },
            },
        }

        await User.updateOne({ _id: req.user.userId }, updateDoc)
        const refreshedUser = await User.findById(req.user.userId)
            .select('role vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
            .lean()
        const payload = await buildAutoTrainerStatusPayload(refreshedUser || user.toObject())

        return res.json({ ok: true, autoTrainer: payload })
    } catch (error) {
        return next(error)
    }
})

// POST /api/game/click (protected)
router.post('/click', authMiddleware, (req, res) => {
    return res.status(410).json({
        ok: false,
        code: 'GAME_CLICK_DISABLED',
        message: 'Tính năng click đã bị vô hiệu hóa. Hãy dùng các hoạt động map/battle để kiếm tài nguyên.',
    })
})

// POST /api/game/search (protected)
router.post('/search', authMiddleware, searchActionGuard, async (req, res, next) => {
    try {
        const { mapSlug } = req.body
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)

        // 1. Validate Map
        const map = await MapModel.findOne({ slug: mapSlug })
        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const playerLevelState = await PlayerState.findOne({ userId })
            .select('level')
            .lean()
        const currentPlayerLevel = Math.max(1, Number(playerLevelState?.level) || 1)

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((m) => m._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ trong thứ tự tiến trình' })
        }

        if (!isAdmin) {
            let progressById = new Map()
            const sourceMap = resolveSourceMapForUnlock(orderedMaps, mapIndex)
            if (sourceMap?._id) {
                const sourceMapId = sourceMap._id
                const sourceProgress = await MapProgress.findOne({ userId, mapId: sourceMapId })
                    .select('mapId totalSearches')
                    .lean()
                progressById = buildProgressIndex(sourceProgress ? [sourceProgress] : [])
            }
            const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel, currentVipLevel)
            const isUnlocked = unlockRequirement.remainingSearches === 0
                && unlockRequirement.remainingPlayerLevels === 0
                && unlockRequirement.remainingVipLevels === 0
            if (!isUnlocked) {
                return res.status(403).json({
                    ok: false,
                    locked: true,
                    message: 'Bản đồ chưa mở khóa',
                    unlock: unlockRequirement,
                })
            }
        }

        const mapProgress = await updateMapProgress(userId, map._id)

        // Update player level based on search
        const { playerState, leveledUp, levelsGained } = await updatePlayerLevel(userId)

        await trackDailyActivity(userId, {
            searches: 1,
            mapExp: EXP_PER_SEARCH,
            mapSlug: map.slug,
            mapName: map.name,
        })

        if (!isAdmin) {
            const nextMap = resolveNextMapInTrack(orderedMaps, mapIndex)
            if (nextMap?._id) {
                const requiredToUnlockNext = Math.max(0, map.requiredSearches || 0)
                if (mapProgress.totalSearches >= requiredToUnlockNext) {
                    await ensureMapUnlocked(userId, nextMap._id)
                }
            }
        }

        const encounterRate = typeof map.encounterRate === 'number' ? map.encounterRate : 1

        const itemDropRate = typeof map.itemDropRate === 'number' ? map.itemDropRate : 0
        const shouldDropItem = itemDropRate > 0 && Math.random() < itemDropRate
        let droppedItem = null

        if (shouldDropItem) {
            const itemDropRates = await getItemDropRatesCached(map._id)
            const itemTotalWeight = itemDropRates.reduce((sum, dr) => sum + dr.weight, 0)
            let itemRandom = Math.random() * itemTotalWeight
            let selectedItemDrop = null

            for (const dr of itemDropRates) {
                if (itemRandom < dr.weight) {
                    selectedItemDrop = dr
                    break
                }
                itemRandom -= dr.weight
            }

            if (!selectedItemDrop && itemDropRates.length > 0) {
                selectedItemDrop = itemDropRates[itemDropRates.length - 1]
            }

            if (selectedItemDrop?.itemId) {
                const storedItem = selectedItemDrop.itemId
                droppedItem = {
                    _id: selectedItemDrop.itemId._id,
                    name: storedItem.name,
                    description: storedItem.description || '',
                    imageUrl: storedItem.imageUrl || '',
                }

                await UserInventory.findOneAndUpdate(
                    { userId, itemId: storedItem._id },
                    { $inc: { quantity: 1 } },
                    { upsert: true, new: true }
                )
            }
        }

        if (Math.random() > encounterRate) {
            return res.json({
                ok: true,
                encountered: false,
                message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'Không tìm thấy Pokemon nào.',
                mapProgress: formatMapProgress(mapProgress),
                itemDrop: droppedItem,
                playerLevel: {
                    level: playerState.level,
                    experience: playerState.experience,
                    expToNext: expToNext(playerState.level),
                    leveledUp,
                    levelsGained,
                },
            })
        }

        const specialPokemonConfigsFromMap = Array.isArray(map.specialPokemonConfigs)
            ? map.specialPokemonConfigs
                .map((entry) => {
                    const pokemonId = String(entry?.pokemonId || '').trim()
                    const formId = String(entry?.formId || '').trim().toLowerCase() || 'normal'
                    const weight = Number(entry?.weight)
                    return {
                        pokemonId,
                        formId,
                        weight: Number.isFinite(weight) && weight > 0 ? weight : 0,
                    }
                })
                .filter((entry) => entry.pokemonId && entry.weight > 0)
            : []

        const specialPokemonConfigs = specialPokemonConfigsFromMap.length > 0
            ? specialPokemonConfigsFromMap
            : (Array.isArray(map.specialPokemonIds)
                ? map.specialPokemonIds
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
                    .map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))
                : [])

        const specialPokemonEncounterRate = typeof map.specialPokemonEncounterRate === 'number'
            ? clamp(map.specialPokemonEncounterRate, 0, 1)
            : 0

        let selectedPokemonId = null
        let selectedFormId = null
        let encounteredFromSpecialPool = false

        if (specialPokemonConfigs.length > 0 && specialPokemonEncounterRate > 0 && Math.random() < specialPokemonEncounterRate) {
            const specialTotalWeight = specialPokemonConfigs.reduce((sum, entry) => sum + entry.weight, 0)
            let specialRandom = Math.random() * specialTotalWeight

            for (const entry of specialPokemonConfigs) {
                if (specialRandom < entry.weight) {
                    selectedPokemonId = entry.pokemonId
                    selectedFormId = entry.formId || 'normal'
                    break
                }
                specialRandom -= entry.weight
            }

            if (!selectedPokemonId) {
                selectedPokemonId = specialPokemonConfigs[specialPokemonConfigs.length - 1]?.pokemonId || null
                selectedFormId = specialPokemonConfigs[specialPokemonConfigs.length - 1]?.formId || 'normal'
            }

            encounteredFromSpecialPool = Boolean(selectedPokemonId)
        }

        if (!selectedPokemonId) {
            const dropRates = await getPokemonDropRatesCached(map._id)

            if (dropRates.length === 0) {
                return res.json({
                    ok: true,
                    encountered: false,
                    message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'No pokemon in this area.',
                    mapProgress: formatMapProgress(mapProgress),
                    itemDrop: droppedItem,
                    playerLevel: {
                        level: playerState.level,
                        experience: playerState.experience,
                        expToNext: expToNext(playerState.level),
                        leveledUp,
                        levelsGained,
                    },
                })
            }

            // 3. Weighted Random Logic
            const totalWeight = dropRates.reduce((sum, dr) => sum + dr.weight, 0)
            let random = Math.random() * totalWeight
            let selectedDrop = null

            for (const dr of dropRates) {
                if (random < dr.weight) {
                    selectedDrop = dr
                    break
                }
                random -= dr.weight
            }

            if (!selectedDrop) {
                // Fallback usually shouldn't happen if logic is correct
                selectedDrop = dropRates[dropRates.length - 1]
            }

            selectedPokemonId = selectedDrop?.pokemonId || null
            selectedFormId = selectedDrop?.formId || null
        }

        if (!selectedPokemonId) {
            return res.json({
                ok: true,
                encountered: false,
                message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'No pokemon in this area.',
                mapProgress: formatMapProgress(mapProgress),
                itemDrop: droppedItem,
                playerLevel: {
                    level: playerState.level,
                    experience: playerState.experience,
                    expToNext: expToNext(playerState.level),
                    leveledUp,
                    levelsGained,
                },
            })
        }

        // 4. Populate Pokemon Details for response
        const pokemon = await Pokemon.findById(selectedPokemonId)
            .select('name pokedexNumber sprites imageUrl types rarity baseStats catchRate forms defaultFormId')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        // End any previous active encounters for this user
        await Encounter.updateMany(
            { userId, isActive: true },
            { $set: { isActive: false, endedAt: new Date() } }
        )

        const { form: resolvedForm, formId } = resolvePokemonForm(pokemon, selectedFormId)
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const baseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: pokemon,
            formId,
            resolvedForm,
        })

        const level = Math.floor(Math.random() * (map.levelMax - map.levelMin + 1)) + map.levelMin
        const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
        const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)
        const hp = maxHp
        const playerBattleSnapshot = await resolveWildPlayerBattleSnapshot(userId)
        const isNewPokedexEntry = !(await hasOwnedPokemonForm(userId, pokemon._id, formId))

        const encounter = await Encounter.create({
            userId,
            mapId: map._id,
            pokemonId: pokemon._id,
            level,
            hp,
            maxHp,
            isShiny: false,
            formId,
            playerPokemonId: playerBattleSnapshot?.playerPokemonId || null,
            playerPokemonName: playerBattleSnapshot?.playerPokemonName || '',
            playerPokemonImageUrl: playerBattleSnapshot?.playerPokemonImageUrl || '',
            playerPokemonLevel: Math.max(1, Number(playerBattleSnapshot?.playerPokemonLevel) || 1),
            playerDefense: Math.max(1, Number(playerBattleSnapshot?.playerDefense) || 1),
            playerTypes: Array.isArray(playerBattleSnapshot?.playerTypes) ? playerBattleSnapshot.playerTypes : [],
            playerCurrentHp: Math.max(0, Number(playerBattleSnapshot?.playerCurrentHp) || 0),
            playerMaxHp: Math.max(0, Number(playerBattleSnapshot?.playerMaxHp) || 0),
        })

        // 5. Update Player State (consume energy? currently free)
        // For now, simple counter update or just return result

        // Return encounter result
        res.json({
            ok: true,
            encountered: true,
            fromSpecialPool: encounteredFromSpecialPool,
            encounterId: encounter._id,
            pokemon: {
                ...pokemon,
                formId,
                isNewPokedexEntry,
                stats: scaledStats,
                form: resolvedForm || null,
                resolvedSprites: formSprites || pokemon.sprites,
                resolvedImageUrl: formImageUrl || pokemon.imageUrl,
            },
            level,
            hp,
            maxHp,
            playerBattle: formatWildPlayerBattleState(encounter),
            itemDrop: droppedItem,
            mapProgress: formatMapProgress(mapProgress),
            playerLevel: {
                level: playerState.level,
                experience: playerState.experience,
                expToNext: expToNext(playerState.level),
                leveledUp,
                levelsGained,
            },
        })

    } catch (error) {
        next(error)
    }
})

// GET /api/game/maps (protected)
router.get('/maps', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const response = await buildVisibleMapsResponse({ userId, isAdmin, currentVipLevel })

        res.json({ ok: true, maps: response })
    } catch (error) {
        next(error)
    }
})

// GET /api/game/event-maps (protected)
router.get('/event-maps', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const maps = await buildVisibleMapsResponse({ userId, isAdmin, currentVipLevel, eventOnly: true })
        res.json({ ok: true, maps })
    } catch (error) {
        next(error)
    }
})

// GET /api/game/map/:slug/state (protected)
router.get('/map/:slug/state', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const playerState = await PlayerState.findOne({ userId })
            .select('gold moonPoints level')
            .lean()
        const currentPlayerLevel = Math.max(1, Number(playerState?.level) || 1)
        const playerCurrencyState = {
            ...serializePlayerWallet(playerState),
            level: currentPlayerLevel,
        }
        const map = await MapModel.findOne({ slug: req.params.slug })

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        if (!canViewVipMap(map, currentVipLevel, isAdmin)) {
            return res.status(403).json({
                ok: false,
                message: `Map này chỉ hiển thị cho đúng VIP ${Math.max(0, Number(map?.vipVisibilityLevel) || 0)}`,
            })
        }

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((m) => m._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ trong thứ tự tiến trình' })
        }

        const progresses = []
        const sourceMap = resolveSourceMapForUnlock(orderedMaps, mapIndex)
        if (sourceMap?._id) {
            const sourceMapId = sourceMap._id
            const sourceProgress = await MapProgress.findOne({ userId, mapId: sourceMapId })
                .select('mapId totalSearches')
                .lean()
            if (sourceProgress) {
                progresses.push(sourceProgress)
            }
        }
        const progressById = buildProgressIndex(progresses)
        const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel, currentVipLevel)
        const isUnlocked = isAdmin || (
            unlockRequirement.remainingSearches === 0
            && unlockRequirement.remainingPlayerLevels === 0
            && unlockRequirement.remainingVipLevels === 0
        )

        if (!isUnlocked) {
            return res.status(403).json({
                ok: false,
                locked: true,
                message: 'Bản đồ chưa mở khóa',
                unlock: unlockRequirement,
                playerState: playerCurrencyState,
            })
        }

        const progress = await ensureMapUnlocked(userId, map._id)

        let currentPlayerState = await PlayerState.findOne({ userId })
        if (!currentPlayerState) {
            currentPlayerState = await PlayerState.create({ userId })
        }

        res.json({
            ok: true,
            mapProgress: formatMapProgress(progress),
            playerState: {
                ...serializePlayerWallet(currentPlayerState),
                level: Math.max(1, Number(currentPlayerState.level) || 1),
            },
            unlock: {
                requiredSearches: Math.max(0, map.requiredSearches || 0),
                currentSearches: progress.totalSearches,
                remainingSearches: Math.max(0, (map.requiredSearches || 0) - progress.totalSearches),
                requiredPlayerLevel: unlockRequirement.requiredPlayerLevel,
                currentPlayerLevel,
                remainingPlayerLevels: Math.max(0, unlockRequirement.requiredPlayerLevel - currentPlayerLevel),
                requiredVipLevel: unlockRequirement.requiredVipLevel,
                currentVipLevel,
                remainingVipLevels: Math.max(0, unlockRequirement.requiredVipLevel - currentVipLevel),
                sourceMap: unlockRequirement.sourceMap,
            },
            isUnlocked: true,
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/encounter/:id/attack (protected)
router.post('/encounter/:id/attack', authMiddleware, encounterAttackActionGuard, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const encounter = await Encounter.findOne({ _id: req.params.id, userId, isActive: true })

        if (!encounter) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy cuộc chạm trán hoặc đã kết thúc' })
        }

        let playerBattleBefore = formatWildPlayerBattleState(encounter)
        if (!playerBattleBefore) {
            const fallbackPlayerBattle = await resolveWildPlayerBattleSnapshot(userId)
            if (!fallbackPlayerBattle) {
                return res.status(400).json({
                    ok: false,
                    message: 'Bạn cần có Pokemon trong đội hình để chiến đấu ở map.',
                })
            }

            encounter.playerPokemonId = fallbackPlayerBattle.playerPokemonId
            encounter.playerPokemonName = fallbackPlayerBattle.playerPokemonName
            encounter.playerPokemonImageUrl = fallbackPlayerBattle.playerPokemonImageUrl
            encounter.playerPokemonLevel = fallbackPlayerBattle.playerPokemonLevel
            encounter.playerDefense = fallbackPlayerBattle.playerDefense
            encounter.playerTypes = fallbackPlayerBattle.playerTypes
            encounter.playerCurrentHp = fallbackPlayerBattle.playerCurrentHp
            encounter.playerMaxHp = fallbackPlayerBattle.playerMaxHp
            playerBattleBefore = formatWildPlayerBattleState(encounter)
        }

        if (playerBattleBefore.currentHp <= 0) {
            encounter.isActive = false
            encounter.endedAt = new Date()
            await encounter.save()
            return res.status(400).json({
                ok: false,
                defeated: false,
                playerDefeated: true,
                message: 'Pokemon trong đội của bạn đã kiệt sức. Hãy rút lui và chuẩn bị lại đội hình.',
                playerBattle: formatWildPlayerBattleState(encounter),
            })
        }

        const badgeBonusState = await loadBattleBadgeBonusStateForUser(
            userId,
            Array.isArray(encounter.playerTypes) ? encounter.playerTypes : []
        )
        const damage = Math.max(1, Math.floor(applyPercentMultiplier(rollDamage(encounter.level), badgeBonusState?.damageBonusPercent || 0)))
        encounter.hp = Math.max(0, encounter.hp - damage)
        const defeatedWild = encounter.hp <= 0

        let reward = null
        let counterAttack = null
        let playerDefeated = false
        let playerState = null
        let wildPokemonReward = null

        if (defeatedWild) {
            encounter.isActive = false
            encounter.endedAt = new Date()
        } else {
            const wildPokemon = await Pokemon.findById(encounter.pokemonId)
                .select('name types rarity baseStats forms defaultFormId')
                .lean()

            const defenderTypes = Array.isArray(encounter.playerTypes) && encounter.playerTypes.length > 0
                ? encounter.playerTypes
                : ['normal']
            const defenderDefense = Math.max(1, Number(encounter.playerDefense) || (20 + playerBattleBefore.level * 2))

            let wildName = 'Pokemon hoang dã'
            let wildTypes = ['normal']
            let wildAttack = Math.max(1, 20 + encounter.level * 2)

            if (wildPokemon) {
                wildName = String(wildPokemon?.name || '').trim() || wildName
                const { form: wildForm } = resolvePokemonForm(wildPokemon, encounter.formId)
                const wildBaseStats = resolveEffectivePokemonBaseStats({
                    pokemonLike: wildPokemon,
                    formId: encounter.formId,
                    resolvedForm: wildForm,
                })
                const wildScaledStats = calcStatsForLevel(wildBaseStats, encounter.level, wildPokemon.rarity)
                wildAttack = Math.max(
                    1,
                    Number(wildScaledStats?.atk) ||
                    Number(wildScaledStats?.spatk) ||
                    (20 + encounter.level * 2)
                )
                wildTypes = normalizePokemonTypes(wildPokemon.types)
            }

            const didCounterMoveHit = (Math.random() * 100) <= WILD_COUNTER_MOVE.accuracy
            const counterEffectiveness = resolveTypeEffectiveness(WILD_COUNTER_MOVE.type, defenderTypes)
            const didCounterCritical = didCounterMoveHit && Math.random() < WILD_COUNTER_MOVE.criticalChance
            const counterModifier = (wildTypes.includes(WILD_COUNTER_MOVE.type) ? 1.5 : 1)
                * counterEffectiveness.multiplier
                * (didCounterCritical ? 1.5 : 1)
            const counterDamage = (!didCounterMoveHit || counterEffectiveness.multiplier <= 0)
                ? 0
                : calcBattleDamage({
                    attackerLevel: encounter.level,
                    movePower: WILD_COUNTER_MOVE.power,
                    attackStat: wildAttack,
                    defenseStat: defenderDefense,
                    modifier: counterModifier,
                })

            const nextPlayerHp = Math.max(0, playerBattleBefore.currentHp - counterDamage)
            encounter.playerCurrentHp = nextPlayerHp

            counterAttack = {
                damage: counterDamage,
                currentHp: nextPlayerHp,
                maxHp: playerBattleBefore.maxHp,
                defeatedPlayer: nextPlayerHp <= 0,
                hit: didCounterMoveHit,
                effectiveness: counterEffectiveness.multiplier,
                critical: didCounterCritical,
                move: {
                    name: WILD_COUNTER_MOVE.name,
                    type: WILD_COUNTER_MOVE.type,
                    category: WILD_COUNTER_MOVE.category,
                    accuracy: WILD_COUNTER_MOVE.accuracy,
                    power: WILD_COUNTER_MOVE.power,
                },
                log: !didCounterMoveHit
                    ? `${wildName} dùng ${WILD_COUNTER_MOVE.name} nhưng trượt.`
                    : `${wildName} dùng ${WILD_COUNTER_MOVE.name}! Gây ${counterDamage} sát thương. ${resolveEffectivenessText(counterEffectiveness.multiplier)}`.trim(),
            }

            if (nextPlayerHp <= 0) {
                playerDefeated = true
                encounter.isActive = false
                encounter.endedAt = new Date()
            }
        }

        await encounter.save()

        if (defeatedWild) {
            const date = toDailyDateKey()
            const dailyActivity = await DailyActivity.findOneAndUpdate(
                { userId, date },
                {
                    $setOnInsert: { userId, date },
                    $inc: { wildDefeats: 1 },
                },
                { new: true, upsert: true }
            )

            const wildDefeatsToday = Math.max(1, Math.floor(Number(dailyActivity?.wildDefeats) || 1))
            reward = calcWildRewardPlatinumCoins({
                level: encounter.level,
                wildDefeatsToday,
            })

            const currentUser = await User.findById(userId)
                .select('vipTierId vipTierLevel vipBenefits')
                .lean()
            const effectiveVipBonusBenefits = await resolveEffectiveVipBonusBenefits(currentUser)
            const baseRewardPlatinumCoins = Math.max(0, Number(reward?.platinumCoins || 0))
            reward.basePlatinumCoinsBeforeVip = baseRewardPlatinumCoins
            reward.platinumCoinBonusPercent = Math.max(0, Number(effectiveVipBonusBenefits?.platinumCoinBonusPercent || 0))
            reward.platinumCoins = applyPercentBonus(baseRewardPlatinumCoins, reward.platinumCoinBonusPercent)

            if (reward.platinumCoins > 0) {
                playerState = await PlayerState.findOneAndUpdate(
                    { userId },
                    {
                        $setOnInsert: { userId },
                        $inc: { gold: reward.platinumCoins },
                    },
                    { new: true, upsert: true }
                )

                emitPlayerState(String(userId), playerState)
                await trackDailyActivity(userId, { platinumCoins: reward.platinumCoins })
            }

            const leadPartyPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId, location: 'party' }))
                .sort({ partyIndex: 1, _id: 1 })
                .populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')

            if (leadPartyPokemon?.pokemonId) {
                const defeatedWildPokemon = await Pokemon.findById(encounter.pokemonId)
                    .select('rarity name')
                    .lean()
                const basePokemonExp = Math.max(6, Math.floor(Number(encounter.level || 1) * 4))
                const defeatedWildRarity = String(defeatedWildPokemon?.rarity || '').trim().toLowerCase()
                const expMultiplier = getRarityExpMultiplier(defeatedWildRarity)
                const expGained = Math.max(0, Math.floor(basePokemonExp * expMultiplier * WILD_POKEMON_EXP_SCALE))

                const expBefore = Math.max(0, Math.floor(Number(leadPartyPokemon.experience) || 0))
                let levelsGained = 0

                if (leadPartyPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                    leadPartyPokemon.level = USER_POKEMON_MAX_LEVEL
                    leadPartyPokemon.experience = 0
                } else if (expGained > 0) {
                    leadPartyPokemon.experience = expBefore + expGained
                    while (
                        leadPartyPokemon.level < USER_POKEMON_MAX_LEVEL
                        && leadPartyPokemon.experience >= expToNext(leadPartyPokemon.level)
                    ) {
                        leadPartyPokemon.experience -= expToNext(leadPartyPokemon.level)
                        leadPartyPokemon.level += 1
                        levelsGained += 1
                    }

                    if (leadPartyPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                        leadPartyPokemon.level = USER_POKEMON_MAX_LEVEL
                        leadPartyPokemon.experience = 0
                    }
                }

                await leadPartyPokemon.save()
                await leadPartyPokemon.populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')

                wildPokemonReward = {
                    userPokemonId: leadPartyPokemon._id,
                    name: leadPartyPokemon.nickname || leadPartyPokemon.pokemonId?.name || 'Pokemon',
                    imageUrl: resolvePokemonImageForForm(
                        leadPartyPokemon.pokemonId,
                        leadPartyPokemon.formId,
                        Boolean(leadPartyPokemon.isShiny)
                    ),
                    level: leadPartyPokemon.level,
                    exp: leadPartyPokemon.experience,
                    expBefore,
                    expGained,
                    expToNext: leadPartyPokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : expToNext(leadPartyPokemon.level),
                    levelsGained,
                    evolution: [],
                }

                if (expGained > 0 || levelsGained > 0) {
                    await trackDailyActivity(userId, {
                        levels: Math.max(0, levelsGained),
                        trainerExp: Math.max(0, expGained),
                    })
                }

                reward.pokemonExp = expGained
                reward.pokemonLevelsGained = levelsGained
                reward.pokemonName = wildPokemonReward.name
                reward.expMultiplierByWildRarity = expMultiplier
                reward.wildRarity = defeatedWildRarity || 'normal'
                reward.expScale = WILD_POKEMON_EXP_SCALE
            }

            reward.wildDefeatsToday = wildDefeatsToday
        }

        const finalPlayerState = playerState?.toObject ? playerState.toObject() : playerState
        const playerBattle = formatWildPlayerBattleState(encounter)
        const message = defeatedWild
            ? `Pokemon hoang dã đã bị hạ! +${Number(reward?.platinumCoins || 0).toLocaleString('vi-VN')} Xu Bạch Kim${Number(reward?.pokemonExp || 0) > 0 ? ` · +${Number(reward?.pokemonExp || 0).toLocaleString('vi-VN')} EXP cho ${reward?.pokemonName || 'Pokemon'}` : ''}`
            : (playerDefeated
                ? `Gây ${damage} sát thương! ${counterAttack?.log || ''} Bạn đã kiệt sức và phải rút lui.`.trim()
                : `Gây ${damage} sát thương! ${counterAttack?.log || ''}`.trim())

        res.json({
            ok: true,
            encounterId: encounter._id,
            damage,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            defeated: defeatedWild,
            playerDefeated,
            message,
            reward,
            pokemonReward: wildPokemonReward,
            counterAttack,
            playerBattle,
            playerState: finalPlayerState
                ? {
                    ...serializePlayerWallet(finalPlayerState),
                    level: Math.max(1, Number(finalPlayerState?.level) || 1),
                }
                : null,
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/encounter/:id/catch (protected)
router.post('/encounter/:id/catch', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const encounter = await Encounter.findOne({ _id: req.params.id, userId, isActive: true })
            .select('pokemonId mapId level hp maxHp isShiny formId catchAttempts')
            .lean()

        if (!encounter) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy cuộc chạm trán hoặc đã kết thúc' })
        }

        const pokemon = await Pokemon.findById(encounter.pokemonId)
            .select('name pokedexNumber baseStats catchRate levelUpMoves rarity imageUrl forms sprites defaultFormId')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const [currentUser, encounterMap] = await Promise.all([
            User.findById(userId)
                .select('username role vipTierId vipTierLevel vipBenefits')
                .lean(),
            encounter?.mapId
                ? MapModel.findById(encounter.mapId)
                    .select('name rarityCatchBonusPercent')
                    .lean()
                : Promise.resolve(null),
        ])
        const effectiveVipBonusBenefits = await resolveEffectiveVipBonusBenefits(currentUser)
        const effectiveVipVisualBenefits = await resolveEffectiveVipVisualBenefits(currentUser)
        const pokemonRarity = String(pokemon?.rarity || '').trim().toLowerCase()
        const mapRarityCatchBonusPercent = resolveMapRarityCatchBonusPercent({
            mapLike: encounterMap,
            rarity: pokemonRarity,
        })

        const baseChance = calcCatchChance({
            catchRate: pokemon.catchRate,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
        })
        const ssCatchBonusPercent = pokemonRarity === 'ss'
            ? Math.max(0, Number(effectiveVipBonusBenefits?.ssCatchRateBonusPercent || 0))
            : 0
        const totalRarityCatchBonusPercent = mapRarityCatchBonusPercent + ssCatchBonusPercent
        const chanceBeforeLowHpBonus = Math.min(0.95, baseChance * (1 + (totalRarityCatchBonusPercent / 100)))
        const lowHpCatchBonusPercent = calcLowHpCatchBonusPercent({
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            rarity: pokemonRarity,
        })
        const chance = Math.min(0.99, chanceBeforeLowHpBonus * (1 + (lowHpCatchBonusPercent / 100)))

        const caught = Math.random() < chance

        if (caught) {
            const resolvedEncounter = await Encounter.findOneAndUpdate(
                { _id: req.params.id, userId, isActive: true },
                { $set: { isActive: false, endedAt: new Date() } },
                { new: true }
            )

            if (!resolvedEncounter) {
                return res.status(409).json({ ok: false, message: 'Cuộc chạm trán đã được xử lý. Vui lòng tải lại.' })
            }

            const obtainedMapName = String(encounterMap?.name || '').trim()

            await UserPokemon.create({
                userId,
                pokemonId: encounter.pokemonId,
                level: encounter.level,
                experience: 0,
                moves: [],
                movePpState: [],
                formId: encounter.formId || 'normal',
                isShiny: encounter.isShiny,
                obtainedMapName,
                location: 'box',
            })

            const rarity = String(pokemon.rarity || '').trim().toLowerCase()
            const shouldEmitGlobalNotification = ['s', 'ss', 'sss', 'sss+'].includes(rarity)
            let globalNotificationPayload = null
            if (shouldEmitGlobalNotification) {
                try {
                    const username = String(currentUser?.username || '').trim() || 'Người chơi'
                    const rarityLabel = rarity ? rarity.toUpperCase() : 'UNKNOWN'
                    const notificationImage = resolvePokemonImageForForm(
                        pokemon,
                        encounter.formId || pokemon.defaultFormId || 'normal',
                        encounter.isShiny
                    )
                    const normalizedRole = String(currentUser?.role || '').trim().toLowerCase()
                    const isVip = normalizedRole === 'vip' || normalizedRole === 'admin'
                    globalNotificationPayload = {
                        notificationId: `${resolvedEncounter._id}-${Date.now()}`,
                        username,
                        pokemonName: pokemon.name,
                        rarity,
                        rarityLabel,
                        imageUrl: notificationImage,
                        isVip,
                        vipTitle: effectiveVipVisualBenefits.title,
                        vipTitleImageUrl: effectiveVipVisualBenefits.titleImageUrl,
                        message: `Người chơi ${username} vừa bắt được Pokemon ${rarityLabel} - ${pokemon.name}!`,
                    }
                    const io = getIO()

                    if (io) {
                        io.emit('globalNotification', globalNotificationPayload)
                    }
                } catch (notificationError) {
                    console.error('Không thể phát globalNotification:', notificationError)
                }
            }

            return res.json({
                ok: true,
                caught: true,
                encounterId: resolvedEncounter._id,
                hp: resolvedEncounter.hp,
                maxHp: resolvedEncounter.maxHp,
                catchChancePercent: Number((chance * 100).toFixed(2)),
                lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
                message: `Đã bắt được ${pokemon.name}!`,
                globalNotification: globalNotificationPayload,
            })
        }

        // Catch failed - increment catchAttempts and check if Pokemon should flee
        const maxAttempts = getMaxCatchAttempts(currentUser)
        const nextAttempts = Math.max(0, Number(encounter.catchAttempts || 0)) + 1

        await User.updateOne(
            { _id: userId },
            { $inc: { catchFailCount: 1 } }
        )

        if (nextAttempts >= maxAttempts) {
            // Pokemon flees after exceeding the attempt limit
            await Encounter.findOneAndUpdate(
                { _id: req.params.id, userId, isActive: true },
                { $set: { isActive: false, endedAt: new Date(), catchAttempts: nextAttempts } }
            )
            return res.json({
                ok: true,
                caught: false,
                fled: true,
                encounterId: encounter._id,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                catchChancePercent: Number((chance * 100).toFixed(2)),
                lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
                catchAttempts: nextAttempts,
                maxCatchAttempts: maxAttempts,
                message: `Pokemon đã thoát khỏi bóng và bỏ chạy! (Đã thử ${nextAttempts}/${maxAttempts} lần)`,
            })
        }

        // Still within attempt limit - save incremented attempt count
        await Encounter.findOneAndUpdate(
            { _id: req.params.id, userId, isActive: true },
            { $set: { catchAttempts: nextAttempts } }
        )

        const remainingAttempts = maxAttempts - nextAttempts
        res.json({
            ok: true,
            caught: false,
            fled: false,
            encounterId: encounter._id,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            catchChancePercent: Number((chance * 100).toFixed(2)),
            lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
            catchAttempts: nextAttempts,
            maxCatchAttempts: maxAttempts,
            remainingAttempts,
            message: `Pokemon đã thoát khỏi bóng! Còn ${remainingAttempts} lần thử.`,
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/encounter/:id/run (protected)
router.post('/encounter/:id/run', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const encounter = await Encounter.findOne({ _id: req.params.id, userId, isActive: true })

        if (!encounter) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy cuộc chạm trán hoặc đã kết thúc' })
        }

        encounter.isActive = false
        encounter.endedAt = new Date()
        await encounter.save()

        res.json({ ok: true, message: 'Bạn đã bỏ chạy.' })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/battle/attack (protected)
router.post('/battle/attack', authMiddleware, battleAttackActionGuard, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const {
            moveName = '',
            move = null,
            opponent = {},
            opponentMove = null,
            opponentMoves = [],
            opponentMoveMode = 'ordered',
            opponentMoveCursor = 0,
            player = {},
            fieldState = {},
            trainerId = null,
            activePokemonId = null,
            resetTrainerSession = false,
        } = req.body || {}

        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
            .select('pokemonId level experience moves movePpState nickname formId partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'name baseStats rarity forms defaultFormId types levelUpMoves')

        const activePokemon = normalizedActivePokemonId
            ? (party.find((entry) => String(entry?._id || '') === normalizedActivePokemonId) || null)
            : (party.find(Boolean) || null)
        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon đang hoạt động trong đội hình' })
        }

        const attackerLevel = Math.max(1, Number(activePokemon.level) || 1)
        const attackerSpecies = activePokemon?.pokemonId || {}
        const knownMoves = mergeKnownMovesWithFallback(activePokemon.moves)
        const normalizedKnownMoves = new Set(knownMoves.map((item) => normalizeMoveName(item)))

        let selectedMoveName = String(moveName || move?.name || knownMoves[0] || 'Struggle').trim()
        if (!selectedMoveName) selectedMoveName = 'Struggle'
        const requestedMoveName = selectedMoveName
        let moveFallbackReason = ''
        let moveFallbackFrom = ''

        const selectedMoveKey = normalizeMoveName(selectedMoveName)
        if (selectedMoveKey !== 'struggle' && !normalizedKnownMoves.has(selectedMoveKey)) {
            if (knownMoves.length > 0) {
                selectedMoveName = knownMoves[0]
            } else {
                moveFallbackReason = 'NO_KNOWN_MOVE'
                moveFallbackFrom = requestedMoveName
                selectedMoveName = 'Struggle'
            }
        }

        const Move = (await import('../models/Move.js')).default
        const moveDoc = await Move.findOne({ nameLower: normalizeMoveName(selectedMoveName) }).lean()

        let resolvedPower = Number(moveDoc?.power)
        if (!Number.isFinite(resolvedPower) || resolvedPower <= 0) {
            resolvedPower = Number(move?.power)
        }
        if (!Number.isFinite(resolvedPower) || resolvedPower <= 0) {
            resolvedPower = normalizeMoveName(selectedMoveName) === 'struggle' ? 35 : 50
        }
        resolvedPower = clamp(Math.floor(resolvedPower), 1, 250)

        let moveType = normalizeTypeToken(moveDoc?.type || move?.type || inferMoveType(selectedMoveName)) || 'normal'
        let moveCategory = resolveMoveCategory(moveDoc, move, resolvedPower)
        if (moveCategory === 'status') {
            resolvedPower = 0
        }
        let moveAccuracy = resolveMoveAccuracy(moveDoc, move)
        let movePriority = resolveMovePriority(moveDoc, move)
        const baseMovePriority = movePriority
        let moveCriticalChance = resolveMoveCriticalChance(moveDoc, move)
        const moveEffectSpecs = normalizeEffectSpecs(moveDoc?.effectSpecs?.length ? moveDoc.effectSpecs : move?.effectSpecs)
        const randomFn = () => Math.random()

        let selectMoveEffects = applyEffectSpecs({
            effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'on_select_move'),
            context: {
                random: randomFn,
                weather: normalizeFieldState(fieldState).weather || '',
                terrain: normalizeFieldState(fieldState).terrain || '',
            },
        })
        if (Number.isFinite(Number(selectMoveEffects?.statePatches?.self?.priorityDelta))) {
            movePriority = clamp(
                movePriority + Number(selectMoveEffects.statePatches.self.priorityDelta),
                -7,
                7
            )
        }
        let damageCalcEffects = createEmptyEffectAggregate()

        const isStruggleMove = normalizeMoveName(selectedMoveName) === 'struggle'
        let consumedMovePp = 0
        let selectedMoveCurrentPp = 0
        let selectedMoveMaxPp = 0
        let playerMovePpStatePayload = []

        if (!isStruggleMove) {
            const fallbackMaxPpRaw = Number(moveDoc?.pp)
            const payloadMaxPpRaw = Number(move?.maxPp)
            const maxPp = Number.isFinite(payloadMaxPpRaw) && payloadMaxPpRaw > 0
                ? Math.max(1, Math.floor(payloadMaxPpRaw))
                : (Number.isFinite(fallbackMaxPpRaw) && fallbackMaxPpRaw > 0
                    ? Math.max(1, Math.floor(fallbackMaxPpRaw))
                    : 10)

            const clientReportedPpRaw = Number(move?.currentPp ?? move?.pp)
            let currentPp = Number.isFinite(clientReportedPpRaw)
                ? Math.max(0, Math.min(maxPp, Math.floor(clientReportedPpRaw)))
                : maxPp

            if (currentPp <= 0) {
                moveFallbackReason = 'OUT_OF_PP'
                moveFallbackFrom = requestedMoveName
                selectedMoveName = 'Struggle'
                resolvedPower = 35
                moveType = 'normal'
                moveCategory = 'physical'
                moveAccuracy = 100
                movePriority = 0
                moveCriticalChance = 0.0625
            } else {
                selectedMoveMaxPp = maxPp
                selectedMoveCurrentPp = Math.max(0, currentPp - 1)
                playerMovePpStatePayload = [{
                    moveName: selectedMoveName,
                    currentPp: selectedMoveCurrentPp,
                    maxPp,
                }]
                consumedMovePp = 1
            }
        }

        const { form: attackerForm } = resolvePokemonForm(attackerSpecies, activePokemon?.formId)
        const attackerBaseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: attackerSpecies,
            formId: activePokemon?.formId,
            resolvedForm: attackerForm,
        })
        const attackerScaledStats = calcStatsForLevel(attackerBaseStats, attackerLevel, attackerSpecies.rarity)
        const attackerTypes = normalizePokemonTypes(attackerSpecies.types)
        const attackerAtk = Math.max(
            1,
            Number(attackerScaledStats?.atk) ||
            Number(attackerScaledStats?.spatk) ||
            (20 + attackerLevel * 2)
        )
        const attackerSpAtk = Math.max(
            1,
            getSpecialAttackStat(attackerScaledStats) ||
            Number(attackerScaledStats?.atk) ||
            (20 + attackerLevel * 2)
        )

        const badgeBonusState = await loadBattleBadgeBonusStateForUser(req.user.userId, attackerTypes)
        const playerMaxHp = Math.max(1, applyPercentBonus(calcMaxHp(attackerBaseStats?.hp, attackerLevel, attackerSpecies.rarity), badgeBonusState?.hpBonusPercent || 0))
        const parsedPlayerCurrentHp = Number(player.currentHp)
        let playerCurrentHp = clamp(
            Math.floor(Number.isFinite(parsedPlayerCurrentHp) ? parsedPlayerCurrentHp : playerMaxHp),
            0,
            playerMaxHp
        )
        const playerDef = Math.max(
            1,
            Number(attackerScaledStats?.def) ||
            Number(attackerScaledStats?.spdef) ||
            (20 + attackerLevel * 2)
        )
        const playerSpDef = Math.max(
            1,
            getSpecialDefenseStat(attackerScaledStats) ||
            Number(attackerScaledStats?.def) ||
            (20 + attackerLevel * 2)
        )
        const requestedPlayerCurrentHp = clamp(
            Math.floor(Number.isFinite(Number(player?.currentHp)) ? Number(player.currentHp) : playerMaxHp),
            0,
            playerMaxHp
        )
        const requestedPlayerStatus = normalizeBattleStatus(player?.status)
        const requestedPlayerStatusTurns = normalizeStatusTurns(player?.statusTurns)
        const requestedPlayerStatStages = normalizeStatStages(player?.statStages)
        const requestedPlayerDamageGuards = normalizeDamageGuards(player?.damageGuards)
        const requestedPlayerWasDamagedLastTurn = Boolean(player?.wasDamagedLastTurn)
        const requestedPlayerVolatileState = normalizeVolatileState(player?.volatileState)

        let targetName = String(opponent.name || 'Opponent Pokemon')
        let targetLevel = Math.max(1, Number(opponent.level) || 1)
        let targetTypes = normalizePokemonTypes(opponent.types)
        let targetMaxHp = Math.max(1, Number(opponent.maxHp) || 1)
        let targetCurrentHp = clamp(
            Math.floor(Number.isFinite(Number(opponent.currentHp)) ? Number(opponent.currentHp) : targetMaxHp),
            0,
            targetMaxHp
        )
        let targetAtk = Math.max(
            1,
            Number(opponent.baseStats?.atk) ||
            Number(opponent.baseStats?.spatk) ||
            (20 + targetLevel * 2)
        )
        let targetSpAtk = Math.max(
            1,
            getSpecialAttackStat(opponent.baseStats) ||
            Number(opponent.baseStats?.atk) ||
            (20 + targetLevel * 2)
        )
        let targetDef = Math.max(
            1,
            Number(opponent.baseStats?.def) ||
            getSpecialDefenseStat(opponent.baseStats) ||
            (20 + targetLevel * 2)
        )
        let targetSpDef = Math.max(
            1,
            getSpecialDefenseStat(opponent.baseStats) ||
            Number(opponent.baseStats?.def) ||
            (20 + targetLevel * 2)
        )

        let trainerSession = null
        let activeOpponentIndex = -1
        let activeTrainerOpponent = null
        let trainerPokemonDamagePercent = 100
        let trainerSessionDirty = false
        let playerStatus = ''
        let playerStatusTurns = 0
        let playerStatStages = {}
        let playerDamageGuards = {}
        let playerWasDamagedLastTurn = Boolean(player?.wasDamagedLastTurn)
        let playerVolatileState = normalizeVolatileState(player?.volatileState)
        let battleFieldState = normalizeFieldState(fieldState)
        let opponentStatus = normalizeBattleStatus(opponent?.status)
        let opponentStatusTurns = normalizeStatusTurns(opponent?.statusTurns)
        let opponentStatStages = normalizeStatStages(opponent?.statStages)
        let opponentDamageGuards = normalizeDamageGuards(opponent?.damageGuards)
        let opponentWasDamagedLastTurn = Boolean(opponent?.wasDamagedLastTurn)
        let opponentVolatileState = normalizeVolatileState(opponent?.volatileState)

        let hasCounterMoveList = Array.isArray(opponentMoves) && opponentMoves.length > 0
        const parsedOpponentMoveCursor = Number.isFinite(Number(opponentMoveCursor))
            ? Math.max(0, Math.floor(Number(opponentMoveCursor)))
            : 0
        let counterMoveSelection = hasCounterMoveList
            ? resolveCounterMoveSelection({
                moves: opponentMoves,
                mode: opponentMoveMode,
                cursor: parsedOpponentMoveCursor,
                defenderTypes: attackerTypes,
                attackerTypes: targetTypes,
                fieldState: battleFieldState,
                defenderCurrentHp: playerCurrentHp,
                defenderMaxHp: playerMaxHp,
                attackerCurrentHp: targetCurrentHp,
                attackerMaxHp: targetMaxHp,
                attackerLevel: targetLevel,
                attackerAttackStat: targetAtk,
                attackerSpecialAttackStat: targetSpAtk,
                defenderDefenseStat: playerDef,
                defenderSpecialDefenseStat: playerSpDef,
            })
            : {
                selectedMove: null,
                selectedIndex: -1,
                nextCursor: parsedOpponentMoveCursor,
                normalizedMoves: [],
            }
        let selectedCounterMoveInput = normalizeCounterMoveEntry(opponentMove)
        if (!selectedCounterMoveInput && hasCounterMoveList) {
            selectedCounterMoveInput = counterMoveSelection.selectedMove
        }
        let selectedCounterMoveIndex = hasCounterMoveList ? counterMoveSelection.selectedIndex : -1
        let nextCounterMoveCursor = parsedOpponentMoveCursor
        let counterMoveState = hasCounterMoveList ? counterMoveSelection.normalizedMoves : []
        let counterMovePpCost = 0
        let usingTrainerCounterMoves = false

        if (normalizedTrainerId) {
            const trainer = await BattleTrainer.findById(normalizedTrainerId)
                .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types levelUpMoves initialMoves')
                .lean()

            if (!trainer) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
            }

            selectedCounterMoveInput = null
            selectedCounterMoveIndex = -1
            nextCounterMoveCursor = 0
            counterMoveState = []
            hasCounterMoveList = false

            trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainer)

            if (Boolean(resetTrainerSession)) {
                trainerSession.team = buildTrainerBattleTeam(trainer)
                trainerSession.knockoutCounts = []
                trainerSession.currentIndex = 0
                trainerSession.playerPokemonId = activePokemon._id
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = playerMaxHp
                trainerSession.playerStatus = ''
                trainerSession.playerStatusTurns = 0
                trainerSession.playerStatStages = {}
                trainerSession.playerDamageGuards = {}
                trainerSession.playerWasDamagedLastTurn = false
                trainerSession.playerVolatileState = {}
                trainerSession.fieldState = {}
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }

            const activePokemonIdString = String(activePokemon._id)
            if (String(trainerSession.playerPokemonId || '') !== activePokemonIdString) {
                trainerSession.playerPokemonId = activePokemon._id
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = requestedPlayerCurrentHp
                trainerSession.playerStatus = requestedPlayerStatus
                trainerSession.playerStatusTurns = requestedPlayerStatusTurns
                trainerSession.playerStatStages = requestedPlayerStatStages
                trainerSession.playerDamageGuards = requestedPlayerDamageGuards
                trainerSession.playerWasDamagedLastTurn = requestedPlayerWasDamagedLastTurn
                trainerSession.playerVolatileState = requestedPlayerVolatileState
                trainerSessionDirty = true
            }

            const storedPlayerMaxHp = Math.max(1, Number(trainerSession.playerMaxHp) || playerMaxHp)
            const storedPlayerCurrentHpRaw = Number(trainerSession.playerCurrentHp)
            const storedPlayerCurrentHp = Number.isFinite(storedPlayerCurrentHpRaw)
                ? storedPlayerCurrentHpRaw
                : storedPlayerMaxHp
            let effectivePlayerCurrentHp = storedPlayerCurrentHp
            if (storedPlayerMaxHp !== playerMaxHp) {
                const currentRatio = Math.min(1, Math.max(0, storedPlayerCurrentHp / storedPlayerMaxHp))
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = clamp(Math.floor(playerMaxHp * currentRatio), 0, playerMaxHp)
                effectivePlayerCurrentHp = trainerSession.playerCurrentHp
                trainerSessionDirty = true
            }
            playerCurrentHp = clamp(
                Math.floor(effectivePlayerCurrentHp),
                0,
                playerMaxHp
            )

            activeOpponentIndex = getAliveOpponentIndex(trainerSession.team, trainerSession.currentIndex)
            trainerSession.currentIndex = activeOpponentIndex === -1 ? trainerSession.team.length : activeOpponentIndex
            if (activeOpponentIndex === -1) {
                return res.status(400).json({ ok: false, message: 'Đội hình huấn luyện viên đã bị đánh bại. Hãy nhận kết quả trận đấu ngay.' })
            }

            activeTrainerOpponent = trainerSession.team[activeOpponentIndex]
            activeTrainerOpponent.status = normalizeBattleStatus(activeTrainerOpponent.status)
            activeTrainerOpponent.statusTurns = normalizeStatusTurns(activeTrainerOpponent.statusTurns)
            activeTrainerOpponent.statStages = normalizeStatStages(activeTrainerOpponent.statStages)
            activeTrainerOpponent.damageGuards = normalizeDamageGuards(activeTrainerOpponent.damageGuards)
            activeTrainerOpponent.wasDamagedLastTurn = Boolean(activeTrainerOpponent.wasDamagedLastTurn)
            activeTrainerOpponent.volatileState = normalizeVolatileState(activeTrainerOpponent.volatileState)
            activeTrainerOpponent.counterMoves = (Array.isArray(activeTrainerOpponent.counterMoves)
                ? activeTrainerOpponent.counterMoves
                : [])
                .map((entry, index) => normalizeCounterMoveEntry({ ...(entry || {}), __index: index }, index))
                .filter(Boolean)
            activeTrainerOpponent.counterMoveCursor = Math.max(0, Number(activeTrainerOpponent.counterMoveCursor) || 0)
            activeTrainerOpponent.counterMoveMode = String(activeTrainerOpponent.counterMoveMode || 'smart-random').trim().toLowerCase() || 'smart-random'
            targetName = activeTrainerOpponent.name || targetName
            targetLevel = Math.max(1, Number(activeTrainerOpponent.level) || targetLevel)
            targetTypes = normalizePokemonTypes(activeTrainerOpponent.types)
            targetMaxHp = Math.max(1, Number(activeTrainerOpponent.maxHp) || targetMaxHp)
            const trainerTargetCurrentHpRaw = Number(activeTrainerOpponent.currentHp)
            const trainerTargetCurrentHp = Number.isFinite(trainerTargetCurrentHpRaw)
                ? trainerTargetCurrentHpRaw
                : targetMaxHp
            targetCurrentHp = clamp(Math.floor(trainerTargetCurrentHp), 0, targetMaxHp)
            targetAtk = Math.max(
                1,
                Number(activeTrainerOpponent.baseStats?.atk) ||
                Number(activeTrainerOpponent.baseStats?.spatk) ||
                (20 + targetLevel * 2)
            )
            targetSpAtk = Math.max(
                1,
                getSpecialAttackStat(activeTrainerOpponent.baseStats) ||
                Number(activeTrainerOpponent.baseStats?.atk) ||
                (20 + targetLevel * 2)
            )
            targetDef = Math.max(
                1,
                Number(activeTrainerOpponent.baseStats?.def) ||
                getSpecialDefenseStat(activeTrainerOpponent.baseStats) ||
                (20 + targetLevel * 2)
            )
            targetSpDef = Math.max(
                1,
                getSpecialDefenseStat(activeTrainerOpponent.baseStats) ||
                Number(activeTrainerOpponent.baseStats?.def) ||
                (20 + targetLevel * 2)
            )

            const trainerSlot = Math.max(0, Number(activeTrainerOpponent.slot) || activeOpponentIndex)
            const trainerTeamEntry = Array.isArray(trainer?.team)
                ? trainer.team[trainerSlot]
                : null
            trainerPokemonDamagePercent = normalizeTrainerPokemonDamagePercent(
                activeTrainerOpponent?.damagePercent ?? trainerTeamEntry?.damagePercent,
                100
            )
            activeTrainerOpponent.damagePercent = trainerPokemonDamagePercent
            const trainerSpecies = trainerTeamEntry?.pokemonId || null
            const trainerSpeciesTypes = normalizePokemonTypes(trainerSpecies?.types)
            if (targetTypes.length === 0 && trainerSpeciesTypes.length > 0) {
                targetTypes = trainerSpeciesTypes
                activeTrainerOpponent.types = trainerSpeciesTypes
            }
            const trainerFieldStateForSelection = normalizeFieldState(trainerSession.fieldState)
            const trainerMovePool = Array.isArray(trainerSpecies?.levelUpMoves) ? trainerSpecies.levelUpMoves : []
            const trainerLearnedEntries = trainerMovePool
                .filter((entry) => Number.isFinite(entry?.level) && entry.level <= targetLevel)
                .sort((a, b) => a.level - b.level)
            const trainerLastLearnedEntries = trainerLearnedEntries.slice(-4)
            const unresolvedTrainerMoveIds = []
            const trainerDirectMoveNames = trainerLastLearnedEntries.map((entry) => {
                const directName = String(entry?.moveName || entry?.moveId?.name || '').trim()
                if (directName) return directName
                const rawMoveId = entry?.moveId?._id || entry?.moveId
                const normalizedMoveId = String(rawMoveId || '').trim()
                if (normalizedMoveId) {
                    unresolvedTrainerMoveIds.push(normalizedMoveId)
                }
                return ''
            })

            const trainerMoveNameById = new Map()
            if (unresolvedTrainerMoveIds.length > 0) {
                const unresolvedMoveDocs = await Move.find({
                    _id: { $in: [...new Set(unresolvedTrainerMoveIds)] },
                })
                    .select('_id name')
                    .lean()
                unresolvedMoveDocs.forEach((doc) => {
                    const key = String(doc?._id || '').trim()
                    const moveName = String(doc?.name || '').trim()
                    if (!key || !moveName || trainerMoveNameById.has(key)) return
                    trainerMoveNameById.set(key, moveName)
                })
            }

            const uniqueTrainerMoves = []
            const trainerMoveKeys = new Set()
            const normalizedStoredCounterMoves = (Array.isArray(activeTrainerOpponent?.counterMoves)
                ? activeTrainerOpponent.counterMoves
                : [])
                .map((entry, index) => normalizeCounterMoveEntry({ ...(entry || {}), __index: index }, index))
                .filter(Boolean)
            const storedCounterMoveMap = new Map()
            normalizedStoredCounterMoves.forEach((entry) => {
                const key = normalizeMoveName(entry?.name)
                if (!key || storedCounterMoveMap.has(key)) return
                storedCounterMoveMap.set(key, entry)
            })
            const trainerMoveModeRaw = String(activeTrainerOpponent?.counterMoveMode || 'smart-random').trim().toLowerCase()
            const trainerMoveMode = (
                trainerMoveModeRaw === 'ordered'
                || trainerMoveModeRaw === 'smart'
                || trainerMoveModeRaw === 'smart-random'
                || trainerMoveModeRaw === 'smart_random'
                || trainerMoveModeRaw === 'smartrandom'
            )
                ? trainerMoveModeRaw
                : 'smart-random'
            const trainerMoveCursorRaw = Number(activeTrainerOpponent?.counterMoveCursor)
            const trainerMoveCursor = Number.isFinite(trainerMoveCursorRaw)
                ? Math.max(0, Math.floor(trainerMoveCursorRaw))
                : 0
            const trainerInitialMoves = (Array.isArray(trainerSpecies?.initialMoves) ? trainerSpecies.initialMoves : [])
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)

            const pushTrainerMoveName = (value = '') => {
                const moveName = String(value || '').trim()
                const moveKey = normalizeMoveName(moveName)
                if (!moveKey || trainerMoveKeys.has(moveKey)) return
                trainerMoveKeys.add(moveKey)
                uniqueTrainerMoves.push(moveName)
            }

            for (let index = 0; index < trainerLastLearnedEntries.length; index += 1) {
                const entry = trainerLastLearnedEntries[index]
                const directName = String(trainerDirectMoveNames[index] || '').trim()
                const fallbackMoveId = String(entry?.moveId?._id || entry?.moveId || '').trim()
                const resolvedName = directName || trainerMoveNameById.get(fallbackMoveId) || ''
                pushTrainerMoveName(resolvedName)
            }

            trainerInitialMoves.forEach((moveName) => pushTrainerMoveName(moveName))
            normalizedStoredCounterMoves.forEach((entry) => {
                const moveKey = normalizeMoveName(entry?.name)
                if (moveKey === 'counter strike' || moveKey === 'struggle') return
                pushTrainerMoveName(entry?.name)
            })

            const trainerMoveTypePool = trainerSpeciesTypes.length > 0 ? trainerSpeciesTypes : targetTypes
            if (uniqueTrainerMoves.length === 0 && trainerMoveTypePool.length > 0) {
                const emergencyMoveDocs = await Move.find({
                    type: { $in: trainerMoveTypePool },
                    category: { $in: ['physical', 'special'] },
                    isActive: true,
                    power: { $gt: 0 },
                    accuracy: { $gte: 70 },
                    pp: { $gte: 5 },
                })
                    .sort({ power: -1, accuracy: -1, priority: -1, _id: 1 })
                    .limit(4)
                    .select('name')
                    .lean()
                emergencyMoveDocs.forEach((doc) => pushTrainerMoveName(doc?.name))

                if (uniqueTrainerMoves.length < 4) {
                    const normalEmergencyDocs = await Move.find({
                        type: 'normal',
                        category: { $in: ['physical', 'special'] },
                        isActive: true,
                        power: { $gt: 0 },
                        accuracy: { $gte: 70 },
                        pp: { $gte: 5 },
                    })
                        .sort({ power: -1, accuracy: -1, priority: -1, _id: 1 })
                        .limit(4)
                        .select('name')
                        .lean()
                    normalEmergencyDocs.forEach((doc) => pushTrainerMoveName(doc?.name))
                }
            }

            if (uniqueTrainerMoves.length === 0) {
                pushTrainerMoveName('Tackle')
            }

            if (uniqueTrainerMoves.length > 0) {
                const trainerMoveDocs = await Move.find({
                    nameLower: { $in: uniqueTrainerMoves.map((entry) => normalizeMoveName(entry)) },
                })
                    .select('name nameLower type category power accuracy priority pp effectSpecs')
                    .lean()

                const trainerMoveLookup = new Map()
                trainerMoveDocs.forEach((doc) => {
                    const key = normalizeMoveName(doc?.nameLower || doc?.name)
                    if (!key || trainerMoveLookup.has(key)) return
                    trainerMoveLookup.set(key, doc)
                })

                const trainerCounterMoves = uniqueTrainerMoves
                    .map((moveName) => {
                        const moveKey = normalizeMoveName(moveName)
                        const moveDocEntry = trainerMoveLookup.get(moveKey)
                        const storedCounterMove = storedCounterMoveMap.get(moveKey)
                        const moveEffectSpecs = normalizeEffectSpecs(moveDocEntry?.effectSpecs)
                        const moveDamageCalcEffects = applyEffectSpecs({
                            effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'on_calculate_damage'),
                            context: {
                                random: randomFn,
                                weather: trainerFieldStateForSelection.weather || '',
                                terrain: trainerFieldStateForSelection.terrain || '',
                            },
                        })
                        const requiresTerrain = Boolean(moveDamageCalcEffects?.statePatches?.self?.requireTerrain)

                        const maxPp = Math.max(1, Number(moveDocEntry?.pp) || Number(storedCounterMove?.maxPp) || 10)
                        const storedCurrentPpRaw = Number(storedCounterMove?.currentPp)
                        const currentPp = Number.isFinite(storedCurrentPpRaw)
                            ? clamp(Math.floor(storedCurrentPpRaw), 0, maxPp)
                            : maxPp
                        const resolvedPower = Number(moveDocEntry?.power)

                        return {
                            name: String(moveDocEntry?.name || moveName).trim(),
                            type: normalizeTypeToken(moveDocEntry?.type || inferMoveType(moveName)) || (targetTypes[0] || 'normal'),
                            category: resolveMoveCategory(moveDocEntry, null, resolvedPower),
                            power: Number.isFinite(resolvedPower) && resolvedPower > 0
                                ? Math.max(1, Math.floor(resolvedPower))
                                : 0,
                            accuracy: resolveMoveAccuracy(moveDocEntry, null),
                            priority: resolveMovePriority(moveDocEntry, null),
                            currentPp,
                            maxPp,
                            requiresTerrain,
                        }
                    })
                    .filter(Boolean)

                if (trainerCounterMoves.length > 0) {
                    const trainerMoveSelection = resolveCounterMoveSelection({
                        moves: trainerCounterMoves,
                        mode: trainerMoveMode,
                        cursor: trainerMoveCursor,
                        defenderTypes: attackerTypes,
                        attackerTypes: targetTypes,
                        fieldState: trainerFieldStateForSelection,
                        defenderCurrentHp: playerCurrentHp,
                        defenderMaxHp: playerMaxHp,
                        attackerCurrentHp: targetCurrentHp,
                        attackerMaxHp: targetMaxHp,
                        attackerLevel: targetLevel,
                        attackerAttackStat: targetAtk,
                        attackerSpecialAttackStat: targetSpAtk,
                        defenderDefenseStat: playerDef,
                        defenderSpecialDefenseStat: playerSpDef,
                    })

                    if (trainerMoveSelection?.selectedMove) {
                        selectedCounterMoveInput = trainerMoveSelection.selectedMove
                    }

                    usingTrainerCounterMoves = true
                    hasCounterMoveList = false
                    selectedCounterMoveIndex = trainerMoveSelection.selectedIndex
                    nextCounterMoveCursor = trainerMoveSelection.nextCursor
                    counterMoveState = trainerMoveSelection.normalizedMoves
                    activeTrainerOpponent.counterMoveMode = trainerMoveMode
                    activeTrainerOpponent.counterMoveCursor = trainerMoveCursor
                    activeTrainerOpponent.counterMoves = trainerMoveSelection.normalizedMoves
                } else {
                    activeTrainerOpponent.counterMoveMode = trainerMoveMode
                    activeTrainerOpponent.counterMoveCursor = 0
                    activeTrainerOpponent.counterMoves = []
                }
            } else {
                activeTrainerOpponent.counterMoveMode = trainerMoveMode
                activeTrainerOpponent.counterMoveCursor = 0
                activeTrainerOpponent.counterMoves = []
            }

            if (playerCurrentHp <= 0) {
                return res.status(400).json({ ok: false, message: 'Pokemon của bạn đã bại trận. Hãy đổi Pokemon hoặc bắt đầu lại trận đấu.' })
            }

            playerStatus = normalizeBattleStatus(trainerSession.playerStatus)
            playerStatusTurns = normalizeStatusTurns(trainerSession.playerStatusTurns)
            playerStatStages = normalizeStatStages(trainerSession.playerStatStages)
            playerDamageGuards = normalizeDamageGuards(trainerSession.playerDamageGuards)
            playerWasDamagedLastTurn = Boolean(trainerSession.playerWasDamagedLastTurn)
            playerVolatileState = normalizeVolatileState(trainerSession.playerVolatileState)
            battleFieldState = normalizeFieldState(trainerSession.fieldState)
            opponentStatus = normalizeBattleStatus(activeTrainerOpponent.status)
            opponentStatusTurns = normalizeStatusTurns(activeTrainerOpponent.statusTurns)
            opponentStatStages = normalizeStatStages(activeTrainerOpponent.statStages)
            opponentDamageGuards = normalizeDamageGuards(activeTrainerOpponent.damageGuards)
            opponentWasDamagedLastTurn = Boolean(activeTrainerOpponent.wasDamagedLastTurn)
            opponentVolatileState = normalizeVolatileState(activeTrainerOpponent.volatileState)
        }

        if (!normalizedTrainerId) {
            playerStatus = normalizeBattleStatus(player?.status)
            playerStatusTurns = normalizeStatusTurns(player?.statusTurns)
            playerStatStages = normalizeStatStages(player?.statStages)
            playerDamageGuards = normalizeDamageGuards(player?.damageGuards)
            playerVolatileState = normalizeVolatileState(player?.volatileState)
        }

        selectMoveEffects = applyEffectSpecs({
            effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'on_select_move'),
            context: {
                random: randomFn,
                weather: battleFieldState.weather || '',
                terrain: battleFieldState.terrain || '',
            },
        })
        movePriority = baseMovePriority
        if (Number.isFinite(Number(selectMoveEffects?.statePatches?.self?.priorityDelta))) {
            movePriority = clamp(
                movePriority + Number(selectMoveEffects.statePatches.self.priorityDelta),
                -7,
                7
            )
        }

        const battleExtraLogs = []
        const defaultOpponentMovePower = clamp(Math.floor(35 + targetLevel * 1.2), 25, 120)
        let selectedOpponentMove = selectedCounterMoveInput
        let selectedOpponentMoveName = String(selectedOpponentMove?.name || '').trim()
        let selectedOpponentMoveKey = normalizeMoveName(selectedOpponentMoveName)
        let opponentMoveDoc = null

        if (selectedOpponentMoveKey && selectedOpponentMoveKey !== 'struggle') {
            opponentMoveDoc = await Move.findOne({ nameLower: selectedOpponentMoveKey }).lean()
        }

        if (!selectedOpponentMoveName) {
            selectedOpponentMoveName = normalizedTrainerId ? 'Struggle' : 'Counter Strike'
            selectedOpponentMoveKey = normalizeMoveName(selectedOpponentMoveName)
        }

        let opponentMovePower = Number(opponentMoveDoc?.power)
        if (!Number.isFinite(opponentMovePower) || opponentMovePower <= 0) {
            opponentMovePower = Number(selectedOpponentMove?.power)
        }
        if (!Number.isFinite(opponentMovePower) || opponentMovePower <= 0) {
            opponentMovePower = selectedOpponentMoveKey === 'struggle' ? 35 : defaultOpponentMovePower
        }
        opponentMovePower = clamp(Math.floor(opponentMovePower), 1, 250)

        let opponentMoveType = normalizeTypeToken(opponentMoveDoc?.type || selectedOpponentMove?.type || inferMoveType(selectedOpponentMoveName)) || (targetTypes[0] || 'normal')
        if (normalizeStatusTurns(battleFieldState?.normalMovesBecomeElectricTurns) > 0 && opponentMoveType === 'normal') {
            opponentMoveType = 'electric'
        }

        let opponentMoveCategory = resolveMoveCategory(opponentMoveDoc, selectedOpponentMove, opponentMovePower)
        if (opponentMoveCategory === 'status') {
            opponentMovePower = 0
        }

        let opponentMoveAccuracy = resolveMoveAccuracy(opponentMoveDoc, selectedOpponentMove)
        let opponentMovePriority = resolveMovePriority(opponentMoveDoc, selectedOpponentMove)
        let opponentMoveCriticalChance = resolveMoveCriticalChance(opponentMoveDoc, selectedOpponentMove)

        const selectedOpponentCurrentPp = Number(selectedOpponentMove?.currentPp ?? selectedOpponentMove?.pp)
        if (selectedOpponentMoveKey && selectedOpponentMoveKey !== 'struggle' && Number.isFinite(selectedOpponentCurrentPp) && selectedOpponentCurrentPp <= 0) {
            selectedOpponentMove = {
                name: 'Struggle',
                type: 'normal',
                power: 35,
                category: 'physical',
                accuracy: 100,
                priority: 0,
            }
            selectedOpponentMoveName = 'Struggle'
            selectedOpponentMoveKey = 'struggle'
            opponentMovePower = 35
            opponentMoveType = 'normal'
            opponentMoveCategory = 'physical'
            opponentMoveAccuracy = 100
            opponentMovePriority = 0
            opponentMoveCriticalChance = 0.0625
            selectedCounterMoveIndex = -1
        }

        const playerEffectiveSpeed = applyStatStageToValue(
            Math.max(1, Math.floor(applyPercentMultiplier(Number(attackerScaledStats?.spd) || 1, badgeBonusState?.speedBonusPercent || 0))),
            playerStatStages?.spd
        )
        const opponentEffectiveSpeed = applyStatStageToValue(
            Math.max(1, Number(activeTrainerOpponent?.baseStats?.spd) || Number(opponent?.baseStats?.spd) || 1),
            opponentStatStages?.spd
        )

        const turnOrder = resolveBattleTurnOrder({
            playerPriority: movePriority,
            opponentPriority: opponentMovePriority,
            playerSpeed: playerEffectiveSpeed,
            opponentSpeed: opponentEffectiveSpeed,
            random: randomFn,
        })
        const playerActsFirst = turnOrder.playerActsFirst
        const turnOrderReason = turnOrder.reason
        const battleTurnOrder = playerActsFirst ? 'player-first' : 'opponent-first'
        const playerTurnStartHp = playerCurrentHp
        const opponentTurnStartHp = targetCurrentHp
        let counterAttack = null
        let resultingPlayerHp = playerCurrentHp

        const executeOpponentTurn = (currentOpponentHp = targetCurrentHp) => {
            if (currentOpponentHp <= 0 || playerCurrentHp <= 0) {
                resultingPlayerHp = playerCurrentHp
                return
            }

            const opponentTurnStatusCheck = resolveActionAvailabilityByStatus({
                status: opponentStatus,
                statusTurns: opponentStatusTurns,
                random: randomFn,
            })
            opponentStatus = normalizeBattleStatus(opponentTurnStatusCheck.statusAfterCheck)
            opponentStatusTurns = normalizeStatusTurns(opponentTurnStatusCheck.statusTurnsAfterCheck)
            let canOpponentActByVolatile = true
            const opponentRechargeTurns = normalizeStatusTurns(opponentVolatileState?.rechargeTurns)
            if (opponentRechargeTurns > 0) {
                canOpponentActByVolatile = false
                opponentVolatileState = {
                    ...opponentVolatileState,
                    rechargeTurns: Math.max(0, opponentRechargeTurns - 1),
                }
                if (!opponentVolatileState.rechargeTurns) {
                    delete opponentVolatileState.rechargeTurns
                }
                battleExtraLogs.push(`${targetName} cần hồi sức nên không thể hành động.`)
            }
            const opponentStatusMoveBlockTurns = normalizeStatusTurns(opponentVolatileState?.statusMoveBlockTurns)
            if (opponentStatusMoveBlockTurns > 0) {
                opponentVolatileState = {
                    ...opponentVolatileState,
                    statusMoveBlockTurns: Math.max(0, opponentStatusMoveBlockTurns - 1),
                }
                if (!opponentVolatileState.statusMoveBlockTurns) {
                    delete opponentVolatileState.statusMoveBlockTurns
                }
            }
            const canOpponentAct = Boolean(opponentTurnStatusCheck.canAct) && canOpponentActByVolatile
            if (opponentTurnStatusCheck.log) {
                battleExtraLogs.push(`${targetName}: ${opponentTurnStatusCheck.log}`)
            }

            const didOpponentMoveHit = canOpponentAct && (Math.random() * 100) <= opponentMoveAccuracy
            const opponentTypeEffectiveness = resolveTypeEffectiveness(opponentMoveType, attackerTypes)
            const opponentStabMultiplier = targetTypes.includes(opponentMoveType) ? 1.5 : 1
            const playerCritBlockTurns = normalizeStatusTurns(playerVolatileState?.critBlockTurns)
            const didOpponentCritical = canOpponentAct
                && didOpponentMoveHit
                && playerCritBlockTurns <= 0
                && Math.random() < opponentMoveCriticalChance
            if (canOpponentAct && didOpponentMoveHit && playerCritBlockTurns > 0) {
                battleExtraLogs.push('Pokemon của bạn được bảo vệ khỏi đòn chí mạng.')
            }
            const opponentCriticalMultiplier = didOpponentCritical ? 1.5 : 1
            const opponentAttackStage = opponentMoveCategory === 'special' ? opponentStatStages?.spatk : opponentStatStages?.atk
            const playerDefenseStage = opponentMoveCategory === 'special' ? playerStatStages?.spdef : playerStatStages?.def
            const opponentAttackStat = applyStatStageToValue(
                opponentMoveCategory === 'special' ? targetSpAtk : targetAtk,
                opponentAttackStage
            )
            const opponentDefenseStat = applyStatStageToValue(
                opponentMoveCategory === 'special' ? playerSpDef : playerDef,
                playerDefenseStage
            )
            const rawCounterDamage = (!canOpponentAct || !didOpponentMoveHit || opponentMoveCategory === 'status' || opponentTypeEffectiveness.multiplier <= 0)
                ? 0
                : calcBattleDamage({
                    attackerLevel: targetLevel,
                    movePower: opponentMovePower,
                    attackStat: opponentAttackStat,
                    defenseStat: opponentDefenseStat,
                    modifier: opponentStabMultiplier * opponentTypeEffectiveness.multiplier * opponentCriticalMultiplier,
                })
            const scaledCounterDamage = rawCounterDamage > 0
                ? Math.max(0, Math.floor(rawCounterDamage * (trainerPokemonDamagePercent / 100)))
                : 0
            const normalizedCounterDamage = rawCounterDamage > 0 && trainerPokemonDamagePercent > 0
                ? Math.max(1, scaledCounterDamage)
                : scaledCounterDamage
            const counterDamage = applyDamageGuardsToDamage(normalizedCounterDamage, opponentMoveCategory, playerDamageGuards)
            if (counterDamage < normalizedCounterDamage) {
                battleExtraLogs.push('Pokemon của bạn giảm sát thương nhờ hiệu ứng phòng thủ.')
            }
            const nextPlayerHp = Math.max(0, playerCurrentHp - counterDamage)
            resultingPlayerHp = nextPlayerHp

            if (trainerSession) {
                trainerSession.playerCurrentHp = nextPlayerHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }

            const shouldConsumeCounterMovePp = canOpponentAct && selectedCounterMoveIndex >= 0 && selectedOpponentMoveKey !== 'struggle'
            counterMovePpCost = shouldConsumeCounterMovePp ? 1 : 0
            if (hasCounterMoveList && canOpponentAct) {
                nextCounterMoveCursor = counterMoveSelection.nextCursor
            }
            if (usingTrainerCounterMoves && activeTrainerOpponent && canOpponentAct) {
                activeTrainerOpponent.counterMoveCursor = nextCounterMoveCursor
            }
            counterMoveState = applyCounterMovePpConsumption({
                moves: counterMoveState,
                selectedIndex: selectedCounterMoveIndex,
                shouldConsume: shouldConsumeCounterMovePp,
            })
            if (usingTrainerCounterMoves && activeTrainerOpponent) {
                activeTrainerOpponent.counterMoves = counterMoveState
            }

            counterAttack = {
                damage: counterDamage,
                currentHp: nextPlayerHp,
                maxHp: playerMaxHp,
                defeatedPlayer: nextPlayerHp <= 0,
                hit: didOpponentMoveHit,
                effectiveness: opponentTypeEffectiveness.multiplier,
                critical: didOpponentCritical,
                move: {
                    name: selectedOpponentMoveName,
                    type: opponentMoveType,
                    category: opponentMoveCategory,
                    accuracy: opponentMoveAccuracy,
                    priority: opponentMovePriority,
                    power: opponentMovePower,
                    ppCost: counterMovePpCost,
                    canAct: canOpponentAct,
                },
                damagePercent: trainerPokemonDamagePercent,
                log: !canOpponentAct
                    ? `${targetName} không thể hành động.`
                    : (didOpponentMoveHit
                    ? `${targetName} dùng ${selectedOpponentMoveName}! Gây ${counterDamage} sát thương. ${resolveEffectivenessText(opponentTypeEffectiveness.multiplier)}`.trim()
                    : `${targetName} dùng ${selectedOpponentMoveName} nhưng trượt.`),
            }
        }

        if (!playerActsFirst) {
            executeOpponentTurn(targetCurrentHp)
            playerCurrentHp = resultingPlayerHp
        }

        if (normalizeStatusTurns(battleFieldState?.normalMovesBecomeElectricTurns) > 0 && moveType === 'normal') {
            moveType = 'electric'
        }

        const precomputedTypeEffectiveness = resolveTypeEffectiveness(moveType, targetTypes)

        damageCalcEffects = applyEffectSpecs({
            effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'on_calculate_damage'),
            context: {
                random: randomFn,
                moveName: selectedMoveName,
                userWasDamagedLastTurn: playerWasDamagedLastTurn,
                targetWasDamagedLastTurn: opponentWasDamagedLastTurn,
                userHasNoHeldItem: true,
                targetIsDynamaxed: Boolean(opponent?.isDynamaxed),
                userActsFirst: playerActsFirst,
                isSuperEffective: precomputedTypeEffectiveness.multiplier > 1,
                userMaxHp: playerMaxHp,
                userCurrentHp: playerCurrentHp,
                userStatus: playerStatus,
                targetStatus: opponentStatus,
                weather: battleFieldState.weather || '',
                terrain: battleFieldState.terrain || '',
                userStatStages: playerStatStages,
                targetStatStages: opponentStatStages,
                userSpeed: playerEffectiveSpeed,
                targetSpeed: opponentEffectiveSpeed,
                targetCurrentHp,
                targetMaxHp,
            },
        })
        if (damageCalcEffects?.statePatches?.self?.alwaysCrit) {
            moveCriticalChance = 1
        }
        if (Number.isFinite(Number(damageCalcEffects?.statePatches?.self?.critRateMultiplier))) {
            moveCriticalChance = clamp(
                moveCriticalChance * Number(damageCalcEffects.statePatches.self.critRateMultiplier),
                0,
                1
            )
        }
        if (Number.isFinite(Number(damageCalcEffects?.statePatches?.self?.powerMultiplier))) {
            resolvedPower = clamp(
                Math.floor(resolvedPower * Number(damageCalcEffects.statePatches.self.powerMultiplier)),
                1,
                400
            )
        }

        const useDefenseAsAttack = Boolean(damageCalcEffects?.statePatches?.self?.useDefenseAsAttack)
        const useTargetAttackAsAttack = Boolean(damageCalcEffects?.statePatches?.self?.useTargetAttackAsAttack)
        const useHigherOffenseStat = Boolean(damageCalcEffects?.statePatches?.self?.useHigherOffenseStat)
        const ignoreTargetStatStages = Boolean(damageCalcEffects?.statePatches?.self?.ignoreTargetStatStages)
        const ignoreOpponentDamageGuards = Boolean(damageCalcEffects?.statePatches?.self?.ignoreDamageGuards)
        const useTargetDefenseForSpecial = Boolean(damageCalcEffects?.statePatches?.self?.useTargetDefenseForSpecial)
        const requireTerrain = Boolean(damageCalcEffects?.statePatches?.self?.requireTerrain)
        const targetAttackForFoulPlay = applyStatStageToValue(targetAtk, ignoreTargetStatStages ? 0 : opponentStatStages?.atk)
        const stagedAtk = applyStatStageToValue(attackerAtk, playerStatStages?.atk)
        const stagedSpAtk = applyStatStageToValue(attackerSpAtk, playerStatStages?.spatk)
        const stagedPlayerAttack = moveCategory === 'special'
            ? (useHigherOffenseStat ? Math.max(stagedAtk, stagedSpAtk) : stagedSpAtk)
            : (useTargetAttackAsAttack
                ? targetAttackForFoulPlay
                : (useDefenseAsAttack
                ? applyStatStageToValue(playerDef, playerStatStages?.def)
                : (useHigherOffenseStat ? Math.max(stagedAtk, stagedSpAtk) : stagedAtk)))
        const stagedTargetDefense = moveCategory === 'special'
            ? (useTargetDefenseForSpecial
                ? applyStatStageToValue(targetDef, ignoreTargetStatStages ? 0 : opponentStatStages?.def)
                : applyStatStageToValue(targetSpDef, ignoreTargetStatStages ? 0 : opponentStatStages?.spdef))
            : applyStatStageToValue(targetDef, ignoreTargetStatStages ? 0 : opponentStatStages?.def)
        const playerAttackStat = stagedPlayerAttack
        const playerDefenseStat = stagedTargetDefense
        const isStatusMove = moveCategory === 'status'
        const playerTurnStatusCheck = resolveActionAvailabilityByStatus({
            status: playerStatus,
            statusTurns: playerStatusTurns,
            random: randomFn,
        })
        playerStatus = normalizeBattleStatus(playerTurnStatusCheck.statusAfterCheck)
        playerStatusTurns = normalizeStatusTurns(playerTurnStatusCheck.statusTurnsAfterCheck)
        let canPlayerActByVolatile = true
        const rechargeTurns = normalizeStatusTurns(playerVolatileState?.rechargeTurns)
        if (rechargeTurns > 0) {
            canPlayerActByVolatile = false
            playerVolatileState = {
                ...playerVolatileState,
                rechargeTurns: Math.max(0, rechargeTurns - 1),
            }
            if (!playerVolatileState.rechargeTurns) {
                delete playerVolatileState.rechargeTurns
            }
            battleExtraLogs.push('Pokemon của bạn cần hồi sức nên không thể hành động.')
        }

        const lockedRepeatMoveName = String(playerVolatileState?.lockedRepeatMoveName || '').trim()
        const lockedRepeatMoveKey = normalizeMoveName(lockedRepeatMoveName)
        if (canPlayerActByVolatile && lockedRepeatMoveKey && normalizeMoveName(selectedMoveName) === lockedRepeatMoveKey) {
            canPlayerActByVolatile = false
            battleExtraLogs.push(`Chiêu ${selectedMoveName} không thể dùng liên tiếp.`)
        }
        if (canPlayerActByVolatile && lockedRepeatMoveName && normalizeMoveName(selectedMoveName) !== lockedRepeatMoveKey) {
            const nextVolatileState = { ...playerVolatileState }
            delete nextVolatileState.lockedRepeatMoveName
            playerVolatileState = nextVolatileState
        }

        const playerStatusMoveBlockTurns = normalizeStatusTurns(playerVolatileState?.statusMoveBlockTurns)
        if (playerStatusMoveBlockTurns > 0) {
            playerVolatileState = {
                ...playerVolatileState,
                statusMoveBlockTurns: Math.max(0, playerStatusMoveBlockTurns - 1),
            }
            if (!playerVolatileState.statusMoveBlockTurns) {
                delete playerVolatileState.statusMoveBlockTurns
            }
            if (canPlayerActByVolatile && isStatusMove) {
                canPlayerActByVolatile = false
                battleExtraLogs.push('Pokemon của bạn bị khiêu khích nên không thể dùng chiêu trạng thái.')
            }
        }

        const moveBlockedByTerrainRequirement = requireTerrain && !battleFieldState.terrain
        const canPlayerAct = playerCurrentHp > 0 && Boolean(playerTurnStatusCheck.canAct) && canPlayerActByVolatile

        if (moveBlockedByTerrainRequirement) {
            battleExtraLogs.push('Chiêu này thất bại vì sân đấu không có địa hình phù hợp.')
        }
        const pendingAlwaysCrit = Boolean(playerVolatileState?.pendingAlwaysCrit)
        const pendingNeverMiss = Boolean(playerVolatileState?.pendingNeverMiss)

        if (pendingAlwaysCrit) {
            moveCriticalChance = 1
        }

        if (!canPlayerAct && consumedMovePp > 0 && selectedMoveMaxPp > 0) {
            consumedMovePp = 0
            selectedMoveCurrentPp = clamp(selectedMoveCurrentPp + 1, 0, selectedMoveMaxPp)
            playerMovePpStatePayload = [{
                moveName: selectedMoveName,
                currentPp: selectedMoveCurrentPp,
                maxPp: selectedMoveMaxPp,
            }]
        }

        if (playerTurnStatusCheck.log) {
            battleExtraLogs.push(`Pokemon của bạn: ${playerTurnStatusCheck.log}`)
        }

        const beforeAccuracyEffects = canPlayerAct
            ? applyEffectSpecs({
                effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'before_accuracy_check'),
                context: { random: randomFn },
            })
            : createEmptyEffectAggregate()
        const forcedHit = canPlayerAct && !moveBlockedByTerrainRequirement
            && (Boolean(beforeAccuracyEffects?.statePatches?.self?.neverMiss) || pendingNeverMiss)
        const didPlayerMoveHit = canPlayerAct && !moveBlockedByTerrainRequirement
            && (forcedHit || moveAccuracy >= 100 || (Math.random() * 100) <= moveAccuracy)
        const playerTypeEffectiveness = precomputedTypeEffectiveness
        const playerStabMultiplier = attackerTypes.includes(moveType) ? 1.5 : 1
        const opponentCritBlockTurns = normalizeStatusTurns(opponentVolatileState?.critBlockTurns)
        const didPlayerCritical = !isStatusMove
            && canPlayerAct
            && didPlayerMoveHit
            && opponentCritBlockTurns <= 0
            && Math.random() < moveCriticalChance
        if (!isStatusMove && canPlayerAct && didPlayerMoveHit && opponentCritBlockTurns > 0) {
            battleExtraLogs.push(`${targetName} được bảo vệ khỏi đòn chí mạng.`)
        }
        const playerCriticalMultiplier = didPlayerCritical ? 1.5 : 1
        const playerDamageModifier = playerStabMultiplier
            * playerTypeEffectiveness.multiplier
            * playerCriticalMultiplier
            * (1 + (Math.max(0, Number(badgeBonusState?.damageBonusPercent) || 0) / 100))

        const onHitEffects = didPlayerMoveHit
            ? applyEffectSpecs({
                effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'on_hit'),
                context: {
                    random: randomFn,
                    moveName: selectedMoveName,
                    userLevel: attackerLevel,
                    userCurrentHp: playerCurrentHp,
                    userMaxHp: playerMaxHp,
                    userStatus: playerStatus,
                    userStatusTurns: playerStatusTurns,
                    userStatStages: playerStatStages,
                    targetStatus: opponentStatus,
                    weather: battleFieldState.weather || '',
                    terrain: battleFieldState.terrain || '',
                    targetStatStages: opponentStatStages,
                    targetCurrentHp,
                    targetMaxHp,
                },
            })
            : createEmptyEffectAggregate()

        const multiHitPatch = onHitEffects?.statePatches?.self?.multiHit
        const canMultiHit = didPlayerMoveHit && !isStatusMove && playerTypeEffectiveness.multiplier > 0 && multiHitPatch
        const minHits = canMultiHit ? Math.max(1, Math.floor(Number(multiHitPatch.minHits) || 1)) : 1
        const maxHits = canMultiHit ? Math.max(minHits, Math.floor(Number(multiHitPatch.maxHits) || minHits)) : 1
        const hitCount = canMultiHit
            ? (minHits + Math.floor(Math.random() * (maxHits - minHits + 1)))
            : 1

        const onHitSelfPatch = onHitEffects?.statePatches?.self || {}
        const consumedPendingCrit = pendingAlwaysCrit && canPlayerAct && !isStatusMove
        const consumedPendingNeverMiss = pendingNeverMiss && canPlayerAct && !isStatusMove
        const shouldForceTargetKo = Boolean(onHitSelfPatch?.forceTargetKo)
        const shouldUseUserCurrentHpAsDamage = Boolean(onHitSelfPatch?.fixedDamageFromUserCurrentHp)
        const fixedDamageValue = Math.max(0, Math.floor(Number(onHitSelfPatch?.fixedDamageValue) || 0))
        const fixedDamageFractionTargetCurrentHp = clampFraction(onHitSelfPatch?.fixedDamageFractionTargetCurrentHp, 0)
        const minTargetHpAfterHit = Math.max(0, Math.floor(Number(onHitSelfPatch?.minTargetHp || 0)))

        const rawSingleHitDamage = (!canPlayerAct || !didPlayerMoveHit || isStatusMove || playerTypeEffectiveness.multiplier <= 0)
            ? 0
            : calcBattleDamage({
                attackerLevel,
                movePower: resolvedPower,
                attackStat: playerAttackStat,
                defenseStat: playerDefenseStat,
                modifier: playerDamageModifier,
            })
        const singleHitDamage = ignoreOpponentDamageGuards
            ? rawSingleHitDamage
            : applyDamageGuardsToDamage(rawSingleHitDamage, moveCategory, opponentDamageGuards)
        if (singleHitDamage < rawSingleHitDamage) {
            battleExtraLogs.push(`${targetName} giảm sát thương nhờ hiệu ứng phòng thủ.`)
        }
        let damage = Math.max(0, singleHitDamage * hitCount)
        if (shouldUseUserCurrentHpAsDamage && didPlayerMoveHit && !isStatusMove) {
            damage = Math.max(0, Math.floor(playerCurrentHp))
        } else if (fixedDamageValue > 0 && didPlayerMoveHit && !isStatusMove) {
            damage = fixedDamageValue
        } else if (fixedDamageFractionTargetCurrentHp > 0 && didPlayerMoveHit && !isStatusMove) {
            damage = Math.max(1, Math.floor(targetCurrentHp * fixedDamageFractionTargetCurrentHp))
        }
        if (shouldForceTargetKo && didPlayerMoveHit && !isStatusMove) {
            damage = Math.max(damage, targetCurrentHp)
        }
        let currentHp = Math.max(0, targetCurrentHp - damage)
        if (minTargetHpAfterHit > 0 && currentHp < minTargetHpAfterHit && targetCurrentHp > minTargetHpAfterHit) {
            currentHp = minTargetHpAfterHit
            damage = Math.max(0, targetCurrentHp - currentHp)
        }
        const playerEffectivenessText = didPlayerMoveHit ? resolveEffectivenessText(playerTypeEffectiveness.multiplier) : ''

        const afterDamageEffects = canPlayerAct
            ? applyEffectSpecs({
                effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'after_damage'),
                context: {
                    random: randomFn,
                    dealtDamage: damage,
                    didMoveHit: didPlayerMoveHit,
                    userMaxHp: playerMaxHp,
                    targetMaxHp,
                    targetWasKo: currentHp <= 0,
                },
            })
            : createEmptyEffectAggregate()

        const endTurnEffects = canPlayerAct
            ? applyEffectSpecs({
                effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'end_turn'),
                context: {
                    random: randomFn,
                    dealtDamage: damage,
                    userMaxHp: playerMaxHp,
                    targetMaxHp,
                },
            })
            : createEmptyEffectAggregate()

        const combinedEffectResult = [
            selectMoveEffects,
            damageCalcEffects,
            beforeAccuracyEffects,
            onHitEffects,
            afterDamageEffects,
            endTurnEffects,
        ].reduce((aggregate, entry) => mergeEffectAggregate(aggregate, entry), createEmptyEffectAggregate())

        const effectSelfPatches = combinedEffectResult?.statePatches?.self || {}
        const effectOpponentPatches = combinedEffectResult?.statePatches?.opponent || {}
        const effectFieldPatch = combinedEffectResult?.statePatches?.field || {}
        const selfStatusShieldTurns = normalizeStatusTurns(playerVolatileState?.statusShieldTurns)
        const opponentStatusShieldTurns = normalizeStatusTurns(opponentVolatileState?.statusShieldTurns)
        const selfStatDropShieldTurns = normalizeStatusTurns(playerVolatileState?.statDropShieldTurns)
        const opponentStatDropShieldTurns = normalizeStatusTurns(opponentVolatileState?.statDropShieldTurns)
        const selfHealBlockTurns = normalizeStatusTurns(playerVolatileState?.healBlockTurns)
        const opponentHealBlockTurns = normalizeStatusTurns(opponentVolatileState?.healBlockTurns)

        if (effectSelfPatches?.clearStatus) {
            playerStatus = ''
            playerStatusTurns = 0
        } else {
            const incomingSelfStatus = normalizeBattleStatus(effectSelfPatches?.status)
            const nextSelfStatus = incomingSelfStatus && selfStatusShieldTurns > 0 ? '' : effectSelfPatches?.status
            if (incomingSelfStatus && selfStatusShieldTurns > 0) {
                battleExtraLogs.push('Lá chắn trạng thái bảo vệ Pokemon của bạn khỏi hiệu ứng bất lợi.')
            }
            const patchedSelfStatus = applyStatusPatch({
                currentStatus: playerStatus,
                currentTurns: playerStatusTurns,
                nextStatus: nextSelfStatus,
                nextTurns: effectSelfPatches?.statusTurns,
                random: randomFn,
            })
            playerStatus = patchedSelfStatus.status
            playerStatusTurns = patchedSelfStatus.statusTurns
        }

        if (effectOpponentPatches?.clearStatus) {
            opponentStatus = ''
            opponentStatusTurns = 0
        } else {
            const incomingOpponentStatus = normalizeBattleStatus(effectOpponentPatches?.status)
            const nextOpponentStatus = incomingOpponentStatus && opponentStatusShieldTurns > 0 ? '' : effectOpponentPatches?.status
            if (incomingOpponentStatus && opponentStatusShieldTurns > 0) {
                battleExtraLogs.push(`${targetName} được lá chắn trạng thái bảo vệ.`)
            }
            const patchedOpponentStatus = applyStatusPatch({
                currentStatus: opponentStatus,
                currentTurns: opponentStatusTurns,
                nextStatus: nextOpponentStatus,
                nextTurns: effectOpponentPatches?.statusTurns,
                random: randomFn,
            })
            opponentStatus = patchedOpponentStatus.status
            opponentStatusTurns = patchedOpponentStatus.statusTurns
        }

        const filteredSelfStatDelta = filterNegativeStatStageDeltas(effectSelfPatches?.statStages, selfStatDropShieldTurns)
        const filteredOpponentStatDelta = filterNegativeStatStageDeltas(effectOpponentPatches?.statStages, opponentStatDropShieldTurns)
        if (selfStatDropShieldTurns > 0 && Object.keys(normalizeStatStages(effectSelfPatches?.statStages)).length > Object.keys(filteredSelfStatDelta).length) {
            battleExtraLogs.push('Lá chắn chỉ số ngăn Pokemon của bạn bị giảm chỉ số.')
        }
        if (opponentStatDropShieldTurns > 0 && Object.keys(normalizeStatStages(effectOpponentPatches?.statStages)).length > Object.keys(filteredOpponentStatDelta).length) {
            battleExtraLogs.push(`${targetName} được lá chắn chỉ số bảo vệ khỏi giảm chỉ số.`)
        }

        playerStatStages = combineStatStageDeltas(playerStatStages, filteredSelfStatDelta)
        opponentStatStages = combineStatStageDeltas(opponentStatStages, filteredOpponentStatDelta)
        if (effectSelfPatches?.replaceStatStages && typeof effectSelfPatches.replaceStatStages === 'object') {
            playerStatStages = normalizeStatStages(effectSelfPatches.replaceStatStages)
        }
        if (effectOpponentPatches?.replaceStatStages && typeof effectOpponentPatches.replaceStatStages === 'object') {
            opponentStatStages = normalizeStatStages(effectOpponentPatches.replaceStatStages)
        }
        playerStatStages = applyAbsoluteStatStages(playerStatStages, effectSelfPatches?.setStatStages)
        opponentStatStages = applyAbsoluteStatStages(opponentStatStages, effectOpponentPatches?.setStatStages)
        if (effectSelfPatches?.clearStatStages) {
            playerStatStages = {}
        }
        if (effectOpponentPatches?.clearStatStages) {
            opponentStatStages = {}
        }
        playerDamageGuards = mergeDamageGuards(playerDamageGuards, effectSelfPatches?.damageGuards)
        opponentDamageGuards = mergeDamageGuards(opponentDamageGuards, effectOpponentPatches?.damageGuards)
        if (effectSelfPatches?.clearDamageGuards) {
            playerDamageGuards = {}
        }
        if (effectOpponentPatches?.clearDamageGuards) {
            opponentDamageGuards = {}
        }
        playerVolatileState = mergeVolatileState(playerVolatileState, effectSelfPatches?.volatileState)
        opponentVolatileState = mergeVolatileState(opponentVolatileState, effectOpponentPatches?.volatileState)

        if (consumedPendingCrit && playerVolatileState?.pendingAlwaysCrit) {
            const nextVolatile = { ...playerVolatileState }
            delete nextVolatile.pendingAlwaysCrit
            playerVolatileState = nextVolatile
        }
        if (consumedPendingNeverMiss && playerVolatileState?.pendingNeverMiss) {
            const nextVolatile = { ...playerVolatileState }
            delete nextVolatile.pendingNeverMiss
            playerVolatileState = nextVolatile
        }

        battleFieldState = mergeFieldState(battleFieldState, effectFieldPatch)

        const selfHealHp = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.self?.healHp) || 0))
        if (selfHealHp > 0 && selfHealBlockTurns > 0) {
            battleExtraLogs.push('Pokemon của bạn bị chặn hồi máu.')
        } else if (selfHealHp > 0) {
            playerCurrentHp = Math.min(playerMaxHp, playerCurrentHp + selfHealHp)
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        const opponentHealHp = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.opponent?.healHp) || 0))
        if (opponentHealHp > 0 && currentHp > 0 && opponentHealBlockTurns > 0) {
            battleExtraLogs.push(`${targetName} bị chặn hồi máu.`)
        } else if (opponentHealHp > 0 && currentHp > 0) {
            currentHp = Math.min(targetMaxHp, currentHp + opponentHealHp)
        }

        const crashDamageOnMissFraction = clampFraction(
            combinedEffectResult?.statePatches?.self?.crashDamageOnMissFractionMaxHp,
            0
        )
        if (!didPlayerMoveHit && !isStatusMove && crashDamageOnMissFraction > 0 && playerCurrentHp > 0) {
            const crashDamage = Math.max(1, Math.floor(playerMaxHp * crashDamageOnMissFraction))
            playerCurrentHp = Math.max(0, playerCurrentHp - crashDamage)
            battleExtraLogs.push(`Pokemon của bạn chịu ${crashDamage} sát thương do đòn trượt.`)
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        const selfRecoilHp = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.self?.recoilHp) || 0))
        if (selfRecoilHp > 0) {
            playerCurrentHp = Math.max(0, playerCurrentHp - selfRecoilHp)
            battleExtraLogs.push(`Pokemon của bạn chịu ${selfRecoilHp} sát thương phản lực.`)
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        const selfHpCost = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.self?.selfHpCost) || 0))
        if (selfHpCost > 0 && playerCurrentHp > 0) {
            playerCurrentHp = Math.max(1, playerCurrentHp - selfHpCost)
            battleExtraLogs.push(`Pokemon của bạn tiêu hao ${selfHpCost} HP để kích hoạt hiệu ứng.`)
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        if (combinedEffectResult?.statePatches?.self?.selfFaint && playerCurrentHp > 0) {
            playerCurrentHp = 0
            battleExtraLogs.push('Pokemon của bạn bị ngất do tác dụng của chiêu.')
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        resultingPlayerHp = playerCurrentHp
        if (playerActsFirst && currentHp > 0 && playerCurrentHp > 0) {
            executeOpponentTurn(currentHp)
        }

        const playerResidualDamage = resultingPlayerHp > 0
            ? calcResidualStatusDamage({
                status: playerStatus,
                maxHp: playerMaxHp,
            })
            : 0
        if (playerResidualDamage > 0) {
            resultingPlayerHp = Math.max(0, resultingPlayerHp - playerResidualDamage)
            battleExtraLogs.push(`Pokemon của bạn chịu ${playerResidualDamage} sát thương do ${playerStatus}.`)
        }

        const opponentResidualDamage = currentHp > 0
            ? calcResidualStatusDamage({
                status: opponentStatus,
                maxHp: targetMaxHp,
            })
            : 0
        if (opponentResidualDamage > 0) {
            currentHp = Math.max(0, currentHp - opponentResidualDamage)
            battleExtraLogs.push(`${targetName} chịu ${opponentResidualDamage} sát thương do ${opponentStatus}.`)
        }

        const playerBindTurns = normalizeStatusTurns(playerVolatileState?.bindTurns)
        const playerBindFraction = clampFraction(playerVolatileState?.bindFraction, 1 / 16)
        if (resultingPlayerHp > 0 && playerBindTurns > 0) {
            const bindDamage = Math.max(1, Math.floor(playerMaxHp * playerBindFraction))
            resultingPlayerHp = Math.max(0, resultingPlayerHp - bindDamage)
            battleExtraLogs.push(`Pokemon của bạn chịu ${bindDamage} sát thương do bị trói.`)
            if (playerBindTurns > 1) {
                playerVolatileState = {
                    ...playerVolatileState,
                    bindTurns: playerBindTurns - 1,
                    bindFraction: playerBindFraction,
                }
            } else {
                const nextVolatileState = { ...playerVolatileState }
                delete nextVolatileState.bindTurns
                delete nextVolatileState.bindFraction
                playerVolatileState = nextVolatileState
            }
        }

        const opponentBindTurns = normalizeStatusTurns(opponentVolatileState?.bindTurns)
        const opponentBindFraction = clampFraction(opponentVolatileState?.bindFraction, 1 / 16)
        if (currentHp > 0 && opponentBindTurns > 0) {
            const bindDamage = Math.max(1, Math.floor(targetMaxHp * opponentBindFraction))
            currentHp = Math.max(0, currentHp - bindDamage)
            battleExtraLogs.push(`${targetName} chịu ${bindDamage} sát thương do bị trói.`)
            if (opponentBindTurns > 1) {
                opponentVolatileState = {
                    ...opponentVolatileState,
                    bindTurns: opponentBindTurns - 1,
                    bindFraction: opponentBindFraction,
                }
            } else {
                const nextVolatileState = { ...opponentVolatileState }
                delete nextVolatileState.bindTurns
                delete nextVolatileState.bindFraction
                opponentVolatileState = nextVolatileState
            }
        }

        const activeWeather = String(battleFieldState?.weather || '').trim().toLowerCase()
        if ((activeWeather === 'hail' || activeWeather === 'sandstorm') && resultingPlayerHp > 0 && !isImmuneToWeatherChip(activeWeather, attackerTypes)) {
            const weatherDamage = Math.max(1, Math.floor(playerMaxHp / 16))
            resultingPlayerHp = Math.max(0, resultingPlayerHp - weatherDamage)
            battleExtraLogs.push(`Pokemon của bạn chịu ${weatherDamage} sát thương từ ${activeWeather}.`)
        }
        if ((activeWeather === 'hail' || activeWeather === 'sandstorm') && currentHp > 0 && !isImmuneToWeatherChip(activeWeather, targetTypes)) {
            const weatherDamage = Math.max(1, Math.floor(targetMaxHp / 16))
            currentHp = Math.max(0, currentHp - weatherDamage)
            battleExtraLogs.push(`${targetName} chịu ${weatherDamage} sát thương từ ${activeWeather}.`)
        }

        if (String(battleFieldState?.terrain || '').trim().toLowerCase() === 'grassy') {
            const playerHealBlockNow = normalizeStatusTurns(playerVolatileState?.healBlockTurns)
            const opponentHealBlockNow = normalizeStatusTurns(opponentVolatileState?.healBlockTurns)

            if (resultingPlayerHp > 0) {
                if (playerHealBlockNow > 0) {
                    battleExtraLogs.push('Pokemon của bạn không thể hồi máu do bị chặn hồi máu.')
                } else {
                    const healAmount = Math.max(1, Math.floor(playerMaxHp / 16))
                    resultingPlayerHp = Math.min(playerMaxHp, resultingPlayerHp + healAmount)
                    battleExtraLogs.push(`Pokemon của bạn hồi ${healAmount} HP nhờ địa hình cỏ.`)
                }
            }

            if (currentHp > 0) {
                if (opponentHealBlockNow > 0) {
                    battleExtraLogs.push(`${targetName} không thể hồi máu do bị chặn hồi máu.`)
                } else {
                    const healAmount = Math.max(1, Math.floor(targetMaxHp / 16))
                    currentHp = Math.min(targetMaxHp, currentHp + healAmount)
                    battleExtraLogs.push(`${targetName} hồi ${healAmount} HP nhờ địa hình cỏ.`)
                }
            }
        }

        if (counterAttack) {
            counterAttack.currentHp = resultingPlayerHp
            counterAttack.defeatedPlayer = resultingPlayerHp <= 0
        }

        playerWasDamagedLastTurn = resultingPlayerHp < playerTurnStartHp
        opponentWasDamagedLastTurn = currentHp < opponentTurnStartHp

        playerDamageGuards = decrementDamageGuards(playerDamageGuards)
        opponentDamageGuards = currentHp > 0 ? decrementDamageGuards(opponentDamageGuards) : {}
        battleFieldState = decrementFieldState(battleFieldState)
        playerVolatileState = decrementVolatileTurnState(playerVolatileState)
        opponentVolatileState = currentHp > 0 ? decrementVolatileTurnState(opponentVolatileState) : {}

        if (currentHp <= 0) {
            opponentStatus = ''
            opponentStatusTurns = 0
            opponentStatStages = {}
            opponentDamageGuards = {}
            opponentVolatileState = {}
        }

        if (resultingPlayerHp <= 0) {
            playerStatus = ''
            playerStatusTurns = 0
            playerStatStages = {}
            playerDamageGuards = {}
            playerVolatileState = {}
        }

        if (trainerSession) {
            trainerSession.playerCurrentHp = resultingPlayerHp
            trainerSession.playerStatus = playerStatus
            trainerSession.playerStatusTurns = playerStatusTurns
            trainerSession.playerStatStages = playerStatStages
            trainerSession.playerDamageGuards = playerDamageGuards
            trainerSession.playerWasDamagedLastTurn = playerWasDamagedLastTurn
            trainerSession.playerVolatileState = playerVolatileState
            trainerSession.fieldState = battleFieldState
            if (activeTrainerOpponent) {
                const didDefeatOpponent = targetCurrentHp > 0 && currentHp <= 0
                activeTrainerOpponent.currentHp = currentHp
                activeTrainerOpponent.status = opponentStatus
                activeTrainerOpponent.statusTurns = opponentStatusTurns
                activeTrainerOpponent.statStages = opponentStatStages
                activeTrainerOpponent.damageGuards = opponentDamageGuards
                activeTrainerOpponent.wasDamagedLastTurn = opponentWasDamagedLastTurn
                activeTrainerOpponent.volatileState = opponentVolatileState
                if (usingTrainerCounterMoves) {
                    activeTrainerOpponent.counterMoves = counterMoveState
                    activeTrainerOpponent.counterMoveCursor = Math.max(0, Number(activeTrainerOpponent.counterMoveCursor) || 0)
                    activeTrainerOpponent.counterMoveMode = String(activeTrainerOpponent.counterMoveMode || 'smart-random').trim().toLowerCase() || 'smart-random'
                }

                if (didDefeatOpponent) {
                    if (!Array.isArray(trainerSession.knockoutCounts)) {
                        trainerSession.knockoutCounts = []
                    }
                    const activePokemonIdString = String(activePokemon._id)
                    const knockoutEntry = trainerSession.knockoutCounts.find(
                        (entry) => String(entry?.userPokemonId || '') === activePokemonIdString
                    )
                    if (knockoutEntry) {
                        knockoutEntry.defeatedCount = Math.max(0, Number(knockoutEntry.defeatedCount) || 0) + 1
                    } else {
                        trainerSession.knockoutCounts.push({
                            userPokemonId: activePokemon._id,
                            defeatedCount: 1,
                        })
                    }
                }

                trainerSession.currentIndex = getAliveOpponentIndex(trainerSession.team, activeOpponentIndex)
                if (trainerSession.currentIndex === -1) {
                    trainerSession.currentIndex = trainerSession.team.length
                }
            }
            trainerSession.expiresAt = getBattleSessionExpiryDate()
            trainerSessionDirty = true
        }

        if (trainerSessionDirty && trainerSession) {
            try {
                await trainerSession.save()
            } catch (error) {
                if (isVersionConflictError(error)) {
                    return res.status(409).json({
                        ok: false,
                        code: 'BATTLE_SESSION_CONFLICT',
                        message: 'Phiên battle đang được xử lý ở luồng khác. Vui lòng thử lại ngay.',
                    })
                }
                throw error
            }
        }

        const currentMovePpState = Array.isArray(activePokemon.movePpState) ? activePokemon.movePpState : []
        const mergedMovePpState = mergeMovePpStateEntries(currentMovePpState, playerMovePpStatePayload)
        if (!isMovePpStateEqual(currentMovePpState, mergedMovePpState)) {
            activePokemon.movePpState = mergedMovePpState
            await activePokemon.save()
        }

        const trainerState = normalizedTrainerId && trainerSession
            ? {
                trainerId: normalizedTrainerId,
                currentIndex: trainerSession.currentIndex,
                defeatedAll: trainerSession.currentIndex >= trainerSession.team.length,
                playerStatus: normalizeBattleStatus(trainerSession.playerStatus),
                playerStatusTurns: normalizeStatusTurns(trainerSession.playerStatusTurns),
                playerStatStages: normalizeStatStages(trainerSession.playerStatStages),
                playerDamageGuards: normalizeDamageGuards(trainerSession.playerDamageGuards),
                playerWasDamagedLastTurn: Boolean(trainerSession.playerWasDamagedLastTurn),
                playerVolatileState: normalizeVolatileState(trainerSession.playerVolatileState),
                fieldState: normalizeFieldState(trainerSession.fieldState),
                team: trainerSession.team.map((entry) => ({
                    slot: entry.slot,
                    pokemonId: entry.pokemonId,
                    name: entry.name,
                    level: entry.level,
                    damagePercent: normalizeTrainerPokemonDamagePercent(entry?.damagePercent, 100),
                    types: normalizePokemonTypes(entry.types),
                    currentHp: entry.currentHp,
                    maxHp: entry.maxHp,
                    effectiveStats: buildEffectiveBattleStats({
                        baseStats: {
                            hp: entry.maxHp,
                            atk: entry.baseStats?.atk,
                            def: entry.baseStats?.def,
                            spatk: entry.baseStats?.spatk,
                            spdef: entry.baseStats?.spdef,
                            spd: entry.baseStats?.spd,
                        },
                        statStages: entry.statStages,
                        badgeBonusState: null,
                    }),
                    status: normalizeBattleStatus(entry.status),
                    statusTurns: normalizeStatusTurns(entry.statusTurns),
                    statStages: normalizeStatStages(entry.statStages),
                    damageGuards: normalizeDamageGuards(entry.damageGuards),
                    wasDamagedLastTurn: Boolean(entry.wasDamagedLastTurn),
                    volatileState: normalizeVolatileState(entry.volatileState),
                })),
            }
            : null

        const playerEffectiveStats = buildEffectiveBattleStats({
            baseStats: attackerScaledStats,
            statStages: playerStatStages,
            badgeBonusState,
        })
        const opponentEffectiveStats = buildEffectiveBattleStats({
            baseStats: {
                hp: targetMaxHp,
                atk: targetAtk,
                def: targetDef,
                spatk: targetSpAtk,
                spdef: targetSpDef,
                spd: Math.max(1, Number(activeTrainerOpponent?.baseStats?.spd) || Number(opponent?.baseStats?.spd) || 1),
            },
            statStages: opponentStatStages,
            badgeBonusState: null,
        })

        const opponentMoveStatePayload = hasCounterMoveList
            ? {
                mode: String(opponentMoveMode || '').trim().toLowerCase() === 'smart' ? 'smart' : 'ordered',
                cursor: nextCounterMoveCursor,
                moves: counterMoveState.map((entry) => ({
                    name: entry.name,
                    type: entry.type,
                    power: entry.power,
                    category: entry.category,
                    accuracy: entry.accuracy,
                    priority: entry.priority,
                    currentPp: entry.currentPp,
                    maxPp: entry.maxPp,
                })),
            }
            : null

        res.json({
            ok: true,
            battle: {
                turnOrder: battleTurnOrder,
                turnOrderReason,
                playerActsFirst,
                playerSpeed: playerEffectiveSpeed,
                opponentSpeed: opponentEffectiveSpeed,
                damage,
                currentHp,
                maxHp: targetMaxHp,
                defeated: currentHp <= 0,
                move: {
                    name: selectedMoveName,
                    type: moveType,
                    category: moveCategory,
                    accuracy: moveAccuracy,
                    priority: movePriority,
                    hit: didPlayerMoveHit,
                    forcedHit,
                    hitCount,
                    critical: didPlayerCritical,
                    effectiveness: playerTypeEffectiveness.multiplier,
                    stabMultiplier: playerStabMultiplier,
                    power: resolvedPower,
                    ppCost: consumedMovePp,
                    currentPp: normalizeMoveName(selectedMoveName) === 'struggle' ? 99 : selectedMoveCurrentPp,
                    maxPp: normalizeMoveName(selectedMoveName) === 'struggle' ? 99 : selectedMoveMaxPp,
                    fallbackReason: moveFallbackReason,
                    fallbackFrom: moveFallbackFrom,
                },
                player: {
                    id: activePokemon._id,
                    name: activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon',
                    currentHp: resultingPlayerHp,
                    maxHp: playerMaxHp,
                    effectiveStats: playerEffectiveStats,
                    status: playerStatus,
                    statusTurns: playerStatusTurns,
                    statStages: playerStatStages,
                    damageGuards: playerDamageGuards,
                    wasDamagedLastTurn: playerWasDamagedLastTurn,
                    volatileState: playerVolatileState,
                    movePpState: playerMovePpStatePayload,
                },
                opponent: trainerState,
                targetState: {
                    name: targetName,
                    currentHp,
                    maxHp: targetMaxHp,
                    effectiveStats: opponentEffectiveStats,
                    status: opponentStatus,
                    statusTurns: opponentStatusTurns,
                    statStages: opponentStatStages,
                    damageGuards: opponentDamageGuards,
                    wasDamagedLastTurn: opponentWasDamagedLastTurn,
                    volatileState: opponentVolatileState,
                },
                counterAttack,
                opponentMoveState: opponentMoveStatePayload,
                effects: {
                    logs: [...combinedEffectResult.logs, ...battleExtraLogs],
                    appliedOps: combinedEffectResult.appliedEffects.map((entry) => String(entry?.op || '').trim()).filter(Boolean),
                    statePatches: combinedEffectResult.statePatches,
                },
                fieldState: battleFieldState,
                log: (!playerActsFirst && playerTurnStartHp > 0 && playerCurrentHp <= 0)
                    ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} đã ngã xuống trước khi kịp ra đòn.`
                    : !canPlayerAct
                    ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} không thể hành động.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`
                    : (didPlayerMoveHit
                    ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName}! Gây ${damage} sát thương${hitCount > 1 ? ` (${hitCount} đòn)` : ''}. ${moveFallbackReason === 'OUT_OF_PP' ? '(Chiêu đã hết PP nên tự dùng Struggle.) ' : ''}${playerEffectivenessText}`.trim()
                    : (moveBlockedByTerrainRequirement
                        ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName} nhưng thất bại vì sân đấu không có địa hình phù hợp.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`
                        : `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName} nhưng trượt.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`)),
            },
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/battle/trainer/switch (protected)
router.post('/battle/trainer/switch', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const { trainerId = null, activePokemonId = null, playerCurrentHp = null, playerMaxHp = null } = req.body || {}
        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        if (!normalizedTrainerId || !normalizedActivePokemonId) {
            return res.status(400).json({ ok: false, message: 'Thiếu trainerId hoặc activePokemonId.' })
        }

        const trainerDoc = await BattleTrainer.findById(normalizedTrainerId)
            .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types levelUpMoves initialMoves')
            .lean()
        if (!trainerDoc) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle.' })
        }

        let trainerSession = await BattleSession.findOne({
            userId,
            trainerId: normalizedTrainerId,
            expiresAt: { $gt: new Date() },
        })
        if (!trainerSession) {
            trainerSession = await BattleSession.findOne({
                userId,
                expiresAt: { $gt: new Date() },
            }).sort({ updatedAt: -1, createdAt: -1 })
        }
        if (!trainerSession) {
            trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainerDoc)
        }

        const resolvedTrainerId = String(trainerSession.trainerId || normalizedTrainerId).trim()

        const team = Array.isArray(trainerSession.team) ? trainerSession.team : []
        const currentIndex = Math.max(0, Number(trainerSession.currentIndex) || 0)
        if (team.length === 0 || currentIndex >= team.length) {
            return res.status(409).json({ ok: false, message: 'Phiên battle trainer đã kết thúc. Vui lòng vào trận mới.' })
        }

        const resolvedTrainerDoc = resolvedTrainerId === normalizedTrainerId
            ? trainerDoc
            : await BattleTrainer.findById(resolvedTrainerId)
                .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types levelUpMoves initialMoves')
                .lean()
        if (!resolvedTrainerDoc) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle.' })
        }

        const targetPokemon = await UserPokemon.findOne({
            _id: normalizedActivePokemonId,
            userId,
            location: 'party',
        }).populate('pokemonId', 'name baseStats rarity forms defaultFormId types')
        if (!targetPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon để đổi ra sân.' })
        }

        const calculatedMaxHp = calcMaxHp(
            Number(targetPokemon?.pokemonId?.baseStats?.hp || 1),
            Math.max(1, Number(targetPokemon.level || 1)),
            targetPokemon?.pokemonId?.rarity || 'd'
        )
        const resolvedMaxHp = clamp(
            Math.floor(Number.isFinite(Number(playerMaxHp)) ? Number(playerMaxHp) : calculatedMaxHp),
            1,
            calculatedMaxHp
        )
        const resolvedCurrentHp = clamp(
            Math.floor(Number.isFinite(Number(playerCurrentHp)) ? Number(playerCurrentHp) : resolvedMaxHp),
            0,
            resolvedMaxHp
        )

        trainerSession.playerPokemonId = targetPokemon._id
        trainerSession.playerMaxHp = resolvedMaxHp
        trainerSession.playerCurrentHp = resolvedCurrentHp

        const activeTrainerOpponent = team[currentIndex] || null
        const trainerTeamEntry = Array.isArray(resolvedTrainerDoc?.team) ? resolvedTrainerDoc.team[currentIndex] : null
        const counterAttack = await applyTrainerPenaltyTurn({
            activeBattleSession: trainerSession,
            activeTrainerOpponent,
            targetPokemon,
            trainerSpecies: trainerTeamEntry?.pokemonId || null,
            playerCurrentHp: resolvedCurrentHp,
            playerMaxHp: resolvedMaxHp,
            reason: 'switch',
        })

        return res.json({
            ok: true,
            message: `${targetPokemon.nickname || targetPokemon?.pokemonId?.name || 'Pokemon'} vào sân và bị đối thủ phản công!`,
            player: {
                pokemonId: targetPokemon._id,
                currentHp: Math.max(0, Number(trainerSession.playerCurrentHp || 0)),
                maxHp: Math.max(1, Number(trainerSession.playerMaxHp || 1)),
                effectiveStats: res?.counterAttack?.player?.effectiveStats || null,
            },
            counterAttack,
            opponent: serializeTrainerBattleState(trainerSession),
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/battle/resolve (protected)
router.post('/battle/resolve', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const { trainerId = null } = req.body
        const normalizedTrainerId = String(trainerId || '').trim()

        if (!normalizedTrainerId) {
            return res.status(400).json({ ok: false, message: 'trainerId là bắt buộc để nhận kết quả battle' })
        }

        let sourceTeam = []
        let trainerRewardCoins = 0
        let trainerExpReward = 0
        let trainerMoonPointsReward = 0
        let trainerPrizePokemonId = null
        let trainerPrizePokemonFormId = 'normal'
        let trainerPrizePokemonLevel = 0
        let trainerPrizeItem = null
        let trainerPrizeItemQuantity = 0
        let trainerIsAutoGenerated = false
        let trainerRewardMarker = ''
        let trainerAlreadyCompleted = false
        let resolvedBattleSession = null

        if (normalizedTrainerId) {
            const trainer = await BattleTrainer.findById(normalizedTrainerId)
                .populate('prizePokemonId', 'name imageUrl sprites forms defaultFormId')
                .populate('prizeItemId', 'name imageUrl type rarity')
                .lean()
            if (!trainer) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
            }

            const activeSession = await BattleSession.findOne({
                userId,
                trainerId: normalizedTrainerId,
                expiresAt: { $gt: new Date() },
            })
                .select('currentIndex team')
                .lean()
            if (!activeSession || !Array.isArray(activeSession.team) || activeSession.team.length === 0) {
                return res.status(400).json({ ok: false, message: 'Không tìm thấy phiên battle. Vui lòng bắt đầu trận trước.' })
            }
            if (activeSession.currentIndex < activeSession.team.length) {
                return res.status(400).json({ ok: false, message: 'Trận battle chưa kết thúc. Hãy hạ toàn bộ Pokemon đối thủ trước.' })
            }

            const claimedSession = await BattleSession.findOneAndDelete({
                _id: activeSession._id,
                userId,
                trainerId: normalizedTrainerId,
                expiresAt: { $gt: new Date() },
            })
            if (!claimedSession) {
                return res.status(409).json({ ok: false, message: 'Phần thưởng battle đã được nhận. Vui lòng bắt đầu trận mới.' })
            }
            resolvedBattleSession = claimedSession

            if (Array.isArray(trainer.team) && trainer.team.length > 0) {
                sourceTeam = trainer.team
            }
            trainerRewardCoins = Math.max(0, Number(trainer.platinumCoinsReward) || 0)
            trainerExpReward = Math.max(0, Number(trainer.expReward) || 0)
            trainerMoonPointsReward = Math.max(0, Number(trainer.moonPointsReward) || 0)
            trainerPrizePokemonId = trainer.prizePokemonId?._id || null
            trainerPrizePokemonFormId = String(trainer.prizePokemonFormId || 'normal').trim().toLowerCase() || 'normal'
            trainerPrizePokemonLevel = Math.max(0, Math.floor(Number(trainer.prizePokemonLevel) || 0))
            trainerPrizeItem = trainer.prizeItemId || null
            trainerPrizeItemQuantity = Math.max(1, Number(trainer.prizeItemQuantity) || 1)
            trainerIsAutoGenerated = Boolean(trainer.autoGenerated)
            trainerRewardMarker = `battle_trainer_reward:${trainer._id}`
            trainerAlreadyCompleted = Boolean(await User.exists({
                _id: userId,
                completedBattleTrainers: String(trainer._id),
            }))
        }

        if (!Array.isArray(sourceTeam) || sourceTeam.length === 0) {
            return res.status(400).json({ ok: false, message: 'Cần có đội hình đối thủ' })
        }

        const rewardUser = await User.findById(userId)
            .select('vipTierId vipTierLevel vipBenefits')
            .lean()
        const effectiveVipBonusBenefits = await resolveEffectiveVipBonusBenefits(rewardUser)

        const totalLevel = sourceTeam.reduce((sum, mon) => sum + (Number(mon.level) || 1), 0)
        const averageLevel = Math.max(1, Math.round(totalLevel / Math.max(1, sourceTeam.length)))
        const defaultScaledReward = Math.max(10, averageLevel * 10)
        const baseCoinsAwarded = trainerRewardCoins > 0
            ? Math.floor(trainerRewardCoins)
            : defaultScaledReward
        const coinBonusPercent = Math.max(0, Number(effectiveVipBonusBenefits?.platinumCoinBonusPercent || 0))
        const coinsAwarded = applyPercentBonus(baseCoinsAwarded, coinBonusPercent)
        const expAwarded = trainerExpReward > 0
            ? Math.floor(trainerExpReward)
            : defaultScaledReward
        const baseMoonPointsAwarded = trainerIsAutoGenerated
            ? 0
            : (trainerMoonPointsReward > 0
                ? Math.floor(trainerMoonPointsReward)
                : defaultScaledReward)
        const moonPointsAwarded = (normalizedTrainerId && trainerAlreadyCompleted)
            ? 0
            : baseMoonPointsAwarded
        const happinessAwarded = 13

        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
            .select('pokemonId level experience friendship nickname formId isShiny partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')
        const activePokemon = party.find(p => p) || null

        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon đang hoạt động trong đội hình' })
        }

        const partyById = new Map(party.map((entry) => [String(entry._id), entry]))
        const knockoutTotalsByPokemon = new Map()
        const sessionKnockoutCounts = Array.isArray(resolvedBattleSession?.knockoutCounts)
            ? resolvedBattleSession.knockoutCounts
            : []

        for (const knockoutEntry of sessionKnockoutCounts) {
            const pokemonId = String(knockoutEntry?.userPokemonId || '').trim()
            const defeatedCount = Math.max(0, Math.floor(Number(knockoutEntry?.defeatedCount) || 0))
            if (!pokemonId || defeatedCount <= 0) continue
            knockoutTotalsByPokemon.set(pokemonId, (knockoutTotalsByPokemon.get(pokemonId) || 0) + defeatedCount)
        }

        const trackedParticipants = [...knockoutTotalsByPokemon.entries()]
            .map(([pokemonId, defeatedCount]) => ({
                pokemonId,
                defeatedCount,
                pokemon: partyById.get(pokemonId) || null,
            }))
            .filter((entry) => entry.pokemon)

        if (trackedParticipants.length === 0) {
            trackedParticipants.push({
                pokemonId: String(activePokemon._id),
                defeatedCount: Math.max(1, sourceTeam.length),
                pokemon: activePokemon,
            })
        }

        const expParticipants = distributeExpByDefeats(
            expAwarded,
            trackedParticipants.map((entry) => ({
                pokemonId: entry.pokemonId,
                defeatedCount: entry.defeatedCount,
            }))
        )

        const participantByPokemonId = new Map(
            trackedParticipants.map((entry) => [entry.pokemonId, entry.pokemon])
        )
        const pokemonRewards = []
        let totalLevelsGained = 0

        for (const expParticipant of expParticipants) {
            const participantPokemon = participantByPokemonId.get(expParticipant.pokemonId)
            if (!participantPokemon) continue

            const pokemonRarity = participantPokemon.pokemonId?.rarity || 'd'
            const expMultiplier = getRarityExpMultiplier(pokemonRarity)
            const finalExp = Math.floor(expParticipant.baseExp * expMultiplier)
            const expBefore = Math.max(0, Math.floor(Number(participantPokemon.experience) || 0))

            let levelsGained = 0

            if (participantPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                participantPokemon.level = USER_POKEMON_MAX_LEVEL
                participantPokemon.experience = 0
            } else {
                participantPokemon.experience = expBefore + finalExp
                while (
                    participantPokemon.level < USER_POKEMON_MAX_LEVEL
                    && participantPokemon.experience >= expToNext(participantPokemon.level)
                ) {
                    participantPokemon.experience -= expToNext(participantPokemon.level)
                    participantPokemon.level += 1
                    levelsGained += 1
                }

                if (participantPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                    participantPokemon.level = USER_POKEMON_MAX_LEVEL
                    participantPokemon.experience = 0
                }
            }

            participantPokemon.friendship = Math.min(255, (participantPokemon.friendship || 0) + happinessAwarded)

            await participantPokemon.save()
            await participantPokemon.populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')

            totalLevelsGained += levelsGained

            pokemonRewards.push({
                userPokemonId: participantPokemon._id,
                defeatedCount: expParticipant.defeatedCount,
                baseExp: expParticipant.baseExp,
                finalExp,
                name: participantPokemon.nickname || participantPokemon.pokemonId?.name || 'Pokemon',
                imageUrl: resolvePokemonImageForForm(
                    participantPokemon.pokemonId,
                    participantPokemon.formId,
                    Boolean(participantPokemon.isShiny)
                ),
                level: participantPokemon.level,
                exp: participantPokemon.experience,
                expBefore,
                expToNext: participantPokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : expToNext(participantPokemon.level),
                levelsGained,
                happiness: participantPokemon.friendship,
                happinessGained: happinessAwarded,
            })
        }

        const primaryPokemonReward = [...pokemonRewards]
            .sort((a, b) => (
                (b.defeatedCount - a.defeatedCount) ||
                (b.baseExp - a.baseExp)
            ))[0] || {
                name: activePokemon.nickname || activePokemon.pokemonId?.name || 'Pokemon',
                imageUrl: resolvePokemonImageForForm(
                    activePokemon.pokemonId,
                    activePokemon.formId,
                    Boolean(activePokemon.isShiny)
                ),
                level: activePokemon.level,
                exp: activePokemon.experience,
                expBefore: activePokemon.experience,
                expToNext: activePokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : expToNext(activePokemon.level),
                levelsGained: 0,
                happiness: activePokemon.friendship,
                happinessGained: 0,
                defeatedCount: 0,
                baseExp: 0,
                finalExp: 0,
            }

        const playerState = await PlayerState.findOneAndUpdate(
            { userId },
            {
                $setOnInsert: { userId },
                $inc: {
                    gold: coinsAwarded,
                    experience: expAwarded,
                    moonPoints: moonPointsAwarded,
                    wins: 1,
                },
            },
            { new: true, upsert: true }
        )
        const trainerExpAwarded = expAwarded
        await trackDailyActivity(userId, {
            battles: 1,
            levels: Math.max(0, totalLevelsGained),
            battleMoonPoints: moonPointsAwarded,
            moonPoints: moonPointsAwarded,
            platinumCoins: Math.max(0, coinsAwarded),
            trainerExp: Math.max(0, trainerExpAwarded),
        })
        emitPlayerState(userId.toString(), playerState)

        let prizePokemon = null
        let prizeItem = null
        if (trainerPrizePokemonId && trainerRewardMarker) {
            const prizeData = await Pokemon.findById(trainerPrizePokemonId)
                .select('name imageUrl sprites levelUpMoves forms defaultFormId')
                .lean()

            if (prizeData) {
                const prizeLevel = trainerPrizePokemonLevel > 0
                    ? Math.max(1, Math.floor(trainerPrizePokemonLevel))
                    : DEFAULT_TRAINER_PRIZE_LEVEL
                const { form: resolvedPrizeForm, formId: resolvedPrizeFormId } = resolvePokemonForm(prizeData, trainerPrizePokemonFormId)
                const prizeImageUrl = resolvedPrizeForm?.imageUrl
                    || resolvedPrizeForm?.sprites?.normal
                    || resolvedPrizeForm?.sprites?.icon
                    || prizeData.imageUrl
                    || prizeData.sprites?.normal
                    || prizeData.sprites?.front_default
                    || ''

                const alreadyClaimedPrize = await UserPokemon.exists({
                    userId,
                    originalTrainer: trainerRewardMarker,
                })
                const blockedByCompletion = trainerAlreadyCompleted
                const isPokemonRewardLocked = Boolean(alreadyClaimedPrize || blockedByCompletion)

                if (!isPokemonRewardLocked) {
                    await UserPokemon.create({
                        userId,
                        pokemonId: trainerPrizePokemonId,
                        level: prizeLevel,
                        experience: 0,
                        moves: [],
                        movePpState: [],
                        formId: resolvedPrizeFormId,
                        isShiny: false,
                        location: 'box',
                        originalTrainer: trainerRewardMarker,
                    })
                }

                prizePokemon = {
                    id: trainerPrizePokemonId,
                    name: prizeData.name,
                    level: prizeLevel,
                    formId: resolvedPrizeFormId,
                    formName: resolvedPrizeForm?.formName || resolvedPrizeFormId,
                    imageUrl: prizeImageUrl,
                    claimed: !isPokemonRewardLocked,
                    alreadyClaimed: isPokemonRewardLocked,
                    blockedReason: blockedByCompletion ? 'trainer_completed' : (alreadyClaimedPrize ? 'already_claimed' : ''),
                }
            }
        }

        if (trainerPrizeItem?._id && trainerPrizeItemQuantity > 0) {
            const inventoryEntry = await UserInventory.findOneAndUpdate(
                { userId, itemId: trainerPrizeItem._id },
                {
                    $setOnInsert: { userId, itemId: trainerPrizeItem._id },
                    $inc: { quantity: trainerPrizeItemQuantity },
                },
                { new: true, upsert: true }
            )

            prizeItem = {
                id: trainerPrizeItem._id,
                name: trainerPrizeItem.name,
                imageUrl: trainerPrizeItem.imageUrl || '',
                quantity: trainerPrizeItemQuantity,
                totalQuantity: Number(inventoryEntry?.quantity || trainerPrizeItemQuantity),
            }
        }

        if (normalizedTrainerId) {
            await ensureTrainerCompletionTracked(userId, normalizedTrainerId)
        }

        res.json({
            ok: true,
            wallet: serializePlayerWallet(playerState),
            results: {
                pokemon: {
                    name: primaryPokemonReward.name,
                    imageUrl: primaryPokemonReward.imageUrl,
                    level: primaryPokemonReward.level,
                    exp: primaryPokemonReward.exp,
                    expBefore: primaryPokemonReward.expBefore,
                    expToNext: primaryPokemonReward.expToNext,
                    levelsGained: primaryPokemonReward.levelsGained,
                    happiness: primaryPokemonReward.happiness,
                    happinessGained: primaryPokemonReward.happinessGained,
                },
                pokemonRewards,
                rewards: {
                    coins: coinsAwarded,
                    baseCoins: baseCoinsAwarded,
                    coinBonusPercent,
                    trainerExp: trainerExpAwarded,
                    moonPoints: moonPointsAwarded,
                    moonPointsBlockedByCompletion: Boolean(normalizedTrainerId && trainerAlreadyCompleted && baseMoonPointsAwarded > 0),
                    prizePokemon,
                    prizeItem,
                },
                evolution: {
                    evolved: false,
                    chain: [],
                },
            },
        })
    } catch (error) {
        next(error)
    }
})

// GET /api/game/encounter/active (protected)
router.get('/encounter/active', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const encounter = await Encounter.findOne({ userId, isActive: true }).lean()

        if (!encounter) {
            return res.json({ ok: true, encounter: null })
        }

        const pokemon = await Pokemon.findById(encounter.pokemonId)
            .select('name pokedexNumber sprites imageUrl types rarity baseStats forms defaultFormId catchRate')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const { form: resolvedForm, formId } = resolvePokemonForm(pokemon, encounter.formId)
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const isNewPokedexEntry = !(await hasOwnedPokemonForm(userId, pokemon._id, formId))
        const baseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: pokemon,
            formId,
            resolvedForm,
        })

        const scaledStats = calcStatsForLevel(baseStats, encounter.level, pokemon.rarity)

        res.json({
            ok: true,
            encounter: {
                _id: encounter._id,
                level: encounter.level,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                mapId: encounter.mapId,
                playerBattle: formatWildPlayerBattleState(encounter),
                pokemon: {
                    ...pokemon,
                    formId,
                    isNewPokedexEntry,
                    stats: scaledStats,
                    form: resolvedForm || null,
                    resolvedSprites: formSprites || pokemon.sprites,
                    resolvedImageUrl: formImageUrl || pokemon.imageUrl,
                },
            },
        })
    } catch (error) {
        next(error)
    }
})

export const __battleEffectInternals = {
    normalizeBattleStatus,
    normalizeStatusTurns,
    normalizeVolatileState,
    mergeVolatileState,
    applyStatusPatch,
    resolveActionAvailabilityByStatus,
    calcResidualStatusDamage,
    applyDamageGuardsToDamage,
    decrementDamageGuards,
    applyStatStageToValue,
    resolveBattleTurnOrder,
}

export default router
