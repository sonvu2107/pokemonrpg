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
import DailyActivity from '../models/DailyActivity.js'

const router = express.Router()

import {
    EXP_PER_SEARCH,
    expToNext,
    calcStatsForLevel,
    calcMaxHp,
    getRarityExpMultiplier,
} from '../utils/gameUtils.js'



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

const updateMapProgress = async (userId, mapId) => {
    let progress = await MapProgress.findOne({ userId, mapId })
    if (!progress) {
        progress = await MapProgress.create({
            userId,
            mapId,
            isUnlocked: true,
            unlockedAt: new Date(),
        })
    } else if (!progress.isUnlocked) {
        progress.isUnlocked = true
        progress.unlockedAt = progress.unlockedAt || new Date()
    }

    progress.totalSearches += 1
    progress.exp += EXP_PER_SEARCH
    progress.lastSearchedAt = new Date()

    while (progress.exp >= expToNext(progress.level)) {
        progress.exp -= expToNext(progress.level)
        progress.level += 1
    }

    await progress.save()
    return progress
}

const updatePlayerLevel = async (userId) => {
    let playerState = await PlayerState.findOne({ userId })
    if (!playerState) {
        playerState = await PlayerState.create({ userId })
    }

    // Grant EXP for map search
    playerState.experience += EXP_PER_SEARCH

    // Level up if enough EXP
    let leveledUp = false
    let levelsGained = 0
    while (playerState.experience >= expToNext(playerState.level)) {
        playerState.experience -= expToNext(playerState.level)
        playerState.level += 1
        levelsGained += 1
        leveledUp = true
    }

    await playerState.save()
    return { playerState, leveledUp, levelsGained }
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

const getOrderedMaps = async () => {
    return MapModel.find({})
        .select('name slug levelMin levelMax isLegendary iconId requiredSearches orderIndex')
        .sort({ orderIndex: 1, createdAt: 1, _id: 1 })
        .lean()
}

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

// POST /api/game/click (protected)
router.post('/click', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId

        // Find or create player state
        let playerState = await PlayerState.findOne({ userId })
        if (!playerState) {
            playerState = await PlayerState.create({ userId })
        }

        // Increment gold and clicks
        playerState.gold += 10 // +10 gold per click
        playerState.clicks += 1

        await playerState.save()

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

        const ItemDropRate = (await import('../models/ItemDropRate.js')).default
        const DropRate = (await import('../models/DropRate.js')).default

        const [dropRates, itemDropRates] = await Promise.all([
            DropRate.find({ mapId: map._id }).lean(),
            ItemDropRate.find({ mapId: map._id }).populate('itemId').lean(),
        ])

        const itemDropRate = typeof map.itemDropRate === 'number' ? map.itemDropRate : 0
        const shouldDropItem = itemDropRates.length > 0 && Math.random() < itemDropRate
        let droppedItem = null

        if (shouldDropItem) {
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
        const Pokemon = (await import('../models/Pokemon.js')).default
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
        const progressById = buildProgressIndex(progresses)

        const response = []
        for (let i = 0; i < orderedMaps.length; i += 1) {
            const map = orderedMaps[i]
            const unlockRequirement = buildUnlockRequirement(orderedMaps, i, progressById)
            const isUnlocked = isAdmin || i === 0 || unlockRequirement.remainingSearches === 0

            if (!isAdmin && isUnlocked) {
                const existing = progressById.get(map._id.toString())
                if (!existing || !existing.isUnlocked) {
                    const updated = await ensureMapUnlocked(userId, map._id)
                    progressById.set(map._id.toString(), updated)
                }
            }

            const progress = progressById.get(map._id.toString())
            response.push({
                ...map,
                isUnlocked,
                unlockRequirement,
                progress: {
                    totalSearches: progress?.totalSearches || 0,
                },
            })
        }

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

        let progress = await MapProgress.findOne({ userId, mapId: map._id })
        if (!progress) {
            progress = await MapProgress.create({
                userId,
                mapId: map._id,
                isUnlocked: true,
                unlockedAt: new Date(),
            })
        } else if (!progress.isUnlocked) {
            progress.isUnlocked = true
            progress.unlockedAt = progress.unlockedAt || new Date()
            await progress.save()
        }

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

        if (!encounter) {
            return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
        }

        const Pokemon = (await import('../models/Pokemon.js')).default
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

            encounter.isActive = false
            encounter.endedAt = new Date()
            await encounter.save()
        }

        res.json({
            ok: true,
            caught,
            encounterId: encounter._id,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            message: caught ? `Đã bắt được ${pokemon.name}!` : 'Pokemon đã thoát khỏi bóng!'
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
        } = req.body || {}

        const party = await UserPokemon.find({ userId, location: 'party' })
            .sort({ partyIndex: 1 })
            .populate('pokemonId', 'name baseStats')

        const activePokemon = party.find(Boolean) || null
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

        let playerState = await PlayerState.findOne({ userId })
        if (!playerState) {
            playerState = await PlayerState.create({ userId })
        }

        // If not enough MP, force Struggle (0 MP) to keep battle flow uninterrupted.
        if ((playerState.mp || 0) < mpCost) {
            selectedMoveName = 'Struggle'
            resolvedPower = 35
            mpCost = 0
        }

        if (mpCost > 0) {
            playerState.mp = Math.max(0, (playerState.mp || 0) - mpCost)
            await playerState.save()
            emitPlayerState(userId.toString(), playerState)
        }

        const targetLevel = Math.max(1, Number(opponent.level) || 1)
        const targetMaxHp = Math.max(1, Number(opponent.maxHp) || 1)
        const parsedCurrentHp = Number(opponent.currentHp)
        const targetCurrentHp = clamp(
            Math.floor(Number.isFinite(parsedCurrentHp) ? parsedCurrentHp : targetMaxHp),
            0,
            targetMaxHp
        )
        const targetDef = Math.max(
            1,
            Number(opponent.baseStats?.def) ||
            Number(opponent.baseStats?.spdef) ||
            (20 + targetLevel * 2)
        )

        const attackerLevel = Math.max(1, Number(activePokemon.level) || 1)
        const attackerAtk = Math.max(
            1,
            Number(activePokemon?.pokemonId?.baseStats?.atk) ||
            Number(activePokemon?.pokemonId?.baseStats?.spatk) ||
            (20 + attackerLevel * 2)
        )

        const damage = calcBattleDamage({
            attackerLevel,
            movePower: resolvedPower,
            attackStat: attackerAtk,
            defenseStat: targetDef,
        })
        const currentHp = Math.max(0, targetCurrentHp - damage)

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
                    name: activePokemon.nickname || activePokemon?.pokemonId?.name || 'Pokemon',
                    mp: playerState.mp,
                    maxMp: playerState.maxMp,
                },
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
        const { opponentTeam = [], trainerId = null } = req.body

        let sourceTeam = Array.isArray(opponentTeam) ? opponentTeam : []
        let trainerRewardCoins = 0
        let trainerExpReward = 0
        let trainerPrizePokemonId = null
        let trainerRewardMarker = ''

        if (trainerId) {
            const trainer = await BattleTrainer.findById(trainerId)
                .populate('prizePokemonId', 'name imageUrl sprites')
                .lean()
            if (!trainer) {
                return res.status(404).json({ ok: false, message: 'Battle trainer not found' })
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
        await activePokemon.save()

        let playerState = await PlayerState.findOne({ userId })
        if (!playerState) {
            playerState = await PlayerState.create({ userId })
        }
        const moonPointsBefore = playerState.moonPoints || 0
        playerState.gold += coinsAwarded
        playerState.experience += Math.floor(expAwarded / 2)
        playerState.wins += 1
        await playerState.save()
        const moonPointsGained = Math.max(0, (playerState.moonPoints || 0) - moonPointsBefore)
        if (moonPointsGained > 0) {
            await trackDailyActivity(userId, { moonPoints: moonPointsGained })
        }
        emitPlayerState(userId.toString(), playerState)

        let prizePokemon = null
        if (trainerPrizePokemonId && trainerRewardMarker) {
            const Pokemon = (await import('../models/Pokemon.js')).default
            const prizeData = await Pokemon.findById(trainerPrizePokemonId)
                .select('name imageUrl sprites levelUpMoves')
                .lean()

            if (prizeData) {
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

                prizePokemon = {
                    id: trainerPrizePokemonId,
                    name: prizeData.name,
                    imageUrl: prizeData.imageUrl || prizeData.sprites?.normal || prizeData.sprites?.front_default || '',
                    claimed: true,
                    alreadyClaimed: false,
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

        const Pokemon = (await import('../models/Pokemon.js')).default
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
