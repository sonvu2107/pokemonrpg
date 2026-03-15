import PlayerState from '../models/PlayerState.js'
import User from '../models/User.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import Pokemon from '../models/Pokemon.js'
import BattleTrainer from '../models/BattleTrainer.js'
import BattleSession from '../models/BattleSession.js'
import { emitPlayerState } from '../socket/index.js'
import { expToNext, getRarityExpMultiplier } from '../utils/gameUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { resolveEffectiveVipBonusBenefits } from './vipBenefitService.js'
import {
    distributeExpByDefeats,
    ensureTrainerCompletionTracked,
    trackDailyActivity,
} from './mapProgressionService.js'
import {
    resolvePokemonForm,
    resolvePokemonImageForForm,
    serializePlayerWallet,
} from './wildEncounterService.js'

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

const applyPercent = (baseValue = 0, bonusPercent = 0) => {
    const normalizedBase = Math.max(0, Math.floor(Number(baseValue) || 0))
    const normalizedPercent = Math.max(0, Number(bonusPercent) || 0)
    if (normalizedBase <= 0 || normalizedPercent <= 0) return normalizedBase
    return Math.max(1, Math.floor(normalizedBase * (1 + (normalizedPercent / 100))))
}

const createServiceError = (status, message, code = '') => {
    const error = new Error(String(message || '').trim() || 'SERVICE_ERROR')
    error.status = Math.max(400, Number(status) || 500)
    error.code = String(code || '').trim()
    return error
}

export const resolveTrainerBattleForUserDirect = async ({ userId, trainerId = null } = {}) => {
    const normalizedUserId = String(userId || '').trim()
    const normalizedTrainerId = String(trainerId || '').trim()

    if (!normalizedUserId) {
        throw createServiceError(400, 'userId là bắt buộc để nhận kết quả battle', 'INVALID_USER_ID')
    }

    if (!normalizedTrainerId) {
        throw createServiceError(400, 'trainerId là bắt buộc để nhận kết quả battle', 'TRAINER_ID_REQUIRED')
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
    let trainerRewardMarker = ''
    let trainerAlreadyCompleted = false
    let resolvedBattleSession = null

    const trainer = await BattleTrainer.findById(normalizedTrainerId)
        .populate('prizePokemonId', 'name imageUrl sprites forms defaultFormId')
        .populate('prizeItemId', 'name imageUrl type rarity')
        .lean()
    if (!trainer) {
        throw createServiceError(404, 'Không tìm thấy huấn luyện viên battle', 'TRAINER_NOT_FOUND')
    }

    const activeSession = await BattleSession.findOne({
        userId: normalizedUserId,
        trainerId: normalizedTrainerId,
        expiresAt: { $gt: new Date() },
    })
        .select('currentIndex team knockoutCounts playerTeam playerPokemonId playerCurrentHp playerMaxHp')
        .lean()

    if (!activeSession || !Array.isArray(activeSession.team) || activeSession.team.length === 0) {
        throw createServiceError(400, 'Không tìm thấy phiên battle. Vui lòng bắt đầu trận trước.', 'BATTLE_SESSION_NOT_FOUND')
    }

    const trainerBattleWon = activeSession.currentIndex >= activeSession.team.length
    const trainerPlayerDefeated = !hasLivingTrainerPlayer(activeSession)
    if (!trainerBattleWon && !trainerPlayerDefeated) {
        throw createServiceError(400, 'Trận battle chưa kết thúc. Hãy hạ toàn bộ Pokemon đối thủ trước.', 'BATTLE_NOT_FINISHED')
    }

    const claimedSession = await BattleSession.findOneAndDelete({
        _id: activeSession._id,
        userId: normalizedUserId,
        trainerId: normalizedTrainerId,
        expiresAt: { $gt: new Date() },
    })

    if (!claimedSession) {
        throw createServiceError(409, 'Phần thưởng battle đã được nhận. Vui lòng bắt đầu trận mới.', 'BATTLE_REWARD_ALREADY_CLAIMED')
    }

    resolvedBattleSession = claimedSession

    if (trainerPlayerDefeated && !trainerBattleWon) {
        const playerState = await PlayerState.findOne({ userId: normalizedUserId }).lean()
        const defeatedEntry = resolveDefeatedTrainerPlayerEntry(resolvedBattleSession)
        const defeatedUserPokemonId = String(
            resolvedBattleSession?.playerPokemonId
            || defeatedEntry?.userPokemonId
            || ''
        ).trim()

        let defeatedPokemon = {
            name: String(defeatedEntry?.name || 'Pokemon').trim() || 'Pokemon',
            imageUrl: '',
            level: 1,
            exp: 0,
            expToNext: 0,
            levelsGained: 0,
            happinessGained: 0,
            obtainedVipMapLevel: 0,
        }

        if (defeatedUserPokemonId) {
            const defeatedPokemonDoc = await UserPokemon.findOne({
                _id: defeatedUserPokemonId,
                userId: normalizedUserId,
            })
                .select('pokemonId level experience nickname formId isShiny obtainedVipMapLevel')
                .populate('pokemonId', 'name imageUrl sprites forms defaultFormId')
                .lean()

            if (defeatedPokemonDoc?.pokemonId) {
                defeatedPokemon = {
                    name: defeatedPokemonDoc.nickname || defeatedPokemonDoc.pokemonId.name || defeatedPokemon.name,
                    imageUrl: resolvePokemonImageForForm(
                        defeatedPokemonDoc.pokemonId,
                        defeatedPokemonDoc.formId,
                        Boolean(defeatedPokemonDoc.isShiny)
                    ),
                    level: Math.max(1, Number(defeatedPokemonDoc.level) || 1),
                    exp: Math.max(0, Number(defeatedPokemonDoc.experience) || 0),
                    expToNext: expToNext(Math.max(1, Number(defeatedPokemonDoc.level) || 1)),
                    levelsGained: 0,
                    happinessGained: 0,
                    obtainedVipMapLevel: Math.max(0, Number(defeatedPokemonDoc.obtainedVipMapLevel || 0) || 0),
                }
            }
        }

        return {
            ok: true,
            wallet: serializePlayerWallet(playerState),
            results: {
                resultType: 'defeat',
                message: 'Pokemon của bạn đã bại trận. Trận đấu kết thúc.',
                pokemon: defeatedPokemon,
                rewards: {
                    coins: 0,
                    trainerExp: 0,
                    moonPoints: 0,
                    prizePokemon: null,
                    prizeItem: null,
                },
                evolution: {
                    evolved: false,
                    chain: [],
                },
            },
        }
    }

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
    trainerRewardMarker = `battle_trainer_reward:${trainer._id}`

    if (!Array.isArray(sourceTeam) || sourceTeam.length === 0) {
        throw createServiceError(400, 'Cần có đội hình đối thủ', 'TRAINER_TEAM_REQUIRED')
    }

    const rewardUser = await User.findById(normalizedUserId)
        .select('vipTierId vipTierLevel vipBenefits completedBattleTrainers')
        .lean()
    const effectiveVipBonusBenefits = await resolveEffectiveVipBonusBenefits(rewardUser)
    const completedTrainerIds = Array.isArray(rewardUser?.completedBattleTrainers)
        ? rewardUser.completedBattleTrainers.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    trainerAlreadyCompleted = completedTrainerIds.includes(String(trainer._id))

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
    const baseMoonPointsAwarded = trainerMoonPointsReward > 0
        ? Math.floor(trainerMoonPointsReward)
        : 0
    const moonPointsAwarded = trainerAlreadyCompleted ? 0 : baseMoonPointsAwarded
    const happinessAwarded = 13

    const party = await UserPokemon.find(withActiveUserPokemonFilter({ userId: normalizedUserId, location: 'party' }))
        .select('pokemonId level experience friendship nickname formId isShiny partyIndex fusionLevel offTypeSkillAllowance allowOffTypeSkills')
        .sort({ partyIndex: 1 })
        .populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')
    const activePokemon = party.find((entry) => entry) || null

    if (!activePokemon) {
        throw createServiceError(400, 'Không có Pokemon đang hoạt động trong đội hình', 'NO_ACTIVE_POKEMON')
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
            obtainedVipMapLevel: Math.max(0, Number(participantPokemon.obtainedVipMapLevel || 0) || 0),
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
            obtainedVipMapLevel: Math.max(0, Number(activePokemon.obtainedVipMapLevel || 0) || 0),
            defeatedCount: 0,
            baseExp: 0,
            finalExp: 0,
        }

    const playerState = await PlayerState.findOneAndUpdate(
        { userId: normalizedUserId },
        {
            $setOnInsert: { userId: normalizedUserId },
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
    await trackDailyActivity(normalizedUserId, {
        battles: 1,
        levels: Math.max(0, totalLevelsGained),
        battleMoonPoints: moonPointsAwarded,
        moonPoints: moonPointsAwarded,
        platinumCoins: Math.max(0, coinsAwarded),
        trainerExp: Math.max(0, trainerExpAwarded),
    })
    emitPlayerState(normalizedUserId.toString(), playerState)

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

            const blockedByCompletion = trainerAlreadyCompleted
            const isPokemonRewardLocked = blockedByCompletion

            if (!isPokemonRewardLocked) {
                await UserPokemon.create({
                    userId: normalizedUserId,
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
                blockedReason: blockedByCompletion ? 'trainer_completed' : '',
            }
        }
    }

    if (trainerPrizeItem?._id && trainerPrizeItemQuantity > 0) {
        const isItemRewardLocked = trainerAlreadyCompleted
        let inventoryEntry = null

        if (!isItemRewardLocked) {
            inventoryEntry = await UserInventory.findOneAndUpdate(
                { userId: normalizedUserId, itemId: trainerPrizeItem._id },
                {
                    $setOnInsert: { userId: normalizedUserId, itemId: trainerPrizeItem._id },
                    $inc: { quantity: trainerPrizeItemQuantity },
                },
                { new: true, upsert: true }
            )
        }

        prizeItem = {
            id: trainerPrizeItem._id,
            name: trainerPrizeItem.name,
            imageUrl: trainerPrizeItem.imageUrl || '',
            quantity: trainerPrizeItemQuantity,
            totalQuantity: isItemRewardLocked ? null : Number(inventoryEntry?.quantity || trainerPrizeItemQuantity),
            claimed: !isItemRewardLocked,
            alreadyClaimed: isItemRewardLocked,
            blockedReason: isItemRewardLocked ? 'trainer_completed' : '',
        }
    }

    await ensureTrainerCompletionTracked(normalizedUserId, normalizedTrainerId)

    return {
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
    }
}
