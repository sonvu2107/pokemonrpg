import Encounter from '../models/Encounter.js'
import User from '../models/User.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import PlayerState from '../models/PlayerState.js'
import DailyActivity from '../models/DailyActivity.js'
import MapModel from '../models/Map.js'
import Pokemon from '../models/Pokemon.js'
import Item from '../models/Item.js'
import { emitPlayerState, getIO } from '../socket/index.js'
import { calcStatsForLevel, expToNext, getRarityExpMultiplier } from '../utils/gameUtils.js'
import { getMaxCatchAttempts } from '../utils/autoTrainerUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'
import { loadBattleBadgeBonusStateForUser } from '../utils/badgeUtils.js'
import { calcBattleDamage } from '../battle/battleCalc.js'
import { applyPercentBonus, applyPercentMultiplier, rollDamage } from '../battle/battleRuntimeUtils.js'
import { normalizePokemonTypes, resolveEffectivenessText, resolveTypeEffectiveness } from '../battle/typeSystem.js'
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
} from './wildEncounterService.js'
import {
    resolveEffectiveVipBonusBenefits,
    resolveEffectiveVipVisualBenefits,
} from './vipBenefitService.js'
import { toDailyDateKey, trackDailyActivity } from './mapProgressionService.js'

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

const isObjectIdLike = (value = '') => /^[a-f\d]{24}$/i.test(String(value || '').trim())

const createServiceError = (message, { status = 400, code = '', payload = null } = {}) => {
    const error = new Error(String(message || '').trim() || 'SERVICE_ERROR')
    error.status = Math.max(400, Number(status) || 400)
    error.code = String(code || '').trim()
    if (payload && typeof payload === 'object') {
        error.payload = payload
    }
    return error
}

const getBallCatchChance = ({ item, baseChance, hp, maxHp, rarity, rarityCatchBonusPercent = 0 }) => {
    const hasFixedCatchRate = item?.effectType === 'catchMultiplier' && Number.isFinite(Number(item.effectValue))
    const chanceBeforeLowHpBonus = hasFixedCatchRate
        ? Math.min(1, Math.max(0, Number(item.effectValue) / 100))
        : Math.min(
            0.95,
            Math.max(0.02, baseChance) * (1 + ((Number(rarityCatchBonusPercent) || 0) / 100))
        )
    const lowHpCatchBonusPercent = calcLowHpCatchBonusPercent({ hp, maxHp, rarity })
    const minChance = hasFixedCatchRate ? 0 : 0.02

    return {
        chance: Math.min(
            0.99,
            Math.max(minChance, chanceBeforeLowHpBonus * (1 + (lowHpCatchBonusPercent / 100)))
        ),
        lowHpCatchBonusPercent,
    }
}

export const usePokeballOnEncounterDirect = async ({ userId, itemId, encounterId, quantity = 1 } = {}) => {
    const normalizedUserId = String(userId || '').trim()
    const normalizedItemId = String(itemId || '').trim()
    const normalizedEncounterId = String(encounterId || '').trim()
    const qty = Number(quantity)

    if (!normalizedUserId || !isObjectIdLike(normalizedUserId)) {
        throw createServiceError('userId không hợp lệ', { status: 400, code: 'INVALID_USER_ID' })
    }
    if (!normalizedItemId || !isObjectIdLike(normalizedItemId)) {
        throw createServiceError('Vật phẩm hoặc số lượng không hợp lệ', { status: 400, code: 'INVALID_ITEM_ID' })
    }
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        throw createServiceError('Vật phẩm hoặc số lượng không hợp lệ', { status: 400, code: 'INVALID_QUANTITY' })
    }

    const item = await Item.findById(normalizedItemId).lean()
    if (!item) {
        throw createServiceError('Không tìm thấy vật phẩm', { status: 404, code: 'ITEM_NOT_FOUND' })
    }
    if (item.type !== 'pokeball') {
        throw createServiceError('Vật phẩm không phải pokeball', { status: 400, code: 'ITEM_NOT_POKEBALL' })
    }
    if (qty !== 1) {
        throw createServiceError('Pokeball chỉ được dùng từng quả một', { status: 400, code: 'INVALID_QUANTITY' })
    }
    if (!normalizedEncounterId || !isObjectIdLike(normalizedEncounterId)) {
        throw createServiceError('Cần trong trận chiến để dùng pokeball', { status: 400, code: 'INVALID_ENCOUNTER_ID' })
    }

    const encounter = await Encounter.findOne({ _id: normalizedEncounterId, userId: normalizedUserId, isActive: true })
        .select('pokemonId mapId level hp maxHp isShiny formId catchAttempts')
        .lean()
    if (!encounter) {
        throw createServiceError('Không tìm thấy trận chiến hoặc đã kết thúc. Vui lòng tải lại.', { status: 404, code: 'ENCOUNTER_NOT_FOUND' })
    }

    const consumedEntry = await UserInventory.findOneAndUpdate(
        {
            userId: normalizedUserId,
            itemId: normalizedItemId,
            quantity: { $gte: qty },
        },
        { $inc: { quantity: -qty } },
        { new: true }
    )

    if (!consumedEntry) {
        throw createServiceError('Không đủ vật phẩm', { status: 400, code: 'INSUFFICIENT_ITEM' })
    }

    if (consumedEntry.quantity <= 0) {
        await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
    }

    const pokemon = await Pokemon.findById(encounter.pokemonId)
        .select('name pokedexNumber baseStats catchRate levelUpMoves rarity imageUrl forms sprites defaultFormId')
        .lean()

    if (!pokemon) {
        await UserInventory.updateOne(
            { userId: normalizedUserId, itemId: normalizedItemId },
            { $inc: { quantity: qty } },
            { upsert: true }
        )
        throw createServiceError('Không tìm thấy Pokemon', { status: 404, code: 'POKEMON_NOT_FOUND' })
    }

    const encounterMap = encounter?.mapId
        ? await MapModel.findById(encounter.mapId)
            .select('name rarityCatchBonusPercent requiredVipLevel vipVisibilityLevel')
            .lean()
        : null

    const mapRarityCatchBonusPercent = resolveMapRarityCatchBonusPercent({
        mapLike: encounterMap,
        rarity: pokemon?.rarity,
    })

    const baseChance = calcCatchChance({
        catchRate: pokemon.catchRate,
        hp: encounter.hp,
        maxHp: encounter.maxHp,
    })
    const { chance, lowHpCatchBonusPercent } = getBallCatchChance({
        item,
        baseChance,
        hp: encounter.hp,
        maxHp: encounter.maxHp,
        rarity: pokemon?.rarity,
        rarityCatchBonusPercent: mapRarityCatchBonusPercent,
    })
    const caught = Math.random() < chance

    if (caught) {
        const resolvedEncounter = await Encounter.findOneAndUpdate(
            { _id: normalizedEncounterId, userId: normalizedUserId, isActive: true },
            { $set: { isActive: false, endedAt: new Date() } },
            { new: true }
        )

        if (!resolvedEncounter) {
            await UserInventory.updateOne(
                { userId: normalizedUserId, itemId: normalizedItemId },
                { $inc: { quantity: qty } },
                { upsert: true }
            )
            throw createServiceError('Trận chiến đã kết thúc. Vui lòng tải lại.', { status: 409, code: 'ENCOUNTER_FINISHED' })
        }

        const obtainedMapName = String(encounterMap?.name || '').trim()
        const obtainedVipMapLevel = Math.max(
            0,
            Number(encounterMap?.requiredVipLevel || 0) || 0,
            Number(encounterMap?.vipVisibilityLevel || 0) || 0
        )

        await UserPokemon.create({
            userId: normalizedUserId,
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
                const currentUser = await User.findById(normalizedUserId)
                    .select('username role vipTierId vipTierLevel vipBenefits')
                    .lean()
                const effectiveVipVisualBenefits = await resolveEffectiveVipVisualBenefits(currentUser)
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
                    usernameColor: effectiveVipVisualBenefits.usernameColor,
                    usernameGradientColor: effectiveVipVisualBenefits.usernameGradientColor,
                    usernameEffectColors: effectiveVipVisualBenefits.usernameEffectColors,
                    usernameEffect: effectiveVipVisualBenefits.usernameEffect,
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

        return {
            ok: true,
            caught: true,
            encounterId: resolvedEncounter._id,
            hp: resolvedEncounter.hp,
            maxHp: resolvedEncounter.maxHp,
            catchChancePercent: Number((chance * 100).toFixed(2)),
            lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
            message: `Đã bắt được ${pokemon.name}!`,
            globalNotification: globalNotificationPayload,
        }
    }

    const isStillActive = await Encounter.exists({ _id: normalizedEncounterId, userId: normalizedUserId, isActive: true })
    if (!isStillActive) {
        await UserInventory.updateOne(
            { userId: normalizedUserId, itemId: normalizedItemId },
            { $inc: { quantity: qty } },
            { upsert: true }
        )
        throw createServiceError('Trận chiến đã kết thúc. Vui lòng tải lại.', { status: 409, code: 'ENCOUNTER_FINISHED' })
    }

    const catchUser = await User.findById(normalizedUserId)
        .select('role vipTierLevel vipBenefits')
        .lean()
    const maxAttempts = getMaxCatchAttempts(catchUser)
    const nextAttempts = Math.max(0, Number(encounter.catchAttempts || 0)) + 1

    await User.updateOne(
        { _id: normalizedUserId },
        { $inc: { catchFailCount: 1 } }
    )

    if (nextAttempts >= maxAttempts) {
        await Encounter.findOneAndUpdate(
            { _id: normalizedEncounterId, userId: normalizedUserId, isActive: true },
            { $set: { isActive: false, endedAt: new Date(), catchAttempts: nextAttempts } }
        )
        return {
            ok: true,
            caught: false,
            fled: true,
            encounterId: normalizedEncounterId,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            catchChancePercent: Number((chance * 100).toFixed(2)),
            lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
            catchAttempts: nextAttempts,
            maxCatchAttempts: maxAttempts,
            message: `Pokemon đã thoát khỏi bóng và bỏ chạy! (Đã thử ${nextAttempts}/${maxAttempts} lần)`,
        }
    }

    await Encounter.findOneAndUpdate(
        { _id: normalizedEncounterId, userId: normalizedUserId, isActive: true },
        { $set: { catchAttempts: nextAttempts } }
    )

    const remainingAttempts = maxAttempts - nextAttempts
    return {
        ok: true,
        caught: false,
        fled: false,
        encounterId: normalizedEncounterId,
        hp: encounter.hp,
        maxHp: encounter.maxHp,
        catchChancePercent: Number((chance * 100).toFixed(2)),
        lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
        catchAttempts: nextAttempts,
        maxCatchAttempts: maxAttempts,
        remainingAttempts,
        message: `Pokemon đã thoát khỏi bóng! Còn ${remainingAttempts} lần thử.`,
    }
}

export const attackEncounterForUserDirect = async ({ userId, encounterId } = {}) => {
    const normalizedUserId = String(userId || '').trim()
    const normalizedEncounterId = String(encounterId || '').trim()

    if (!normalizedUserId || !isObjectIdLike(normalizedUserId)) {
        throw createServiceError('userId không hợp lệ', { status: 400, code: 'INVALID_USER_ID' })
    }
    if (!normalizedEncounterId || !isObjectIdLike(normalizedEncounterId)) {
        throw createServiceError('encounterId không hợp lệ', { status: 400, code: 'INVALID_ENCOUNTER_ID' })
    }

    const encounter = await Encounter.findOne({ _id: normalizedEncounterId, userId: normalizedUserId, isActive: true })
    if (!encounter) {
        throw createServiceError('Không tìm thấy cuộc chạm trán hoặc đã kết thúc', { status: 404, code: 'ENCOUNTER_NOT_FOUND' })
    }

    let playerBattleBefore = formatWildPlayerBattleState(encounter)
    if (!playerBattleBefore) {
        const fallbackPlayerBattle = await resolveWildPlayerBattleSnapshot(normalizedUserId)
        if (!fallbackPlayerBattle) {
            throw createServiceError('Bạn cần có Pokemon trong đội hình để chiến đấu ở map.', {
                status: 400,
                code: 'NO_PARTY',
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
        throw createServiceError('Pokemon trong đội của bạn đã kiệt sức. Hãy rút lui và chuẩn bị lại đội hình.', {
            status: 400,
            code: 'PLAYER_DEFEATED',
            payload: {
                ok: false,
                defeated: false,
                playerDefeated: true,
                playerBattle: formatWildPlayerBattleState(encounter),
            },
        })
    }

    const badgeBonusState = await loadBattleBadgeBonusStateForUser(
        normalizedUserId,
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
            { userId: normalizedUserId, date },
            {
                $setOnInsert: { userId: normalizedUserId, date },
                $inc: { wildDefeats: 1 },
            },
            { new: true, upsert: true }
        )

        const wildDefeatsToday = Math.max(1, Math.floor(Number(dailyActivity?.wildDefeats) || 1))
        reward = calcWildRewardPlatinumCoins({
            level: encounter.level,
            wildDefeatsToday,
        })

        const currentUser = await User.findById(normalizedUserId)
            .select('vipTierId vipTierLevel vipBenefits')
            .lean()
        const effectiveVipBonusBenefits = await resolveEffectiveVipBonusBenefits(currentUser)
        const baseRewardPlatinumCoins = Math.max(0, Number(reward?.platinumCoins || 0))
        reward.basePlatinumCoinsBeforeVip = baseRewardPlatinumCoins
        reward.platinumCoinBonusPercent = Math.max(0, Number(effectiveVipBonusBenefits?.platinumCoinBonusPercent || 0))
        reward.platinumCoins = applyPercentBonus(baseRewardPlatinumCoins, reward.platinumCoinBonusPercent)

        if (reward.platinumCoins > 0) {
            playerState = await PlayerState.findOneAndUpdate(
                { userId: normalizedUserId },
                {
                    $setOnInsert: { userId: normalizedUserId },
                    $inc: { gold: reward.platinumCoins },
                },
                { new: true, upsert: true }
            )

            emitPlayerState(String(normalizedUserId), playerState)
            await trackDailyActivity(normalizedUserId, { platinumCoins: reward.platinumCoins })
        }

        const leadPartyPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId: normalizedUserId, location: 'party' }))
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
                await trackDailyActivity(normalizedUserId, {
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

    return {
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
    }
}
