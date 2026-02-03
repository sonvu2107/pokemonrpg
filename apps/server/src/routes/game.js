import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import PlayerState from '../models/PlayerState.js'
import { emitPlayerState } from '../socket/index.js'
import Encounter from '../models/Encounter.js'
import UserPokemon from '../models/UserPokemon.js'
import MapProgress from '../models/MapProgress.js'

const router = express.Router()

const EXP_PER_SEARCH = 1
const expToNext = (level) => 250 + Math.max(0, level - 1) * 100

const calcMaxHp = (baseHp, level) => {
    const safeBase = Math.max(1, baseHp || 50)
    return Math.max(10, Math.floor(((safeBase * 2 * level) / 100) + level + 10))
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
        progress = await MapProgress.create({ userId, mapId })
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

        // 1. Validate Map
        const Map = (await import('../models/Map.js')).default
        const map = await Map.findOne({ slug: mapSlug })
        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        const mapProgress = await updateMapProgress(userId, map._id)

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
        const maxHp = calcMaxHp(pokemon.baseStats?.hp, level)
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
            pokemon: pokemon,
            level,
            hp,
            maxHp,
            mapProgress: formatMapProgress(mapProgress),
        })

    } catch (error) {
        next(error)
    }
})

// GET /api/game/map/:slug/state (protected)
router.get('/map/:slug/state', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const Map = (await import('../models/Map.js')).default
        const map = await Map.findOne({ slug: req.params.slug })

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        let progress = await MapProgress.findOne({ userId, mapId: map._id })
        if (!progress) {
            progress = await MapProgress.create({ userId, mapId: map._id })
        }

        res.json({ ok: true, mapProgress: formatMapProgress(progress) })
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
