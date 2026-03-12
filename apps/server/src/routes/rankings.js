import express from 'express'
import mongoose from 'mongoose'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import DailyActivity from '../models/DailyActivity.js'
import User from '../models/User.js'
import BattleTrainer from '../models/BattleTrainer.js'
import Pokemon from '../models/Pokemon.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import { authMiddleware } from '../middleware/auth.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'

const router = express.Router()
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const POKEMON_POWER_META_CACHE_TTL_MS = 5 * 60 * 1000
const POWER_RANKING_CACHE_TTL_MS = 10 * 60 * 1000
const POWER_RANKING_CACHE_WARMUP_DELAY_MS = 10 * 1000
const POWER_RANKING_CACHE_WARM_INTERVAL_MS = 3 * 60 * 1000

const pokemonPowerMetaCache = {
    expiresAt: 0,
    byId: new Map(),
    inFlight: null,
}

const powerRankingSnapshotCache = new Map()

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(source?.avatarFrameUrl || '').trim(),
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)
    return {
        ...current,
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
    }
}

const buildVipTierLookup = async (users = []) => {
    const tierIdSet = new Set()
    const tierLevelSet = new Set()

    for (const entry of users) {
        const vipTierId = String(entry?.vipTierId || '').trim()
        if (vipTierId) {
            tierIdSet.add(vipTierId)
            continue
        }
        const vipTierLevel = Math.max(0, parseInt(entry?.vipTierLevel, 10) || 0)
        if (vipTierLevel > 0) {
            tierLevelSet.add(vipTierLevel)
        }
    }

    const conditions = []
    if (tierIdSet.size > 0) {
        conditions.push({ _id: { $in: Array.from(tierIdSet) } })
    }
    if (tierLevelSet.size > 0) {
        conditions.push({ level: { $in: Array.from(tierLevelSet) } })
    }

    if (conditions.length === 0) {
        return {
            tierById: new Map(),
            tierByLevel: new Map(),
        }
    }

    const tiers = await VipPrivilegeTier.find({ $or: conditions }).select('_id level benefits').lean()
    const tierById = new Map()
    const tierByLevel = new Map()

    for (const tier of tiers) {
        const idKey = String(tier?._id || '').trim()
        if (idKey) {
            tierById.set(idKey, tier)
        }
        const levelKey = Math.max(0, parseInt(tier?.level, 10) || 0)
        if (levelKey > 0) {
            tierByLevel.set(levelKey, tier)
        }
    }

    return { tierById, tierByLevel }
}

const resolveTierBenefitsForUser = (userLike, tierById, tierByLevel) => {
    const vipTierId = String(userLike?.vipTierId || '').trim()
    if (vipTierId && tierById.has(vipTierId)) {
        return normalizeVipBenefits(tierById.get(vipTierId)?.benefits)
    }

    const vipTierLevel = Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0)
    if (vipTierLevel > 0 && tierByLevel.has(vipTierLevel)) {
        return normalizeVipBenefits(tierByLevel.get(vipTierLevel)?.benefits)
    }

    return normalizeVipBenefits({})
}

const buildEffectiveVipBenefitsByUserId = async (users = []) => {
    const normalizedUsers = Array.isArray(users) ? users.filter(Boolean) : []
    if (normalizedUsers.length === 0) return new Map()

    const { tierById, tierByLevel } = await buildVipTierLookup(normalizedUsers)
    const benefitsByUserId = new Map()

    for (const entry of normalizedUsers) {
        const userId = String(entry?._id || '').trim()
        if (!userId) continue
        benefitsByUserId.set(
            userId,
            mergeVipVisualBenefits(
                entry?.vipBenefits,
                resolveTierBenefitsForUser(entry, tierById, tierByLevel)
            )
        )
    }

    return benefitsByUserId
}

const getAdminUserIds = async () => {
    const admins = await User.find({ role: 'admin' }).select('_id').lean()
    return admins.map((entry) => entry._id)
}

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const normalizeDailyType = (type = '') => {
    const normalized = String(type || '').trim().toLowerCase()
    if (normalized === 'mapexp' || normalized === 'exp' || normalized === 'map_exp') return 'mapExp'
    if (normalized === 'moonpoints' || normalized === 'moon' || normalized === 'moon_points') return 'moonPoints'
    return 'search'
}

const buildDailySort = (type = 'search') => {
    if (type === 'mapExp') {
        return { mapExp: -1, searches: -1, moonPoints: -1, userId: 1 }
    }
    if (type === 'moonPoints') {
        return { moonPoints: -1, mapExp: -1, searches: -1, userId: 1 }
    }
    return { searches: -1, mapExp: -1, moonPoints: -1, userId: 1 }
}

const normalizeRankingMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'power' || normalized === 'combat' || normalized === 'combat_power' || normalized === 'lucchien') {
        return 'power'
    }
    return 'collection'
}

const normalizeOverallMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (
        normalized === 'wealth'
        || normalized === 'coins'
        || normalized === 'platinum'
        || normalized === 'platinumcoins'
        || normalized === 'tai_phu'
        || normalized === 'taiphu'
    ) {
        return 'wealth'
    }
    if (
        normalized === 'trainerbattle'
        || normalized === 'trainer_battle'
        || normalized === 'trainer'
        || normalized === 'trainerlevel'
        || normalized === 'trainer_level'
        || normalized === 'hvl'
    ) {
        return 'trainerBattle'
    }
    if (
        normalized === 'lc'
        || normalized === 'combat'
        || normalized === 'power'
        || normalized === 'combat_power'
        || normalized === 'lucchien'
    ) {
        return 'lc'
    }
    return 'wealth'
}

const resolveForceRefreshPermission = async (req, res) => {
    const refreshRequested = String(req.query.refresh || '').trim().toLowerCase() === '1'
    if (!refreshRequested) return false
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) return false

    await authMiddleware(req, res, () => { })
    if (res.headersSent) return null
    return req.user?.role === 'admin'
}

const RARITY_KEYS = ['sss+', 'sss', 'ss', 's', 'a', 'b', 'c', 'd']

const normalizeRarityKey = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    return RARITY_KEYS.includes(normalized) ? normalized : 'd'
}

const normalizePokemonRarityFilter = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized || normalized === 'all') return 'all'
    return RARITY_KEYS.includes(normalized) ? normalized : 'all'
}

const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildPokemonSpeciesQuery = ({ search = '', rarity = 'all', type = 'all' } = {}) => {
    const query = {}
    const rarityFilter = normalizePokemonRarityFilter(rarity)
    const typeFilter = String(type || '').trim().toLowerCase()
    const keyword = String(search || '').trim()

    if (rarityFilter !== 'all') {
        query.rarity = rarityFilter
    }
    if (typeFilter && typeFilter !== 'all') {
        query.types = typeFilter
    }

    if (!keyword) {
        return query
    }

    const searchRegex = new RegExp(escapeRegExp(keyword), 'i')
    const numericSearch = Number.parseInt(keyword, 10)
    if (Number.isFinite(numericSearch)) {
        query.$or = [
            { pokedexNumber: numericSearch },
            { name: searchRegex },
        ]
    } else {
        query.$or = [
            { name: searchRegex },
        ]
    }

    return query
}

const RARITY_VALUE_BASE_SCORE = {
    'sss+': 100,
    d: 20,
    c: 35,
    b: 50,
    a: 66,
    s: 80,
    ss: 90,
    sss: 97,
}

const resolveValueTierLabel = (score = 0) => {
    if (score >= 95) return 'Cực phẩm'
    if (score >= 85) return 'Rất hiếm'
    if (score >= 70) return 'Giá trị cao'
    if (score >= 50) return 'Ổn định'
    return 'Phổ thông'
}

const calcSpeciesValueScore = ({ rarity = 'd', totalOwnedByPlayers = 0, rarityWeight = 100 } = {}) => {
    const normalizedRarity = normalizeRarityKey(rarity)
    const baseScore = RARITY_VALUE_BASE_SCORE[normalizedRarity] || RARITY_VALUE_BASE_SCORE.d

    const totalOwned = Math.max(0, Number(totalOwnedByPlayers || 0))
    const scarcityByPopulation = totalOwned <= 0
        ? 15
        : Math.max(0, Math.round(15 - (Math.log10(totalOwned + 1) * 4)))

    const parsedWeight = Number(rarityWeight)
    const safeWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 100
    const scarcityByWeight = Math.max(
        0,
        Math.min(8, Math.round(Math.log10((101 / Math.max(0.1, safeWeight))) * 3))
    )

    return Math.max(1, Math.min(100, baseScore + scarcityByPopulation + scarcityByWeight))
}

const getPokedexFallbackSprite = (pokedexNumber) => {
    const numeric = Math.max(0, Number.parseInt(pokedexNumber, 10) || 0)
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${numeric}.png`
}

const getFormLabel = (formId = '', formName = '') => {
    const explicit = String(formName || '').trim()
    if (explicit) return explicit
    const normalized = normalizeFormId(formId)
    return normalized
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((entry) => entry.slice(0, 1).toUpperCase() + entry.slice(1))
        .join(' ')
}

const buildSpeciesFormsForStats = (species = {}) => {
    const speciesId = String(species?._id || '').trim()
    if (!speciesId) return []

    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const fallbackSprite = getPokedexFallbackSprite(species?.pokedexNumber)
    const baseSprite = String(
        species?.sprites?.icon
        || species?.sprites?.normal
        || species?.imageUrl
        || fallbackSprite
    ).trim() || fallbackSprite

    const formMap = new Map()
    formMap.set(defaultFormId, {
        formId: defaultFormId,
        formName: getFormLabel(defaultFormId, defaultFormId === 'normal' ? 'Mặc định' : ''),
        sprite: baseSprite,
        isDefault: true,
    })

    for (const entry of forms) {
        const normalizedFormId = normalizeFormId(entry?.formId || defaultFormId)
        if (!normalizedFormId) continue
        const sprite = String(
            entry?.sprites?.icon
            || entry?.sprites?.normal
            || entry?.imageUrl
            || baseSprite
        ).trim() || baseSprite

        formMap.set(normalizedFormId, {
            formId: normalizedFormId,
            formName: getFormLabel(normalizedFormId, entry?.formName),
            sprite,
            isDefault: normalizedFormId === defaultFormId,
        })
    }

    const entries = Array.from(formMap.values())
    const sortedAlternates = entries
        .filter((entry) => !entry.isDefault)
        .sort((left, right) => left.formName.localeCompare(right.formName, 'vi', { sensitivity: 'base' }))

    return [
        ...entries.filter((entry) => entry.isDefault),
        ...sortedAlternates,
    ]
}

const isValidObjectIdString = (value = '') => /^[a-f\d]{24}$/i.test(String(value || '').trim())

const toObjectIdOrNull = (value = null) => {
    const raw = String(value || '').trim()
    if (!isValidObjectIdString(raw)) return null
    return new mongoose.Types.ObjectId(raw)
}

const buildWeeklyPeriod = (sourceDate = new Date()) => {
    const now = new Date(sourceDate)
    now.setHours(0, 0, 0, 0)

    const mondayOffset = (now.getDay() + 6) % 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - mondayOffset)

    return {
        type: 'weekly',
        resetDay: 'monday',
        weekStart: toDailyDateKey(weekStart),
        weekEnd: toDailyDateKey(now),
    }
}

const buildBattleTrainerLevelLookup = async () => {
    const rows = await BattleTrainer.find({})
        .select('_id orderIndex milestoneLevel createdAt')
        .sort({ orderIndex: 1, createdAt: 1, _id: 1 })
        .lean()

    const levelByTrainerId = new Map()
    rows.forEach((entry, index) => {
        const trainerId = String(entry?._id || '').trim()
        if (!trainerId) return

        const orderIndex = Math.max(0, Number.parseInt(entry?.orderIndex, 10) || 0)
        const milestoneLevel = Math.max(0, Number.parseInt(entry?.milestoneLevel, 10) || 0)
        const explicitLevel = Math.max(orderIndex, milestoneLevel)
        const sequentialLevel = index + 1
        const level = explicitLevel > 0 ? explicitLevel : sequentialLevel

        levelByTrainerId.set(trainerId, level)
    })

    return levelByTrainerId
}

const normalizeTrainerCompletionReachedAtMap = (value = null) => {
    if (value instanceof Map) {
        return new Map(
            [...value.entries()]
                .map(([trainerId, reachedAt]) => [String(trainerId || '').trim(), reachedAt])
                .filter(([trainerId]) => Boolean(trainerId))
        )
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return new Map(
            Object.entries(value)
                .map(([trainerId, reachedAt]) => [String(trainerId || '').trim(), reachedAt])
                .filter(([trainerId]) => Boolean(trainerId))
        )
    }

    return new Map()
}

const parseCompletionTimestamp = (value = null) => {
    if (!value) return null
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
}

const resolveHighestCompletedTrainerProgress = (
    completedTrainerIds = [],
    completedTrainerReachedAt = null,
    levelByTrainerId = new Map()
) => {
    const normalizedIds = Array.isArray(completedTrainerIds) ? completedTrainerIds : []
    const reachedAtByTrainerId = normalizeTrainerCompletionReachedAtMap(completedTrainerReachedAt)
    let highestLevel = 0
    let highestLevelReachedAtMs = null

    for (const rawTrainerId of normalizedIds) {
        const trainerId = String(rawTrainerId || '').trim()
        if (!trainerId) continue

        const level = Math.max(0, Number(levelByTrainerId.get(trainerId) || 0))
        if (level <= 0) continue

        const reachedAtMs = parseCompletionTimestamp(reachedAtByTrainerId.get(trainerId))

        if (level > highestLevel) {
            highestLevel = level
            highestLevelReachedAtMs = reachedAtMs
            continue
        }

        if (level === highestLevel && reachedAtMs !== null) {
            if (highestLevelReachedAtMs === null || reachedAtMs < highestLevelReachedAtMs) {
                highestLevelReachedAtMs = reachedAtMs
            }
        }
    }

    return {
        level: highestLevel,
        reachedAtMs: highestLevelReachedAtMs,
    }
}

const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'

const resolvePokemonForm = (pokemon = {}, formId = 'normal') => {
    const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
    const normalizedFormId = normalizeFormId(formId)
    const defaultFormId = normalizeFormId(pokemon.defaultFormId || 'normal')
    return forms.find((entry) => normalizeFormId(entry?.formId) === normalizedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
}

const resolvePokemonSprite = (entry) => {
    const pokemon = entry?.pokemon || {}
    const resolvedForm = resolvePokemonForm(pokemon, entry?.formId)
    const formSprites = resolvedForm?.sprites || {}
    const pokedexNumber = Number(pokemon?.pokedexNumber || 0)
    const fallbackSprite = pokedexNumber > 0
        ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexNumber}.png`
        : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'

    const baseNormal = pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.icon || fallbackSprite
    const formNormal = resolvedForm?.imageUrl || formSprites.normal || formSprites.icon || baseNormal
    const shinySprite = formSprites.shiny || pokemon.sprites?.shiny || formNormal

    return entry?.isShiny ? shinySprite : formNormal
}

const resolvePokemonBaseStats = (entry) => {
    const pokemon = entry?.pokemon || {}
    return resolveEffectivePokemonBaseStats({
        pokemonLike: pokemon,
        formId: entry?.formId,
    })
}

const toStatNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toSafePositiveInt = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1)
    return Math.max(1, Math.floor(parsed))
}

const calcPokemonCombatPower = (entry) => {
    const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
    const pokemon = entry?.pokemon || {}
    const baseStats = resolvePokemonBaseStats(entry)
    const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity || 'd')
    const ivs = entry?.ivs && typeof entry.ivs === 'object' ? entry.ivs : {}
    const evs = entry?.evs && typeof entry.evs === 'object' ? entry.evs : {}

    const resolveStat = (key, aliases = []) => {
        const iv = toStatNumber(ivs[key] ?? aliases.map((alias) => ivs[alias]).find((value) => value != null))
        const ev = toStatNumber(evs[key] ?? aliases.map((alias) => evs[alias]).find((value) => value != null))
        const base = toStatNumber(scaledStats[key] ?? aliases.map((alias) => scaledStats[alias]).find((value) => value != null))
        return Math.max(1, Math.floor(base + iv + (ev / 8)))
    }

    const hp = resolveStat('hp')
    const atk = resolveStat('atk')
    const def = resolveStat('def')
    const spatk = resolveStat('spatk')
    const spdef = resolveStat('spdef', ['spldef'])
    const spd = resolveStat('spd')

    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (level * 2)
    const shinyBonus = entry?.isShiny ? 1.03 : 1
    return toSafePositiveInt(rawPower * shinyBonus, 1)
}

const countDexEntriesForSpecies = (species = {}) => {
    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const uniqueFormIds = new Set([defaultFormId])
    for (const form of forms) {
        const normalizedFormId = normalizeFormId(form?.formId || defaultFormId)
        if (normalizedFormId) uniqueFormIds.add(normalizedFormId)
    }
    return Math.max(1, uniqueFormIds.size)
}

const getTotalDexEntries = async () => {
    const speciesRows = await Pokemon.find({})
        .select('defaultFormId forms')
        .lean()
    return speciesRows.reduce((total, species) => total + countDexEntriesForSpecies(species), 0)
}

const getPokemonPowerMetaLookup = async () => {
    const now = Date.now()
    if (pokemonPowerMetaCache.byId.size > 0 && pokemonPowerMetaCache.expiresAt > now) {
        return pokemonPowerMetaCache.byId
    }

    if (pokemonPowerMetaCache.inFlight) {
        return pokemonPowerMetaCache.inFlight
    }

    const refreshPromise = Pokemon.find({})
        .select('_id name pokedexNumber types rarity forms baseStats defaultFormId imageUrl sprites')
        .lean()
        .then((rows) => {
            const byId = new Map()
            for (const entry of rows) {
                const key = String(entry?._id || '').trim()
                if (!key) continue
                byId.set(key, entry)
            }
            pokemonPowerMetaCache.byId = byId
            pokemonPowerMetaCache.expiresAt = Date.now() + POKEMON_POWER_META_CACHE_TTL_MS
            pokemonPowerMetaCache.inFlight = null
            return byId
        })
        .catch((error) => {
            pokemonPowerMetaCache.inFlight = null
            throw error
        })

    pokemonPowerMetaCache.inFlight = refreshPromise
    return refreshPromise
}

const buildPowerRankingSnapshot = async (adminUserIds = []) => {
    const pokemonLookup = await getPokemonPowerMetaLookup()
    const baseMatch = {}
    if (Array.isArray(adminUserIds) && adminUserIds.length > 0) {
        baseMatch.userId = { $nin: adminUserIds }
    }

    const rows = await UserPokemon.find(baseMatch)
        .select('_id userId pokemonId level experience nickname isShiny formId ivs evs')
        .lean()

    const normalizedRows = []

    for (const entry of rows) {
        const pokemonId = String(entry?.pokemonId || '').trim()
        if (!pokemonId) continue
        const pokemon = pokemonLookup.get(pokemonId)
        if (!pokemon) continue

        const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
        const experience = Math.max(0, Number(entry?.experience || 0))
        const combatPower = toSafePositiveInt(calcPokemonCombatPower({ ...entry, pokemon }), Math.max(1, level * 10))

        normalizedRows.push({
            sortId: String(entry?._id || '').trim(),
            userPokemonId: entry?._id || null,
            ownerId: entry?.userId || null,
            level,
            experience,
            nickname: String(entry?.nickname || '').trim(),
            isShiny: Boolean(entry?.isShiny),
            formId: String(entry?.formId || 'normal').trim() || 'normal',
            combatPower,
            sprite: resolvePokemonSprite({ ...entry, pokemon }),
            pokemon: {
                _id: pokemon?._id || null,
                name: String(pokemon?.name || '').trim() || 'Unknown',
                pokedexNumber: Math.max(0, Number(pokemon?.pokedexNumber || 0)),
                types: Array.isArray(pokemon?.types) ? pokemon.types : [],
            },
        })
    }

    normalizedRows.sort((a, b) => {
        if (b.combatPower !== a.combatPower) return b.combatPower - a.combatPower
        if (b.level !== a.level) return b.level - a.level
        if (b.experience !== a.experience) return b.experience - a.experience
        return a.sortId.localeCompare(b.sortId)
    })

    return normalizedRows.map(({ sortId, ...entry }) => entry)
}

const getPowerRankingSnapshot = async (adminUserIds = [], options = {}) => {
    const normalizedAdminKeys = Array.isArray(adminUserIds)
        ? adminUserIds.map((entry) => String(entry || '').trim()).filter(Boolean).sort()
        : []
    const cacheKey = normalizedAdminKeys.join(',') || 'all-users'
    const now = Date.now()
    const cached = powerRankingSnapshotCache.get(cacheKey)
    const forceRefresh = options?.forceRefresh === true

    if (!forceRefresh && cached?.snapshot && cached.expiresAt > now) {
        return cached.snapshot
    }

    if (cached?.inFlight) {
        return cached.inFlight
    }

    const refreshPromise = buildPowerRankingSnapshot(adminUserIds)
        .then((snapshot) => {
            powerRankingSnapshotCache.set(cacheKey, {
                snapshot,
                expiresAt: Date.now() + POWER_RANKING_CACHE_TTL_MS,
                inFlight: null,
            })
            return snapshot
        })
        .catch((error) => {
            const previous = powerRankingSnapshotCache.get(cacheKey)
            if (previous) {
                powerRankingSnapshotCache.set(cacheKey, {
                    ...previous,
                    inFlight: null,
                })
            }
            throw error
        })

    powerRankingSnapshotCache.set(cacheKey, {
        snapshot: cached?.snapshot || null,
        expiresAt: cached?.expiresAt || 0,
        inFlight: refreshPromise,
    })

    if (cached?.snapshot) {
        refreshPromise.catch(() => { })
        return cached.snapshot
    }

    return refreshPromise
}

const warmPowerRankingSnapshot = async () => {
    const adminUserIds = await getAdminUserIds()
    await getPowerRankingSnapshot(adminUserIds)
}

if (process.env.NODE_ENV !== 'test') {
    const warmupTimeout = setTimeout(() => {
        warmPowerRankingSnapshot().catch((error) => {
            console.warn('rankings power snapshot warmup failed:', error?.message || error)
        })

        const warmupInterval = setInterval(() => {
            warmPowerRankingSnapshot().catch((error) => {
                console.warn('rankings power snapshot refresh failed:', error?.message || error)
            })
        }, POWER_RANKING_CACHE_WARM_INTERVAL_MS)

        if (typeof warmupInterval.unref === 'function') {
            warmupInterval.unref()
        }
    }, POWER_RANKING_CACHE_WARMUP_DELAY_MS)

    if (typeof warmupTimeout.unref === 'function') {
        warmupTimeout.unref()
    }
}

// GET /api/rankings/daily - Daily rankings by searches/map exp/moon points
router.get('/daily', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()

        const requestedDate = String(req.query.date || '').trim()
        const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : toDailyDateKey()
        const rankingType = normalizeDailyType(req.query.type)
        const sort = buildDailySort(rankingType)

        const filter = { date }
        if (adminUserIds.length > 0) {
            filter.userId = { $nin: adminUserIds }
        }
        const [totalUsers, activities] = await Promise.all([
            DailyActivity.countDocuments(filter),
            DailyActivity.find(filter)
                .select('userId searches mapExp moonPoints')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('userId', 'username avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
                .lean(),
        ])

        const userIds = activities
            .map((activity) => activity.userId?._id)
            .filter(Boolean)
        const playerStates = await PlayerState.find({ userId: { $in: userIds } })
            .select('userId level')
            .lean()
        const playerLevelByUserId = new Map(playerStates.map((state) => [state.userId.toString(), state.level || 1]))
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(activities.map((activity) => activity?.userId))

        const rankings = activities.map((activity, index) => ({
            rank: skip + index + 1,
            userId: activity.userId?._id || null,
            username: activity.userId?.username || 'Unknown',
            avatar: normalizeAvatarUrl(activity.userId?.avatar),
            role: String(activity?.userId?.role || 'user').trim() || 'user',
            vipTierLevel: Math.max(0, parseInt(activity?.userId?.vipTierLevel, 10) || 0),
            vipTierCode: String(activity?.userId?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(activity?.userId?._id || ''))),
            level: activity.userId?._id ? (playerLevelByUserId.get(activity.userId._id.toString()) || 1) : 1,
            searches: activity.searches || 0,
            mapExp: activity.mapExp || 0,
            moonPoints: activity.moonPoints || 0,
            date,
        }))

        const totalPages = Math.max(1, Math.ceil(totalUsers / limit))

        res.json({
            ok: true,
            rankings,
            type: rankingType,
            date,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/daily error:', error)
        next(error)
    }
})

// GET /api/rankings/overall - Overall rankings by selected mode
router.get('/overall', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()
        const overallMode = normalizeOverallMode(req.query.mode)
        const period = buildWeeklyPeriod(new Date())
        const weeklyMatch = {
            date: {
                $gte: period.weekStart,
                $lte: period.weekEnd,
            },
        }
        if (adminUserIds.length > 0) {
            weeklyMatch.userId = { $nin: adminUserIds }
        }

        const buildPlayerLevelByUserId = async (userIds = []) => {
            const normalizedUserIds = Array.isArray(userIds) ? userIds.filter(Boolean) : []
            if (normalizedUserIds.length === 0) return new Map()

            const playerStates = await PlayerState.find({ userId: { $in: normalizedUserIds } })
                .select('userId level')
                .lean()

            return new Map(
                playerStates.map((entry) => [String(entry?.userId || ''), Math.max(1, Number(entry?.level || 1))])
            )
        }

        if (overallMode === 'lc') {
            const weeklyActiveUsers = await DailyActivity.aggregate([
                { $match: weeklyMatch },
                {
                    $group: {
                        _id: '$userId',
                    },
                },
            ]).allowDiskUse(true)

            const weeklyActiveUserIdSet = new Set(
                weeklyActiveUsers
                    .map((entry) => String(entry?._id || '').trim())
                    .filter(Boolean)
            )

            if (weeklyActiveUserIdSet.size === 0) {
                return res.json({
                    ok: true,
                    mode: overallMode,
                    period,
                    rankings: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 1,
                        totalUsers: 0,
                        limit,
                        hasNextPage: false,
                        hasPrevPage: false,
                    },
                })
            }

            const activeOwnerIds = Array.from(weeklyActiveUserIdSet)
            const partyRows = await UserPokemon.find({
                userId: { $in: activeOwnerIds },
                location: 'party',
            })
                .select('userId pokemonId level formId isShiny ivs evs')
                .lean()

            const pokemonLookup = await getPokemonPowerMetaLookup()
            const totalCombatPowerByUserId = new Map()

            for (const entry of partyRows) {
                const ownerId = String(entry?.userId || '').trim()
                if (!ownerId) continue

                const pokemonId = String(entry?.pokemonId || '').trim()
                if (!pokemonId) continue

                const pokemon = pokemonLookup.get(pokemonId)
                if (!pokemon) continue

                const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
                const combatPower = toSafePositiveInt(
                    calcPokemonCombatPower({ ...entry, pokemon }),
                    Math.max(1, level * 10)
                )

                totalCombatPowerByUserId.set(
                    ownerId,
                    (totalCombatPowerByUserId.get(ownerId) || 0) + combatPower
                )
            }

            const ownerPowerRows = Array.from(totalCombatPowerByUserId.entries())
                .map(([ownerId, combatPower]) => ({
                    ownerId,
                    combatPower,
                }))
                .sort((a, b) => {
                    if (b.combatPower !== a.combatPower) return b.combatPower - a.combatPower
                    return a.ownerId.localeCompare(b.ownerId)
                })

            const totalUsers = ownerPowerRows.length
            const totalPages = Math.max(1, Math.ceil(totalUsers / limit))
            const pageRows = ownerPowerRows.slice(skip, skip + limit)
            const ownerIds = pageRows.map((entry) => entry.ownerId).filter(Boolean)

            const [owners, playerLevelByUserId] = await Promise.all([
                ownerIds.length > 0
                    ? User.find({ _id: { $in: ownerIds } })
                        .select('username avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
                        .lean()
                    : [],
                buildPlayerLevelByUserId(ownerIds),
            ])

            const ownerById = new Map(
                owners.map((entry) => [String(entry?._id || '').trim(), entry])
            )
            const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(owners)

            const rankings = pageRows.map((entry, index) => {
                const owner = ownerById.get(entry.ownerId)
                return {
                    rank: skip + index + 1,
                    userId: owner?._id || entry.ownerId,
                    username: owner?.username || 'Unknown',
                    avatar: normalizeAvatarUrl(owner?.avatar),
                    role: String(owner?.role || 'user').trim() || 'user',
                    vipTierLevel: Math.max(0, parseInt(owner?.vipTierLevel, 10) || 0),
                    vipTierCode: String(owner?.vipTierCode || '').trim().toUpperCase(),
                    vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(owner?._id || ''))),
                    level: playerLevelByUserId.get(String(owner?._id || entry.ownerId || '')) || 1,
                    combatPower: Math.max(0, Number(entry?.combatPower || 0)),
                }
            })

            return res.json({
                ok: true,
                mode: overallMode,
                period,
                rankings,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalUsers,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            })
        }

        if (overallMode === 'trainerBattle') {
            const weeklyRows = await DailyActivity.aggregate([
                { $match: weeklyMatch },
                {
                    $group: {
                        _id: '$userId',
                        weeklyPlatinumCoins: { $sum: { $ifNull: ['$platinumCoins', 0] } },
                    },
                },
            ]).allowDiskUse(true)

            if (weeklyRows.length === 0) {
                return res.json({
                    ok: true,
                    mode: overallMode,
                    period,
                    rankings: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 1,
                        totalUsers: 0,
                        limit,
                        hasNextPage: false,
                        hasPrevPage: false,
                    },
                })
            }

            const userIds = weeklyRows
                .map((entry) => entry?._id)
                .filter(Boolean)
            const [users, trainerLevelById] = await Promise.all([
                User.find({ _id: { $in: userIds } })
                    .select('username avatar role vipTierId vipTierLevel vipTierCode vipBenefits completedBattleTrainers completedBattleTrainerReachedAt')
                    .lean(),
                buildBattleTrainerLevelLookup(),
            ])

            const userById = new Map(
                users.map((entry) => [String(entry?._id || '').trim(), entry])
            )

            const mergedRows = weeklyRows.map((entry) => {
                const userId = String(entry?._id || '').trim()
                const user = userById.get(userId) || null
                const weeklyPlatinumCoins = Math.max(0, Number(entry?.weeklyPlatinumCoins || 0))
                const trainerProgress = resolveHighestCompletedTrainerProgress(
                    user?.completedBattleTrainers,
                    user?.completedBattleTrainerReachedAt,
                    trainerLevelById
                )

                return {
                    userId,
                    user,
                    weeklyPlatinumCoins,
                    weeklyTrainerBattleLevels: trainerProgress.level,
                    highestLevelReachedAtMs: trainerProgress.reachedAtMs,
                }
            })

            mergedRows.sort((a, b) => {
                if (b.weeklyTrainerBattleLevels !== a.weeklyTrainerBattleLevels) {
                    return b.weeklyTrainerBattleLevels - a.weeklyTrainerBattleLevels
                }
                const aReachedAt = Number.isFinite(a.highestLevelReachedAtMs)
                    ? a.highestLevelReachedAtMs
                    : Number.MAX_SAFE_INTEGER
                const bReachedAt = Number.isFinite(b.highestLevelReachedAtMs)
                    ? b.highestLevelReachedAtMs
                    : Number.MAX_SAFE_INTEGER
                if (aReachedAt !== bReachedAt) {
                    return aReachedAt - bReachedAt
                }
                if (b.weeklyPlatinumCoins !== a.weeklyPlatinumCoins) {
                    return b.weeklyPlatinumCoins - a.weeklyPlatinumCoins
                }
                return a.userId.localeCompare(b.userId)
            })

            const totalUsers = mergedRows.length
            const totalPages = Math.max(1, Math.ceil(totalUsers / limit))
            const pageRows = mergedRows.slice(skip, skip + limit)
            const pageUserIds = pageRows
                .map((entry) => entry.user?._id || entry.userId)
                .filter(Boolean)

            const [playerLevelByUserId, benefitsByUserId] = await Promise.all([
                buildPlayerLevelByUserId(pageUserIds),
                buildEffectiveVipBenefitsByUserId(pageRows.map((entry) => entry?.user)),
            ])

            const rankings = pageRows.map((entry, index) => ({
                rank: skip + index + 1,
                userId: entry?.user?._id || entry.userId || null,
                username: entry?.user?.username || 'Unknown',
                avatar: normalizeAvatarUrl(entry?.user?.avatar),
                role: String(entry?.user?.role || 'user').trim() || 'user',
                vipTierLevel: Math.max(0, parseInt(entry?.user?.vipTierLevel, 10) || 0),
                vipTierCode: String(entry?.user?.vipTierCode || '').trim().toUpperCase(),
                vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(entry?.user?._id || ''))),
                level: playerLevelByUserId.get(String(entry?.user?._id || entry.userId || '')) || 1,
                weeklyPlatinumCoins: entry.weeklyPlatinumCoins,
                weeklyTrainerBattleLevels: entry.weeklyTrainerBattleLevels,
                platinumCoins: entry.weeklyPlatinumCoins,
                trainerBattleLevel: entry.weeklyTrainerBattleLevels,
                trainerBattleReachedAt: Number.isFinite(entry.highestLevelReachedAtMs)
                    ? new Date(entry.highestLevelReachedAtMs).toISOString()
                    : null,
            }))

            return res.json({
                ok: true,
                mode: overallMode,
                period,
                rankings,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalUsers,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            })
        }

        const weeklySort = { weeklyPlatinumCoins: -1, weeklyTrainerBattleLevels: -1, _id: 1 }

        const weeklyGroupPipeline = [
            { $match: weeklyMatch },
            {
                $group: {
                    _id: '$userId',
                    weeklyPlatinumCoins: { $sum: { $ifNull: ['$platinumCoins', 0] } },
                    weeklyTrainerBattleLevels: { $sum: { $ifNull: ['$battles', 0] } },
                },
            },
        ]

        const [totalRows, rows] = await Promise.all([
            DailyActivity.aggregate([
                ...weeklyGroupPipeline,
                {
                    $count: 'total',
                },
            ]).allowDiskUse(true),
            DailyActivity.aggregate([
                ...weeklyGroupPipeline,
                { $sort: weeklySort },
                { $skip: skip },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                {
                    $unwind: {
                        path: '$user',
                        preserveNullAndEmptyArrays: true,
                    },
                },
            ]).allowDiskUse(true),
        ])

        const userIds = rows
            .map((entry) => entry?._id)
            .filter(Boolean)
        const [playerLevelByUserId, benefitsByUserId] = await Promise.all([
            buildPlayerLevelByUserId(userIds),
            buildEffectiveVipBenefitsByUserId(rows.map((entry) => entry?.user)),
        ])

        const rankings = rows.map((entry, index) => {
            const userId = String(entry?._id || '').trim()
            const weeklyPlatinumCoins = Math.max(0, Number(entry?.weeklyPlatinumCoins || 0))
            const weeklyTrainerBattleLevels = Math.max(0, Number(entry?.weeklyTrainerBattleLevels || 0))
            return {
                rank: skip + index + 1,
                userId: entry?._id || null,
                username: entry?.user?.username || 'Unknown',
                avatar: normalizeAvatarUrl(entry?.user?.avatar),
                role: String(entry?.user?.role || 'user').trim() || 'user',
                vipTierLevel: Math.max(0, parseInt(entry?.user?.vipTierLevel, 10) || 0),
                vipTierCode: String(entry?.user?.vipTierCode || '').trim().toUpperCase(),
                vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(entry?.user?._id || ''))),
                level: playerLevelByUserId.get(userId) || 1,
                weeklyPlatinumCoins,
                weeklyTrainerBattleLevels,
                platinumCoins: weeklyPlatinumCoins,
                trainerBattleLevel: weeklyTrainerBattleLevels,
            }
        })

        const totalUsers = Math.max(0, Number(totalRows?.[0]?.total || 0))
        const totalPages = Math.max(1, Math.ceil(totalUsers / limit))

        res.json({
            ok: true,
            mode: overallMode,
            period,
            rankings,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/overall error:', error)
        next(error)
    }
})

// GET /api/rankings/pokemon-rarity/options - Pokemon options for rarity viewer
router.get('/pokemon-rarity/options', authMiddleware, async (req, res, next) => {
    try {
        const search = String(req.query.search || '').trim()
        const rarity = normalizePokemonRarityFilter(req.query.rarity)
        const type = String(req.query.type || '').trim().toLowerCase()
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(120, Math.max(12, parseInt(req.query.limit, 10) || 40))
        const skip = (page - 1) * limit

        const query = buildPokemonSpeciesQuery({ search, rarity, type })
        const [total, rows] = await Promise.all([
            Pokemon.countDocuments(query),
            Pokemon.find(query)
                .select('_id name pokedexNumber rarity')
                .sort({ pokedexNumber: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ])

        const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(total || 0)) / limit))

        res.json({
            ok: true,
            options: rows.map((entry) => ({
                _id: entry?._id,
                name: String(entry?.name || '').trim() || 'Unknown',
                pokedexNumber: Math.max(0, Number(entry?.pokedexNumber || 0)),
                rarity: normalizeRarityKey(entry?.rarity || 'd'),
            })),
            pagination: {
                currentPage: page,
                totalPages,
                total: Math.max(0, Number(total || 0)),
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/pokemon-rarity/options error:', error)
        next(error)
    }
})

// GET /api/rankings/pokemon-rarity - Pokemon rarity + amount viewer
router.get('/pokemon-rarity', authMiddleware, async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25))
        const skip = (page - 1) * limit
        const search = String(req.query.search || '').trim()
        const rarity = normalizePokemonRarityFilter(req.query.rarity)
        const type = String(req.query.type || '').trim().toLowerCase()
        const requestedPokemonId = String(req.query.pokemonId || '').trim()
        const selectedPokemonId = isValidObjectIdString(requestedPokemonId) ? requestedPokemonId : ''

        const adminUserIds = await getAdminUserIds()
        const baseMatch = {}
        if (adminUserIds.length > 0) {
            baseMatch.userId = { $nin: adminUserIds }
        }

        const query = buildPokemonSpeciesQuery({ search, rarity, type })
        const [totalSpecies, speciesRows, totalPokemonInPlayerHands] = await Promise.all([
            Pokemon.countDocuments(query),
            Pokemon.find(query)
                .select('name pokedexNumber rarity rarityWeight forms defaultFormId imageUrl sprites')
                .sort({ pokedexNumber: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            UserPokemon.countDocuments(baseMatch),
        ])

        let selectedSpecies = null
        if (selectedPokemonId) {
            selectedSpecies = await Pokemon.findById(selectedPokemonId)
                .select('name pokedexNumber rarity rarityWeight forms defaultFormId imageUrl sprites')
                .lean()
        }
        if (!selectedSpecies && speciesRows.length > 0) {
            selectedSpecies = speciesRows[0]
        }

        const requestedSpeciesIdSet = new Set(
            speciesRows
                .map((entry) => String(entry?._id || '').trim())
                .filter(Boolean)
        )
        const selectedSpeciesId = String(selectedSpecies?._id || '').trim()
        if (selectedSpeciesId) {
            requestedSpeciesIdSet.add(selectedSpeciesId)
        }

        const requestedSpeciesIds = Array.from(requestedSpeciesIdSet)
        const requestedSpeciesObjectIds = requestedSpeciesIds
            .map((entry) => toObjectIdOrNull(entry))
            .filter(Boolean)
        const requesterUserObjectId = toObjectIdOrNull(req.user.userId)
        let globalFormCountRows = []
        let ownedFormCountRows = []
        if (requestedSpeciesObjectIds.length > 0) {
            const sharedProjectionStage = {
                $project: {
                    pokemonId: 1,
                    normalizedFormId: {
                        $let: {
                            vars: {
                                rawFormId: {
                                    $toLower: {
                                        $trim: {
                                            input: {
                                                $ifNull: ['$formId', ''],
                                            },
                                        },
                                    },
                                },
                            },
                            in: {
                                $cond: [
                                    { $eq: ['$$rawFormId', ''] },
                                    'normal',
                                    '$$rawFormId',
                                ],
                            },
                        },
                    },
                },
            }

            const groupStages = [
                {
                    $group: {
                        _id: {
                            pokemonId: '$pokemonId',
                            formId: '$normalizedFormId',
                        },
                        count: { $sum: 1 },
                    },
                },
            ]

            const [globalRows, ownedRows] = await Promise.all([
                UserPokemon.aggregate([
                    {
                        $match: {
                            ...baseMatch,
                            pokemonId: { $in: requestedSpeciesObjectIds },
                        },
                    },
                    sharedProjectionStage,
                    ...groupStages,
                ]).allowDiskUse(true),
                requesterUserObjectId
                    ? UserPokemon.aggregate([
                        {
                            $match: {
                                userId: requesterUserObjectId,
                                pokemonId: { $in: requestedSpeciesObjectIds },
                            },
                        },
                        sharedProjectionStage,
                        ...groupStages,
                    ]).allowDiskUse(true)
                    : [],
            ])

            globalFormCountRows = globalRows
            ownedFormCountRows = ownedRows
        }

        const globalCountBySpecies = new Map()
        const globalCountBySpeciesForm = new Map()
        for (const row of globalFormCountRows) {
            const speciesId = String(row?._id?.pokemonId || '').trim()
            if (!speciesId) continue
            const formId = normalizeFormId(row?._id?.formId || 'normal')
            const count = Math.max(0, Number(row?.count || 0))
            globalCountBySpeciesForm.set(`${speciesId}:${formId}`, count)
            globalCountBySpecies.set(speciesId, (globalCountBySpecies.get(speciesId) || 0) + count)
        }

        const ownedCountBySpecies = new Map()
        const ownedCountBySpeciesForm = new Map()
        for (const row of ownedFormCountRows) {
            const speciesId = String(row?._id?.pokemonId || '').trim()
            if (!speciesId) continue
            const formId = normalizeFormId(row?._id?.formId || 'normal')
            const count = Math.max(0, Number(row?.count || 0))
            ownedCountBySpeciesForm.set(`${speciesId}:${formId}`, count)
            ownedCountBySpecies.set(speciesId, (ownedCountBySpecies.get(speciesId) || 0) + count)
        }

        const rankings = speciesRows.map((species, index) => {
            const speciesId = String(species?._id || '').trim()
            const rarityKey = normalizeRarityKey(species?.rarity || 'd')
            const totalOwnedByPlayers = Math.max(0, Number(globalCountBySpecies.get(speciesId) || 0))
            const totalOwnedByMe = Math.max(0, Number(ownedCountBySpecies.get(speciesId) || 0))
            const valueScore = calcSpeciesValueScore({
                rarity: rarityKey,
                totalOwnedByPlayers,
                rarityWeight: species?.rarityWeight,
            })

            return {
                rank: skip + index + 1,
                pokemonId: species?._id || null,
                name: String(species?.name || '').trim() || 'Unknown',
                pokedexNumber: Math.max(0, Number(species?.pokedexNumber || 0)),
                rarity: rarityKey,
                rarityLabel: rarityKey.toUpperCase(),
                rarityWeight: Math.max(0, Number(species?.rarityWeight || 0)),
                totalOwnedByPlayers,
                totalOwnedByMe,
                valueScore,
                valueTier: resolveValueTierLabel(valueScore),
                sprite: String(
                    species?.sprites?.icon
                    || species?.sprites?.normal
                    || species?.imageUrl
                    || getPokedexFallbackSprite(species?.pokedexNumber)
                ).trim() || getPokedexFallbackSprite(species?.pokedexNumber),
            }
        })

        let selectedSpeciesStats = null
        if (selectedSpecies) {
            const selectedId = String(selectedSpecies?._id || '').trim()
            const selectedRarity = normalizeRarityKey(selectedSpecies?.rarity || 'd')
            const forms = buildSpeciesFormsForStats(selectedSpecies)
            const formStats = forms.map((form) => {
                const key = `${selectedId}:${normalizeFormId(form.formId || 'normal')}`
                const totalOwnedByPlayers = Math.max(0, Number(globalCountBySpeciesForm.get(key) || 0))
                const totalOwnedByMe = Math.max(0, Number(ownedCountBySpeciesForm.get(key) || 0))
                return {
                    formId: normalizeFormId(form.formId || 'normal'),
                    formName: String(form.formName || '').trim() || 'Mặc định',
                    isDefault: Boolean(form.isDefault),
                    sprite: String(form.sprite || '').trim() || getPokedexFallbackSprite(selectedSpecies?.pokedexNumber),
                    totalOwnedByPlayers,
                    totalOwnedByMe,
                }
            })

            const selectedTotalOwnedByPlayers = Math.max(0, Number(globalCountBySpecies.get(selectedId) || 0))
            const selectedTotalOwnedByMe = Math.max(0, Number(ownedCountBySpecies.get(selectedId) || 0))
            const selectedValueScore = calcSpeciesValueScore({
                rarity: selectedRarity,
                totalOwnedByPlayers: selectedTotalOwnedByPlayers,
                rarityWeight: selectedSpecies?.rarityWeight,
            })

            selectedSpeciesStats = {
                pokemonId: selectedSpecies?._id || null,
                name: String(selectedSpecies?.name || '').trim() || 'Unknown',
                pokedexNumber: Math.max(0, Number(selectedSpecies?.pokedexNumber || 0)),
                rarity: selectedRarity,
                rarityLabel: selectedRarity.toUpperCase(),
                rarityWeight: Math.max(0, Number(selectedSpecies?.rarityWeight || 0)),
                totalOwnedByPlayers: selectedTotalOwnedByPlayers,
                totalOwnedByMe: selectedTotalOwnedByMe,
                valueScore: selectedValueScore,
                valueTier: resolveValueTierLabel(selectedValueScore),
                forms: formStats,
            }
        }

        const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalSpecies || 0)) / limit))
        res.json({
            ok: true,
            rankings,
            selectedSpecies: selectedSpeciesStats,
            filters: {
                search,
                rarity,
                type,
            },
            summary: {
                totalPokemonInPlayerHands: Math.max(0, Number(totalPokemonInPlayerHands || 0)),
                totalSpecies: Math.max(0, Number(totalSpecies || 0)),
            },
            pagination: {
                currentPage: page,
                totalPages,
                total: Math.max(0, Number(totalSpecies || 0)),
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/pokemon-rarity error:', error)
        next(error)
    }
})

// GET /api/rankings/pokemon - Pokemon collection leaderboard by user
router.get('/pokemon', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()
        const rankingMode = normalizeRankingMode(req.query.mode)
        const forceRefresh = await resolveForceRefreshPermission(req, res)
        if (forceRefresh === null) return

        const baseMatch = {}
        if (adminUserIds.length > 0) {
            baseMatch.userId = { $nin: adminUserIds }
        }

        if (rankingMode === 'power') {
            const sortedRows = await getPowerRankingSnapshot(adminUserIds, { forceRefresh })

            const total = sortedRows.length
            const totalPages = Math.max(1, Math.ceil(total / limit))
            const pageRows = sortedRows.slice(skip, skip + limit)
            const ownerIds = Array.from(new Set(
                pageRows
                    .map((entry) => String(entry?.ownerId || '').trim())
                    .filter(Boolean)
            ))
            const owners = ownerIds.length > 0
                ? await User.find({ _id: { $in: ownerIds } })
                    .select('username avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
                    .lean()
                : []
            const ownerById = new Map(
                owners.map((entry) => [String(entry?._id || '').trim(), entry])
            )
            const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(
                owners
            )
            const rankings = pageRows.map((entry, index) => {
                const owner = ownerById.get(String(entry?.ownerId || '').trim())
                return {
                    rank: skip + index + 1,
                    userPokemonId: entry.userPokemonId,
                    level: entry.level,
                    experience: entry.experience,
                    nickname: entry.nickname || '',
                    isShiny: Boolean(entry.isShiny),
                    formId: entry.formId || 'normal',
                    combatPower: entry.combatPower,
                    power: entry.combatPower,
                    sprite: entry.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
                    pokemon: {
                        _id: entry.pokemon?._id,
                        name: entry.pokemon?.name || 'Unknown',
                        pokedexNumber: entry.pokemon?.pokedexNumber || 0,
                        types: Array.isArray(entry.pokemon?.types) ? entry.pokemon.types : [],
                    },
                    owner: {
                        _id: owner?._id || null,
                        username: owner?.username || 'Unknown',
                        avatar: normalizeAvatarUrl(owner?.avatar),
                        role: String(owner?.role || 'user').trim() || 'user',
                        vipTierLevel: Math.max(0, parseInt(owner?.vipTierLevel, 10) || 0),
                        vipTierCode: String(owner?.vipTierCode || '').trim().toUpperCase(),
                        vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(owner?._id || ''))),
                    },
                }
            })

            return res.json({
                ok: true,
                mode: rankingMode,
                rankings,
                pagination: {
                    currentPage: page,
                    totalPages,
                    total,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            })
        }

        const [rows, totalUsers, totalDexEntries] = await Promise.all([
            UserPokemon.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: '$userId',
                        totalPokemon: { $sum: 1 },
                        uniqueDexEntryKeys: {
                            $addToSet: {
                                $let: {
                                    vars: {
                                        rawFormId: {
                                            $toLower: {
                                                $ifNull: ['$formId', 'normal'],
                                            },
                                        },
                                    },
                                    in: {
                                        $concat: [
                                            { $toString: '$pokemonId' },
                                            ':',
                                            {
                                                $cond: [
                                                    { $eq: ['$$rawFormId', ''] },
                                                    'normal',
                                                    '$$rawFormId',
                                                ],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    $project: {
                        totalPokemon: 1,
                        collectedCount: {
                            $size: {
                                $ifNull: ['$uniqueDexEntryKeys', []],
                            },
                        },
                    },
                },
                { $sort: { collectedCount: -1, totalPokemon: -1, _id: 1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                {
                    $unwind: {
                        path: '$user',
                        preserveNullAndEmptyArrays: true,
                    },
                },
            ]).allowDiskUse(true),
            UserPokemon.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: '$userId',
                    },
                },
                {
                    $count: 'total',
                },
            ]).allowDiskUse(true),
            getTotalDexEntries(),
        ])

        const normalizedTotalUsers = Math.max(0, Number(totalUsers?.[0]?.total || 0))
        const totalPages = Math.max(1, Math.ceil(normalizedTotalUsers / limit))
        const normalizedTotalDexEntries = Math.max(0, Number(totalDexEntries || 0))
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(rows.map((entry) => entry?.user))

        const rankings = rows.map((entry, index) => ({
            rank: skip + index + 1,
            userId: entry._id || null,
            username: entry.user?.username || 'Unknown',
            avatar: normalizeAvatarUrl(entry.user?.avatar),
            role: String(entry?.user?.role || 'user').trim() || 'user',
            vipTierLevel: Math.max(0, parseInt(entry?.user?.vipTierLevel, 10) || 0),
            vipTierCode: String(entry?.user?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(entry?.user?._id || ''))),
            collectedCount: Math.max(0, Number(entry.collectedCount || 0)),
            totalPokemon: Math.max(0, Number(entry.totalPokemon || 0)),
            completionPercent: normalizedTotalDexEntries > 0
                ? Math.round((Math.max(0, Number(entry.collectedCount || 0)) / normalizedTotalDexEntries) * 100)
                : 0,
        }))

        res.json({
            ok: true,
            mode: rankingMode,
            rankings,
            totalSpecies: normalizedTotalDexEntries,
            totalDexEntries: normalizedTotalDexEntries,
            pagination: {
                currentPage: page,
                totalPages,
                total: normalizedTotalUsers,
                totalUsers: normalizedTotalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/pokemon error:', error)
        next(error)
    }
})

export default router
