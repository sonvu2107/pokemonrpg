import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import { createActionGuard } from '../../middleware/actionGuard.js'
import { emitPlayerState, getIO } from '../../socket/index.js'
import Encounter from '../../models/Encounter.js'
import User from '../../models/User.js'
import UserPokemon from '../../models/UserPokemon.js'
import PlayerState from '../../models/PlayerState.js'
import DailyActivity from '../../models/DailyActivity.js'
import MapModel from '../../models/Map.js'
import Pokemon from '../../models/Pokemon.js'
import { calcStatsForLevel, expToNext, getRarityExpMultiplier } from '../../utils/gameUtils.js'
import { getMaxCatchAttempts } from '../../utils/autoTrainerUtils.js'
import { withActiveUserPokemonFilter } from '../../utils/userPokemonQuery.js'
import { resolveEffectivePokemonBaseStats } from '../../utils/pokemonFormStats.js'
import { loadBattleBadgeBonusStateForUser } from '../../utils/badgeUtils.js'
import { calcBattleDamage } from '../../battle/battleCalc.js'
import { applyPercentBonus, applyPercentMultiplier, rollDamage } from '../../battle/battleRuntimeUtils.js'
import { normalizePokemonTypes, resolveEffectivenessText, resolveTypeEffectiveness } from '../../battle/typeSystem.js'
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
} from '../../services/wildEncounterService.js'
import {
    resolveEffectiveVipBonusBenefits,
    resolveEffectiveVipVisualBenefits,
} from '../../services/vipBenefitService.js'
import { hasOwnedPokemonForm } from '../../services/userPokemonOwnershipService.js'
import { toDailyDateKey, trackDailyActivity } from '../../services/mapProgressionService.js'

const router = express.Router()

const WILD_POKEMON_EXP_SCALE = 0.8
const USER_POKEMON_MAX_LEVEL = 3000
const WILD_COUNTER_MOVE = {
    name: 'Tackle',
    type: 'normal',
    category: 'physical',
    power: 40,
    accuracy: 95,
    criticalChance: 0.0625,
}

const encounterAttackActionGuard = createActionGuard({
    actionKey: 'game:encounter-attack',
    cooldownMs: 250,
    message: 'Tấn công quá nhanh. Vui lòng đợi một chút.',
})

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

        return res.json({
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
        return next(error)
    }
})

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
            const obtainedVipMapLevel = Math.max(
                0,
                Number(encounterMap?.requiredVipLevel || 0) || 0,
                Number(encounterMap?.vipVisibilityLevel || 0) || 0
            )

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
                obtainedVipMapLevel,
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

        const maxAttempts = getMaxCatchAttempts(currentUser)
        const nextAttempts = Math.max(0, Number(encounter.catchAttempts || 0)) + 1

        await User.updateOne(
            { _id: userId },
            { $inc: { catchFailCount: 1 } }
        )

        if (nextAttempts >= maxAttempts) {
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

        await Encounter.findOneAndUpdate(
            { _id: req.params.id, userId, isActive: true },
            { $set: { catchAttempts: nextAttempts } }
        )

        const remainingAttempts = maxAttempts - nextAttempts
        return res.json({
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
        return next(error)
    }
})

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

        return res.json({ ok: true, message: 'Bạn đã bỏ chạy.' })
    } catch (error) {
        return next(error)
    }
})

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

        return res.json({
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
        return next(error)
    }
})

export default router
