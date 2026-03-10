import BattleTrainer from '../models/BattleTrainer.js'
import MapModel from '../models/Map.js'
import {
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
} from '../utils/autoTrainerUtils.js'
import { resolveTrainerAverageLevel } from './trainerBattleStateService.js'

const AUTO_TRAINER_LOGS_LIMIT = 12
const AUTO_SEARCH_LOGS_LIMIT = 12

export const buildAutoTrainerStatusPayload = async (userLike = {}) => {
    const normalizedState = normalizeAutoTrainerState(userLike?.autoTrainer)
    const dailyLimit = toSafeAutoTrainerInt(userLike?.vipBenefits?.autoBattleTrainerUsesPerDay, 0)
    const dailyState = resolveAutoTrainerDailyState(normalizedState, dailyLimit)
    const durationLimitMinutes = toSafeAutoTrainerInt(userLike?.vipBenefits?.autoBattleTrainerDurationMinutes, 0)
    const runtimeMsToday = String(normalizedState.dayKey || '') === dailyState.dayKey
        ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
        : 0
    const runtimeMinutesToday = Math.floor(runtimeMsToday / 60000)

    let trainerMeta = null
    const selectedTrainerId = normalizeAutoTrainerId(normalizedState.trainerId)
    if (selectedTrainerId) {
        const trainer = await BattleTrainer.findOne({
            _id: selectedTrainerId,
            isActive: true,
        })
            .select('_id name team.level')
            .lean()

        if (trainer) {
            trainerMeta = {
                id: String(trainer._id),
                name: String(trainer.name || 'Trainer').trim() || 'Trainer',
                level: resolveTrainerAverageLevel(trainer),
            }
        }
    }

    return {
        enabled: Boolean(normalizedState.enabled),
        trainerId: selectedTrainerId,
        trainer: trainerMeta,
        attackIntervalMs: Math.max(450, toSafeAutoTrainerInt(normalizedState.attackIntervalMs, 700)),
        startedAt: normalizedState.startedAt || null,
        canUseVipAutoTrainer: hasVipAutoTrainerAccess(userLike),
        daily: {
            dayKey: dailyState.dayKey,
            count: dailyState.count,
            limit: dailyState.limit,
            remaining: Number.isFinite(dailyState.remaining) ? dailyState.remaining : null,
            runtimeMinutes: runtimeMinutesToday,
            runtimeLimitMinutes: durationLimitMinutes,
            runtimeRemainingMinutes: durationLimitMinutes > 0
                ? Math.max(0, durationLimitMinutes - runtimeMinutesToday)
                : null,
        },
        lastAction: normalizedState.lastAction || null,
        logs: (Array.isArray(normalizedState.logs) ? normalizedState.logs : []).slice(0, AUTO_TRAINER_LOGS_LIMIT),
    }
}

export const buildAutoSearchStatusPayload = async (userLike = {}) => {
    const normalizedState = normalizeAutoSearchState(userLike?.autoSearch)
    const dailyLimit = toSafeAutoTrainerInt(userLike?.vipBenefits?.autoSearchUsesPerDay, 0)
    const dailyState = resolveAutoSearchDailyState(normalizedState, dailyLimit)
    const durationLimitMinutes = toSafeAutoTrainerInt(userLike?.vipBenefits?.autoSearchDurationMinutes, 0)
    const runtimeMsToday = String(normalizedState.dayKey || '') === dailyState.dayKey
        ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
        : 0
    const runtimeMinutesToday = Math.floor(runtimeMsToday / 60000)

    let mapMeta = null
    const selectedMapSlug = String(normalizedState.mapSlug || '').trim().toLowerCase()
    if (selectedMapSlug) {
        const map = await MapModel.findOne({ slug: selectedMapSlug })
            .select('_id slug name isEventMap')
            .lean()
        if (map) {
            mapMeta = {
                id: String(map._id),
                slug: String(map.slug || '').trim().toLowerCase(),
                name: String(map.name || map.slug || '').trim() || map.slug,
                isEventMap: Boolean(isEventMapLike(map)),
            }
        }
    }

    return {
        enabled: Boolean(normalizedState.enabled),
        mapSlug: selectedMapSlug,
        map: mapMeta,
        searchIntervalMs: Math.max(900, toSafeAutoTrainerInt(normalizedState.searchIntervalMs, 1200)),
        actionByRarity: normalizeAutoSearchActionByRarity(normalizedState.actionByRarity),
        catchFormMode: normalizeAutoCatchFormMode(normalizedState.catchFormMode),
        catchBallItemId: normalizeAutoTrainerId(normalizedState.catchBallItemId),
        startedAt: normalizedState.startedAt || null,
        canUseVipAutoSearch: hasVipAutoSearchAccess(userLike),
        daily: {
            dayKey: dailyState.dayKey,
            count: dailyState.count,
            limit: dailyState.limit,
            remaining: Number.isFinite(dailyState.remaining) ? dailyState.remaining : null,
            runtimeMinutes: runtimeMinutesToday,
            runtimeLimitMinutes: durationLimitMinutes,
            runtimeRemainingMinutes: durationLimitMinutes > 0
                ? Math.max(0, durationLimitMinutes - runtimeMinutesToday)
                : null,
        },
        history: normalizedState.history || {
            foundPokemonCount: 0,
            itemDropCount: 0,
            itemDropQuantity: 0,
            runCount: 0,
            battleCount: 0,
            catchAttemptCount: 0,
            catchSuccessCount: 0,
        },
        lastAction: normalizedState.lastAction || null,
        logs: (Array.isArray(normalizedState.logs) ? normalizedState.logs : []).slice(0, AUTO_SEARCH_LOGS_LIMIT),
    }
}
