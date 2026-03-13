import UserPokemon from '../models/UserPokemon.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'
import { normalizePokemonTypes } from '../battle/typeSystem.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'
import { loadBattleBadgeBonusStateForUser } from '../utils/badgeUtils.js'
import { getSpecialDefenseStat } from './trainerBattleStateService.js'
import { resolvePlayerBattleMaxHp } from '../utils/playerBattleStats.js'

const LOW_HP_CATCH_BONUS_CAP_BY_RARITY = Object.freeze({
    'sss+': 10,
    d: 31,
    c: 29,
    b: 27,
    a: 25,
    s: 21,
    ss: 17,
    sss: 14,
})
const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 23
const MAP_RARITY_CATCH_BONUS_KEYS = Object.freeze(['s', 'ss', 'sss', 'sss+'])
const MAP_RARITY_CATCH_BONUS_MIN_PERCENT = -95
const MAP_RARITY_CATCH_BONUS_MAX_PERCENT = 500

const WILD_REWARD_BASE_PLATINUM_COINS = 3
const WILD_REWARD_LEVEL_DIVISOR = 4
const WILD_REWARD_PLATINUM_COINS_CAP = 20
const WILD_REWARD_HALF_RATE_AFTER = 100
const WILD_REWARD_REDUCED_RATE_AFTER = 200

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

export const normalizeMapRarityCatchBonusPercent = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return MAP_RARITY_CATCH_BONUS_KEYS.reduce((acc, key) => {
        const parsed = Number(source?.[key])
        acc[key] = Number.isFinite(parsed)
            ? clamp(parsed, MAP_RARITY_CATCH_BONUS_MIN_PERCENT, MAP_RARITY_CATCH_BONUS_MAX_PERCENT)
            : 0
        return acc
    }, {})
}

export const resolveMapRarityCatchBonusPercent = ({ mapLike, rarity }) => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    if (!MAP_RARITY_CATCH_BONUS_KEYS.includes(normalizedRarity)) return 0
    const normalizedMapBonus = normalizeMapRarityCatchBonusPercent(mapLike?.rarityCatchBonusPercent)
    return Number(normalizedMapBonus?.[normalizedRarity] || 0)
}

const calcWildRewardBasePlatinumCoins = (level = 1) => {
    const normalizedLevel = Math.max(1, Number(level) || 1)
    const scaled = WILD_REWARD_BASE_PLATINUM_COINS + Math.floor(normalizedLevel / WILD_REWARD_LEVEL_DIVISOR)
    return Math.max(1, Math.min(WILD_REWARD_PLATINUM_COINS_CAP, scaled))
}

const resolveWildRewardMultiplier = (wildDefeatsToday = 0) => {
    const normalized = Math.max(0, Math.floor(Number(wildDefeatsToday) || 0))
    if (normalized > WILD_REWARD_REDUCED_RATE_AFTER) return 0.2
    if (normalized > WILD_REWARD_HALF_RATE_AFTER) return 0.5
    return 1
}

export const calcWildRewardPlatinumCoins = ({ level = 1, wildDefeatsToday = 0 } = {}) => {
    const basePlatinumCoins = calcWildRewardBasePlatinumCoins(level)
    const multiplier = resolveWildRewardMultiplier(wildDefeatsToday)
    if (multiplier >= 1) {
        return {
            basePlatinumCoins,
            multiplier,
            platinumCoins: basePlatinumCoins,
        }
    }

    return {
        basePlatinumCoins,
        multiplier,
        platinumCoins: Math.max(1, Math.floor(basePlatinumCoins * multiplier)),
    }
}

export const serializePlayerWallet = (playerStateLike) => {
    const platinumCoins = Number(playerStateLike?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerStateLike?.moonPoints || 0),
    }
}

export const resolveWildPlayerBattleSnapshot = async (userId) => {
    const leadPartyPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId, location: 'party' }))
        .sort({ partyIndex: 1, _id: 1 })
        .populate('pokemonId', 'name types rarity baseStats forms defaultFormId sprites imageUrl')
        .lean()

    if (!leadPartyPokemon?.pokemonId) {
        return null
    }

    const species = leadPartyPokemon.pokemonId
    const level = Math.max(1, Number(leadPartyPokemon.level) || 1)
    const { form: resolvedForm } = resolvePokemonForm(species, leadPartyPokemon.formId)
    const formSprites = resolvedForm?.sprites || null
    const formImageUrl = resolvedForm?.imageUrl || ''
    const baseStats = resolveEffectivePokemonBaseStats({
        pokemonLike: species,
        formId: leadPartyPokemon.formId,
        resolvedForm,
    })
    const scaledStats = calcStatsForLevel(baseStats, level, species.rarity)
    const badgeBonusState = await loadBattleBadgeBonusStateForUser(userId, normalizePokemonTypes(species.types))
    const maxHp = resolvePlayerBattleMaxHp({
        baseHp: baseStats?.hp,
        level,
        rarity: species?.rarity || 'd',
        hpBonusPercent: badgeBonusState?.hpBonusPercent || 0,
    })
    const defense = Math.max(
        1,
        Number(scaledStats?.def) ||
        getSpecialDefenseStat(scaledStats) ||
        (20 + level * 2)
    )

    return {
        playerPokemonId: species._id,
        playerPokemonName: String(species.name || '').trim() || 'Pokemon của bạn',
        playerPokemonImageUrl: formSprites?.normal || formSprites?.icon || formImageUrl || species.imageUrl || species.sprites?.normal || species.sprites?.front_default || '',
        playerPokemonLevel: level,
        playerDefense: defense,
        playerTypes: normalizePokemonTypes(species.types),
        playerCurrentHp: maxHp,
        playerMaxHp: maxHp,
    }
}

export const formatWildPlayerBattleState = (encounterLike = {}) => {
    const maxHp = Math.max(0, Number(encounterLike?.playerMaxHp) || 0)
    if (maxHp <= 0) return null
    const currentHp = clamp(
        Math.floor(Number.isFinite(Number(encounterLike?.playerCurrentHp)) ? Number(encounterLike?.playerCurrentHp) : maxHp),
        0,
        maxHp
    )

    return {
        pokemonId: encounterLike?.playerPokemonId || null,
        name: String(encounterLike?.playerPokemonName || '').trim() || 'Pokemon của bạn',
        imageUrl: encounterLike?.playerPokemonImageUrl || '',
        level: Math.max(1, Number(encounterLike?.playerPokemonLevel) || 1),
        currentHp,
        maxHp,
        defeated: currentHp <= 0,
    }
}

export const resolvePokemonForm = (pokemon, formId) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)
    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    let resolvedFormId = requestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return { form: resolvedForm, formId: resolvedFormId }
}

export const resolvePokemonImageForForm = (pokemon, formId, isShiny = false) => {
    const { form } = resolvePokemonForm(pokemon, formId)
    const normalSprite = form?.imageUrl
        || form?.sprites?.normal
        || form?.sprites?.icon
        || pokemon?.imageUrl
        || pokemon?.sprites?.normal
        || pokemon?.sprites?.front_default
        || ''

    if (isShiny) {
        return form?.sprites?.shiny || pokemon?.sprites?.shiny || normalSprite
    }

    return normalSprite
}

export const calcCatchChance = ({ catchRate, hp, maxHp }) => {
    const rate = Math.min(255, Math.max(1, catchRate || 45))
    const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
    const raw = (rate / 255) * hpFactor
    return Math.min(0.95, Math.max(0.02, raw))
}

const resolveLowHpCatchBonusCapPercent = (rarity = '') => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    const capFromRarity = Number(LOW_HP_CATCH_BONUS_CAP_BY_RARITY[normalizedRarity])
    if (Number.isFinite(capFromRarity) && capFromRarity >= 0) return capFromRarity
    return LOW_HP_CATCH_BONUS_CAP_FALLBACK
}

export const calcLowHpCatchBonusPercent = ({ hp, maxHp, rarity }) => {
    const normalizedMaxHp = Math.max(1, Number(maxHp) || 1)
    const resolvedHp = Number.isFinite(Number(hp)) ? Number(hp) : normalizedMaxHp
    const normalizedHp = clamp(resolvedHp, 0, normalizedMaxHp)
    const missingHpRatio = (normalizedMaxHp - normalizedHp) / normalizedMaxHp
    const capPercent = resolveLowHpCatchBonusCapPercent(rarity)
    return Math.max(0, missingHpRatio * capPercent)
}
