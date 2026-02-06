import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import PlayerState from '../models/PlayerState.js'
import { emitPlayerState } from '../socket/index.js'
import Encounter from '../models/Encounter.js'
import UserPokemon from '../models/UserPokemon.js'
import MapProgress from '../models/MapProgress.js'
import MapModel from '../models/Map.js'

const router = express.Router()

const EXP_PER_SEARCH = 1
const expToNext = (level) => 250 + Math.max(0, level - 1) * 100

const RARITY_STAT_GAIN = {
    d: 1,
    c: 1,
    b: 2,
    a: 5,
    s: 10,
    ss: 20,
}

const RARITY_ALIASES = {
    superlegendary: 'ss',
    legendary: 's',
    ultra_rare: 'a',
    rare: 'b',
    uncommon: 'c',
    common: 'd',
}

const normalizeRarity = (rarity) => {
    const normalized = String(rarity || 'd').trim().toLowerCase()
    return RARITY_ALIASES[normalized] || normalized
}

const getRarityStatGain = (rarity) => RARITY_STAT_GAIN[normalizeRarity(rarity)] ?? 1

const calcStatsForLevel = (baseStats = {}, level = 1, rarity = 'd') => {
    const gain = getRarityStatGain(rarity)
    const step = Math.max(0, level - 1) * gain
    return {
        hp: Math.max(1, (baseStats.hp || 0) + step),
        atk: Math.max(1, (baseStats.atk || 0) + step),
        def: Math.max(1, (baseStats.def || 0) + step),
        spatk: Math.max(1, (baseStats.spatk || 0) + step),
        spdef: Math.max(1, (baseStats.spldef || 0) + step),
        spd: Math.max(1, (baseStats.spd || 0) + step),
    }
}

const calcMaxHp = (baseHp, level, rarity) => {
    const stats = calcStatsForLevel({ hp: baseHp }, level, rarity)
    return Math.max(10, Math.floor(stats.hp))
}

const rollDamage = (level) => {
    const base = Math.max(5, Math.floor(level * 0.6))
    return base + Math.floor(Math.random() * 6)
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

const formatMapProgress = (progress) => ({
    level: progress.level,
    exp: progress.exp,
    expToNext: expToNext(progress.level),
    totalSearches: progress.totalSearches,
})

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
        if (!isAdmin) {
            const requiredToUnlockNext = Math.max(0, map.requiredSearches || 0)
            if (mapProgress.totalSearches >= requiredToUnlockNext && mapIndex < orderedMaps.length - 1) {
                const nextMap = orderedMaps[mapIndex + 1]
                await ensureMapUnlocked(userId, nextMap._id)
            }
        }

        // 2. Fetch Drop Rates
        const DropRate = (await import('../models/DropRate.js')).default
        const dropRates = await DropRate.find({ mapId: map._id }).lean()

        if (dropRates.length === 0) {
            return res.json({
                ok: true,
                encountered: false,
                message: 'No pokemon in this area.',
                mapProgress: formatMapProgress(mapProgress),
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
            .select('name pokedexNumber sprites imageUrl types rarity baseStats catchRate')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        // End any previous active encounters for this user
        await Encounter.updateMany(
            { userId, isActive: true },
            { $set: { isActive: false, endedAt: new Date() } }
        )

        const level = Math.floor(Math.random() * (map.levelMax - map.levelMin + 1)) + map.levelMin
        const scaledStats = calcStatsForLevel(pokemon.baseStats, level, pokemon.rarity)
        const maxHp = calcMaxHp(pokemon.baseStats?.hp, level, pokemon.rarity)
        const hp = maxHp

        const encounter = await Encounter.create({
            userId,
            mapId: map._id,
            pokemonId: pokemon._id,
            level,
            hp,
            maxHp,
            isShiny: false,
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
                stats: scaledStats,
            },
            level,
            hp,
            maxHp,
            mapProgress: formatMapProgress(mapProgress),
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

        res.json({
            ok: true,
            mapProgress: formatMapProgress(progress),
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
                formId: 'normal',
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

export default router
