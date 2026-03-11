import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import PlayerState from '../../models/PlayerState.js'
import User from '../../models/User.js'
import UserPokemon from '../../models/UserPokemon.js'
import UserInventory from '../../models/UserInventory.js'
import Pokemon from '../../models/Pokemon.js'
import BattleTrainer from '../../models/BattleTrainer.js'
import BattleSession from '../../models/BattleSession.js'
import { emitPlayerState } from '../../socket/index.js'
import { calcMaxHp, expToNext, getRarityExpMultiplier } from '../../utils/gameUtils.js'
import { withActiveUserPokemonFilter } from '../../utils/userPokemonQuery.js'
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

const router = express.Router()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const DEFAULT_TRAINER_PRIZE_LEVEL = 5
const USER_POKEMON_MAX_LEVEL = 2000

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
        await ensureTrainerSessionPlayerParty({
            trainerSession,
            userId,
            preferredActivePokemonId: normalizedActivePokemonId,
        })

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

        syncTrainerSessionActivePlayerToParty(trainerSession)
        setTrainerSessionActivePlayerByIndex(trainerSession, targetPartyIndex)
        trainerSession.playerMaxHp = Math.max(1, Number(targetPartyEntry?.maxHp || resolvedMaxHp || 1))
        trainerSession.playerCurrentHp = Math.max(0, Number(targetPartyEntry?.currentHp || 0))
        syncTrainerSessionActivePlayerToParty(trainerSession)

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
            .select('currentIndex team knockoutCounts')
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
        const coinsAwarded = Math.max(1, applyPercent(baseCoinsAwarded, coinBonusPercent))
        const expAwarded = trainerExpReward > 0
            ? Math.floor(trainerExpReward)
            : defaultScaledReward
        const baseMoonPointsAwarded = trainerIsAutoGenerated
            ? 0
            : (trainerMoonPointsReward > 0 ? Math.floor(trainerMoonPointsReward) : defaultScaledReward)
        const moonPointsAwarded = trainerAlreadyCompleted ? 0 : baseMoonPointsAwarded
        const happinessAwarded = 13

        const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId, location: 'party' }))
            .select('pokemonId level experience friendship nickname formId isShiny partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')
        const activePokemon = party.find((entry) => entry) || null

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
            .sort((a, b) => ((b.defeatedCount - a.defeatedCount) || (b.baseExp - a.baseExp)))[0] || {
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

        await ensureTrainerCompletionTracked(userId, normalizedTrainerId)

        return res.json({
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
                    moonPointsBlockedByCompletion: Boolean(trainerAlreadyCompleted && baseMoonPointsAwarded > 0),
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
        return next(error)
    }
})

const applyPercent = (baseValue = 0, bonusPercent = 0) => {
    const normalizedBase = Math.max(0, Math.floor(Number(baseValue) || 0))
    const normalizedPercent = Math.max(0, Number(bonusPercent) || 0)
    if (normalizedBase <= 0 || normalizedPercent <= 0) return normalizedBase
    return Math.max(1, Math.floor(normalizedBase * (1 + (normalizedPercent / 100))))
}

export default router
