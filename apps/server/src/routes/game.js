import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import PlayerState from '../models/PlayerState.js'
import { emitPlayerState } from '../socket/index.js'
import Encounter from '../models/Encounter.js'
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
    const normalizedFormId = String(currentFormId || '').trim()
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const form = forms.find((entry) => String(entry?.formId || '').trim() === normalizedFormId) || null
    const formEvolution = form?.evolution || null
    if (formEvolution?.evolvesTo) return formEvolution
    return species?.evolution || null
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
        const minLevel = Number.parseInt(rule?.minLevel, 10)
        if (!rule?.evolvesTo || !Number.isFinite(minLevel) || minLevel < 1 || userPokemon.level < minLevel) {
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
        const currentFormId = String(userPokemon.formId || '').trim()
        const canKeepForm = currentFormId && nextForms.some((form) => String(form?.formId || '').trim() === currentFormId)
        const nextFormId = canKeepForm
            ? currentFormId
            : (String(nextSpecies.defaultFormId || '').trim() || 'normal')

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
            currentIndex: 0,
            expiresAt,
        })
    }

    const isActive = session.expiresAt && session.expiresAt > now && Array.isArray(session.team) && session.team.length > 0
    if (!isActive) {
        session.team = buildTrainerBattleTeam(trainer)
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

    throw new Error('Failed to update map progress due to concurrent updates')
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

    throw new Error('Failed to update player level due to concurrent updates')
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
    const searchableKeys = ['searches', 'mapExp', 'moonPoints']
    const $inc = {}

    searchableKeys.forEach((key) => {
        const value = Number(increments[key])
        if (Number.isFinite(value) && value > 0) {
            $inc[key] = Math.floor(value)
        }
    })

    if (Object.keys($inc).length === 0) {
        return
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
}

const getOrderedMaps = getOrderedMapsCached

const buildProgressIndex = (progresses) => {
    const byId = new Map()
    progresses.forEach((progress) => {
        byId.set(progress.mapId.toString(), progress)
    })
    return byId
}

const buildUnlockRequirement = (maps, index, progressById) => {
    if (index <= 0) {
        return {
            requiredSearches: 0,
            currentSearches: 0,
            remainingSearches: 0,
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
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((m) => m._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Map not found in progression order' })
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
            const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById)
            const isUnlocked = mapIndex === 0 || unlockRequirement.remainingSearches === 0
            if (!isUnlocked) {
                return res.status(403).json({
                    ok: false,
                    locked: true,
                    message: 'Map is locked',
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

        // 4. Populate Pokemon Details for response
        const pokemon = await Pokemon.findById(selectedDrop.pokemonId)
            .select('name pokedexNumber sprites imageUrl types rarity baseStats catchRate forms defaultFormId')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        // End any previous active encounters for this user
        await Encounter.updateMany(
            { userId, isActive: true },
            { $set: { isActive: false, endedAt: new Date() } }
        )

        const defaultFormId = pokemon.defaultFormId || 'normal'
        let formId = selectedDrop.formId || defaultFormId
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
        const progresses = await MapProgress.find({ userId, mapId: { $in: mapIds } })
            .select('mapId totalSearches isUnlocked')
            .lean()
        const progressById = buildProgressIndex(progresses)

        const mapsWithUnlockState = orderedMaps.map((map, index) => {
            const unlockRequirement = buildUnlockRequirement(orderedMaps, index, progressById)
            const isUnlocked = isAdmin || index === 0 || unlockRequirement.remainingSearches === 0
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
            .select('gold moonPoints')
            .lean()
        const playerCurrencyState = {
            gold: playerState?.gold || 0,
            moonPoints: playerState?.moonPoints || 0,
        }
        const map = await MapModel.findOne({ slug: req.params.slug })

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((m) => m._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Map not found in progression order' })
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
        const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById)
        const isUnlocked = isAdmin || mapIndex === 0 || unlockRequirement.remainingSearches === 0

        if (!isUnlocked) {
            return res.status(403).json({
                ok: false,
                locked: true,
                message: 'Map is locked',
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
            },
            unlock: {
                requiredSearches: Math.max(0, map.requiredSearches || 0),
                currentSearches: progress.totalSearches,
                remainingSearches: Math.max(0, (map.requiredSearches || 0) - progress.totalSearches),
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
            return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
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
            return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
        }

        const pokemon = await Pokemon.findById(encounter.pokemonId)
            .select('name pokedexNumber baseStats catchRate levelUpMoves')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
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
                return res.status(409).json({ ok: false, message: 'Encounter already resolved. Please refresh.' })
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
            return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
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
            return res.status(400).json({ ok: false, message: 'No active pokemon in party' })
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
        const { form: attackerForm } = resolveTrainerBattleForm(attackerSpecies, activePokemon.formId)
        const attackerBaseStats = attackerForm?.stats || attackerSpecies.baseStats || {}
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
                return res.status(404).json({ ok: false, message: 'Battle trainer not found' })
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
            if (storedPlayerMaxHp !== playerMaxHp) {
                const currentRatio = Math.min(1, Math.max(0, (Number(trainerSession.playerCurrentHp) || storedPlayerMaxHp) / storedPlayerMaxHp))
                trainerSession.playerMaxHp = playerMaxHp
                trainerSession.playerCurrentHp = clamp(Math.floor(playerMaxHp * currentRatio), 0, playerMaxHp)
                trainerSessionDirty = true
            }
            playerCurrentHp = clamp(
                Math.floor(Number(trainerSession.playerCurrentHp) || playerMaxHp),
                0,
                playerMaxHp
            )

            activeOpponentIndex = getAliveOpponentIndex(trainerSession.team, trainerSession.currentIndex)
            trainerSession.currentIndex = activeOpponentIndex === -1 ? trainerSession.team.length : activeOpponentIndex
            if (activeOpponentIndex === -1) {
                return res.status(400).json({ ok: false, message: 'Trainer team has already been defeated. Resolve the battle now.' })
            }

            activeTrainerOpponent = trainerSession.team[activeOpponentIndex]
            targetName = activeTrainerOpponent.name || targetName
            targetLevel = Math.max(1, Number(activeTrainerOpponent.level) || targetLevel)
            targetMaxHp = Math.max(1, Number(activeTrainerOpponent.maxHp) || targetMaxHp)
            targetCurrentHp = clamp(Math.floor(Number(activeTrainerOpponent.currentHp) || targetMaxHp), 0, targetMaxHp)
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
        }

        const damage = calcBattleDamage({
            attackerLevel,
            movePower: resolvedPower,
            attackStat: attackerAtk,
            defenseStat: targetDef,
        })
        const currentHp = Math.max(0, targetCurrentHp - damage)

        if (activeTrainerOpponent) {
            activeTrainerOpponent.currentHp = currentHp
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
            return res.status(400).json({ ok: false, message: 'trainerId is required for battle resolve' })
        }

        let sourceTeam = []
        let trainerRewardCoins = 0
        let trainerExpReward = 0
        let trainerPrizePokemonId = null
        let trainerRewardMarker = ''

        if (normalizedTrainerId) {
            const trainer = await BattleTrainer.findById(normalizedTrainerId)
                .populate('prizePokemonId', 'name imageUrl sprites')
                .lean()
            if (!trainer) {
                return res.status(404).json({ ok: false, message: 'Battle trainer not found' })
            }

            const activeSession = await BattleSession.findOne({
                userId,
                trainerId: normalizedTrainerId,
                expiresAt: { $gt: new Date() },
            })
                .select('currentIndex team')
                .lean()
            if (!activeSession || !Array.isArray(activeSession.team) || activeSession.team.length === 0) {
                return res.status(400).json({ ok: false, message: 'Battle session not found. Please start the fight first.' })
            }
            if (activeSession.currentIndex < activeSession.team.length) {
                return res.status(400).json({ ok: false, message: 'Battle is not finished yet. Defeat all opponent Pokemon first.' })
            }

            const claimedSession = await BattleSession.findOneAndDelete({
                _id: activeSession._id,
                userId,
                trainerId: normalizedTrainerId,
                expiresAt: { $gt: new Date() },
            })
            if (!claimedSession) {
                return res.status(409).json({ ok: false, message: 'Battle rewards already claimed. Please start a new battle.' })
            }

            if (Array.isArray(trainer.team) && trainer.team.length > 0) {
                sourceTeam = trainer.team
            }
            trainerRewardCoins = Math.max(0, Number(trainer.platinumCoinsReward) || 0)
            trainerExpReward = Math.max(0, Number(trainer.expReward) || 0)
            trainerPrizePokemonId = trainer.prizePokemonId?._id || null
            trainerRewardMarker = `battle_trainer_reward:${trainer._id}`
        }

        if (!Array.isArray(sourceTeam) || sourceTeam.length === 0) {
            return res.status(400).json({ ok: false, message: 'Opponent team is required' })
        }

        const totalLevel = sourceTeam.reduce((sum, mon) => sum + (Number(mon.level) || 1), 0)
        const coinsAwarded = trainerRewardCoins > 0
            ? Math.floor(trainerRewardCoins)
            : Math.max(1, Math.floor(totalLevel * 5))
        const expAwarded = trainerExpReward > 0
            ? Math.floor(trainerExpReward)
            : Math.max(1, Math.floor(totalLevel * 20))
        const happinessAwarded = 13

        const party = await UserPokemon.find({ userId, location: 'party' })
            .select('pokemonId level experience friendship nickname formId partyIndex')
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'rarity name imageUrl sprites')
        const activePokemon = party.find(p => p) || null

        if (!activePokemon) {
            return res.status(400).json({ ok: false, message: 'No active pokemon in party' })
        }

        // Apply rarity exp multiplier (SSS gets 1.5x exp)
        const pokemonRarity = activePokemon.pokemonId?.rarity || 'd'
        const expMultiplier = getRarityExpMultiplier(pokemonRarity)
        const finalExp = Math.floor(expAwarded * expMultiplier)

        activePokemon.experience += finalExp
        let levelsGained = 0
        while (activePokemon.experience >= activePokemon.level * 100) {
            activePokemon.experience -= activePokemon.level * 100
            activePokemon.level += 1
            levelsGained += 1
        }
        activePokemon.friendship = Math.min(255, (activePokemon.friendship || 0) + happinessAwarded)
        const evolutions = levelsGained > 0 ? await applyLevelEvolution(activePokemon) : []
        await activePokemon.save()
        await activePokemon.populate('pokemonId', 'rarity name imageUrl sprites')

        const previousPlayerState = await PlayerState.findOne({ userId })
            .select('moonPoints')
            .lean()
        const moonPointsBefore = previousPlayerState?.moonPoints || 0

        const playerState = await PlayerState.findOneAndUpdate(
            { userId },
            {
                $setOnInsert: { userId },
                $inc: {
                    gold: coinsAwarded,
                    experience: Math.floor(expAwarded / 2),
                    wins: 1,
                },
            },
            { new: true, upsert: true }
        )
        const moonPointsGained = Math.max(0, (playerState.moonPoints || 0) - moonPointsBefore)
        if (moonPointsGained > 0) {
            await trackDailyActivity(userId, { moonPoints: moonPointsGained })
        }
        emitPlayerState(userId.toString(), playerState)

        let prizePokemon = null
        if (trainerPrizePokemonId && trainerRewardMarker) {
            const prizeData = await Pokemon.findById(trainerPrizePokemonId)
                .select('name imageUrl sprites levelUpMoves')
                .lean()

            if (prizeData) {
                const alreadyClaimedPrize = await UserPokemon.exists({
                    userId,
                    pokemonId: trainerPrizePokemonId,
                    originalTrainer: trainerRewardMarker,
                })

                if (!alreadyClaimedPrize) {
                    const prizeLevel = Math.max(5, Math.floor(totalLevel / Math.max(1, sourceTeam.length)))
                    const moves = buildMovesForLevel(prizeData, prizeLevel)
                    await UserPokemon.create({
                        userId,
                        pokemonId: trainerPrizePokemonId,
                        level: prizeLevel,
                        experience: 0,
                        moves,
                        formId: 'normal',
                        isShiny: false,
                        location: 'box',
                        originalTrainer: trainerRewardMarker,
                    })
                }

                prizePokemon = {
                    id: trainerPrizePokemonId,
                    name: prizeData.name,
                    imageUrl: prizeData.imageUrl || prizeData.sprites?.normal || prizeData.sprites?.front_default || '',
                    claimed: !alreadyClaimedPrize,
                    alreadyClaimed: Boolean(alreadyClaimedPrize),
                }
            }
        }

        res.json({
            ok: true,
            results: {
                pokemon: {
                    name: activePokemon.nickname || activePokemon.pokemonId?.name || 'Pokemon',
                    imageUrl: activePokemon.pokemonId?.imageUrl ||
                        activePokemon.pokemonId?.sprites?.normal ||
                        activePokemon.pokemonId?.sprites?.front_default ||
                        '',
                    level: activePokemon.level,
                    exp: activePokemon.experience,
                    expToNext: activePokemon.level * 100,
                    levelsGained,
                    happiness: activePokemon.friendship,
                    happinessGained: happinessAwarded,
                },
                rewards: {
                    coins: coinsAwarded,
                    trainerExp: Math.floor(expAwarded / 2),
                    prizePokemon,
                },
                evolution: {
                    evolved: evolutions.length > 0,
                    chain: evolutions,
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
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
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
