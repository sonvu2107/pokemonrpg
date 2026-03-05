import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
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
import { syncUserPokemonMovesAndPp } from '../utils/movePpUtils.js'
import { applyEffectSpecs } from '../battle/effects/effectRegistry.js'



const rollDamage = (level) => {
    const base = Math.max(5, Math.floor(level * 0.6))
    return base + Math.floor(Math.random() * 6)
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const WILD_REWARD_BASE_PLATINUM_COINS = 3
const WILD_REWARD_LEVEL_DIVISOR = 4
const WILD_REWARD_PLATINUM_COINS_CAP = 20
const WILD_REWARD_HALF_RATE_AFTER = 100
const WILD_REWARD_REDUCED_RATE_AFTER = 200
const DEFAULT_TRAINER_PRIZE_LEVEL = 5
const USER_POKEMON_MAX_LEVEL = 1000
const WILD_COUNTER_MOVE = {
    name: 'Tackle',
    type: 'normal',
    category: 'physical',
    power: 40,
    accuracy: 95,
    criticalChance: 0.0625,
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

const calcWildRewardPlatinumCoins = ({ level = 1, wildDefeatsToday = 0 } = {}) => {
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

const resolveWildPlayerBattleSnapshot = async (userId) => {
    const leadPartyPokemon = await UserPokemon.findOne({ userId, location: 'party' })
        .sort({ partyIndex: 1, _id: 1 })
        .populate('pokemonId', 'name types rarity baseStats forms defaultFormId sprites imageUrl')
        .lean()

    if (!leadPartyPokemon?.pokemonId) {
        return null
    }

    const species = leadPartyPokemon.pokemonId
    const level = Math.max(1, Number(leadPartyPokemon.level) || 1)
    const { form: resolvedForm } = resolvePokemonForm(species, leadPartyPokemon.formId)
    const formStats = resolvedForm?.stats || null
    const formSprites = resolvedForm?.sprites || null
    const formImageUrl = resolvedForm?.imageUrl || ''
    const baseStats = formStats || species.baseStats || {}
    const scaledStats = calcStatsForLevel(baseStats, level, species.rarity)
    const maxHp = Math.max(1, calcMaxHp(baseStats?.hp, level, species.rarity))
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

const formatWildPlayerBattleState = (encounterLike = {}) => {
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

const serializePlayerWallet = (playerStateLike) => {
    const platinumCoins = Number(playerStateLike?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerStateLike?.moonPoints || 0),
    }
}

const normalizeMoveName = (value) => String(value || '').trim().toLowerCase()

const inferMoveType = (name = '') => {
    const normalized = normalizeMoveName(name)
    if (normalized.includes('fire')) return 'fire'
    if (normalized.includes('water')) return 'water'
    if (normalized.includes('grass') || normalized.includes('leaf') || normalized.includes('vine')) return 'grass'
    if (normalized.includes('electric') || normalized.includes('thunder') || normalized.includes('spark')) return 'electric'
    if (normalized.includes('ice') || normalized.includes('frost')) return 'ice'
    if (normalized.includes('dragon')) return 'dragon'
    if (normalized.includes('shadow') || normalized.includes('ghost')) return 'ghost'
    if (normalized.includes('poison') || normalized.includes('toxic')) return 'poison'
    return 'normal'
}

const TYPE_EFFECTIVENESS_CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ground: 2, flying: 2, dragon: 2, steel: 0.5, ice: 0.5 },
    fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, fairy: 2, steel: 0.5 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
}

const normalizeTypeToken = (value = '') => String(value || '').trim().toLowerCase()

const normalizePokemonTypes = (types = []) => {
    const entries = Array.isArray(types) ? types : []
    return [...new Set(entries.map((entry) => normalizeTypeToken(entry)).filter(Boolean))]
}

const WEATHER_CHIP_IMMUNITY = {
    hail: new Set(['ice']),
    sandstorm: new Set(['rock', 'ground', 'steel']),
}

const isImmuneToWeatherChip = (weather = '', pokemonTypes = []) => {
    const normalizedWeather = String(weather || '').trim().toLowerCase()
    const immuneTypes = WEATHER_CHIP_IMMUNITY[normalizedWeather]
    if (!immuneTypes) return true
    const types = normalizePokemonTypes(pokemonTypes)
    return types.some((type) => immuneTypes.has(type))
}

const resolveMoveCategory = (moveDoc, fallbackMove, resolvedPower) => {
    const category = normalizeTypeToken(moveDoc?.category || fallbackMove?.category)
    if (category === 'physical' || category === 'special' || category === 'status') {
        return category
    }
    return resolvedPower > 0 ? 'physical' : 'status'
}

const resolveMoveAccuracy = (moveDoc, fallbackMove) => {
    let accuracy = Number(moveDoc?.accuracy)
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
        accuracy = Number(fallbackMove?.accuracy)
    }
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
        return 100
    }
    return clamp(Math.floor(accuracy), 1, 100)
}

const resolveMovePriority = (moveDoc, fallbackMove) => {
    let priority = Number(moveDoc?.priority)
    if (!Number.isFinite(priority)) {
        priority = Number(fallbackMove?.priority)
    }
    if (!Number.isFinite(priority)) {
        return 0
    }
    return clamp(Math.floor(priority), -7, 7)
}

const resolveMoveCriticalChance = (moveDoc, fallbackMove) => {
    const fromEffects = Number(moveDoc?.effects?.criticalChance ?? fallbackMove?.effects?.criticalChance)
    if (Number.isFinite(fromEffects)) {
        if (fromEffects > 1) {
            return Math.min(1, Math.max(0, fromEffects / 100))
        }
        return Math.min(1, Math.max(0, fromEffects))
    }

    const description = String(moveDoc?.description || fallbackMove?.description || '').toLowerCase()
    if (description.includes('always results in a critical hit') || description.includes('always critical')) {
        return 1
    }
    if (description.includes('high critical hit ratio')) {
        return 0.125
    }
    return 0.0625
}

const resolveTypeEffectiveness = (moveType, defenderTypes = []) => {
    const normalizedMoveType = normalizeTypeToken(moveType)
    const chart = TYPE_EFFECTIVENESS_CHART[normalizedMoveType] || {}
    const uniqueDefenderTypes = normalizePokemonTypes(defenderTypes)

    if (uniqueDefenderTypes.length === 0) {
        return { multiplier: 1, breakdown: [] }
    }

    let multiplier = 1
    const breakdown = uniqueDefenderTypes.map((type) => {
        const perType = Number.isFinite(chart[type]) ? chart[type] : 1
        multiplier *= perType
        return { type, multiplier: perType }
    })

    return { multiplier, breakdown }
}

const resolveEffectivenessText = (multiplier) => {
    if (multiplier === 0) return 'Không có tác dụng.'
    if (multiplier >= 2) return 'Rất hiệu quả!'
    if (multiplier > 1) return 'Hiệu quả.'
    if (multiplier < 1) return 'Không hiệu quả lắm.'
    return ''
}

const calcBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat, modifier = 1 }) => {
    if (!Number.isFinite(modifier) || modifier <= 0) return 0
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const randomFactor = 0.85 + Math.random() * 0.15
    return Math.max(1, Math.floor(base * modifier * randomFactor))
}

const estimateBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat, modifier = 1 }) => {
    if (!Number.isFinite(modifier) || modifier <= 0) return 0
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const averageRandomFactor = 0.925
    return Math.max(1, Math.floor(base * modifier * averageRandomFactor))
}

const normalizeEffectSpecs = (value) => (Array.isArray(value) ? value : [])

const SUPPORTED_STAT_STAGE_KEYS = new Set(['atk', 'def', 'spatk', 'spdef', 'spd', 'acc', 'eva'])

const STATUS_ALIASES = {
    burn: 'burn',
    burned: 'burn',
    poison: 'poison',
    poisoned: 'poison',
    toxic: 'poison',
    paralysis: 'paralyze',
    paralyzed: 'paralyze',
    paralyze: 'paralyze',
    freeze: 'freeze',
    frozen: 'freeze',
    sleep: 'sleep',
    asleep: 'sleep',
    confuse: 'confuse',
    confusion: 'confuse',
    flinch: 'flinch',
}

const normalizeBattleStatus = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return STATUS_ALIASES[normalized] || ''
}

const DEFAULT_STATUS_TURN_RANGES = {
    sleep: [1, 3],
    freeze: [2, 4],
    confuse: [2, 4],
    flinch: [1, 1],
}

const normalizeStatusTurns = (value = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
}

const clampGuardMultiplier = (value = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 1
    return Math.max(0, Math.min(1, parsed))
}

const normalizeDamageGuardEntry = (value = null) => {
    if (!value || typeof value !== 'object') return null
    const turns = normalizeStatusTurns(value.turns)
    if (turns <= 0) return null
    return {
        multiplier: clampGuardMultiplier(value.multiplier),
        turns,
    }
}

const normalizeDamageGuards = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const physical = normalizeDamageGuardEntry(source.physical)
    const special = normalizeDamageGuardEntry(source.special)
    return {
        ...(physical ? { physical } : {}),
        ...(special ? { special } : {}),
    }
}

const mergeDamageGuards = (base = {}, patch = {}) => {
    const current = normalizeDamageGuards(base)
    const nextPatch = normalizeDamageGuards(patch)
    return {
        ...current,
        ...nextPatch,
    }
}

const decrementDamageGuards = (value = {}) => {
    const current = normalizeDamageGuards(value)
    const next = {}

    if (current.physical && current.physical.turns > 1) {
        next.physical = {
            ...current.physical,
            turns: current.physical.turns - 1,
        }
    }
    if (current.special && current.special.turns > 1) {
        next.special = {
            ...current.special,
            turns: current.special.turns - 1,
        }
    }

    return next
}

const applyDamageGuardsToDamage = (damage = 0, category = 'physical', guards = {}) => {
    const baseDamage = Math.max(0, Math.floor(Number(damage) || 0))
    if (baseDamage <= 0) return 0
    const normalizedCategory = String(category || '').trim().toLowerCase()
    if (normalizedCategory !== 'physical' && normalizedCategory !== 'special') return baseDamage

    const normalizedGuards = normalizeDamageGuards(guards)
    const guard = normalizedGuards[normalizedCategory]
    if (!guard || guard.turns <= 0) return baseDamage
    return Math.max(0, Math.floor(baseDamage * clampGuardMultiplier(guard.multiplier)))
}

const clampFraction = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(1, parsed))
}

const normalizeVolatileState = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const rechargeTurns = normalizeStatusTurns(source.rechargeTurns)
    const bindTurns = normalizeStatusTurns(source.bindTurns)
    const bindFraction = clampFraction(source.bindFraction, 1 / 16)
    const lockedRepeatMoveName = String(source.lockedRepeatMoveName || '').trim()
    const statusShieldTurns = normalizeStatusTurns(source.statusShieldTurns)
    const statDropShieldTurns = normalizeStatusTurns(source.statDropShieldTurns)
    const healBlockTurns = normalizeStatusTurns(source.healBlockTurns)
    const critBlockTurns = normalizeStatusTurns(source.critBlockTurns)
    const statusMoveBlockTurns = normalizeStatusTurns(source.statusMoveBlockTurns)
    const pendingAlwaysCrit = Boolean(source.pendingAlwaysCrit)
    const pendingNeverMiss = Boolean(source.pendingNeverMiss)

    return {
        ...(rechargeTurns > 0 ? { rechargeTurns } : {}),
        ...(bindTurns > 0 ? { bindTurns } : {}),
        ...(bindTurns > 0 ? { bindFraction } : {}),
        ...(lockedRepeatMoveName ? { lockedRepeatMoveName } : {}),
        ...(statusShieldTurns > 0 ? { statusShieldTurns } : {}),
        ...(statDropShieldTurns > 0 ? { statDropShieldTurns } : {}),
        ...(healBlockTurns > 0 ? { healBlockTurns } : {}),
        ...(critBlockTurns > 0 ? { critBlockTurns } : {}),
        ...(statusMoveBlockTurns > 0 ? { statusMoveBlockTurns } : {}),
        ...(pendingAlwaysCrit ? { pendingAlwaysCrit: true } : {}),
        ...(pendingNeverMiss ? { pendingNeverMiss: true } : {}),
    }
}

const normalizeWeather = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['sun', 'rain', 'sandstorm', 'hail'].includes(normalized)) return normalized
    return ''
}

const normalizeTerrain = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['electric', 'grassy', 'misty', 'psychic'].includes(normalized)) return normalized
    return ''
}

const normalizeFieldState = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const weather = normalizeWeather(source.weather)
    const terrain = normalizeTerrain(source.terrain)
    const weatherTurns = weather ? normalizeStatusTurns(source.weatherTurns) : 0
    const terrainTurns = terrain ? normalizeStatusTurns(source.terrainTurns) : 0
    const normalMovesBecomeElectricTurns = normalizeStatusTurns(source.normalMovesBecomeElectricTurns)

    return {
        ...(weather && weatherTurns > 0 ? { weather, weatherTurns } : {}),
        ...(terrain && terrainTurns > 0 ? { terrain, terrainTurns } : {}),
        ...(normalMovesBecomeElectricTurns > 0 ? { normalMovesBecomeElectricTurns } : {}),
    }
}

const mergeFieldState = (base = {}, patch = {}) => {
    const current = normalizeFieldState(base)
    const next = patch && typeof patch === 'object' ? patch : {}

    if (next.clearTerrain) {
        const withoutTerrain = { ...current }
        delete withoutTerrain.terrain
        delete withoutTerrain.terrainTurns
        return normalizeFieldState(withoutTerrain)
    }

    const merged = { ...current }

    const patchWeather = normalizeWeather(next.weather)
    if (patchWeather) {
        merged.weather = patchWeather
        merged.weatherTurns = Math.max(1, normalizeStatusTurns(next.weatherTurns) || 5)
    }

    const patchTerrain = normalizeTerrain(next.terrain)
    if (patchTerrain) {
        merged.terrain = patchTerrain
        merged.terrainTurns = Math.max(1, normalizeStatusTurns(next.terrainTurns) || 5)
    }

    if (normalizeStatusTurns(next.normalMovesBecomeElectricTurns) > 0) {
        merged.normalMovesBecomeElectricTurns = Math.max(1, normalizeStatusTurns(next.normalMovesBecomeElectricTurns))
    }

    return normalizeFieldState(merged)
}

const decrementFieldState = (value = {}) => {
    const current = normalizeFieldState(value)
    const next = { ...current }

    if (next.weather) {
        const turns = normalizeStatusTurns(next.weatherTurns)
        if (turns > 1) {
            next.weatherTurns = turns - 1
        } else {
            delete next.weather
            delete next.weatherTurns
        }
    }

    if (next.terrain) {
        const turns = normalizeStatusTurns(next.terrainTurns)
        if (turns > 1) {
            next.terrainTurns = turns - 1
        } else {
            delete next.terrain
            delete next.terrainTurns
        }
    }

    if (next.normalMovesBecomeElectricTurns) {
        const turns = normalizeStatusTurns(next.normalMovesBecomeElectricTurns)
        if (turns > 1) {
            next.normalMovesBecomeElectricTurns = turns - 1
        } else {
            delete next.normalMovesBecomeElectricTurns
        }
    }

    return normalizeFieldState(next)
}

const mergeVolatileState = (base = {}, patch = {}) => {
    const current = normalizeVolatileState(base)
    const nextPatch = normalizeVolatileState(patch)

    const merged = {
        ...current,
        ...nextPatch,
    }

    if (!merged.bindTurns || merged.bindTurns <= 0) {
        delete merged.bindTurns
        delete merged.bindFraction
    }

    return normalizeVolatileState(merged)
}

const pickStatusTurnCount = (status = '', random = Math.random) => {
    const normalizedStatus = normalizeBattleStatus(status)
    const range = DEFAULT_STATUS_TURN_RANGES[normalizedStatus]
    if (!range) return 0
    const minTurns = Math.max(1, Math.floor(Number(range[0]) || 1))
    const maxTurns = Math.max(minTurns, Math.floor(Number(range[1]) || minTurns))
    return minTurns + Math.floor(random() * (maxTurns - minTurns + 1))
}

const applyStatusPatch = ({
    currentStatus = '',
    currentTurns = 0,
    nextStatus = '',
    nextTurns = null,
    random = Math.random,
} = {}) => {
    const normalizedNextStatus = normalizeBattleStatus(nextStatus)
    if (!normalizedNextStatus) {
        return {
            status: normalizeBattleStatus(currentStatus),
            statusTurns: normalizeStatusTurns(currentTurns),
        }
    }

    const explicitTurns = normalizeStatusTurns(nextTurns)
    return {
        status: normalizedNextStatus,
        statusTurns: explicitTurns > 0 ? explicitTurns : pickStatusTurnCount(normalizedNextStatus, random),
    }
}

const clampStatStage = (value) => clamp(Math.floor(Number(value) || 0), -6, 6)

const normalizeStatStages = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return Object.entries(source).reduce((acc, [rawKey, rawValue]) => {
        const key = String(rawKey || '').trim().toLowerCase()
        if (!SUPPORTED_STAT_STAGE_KEYS.has(key)) return acc
        const stage = clampStatStage(rawValue)
        if (stage === 0) return acc
        return {
            ...acc,
            [key]: stage,
        }
    }, {})
}

const combineStatStageDeltas = (base = {}, nextValue = {}) => {
    const current = normalizeStatStages(base)
    const delta = normalizeStatStages(nextValue)
    const merged = { ...current }

    Object.entries(delta).forEach(([key, value]) => {
        merged[key] = clampStatStage((merged[key] || 0) + value)
    })

    return normalizeStatStages(merged)
}

const applyAbsoluteStatStages = (base = {}, absoluteValues = {}) => {
    const current = normalizeStatStages(base)
    const absolute = normalizeStatStages(absoluteValues)
    return {
        ...current,
        ...absolute,
    }
}

const filterNegativeStatStageDeltas = (delta = {}, shieldTurns = 0) => {
    const normalizedDelta = normalizeStatStages(delta)
    if (normalizeStatusTurns(shieldTurns) <= 0) return normalizedDelta
    return Object.entries(normalizedDelta).reduce((acc, [key, value]) => {
        if (Number(value) < 0) return acc
        return {
            ...acc,
            [key]: value,
        }
    }, {})
}

const decrementVolatileTurnState = (value = {}) => {
    const current = normalizeVolatileState(value)
    const next = { ...current }

    if (next.statusShieldTurns > 0) {
        next.statusShieldTurns -= 1
        if (next.statusShieldTurns <= 0) {
            delete next.statusShieldTurns
        }
    }

    if (next.statDropShieldTurns > 0) {
        next.statDropShieldTurns -= 1
        if (next.statDropShieldTurns <= 0) {
            delete next.statDropShieldTurns
        }
    }

    if (next.healBlockTurns > 0) {
        next.healBlockTurns -= 1
        if (next.healBlockTurns <= 0) {
            delete next.healBlockTurns
        }
    }

    if (next.critBlockTurns > 0) {
        next.critBlockTurns -= 1
        if (next.critBlockTurns <= 0) {
            delete next.critBlockTurns
        }
    }

    return normalizeVolatileState(next)
}

const resolveStatStageMultiplier = (stage = 0) => {
    const normalizedStage = clampStatStage(stage)
    if (normalizedStage >= 0) {
        return (2 + normalizedStage) / 2
    }
    return 2 / (2 - normalizedStage)
}

const applyStatStageToValue = (value, stage = 0) => {
    const numericValue = Math.max(1, Number(value) || 1)
    const multiplier = resolveStatStageMultiplier(stage)
    return Math.max(1, Math.floor(numericValue * multiplier))
}

const resolveActionAvailabilityByStatus = ({ status = '', statusTurns = 0, random = Math.random } = {}) => {
    const normalizedStatus = normalizeBattleStatus(status)
    const normalizedTurns = normalizeStatusTurns(statusTurns)
    if (!normalizedStatus) {
        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
        }
    }

    if (normalizedStatus === 'flinch') {
        return {
            canAct: false,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'flinch',
            log: 'Bị choáng nên không thể hành động.',
        }
    }

    if (normalizedStatus === 'paralyze') {
        if (random() < 0.25) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: 0,
                reason: 'paralyze',
                log: 'Bị tê liệt nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: normalizedStatus,
            statusTurnsAfterCheck: 0,
        }
    }

    if (normalizedStatus === 'sleep') {
        if (normalizedTurns > 1) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: normalizedTurns - 1,
                reason: 'sleep',
                log: 'Đang ngủ nên không thể hành động.',
            }
        }

        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'wakeup',
            log: 'Đã tỉnh giấc.',
        }
    }

    if (normalizedStatus === 'freeze') {
        if (normalizedTurns > 1 && random() >= 0.2) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: normalizedTurns - 1,
                reason: 'freeze',
                log: 'Bị đóng băng nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'thaw',
            log: 'Đã tan băng.',
        }
    }

    if (normalizedStatus === 'confuse') {
        const nextTurns = normalizedTurns > 0 ? normalizedTurns - 1 : 0
        if (random() < 0.33) {
            return {
                canAct: false,
                statusAfterCheck: nextTurns > 0 ? normalizedStatus : '',
                statusTurnsAfterCheck: nextTurns,
                reason: 'confuse',
                log: 'Bị rối loạn nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: nextTurns > 0 ? normalizedStatus : '',
            statusTurnsAfterCheck: nextTurns,
            reason: nextTurns <= 0 ? 'confuse_end' : '',
            log: nextTurns <= 0 ? 'Không còn rối loạn nữa.' : '',
        }
    }

    return {
        canAct: true,
        statusAfterCheck: normalizedStatus,
        statusTurnsAfterCheck: normalizedTurns,
    }
}

const calcResidualStatusDamage = ({ status = '', maxHp = 1 } = {}) => {
    const normalizedStatus = normalizeBattleStatus(status)
    if (normalizedStatus !== 'burn' && normalizedStatus !== 'poison') return 0
    const resolvedMaxHp = Math.max(1, Number(maxHp) || 1)
    return Math.max(1, Math.floor(resolvedMaxHp / 16))
}

const effectSpecsByTrigger = (effectSpecs = [], trigger = '') => {
    const normalizedTrigger = String(trigger || '').trim()
    return normalizeEffectSpecs(effectSpecs)
        .filter((entry) => String(entry?.trigger || '').trim() === normalizedTrigger)
}

const normalizeMovePpEntry = (entry = {}) => {
    const moveName = String(entry?.moveName || entry?.name || '').trim()
    if (!moveName) return null
    const maxPp = Math.max(1, Math.floor(Number(entry?.maxPp) || 1))
    const currentPp = Math.max(0, Math.min(maxPp, Math.floor(Number(entry?.currentPp ?? entry?.pp) || 0)))
    return {
        moveName,
        currentPp,
        maxPp,
    }
}

const mergeMovePpStateEntries = (base = [], patches = []) => {
    const merged = []
    const indexByKey = new Map()
    const pushOrReplace = (entry) => {
        const normalized = normalizeMovePpEntry(entry)
        if (!normalized) return
        const key = normalizeMoveName(normalized.moveName)
        if (!key) return
        if (indexByKey.has(key)) {
            merged[indexByKey.get(key)] = normalized
            return
        }
        indexByKey.set(key, merged.length)
        merged.push(normalized)
    }

    ;(Array.isArray(base) ? base : []).forEach(pushOrReplace)
    ;(Array.isArray(patches) ? patches : []).forEach(pushOrReplace)
    return merged
}

const isMovePpStateEqual = (left = [], right = []) => {
    const normalizedLeft = mergeMovePpStateEntries([], left)
    const normalizedRight = mergeMovePpStateEntries([], right)
    if (normalizedLeft.length !== normalizedRight.length) return false
    for (let index = 0; index < normalizedLeft.length; index += 1) {
        const l = normalizedLeft[index]
        const r = normalizedRight[index]
        if (normalizeMoveName(l.moveName) !== normalizeMoveName(r.moveName)) return false
        if (Number(l.currentPp) !== Number(r.currentPp)) return false
        if (Number(l.maxPp) !== Number(r.maxPp)) return false
    }
    return true
}

const mergeEffectStatePatches = (base = {}, nextPatch = {}) => ({
    ...base,
    ...nextPatch,
    powerMultiplier: Number.isFinite(Number(nextPatch?.powerMultiplier))
        ? Math.max(0.1, Number(nextPatch.powerMultiplier))
        : (Number.isFinite(Number(base?.powerMultiplier)) ? Math.max(0.1, Number(base.powerMultiplier)) : 1),
    statusTurns: Number.isFinite(Number(nextPatch?.statusTurns))
        ? normalizeStatusTurns(nextPatch.statusTurns)
        : normalizeStatusTurns(base?.statusTurns),
    damageGuards: mergeDamageGuards(base?.damageGuards, nextPatch?.damageGuards),
    volatileState: mergeVolatileState(base?.volatileState, nextPatch?.volatileState),
    statStages: combineStatStageDeltas(base?.statStages, nextPatch?.statStages),
    setStatStages: {
        ...(base?.setStatStages && typeof base.setStatStages === 'object' ? base.setStatStages : {}),
        ...(nextPatch?.setStatStages && typeof nextPatch.setStatStages === 'object' ? nextPatch.setStatStages : {}),
    },
})

const mergeEffectAggregate = (base, nextAggregate) => {
    if (!nextAggregate) return base
    return {
        appliedEffects: [...(base?.appliedEffects || []), ...(nextAggregate?.appliedEffects || [])],
        logs: [...(base?.logs || []), ...(nextAggregate?.logs || [])],
        statePatches: {
            self: mergeEffectStatePatches(base?.statePatches?.self, nextAggregate?.statePatches?.self),
            opponent: mergeEffectStatePatches(base?.statePatches?.opponent, nextAggregate?.statePatches?.opponent),
            field: {
                ...(base?.statePatches?.field && typeof base.statePatches.field === 'object' ? base.statePatches.field : {}),
                ...(nextAggregate?.statePatches?.field && typeof nextAggregate.statePatches.field === 'object' ? nextAggregate.statePatches.field : {}),
            },
        },
    }
}

const createEmptyEffectAggregate = () => ({
    appliedEffects: [],
    logs: [],
    statePatches: {
        self: {},
        opponent: {},
        field: {},
    },
})

const calcCatchChance = ({ catchRate, hp, maxHp }) => {
    const rate = Math.min(255, Math.max(1, catchRate || 45))
    const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
    const raw = (rate / 255) * hpFactor
    return Math.min(0.95, Math.max(0.02, raw))
}

const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter(m => Number.isFinite(m.level) && m.level <= level)
        .sort((a, b) => a.level - b.level)
        .map((m) => String(m?.moveName || m?.moveId?.name || '').trim())
        .filter(Boolean)
    return learned.slice(-4)
}

const mergeKnownMovesWithFallback = (moves = [], pokemonSpecies = null, level = 1) => {
    const explicitMoves = (Array.isArray(moves) ? moves : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)

    if (explicitMoves.length >= 4) {
        return explicitMoves.slice(0, 4)
    }

    const merged = [...explicitMoves]
    const knownSet = new Set(explicitMoves.map((entry) => normalizeMoveName(entry)))
    const fallbackMoves = buildMovesForLevel(pokemonSpecies, level)

    for (const fallbackMove of fallbackMoves) {
        const key = normalizeMoveName(fallbackMove)
        if (!key || knownSet.has(key)) continue
        merged.push(fallbackMove)
        knownSet.add(key)
        if (merged.length >= 4) break
    }

    return merged.slice(0, 4)
}

const normalizeCounterMoveEntry = (entry = null, fallbackIndex = -1) => {
    if (!entry || typeof entry !== 'object') return null

    const name = String(entry?.name || entry?.moveName || '').trim()
    if (!name) return null

    const normalizedName = normalizeMoveName(name)
    const fallbackPower = normalizedName === 'struggle' ? 35 : 0
    const powerRaw = Number(entry?.power)
    const resolvedPower = Number.isFinite(powerRaw) && powerRaw > 0
        ? Math.floor(powerRaw)
        : fallbackPower

    const categoryRaw = normalizeTypeToken(entry?.category)
    const resolvedCategory = categoryRaw === 'physical' || categoryRaw === 'special' || categoryRaw === 'status'
        ? categoryRaw
        : (resolvedPower > 0 ? 'physical' : 'status')

    const type = normalizeTypeToken(entry?.type || inferMoveType(name)) || 'normal'
    const priorityRaw = Number(entry?.priority)
    const priority = Number.isFinite(priorityRaw) ? clamp(Math.floor(priorityRaw), -7, 7) : 0
    const accuracyRaw = Number(entry?.accuracy)
    const accuracy = Number.isFinite(accuracyRaw) && accuracyRaw > 0
        ? clamp(Math.floor(accuracyRaw), 1, 100)
        : 100

    const maxPpRaw = Number(entry?.maxPp ?? entry?.pp)
    const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0
        ? Math.max(1, Math.floor(maxPpRaw))
        : (normalizedName === 'struggle' ? 99 : 10)
    const currentPpRaw = Number(entry?.currentPp ?? entry?.pp)
    const currentPp = Number.isFinite(currentPpRaw)
        ? clamp(Math.floor(currentPpRaw), 0, maxPp)
        : maxPp

    return {
        ...entry,
        __index: Number.isInteger(entry?.__index) ? entry.__index : fallbackIndex,
        name,
        type,
        power: resolvedPower,
        category: resolvedCategory,
        accuracy,
        priority,
        maxPp,
        currentPp,
    }
}

const selectWeightedRandomCandidate = (candidates = [], scoreSelector = null) => {
    const normalizedCandidates = Array.isArray(candidates) ? candidates : []
    if (normalizedCandidates.length === 0) return null
    if (normalizedCandidates.length === 1) return normalizedCandidates[0]

    const weighted = normalizedCandidates.map((candidate) => {
        const scoreRaw = typeof scoreSelector === 'function' ? Number(scoreSelector(candidate)) : 1
        const weight = Number.isFinite(scoreRaw) && scoreRaw > 0 ? scoreRaw : 1
        return { candidate, weight }
    })

    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0)
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return weighted[Math.floor(Math.random() * weighted.length)]?.candidate || weighted[0]?.candidate || null
    }

    let randomRoll = Math.random() * totalWeight
    for (const entry of weighted) {
        if (randomRoll <= entry.weight) {
            return entry.candidate
        }
        randomRoll -= entry.weight
    }

    return weighted[weighted.length - 1]?.candidate || weighted[0]?.candidate || null
}

const resolveCounterMoveSelection = ({
    moves = [],
    mode = 'ordered',
    cursor = 0,
    defenderTypes = [],
    attackerTypes = [],
    fieldState = {},
    defenderCurrentHp = 0,
    defenderMaxHp = 1,
    attackerCurrentHp = 0,
    attackerMaxHp = 1,
    attackerLevel = 1,
    attackerAttackStat = 1,
    attackerSpecialAttackStat = 1,
    defenderDefenseStat = 1,
    defenderSpecialDefenseStat = 1,
} = {}) => {
    const normalizedMoves = (Array.isArray(moves) ? moves : [])
        .map((entry, index) => normalizeCounterMoveEntry({ ...(entry || {}), __index: index }, index))
        .filter(Boolean)

    const fallbackMove = {
        __index: -1,
        name: 'Struggle',
        type: 'normal',
        power: 35,
        category: 'physical',
        accuracy: 100,
        priority: 0,
        maxPp: 99,
        currentPp: 99,
    }

    if (normalizedMoves.length === 0) {
        return {
            selectedMove: fallbackMove,
            selectedIndex: -1,
            nextCursor: 0,
            normalizedMoves,
        }
    }

    const normalizedFieldState = normalizeFieldState(fieldState)
    const hasActiveTerrain = Boolean(normalizedFieldState?.terrain)
    const usableMoves = normalizedMoves
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
            const key = normalizeMoveName(entry?.name)
            if (key === 'struggle') return true
            if (Boolean(entry?.requiresTerrain) && !hasActiveTerrain) return false
            return Number(entry?.currentPp) > 0
        })

    if (usableMoves.length === 0) {
        return {
            selectedMove: fallbackMove,
            selectedIndex: -1,
            nextCursor: Number.isFinite(Number(cursor)) ? Math.max(0, Math.floor(Number(cursor))) : 0,
            normalizedMoves,
        }
    }

    const normalizedMode = String(mode || '').trim().toLowerCase()
    const resolvedCursorBase = Number.isFinite(Number(cursor)) ? Math.max(0, Math.floor(Number(cursor))) : 0
    const resolvedCursor = normalizedMoves.length > 0 ? (resolvedCursorBase % normalizedMoves.length) : 0
    const normalizedAttackerTypes = normalizePokemonTypes(attackerTypes)
    const normalizedDefenderCurrentHp = Math.max(0, Number(defenderCurrentHp) || 0)
    const normalizedDefenderMaxHp = Math.max(1, Number(defenderMaxHp) || 1)
    const normalizedAttackerCurrentHp = Math.max(0, Number(attackerCurrentHp) || 0)
    const normalizedAttackerMaxHp = Math.max(1, Number(attackerMaxHp) || 1)
    const normalizedAttackerHpRatio = normalizedAttackerCurrentHp / normalizedAttackerMaxHp
    const normalizedDefenderHpRatio = normalizedDefenderCurrentHp / normalizedDefenderMaxHp

    if (normalizedMode === 'smart-random' || normalizedMode === 'smart_random' || normalizedMode === 'smartrandom') {
        const scoredChoices = usableMoves.map((candidate) => {
            const move = candidate.entry
            const normalizedName = normalizeMoveName(move?.name)
            const effectiveness = resolveTypeEffectiveness(move?.type || 'normal', defenderTypes).multiplier
            const isOffensiveMove = move?.category !== 'status'
            const isSameTypeMove = normalizedAttackerTypes.includes(normalizeTypeToken(move?.type || 'normal'))
            const powerBase = move?.category === 'status'
                ? 12
                : Math.max(1, Number(move?.power) || (normalizedName === 'struggle' ? 35 : 30))
            const accuracyFactor = Math.max(0.35, Math.min(1, (Number(move?.accuracy) || 100) / 100))
            const effectivenessFactor = (!isOffensiveMove)
                ? 1
                : (effectiveness <= 0 ? 0.05 : Math.max(0.2, effectiveness))
            const sameTypeBonus = isSameTypeMove ? 1.2 : 1
            const priorityBonus = (Number(move?.priority) || 0) * 8
            const remainingPpBonus = Math.min(4, Number(move?.currentPp) || 0)
            const offensiveAttackStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(attackerSpecialAttackStat) || 1)
                    : Math.max(1, Number(attackerAttackStat) || 1))
                : 1
            const defensiveStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(defenderSpecialDefenseStat) || 1)
                    : Math.max(1, Number(defenderDefenseStat) || 1))
                : 1
            const stabMultiplier = isSameTypeMove ? 1.5 : 1
            const estimatedDamage = (!isOffensiveMove || effectiveness <= 0)
                ? 0
                : estimateBattleDamage({
                    attackerLevel,
                    movePower: powerBase,
                    attackStat: offensiveAttackStat,
                    defenseStat: defensiveStat,
                    modifier: stabMultiplier * effectiveness,
                })
            const canFinish = isOffensiveMove && normalizedDefenderCurrentHp > 0 && estimatedDamage >= normalizedDefenderCurrentHp
            const lowTargetBonus = normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.35
                ? Math.min(42, estimatedDamage * 0.45)
                : 0
            const finisherBonus = canFinish ? 120 : 0
            const panicBonus = normalizedAttackerHpRatio <= 0.3
                ? (((Number(move?.priority) || 0) > 0 ? 24 : 0) + accuracyFactor * 8)
                : 0
            const statusPenaltyWhenNeedFinish = (!isOffensiveMove && normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.3)
                ? 28
                : 0
            const randomVariance = 0.9 + Math.random() * 0.25
            const score = Math.max(
                0.25,
                ((((powerBase * effectivenessFactor * accuracyFactor) * sameTypeBonus) + priorityBonus + remainingPpBonus + lowTargetBonus + finisherBonus + panicBonus - statusPenaltyWhenNeedFinish) * randomVariance)
            )

            return {
                ...candidate,
                score,
                effectiveness,
                isOffensiveMove,
                isSameTypeMove,
                canFinish,
                estimatedDamage,
            }
        })

        const finisherChoices = scoredChoices.filter((entry) => entry.canFinish)
        const sameTypeOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.isSameTypeMove && entry.effectiveness > 0)
        const effectiveOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.effectiveness > 1)
        const viableOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.effectiveness > 0)
        const sameTypeAny = scoredChoices.filter((entry) => entry.isSameTypeMove && (entry.effectiveness > 0 || !entry.isOffensiveMove))
        const viableAny = scoredChoices.filter((entry) => entry.effectiveness > 0 || !entry.isOffensiveMove)

        let selectionPool = scoredChoices
        if (viableAny.length > 0) selectionPool = viableAny
        if (sameTypeAny.length > 0) selectionPool = sameTypeAny
        if (viableOffensive.length > 0) selectionPool = viableOffensive
        if (effectiveOffensive.length > 0) selectionPool = effectiveOffensive
        if (sameTypeOffensive.length > 0) selectionPool = sameTypeOffensive
        if (finisherChoices.length > 0) selectionPool = finisherChoices

        const selectedChoice = selectWeightedRandomCandidate(selectionPool, (entry) => entry.score) || selectionPool[0] || scoredChoices[0]

        return {
            selectedMove: selectedChoice.entry,
            selectedIndex: selectedChoice.index,
            nextCursor: normalizedMoves.length > 0 ? ((selectedChoice.index + 1) % normalizedMoves.length) : 0,
            normalizedMoves,
        }
    }

    if (normalizedMode === 'smart') {
        let bestChoice = usableMoves[0]
        let bestScore = Number.NEGATIVE_INFINITY

        for (const candidate of usableMoves) {
            const move = candidate.entry
            const normalizedName = normalizeMoveName(move?.name)
            const effectiveness = resolveTypeEffectiveness(move?.type || 'normal', defenderTypes).multiplier
            const isOffensiveMove = move?.category !== 'status'
            const isSameTypeMove = normalizedAttackerTypes.includes(normalizeTypeToken(move?.type || 'normal'))
            const powerBase = move?.category === 'status'
                ? 18
                : Math.max(1, Number(move?.power) || (normalizedName === 'struggle' ? 35 : 30))
            const accuracyFactor = Math.max(0.4, Math.min(1, (Number(move?.accuracy) || 100) / 100))
            const effectivenessFactor = (!isOffensiveMove)
                ? 1
                : (effectiveness <= 0 ? 0.05 : Math.max(0.2, effectiveness))
            const sameTypeBonus = isSameTypeMove ? 1.2 : 1
            const priorityBonus = (Number(move?.priority) || 0) * 10
            const remainingPpBonus = Math.min(6, Number(move?.currentPp) || 0)
            const offensiveAttackStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(attackerSpecialAttackStat) || 1)
                    : Math.max(1, Number(attackerAttackStat) || 1))
                : 1
            const defensiveStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(defenderSpecialDefenseStat) || 1)
                    : Math.max(1, Number(defenderDefenseStat) || 1))
                : 1
            const stabMultiplier = isSameTypeMove ? 1.5 : 1
            const estimatedDamage = (!isOffensiveMove || effectiveness <= 0)
                ? 0
                : estimateBattleDamage({
                    attackerLevel,
                    movePower: powerBase,
                    attackStat: offensiveAttackStat,
                    defenseStat: defensiveStat,
                    modifier: stabMultiplier * effectiveness,
                })
            const finisherBonus = (isOffensiveMove && normalizedDefenderCurrentHp > 0 && estimatedDamage >= normalizedDefenderCurrentHp) ? 120 : 0
            const lowTargetBonus = normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.35
                ? Math.min(42, estimatedDamage * 0.45)
                : 0
            const panicBonus = normalizedAttackerHpRatio <= 0.3
                ? (((Number(move?.priority) || 0) > 0 ? 24 : 0) + accuracyFactor * 8)
                : 0
            const statusPenaltyWhenNeedFinish = (!isOffensiveMove && normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.3)
                ? 28
                : 0
            const score = ((powerBase * effectivenessFactor * accuracyFactor) * sameTypeBonus)
                + priorityBonus
                + remainingPpBonus
                + finisherBonus
                + lowTargetBonus
                + panicBonus
                - statusPenaltyWhenNeedFinish

            if (score > bestScore) {
                bestScore = score
                bestChoice = candidate
            }
        }

        return {
            selectedMove: bestChoice.entry,
            selectedIndex: bestChoice.index,
            nextCursor: normalizedMoves.length > 0 ? ((bestChoice.index + 1) % normalizedMoves.length) : 0,
            normalizedMoves,
        }
    }

    for (let step = 0; step < normalizedMoves.length; step += 1) {
        const index = (resolvedCursor + step) % normalizedMoves.length
        const candidate = normalizedMoves[index]
        if (!candidate) continue
        const normalizedName = normalizeMoveName(candidate.name)
        if (normalizedName !== 'struggle' && Number(candidate.currentPp) <= 0) {
            continue
        }
        return {
            selectedMove: candidate,
            selectedIndex: index,
            nextCursor: (index + 1) % normalizedMoves.length,
            normalizedMoves,
        }
    }

    return {
        selectedMove: fallbackMove,
        selectedIndex: -1,
        nextCursor: resolvedCursor,
        normalizedMoves,
    }
}

const applyCounterMovePpConsumption = ({ moves = [], selectedIndex = -1, shouldConsume = false } = {}) => {
    const normalizedMoves = (Array.isArray(moves) ? moves : []).map((entry, index) => normalizeCounterMoveEntry(entry, index)).filter(Boolean)
    if (!shouldConsume || selectedIndex < 0 || selectedIndex >= normalizedMoves.length) {
        return normalizedMoves
    }

    return normalizedMoves.map((entry, index) => {
        if (index !== selectedIndex) return entry
        const normalizedName = normalizeMoveName(entry?.name)
        if (normalizedName === 'struggle') return entry
        return {
            ...entry,
            currentPp: Math.max(0, Number(entry.currentPp) - 1),
        }
    })
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonForm = (pokemon, formId) => {
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

const resolvePokemonImageForForm = (pokemon, formId, isShiny = false) => {
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

const resolveEvolutionRule = (species, currentFormId) => {
    const baseEvolution = species?.evolution || null
    const baseMinLevel = Number.parseInt(baseEvolution?.minLevel, 10)
    if (baseEvolution?.evolvesTo && Number.isFinite(baseMinLevel) && baseMinLevel >= 1) {
        return {
            evolvesTo: baseEvolution.evolvesTo,
            minLevel: baseMinLevel,
        }
    }

    const normalizedFormId = String(currentFormId || '').trim().toLowerCase()
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const form = forms.find((entry) => String(entry?.formId || '').trim().toLowerCase() === normalizedFormId) || null
    const formEvolution = form?.evolution || null
    const formMinLevel = Number.parseInt(formEvolution?.minLevel, 10)
    if (formEvolution?.evolvesTo && Number.isFinite(formMinLevel) && formMinLevel >= 1) {
        return {
            evolvesTo: formEvolution.evolvesTo,
            minLevel: formMinLevel,
        }
    }

    return null
}

const applyLevelEvolution = async (userPokemon) => {
    const evolutions = []
    let currentSpeciesId = userPokemon?.pokemonId?._id || userPokemon?.pokemonId

    for (let i = 0; i < 10; i += 1) {
        if (!currentSpeciesId) break

        const currentSpecies = await Pokemon.findById(currentSpeciesId)
            .select('name evolution forms defaultFormId levelUpMoves')
            .lean()
        if (!currentSpecies) break

        const rule = resolveEvolutionRule(currentSpecies, userPokemon.formId)
        if (!rule?.evolvesTo || !Number.isFinite(rule.minLevel) || rule.minLevel < 1 || userPokemon.level < rule.minLevel) {
            break
        }

        const nextSpecies = await Pokemon.findById(rule.evolvesTo)
            .select('name forms defaultFormId levelUpMoves')
            .lean()
        if (!nextSpecies) break

        if (String(nextSpecies._id) === String(currentSpecies._id)) {
            break
        }

        const nextForms = Array.isArray(nextSpecies.forms) ? nextSpecies.forms : []
        const currentFormId = String(userPokemon.formId || '').trim().toLowerCase()
        const canKeepForm = currentFormId && nextForms.some((form) => String(form?.formId || '').trim().toLowerCase() === currentFormId)
        const nextFormId = canKeepForm
            ? currentFormId
            : (String(nextSpecies.defaultFormId || '').trim().toLowerCase() || 'normal')

        userPokemon.pokemonId = nextSpecies._id
        userPokemon.formId = nextFormId
        userPokemon.moves = buildMovesForLevel(nextSpecies, userPokemon.level)
        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: nextSpecies,
            level: userPokemon.level,
        })

        evolutions.push({
            fromPokemonId: currentSpecies._id,
            from: currentSpecies.name,
            toPokemonId: nextSpecies._id,
            to: nextSpecies.name,
            level: userPokemon.level,
        })

        currentSpeciesId = nextSpecies._id
    }

    return evolutions
}

const ACTIVE_TRAINER_BATTLE_TTL_MS = 30 * 60 * 1000
const getBattleSessionExpiryDate = () => new Date(Date.now() + ACTIVE_TRAINER_BATTLE_TTL_MS)

const getSpecialDefenseStat = (stats = {}) => (
    Number(stats?.spdef) || Number(stats?.spldef) || 0
)

const getSpecialAttackStat = (stats = {}) => (
    Number(stats?.spatk) || 0
)

const resolveTrainerBattleForm = (pokemon, formId) => {
    return resolvePokemonForm(pokemon, formId)
}

const buildTrainerBattleTeam = (trainer) => {
    const team = Array.isArray(trainer?.team) ? trainer.team : []
    return team
        .map((entry, index) => {
            const pokemon = entry?.pokemonId
            if (!pokemon) return null
            const level = Math.max(1, Number(entry?.level) || 1)
            const { form, formId } = resolveTrainerBattleForm(pokemon, entry?.formId)
            const baseStats = form?.stats || pokemon.baseStats || {}
            const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
            const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)
            const types = normalizePokemonTypes(pokemon.types)
            return {
                slot: index,
                pokemonId: pokemon._id,
                name: pokemon.name || 'Pokemon',
                level,
                formId,
                types,
                baseStats: scaledStats,
                currentHp: maxHp,
                maxHp,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
                counterMoves: [],
                counterMoveCursor: 0,
                counterMoveMode: 'smart-random',
            }
        })
        .filter(Boolean)
}

const getOrCreateTrainerBattleSession = async (userId, trainerId, trainer) => {
    const now = new Date()
    const expiresAt = getBattleSessionExpiryDate()
    let session = await BattleSession.findOne({ userId, trainerId })

    if (!session) {
        return BattleSession.create({
            userId,
            trainerId,
            team: buildTrainerBattleTeam(trainer),
            knockoutCounts: [],
            currentIndex: 0,
            playerStatus: '',
            playerStatusTurns: 0,
            playerStatStages: {},
            playerDamageGuards: {},
            playerWasDamagedLastTurn: false,
            playerVolatileState: {},
            fieldState: {},
            expiresAt,
        })
    }

    const isActive = session.expiresAt && session.expiresAt > now && Array.isArray(session.team) && session.team.length > 0
    if (!isActive) {
        session.team = buildTrainerBattleTeam(trainer)
        session.knockoutCounts = []
        session.currentIndex = 0
        session.playerPokemonId = null
        session.playerCurrentHp = 0
        session.playerMaxHp = 1
        session.playerStatus = ''
        session.playerStatusTurns = 0
        session.playerStatStages = {}
        session.playerDamageGuards = {}
        session.playerWasDamagedLastTurn = false
        session.playerVolatileState = {}
        session.fieldState = {}
    }

    session.expiresAt = expiresAt
    session.updatedAt = now
    await session.save()
    return session
}

const getAliveOpponentIndex = (team, startIndex = 0) => {
    if (!Array.isArray(team) || team.length === 0) return -1
    for (let index = Math.max(0, startIndex); index < team.length; index += 1) {
        if ((team[index]?.currentHp || 0) > 0) return index
    }
    return -1
}

const distributeExpByDefeats = (totalExp, participants = []) => {
    const normalizedTotalExp = Math.max(0, Math.floor(Number(totalExp) || 0))
    const normalizedParticipants = (Array.isArray(participants) ? participants : [])
        .map((entry, index) => ({
            ...entry,
            index,
            defeatedCount: Math.max(0, Math.floor(Number(entry?.defeatedCount) || 0)),
        }))
        .filter((entry) => entry.defeatedCount > 0)

    if (normalizedTotalExp <= 0 || normalizedParticipants.length === 0) {
        return normalizedParticipants.map((entry) => ({ ...entry, baseExp: 0 }))
    }

    const totalDefeats = normalizedParticipants.reduce((sum, entry) => sum + entry.defeatedCount, 0)
    if (totalDefeats <= 0) {
        return normalizedParticipants.map((entry) => ({ ...entry, baseExp: 0 }))
    }

    const withAllocation = normalizedParticipants.map((entry) => {
        const weighted = normalizedTotalExp * entry.defeatedCount
        return {
            ...entry,
            baseExp: Math.floor(weighted / totalDefeats),
            remainder: weighted % totalDefeats,
        }
    })

    const distributed = withAllocation.reduce((sum, entry) => sum + entry.baseExp, 0)
    let remaining = normalizedTotalExp - distributed

    if (remaining > 0) {
        const remainderSorted = [...withAllocation]
            .sort((a, b) => (
                (b.remainder - a.remainder) ||
                (b.defeatedCount - a.defeatedCount) ||
                (a.index - b.index)
            ))

        for (let i = 0; i < remaining; i += 1) {
            const target = remainderSorted[i % remainderSorted.length]
            target.baseExp += 1
        }
    }

    return withAllocation
        .sort((a, b) => a.index - b.index)
        .map(({ remainder, index, ...entry }) => entry)
}

const normalizeLevelExpState = (level = 1, exp = 0, gain = 0) => {
    let nextLevel = Math.max(1, Number(level) || 1)
    let nextExp = Math.max(0, Number(exp) || 0) + Math.max(0, Number(gain) || 0)
    let levelsGained = 0

    while (nextExp >= expToNext(nextLevel)) {
        nextExp -= expToNext(nextLevel)
        nextLevel += 1
        levelsGained += 1
    }

    return {
        level: nextLevel,
        exp: nextExp,
        levelsGained,
    }
}

const isDuplicateKeyError = (error) => Number(error?.code) === 11000

const updateMapProgress = async (userId, mapId) => {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const now = new Date()
        const progress = await MapProgress.findOne({ userId, mapId })
            .select('level exp totalSearches isUnlocked unlockedAt __v')
            .lean()

        if (!progress) {
            const normalized = normalizeLevelExpState(1, 0, EXP_PER_SEARCH)
            try {
                const created = await MapProgress.create({
                    userId,
                    mapId,
                    level: normalized.level,
                    exp: normalized.exp,
                    totalSearches: 1,
                    isUnlocked: true,
                    unlockedAt: now,
                    lastSearchedAt: now,
                })
                return created
            } catch (error) {
                if (isDuplicateKeyError(error)) {
                    continue
                }
                throw error
            }
        }

        const normalized = normalizeLevelExpState(progress.level, progress.exp, EXP_PER_SEARCH)
        const updated = await MapProgress.findOneAndUpdate(
            { _id: progress._id, __v: progress.__v },
            {
                $set: {
                    level: normalized.level,
                    exp: normalized.exp,
                    totalSearches: (progress.totalSearches || 0) + 1,
                    isUnlocked: true,
                    unlockedAt: progress.unlockedAt || now,
                    lastSearchedAt: now,
                },
                $inc: { __v: 1 },
            },
            { new: true }
        )

        if (updated) {
            return updated
        }
    }

    throw new Error('Không thể cập nhật tiến trình bản đồ do xung đột cập nhật đồng thời')
}

const updatePlayerLevel = async (userId) => {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const playerState = await PlayerState.findOne({ userId })
            .select('level experience __v')
            .lean()

        if (!playerState) {
            const normalized = normalizeLevelExpState(1, 0, EXP_PER_SEARCH)
            try {
                const created = await PlayerState.create({
                    userId,
                    level: normalized.level,
                    experience: normalized.exp,
                })
                return {
                    playerState: created,
                    leveledUp: normalized.levelsGained > 0,
                    levelsGained: normalized.levelsGained,
                }
            } catch (error) {
                if (isDuplicateKeyError(error)) {
                    continue
                }
                throw error
            }
        }

        const normalized = normalizeLevelExpState(playerState.level, playerState.experience, EXP_PER_SEARCH)
        const updated = await PlayerState.findOneAndUpdate(
            { _id: playerState._id, __v: playerState.__v },
            {
                $set: {
                    level: normalized.level,
                    experience: normalized.exp,
                },
                $inc: { __v: 1 },
            },
            { new: true }
        )

        if (updated) {
            return {
                playerState: updated,
                leveledUp: normalized.levelsGained > 0,
                levelsGained: normalized.levelsGained,
            }
        }
    }

    throw new Error('Không thể cập nhật cấp người chơi do xung đột cập nhật đồng thời')
}

const formatMapProgress = (progress) => ({
    level: progress.level,
    exp: progress.exp,
    expToNext: expToNext(progress.level),
    totalSearches: progress.totalSearches,
})

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const trackDailyActivity = async (userId, increments = {}) => {
    const searchableKeys = [
        'searches',
        'mapExp',
        'moonPoints',
        'battles',
        'levels',
        'battleMoonPoints',
        'platinumCoins',
        'mines',
        'shards',
        'diamondCoins',
        'trainerExp',
    ]
    const $inc = {}

    searchableKeys.forEach((key) => {
        const value = Number(increments[key])
        if (Number.isFinite(value) && value > 0) {
            $inc[key] = Math.floor(value)
        }
    })

    if (Object.keys($inc).length === 0) {
        if (!increments?.mapSlug && !increments?.mapName) {
            return
        }
    }

    const date = toDailyDateKey()
    await DailyActivity.findOneAndUpdate(
        { userId, date },
        {
            $inc,
            $setOnInsert: {
                userId,
                date,
            },
        },
        { upsert: true }
    )

    const mapSlug = String(increments?.mapSlug || '').trim()
    const mapName = String(increments?.mapName || '').trim()
    const mapSearches = Number.isFinite(Number(increments?.searches)) && Number(increments.searches) > 0
        ? Math.floor(Number(increments.searches))
        : 0
    const mapExp = Number.isFinite(Number(increments?.mapExp)) && Number(increments.mapExp) > 0
        ? Math.floor(Number(increments.mapExp))
        : 0
    const mapMoonPoints = Number.isFinite(Number(increments?.mapMoonPoints)) && Number(increments.mapMoonPoints) > 0
        ? Math.floor(Number(increments.mapMoonPoints))
        : 0

    if (!mapSlug && !mapName) {
        return
    }

    const mapInc = {}
    if (mapSearches > 0) mapInc['mapStats.$[entry].searches'] = mapSearches
    if (mapExp > 0) mapInc['mapStats.$[entry].mapExp'] = mapExp
    if (mapMoonPoints > 0) mapInc['mapStats.$[entry].moonPoints'] = mapMoonPoints

    const mapSet = {
        ...(mapSlug ? { 'mapStats.$[entry].mapSlug': mapSlug } : {}),
        ...(mapName ? { 'mapStats.$[entry].mapName': mapName } : {}),
    }

    const mapArrayFilter = (mapSlug && mapName)
        ? { $or: [{ 'entry.mapSlug': mapSlug }, { 'entry.mapName': mapName }] }
        : (mapSlug ? { 'entry.mapSlug': mapSlug } : { 'entry.mapName': mapName })

    if (Object.keys(mapInc).length > 0 || Object.keys(mapSet).length > 0) {
        const updatePayload = {}
        if (Object.keys(mapInc).length > 0) updatePayload.$inc = mapInc
        if (Object.keys(mapSet).length > 0) updatePayload.$set = mapSet

        const updated = await DailyActivity.updateOne(
            { userId, date },
            updatePayload,
            { arrayFilters: [mapArrayFilter] }
        )

        if (updated.modifiedCount > 0) {
            return
        }
    }

    await DailyActivity.updateOne(
        { userId, date },
        {
            $push: {
                mapStats: {
                    mapSlug,
                    mapName,
                    searches: mapSearches,
                    mapExp,
                    moonPoints: mapMoonPoints,
                },
            },
        }
    )
}

const getOrderedMaps = getOrderedMapsCached

const buildProgressIndex = (progresses) => {
    const byId = new Map()
    progresses.forEach((progress) => {
        byId.set(progress.mapId.toString(), progress)
    })
    return byId
}

const resolveSourceMapForUnlock = (maps, index) => {
    if (index <= 0) return null

    const currentMap = maps[index] || null
    if (!currentMap) return null

    const currentTrack = Boolean(currentMap.isLegendary)
    for (let sourceIndex = index - 1; sourceIndex >= 0; sourceIndex -= 1) {
        const candidate = maps[sourceIndex]
        if (!candidate) continue
        if (Boolean(candidate.isLegendary) === currentTrack) {
            return candidate
        }
    }

    return null
}

const resolveNextMapInTrack = (maps, index) => {
    const currentMap = maps[index] || null
    if (!currentMap) return null

    const currentTrack = Boolean(currentMap.isLegendary)
    for (let nextIndex = index + 1; nextIndex < maps.length; nextIndex += 1) {
        const candidate = maps[nextIndex]
        if (!candidate) continue
        if (Boolean(candidate.isLegendary) === currentTrack) {
            return candidate
        }
    }

    return null
}

const buildUnlockRequirement = (maps, index, progressById, playerLevel = 1) => {
    const currentMap = maps[index] || null
    const currentPlayerLevel = Math.max(1, Number(playerLevel) || 1)
    const requiredPlayerLevel = Math.max(1, Number(currentMap?.requiredPlayerLevel) || 1)
    const remainingPlayerLevels = Math.max(0, requiredPlayerLevel - currentPlayerLevel)

    const sourceMap = resolveSourceMapForUnlock(maps, index)
    if (!sourceMap) {
        return {
            requiredSearches: 0,
            currentSearches: 0,
            remainingSearches: 0,
            requiredPlayerLevel,
            currentPlayerLevel,
            remainingPlayerLevels,
            isSearchRequirementMet: true,
            isLevelRequirementMet: remainingPlayerLevels === 0,
            sourceMap: null,
        }
    }

    const sourceProgress = progressById.get(sourceMap._id.toString())
    const requiredSearches = Math.max(0, sourceMap.requiredSearches || 0)
    const currentSearches = sourceProgress?.totalSearches || 0
    const remainingSearches = Math.max(0, requiredSearches - currentSearches)

    return {
        requiredSearches,
        currentSearches,
        remainingSearches,
        requiredPlayerLevel,
        currentPlayerLevel,
        remainingPlayerLevels,
        isSearchRequirementMet: remainingSearches === 0,
        isLevelRequirementMet: remainingPlayerLevels === 0,
        sourceMap: {
            id: sourceMap._id,
            name: sourceMap.name,
            slug: sourceMap.slug,
        },
    }
}

const ensureMapUnlocked = async (userId, mapId) => {
    const now = new Date()
    const progress = await MapProgress.findOneAndUpdate(
        { userId, mapId },
        {
            $set: {
                isUnlocked: true,
            },
            $setOnInsert: {
                userId,
                mapId,
                level: 1,
                exp: 0,
                totalSearches: 0,
                lastSearchedAt: null,
                unlockedAt: now,
            },
        },
        { new: true, upsert: true }
    )
    if (!progress.unlockedAt) {
        progress.unlockedAt = now
        await progress.save()
    }
    return progress
}

const unlockMapsInBulk = async (userId, mapIds = []) => {
    const uniqueMapIds = [...new Set(
        (Array.isArray(mapIds) ? mapIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )]

    if (uniqueMapIds.length === 0) {
        return new Map()
    }

    const now = new Date()
    await MapProgress.bulkWrite(
        uniqueMapIds.map((mapId) => ({
            updateOne: {
                filter: { userId, mapId },
                update: {
                    $set: { isUnlocked: true },
                    $setOnInsert: {
                        userId,
                        mapId,
                        level: 1,
                        exp: 0,
                        totalSearches: 0,
                        lastSearchedAt: null,
                        unlockedAt: now,
                    },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    )

    await MapProgress.updateMany(
        { userId, mapId: { $in: uniqueMapIds }, unlockedAt: null },
        { $set: { unlockedAt: now } }
    )

    const unlockedProgresses = await MapProgress.find({ userId, mapId: { $in: uniqueMapIds } })
        .select('mapId totalSearches isUnlocked')
        .lean()
    return buildProgressIndex(unlockedProgresses)
}

// POST /api/game/click (protected)
router.post('/click', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId

        const playerState = await PlayerState.findOneAndUpdate(
            { userId },
            {
                $setOnInsert: { userId },
                $inc: {
                    gold: 10,
                    clicks: 1,
                },
            },
            { new: true, upsert: true }
        )

        // Emit updated state via Socket.io
        emitPlayerState(userId.toString(), playerState)

        res.json({
            ok: true,
            playerState: {
                hp: playerState.hp,
                maxHp: playerState.maxHp,
                ...serializePlayerWallet(playerState),
                clicks: playerState.clicks,
            },
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/search (protected)
router.post('/search', authMiddleware, async (req, res, next) => {
    try {
        const { mapSlug } = req.body
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'

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
            const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel)
            const isUnlocked = unlockRequirement.remainingSearches === 0 && unlockRequirement.remainingPlayerLevels === 0
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
        const formStats = resolvedForm?.stats || null
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const baseStats = formStats || pokemon.baseStats

        const level = Math.floor(Math.random() * (map.levelMax - map.levelMin + 1)) + map.levelMin
        const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
        const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)
        const hp = maxHp
        const playerBattleSnapshot = await resolveWildPlayerBattleSnapshot(userId)

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
        const orderedMaps = await getOrderedMaps()
        const mapIds = orderedMaps.map((map) => map._id)
        const playerLevelState = await PlayerState.findOne({ userId })
            .select('level')
            .lean()
        const currentPlayerLevel = Math.max(1, Number(playerLevelState?.level) || 1)
        const progresses = await MapProgress.find({ userId, mapId: { $in: mapIds } })
            .select('mapId totalSearches isUnlocked')
            .lean()
        const progressById = buildProgressIndex(progresses)

        const mapsWithUnlockState = orderedMaps.map((map, index) => {
            const unlockRequirement = buildUnlockRequirement(orderedMaps, index, progressById, currentPlayerLevel)
            const isUnlocked = isAdmin || (unlockRequirement.remainingSearches === 0 && unlockRequirement.remainingPlayerLevels === 0)
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

        const response = mapsWithUnlockState.map(({ map, unlockRequirement, isUnlocked }) => {
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

        res.json({ ok: true, maps: response })
    } catch (error) {
        next(error)
    }
})

// GET /api/game/map/:slug/state (protected)
router.get('/map/:slug/state', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
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
        const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel)
        const isUnlocked = isAdmin || (unlockRequirement.remainingSearches === 0 && unlockRequirement.remainingPlayerLevels === 0)

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
                sourceMap: unlockRequirement.sourceMap,
            },
            isUnlocked: true,
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/game/encounter/:id/attack (protected)
router.post('/encounter/:id/attack', authMiddleware, async (req, res, next) => {
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

        const damage = rollDamage(encounter.level)
        encounter.hp = Math.max(0, encounter.hp - damage)
        const defeatedWild = encounter.hp <= 0

        let reward = null
        let counterAttack = null
        let playerDefeated = false
        let playerState = null

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
                const wildBaseStats = wildForm?.stats || wildPokemon.baseStats || {}
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

            reward.wildDefeatsToday = wildDefeatsToday
        }

        const finalPlayerState = playerState?.toObject ? playerState.toObject() : playerState
        const playerBattle = formatWildPlayerBattleState(encounter)
        const message = defeatedWild
            ? `Pokemon hoang dã đã bị hạ! +${Number(reward?.platinumCoins || 0).toLocaleString('vi-VN')} Xu Bạch Kim`
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
            .select('pokemonId level hp maxHp isShiny formId')
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

        const chance = calcCatchChance({
            catchRate: pokemon.catchRate,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
        })

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

            const moves = buildMovesForLevel(pokemon, encounter.level)
            const caughtPokemon = await UserPokemon.create({
                userId,
                pokemonId: encounter.pokemonId,
                level: encounter.level,
                experience: 0,
                moves,
                movePpState: [],
                formId: encounter.formId || 'normal',
                isShiny: encounter.isShiny,
                location: 'box',
            })
            await syncUserPokemonMovesAndPp(caughtPokemon, {
                pokemonSpecies: pokemon,
                level: encounter.level,
            })
            await caughtPokemon.save()

            const rarity = String(pokemon.rarity || '').trim().toLowerCase()
            const shouldEmitGlobalNotification = ['s', 'ss', 'sss'].includes(rarity)
            let globalNotificationPayload = null
            if (shouldEmitGlobalNotification) {
                try {
                    const currentUser = await User.findById(userId)
                        .select('username')
                        .lean()
                    const username = String(currentUser?.username || '').trim() || 'Người chơi'
                    const rarityLabel = rarity ? rarity.toUpperCase() : 'UNKNOWN'
                    const notificationImage = resolvePokemonImageForForm(
                        pokemon,
                        encounter.formId || pokemon.defaultFormId || 'normal',
                        encounter.isShiny
                    )
                    globalNotificationPayload = {
                        notificationId: `${resolvedEncounter._id}-${Date.now()}`,
                        username,
                        pokemonName: pokemon.name,
                        rarity,
                        imageUrl: notificationImage,
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
                message: `Đã bắt được ${pokemon.name}!`,
                globalNotification: globalNotificationPayload,
            })
        }

        res.json({
            ok: true,
            caught: false,
            encounterId: encounter._id,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            message: 'Pokemon đã thoát khỏi bóng!'
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
router.post('/battle/attack', authMiddleware, async (req, res, next) => {
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

        const party = await UserPokemon.find({ userId, location: 'party' })
            .select('pokemonId level moves movePpState nickname formId partyIndex')
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
        const knownMoves = mergeKnownMovesWithFallback(activePokemon.moves, attackerSpecies, attackerLevel)
        const normalizedKnownMoves = new Set(knownMoves.map((item) => normalizeMoveName(item)))

        let selectedMoveName = String(moveName || move?.name || knownMoves[0] || 'Struggle').trim()
        if (!selectedMoveName) selectedMoveName = 'Struggle'
        const requestedMoveName = selectedMoveName
        let moveFallbackReason = ''
        let moveFallbackFrom = ''

        const selectedMoveKey = normalizeMoveName(selectedMoveName)
        if (knownMoves.length > 0 && selectedMoveKey !== 'struggle' && !normalizedKnownMoves.has(selectedMoveKey)) {
            selectedMoveName = knownMoves[0]
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
        const attackerBaseStats = attackerForm?.stats || attackerSpecies.baseStats || {}
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

        const playerMaxHp = Math.max(1, calcMaxHp(attackerBaseStats?.hp, attackerLevel, attackerSpecies.rarity))
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

        if (normalizeStatusTurns(battleFieldState?.normalMovesBecomeElectricTurns) > 0 && moveType === 'normal') {
            moveType = 'electric'
        }

        const playerTurnStartHp = playerCurrentHp
        const opponentTurnStartHp = targetCurrentHp
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
                userActsFirst: true,
                isSuperEffective: precomputedTypeEffectiveness.multiplier > 1,
                userMaxHp: playerMaxHp,
                userCurrentHp: playerCurrentHp,
                userStatus: playerStatus,
                targetStatus: opponentStatus,
                weather: battleFieldState.weather || '',
                terrain: battleFieldState.terrain || '',
                userStatStages: playerStatStages,
                targetStatStages: opponentStatStages,
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
        const battleExtraLogs = []
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
        const canPlayerAct = Boolean(playerTurnStatusCheck.canAct) && canPlayerActByVolatile

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
        const playerDamageModifier = playerStabMultiplier * playerTypeEffectiveness.multiplier * playerCriticalMultiplier

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

        let counterAttack = null
        let resultingPlayerHp = playerCurrentHp
        if (currentHp > 0 && playerCurrentHp > 0) {
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
            const counterDamage = applyDamageGuardsToDamage(rawCounterDamage, opponentMoveCategory, playerDamageGuards)
            if (counterDamage < rawCounterDamage) {
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
                log: !canOpponentAct
                    ? `${targetName} không thể hành động.`
                    : (didOpponentMoveHit
                    ? `${targetName} dùng ${selectedOpponentMoveName}! Gây ${counterDamage} sát thương. ${resolveEffectivenessText(opponentTypeEffectiveness.multiplier)}`.trim()
                    : `${targetName} dùng ${selectedOpponentMoveName} nhưng trượt.`),
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
            await trainerSession.save()
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
                    types: normalizePokemonTypes(entry.types),
                    currentHp: entry.currentHp,
                    maxHp: entry.maxHp,
                    status: normalizeBattleStatus(entry.status),
                    statusTurns: normalizeStatusTurns(entry.statusTurns),
                    statStages: normalizeStatStages(entry.statStages),
                    damageGuards: normalizeDamageGuards(entry.damageGuards),
                    wasDamagedLastTurn: Boolean(entry.wasDamagedLastTurn),
                    volatileState: normalizeVolatileState(entry.volatileState),
                })),
            }
            : null

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
                log: !canPlayerAct
                    ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Your Pokemon'} không thể hành động.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`
                    : (didPlayerMoveHit
                    ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Your Pokemon'} used ${selectedMoveName}! ${damage} damage${hitCount > 1 ? ` (${hitCount} hits)` : ''}. ${moveFallbackReason === 'OUT_OF_PP' ? '(Chiêu đã hết PP nên tự dùng Struggle.) ' : ''}${playerEffectivenessText}`.trim()
                    : (moveBlockedByTerrainRequirement
                        ? `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Your Pokemon'} used ${selectedMoveName} but it failed because there is no active terrain.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`
                        : `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Your Pokemon'} used ${selectedMoveName} but missed.${moveFallbackReason === 'OUT_OF_PP' ? ' (Chiêu đã hết PP nên tự dùng Struggle.)' : ''}`)),
            },
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

        const totalLevel = sourceTeam.reduce((sum, mon) => sum + (Number(mon.level) || 1), 0)
        const averageLevel = Math.max(1, Math.round(totalLevel / Math.max(1, sourceTeam.length)))
        const defaultScaledReward = Math.max(10, averageLevel * 10)
        const coinsAwarded = trainerRewardCoins > 0
            ? Math.floor(trainerRewardCoins)
            : defaultScaledReward
        const expAwarded = trainerExpReward > 0
            ? Math.floor(trainerExpReward)
            : defaultScaledReward
        const moonPointsAwarded = trainerIsAutoGenerated
            ? 0
            : (trainerMoonPointsReward > 0
                ? Math.floor(trainerMoonPointsReward)
                : defaultScaledReward)
        const happinessAwarded = 13

        const party = await UserPokemon.find({ userId, location: 'party' })
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
        const allEvolutions = []
        let totalLevelsGained = 0

        for (const expParticipant of expParticipants) {
            const participantPokemon = participantByPokemonId.get(expParticipant.pokemonId)
            if (!participantPokemon) continue

            const pokemonRarity = participantPokemon.pokemonId?.rarity || 'd'
            const expMultiplier = getRarityExpMultiplier(pokemonRarity)
            const finalExp = Math.floor(expParticipant.baseExp * expMultiplier)

            let levelsGained = 0

            if (participantPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                participantPokemon.level = USER_POKEMON_MAX_LEVEL
                participantPokemon.experience = 0
            } else {
                participantPokemon.experience += finalExp
                while (
                    participantPokemon.level < USER_POKEMON_MAX_LEVEL
                    && participantPokemon.experience >= participantPokemon.level * 100
                ) {
                    participantPokemon.experience -= participantPokemon.level * 100
                    participantPokemon.level += 1
                    levelsGained += 1
                }

                if (participantPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                    participantPokemon.level = USER_POKEMON_MAX_LEVEL
                    participantPokemon.experience = 0
                }
            }

            participantPokemon.friendship = Math.min(255, (participantPokemon.friendship || 0) + happinessAwarded)
            const evolutions = levelsGained > 0 ? await applyLevelEvolution(participantPokemon) : []

            await participantPokemon.save()
            await participantPokemon.populate('pokemonId', 'rarity name imageUrl sprites forms defaultFormId')

            totalLevelsGained += levelsGained
            if (evolutions.length > 0) {
                allEvolutions.push(...evolutions)
            }

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
                expToNext: participantPokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : participantPokemon.level * 100,
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
                expToNext: activePokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : activePokemon.level * 100,
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
                const { form: resolvedPrizeForm, formId: resolvedPrizeFormId } = resolveTrainerBattleForm(prizeData, trainerPrizePokemonFormId)
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
                    const moves = buildMovesForLevel(prizeData, prizeLevel)
                    const grantedPokemon = await UserPokemon.create({
                        userId,
                        pokemonId: trainerPrizePokemonId,
                        level: prizeLevel,
                        experience: 0,
                        moves,
                        movePpState: [],
                        formId: resolvedPrizeFormId,
                        isShiny: false,
                        location: 'box',
                        originalTrainer: trainerRewardMarker,
                    })
                    await syncUserPokemonMovesAndPp(grantedPokemon, {
                        pokemonSpecies: prizeData,
                        level: prizeLevel,
                    })
                    await grantedPokemon.save()
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

        res.json({
            ok: true,
            wallet: serializePlayerWallet(playerState),
            results: {
                pokemon: {
                    name: primaryPokemonReward.name,
                    imageUrl: primaryPokemonReward.imageUrl,
                    level: primaryPokemonReward.level,
                    exp: primaryPokemonReward.exp,
                    expToNext: primaryPokemonReward.expToNext,
                    levelsGained: primaryPokemonReward.levelsGained,
                    happiness: primaryPokemonReward.happiness,
                    happinessGained: primaryPokemonReward.happinessGained,
                },
                pokemonRewards,
                rewards: {
                    coins: coinsAwarded,
                    trainerExp: trainerExpAwarded,
                    moonPoints: moonPointsAwarded,
                    prizePokemon,
                    prizeItem,
                },
                evolution: {
                    evolved: allEvolutions.length > 0,
                    chain: allEvolutions,
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
        const formStats = resolvedForm?.stats || null
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const baseStats = formStats || pokemon.baseStats

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
}

export default router
