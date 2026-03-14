import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { createActionGuard } from '../middleware/actionGuard.js'
import { requireActiveGameplayTab } from '../middleware/gameplayTabGuard.js'
import PlayerState from '../models/PlayerState.js'
import { emitPlayerState } from '../socket/index.js'
import Encounter from '../models/Encounter.js'
import User from '../models/User.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import MapProgress from '../models/MapProgress.js'
import MapModel from '../models/Map.js'
import BattleTrainer from '../models/BattleTrainer.js'
import BattleSession from '../models/BattleSession.js'
import Pokemon from '../models/Pokemon.js'

const router = express.Router()

const TRAINER_COMBAT_TEAM_POPULATE = 'name baseStats rarity forms defaultFormId types abilities levelUpMoves initialMoves'
const hasActiveTrainerBattleSession = (session = null, now = new Date()) => Boolean(
    session?.expiresAt
    && session.expiresAt > now
    && Array.isArray(session.team)
    && session.team.length > 0
)
const loadTrainerBattleCombatView = (trainerId) => BattleTrainer.findById(trainerId)
    .select('_id team')
    .populate('team.pokemonId', TRAINER_COMBAT_TEAM_POPULATE)
    .lean()

const buildEffectSpecRuntimeKey = (effect = {}) => JSON.stringify({
    op: String(effect?.op || '').trim(),
    trigger: String(effect?.trigger || '').trim(),
    target: String(effect?.target || '').trim(),
    chance: effect?.chance ?? null,
    params: effect?.params && typeof effect.params === 'object' ? effect.params : {},
})

const mergeUniqueEffectSpecs = (...lists) => {
    const merged = []
    const seen = new Set()

    lists.forEach((list) => {
        normalizeEffectSpecs(list).forEach((effect) => {
            const key = buildEffectSpecRuntimeKey(effect)
            if (!key || seen.has(key)) return
            seen.add(key)
            merged.push(effect)
        })
    })

    return merged
}

const resolveRuntimeMoveEffectSpecs = ({ moveDoc = null, fallbackMove = null } = {}) => {
    const description = String(moveDoc?.description || fallbackMove?.description || '').trim()
    const effectChance = Number.isFinite(Number(moveDoc?.effects?.effectChance))
        ? Number(moveDoc.effects.effectChance)
        : (Number.isFinite(Number(fallbackMove?.effects?.effectChance)) ? Number(fallbackMove.effects.effectChance) : null)
    const parsedEffectSpecs = description
        ? parseMoveEffectText({ description, probability: effectChance }).effectSpecs
        : []

    return mergeUniqueEffectSpecs(
        moveDoc?.effectSpecs,
        fallbackMove?.effectSpecs,
        parsedEffectSpecs,
    )
}

import {
    EXP_PER_SEARCH,
    expToNext,
    calcStatsForLevel,
    getRarityExpMultiplier,
} from '../utils/gameUtils.js'
import { getOrderedMapsCached } from '../utils/orderedMapsCache.js'
import { getPokemonDropRatesCached, getItemDropRatesCached } from '../utils/dropRateCache.js'
import { applyEffectSpecs } from '../battle/effects/effectRegistry.js'
import { parseMoveEffectText } from '../battle/effects/effectParser.js'
import { applyAbilityHook } from '../battle/abilities/abilityRuntime.js'
import { resolveAbilityBypassDecision } from '../battle/abilities/abilityBypassPolicy.js'
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
    resolveDrowsySleepAtEndTurn,
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
    appendTurnPhaseEvent,
    appendTurnPhaseLines,
    createTurnTimeline,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
    resolveTurnActorPhaseKeys,
} from '../battle/turnTimeline.js'
import {
    getMaxCatchAttempts,
} from '../utils/autoTrainerUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { buildMoveLookupByName, buildMovePpStateFromMoves, mergeKnownMovesWithFallback } from '../utils/movePpUtils.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'
import {
    getCachedActiveBadgeBonuses,
    hasBattleBadgeSnapshot,
    resolveBattleBadgeBonusState,
    resolveOrHydrateBattleBadgeSnapshot,
} from '../utils/badgeUtils.js'
import autoSearchRoutes from './game/autoSearch.js'
import autoTrainerRoutes from './game/autoTrainer.js'
import battleRoutes from './game/battle.js'
import encounterRoutes from './game/encounter.js'
import mapsRoutes from './game/maps.js'
import searchRoutes from './game/search.js'
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
    resolveEffectiveVipBonusBenefits,
} from '../services/vipBenefitService.js'
import {
    applyTrainerSessionForcedPlayerSwitch,
    ensureTrainerSessionPlayerParty,
    serializeTrainerPlayerPartyState,
    syncTrainerSessionActivePlayerToParty,
} from '../services/trainerBattlePlayerStateService.js'
import {
    calcWildRewardPlatinumCoins,
    formatWildPlayerBattleState,
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
import { resolvePlayerBattleMaxHp } from '../utils/playerBattleStats.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeAbilityToken = (value = '') => String(value || '').trim().toLowerCase()
const normalizeAbilitySuppressed = (value = false) => {
    if (typeof value === 'string') {
        const normalized = String(value || '').trim().toLowerCase()
        return normalized === 'true' || normalized === '1'
    }
    return Boolean(value)
}

const normalizeAbilityPool = (value = []) => {
    const entries = Array.isArray(value) ? value : []
    return [...new Set(entries.map((entry) => normalizeAbilityToken(entry)).filter(Boolean))]
}

const resolveBattleAbilityForPokemon = ({ userPokemon = null, species = null, fallbackAbility = '' } = {}) => {
    const fallback = normalizeAbilityToken(fallbackAbility)
    if (fallback) return fallback

    const userAbility = normalizeAbilityToken(userPokemon?.ability)
    if (userAbility) return userAbility

    const speciesAbility = normalizeAbilityToken(species?.ability)
    if (speciesAbility) return speciesAbility

    const speciesPool = normalizeAbilityPool(species?.abilities)
    if (speciesPool.length > 0) return speciesPool[0]

    return ''
}

const clampProcChance = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    if (parsed <= 0) return 0
    if (parsed >= 1) return 1
    return parsed
}

const shouldProcEffectChance = (chance = 1, randomValue = Math.random()) => {
    const normalizedChance = clampProcChance(chance)
    if (normalizedChance >= 1) return true
    if (normalizedChance <= 0) return false
    return Number(randomValue) < normalizedChance
}

const normalizeIgnoreTargetAbilityMode = (value = '') => String(value || '').trim().toLowerCase() || 'ignore'
const isSuppressAbilityMode = (mode = '') => normalizeIgnoreTargetAbilityMode(mode).startsWith('suppress')
const MOLD_BREAKER_STYLE_ABILITIES = new Set(['mold_breaker', 'teravolt', 'turboblaze'])

const formatAbilityName = (ability = '') => {
    const normalized = normalizeAbilityToken(ability)
    if (!normalized) return 'Ability'
    return normalized
        .split('_')
        .filter(Boolean)
        .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
        .join(' ')
}

const hasMoldBreakerStyleBypass = ({ attackerAbility = '', attackerAbilitySuppressed = false } = {}) => {
    if (normalizeAbilitySuppressed(attackerAbilitySuppressed)) return false
    return MOLD_BREAKER_STYLE_ABILITIES.has(normalizeAbilityToken(attackerAbility))
}

const buildAbilityResolutionContext = ({
    ignoreTargetAbility = false,
    ignoreTargetAbilityFromMove = false,
    ignoreTargetAbilityFromAttackerAbility = false,
    ignoreTargetAbilityMode = 'ignore',
    logs = [],
} = {}) => {
    const fromMove = Boolean(ignoreTargetAbility || ignoreTargetAbilityFromMove)
    const fromAttackerAbility = Boolean(ignoreTargetAbilityFromAttackerAbility)
    const shouldIgnore = fromMove || fromAttackerAbility
    const source = fromMove && fromAttackerAbility
        ? 'move_and_attacker_ability'
        : (fromMove ? 'move' : (fromAttackerAbility ? 'attacker_ability' : null))

    return {
        ignoreTargetAbility: shouldIgnore,
        shouldIgnoreTargetDefensiveAbility: shouldIgnore,
        ignoreTargetAbilityFromMove: fromMove,
        ignoreTargetAbilityFromAttackerAbility: fromAttackerAbility,
        ignoreTargetAbilitySource: source,
        ignoreTargetAbilityMode: normalizeIgnoreTargetAbilityMode(ignoreTargetAbilityMode),
        logs: normalizeAbilityResultLogs(logs),
    }
}

const resolveIgnoreTargetAbilityFromEffectAggregates = ({ aggregates = [] } = {}) => {
    const entries = Array.isArray(aggregates) ? aggregates : []
    let enabled = false
    let mode = 'ignore'

    entries.forEach((aggregate) => {
        const selfPatches = aggregate?.statePatches?.self
        if (!selfPatches || typeof selfPatches !== 'object') return
        if (!Boolean(selfPatches?.ignoreTargetAbility)) return
        const nextMode = normalizeIgnoreTargetAbilityMode(selfPatches?.ignoreTargetAbilityMode)
        if (isSuppressAbilityMode(nextMode)) return
        enabled = true
        mode = nextMode
    })

    return {
        ignoreTargetAbility: enabled,
        ignoreTargetAbilityMode: mode,
        logs: enabled
            ? ['Đòn đánh bỏ qua hiệu ứng Ability của mục tiêu trong lần xử lý này.']
            : [],
    }
}

const resolveIgnoreTargetAbilityFromEffectSpecs = ({
    effectSpecs = [],
    random = Math.random,
    triggers = null,
} = {}) => {
    const list = Array.isArray(effectSpecs) ? effectSpecs : []
    const triggerFilter = new Set((Array.isArray(triggers) && triggers.length > 0
        ? triggers
        : ['on_select_move', 'on_calculate_damage', 'before_accuracy_check', 'on_hit'])
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean))

    let enabled = false
    let mode = 'ignore'

    for (const spec of list) {
        const op = String(spec?.op || '').trim().toLowerCase()
        if (op !== 'ignore_target_ability') continue

        const trigger = String(spec?.trigger || 'on_hit').trim().toLowerCase()
        if (!triggerFilter.has(trigger)) continue

        if (!shouldProcEffectChance(spec?.chance, random?.())) continue

        const nextMode = normalizeIgnoreTargetAbilityMode(spec?.params?.mode)
        if (isSuppressAbilityMode(nextMode)) continue

        enabled = true
        mode = nextMode
        break
    }

    return {
        ignoreTargetAbility: enabled,
        ignoreTargetAbilityMode: mode,
        logs: enabled
            ? ['Đòn đánh bỏ qua hiệu ứng Ability của mục tiêu trong lần xử lý này.']
            : [],
    }
}

const resolveSuppressTargetAbilityFromEffectAggregates = ({ aggregates = [] } = {}) => {
    const entries = Array.isArray(aggregates) ? aggregates : []
    let enabled = false
    let mode = 'suppress'

    entries.forEach((aggregate) => {
        const opponentPatches = aggregate?.statePatches?.opponent
        if (!opponentPatches || typeof opponentPatches !== 'object') return
        if (!Boolean(opponentPatches?.suppressAbility)) return
        enabled = true
        mode = normalizeIgnoreTargetAbilityMode(opponentPatches?.suppressAbilityMode)
    })

    return {
        suppressTargetAbility: enabled,
        mode,
        logs: enabled
            ? ['Ability của mục tiêu bị áp chế cho đến khi rời sân.']
            : [],
    }
}

const resolveSuppressTargetAbilityFromEffectSpecs = ({
    effectSpecs = [],
    random = Math.random,
    triggers = null,
    targetMovedBeforeAction = false,
} = {}) => {
    const list = Array.isArray(effectSpecs) ? effectSpecs : []
    const triggerFilter = new Set((Array.isArray(triggers) && triggers.length > 0
        ? triggers
        : ['on_select_move', 'on_calculate_damage', 'before_accuracy_check', 'on_hit'])
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean))

    let enabled = false
    let mode = 'suppress'

    for (const spec of list) {
        const op = String(spec?.op || '').trim().toLowerCase()
        if (op !== 'ignore_target_ability') continue

        const trigger = String(spec?.trigger || 'on_hit').trim().toLowerCase()
        if (!triggerFilter.has(trigger)) continue

        if (!shouldProcEffectChance(spec?.chance, random?.())) continue

        const nextMode = normalizeIgnoreTargetAbilityMode(spec?.params?.mode)
        if (!isSuppressAbilityMode(nextMode)) continue
        if (nextMode === 'suppress_if_target_moved' && !Boolean(targetMovedBeforeAction)) continue

        enabled = true
        mode = nextMode
        break
    }

    return {
        suppressTargetAbility: enabled,
        mode,
        logs: enabled
            ? ['Ability của mục tiêu bị áp chế cho đến khi rời sân.']
            : [],
    }
}

const clampAbilitySpeedMultiplier = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0.25, Math.min(4, parsed))
}

const normalizeAbilityResultLogs = (value = []) => (
    Array.isArray(value)
        ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
)

const resolveAbilitySwitchIn = ({ ability = '', weather = '', terrain = '', volatileState = {}, actorName = '', targetName = '', isSuppressed = false } = {}) => {
    const normalizedAbility = normalizeAbilityToken(ability)
    const currentVolatile = volatileState && typeof volatileState === 'object' ? volatileState : {}
    const appliedFor = normalizeAbilityToken(currentVolatile?.switchInAbilityAppliedFor)
    if (!normalizedAbility || appliedFor === normalizedAbility || normalizeAbilitySuppressed(isSuppressed)) {
        return {
            applied: false,
            logs: [],
            selfStageDelta: {},
            opponentStageDelta: {},
            volatileState: currentVolatile,
        }
    }

    const hookResult = applyAbilityHook('onSwitchIn', {
        ability: normalizedAbility,
        weather,
        terrain,
        actorName,
        targetName,
    })

    return {
        applied: Boolean(hookResult?.applied),
        logs: normalizeAbilityResultLogs(hookResult?.logs),
        selfStageDelta: normalizeStatStages(hookResult?.statePatches?.self?.statStages),
        opponentStageDelta: normalizeStatStages(hookResult?.statePatches?.opponent?.statStages),
        volatileState: {
            ...currentVolatile,
            switchInAbilityAppliedFor: normalizedAbility,
        },
    }
}

const resolveAbilitySpeed = ({ ability = '', baseSpeed = 1, weather = '', terrain = '', isSuppressed = false } = {}) => {
    const normalizedAbility = normalizeAbilityToken(ability)
    if (!normalizedAbility || normalizeAbilitySuppressed(isSuppressed)) {
        return {
            speed: Math.max(1, Math.floor(Number(baseSpeed) || 1)),
            logs: [],
        }
    }

    const hookResult = applyAbilityHook('beforeSpeedCalc', {
        ability: normalizedAbility,
        baseSpeed,
        weather,
        terrain,
    })
    const multiplier = clampAbilitySpeedMultiplier(hookResult?.statePatches?.self?.speedMultiplier, 1)
    return {
        speed: Math.max(1, Math.floor(Math.max(1, Number(baseSpeed) || 1) * multiplier)),
        logs: normalizeAbilityResultLogs(hookResult?.logs),
    }
}

const resolveAbilityHitDefense = ({ ability = '', incomingMoveType = '', incomingMoveCategory = '', didMoveHit = false, defenderCurrentHp = 0, defenderMaxHp = 1, resolutionContext = {}, isSuppressed = false } = {}) => {
    const bypassDecision = resolveAbilityBypassDecision({
        hookKey: 'hit_defense',
        ignoreTargetAbilityFromMove: resolutionContext?.ignoreTargetAbilityFromMove ?? resolutionContext?.ignoreTargetAbility,
        ignoreTargetAbilityFromAttackerAbility: resolutionContext?.ignoreTargetAbilityFromAttackerAbility,
    })
    if (bypassDecision.shouldBypass || normalizeAbilitySuppressed(isSuppressed)) {
        return {
            preventDamage: false,
            healHp: 0,
            logs: [],
        }
    }

    const normalizedAbility = normalizeAbilityToken(ability)
    if (!normalizedAbility) {
        return {
            preventDamage: false,
            healHp: 0,
            logs: [],
        }
    }

    const hookResult = applyAbilityHook('onTryHit', {
        ability: normalizedAbility,
        incomingMoveType,
        incomingMoveCategory,
        isDamagingMove: normalizeTypeToken(incomingMoveCategory) !== 'status',
        didMoveHit,
    })
    const preventDamage = Boolean(hookResult?.statePatches?.self?.preventDamage)
    const healFraction = clampFraction(hookResult?.statePatches?.self?.healFractionMaxHp, 0)
    const maxHp = Math.max(1, Number(defenderMaxHp) || 1)
    const currentHp = Math.max(0, Number(defenderCurrentHp) || 0)
    const healHp = preventDamage && healFraction > 0
        ? Math.max(0, Math.min(maxHp - currentHp, Math.max(1, Math.floor(maxHp * healFraction))))
        : 0

    return {
        preventDamage,
        healHp,
        logs: normalizeAbilityResultLogs(hookResult?.logs),
    }
}

const resolveAbilityStatusGuard = ({ ability = '', incomingStatus = '', resolutionContext = {}, isSuppressed = false } = {}) => {
    const bypassDecision = resolveAbilityBypassDecision({
        hookKey: 'status_guard',
        ignoreTargetAbilityFromMove: resolutionContext?.ignoreTargetAbilityFromMove ?? resolutionContext?.ignoreTargetAbility,
        ignoreTargetAbilityFromAttackerAbility: resolutionContext?.ignoreTargetAbilityFromAttackerAbility,
    })
    if (bypassDecision.shouldBypass || normalizeAbilitySuppressed(isSuppressed)) {
        return {
            preventStatus: false,
            logs: [],
        }
    }

    const normalizedAbility = normalizeAbilityToken(ability)
    const normalizedStatus = normalizeBattleStatus(incomingStatus)
    if (!normalizedAbility || !normalizedStatus) {
        return {
            preventStatus: false,
            logs: [],
        }
    }

    const hookResult = applyAbilityHook('onStatusAttempt', {
        ability: normalizedAbility,
        incomingStatus: normalizedStatus,
    })
    return {
        preventStatus: Boolean(hookResult?.statePatches?.self?.preventStatus),
        logs: normalizeAbilityResultLogs(hookResult?.logs),
    }
}

const resolveAbilitySuppressionMutations = ({
    selfSuppressed = false,
    opponentSuppressed = false,
    selfPatches = {},
    opponentPatches = {},
    selfLabel = 'Pokemon của bạn',
    opponentLabel = 'Mục tiêu',
} = {}) => {
    const normalizePatch = (value = {}) => (value && typeof value === 'object' ? value : {})
    const normalizedSelfPatches = normalizePatch(selfPatches)
    const normalizedOpponentPatches = normalizePatch(opponentPatches)

    const current = {
        self: normalizeAbilitySuppressed(selfSuppressed),
        opponent: normalizeAbilitySuppressed(opponentSuppressed),
    }
    const next = {
        self: current.self,
        opponent: current.opponent,
    }

    if (Boolean(normalizedSelfPatches?.clearAbilitySuppressed)) next.self = false
    if (Boolean(normalizedOpponentPatches?.clearAbilitySuppressed)) next.opponent = false
    if (Boolean(normalizedSelfPatches?.suppressAbility)) next.self = true
    if (Boolean(normalizedOpponentPatches?.suppressAbility)) next.opponent = true

    const logs = []
    if (!current.self && next.self) {
        logs.push(`${String(selfLabel || 'Pokemon của bạn').trim() || 'Pokemon của bạn'} bị áp chế Ability cho đến khi rời sân.`)
    } else if (current.self && !next.self) {
        logs.push(`${String(selfLabel || 'Pokemon của bạn').trim() || 'Pokemon của bạn'} không còn bị áp chế Ability.`)
    }
    if (!current.opponent && next.opponent) {
        logs.push(`${String(opponentLabel || 'Mục tiêu').trim() || 'Mục tiêu'} bị áp chế Ability cho đến khi rời sân.`)
    } else if (current.opponent && !next.opponent) {
        logs.push(`${String(opponentLabel || 'Mục tiêu').trim() || 'Mục tiêu'} không còn bị áp chế Ability.`)
    }

    return {
        selfSuppressed: next.self,
        opponentSuppressed: next.opponent,
        changed: next.self !== current.self || next.opponent !== current.opponent,
        logs,
    }
}

const resolveAbilityMutations = ({
    selfAbility = '',
    opponentAbility = '',
    selfPatches = {},
    opponentPatches = {},
    selfLabel = 'Pokemon của bạn',
    opponentLabel = 'Mục tiêu',
} = {}) => {
    const normalizePatch = (value = {}) => (value && typeof value === 'object' ? value : {})
    const normalizedSelfPatches = normalizePatch(selfPatches)
    const normalizedOpponentPatches = normalizePatch(opponentPatches)

    const current = {
        self: normalizeAbilityToken(selfAbility),
        opponent: normalizeAbilityToken(opponentAbility),
    }
    const next = {
        self: current.self,
        opponent: current.opponent,
    }

    const setSelfAbility = normalizeAbilityToken(normalizedSelfPatches?.setAbility)
    const setOpponentAbility = normalizeAbilityToken(normalizedOpponentPatches?.setAbility)
    if (setSelfAbility) next.self = setSelfAbility
    if (setOpponentAbility) next.opponent = setOpponentAbility

    if (Boolean(normalizedSelfPatches?.copyTargetAbility) && next.opponent) {
        next.self = next.opponent
    }
    if (Boolean(normalizedOpponentPatches?.copyTargetAbility) && next.self) {
        next.opponent = next.self
    }

    const shouldSwap = Boolean(
        normalizedSelfPatches?.swapAbilityWithTarget
        || normalizedSelfPatches?.swapAbilityWithUser
        || normalizedOpponentPatches?.swapAbilityWithTarget
        || normalizedOpponentPatches?.swapAbilityWithUser
    )
    if (shouldSwap) {
        const snapshotSelf = next.self
        next.self = next.opponent
        next.opponent = snapshotSelf
    }

    const changes = []
    if (next.self !== current.self) {
        changes.push(`${String(selfLabel || 'Pokemon của bạn').trim() || 'Pokemon của bạn'} đổi Ability thành ${next.self || 'không có'}.`)
    }
    if (next.opponent !== current.opponent) {
        changes.push(`${String(opponentLabel || 'Mục tiêu').trim() || 'Mục tiêu'} đổi Ability thành ${next.opponent || 'không có'}.`)
    }

    return {
        selfAbility: next.self,
        opponentAbility: next.opponent,
        changed: changes.length > 0,
        logs: changes,
    }
}

const formatBattleStatusLabel = (value = '') => {
    const normalized = normalizeBattleStatus(value)
    if (normalized === 'burn') return 'bỏng'
    if (normalized === 'poison') return 'trúng độc'
    if (normalized === 'paralyze') return 'tê liệt'
    if (normalized === 'freeze') return 'đóng băng'
    if (normalized === 'sleep') return 'ngủ'
    if (normalized === 'confuse') return 'rối loạn'
    if (normalized === 'flinch') return 'choáng'
    return String(value || '').trim().toLowerCase()
}

const buildBattleActionLog = ({
    actorName = 'Pokemon',
    moveName = 'Chiêu thức',
    didHit = false,
    damage = 0,
    hitCount = 1,
    isStatusMove = false,
    effectivenessText = '',
    missReason = 'trượt',
    suffix = '',
} = {}) => {
    const resolvedActorName = String(actorName || 'Pokemon').trim() || 'Pokemon'
    const resolvedMoveName = String(moveName || 'Chiêu thức').trim() || 'Chiêu thức'
    const trimmedSuffix = String(suffix || '').trim()

    if (!didHit) {
        return `${resolvedActorName} dùng ${resolvedMoveName} nhưng ${missReason}.${trimmedSuffix ? ` ${trimmedSuffix}` : ''}`.trim()
    }

    if (isStatusMove) {
        return `${resolvedActorName} dùng ${resolvedMoveName}!${trimmedSuffix ? ` ${trimmedSuffix}` : ''}`.trim()
    }

    return `${resolvedActorName} dùng ${resolvedMoveName}! Gây ${damage} sát thương${hitCount > 1 ? ` (${hitCount} đòn)` : ''}.${trimmedSuffix ? ` ${trimmedSuffix}` : ''}${effectivenessText ? ` ${effectivenessText}` : ''}`.trim()
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

const DEFAULT_TRAINER_PRIZE_LEVEL = 5
const USER_POKEMON_MAX_LEVEL = 3000

const battleAttackActionGuard = createActionGuard({
    actionKey: 'game:battle-attack',
    cooldownMs: 200,
    message: 'Ra đòn quá nhanh. Vui lòng đợi một chút.',
})

const normalizeMoveName = (value) => String(value || '').trim().toLowerCase()

const isVersionConflictError = (error) => {
    if (!error) return false
    if (String(error?.name || '').trim() === 'VersionError') return true
    const message = String(error?.message || '').trim().toLowerCase()
    return message.includes('no matching document found for id')
}

const getOrderedMaps = getOrderedMapsCached

router.use(autoSearchRoutes)
router.use(autoTrainerRoutes)
router.use(battleRoutes)
router.use(mapsRoutes)
router.use(searchRoutes)

// POST /api/game/click (protected)
router.post('/click', authMiddleware, (req, res) => {
    return res.status(410).json({
        ok: false,
        code: 'GAME_CLICK_DISABLED',
        message: 'Tính năng click đã bị vô hiệu hóa. Hãy dùng các hoạt động map/battle để kiếm tài nguyên.',
    })
})

router.use(encounterRoutes)

// POST /api/game/battle/attack (protected)
router.post('/battle/attack', authMiddleware, requireActiveGameplayTab({ actionLabel: 'tấn công battle' }), battleAttackActionGuard, async (req, res, next) => {
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
            resetMovePpState = false,
        } = req.body || {}

        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
            .select('pokemonId level experience moves movePpState nickname formId partyIndex ability')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'name baseStats rarity forms defaultFormId types abilities levelUpMoves')

        let activePokemon = normalizedActivePokemonId
            ? (party.find((entry) => String(entry?._id || '') === normalizedActivePokemonId) || null)
            : (party.find(Boolean) || null)
        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon đang hoạt động trong đội hình' })
        }

        let preloadedTrainerSession = null
        if (normalizedTrainerId) {
            preloadedTrainerSession = await BattleSession.findOne({ userId, trainerId: normalizedTrainerId })
        }

        if (Boolean(resetMovePpState) || (normalizedTrainerId && Boolean(resetTrainerSession))) {
            const allPartyMoveNames = [...new Set(
                party.flatMap((entry) => mergeKnownMovesWithFallback(entry?.moves))
            )]
            const battleStartMoveLookupMap = await buildMoveLookupByName(allPartyMoveNames)
            const refillSaveTasks = []

            party.forEach((entry) => {
                const entryMoveNames = mergeKnownMovesWithFallback(entry?.moves)
                const refilledMovePpState = buildMovePpStateFromMoves({
                    moveNames: entryMoveNames,
                    movePpState: [],
                    moveLookupMap: battleStartMoveLookupMap,
                }).map((moveEntry) => ({
                    moveName: moveEntry.moveName,
                    currentPp: Math.max(1, Number(moveEntry?.maxPp) || 1),
                    maxPp: Math.max(1, Number(moveEntry?.maxPp) || 1),
                }))

                if (!isMovePpStateEqual(entry.movePpState, refilledMovePpState)) {
                    entry.movePpState = refilledMovePpState
                    refillSaveTasks.push(entry.save())
                }
            })

            if (refillSaveTasks.length > 0) {
                await Promise.all(refillSaveTasks)
            }
        }

        const attackerLevel = Math.max(1, Number(activePokemon.level) || 1)
        const attackerSpecies = activePokemon?.pokemonId || {}
        const knownMoves = mergeKnownMovesWithFallback(activePokemon.moves)
        const normalizedKnownMoves = new Set(knownMoves.map((item) => normalizeMoveName(item)))
        const knownMoveLookupMap = await buildMoveLookupByName(knownMoves)
        const authoritativeMovePpState = buildMovePpStateFromMoves({
            moveNames: knownMoves,
            movePpState: activePokemon.movePpState,
            moveLookupMap: knownMoveLookupMap,
        })
        const authoritativeMovePpStateMap = new Map(
            authoritativeMovePpState
                .map((entry) => [normalizeMoveName(entry?.moveName), entry])
                .filter(([key]) => Boolean(key))
        )

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
        const moveLookupCache = new Map()
        const getMoveDocByName = async (moveName = '') => {
            const moveKey = normalizeMoveName(moveName)
            if (!moveKey || moveKey === 'struggle') return null
            if (moveLookupCache.has(moveKey)) return moveLookupCache.get(moveKey)

            const movePromise = Move.findOne({ nameLower: moveKey }).lean()
            moveLookupCache.set(moveKey, movePromise)
            const resolvedMove = await movePromise
            moveLookupCache.set(moveKey, resolvedMove || null)
            return resolvedMove || null
        }

        const moveDoc = await getMoveDocByName(selectedMoveName)

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
        const moveEffectSpecs = resolveRuntimeMoveEffectSpecs({
            moveDoc,
            fallbackMove: move,
        })
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
            const storedMovePpEntry = authoritativeMovePpStateMap.get(normalizeMoveName(selectedMoveName)) || null
            const fallbackMaxPpRaw = Number(moveDoc?.pp)
            const storedMaxPpRaw = Number(storedMovePpEntry?.maxPp)
            const payloadMaxPpRaw = Number(move?.maxPp)
            const maxPp = Number.isFinite(storedMaxPpRaw) && storedMaxPpRaw > 0
                ? Math.max(1, Math.floor(storedMaxPpRaw))
                : (Number.isFinite(payloadMaxPpRaw) && payloadMaxPpRaw > 0
                    ? Math.max(1, Math.floor(payloadMaxPpRaw))
                    : (Number.isFinite(fallbackMaxPpRaw) && fallbackMaxPpRaw > 0
                        ? Math.max(1, Math.floor(fallbackMaxPpRaw))
                        : 10))

            const storedCurrentPpRaw = Number(storedMovePpEntry?.currentPp)
            const clientReportedPpRaw = Number(move?.currentPp ?? move?.pp)
            let currentPp = Number.isFinite(storedCurrentPpRaw)
                ? Math.max(0, Math.min(maxPp, Math.floor(storedCurrentPpRaw)))
                : (Number.isFinite(clientReportedPpRaw)
                    ? Math.max(0, Math.min(maxPp, Math.floor(clientReportedPpRaw)))
                    : maxPp)

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

        let cachedPlayerBattleBadgeBonusState = null
        const getPlayerBattleBadgeBonusState = async () => {
            if (cachedPlayerBattleBadgeBonusState) return cachedPlayerBattleBadgeBonusState

            const hasActiveTrainerSessionSnapshot = Boolean(
                normalizedTrainerId
                && hasActiveTrainerBattleSession(preloadedTrainerSession, new Date())
                && hasBattleBadgeSnapshot(preloadedTrainerSession)
            )

            if (hasActiveTrainerSessionSnapshot) {
                cachedPlayerBattleBadgeBonusState = resolveBattleBadgeBonusState(preloadedTrainerSession.badgeSnapshot, attackerTypes)
                return cachedPlayerBattleBadgeBonusState
            }

            const activeBadgeBonuses = await getCachedActiveBadgeBonuses(req.user.userId)
            cachedPlayerBattleBadgeBonusState = resolveBattleBadgeBonusState(activeBadgeBonuses, attackerTypes)
            return cachedPlayerBattleBadgeBonusState
        }

        let badgeBonusState = await getPlayerBattleBadgeBonusState()
        let playerMaxHp = resolvePlayerBattleMaxHp({
            baseHp: attackerBaseStats?.hp,
            level: attackerLevel,
            rarity: attackerSpecies?.rarity || 'd',
            hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
        })
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
        let requestedPlayerCurrentHp = clamp(
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
        let playerAbility = normalizeAbilityToken(player?.ability)
        let playerAbilitySuppressed = normalizeAbilitySuppressed(player?.abilitySuppressed)
        let playerStatStages = {}
        let playerDamageGuards = {}
        let playerWasDamagedLastTurn = Boolean(player?.wasDamagedLastTurn)
        let playerVolatileState = normalizeVolatileState(player?.volatileState)
        let battleFieldState = normalizeFieldState(fieldState)
        let opponentStatus = normalizeBattleStatus(opponent?.status)
        let opponentStatusTurns = normalizeStatusTurns(opponent?.statusTurns)
        let opponentAbility = normalizeAbilityToken(opponent?.ability)
        let opponentAbilitySuppressed = normalizeAbilitySuppressed(opponent?.abilitySuppressed)
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
            const currentTurnStartedAt = new Date()
            const existingTrainerSession = preloadedTrainerSession || await BattleSession.findOne({ userId, trainerId: normalizedTrainerId })
            const hasStoredActiveTrainerSession = hasActiveTrainerBattleSession(existingTrainerSession, currentTurnStartedAt)
            let trainer = null

            selectedCounterMoveInput = null
            selectedCounterMoveIndex = -1
            nextCounterMoveCursor = 0
            counterMoveState = []
            hasCounterMoveList = false

            if (!hasStoredActiveTrainerSession) {
                trainer = await loadTrainerBattleCombatView(normalizedTrainerId)
                if (!trainer) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
                }
                trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainer, null, existingTrainerSession)
            } else {
                trainerSession = existingTrainerSession
            }

            const hasSessionBadgeSnapshot = hasBattleBadgeSnapshot(trainerSession)
            let trainerBadgeSummary = null
            if (Boolean(resetTrainerSession) || !hasStoredActiveTrainerSession) {
                trainerSession.badgeSnapshot = await getCachedActiveBadgeBonuses(req.user.userId)
                trainerBadgeSummary = trainerSession.badgeSnapshot
                trainerSessionDirty = true
            } else {
                trainerBadgeSummary = await resolveOrHydrateBattleBadgeSnapshot(trainerSession, req.user.userId)
                if (!hasSessionBadgeSnapshot) {
                    trainerSessionDirty = true
                }
            }

            badgeBonusState = resolveBattleBadgeBonusState(trainerBadgeSummary || trainerSession.badgeSnapshot, attackerTypes)
            cachedPlayerBattleBadgeBonusState = badgeBonusState
            playerMaxHp = resolvePlayerBattleMaxHp({
                baseHp: attackerBaseStats?.hp,
                level: attackerLevel,
                rarity: attackerSpecies?.rarity || 'd',
                hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
            })
            playerCurrentHp = clamp(
                Math.floor(Number.isFinite(parsedPlayerCurrentHp) ? parsedPlayerCurrentHp : playerMaxHp),
                0,
                playerMaxHp
            )
            requestedPlayerCurrentHp = clamp(
                Math.floor(Number.isFinite(Number(player?.currentHp)) ? Number(player.currentHp) : playerMaxHp),
                0,
                playerMaxHp
            )
            preloadedTrainerSession = trainerSession

            if (Boolean(resetTrainerSession)) {
                trainer = trainer || await loadTrainerBattleCombatView(normalizedTrainerId)
                if (!trainer) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
                }
                trainerSession.team = buildTrainerBattleTeam(trainer)
                trainerSession.playerTeam = []
                trainerSession.knockoutCounts = []
                trainerSession.currentIndex = 0
                trainerSession.playerPokemonId = activePokemon._id
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = playerMaxHp
                trainerSession.playerStatus = ''
                trainerSession.playerStatusTurns = 0
                trainerSession.playerAbility = resolveBattleAbilityForPokemon({
                    userPokemon: activePokemon,
                    species: attackerSpecies,
                })
                trainerSession.playerAbilitySuppressed = false
                trainerSession.playerStatStages = {}
                trainerSession.playerDamageGuards = {}
                trainerSession.playerWasDamagedLastTurn = false
                trainerSession.playerVolatileState = {}
                trainerSession.fieldState = {}
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }

            await ensureTrainerSessionPlayerParty({
                trainerSession,
                userId,
                preferredActivePokemonId: activePokemon._id,
                preloadedParty: party,
                hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
            })

            const activePokemonIdString = String(activePokemon._id)
            const activePlayerPartyEntry = Array.isArray(trainerSession.playerTeam)
                ? trainerSession.playerTeam.find((entry) => String(entry?.userPokemonId || '') === activePokemonIdString)
                : null
            if (activePlayerPartyEntry) {
                trainerSession.playerPokemonId = activePlayerPartyEntry.userPokemonId
                trainerSession.playerMaxHp = Math.max(1, Number(activePlayerPartyEntry.maxHp || playerMaxHp))
                trainerSession.playerCurrentHp = Math.max(0, Number(activePlayerPartyEntry.currentHp || 0))
                trainerSession.playerStatus = normalizeBattleStatus(activePlayerPartyEntry.status)
                trainerSession.playerStatusTurns = normalizeStatusTurns(activePlayerPartyEntry.statusTurns)
                trainerSession.playerAbility = normalizeAbilityToken(activePlayerPartyEntry.ability)
                trainerSession.playerAbilitySuppressed = normalizeAbilitySuppressed(activePlayerPartyEntry.abilitySuppressed)
            }

            if (String(trainerSession.playerPokemonId || '') !== activePokemonIdString) {
                trainerSession.playerPokemonId = activePokemon._id
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = requestedPlayerCurrentHp
                trainerSession.playerStatus = requestedPlayerStatus
                trainerSession.playerStatusTurns = requestedPlayerStatusTurns
                trainerSession.playerAbility = resolveBattleAbilityForPokemon({
                    userPokemon: activePokemon,
                    species: attackerSpecies,
                })
                trainerSession.playerAbilitySuppressed = false
                syncTrainerSessionActivePlayerToParty(trainerSession)
                trainerSessionDirty = true
            }

            playerAbility = normalizeAbilityToken(trainerSession.playerAbility)
            playerAbilitySuppressed = normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed)

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
            activeTrainerOpponent.ability = normalizeAbilityToken(activeTrainerOpponent.ability)
            activeTrainerOpponent.abilitySuppressed = normalizeAbilitySuppressed(activeTrainerOpponent.abilitySuppressed)
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
            const hasStoredTrainerMovePool = Array.isArray(activeTrainerOpponent?.counterMoves) && activeTrainerOpponent.counterMoves.length > 0
            const hasStoredTrainerTypes = Array.isArray(activeTrainerOpponent?.types) && activeTrainerOpponent.types.length > 0
            if (!hasStoredTrainerMovePool || !hasStoredTrainerTypes) {
                trainer = trainer || await loadTrainerBattleCombatView(normalizedTrainerId)
                if (!trainer) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
                }
            }
            const trainerTeamEntry = Array.isArray(trainer?.team)
                ? trainer.team[trainerSlot]
                : null
            trainerPokemonDamagePercent = normalizeTrainerPokemonDamagePercent(
                activeTrainerOpponent?.damagePercent ?? trainerTeamEntry?.damagePercent,
                100
            )
            activeTrainerOpponent.damagePercent = trainerPokemonDamagePercent
            const trainerSpecies = trainerTeamEntry?.pokemonId || null
            const trainerResolvedAbility = resolveBattleAbilityForPokemon({
                species: trainerSpecies,
                fallbackAbility: activeTrainerOpponent?.ability,
            })
            activeTrainerOpponent.ability = trainerResolvedAbility
            opponentAbility = trainerResolvedAbility
            opponentAbilitySuppressed = normalizeAbilitySuppressed(activeTrainerOpponent.abilitySuppressed)
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
                        const moveEffectSpecs = resolveRuntimeMoveEffectSpecs({
                            moveDoc: moveDocEntry,
                            fallbackMove: storedCounterMove,
                        })
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
            playerAbility = normalizeAbilityToken(trainerSession.playerAbility)
            playerAbilitySuppressed = normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed)
            playerStatStages = normalizeStatStages(trainerSession.playerStatStages)
            playerDamageGuards = normalizeDamageGuards(trainerSession.playerDamageGuards)
            playerWasDamagedLastTurn = Boolean(trainerSession.playerWasDamagedLastTurn)
            playerVolatileState = normalizeVolatileState(trainerSession.playerVolatileState)
            battleFieldState = normalizeFieldState(trainerSession.fieldState)
            opponentStatus = normalizeBattleStatus(activeTrainerOpponent.status)
            opponentStatusTurns = normalizeStatusTurns(activeTrainerOpponent.statusTurns)
            opponentAbility = normalizeAbilityToken(activeTrainerOpponent.ability)
            opponentAbilitySuppressed = normalizeAbilitySuppressed(activeTrainerOpponent.abilitySuppressed)
            opponentStatStages = normalizeStatStages(activeTrainerOpponent.statStages)
            opponentDamageGuards = normalizeDamageGuards(activeTrainerOpponent.damageGuards)
            opponentWasDamagedLastTurn = Boolean(activeTrainerOpponent.wasDamagedLastTurn)
            opponentVolatileState = normalizeVolatileState(activeTrainerOpponent.volatileState)
        }

        if (!normalizedTrainerId) {
            playerStatus = normalizeBattleStatus(player?.status)
            playerStatusTurns = normalizeStatusTurns(player?.statusTurns)
            playerAbility = normalizeAbilityToken(player?.ability)
            playerAbilitySuppressed = normalizeAbilitySuppressed(player?.abilitySuppressed)
            playerStatStages = normalizeStatStages(player?.statStages)
            playerDamageGuards = normalizeDamageGuards(player?.damageGuards)
            playerVolatileState = normalizeVolatileState(player?.volatileState)
            opponentAbility = normalizeAbilityToken(opponent?.ability)
            opponentAbilitySuppressed = normalizeAbilitySuppressed(opponent?.abilitySuppressed)
        }

        const pendingTurnStartAbilityLogs = []
        const weatherToken = String(battleFieldState?.weather || '').trim().toLowerCase()
        const terrainToken = String(battleFieldState?.terrain || '').trim().toLowerCase()
        let didResolveSwitchInAbility = false

        if (playerCurrentHp > 0 && playerAbility) {
            const playerSwitchInResult = resolveAbilitySwitchIn({
                ability: playerAbility,
                isSuppressed: playerAbilitySuppressed,
                weather: weatherToken,
                terrain: terrainToken,
                volatileState: playerVolatileState,
                actorName: activePokemon.nickname || attackerSpecies?.name || 'Pokemon của bạn',
                targetName: targetName || 'Mục tiêu',
            })
            playerVolatileState = playerSwitchInResult.volatileState
            playerStatStages = combineStatStageDeltas(playerStatStages, playerSwitchInResult.selfStageDelta)
            opponentStatStages = combineStatStageDeltas(opponentStatStages, playerSwitchInResult.opponentStageDelta)
            pendingTurnStartAbilityLogs.push(...playerSwitchInResult.logs)
            if (playerSwitchInResult.applied
                || Object.keys(playerSwitchInResult.selfStageDelta).length > 0
                || Object.keys(playerSwitchInResult.opponentStageDelta).length > 0
            ) {
                didResolveSwitchInAbility = true
            }
        }

        if (targetCurrentHp > 0 && opponentAbility) {
            const opponentSwitchInResult = resolveAbilitySwitchIn({
                ability: opponentAbility,
                isSuppressed: opponentAbilitySuppressed,
                weather: weatherToken,
                terrain: terrainToken,
                volatileState: opponentVolatileState,
                actorName: targetName || 'Pokemon đối thủ',
                targetName: activePokemon.nickname || attackerSpecies?.name || 'Pokemon của bạn',
            })
            opponentVolatileState = opponentSwitchInResult.volatileState
            opponentStatStages = combineStatStageDeltas(opponentStatStages, opponentSwitchInResult.selfStageDelta)
            playerStatStages = combineStatStageDeltas(playerStatStages, opponentSwitchInResult.opponentStageDelta)
            pendingTurnStartAbilityLogs.push(...opponentSwitchInResult.logs)
            if (opponentSwitchInResult.applied
                || Object.keys(opponentSwitchInResult.selfStageDelta).length > 0
                || Object.keys(opponentSwitchInResult.opponentStageDelta).length > 0
            ) {
                didResolveSwitchInAbility = true
            }
        }

        if (trainerSession && didResolveSwitchInAbility) {
            trainerSessionDirty = true
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
        const moveRequirement = selectMoveEffects?.statePatches?.self?.moveRequirement
            && typeof selectMoveEffects.statePatches.self.moveRequirement === 'object'
            ? selectMoveEffects.statePatches.self.moveRequirement
            : null

        const defaultOpponentMovePower = clamp(Math.floor(35 + targetLevel * 1.2), 25, 120)
        let selectedOpponentMove = selectedCounterMoveInput
        let selectedOpponentMoveName = String(selectedOpponentMove?.name || '').trim()
        let selectedOpponentMoveKey = normalizeMoveName(selectedOpponentMoveName)
        let opponentMoveDoc = null

        if (selectedOpponentMoveKey && selectedOpponentMoveKey !== 'struggle') {
            opponentMoveDoc = await getMoveDocByName(selectedOpponentMoveKey)
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

        const opponentMoveEffectSpecs = resolveRuntimeMoveEffectSpecs({
            moveDoc: opponentMoveDoc,
            fallbackMove: selectedOpponentMove,
        })

        const playerBaseEffectiveSpeed = applyStatStageToValue(
            Math.max(1, Math.floor(applyPercentMultiplier(Number(attackerScaledStats?.spd) || 1, badgeBonusState?.speedBonusPercent || 0))),
            playerStatStages?.spd
        )
        const opponentBaseEffectiveSpeed = applyStatStageToValue(
            Math.max(1, Number(activeTrainerOpponent?.baseStats?.spd) || Number(opponent?.baseStats?.spd) || 1),
            opponentStatStages?.spd
        )
        const playerSpeedByAbility = resolveAbilitySpeed({
            ability: playerAbility,
            isSuppressed: playerAbilitySuppressed,
            baseSpeed: playerBaseEffectiveSpeed,
            weather: weatherToken,
            terrain: terrainToken,
        })
        const opponentSpeedByAbility = resolveAbilitySpeed({
            ability: opponentAbility,
            isSuppressed: opponentAbilitySuppressed,
            baseSpeed: opponentBaseEffectiveSpeed,
            weather: weatherToken,
            terrain: terrainToken,
        })
        pendingTurnStartAbilityLogs.push(...playerSpeedByAbility.logs)
        pendingTurnStartAbilityLogs.push(...opponentSpeedByAbility.logs)
        const playerEffectiveSpeed = playerSpeedByAbility.speed
        const opponentEffectiveSpeed = opponentSpeedByAbility.speed

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
        const turnTimeline = createTurnTimeline({ playerActsFirst })
        const playerTurnPhaseKeys = resolveTurnActorPhaseKeys(turnTimeline, 'player')
        const opponentTurnPhaseKeys = resolveTurnActorPhaseKeys(turnTimeline, 'opponent')
        const appendPhaseEvent = (phaseKey, actor, kind, line, payload = {}) => appendTurnPhaseEvent(turnTimeline, {
            phaseKey,
            actor,
            kind,
            line,
            ...payload,
        })
        const appendPhaseLines = (phaseKey, actor, kind, lines, payload = {}) => appendTurnPhaseLines(turnTimeline, {
            phaseKey,
            actor,
            kind,
            lines,
            ...payload,
        })
        if (pendingTurnStartAbilityLogs.length > 0) {
            appendPhaseLines('turn_start', 'system', 'ability_trigger', pendingTurnStartAbilityLogs, {
                source: 'ability',
            })
        }
        if (moveFallbackReason === 'OUT_OF_PP') {
            appendPhaseEvent(
                playerTurnPhaseKeys.preAction,
                'player',
                'move_fallback',
                `Chiêu ${moveFallbackFrom || 'đã chọn'} đã hết PP, hệ thống tự chuyển sang Struggle.`,
                {
                    moveName: moveFallbackFrom || selectedMoveName,
                    fallbackMoveName: 'Struggle',
                }
            )
        }
        if (turnOrderReason === 'speed') {
            appendPhaseEvent(
                'turn_start',
                'system',
                'turn_order_decided',
                playerActsFirst
                    ? `Bạn có tốc độ cao hơn (${playerEffectiveSpeed} > ${opponentEffectiveSpeed}) nên được ra đòn trước.`
                    : `Đối thủ có tốc độ cao hơn (${opponentEffectiveSpeed} > ${playerEffectiveSpeed}) nên được ra đòn trước.`,
                {
                    reason: 'speed',
                    firstActor: playerActsFirst ? 'player' : 'opponent',
                    playerSpeed: playerEffectiveSpeed,
                    opponentSpeed: opponentEffectiveSpeed,
                }
            )
        } else if (turnOrderReason === 'priority') {
            appendPhaseEvent(
                'turn_start',
                'system',
                'turn_order_decided',
                playerActsFirst
                    ? `Chiêu của bạn có ưu tiên cao hơn (${movePriority} > ${opponentMovePriority}) nên được ra đòn trước.`
                    : `Chiêu của đối thủ có ưu tiên cao hơn (${opponentMovePriority} > ${movePriority}) nên đối thủ ra đòn trước.`,
                {
                    reason: 'priority',
                    firstActor: playerActsFirst ? 'player' : 'opponent',
                    playerPriority: movePriority,
                    opponentPriority: opponentMovePriority,
                }
            )
        } else if (turnOrderReason === 'speed-tie') {
            appendPhaseEvent(
                'turn_start',
                'system',
                'turn_order_decided',
                'Hai bên có cùng độ ưu tiên và tốc độ, thứ tự ra đòn được quyết định ngẫu nhiên.',
                {
                    reason: 'speed-tie',
                    firstActor: playerActsFirst ? 'player' : 'opponent',
                    playerSpeed: playerEffectiveSpeed,
                    opponentSpeed: opponentEffectiveSpeed,
                    playerPriority: movePriority,
                    opponentPriority: opponentMovePriority,
                }
            )
        }
        const playerTurnStartHp = playerCurrentHp
        const opponentTurnStartHp = targetCurrentHp
        let counterAttack = null
        let resultingPlayerHp = playerCurrentHp
        let playerForcedSwitchInfo = null

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
                appendPhaseEvent(opponentTurnPhaseKeys.preAction, 'opponent', 'cannot_act', `${targetName} cần hồi sức nên không thể hành động.`, {
                    reason: 'recharge',
                    target: 'opponent',
                })
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
                appendPhaseEvent(opponentTurnPhaseKeys.preAction, 'opponent', 'status_check', `${targetName}: ${opponentTurnStatusCheck.log}`, {
                    reason: String(opponentTurnStatusCheck.reason || '').trim().toLowerCase(),
                    target: 'opponent',
                    status: opponentStatus,
                })
            }

            const didOpponentMoveHit = canOpponentAct && (Math.random() * 100) <= opponentMoveAccuracy
            const opponentHasMoldBreakerBypass = canOpponentAct && hasMoldBreakerStyleBypass({
                attackerAbility: opponentAbility,
                attackerAbilitySuppressed: opponentAbilitySuppressed,
            })
            const opponentIgnoreTargetFromMove = canOpponentAct
                ? resolveIgnoreTargetAbilityFromEffectSpecs({
                    effectSpecs: opponentMoveEffectSpecs,
                    random: randomFn,
                    triggers: ['on_select_move', 'on_calculate_damage', 'before_accuracy_check', 'on_hit'],
                })
                : { ignoreTargetAbility: false, ignoreTargetAbilityMode: 'ignore', logs: [] }
            const opponentAbilityResolutionContext = canOpponentAct
                ? buildAbilityResolutionContext(
                    {
                        ignoreTargetAbilityFromMove: opponentIgnoreTargetFromMove.ignoreTargetAbility,
                        ignoreTargetAbilityFromAttackerAbility: opponentHasMoldBreakerBypass,
                        ignoreTargetAbilityMode: opponentIgnoreTargetFromMove.ignoreTargetAbilityMode,
                        logs: [
                            ...opponentIgnoreTargetFromMove.logs,
                            ...(opponentHasMoldBreakerBypass
                                ? [`${formatAbilityName(opponentAbility)} giúp bỏ qua Ability phòng thủ của mục tiêu trong lần xử lý này.`]
                                : []),
                        ],
                    }
                )
                : buildAbilityResolutionContext()
            const opponentAbilitySuppressionFromMove = canOpponentAct
                ? resolveSuppressTargetAbilityFromEffectSpecs({
                    effectSpecs: opponentMoveEffectSpecs,
                    random: randomFn,
                    triggers: ['on_select_move', 'on_calculate_damage', 'before_accuracy_check', 'on_hit'],
                    targetMovedBeforeAction: playerActsFirst,
                })
                : { suppressTargetAbility: false, logs: [] }
            const playerAbilityDefense = resolveAbilityHitDefense({
                ability: playerAbility,
                incomingMoveType: opponentMoveType,
                incomingMoveCategory: opponentMoveCategory,
                didMoveHit: didOpponentMoveHit,
                defenderCurrentHp: playerCurrentHp,
                defenderMaxHp: playerMaxHp,
                resolutionContext: opponentAbilityResolutionContext,
                isSuppressed: playerAbilitySuppressed,
            })
            const opponentMoveBlockedByAbility = didOpponentMoveHit && playerAbilityDefense.preventDamage
            const opponentTypeEffectiveness = resolveTypeEffectiveness(opponentMoveType, attackerTypes)
            const opponentStabMultiplier = targetTypes.includes(opponentMoveType) ? 1.5 : 1
            const playerCritBlockTurns = normalizeStatusTurns(playerVolatileState?.critBlockTurns)
            const didOpponentCritical = canOpponentAct
                && didOpponentMoveHit
                && playerCritBlockTurns <= 0
                && Math.random() < opponentMoveCriticalChance
            if (canOpponentAct && didOpponentMoveHit && playerCritBlockTurns > 0) {
                appendPhaseEvent(opponentTurnPhaseKeys.postAction, 'system', 'critical_blocked', 'Pokemon của bạn được bảo vệ khỏi đòn chí mạng.', {
                    target: 'player',
                })
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
            const rawCounterDamage = (!canOpponentAct
                || !didOpponentMoveHit
                || opponentMoveCategory === 'status'
                || opponentTypeEffectiveness.multiplier <= 0
                || opponentMoveBlockedByAbility)
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
                appendPhaseEvent(opponentTurnPhaseKeys.postAction, 'system', 'damage_reduced', 'Pokemon của bạn giảm sát thương nhờ hiệu ứng phòng thủ.', {
                    target: 'player',
                })
            }
            if (playerAbilityDefense.logs.length > 0) {
                appendPhaseLines(opponentTurnPhaseKeys.postAction, 'system', 'ability_trigger', playerAbilityDefense.logs, {
                    target: 'player',
                    source: 'ability',
                })
            }
            if (opponentAbilityResolutionContext.ignoreTargetAbility && opponentAbilityResolutionContext.logs.length > 0) {
                appendPhaseLines(opponentTurnPhaseKeys.postAction, 'system', 'ability_ignore', opponentAbilityResolutionContext.logs, {
                    target: 'player',
                    source: opponentAbilityResolutionContext.ignoreTargetAbilitySource || 'move_effects',
                })
            }
            if (didOpponentMoveHit && opponentAbilitySuppressionFromMove.suppressTargetAbility) {
                playerAbilitySuppressed = true
                if (opponentAbilitySuppressionFromMove.logs.length > 0) {
                    appendPhaseLines(opponentTurnPhaseKeys.postAction, 'system', 'ability_suppressed', opponentAbilitySuppressionFromMove.logs, {
                        target: 'player',
                        source: 'move_effects',
                    })
                }
            }
            const nextPlayerHp = opponentMoveBlockedByAbility
                ? Math.min(playerMaxHp, playerCurrentHp + playerAbilityDefense.healHp)
                : Math.max(0, playerCurrentHp - counterDamage)
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
                    ? ''
                    : buildBattleActionLog({
                        actorName: targetName,
                        moveName: selectedOpponentMoveName,
                        didHit: didOpponentMoveHit,
                        damage: counterDamage,
                        isStatusMove: opponentMoveCategory === 'status',
                        effectivenessText: resolveEffectivenessText(opponentTypeEffectiveness.multiplier),
                    }),
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
                targetMovedBeforeAction: !playerActsFirst,
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
            appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'cannot_act', 'Pokemon của bạn cần hồi sức nên không thể hành động.', {
                reason: 'recharge',
                target: 'player',
            })
        }

        const lockedRepeatMoveName = String(playerVolatileState?.lockedRepeatMoveName || '').trim()
        const lockedRepeatMoveKey = normalizeMoveName(lockedRepeatMoveName)
        if (canPlayerActByVolatile && lockedRepeatMoveKey && normalizeMoveName(selectedMoveName) === lockedRepeatMoveKey) {
            canPlayerActByVolatile = false
            appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'move_blocked', `Chiêu ${selectedMoveName} không thể dùng liên tiếp.`, {
                reason: 'repeat_lock',
                moveName: selectedMoveName,
            })
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
                appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'move_blocked', 'Pokemon của bạn bị khiêu khích nên không thể dùng chiêu trạng thái.', {
                    reason: 'status_move_block',
                    moveName: selectedMoveName,
                })
            }
        }

        const moveBlockedByTerrainRequirement = requireTerrain && !battleFieldState.terrain
        const moveBlockedByRequirement = Boolean(moveRequirement?.failed)
        const canPlayerAct = playerCurrentHp > 0 && Boolean(playerTurnStatusCheck.canAct) && canPlayerActByVolatile

        if (moveBlockedByTerrainRequirement) {
            appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'move_failed', 'Chiêu này thất bại vì sân đấu không có địa hình phù hợp.', {
                reason: 'terrain_requirement',
                moveName: selectedMoveName,
            })
        }
        if (moveBlockedByRequirement) {
            appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'move_failed', String(moveRequirement?.message || 'Chiêu này chưa thỏa điều kiện để sử dụng.'), {
                reason: String(moveRequirement?.condition || 'move_requirement').trim() || 'move_requirement',
                moveName: selectedMoveName,
            })
        }
        const canResolvePlayerMoveEffects = canPlayerAct && !moveBlockedByTerrainRequirement && !moveBlockedByRequirement
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
            appendPhaseEvent(playerTurnPhaseKeys.preAction, 'player', 'status_check', `Pokemon của bạn: ${playerTurnStatusCheck.log}`, {
                reason: String(playerTurnStatusCheck.reason || '').trim().toLowerCase(),
                target: 'player',
                status: playerStatus,
            })
        }

        const beforeAccuracyEffects = canResolvePlayerMoveEffects
            ? applyEffectSpecs({
                effectSpecs: effectSpecsByTrigger(moveEffectSpecs, 'before_accuracy_check'),
                context: { random: randomFn },
            })
            : createEmptyEffectAggregate()
        const forcedHit = canPlayerAct && !moveBlockedByTerrainRequirement && !moveBlockedByRequirement
            && (Boolean(beforeAccuracyEffects?.statePatches?.self?.neverMiss) || pendingNeverMiss)
        const didPlayerMoveHit = canPlayerAct && !moveBlockedByTerrainRequirement && !moveBlockedByRequirement
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
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'critical_blocked', `${targetName} được bảo vệ khỏi đòn chí mạng.`, {
                target: 'opponent',
            })
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
                    targetMovedBeforeAction: !playerActsFirst,
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
        const consumedPendingCrit = pendingAlwaysCrit && canResolvePlayerMoveEffects && !isStatusMove
        const consumedPendingNeverMiss = pendingNeverMiss && canResolvePlayerMoveEffects && !isStatusMove
        const shouldForceTargetKo = Boolean(onHitSelfPatch?.forceTargetKo)
        const shouldUseUserCurrentHpAsDamage = Boolean(onHitSelfPatch?.fixedDamageFromUserCurrentHp)
        const fixedDamageValue = Math.max(0, Math.floor(Number(onHitSelfPatch?.fixedDamageValue) || 0))
        const fixedDamageFractionTargetCurrentHp = clampFraction(onHitSelfPatch?.fixedDamageFractionTargetCurrentHp, 0)
        const minTargetHpAfterHit = Math.max(0, Math.floor(Number(onHitSelfPatch?.minTargetHp || 0)))
        const targetIgnoreFromMove = resolveIgnoreTargetAbilityFromEffectAggregates({
            aggregates: [
                selectMoveEffects,
                damageCalcEffects,
                beforeAccuracyEffects,
                onHitEffects,
            ],
        })
        const playerHasMoldBreakerBypass = hasMoldBreakerStyleBypass({
            attackerAbility: playerAbility,
            attackerAbilitySuppressed: playerAbilitySuppressed,
        })
        const targetAbilityResolutionContext = buildAbilityResolutionContext({
            ignoreTargetAbilityFromMove: targetIgnoreFromMove.ignoreTargetAbility,
            ignoreTargetAbilityFromAttackerAbility: playerHasMoldBreakerBypass,
            ignoreTargetAbilityMode: targetIgnoreFromMove.ignoreTargetAbilityMode,
            logs: [
                ...targetIgnoreFromMove.logs,
                ...(playerHasMoldBreakerBypass
                    ? [`${formatAbilityName(playerAbility)} giúp bỏ qua Ability phòng thủ của mục tiêu trong lần xử lý này.`]
                    : []),
            ],
        })
        const opponentAbilityDefense = resolveAbilityHitDefense({
            ability: opponentAbility,
            incomingMoveType: moveType,
            incomingMoveCategory: moveCategory,
            didMoveHit: didPlayerMoveHit,
            defenderCurrentHp: targetCurrentHp,
            defenderMaxHp: targetMaxHp,
            resolutionContext: targetAbilityResolutionContext,
            isSuppressed: opponentAbilitySuppressed,
        })
        const playerMoveBlockedByAbility = didPlayerMoveHit && opponentAbilityDefense.preventDamage

        const rawSingleHitDamage = (!canPlayerAct
            || !didPlayerMoveHit
            || isStatusMove
            || playerTypeEffectiveness.multiplier <= 0
            || playerMoveBlockedByAbility)
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
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'damage_reduced', `${targetName} giảm sát thương nhờ hiệu ứng phòng thủ.`, {
                target: 'opponent',
            })
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
        if (playerMoveBlockedByAbility) {
            damage = 0
        }
        if (opponentAbilityDefense.logs.length > 0) {
            appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_trigger', opponentAbilityDefense.logs, {
                target: 'opponent',
                source: 'ability',
            })
        }
        if (targetAbilityResolutionContext.ignoreTargetAbility && targetAbilityResolutionContext.logs.length > 0) {
            appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_ignore', targetAbilityResolutionContext.logs, {
                target: 'opponent',
                source: targetAbilityResolutionContext.ignoreTargetAbilitySource || 'move_effects',
            })
        }
        let currentHp = playerMoveBlockedByAbility
            ? Math.min(targetMaxHp, targetCurrentHp + opponentAbilityDefense.healHp)
            : Math.max(0, targetCurrentHp - damage)
        if (minTargetHpAfterHit > 0 && currentHp < minTargetHpAfterHit && targetCurrentHp > minTargetHpAfterHit) {
            currentHp = minTargetHpAfterHit
            damage = Math.max(0, targetCurrentHp - currentHp)
        }
        const playerEffectivenessText = didPlayerMoveHit ? resolveEffectivenessText(playerTypeEffectiveness.multiplier) : ''

        const afterDamageEffects = canResolvePlayerMoveEffects
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

        const endTurnEffects = canResolvePlayerMoveEffects
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

        const resolvedDamageCalcEffects = canResolvePlayerMoveEffects ? damageCalcEffects : createEmptyEffectAggregate()
        const combinedEffectResult = [
            selectMoveEffects,
            resolvedDamageCalcEffects,
            beforeAccuracyEffects,
            onHitEffects,
            afterDamageEffects,
            endTurnEffects,
        ].reduce((aggregate, entry) => mergeEffectAggregate(aggregate, entry), createEmptyEffectAggregate())

        const effectSelfPatches = combinedEffectResult?.statePatches?.self || {}
        const effectOpponentPatches = combinedEffectResult?.statePatches?.opponent || {}
        const effectFieldPatch = combinedEffectResult?.statePatches?.field || {}

        const abilityMutationResult = resolveAbilityMutations({
            selfAbility: playerAbility,
            opponentAbility,
            selfPatches: effectSelfPatches,
            opponentPatches: effectOpponentPatches,
            selfLabel: activePokemon.nickname || attackerSpecies?.name || 'Pokemon của bạn',
            opponentLabel: targetName || 'Mục tiêu',
        })
        if (abilityMutationResult.changed) {
            playerAbility = abilityMutationResult.selfAbility
            opponentAbility = abilityMutationResult.opponentAbility
            appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_mutation', abilityMutationResult.logs, {
                source: 'move_effects',
            })
        }

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
            const selfStatusGuard = resolveAbilityStatusGuard({
                ability: playerAbility,
                incomingStatus: incomingSelfStatus,
                isSuppressed: playerAbilitySuppressed,
            })
            const shouldBlockSelfStatusByAbility = incomingSelfStatus && selfStatusGuard.preventStatus
            const nextSelfStatus = (incomingSelfStatus && selfStatusShieldTurns > 0) || shouldBlockSelfStatusByAbility
                ? ''
                : effectSelfPatches?.status
            if (incomingSelfStatus && selfStatusShieldTurns > 0) {
                appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'status_blocked', 'Lá chắn trạng thái bảo vệ Pokemon của bạn khỏi hiệu ứng bất lợi.', {
                    target: 'player',
                })
            }
            if (shouldBlockSelfStatusByAbility && selfStatusGuard.logs.length > 0) {
                appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_trigger', selfStatusGuard.logs, {
                    target: 'player',
                    source: 'ability',
                })
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
            const opponentStatusGuard = resolveAbilityStatusGuard({
                ability: opponentAbility,
                incomingStatus: incomingOpponentStatus,
                resolutionContext: targetAbilityResolutionContext,
                isSuppressed: opponentAbilitySuppressed,
            })
            const shouldBlockOpponentStatusByAbility = incomingOpponentStatus && opponentStatusGuard.preventStatus
            const nextOpponentStatus = (incomingOpponentStatus && opponentStatusShieldTurns > 0) || shouldBlockOpponentStatusByAbility
                ? ''
                : effectOpponentPatches?.status
            if (incomingOpponentStatus && opponentStatusShieldTurns > 0) {
                appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'status_blocked', `${targetName} được lá chắn trạng thái bảo vệ.`, {
                    target: 'opponent',
                })
            }
            if (shouldBlockOpponentStatusByAbility && opponentStatusGuard.logs.length > 0) {
                appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_trigger', opponentStatusGuard.logs, {
                    target: 'opponent',
                    source: 'ability',
                })
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

        const suppressionSelfPatches = {
            ...effectSelfPatches,
            suppressAbility: didPlayerMoveHit ? effectSelfPatches?.suppressAbility : false,
        }
        const suppressionOpponentPatches = {
            ...effectOpponentPatches,
            suppressAbility: didPlayerMoveHit ? effectOpponentPatches?.suppressAbility : false,
        }

        const abilitySuppressionResult = resolveAbilitySuppressionMutations({
            selfSuppressed: playerAbilitySuppressed,
            opponentSuppressed: opponentAbilitySuppressed,
            selfPatches: suppressionSelfPatches,
            opponentPatches: suppressionOpponentPatches,
            selfLabel: activePokemon.nickname || attackerSpecies?.name || 'Pokemon của bạn',
            opponentLabel: targetName || 'Mục tiêu',
        })
        if (abilitySuppressionResult.changed) {
            playerAbilitySuppressed = abilitySuppressionResult.selfSuppressed
            opponentAbilitySuppressed = abilitySuppressionResult.opponentSuppressed
            appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'ability_suppressed', abilitySuppressionResult.logs, {
                source: 'move_effects',
            })
        }

        const filteredSelfStatDelta = filterNegativeStatStageDeltas(effectSelfPatches?.statStages, selfStatDropShieldTurns)
        const filteredOpponentStatDelta = filterNegativeStatStageDeltas(effectOpponentPatches?.statStages, opponentStatDropShieldTurns)
        if (selfStatDropShieldTurns > 0 && Object.keys(normalizeStatStages(effectSelfPatches?.statStages)).length > Object.keys(filteredSelfStatDelta).length) {
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'stat_drop_blocked', 'Lá chắn chỉ số ngăn Pokemon của bạn bị giảm chỉ số.', {
                target: 'player',
            })
        }
        if (opponentStatDropShieldTurns > 0 && Object.keys(normalizeStatStages(effectOpponentPatches?.statStages)).length > Object.keys(filteredOpponentStatDelta).length) {
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'stat_drop_blocked', `${targetName} được lá chắn chỉ số bảo vệ khỏi giảm chỉ số.`, {
                target: 'opponent',
            })
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
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'heal_blocked', 'Pokemon của bạn bị chặn hồi máu.', {
                target: 'player',
            })
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
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'system', 'heal_blocked', `${targetName} bị chặn hồi máu.`, {
                target: 'opponent',
            })
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
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'player', 'self_damage', `Pokemon của bạn chịu ${crashDamage} sát thương do đòn trượt.`, {
                amount: crashDamage,
                target: 'player',
            })
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        const selfRecoilHp = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.self?.recoilHp) || 0))
        if (selfRecoilHp > 0) {
            playerCurrentHp = Math.max(0, playerCurrentHp - selfRecoilHp)
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'player', 'recoil_damage', `Pokemon của bạn chịu ${selfRecoilHp} sát thương phản lực.`, {
                amount: selfRecoilHp,
                target: 'player',
            })
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        const selfHpCost = Math.max(0, Math.floor(Number(combinedEffectResult?.statePatches?.self?.selfHpCost) || 0))
        if (selfHpCost > 0 && playerCurrentHp > 0) {
            playerCurrentHp = Math.max(1, playerCurrentHp - selfHpCost)
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'player', 'hp_cost', `Pokemon của bạn tiêu hao ${selfHpCost} HP để kích hoạt hiệu ứng.`, {
                amount: selfHpCost,
                target: 'player',
            })
            if (trainerSession) {
                trainerSession.playerCurrentHp = playerCurrentHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }
        }

        if (combinedEffectResult?.statePatches?.self?.selfFaint && playerCurrentHp > 0) {
            playerCurrentHp = 0
            appendPhaseEvent(playerTurnPhaseKeys.postAction, 'player', 'self_faint_effect', 'Pokemon của bạn bị ngất do tác dụng của chiêu.', {
                target: 'player',
            })
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

        const playerDrowsyResult = resultingPlayerHp > 0
            ? resolveDrowsySleepAtEndTurn({
                status: playerStatus,
                statusTurns: playerStatusTurns,
                volatileState: playerVolatileState,
                random: randomFn,
            })
            : null
        if (playerDrowsyResult) {
            playerStatus = normalizeBattleStatus(playerDrowsyResult.statusAfter)
            playerStatusTurns = normalizeStatusTurns(playerDrowsyResult.statusTurnsAfter)
            playerVolatileState = normalizeVolatileState(playerDrowsyResult.volatileStateAfter)
            if (playerDrowsyResult.fellAsleep) {
                appendPhaseEvent('turn_end', 'system', 'status_applied', `Pokemon của bạn ${String(playerDrowsyResult.log || 'rơi vào giấc ngủ.').trim().toLowerCase()}`, {
                    target: 'player',
                    status: 'sleep',
                    source: 'drowsy',
                })
            }
        }

        const opponentDrowsyResult = currentHp > 0
            ? resolveDrowsySleepAtEndTurn({
                status: opponentStatus,
                statusTurns: opponentStatusTurns,
                volatileState: opponentVolatileState,
                random: randomFn,
            })
            : null
        if (opponentDrowsyResult) {
            opponentStatus = normalizeBattleStatus(opponentDrowsyResult.statusAfter)
            opponentStatusTurns = normalizeStatusTurns(opponentDrowsyResult.statusTurnsAfter)
            opponentVolatileState = normalizeVolatileState(opponentDrowsyResult.volatileStateAfter)
            if (opponentDrowsyResult.fellAsleep) {
                appendPhaseEvent('turn_end', 'system', 'status_applied', `${targetName} ${String(opponentDrowsyResult.log || 'rơi vào giấc ngủ.').trim().toLowerCase()}`, {
                    target: 'opponent',
                    status: 'sleep',
                    source: 'drowsy',
                })
            }
        }

        const playerResidualDamage = resultingPlayerHp > 0
            ? calcResidualStatusDamage({
                status: playerStatus,
                maxHp: playerMaxHp,
            })
            : 0
        if (playerResidualDamage > 0) {
            resultingPlayerHp = Math.max(0, resultingPlayerHp - playerResidualDamage)
            appendPhaseEvent('turn_end', 'system', 'residual_damage', `Pokemon của bạn chịu ${playerResidualDamage} sát thương do ${formatBattleStatusLabel(playerStatus)}.`, {
                target: 'player',
                amount: playerResidualDamage,
                status: playerStatus,
            })
        }

        const opponentResidualDamage = currentHp > 0
            ? calcResidualStatusDamage({
                status: opponentStatus,
                maxHp: targetMaxHp,
            })
            : 0
        if (opponentResidualDamage > 0) {
            currentHp = Math.max(0, currentHp - opponentResidualDamage)
            appendPhaseEvent('turn_end', 'system', 'residual_damage', `${targetName} chịu ${opponentResidualDamage} sát thương do ${formatBattleStatusLabel(opponentStatus)}.`, {
                target: 'opponent',
                amount: opponentResidualDamage,
                status: opponentStatus,
            })
        }

        const playerBindTurns = normalizeStatusTurns(playerVolatileState?.bindTurns)
        const playerBindFraction = clampFraction(playerVolatileState?.bindFraction, 1 / 16)
        if (resultingPlayerHp > 0 && playerBindTurns > 0) {
            const bindDamage = Math.max(1, Math.floor(playerMaxHp * playerBindFraction))
            resultingPlayerHp = Math.max(0, resultingPlayerHp - bindDamage)
            appendPhaseEvent('turn_end', 'system', 'bind_damage', `Pokemon của bạn chịu ${bindDamage} sát thương do bị trói.`, {
                target: 'player',
                amount: bindDamage,
            })
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
            appendPhaseEvent('turn_end', 'system', 'bind_damage', `${targetName} chịu ${bindDamage} sát thương do bị trói.`, {
                target: 'opponent',
                amount: bindDamage,
            })
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
            appendPhaseEvent('turn_end', 'system', 'weather_damage', `Pokemon của bạn chịu ${weatherDamage} sát thương từ ${activeWeather}.`, {
                target: 'player',
                amount: weatherDamage,
                weather: activeWeather,
            })
        }
        if ((activeWeather === 'hail' || activeWeather === 'sandstorm') && currentHp > 0 && !isImmuneToWeatherChip(activeWeather, targetTypes)) {
            const weatherDamage = Math.max(1, Math.floor(targetMaxHp / 16))
            currentHp = Math.max(0, currentHp - weatherDamage)
            appendPhaseEvent('turn_end', 'system', 'weather_damage', `${targetName} chịu ${weatherDamage} sát thương từ ${activeWeather}.`, {
                target: 'opponent',
                amount: weatherDamage,
                weather: activeWeather,
            })
        }

        if (String(battleFieldState?.terrain || '').trim().toLowerCase() === 'grassy') {
            const playerHealBlockNow = normalizeStatusTurns(playerVolatileState?.healBlockTurns)
            const opponentHealBlockNow = normalizeStatusTurns(opponentVolatileState?.healBlockTurns)

            if (resultingPlayerHp > 0) {
                if (playerHealBlockNow > 0) {
                    appendPhaseEvent('turn_end', 'system', 'heal_blocked', 'Pokemon của bạn không thể hồi máu do bị chặn hồi máu.', {
                        target: 'player',
                    })
                } else {
                    const healAmount = Math.max(1, Math.floor(playerMaxHp / 16))
                    resultingPlayerHp = Math.min(playerMaxHp, resultingPlayerHp + healAmount)
                    appendPhaseEvent('turn_end', 'system', 'heal', `Pokemon của bạn hồi ${healAmount} HP nhờ địa hình cỏ.`, {
                        target: 'player',
                        amount: healAmount,
                        source: 'grassy-terrain',
                    })
                }
            }

            if (currentHp > 0) {
                if (opponentHealBlockNow > 0) {
                    appendPhaseEvent('turn_end', 'system', 'heal_blocked', `${targetName} không thể hồi máu do bị chặn hồi máu.`, {
                        target: 'opponent',
                    })
                } else {
                    const healAmount = Math.max(1, Math.floor(targetMaxHp / 16))
                    currentHp = Math.min(targetMaxHp, currentHp + healAmount)
                    appendPhaseEvent('turn_end', 'system', 'heal', `${targetName} hồi ${healAmount} HP nhờ địa hình cỏ.`, {
                        target: 'opponent',
                        amount: healAmount,
                        source: 'grassy-terrain',
                    })
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
            opponentAbilitySuppressed = false
            opponentStatStages = {}
            opponentDamageGuards = {}
            opponentVolatileState = {}
        }

        if (resultingPlayerHp <= 0) {
            playerStatus = ''
            playerStatusTurns = 0
            playerAbilitySuppressed = false
            playerStatStages = {}
            playerDamageGuards = {}
            playerVolatileState = {}
        }

        if (trainerSession) {
            trainerSession.playerCurrentHp = resultingPlayerHp
            trainerSession.playerMaxHp = playerMaxHp
            trainerSession.playerStatus = playerStatus
            trainerSession.playerStatusTurns = playerStatusTurns
            trainerSession.playerAbility = normalizeAbilityToken(playerAbility || trainerSession.playerAbility)
            trainerSession.playerAbilitySuppressed = normalizeAbilitySuppressed(playerAbilitySuppressed)
            syncTrainerSessionActivePlayerToParty(trainerSession)

            if (resultingPlayerHp <= 0) {
                playerForcedSwitchInfo = applyTrainerSessionForcedPlayerSwitch(trainerSession)
                if (playerForcedSwitchInfo?.switched && playerForcedSwitchInfo?.nextEntry) {
                    playerAbility = normalizeAbilityToken(trainerSession.playerAbility)
                    playerAbilitySuppressed = normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed)
                    appendPhaseEvent('forced_switch', 'system', 'forced_switch', `${playerForcedSwitchInfo.nextEntry.name || 'Pokemon'} vào sân thay thế.`, {
                        target: 'player',
                        nextPokemonName: playerForcedSwitchInfo.nextEntry.name || 'Pokemon',
                        nextIndex: playerForcedSwitchInfo.nextIndex,
                    })
                }
            }
        }

        if (trainerSession) {
            if (!playerForcedSwitchInfo?.switched) {
                trainerSession.playerCurrentHp = resultingPlayerHp
                trainerSession.playerStatus = playerStatus
                trainerSession.playerStatusTurns = playerStatusTurns
                trainerSession.playerAbility = normalizeAbilityToken(playerAbility || trainerSession.playerAbility)
                trainerSession.playerAbilitySuppressed = normalizeAbilitySuppressed(playerAbilitySuppressed)
                trainerSession.playerStatStages = playerStatStages
                trainerSession.playerDamageGuards = playerDamageGuards
                trainerSession.playerWasDamagedLastTurn = playerWasDamagedLastTurn
                trainerSession.playerVolatileState = playerVolatileState
            }
            trainerSession.fieldState = battleFieldState
            if (activeTrainerOpponent) {
                const didDefeatOpponent = targetCurrentHp > 0 && currentHp <= 0
                activeTrainerOpponent.currentHp = currentHp
                activeTrainerOpponent.status = opponentStatus
                activeTrainerOpponent.statusTurns = opponentStatusTurns
                activeTrainerOpponent.ability = normalizeAbilityToken(opponentAbility || activeTrainerOpponent.ability)
                activeTrainerOpponent.abilitySuppressed = normalizeAbilitySuppressed(opponentAbilitySuppressed)
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

        const currentMovePpState = authoritativeMovePpState
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
                playerAbility: normalizeAbilityToken(trainerSession.playerAbility),
                playerAbilitySuppressed: normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed),
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
                    ability: normalizeAbilityToken(entry.ability),
                    abilitySuppressed: normalizeAbilitySuppressed(entry.abilitySuppressed),
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
        const serializedPlayerParty = trainerSession
            ? serializeTrainerPlayerPartyState(trainerSession)
            : null

        const playerActionLog = (!playerActsFirst && playerTurnStartHp > 0 && playerCurrentHp <= 0)
            ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} đã ngã xuống trước khi kịp ra đòn.`
            : !canPlayerAct
            ? ''
            : (didPlayerMoveHit
            ? buildBattleActionLog({
                actorName: activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn',
                moveName: selectedMoveName,
                didHit: true,
                damage,
                hitCount,
                isStatusMove,
                effectivenessText: playerEffectivenessText,
                suffix: moveFallbackReason === 'OUT_OF_PP' ? '(Chiêu đã hết PP nên tự dùng Struggle.)' : '',
            })
            : (moveBlockedByRequirement
                ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName} nhưng thất bại.${moveRequirement?.message ? ` ${moveRequirement.message}` : ''}${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`.trim()
                : (moveBlockedByTerrainRequirement
                ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName} nhưng thất bại vì sân đấu không có địa hình phù hợp.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`
                : `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} dùng ${selectedMoveName} nhưng trượt.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`)))

        appendPhaseEvent(
            playerTurnPhaseKeys.action,
            'player',
            !canPlayerAct
                ? 'action_skipped'
                : ((moveBlockedByRequirement || moveBlockedByTerrainRequirement) ? 'move_failed' : 'move_used'),
            playerActionLog,
            {
                moveName: selectedMoveName,
                didHit: didPlayerMoveHit,
                damage,
                targetCurrentHpAfter: currentHp,
            }
        )

        appendPhaseLines(playerTurnPhaseKeys.postAction, 'system', 'effect_log', combinedEffectResult.logs, {
            source: 'move_effects',
            target: 'opponent',
        })

        if (counterAttack?.log) {
            appendPhaseEvent(
                opponentTurnPhaseKeys.action,
                'opponent',
                counterAttack?.move?.canAct === false ? 'action_skipped' : 'move_used',
                counterAttack.log,
                {
                    moveName: counterAttack?.move?.name || '',
                    didHit: counterAttack?.hit !== false,
                    damage: Number(counterAttack?.damage || 0),
                    targetCurrentHpAfter: Number(counterAttack?.currentHp || 0),
                }
            )
        }

        if (resultingPlayerHp <= 0) {
            appendPhaseEvent('faint_resolution', 'system', 'faint', `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon của bạn'} đã bại trận.`, {
                target: 'player',
            })
        }
        if (currentHp <= 0) {
            appendPhaseEvent('faint_resolution', 'system', 'faint', `${targetName} đã bại trận.`, {
                target: 'opponent',
            })
        }
        if (trainerState && currentHp <= 0 && !trainerState.defeatedAll && Number.isInteger(trainerState.currentIndex) && trainerState.currentIndex !== activeOpponentIndex) {
            const nextOpponentEntry = trainerState.team?.[trainerState.currentIndex] || null
            const nextOpponentName = String(nextOpponentEntry?.name || 'Pokemon').trim() || 'Pokemon'
            appendPhaseEvent('forced_switch', 'system', 'forced_switch', `${nextOpponentName} vào sân thay thế.`, {
                target: 'opponent',
                nextPokemonName: nextOpponentName,
                nextIndex: trainerState.currentIndex,
            })
        }

        const turnPhases = finalizeTurnTimeline(turnTimeline)
        const flattenedBattleLogLines = flattenTurnPhaseLines(turnPhases)

        res.json({
            ok: true,
            battle: {
                turnPhases,
                logLines: flattenedBattleLogLines,
                playerParty: serializedPlayerParty,
                forcedSwitch: playerForcedSwitchInfo?.switched
                    ? {
                        target: 'player',
                        nextIndex: playerForcedSwitchInfo.nextIndex,
                        nextPokemonId: playerForcedSwitchInfo?.nextEntry?.userPokemonId || null,
                        nextPokemonName: playerForcedSwitchInfo?.nextEntry?.name || null,
                    }
                    : null,
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
                    ability: normalizeAbilityToken(playerAbility),
                    abilitySuppressed: normalizeAbilitySuppressed(playerAbilitySuppressed),
                    statStages: playerStatStages,
                    damageGuards: playerDamageGuards,
                    wasDamagedLastTurn: playerWasDamagedLastTurn,
                    volatileState: playerVolatileState,
                    movePpState: mergedMovePpState,
                },
                opponent: trainerState,
                targetState: {
                    name: targetName,
                    currentHp,
                    maxHp: targetMaxHp,
                    effectiveStats: opponentEffectiveStats,
                    status: opponentStatus,
                    statusTurns: opponentStatusTurns,
                    ability: normalizeAbilityToken(opponentAbility),
                    abilitySuppressed: normalizeAbilitySuppressed(opponentAbilitySuppressed),
                    statStages: opponentStatStages,
                    damageGuards: opponentDamageGuards,
                    wasDamagedLastTurn: opponentWasDamagedLastTurn,
                    volatileState: opponentVolatileState,
                },
                counterAttack,
                opponentMoveState: opponentMoveStatePayload,
                effects: {
                    logs: combinedEffectResult.logs,
                    extraLogs: [],
                    appliedOps: combinedEffectResult.appliedEffects.map((entry) => String(entry?.op || '').trim()).filter(Boolean),
                    statePatches: combinedEffectResult.statePatches,
                },
                fieldState: battleFieldState,
                log: flattenedBattleLogLines.join('\n'),
            },
        })
    } catch (error) {
        next(error)
    }
})

router.post('/battle/trainer/start', authMiddleware, requireActiveGameplayTab({ actionLabel: 'bắt đầu battle trainer' }), async (req, res, next) => {
    try {
        const userId = req.user.userId
        const { trainerId = null, activePokemonId = null } = req.body || {}
        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        if (!normalizedTrainerId) {
            return res.status(400).json({ ok: false, message: 'Thiếu trainerId để bắt đầu battle trainer.' })
        }

        const trainer = await loadTrainerBattleCombatView(normalizedTrainerId)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
        }

        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
            .populate('pokemonId')
            .sort({ partyIndex: 1 })

        const allPartyMoveNames = [...new Set(
            party.flatMap((entry) => mergeKnownMovesWithFallback(entry?.moves))
        )]
        const battleStartMoveLookupMap = await buildMoveLookupByName(allPartyMoveNames)
        const refillSaveTasks = []

        party.forEach((entry) => {
            const entryMoveNames = mergeKnownMovesWithFallback(entry?.moves)
            const refilledMovePpState = buildMovePpStateFromMoves({
                moveNames: entryMoveNames,
                movePpState: [],
                moveLookupMap: battleStartMoveLookupMap,
            }).map((moveEntry) => ({
                moveName: moveEntry.moveName,
                currentPp: Math.max(1, Number(moveEntry?.maxPp) || 1),
                maxPp: Math.max(1, Number(moveEntry?.maxPp) || 1),
            }))

            if (!isMovePpStateEqual(entry.movePpState, refilledMovePpState)) {
                entry.movePpState = refilledMovePpState
                refillSaveTasks.push(entry.save())
            }
        })

        if (refillSaveTasks.length > 0) {
            await Promise.all(refillSaveTasks)
        }

        const activePokemon = normalizedActivePokemonId
            ? party.find((entry) => String(entry?._id || '') === normalizedActivePokemonId) || null
            : (party.find((entry) => Boolean(entry)) || null)

        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'Bạn chưa có Pokemon trong đội hình để bắt đầu battle trainer.' })
        }

        const attackerSpecies = activePokemon?.pokemonId || {}
        const attackerLevel = Math.max(1, Number(activePokemon?.level || 1))
        const attackerTypes = normalizePokemonTypes(attackerSpecies?.types)
        const attackerBaseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: attackerSpecies,
            formId: activePokemon?.formId,
        })
        const activeBadgeBonuses = await getCachedActiveBadgeBonuses(userId)
        const badgeBonusState = resolveBattleBadgeBonusState(activeBadgeBonuses, attackerTypes)
        const playerMaxHp = resolvePlayerBattleMaxHp({
            baseHp: attackerBaseStats?.hp,
            level: attackerLevel,
            rarity: attackerSpecies?.rarity || 'd',
            hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
        })

        let trainerSession = await BattleSession.findOne({
            userId,
            trainerId: normalizedTrainerId,
            expiresAt: { $gt: new Date() },
        })
        trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainer, null, trainerSession)

        trainerSession.team = buildTrainerBattleTeam(trainer)
        trainerSession.playerTeam = []
        trainerSession.knockoutCounts = []
        trainerSession.currentIndex = 0
        trainerSession.playerPokemonId = activePokemon._id
        trainerSession.playerMaxHp = playerMaxHp
        trainerSession.playerCurrentHp = playerMaxHp
        trainerSession.playerStatus = ''
        trainerSession.playerStatusTurns = 0
        trainerSession.playerAbility = resolveBattleAbilityForPokemon({
            userPokemon: activePokemon,
            species: attackerSpecies,
        })
        trainerSession.playerAbilitySuppressed = false
        trainerSession.playerStatStages = {}
        trainerSession.playerDamageGuards = {}
        trainerSession.playerWasDamagedLastTurn = false
        trainerSession.playerVolatileState = {}
        trainerSession.fieldState = {}
        trainerSession.badgeSnapshot = activeBadgeBonuses
        trainerSession.expiresAt = getBattleSessionExpiryDate()

        await ensureTrainerSessionPlayerParty({
            trainerSession,
            userId,
            preferredActivePokemonId: activePokemon._id,
            preloadedParty: party,
            hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
        })

        trainerSession.playerPokemonId = activePokemon._id
        trainerSession.playerMaxHp = playerMaxHp
        trainerSession.playerCurrentHp = playerMaxHp
        trainerSession.playerStatus = ''
        trainerSession.playerStatusTurns = 0
        trainerSession.playerAbility = resolveBattleAbilityForPokemon({
            userPokemon: activePokemon,
            species: attackerSpecies,
        })
        trainerSession.playerAbilitySuppressed = false
        syncTrainerSessionActivePlayerToParty(trainerSession)
        const persistedTrainerSession = await BattleSession.findOneAndUpdate(
            {
                _id: trainerSession._id,
                userId,
                trainerId: normalizedTrainerId,
            },
            {
                $set: {
                    team: trainerSession.team,
                    playerTeam: trainerSession.playerTeam,
                    knockoutCounts: trainerSession.knockoutCounts,
                    currentIndex: trainerSession.currentIndex,
                    playerPokemonId: trainerSession.playerPokemonId,
                    playerCurrentHp: trainerSession.playerCurrentHp,
                    playerMaxHp: trainerSession.playerMaxHp,
                    playerStatus: trainerSession.playerStatus,
                    playerStatusTurns: trainerSession.playerStatusTurns,
                    playerAbility: trainerSession.playerAbility,
                    playerAbilitySuppressed: trainerSession.playerAbilitySuppressed,
                    playerStatStages: trainerSession.playerStatStages,
                    playerDamageGuards: trainerSession.playerDamageGuards,
                    playerWasDamagedLastTurn: trainerSession.playerWasDamagedLastTurn,
                    playerVolatileState: trainerSession.playerVolatileState,
                    fieldState: trainerSession.fieldState,
                    badgeSnapshot: trainerSession.badgeSnapshot,
                    expiresAt: trainerSession.expiresAt,
                },
            },
            {
                new: true,
            }
        )

        if (!persistedTrainerSession) {
            const latestTrainerSession = await BattleSession.findOne({
                userId,
                trainerId: normalizedTrainerId,
                expiresAt: { $gt: new Date() },
            })

            if (latestTrainerSession && Array.isArray(latestTrainerSession.team) && latestTrainerSession.team.length > 0) {
                trainerSession = latestTrainerSession
            } else {
                return res.status(409).json({
                    ok: false,
                    code: 'BATTLE_SESSION_CONFLICT',
                    message: 'Phiên battle trainer vừa được cập nhật ở luồng khác. Vui lòng thử lại ngay.',
                })
            }
        } else {
            trainerSession = persistedTrainerSession
        }

        res.json({
            ok: true,
            message: `Bắt đầu battle với ${trainer?.name || 'huấn luyện viên'}!`,
            player: {
                pokemonId: trainerSession.playerPokemonId || activePokemon._id,
                currentHp: Math.max(0, Number(trainerSession.playerCurrentHp || 0)),
                maxHp: Math.max(1, Number(trainerSession.playerMaxHp || 1)),
                status: normalizeBattleStatus(trainerSession.playerStatus),
                statusTurns: normalizeStatusTurns(trainerSession.playerStatusTurns),
                ability: normalizeAbilityToken(trainerSession.playerAbility),
                abilitySuppressed: normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed),
            },
            playerParty: serializeTrainerPlayerPartyState(trainerSession),
            opponent: serializeTrainerBattleState(trainerSession),
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
    resolveDrowsySleepAtEndTurn,
    calcResidualStatusDamage,
    applyDamageGuardsToDamage,
    decrementDamageGuards,
    applyStatStageToValue,
    resolveBattleTurnOrder,
    createTurnTimeline,
    resolveTurnActorPhaseKeys,
    appendTurnPhaseEvent,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
    buildAbilityResolutionContext,
    resolveIgnoreTargetAbilityFromEffectAggregates,
    resolveIgnoreTargetAbilityFromEffectSpecs,
    resolveSuppressTargetAbilityFromEffectAggregates,
    resolveSuppressTargetAbilityFromEffectSpecs,
    normalizeAbilitySuppressed,
    hasMoldBreakerStyleBypass,
    resolveAbilityHitDefense,
    resolveAbilityStatusGuard,
    resolveAbilityMutations,
    resolveAbilitySuppressionMutations,
}

export default router
