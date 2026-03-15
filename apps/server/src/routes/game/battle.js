import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import { requireActiveGameplayTab } from '../../middleware/gameplayTabGuard.js'
import PlayerState from '../../models/PlayerState.js'
import User from '../../models/User.js'
import UserPokemon from '../../models/UserPokemon.js'
import UserInventory from '../../models/UserInventory.js'
import Pokemon from '../../models/Pokemon.js'
import BattleTrainer from '../../models/BattleTrainer.js'
import BattleSession from '../../models/BattleSession.js'
import { emitPlayerState } from '../../socket/index.js'
import { expToNext, getRarityExpMultiplier } from '../../utils/gameUtils.js'
import { getFusionTotalStatBonusPercent } from '../../utils/fusionUtils.js'
import { withActiveUserPokemonFilter } from '../../utils/userPokemonQuery.js'
import {
    resolveBattleBadgeBonusState,
    resolveOrHydrateBattleBadgeSnapshot,
} from '../../utils/badgeUtils.js'
import { resolvePlayerBattleMaxHp } from '../../utils/playerBattleStats.js'
import { loadFusionRuntimeConfig } from '../../utils/fusionRuntimeConfig.js'
import { resolveEffectivePokemonBaseStats, resolvePokemonFormEntry } from '../../utils/pokemonFormStats.js'
import {
    getOrCreateTrainerBattleSession,
} from '../../services/trainerBattleSessionService.js'
import { serializeTrainerBattleState } from '../../services/trainerBattleStateService.js'
import { applyTrainerPenaltyTurn } from '../../services/trainerPenaltyTurnService.js'
import {
    appendTurnPhaseEvent,
    createTurnTimeline,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
} from '../../battle/turnTimeline.js'
import {
    applyTrainerSessionForcedPlayerSwitch,
    clearTrainerSessionActivePlayerAbilitySuppression,
    ensureTrainerSessionPlayerParty,
    serializeTrainerPlayerPartyState,
    setTrainerSessionActivePlayerByIndex,
    syncTrainerSessionActivePlayerToParty,
} from '../../services/trainerBattlePlayerStateService.js'
import { resolveEffectiveVipBonusBenefits } from '../../services/vipBenefitService.js'
import {
    distributeExpByDefeats,
    ensureTrainerCompletionTracked,
    trackDailyActivity,
} from '../../services/mapProgressionService.js'
import {
    resolvePokemonForm,
    resolvePokemonImageForForm,
    serializePlayerWallet,
} from '../../services/wildEncounterService.js'
import { resolveTrainerBattleForUserDirect } from '../../services/trainerBattleResolveDirectService.js'

const router = express.Router()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const normalizeAbilityToken = (value = '') => String(value || '').trim().toLowerCase()
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
const DEFAULT_TRAINER_PRIZE_LEVEL = 5
const USER_POKEMON_MAX_LEVEL = 3000
const hasLivingTrainerPlayer = (session = null) => {
    const playerTeam = Array.isArray(session?.playerTeam) ? session.playerTeam : []
    if (playerTeam.length > 0) {
        return playerTeam.some((entry) => Number(entry?.currentHp || 0) > 0)
    }
    return Number(session?.playerCurrentHp || 0) > 0
}
const resolveDefeatedTrainerPlayerEntry = (session = null) => {
    const playerTeam = Array.isArray(session?.playerTeam) ? session.playerTeam : []
    const activeId = String(session?.playerPokemonId || '').trim()
    return (activeId
        ? playerTeam.find((entry) => String(entry?.userPokemonId || '').trim() === activeId)
        : null)
        || playerTeam.find((entry) => Number(entry?.currentHp || 0) <= 0)
        || playerTeam[0]
        || null
}

router.post('/battle/trainer/switch', authMiddleware, requireActiveGameplayTab({ actionLabel: 'đổi Pokemon battle trainer' }), async (req, res, next) => {
    try {
        const userId = req.user.userId
        const { trainerId = null, activePokemonId = null, playerCurrentHp = null, playerMaxHp = null } = req.body || {}
        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        if (!normalizedTrainerId || !normalizedActivePokemonId) {
            return res.status(400).json({ ok: false, message: 'Thiếu trainerId hoặc activePokemonId.' })
        }

        const trainerDoc = await BattleTrainer.findById(normalizedTrainerId)
            .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types abilities levelUpMoves initialMoves')
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
            trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainerDoc)
        }

        const trainerBadgeSummary = await resolveOrHydrateBattleBadgeSnapshot(trainerSession, userId)

        const resolvedTrainerId = String(trainerSession.trainerId || normalizedTrainerId).trim()
        const badgeHpBonusPercent = Math.max(
            0,
            Number(resolveBattleBadgeBonusState(trainerBadgeSummary, [])?.hpBonusPercent || 0)
        )
        await ensureTrainerSessionPlayerParty({
            trainerSession,
            userId,
            preferredActivePokemonId: normalizedActivePokemonId,
            hpBonusPercent: badgeHpBonusPercent,
        })

        const team = Array.isArray(trainerSession.team) ? trainerSession.team : []
        const currentIndex = Math.max(0, Number(trainerSession.currentIndex) || 0)
        if (team.length === 0 || currentIndex >= team.length) {
            return res.status(409).json({ ok: false, message: 'Phiên battle trainer đã kết thúc. Vui lòng vào trận mới.' })
        }

        const resolvedTrainerDoc = resolvedTrainerId === normalizedTrainerId
            ? trainerDoc
            : await BattleTrainer.findById(resolvedTrainerId)
                .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types abilities levelUpMoves initialMoves')
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

        const targetPartyIndex = Array.isArray(trainerSession.playerTeam)
            ? trainerSession.playerTeam.findIndex((entry) => String(entry?.userPokemonId || '') === normalizedActivePokemonId)
            : -1
        if (targetPartyIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Pokemon này không có trong đội hình battle hiện tại.' })
        }
        if (Number(trainerSession.playerTeam?.[targetPartyIndex]?.currentHp || 0) <= 0) {
            return res.status(400).json({ ok: false, message: 'Pokemon này đã bại trận và không thể vào sân.' })
        }
        const targetPartyEntry = trainerSession.playerTeam[targetPartyIndex]
        const resolvedForm = resolvePokemonFormEntry(
            targetPokemon?.pokemonId,
            targetPokemon?.formId || targetPokemon?.pokemonId?.defaultFormId || 'normal'
        )
        const resolvedBaseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: targetPokemon?.pokemonId,
            formId: targetPokemon?.formId || targetPokemon?.pokemonId?.defaultFormId || 'normal',
            resolvedForm,
        })
        const fusionRuntimeConfig = await loadFusionRuntimeConfig()
        const fusionBonusPercent = getFusionTotalStatBonusPercent(
            targetPokemon?.fusionLevel,
            fusionRuntimeConfig.totalStatBonusPercentByFusionLevel
        )

        const calculatedMaxHp = resolvePlayerBattleMaxHp({
            baseStats: resolvedBaseStats,
            level: Math.max(1, Number(targetPokemon.level || 1)),
            rarity: targetPokemon?.pokemonId?.rarity || 'd',
            ivs: targetPokemon?.ivs,
            evs: targetPokemon?.evs,
            fusionBonusPercent,
            hpBonusPercent: badgeHpBonusPercent,
        })
        const requestedMaxHp = clamp(
            Math.floor(Number.isFinite(Number(playerMaxHp)) ? Number(playerMaxHp) : calculatedMaxHp),
            1,
            calculatedMaxHp
        )
        const requestedCurrentHp = clamp(
            Math.floor(Number.isFinite(Number(playerCurrentHp)) ? Number(playerCurrentHp) : requestedMaxHp),
            0,
            requestedMaxHp
        )

        clearTrainerSessionActivePlayerAbilitySuppression(trainerSession)
        setTrainerSessionActivePlayerByIndex(trainerSession, targetPartyIndex)
        const authoritativePlayerMaxHp = Math.max(1, Number(targetPartyEntry?.maxHp || requestedMaxHp || 1))
        const authoritativePlayerCurrentHp = clamp(
            Math.floor(Number(targetPartyEntry?.currentHp ?? requestedCurrentHp ?? authoritativePlayerMaxHp) || 0),
            0,
            authoritativePlayerMaxHp
        )
        trainerSession.playerMaxHp = authoritativePlayerMaxHp
        trainerSession.playerCurrentHp = authoritativePlayerCurrentHp
        syncTrainerSessionActivePlayerToParty(trainerSession)

        const activeTrainerOpponent = team[currentIndex] || null
        const trainerTeamEntry = Array.isArray(resolvedTrainerDoc?.team) ? resolvedTrainerDoc.team[currentIndex] : null
        if (activeTrainerOpponent) {
            activeTrainerOpponent.ability = resolveBattleAbilityForPokemon({
                species: trainerTeamEntry?.pokemonId,
                fallbackAbility: activeTrainerOpponent.ability,
            })
        }
        const counterAttack = await applyTrainerPenaltyTurn({
            activeBattleSession: trainerSession,
            activeTrainerOpponent,
            targetPokemon,
            trainerSpecies: trainerTeamEntry?.pokemonId || null,
            playerCurrentHp: authoritativePlayerCurrentHp,
            playerMaxHp: authoritativePlayerMaxHp,
            reason: 'switch',
        })

        let playerForcedSwitch = null
        if (counterAttack?.defeatedPlayer) {
            syncTrainerSessionActivePlayerToParty(trainerSession)
            playerForcedSwitch = applyTrainerSessionForcedPlayerSwitch(trainerSession)
            await trainerSession.save()
        }

        const turnTimeline = createTurnTimeline({ playerActsFirst: true })
        appendTurnPhaseEvent(turnTimeline, {
            phaseKey: 'turn_start',
            actor: 'system',
            kind: 'manual_switch',
            line: `${targetPokemon.nickname || targetPokemon?.pokemonId?.name || 'Pokemon'} vào sân thay thế.`,
            target: 'player',
        })
        ;(Array.isArray(counterAttack?.turnPhases) ? counterAttack.turnPhases : []).forEach((phase) => {
            ;(Array.isArray(phase?.events) ? phase.events : []).forEach((event) => {
                appendTurnPhaseEvent(turnTimeline, {
                    phaseKey: phase.key,
                    actor: event?.actor || phase.actor || 'system',
                    kind: event?.kind || 'message',
                    line: event?.line || '',
                    ...event,
                })
            })
        })
        if (playerForcedSwitch?.switched && playerForcedSwitch?.nextEntry) {
            appendTurnPhaseEvent(turnTimeline, {
                phaseKey: 'forced_switch',
                actor: 'system',
                kind: 'forced_switch',
                line: `${playerForcedSwitch.nextEntry.name || 'Pokemon'} vào sân thay thế.`,
                target: 'player',
                nextPokemonName: playerForcedSwitch.nextEntry.name || 'Pokemon',
                nextIndex: playerForcedSwitch.nextIndex,
            })
        }
        const turnPhases = finalizeTurnTimeline(turnTimeline)
        const logLines = flattenTurnPhaseLines(turnPhases)

        return res.json({
            ok: true,
            message: `${targetPokemon.nickname || targetPokemon?.pokemonId?.name || 'Pokemon'} vào sân và bị đối thủ phản công!`,
            player: {
                pokemonId: trainerSession.playerPokemonId || targetPokemon._id,
                currentHp: Math.max(0, Number(trainerSession.playerCurrentHp || 0)),
                maxHp: Math.max(1, Number(trainerSession.playerMaxHp || 1)),
                ability: String(trainerSession.playerAbility || '').trim().toLowerCase(),
                abilitySuppressed: Boolean(trainerSession.playerAbilitySuppressed),
                effectiveStats: counterAttack?.player?.effectiveStats || null,
            },
            playerParty: serializeTrainerPlayerPartyState(trainerSession),
            forcedSwitch: playerForcedSwitch?.switched
                ? {
                    target: 'player',
                    nextIndex: playerForcedSwitch.nextIndex,
                    nextPokemonId: playerForcedSwitch?.nextEntry?.userPokemonId || null,
                    nextPokemonName: playerForcedSwitch?.nextEntry?.name || null,
                }
                : null,
            turnPhases,
            logLines,
            counterAttack,
            opponent: serializeTrainerBattleState(trainerSession),
        })
    } catch (error) {
        return next(error)
    }
})

router.post('/battle/resolve', authMiddleware, requireActiveGameplayTab({ actionLabel: 'nhận kết quả battle' }), async (req, res, next) => {
    try {
        const { trainerId = null } = req.body || {}
        const payload = await resolveTrainerBattleForUserDirect({
            userId: req.user.userId,
            trainerId,
        })

        return res.json(payload)
    } catch (error) {
        return next(error)
    }
})

export default router
