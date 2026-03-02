import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
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



const rollDamage = (level) => {
    const base = Math.max(5, Math.floor(level * 0.6))
    return base + Math.floor(Math.random() * 6)
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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

const calcBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat }) => {
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const randomFactor = 0.85 + Math.random() * 0.15
    return Math.max(1, Math.floor(base * randomFactor))
}

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
        .map(m => m.moveName || '')
        .filter(Boolean)
    return learned.slice(-4)
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

const resolveTrainerBattleForm = (pokemon, formId) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = String(pokemon?.defaultFormId || 'normal').trim() || 'normal'
    let resolvedFormId = String(formId || defaultFormId).trim() || defaultFormId
    let form = forms.find((entry) => String(entry?.formId || '').trim() === resolvedFormId) || null
    if (!form && forms.length > 0) {
        resolvedFormId = defaultFormId || String(forms[0]?.formId || 'normal').trim() || 'normal'
        form = forms.find((entry) => String(entry?.formId || '').trim() === resolvedFormId) || forms[0]
    }
    return { form, formId: resolvedFormId }
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
            return {
                slot: index,
                pokemonId: pokemon._id,
                name: pokemon.name || 'Pokemon',
                level,
                formId,
                baseStats: scaledStats,
                currentHp: maxHp,
                maxHp,
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

const buildUnlockRequirement = (maps, index, progressById, playerLevel = 1) => {
    const currentMap = maps[index] || null
    const currentPlayerLevel = Math.max(1, Number(playerLevel) || 1)
    const requiredPlayerLevel = Math.max(1, Number(currentMap?.requiredPlayerLevel) || 1)
    const remainingPlayerLevels = Math.max(0, requiredPlayerLevel - currentPlayerLevel)

    if (index <= 0) {
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

    const sourceMap = maps[index - 1]
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
                gold: playerState.gold,
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
            if (mapIndex > 0) {
                const sourceMapId = orderedMaps[mapIndex - 1]._id
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
            const requiredToUnlockNext = Math.max(0, map.requiredSearches || 0)
            if (mapProgress.totalSearches >= requiredToUnlockNext && mapIndex < orderedMaps.length - 1) {
                const nextMap = orderedMaps[mapIndex + 1]
                await ensureMapUnlocked(userId, nextMap._id)
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

        const defaultFormId = pokemon.defaultFormId || 'normal'
        let formId = selectedFormId || defaultFormId
        const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
        let resolvedForm = forms.find((form) => form.formId === formId) || null
        if (!resolvedForm && forms.length > 0) {
            formId = defaultFormId || forms[0].formId
            resolvedForm = forms.find((form) => form.formId === formId) || forms[0]
        }
        const formStats = resolvedForm?.stats || null
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const baseStats = formStats || pokemon.baseStats

        const level = Math.floor(Math.random() * (map.levelMax - map.levelMin + 1)) + map.levelMin
        const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
        const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)
        const hp = maxHp

        const encounter = await Encounter.create({
            userId,
            mapId: map._id,
            pokemonId: pokemon._id,
            level,
            hp,
            maxHp,
            isShiny: false,
            formId,
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
            gold: playerState?.gold || 0,
            moonPoints: playerState?.moonPoints || 0,
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
        if (mapIndex > 0) {
            const sourceMapId = orderedMaps[mapIndex - 1]._id
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
                gold: currentPlayerState.gold || 0,
                moonPoints: currentPlayerState.moonPoints || 0,
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

        const damage = rollDamage(encounter.level)
        encounter.hp = Math.max(0, encounter.hp - damage)

        if (encounter.hp <= 0) {
            encounter.isActive = false
            encounter.endedAt = new Date()
        }

        await encounter.save()

        res.json({
            ok: true,
            encounterId: encounter._id,
            damage,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            defeated: !encounter.isActive,
            message: encounter.isActive ? `Gây ${damage} sát thương!` : 'Pokemon hoang dã đã bị hạ!'
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
            .select('name pokedexNumber baseStats catchRate levelUpMoves')
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
            await UserPokemon.create({
                userId,
                pokemonId: encounter.pokemonId,
                level: encounter.level,
                experience: 0,
                moves,
                formId: encounter.formId || 'normal',
                isShiny: encounter.isShiny,
                location: 'box',
            })

            return res.json({
                ok: true,
                caught: true,
                encounterId: resolvedEncounter._id,
                hp: resolvedEncounter.hp,
                maxHp: resolvedEncounter.maxHp,
                message: `Đã bắt được ${pokemon.name}!`,
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
            player = {},
            trainerId = null,
            activePokemonId = null,
        } = req.body || {}

        const normalizedTrainerId = String(trainerId || '').trim()
        const normalizedActivePokemonId = String(activePokemonId || '').trim()

        const party = await UserPokemon.find({ userId, location: 'party' })
            .select('pokemonId level moves nickname formId partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'name baseStats rarity forms defaultFormId')

        const activePokemon = normalizedActivePokemonId
            ? (party.find((entry) => String(entry?._id || '') === normalizedActivePokemonId) || null)
            : (party.find(Boolean) || null)
        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon đang hoạt động trong đội hình' })
        }

        const knownMoves = Array.isArray(activePokemon.moves)
            ? activePokemon.moves.map((item) => String(item || '').trim()).filter(Boolean)
            : []
        const normalizedKnownMoves = new Set(knownMoves.map((item) => normalizeMoveName(item)))

        let selectedMoveName = String(moveName || move?.name || knownMoves[0] || 'Struggle').trim()
        if (!selectedMoveName) selectedMoveName = 'Struggle'

        const selectedMoveKey = normalizeMoveName(selectedMoveName)
        if (knownMoves.length > 0 && !normalizedKnownMoves.has(selectedMoveKey)) {
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

        let mpCost = Number(move?.mp)
        if (!Number.isFinite(mpCost) || mpCost < 0) {
            const fromPp = Number(moveDoc?.pp)
            mpCost = Number.isFinite(fromPp) && fromPp > 0
                ? clamp(Math.floor(fromPp / 2), 1, 20)
                : clamp(Math.floor(resolvedPower / 15), 1, 20)
        }
        if (normalizeMoveName(selectedMoveName) === 'struggle') {
            mpCost = 0
        }

        let playerState = await PlayerState.findOneAndUpdate(
            { userId },
            { $setOnInsert: { userId } },
            { new: true, upsert: true }
        )

        if (mpCost > 0) {
            const mpUpdatedState = await PlayerState.findOneAndUpdate(
                {
                    userId,
                    mp: { $gte: mpCost },
                },
                {
                    $inc: { mp: -mpCost },
                },
                { new: true }
            )

            if (mpUpdatedState) {
                playerState = mpUpdatedState
                emitPlayerState(userId.toString(), playerState)
            } else {
                selectedMoveName = 'Struggle'
                resolvedPower = 35
                mpCost = 0
                playerState = await PlayerState.findOneAndUpdate(
                    { userId },
                    { $setOnInsert: { userId } },
                    { new: true, upsert: true }
                )
            }
        }

        const attackerLevel = Math.max(1, Number(activePokemon.level) || 1)
        const attackerSpecies = activePokemon?.pokemonId || {}
        const attackerBaseStats = attackerSpecies.baseStats || {}
        const attackerScaledStats = calcStatsForLevel(attackerBaseStats, attackerLevel, attackerSpecies.rarity)
        const attackerAtk = Math.max(
            1,
            Number(attackerScaledStats?.atk) ||
            Number(attackerScaledStats?.spatk) ||
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

        let targetName = String(opponent.name || 'Opponent Pokemon')
        let targetLevel = Math.max(1, Number(opponent.level) || 1)
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
        let targetDef = Math.max(
            1,
            Number(opponent.baseStats?.def) ||
            getSpecialDefenseStat(opponent.baseStats) ||
            (20 + targetLevel * 2)
        )

        let trainerSession = null
        let activeOpponentIndex = -1
        let activeTrainerOpponent = null
        let trainerSessionDirty = false

        if (normalizedTrainerId) {
            const trainer = await BattleTrainer.findById(normalizedTrainerId)
                .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId')
                .lean()

            if (!trainer) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên battle' })
            }

            trainerSession = await getOrCreateTrainerBattleSession(userId, normalizedTrainerId, trainer)

            const activePokemonIdString = String(activePokemon._id)
            if (String(trainerSession.playerPokemonId || '') !== activePokemonIdString) {
                trainerSession.playerPokemonId = activePokemon._id
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = playerMaxHp
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
            targetName = activeTrainerOpponent.name || targetName
            targetLevel = Math.max(1, Number(activeTrainerOpponent.level) || targetLevel)
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
            targetDef = Math.max(
                1,
                Number(activeTrainerOpponent.baseStats?.def) ||
                getSpecialDefenseStat(activeTrainerOpponent.baseStats) ||
                (20 + targetLevel * 2)
            )

            if (playerCurrentHp <= 0) {
                return res.status(400).json({ ok: false, message: 'Pokemon của bạn đã bại trận. Hãy đổi Pokemon hoặc bắt đầu lại trận đấu.' })
            }
        }

        const damage = calcBattleDamage({
            attackerLevel,
            movePower: resolvedPower,
            attackStat: attackerAtk,
            defenseStat: targetDef,
        })
        const currentHp = Math.max(0, targetCurrentHp - damage)

        if (activeTrainerOpponent) {
            const didDefeatOpponent = targetCurrentHp > 0 && currentHp <= 0
            activeTrainerOpponent.currentHp = currentHp
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
            trainerSession.expiresAt = getBattleSessionExpiryDate()
            trainerSessionDirty = true
        }

        let counterAttack = null
        let resultingPlayerHp = playerCurrentHp
        if (currentHp > 0) {
            const opponentMovePower = clamp(Math.floor(35 + targetLevel * 1.2), 25, 120)
            const counterDamage = calcBattleDamage({
                attackerLevel: targetLevel,
                movePower: opponentMovePower,
                attackStat: targetAtk,
                defenseStat: playerDef,
            })
            const nextPlayerHp = Math.max(0, playerCurrentHp - counterDamage)
            resultingPlayerHp = nextPlayerHp

            if (trainerSession) {
                trainerSession.playerCurrentHp = nextPlayerHp
                trainerSession.expiresAt = getBattleSessionExpiryDate()
                trainerSessionDirty = true
            }

            counterAttack = {
                damage: counterDamage,
                currentHp: nextPlayerHp,
                maxHp: playerMaxHp,
                defeatedPlayer: nextPlayerHp <= 0,
                move: {
                    name: 'Counter Strike',
                    type: 'normal',
                    power: opponentMovePower,
                    mp: 0,
                },
                log: `${targetName} retaliated for ${counterDamage} damage.`,
            }
        }

        if (trainerSessionDirty && trainerSession) {
            await trainerSession.save()
        }

        const trainerState = normalizedTrainerId && trainerSession
            ? {
                trainerId: normalizedTrainerId,
                currentIndex: trainerSession.currentIndex,
                defeatedAll: trainerSession.currentIndex >= trainerSession.team.length,
                team: trainerSession.team.map((entry) => ({
                    slot: entry.slot,
                    pokemonId: entry.pokemonId,
                    name: entry.name,
                    level: entry.level,
                    currentHp: entry.currentHp,
                    maxHp: entry.maxHp,
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
                    type: moveDoc?.type || inferMoveType(selectedMoveName),
                    power: resolvedPower,
                    mp: mpCost,
                },
                player: {
                    id: activePokemon._id,
                    name: activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon',
                    mp: playerState.mp,
                    maxMp: playerState.maxMp,
                    currentHp: resultingPlayerHp,
                    maxHp: playerMaxHp,
                },
                opponent: trainerState,
                counterAttack,
                log: `${activePokemon.nickname || activePokemon?.pokemonId?.name || 'Your Pokemon'} used ${selectedMoveName}! ${damage} damage.`,
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
        let trainerPrizeItem = null
        let trainerPrizeItemQuantity = 0
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
            trainerPrizeItem = trainer.prizeItemId || null
            trainerPrizeItemQuantity = Math.max(1, Number(trainer.prizeItemQuantity) || 1)
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
        const moonPointsAwarded = trainerMoonPointsReward > 0
            ? Math.floor(trainerMoonPointsReward)
            : defaultScaledReward
        const happinessAwarded = 13

        const party = await UserPokemon.find({ userId, location: 'party' })
            .select('pokemonId level experience friendship nickname formId partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'rarity name imageUrl sprites')
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

            participantPokemon.experience += finalExp
            let levelsGained = 0
            while (participantPokemon.experience >= participantPokemon.level * 100) {
                participantPokemon.experience -= participantPokemon.level * 100
                participantPokemon.level += 1
                levelsGained += 1
            }

            participantPokemon.friendship = Math.min(255, (participantPokemon.friendship || 0) + happinessAwarded)
            const evolutions = levelsGained > 0 ? await applyLevelEvolution(participantPokemon) : []

            await participantPokemon.save()
            await participantPokemon.populate('pokemonId', 'rarity name imageUrl sprites')

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
                imageUrl: participantPokemon.pokemonId?.imageUrl ||
                    participantPokemon.pokemonId?.sprites?.normal ||
                    participantPokemon.pokemonId?.sprites?.front_default ||
                    '',
                level: participantPokemon.level,
                exp: participantPokemon.experience,
                expToNext: participantPokemon.level * 100,
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
                imageUrl: activePokemon.pokemonId?.imageUrl ||
                    activePokemon.pokemonId?.sprites?.normal ||
                    activePokemon.pokemonId?.sprites?.front_default ||
                    '',
                level: activePokemon.level,
                exp: activePokemon.experience,
                expToNext: activePokemon.level * 100,
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
                    const prizeLevel = Math.max(5, Math.floor(totalLevel / Math.max(1, sourceTeam.length)))
                    const moves = buildMovesForLevel(prizeData, prizeLevel)
                    await UserPokemon.create({
                        userId,
                        pokemonId: trainerPrizePokemonId,
                        level: prizeLevel,
                        experience: 0,
                        moves,
                        formId: resolvedPrizeFormId,
                        isShiny: false,
                        location: 'box',
                        originalTrainer: trainerRewardMarker,
                    })
                }

                prizePokemon = {
                    id: trainerPrizePokemonId,
                    name: prizeData.name,
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

        const defaultFormId = pokemon.defaultFormId || 'normal'
        let formId = encounter.formId || defaultFormId
        const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
        let resolvedForm = forms.find((form) => form.formId === formId) || null
        if (!resolvedForm && forms.length > 0) {
            formId = defaultFormId || forms[0].formId
            resolvedForm = forms.find((form) => form.formId === formId) || forms[0]
        }
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

export default router
