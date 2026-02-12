import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { calcStatsForLevel, calcMaxHp } from '../utils/gameUtils.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value
    const normalized = String(value || '').trim().toLowerCase()
    return ['1', 'true', 'yes', 'on'].includes(normalized)
}

// GET /api/pokemon - Public master list (lightweight)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 200 } = req.query
        const skip = (parseInt(page) - 1) * parseInt(limit)

        const [pokemon, total] = await Promise.all([
            Pokemon.find({})
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(parseInt(limit))
                .select('name pokedexNumber imageUrl sprites types rarity forms defaultFormId')
                .lean(),
            Pokemon.countDocuments(),
        ])

        res.json({
            ok: true,
            pokemon,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/pokemon/pokedex (protected)
router.get('/pokedex', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
        const skip = (page - 1) * limit

        const search = String(req.query.search || '').trim()
        const showIncomplete = toBoolean(req.query.incomplete)

        const userId = req.user.userId
        const ownedPokemonIds = await UserPokemon.distinct('pokemonId', { userId })
        const ownedSet = new Set(ownedPokemonIds.map((id) => id.toString()))

        const query = {}
        if (showIncomplete && ownedPokemonIds.length > 0) {
            query._id = { $nin: ownedPokemonIds }
        }

        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            const numericSearch = Number.parseInt(search, 10)
            if (Number.isFinite(numericSearch)) {
                query.$or = [
                    { pokedexNumber: numericSearch },
                    { name: searchRegex },
                ]
            } else {
                query.name = searchRegex
            }
        }

        const [pokemon, total, totalSpecies, ownedCount] = await Promise.all([
            Pokemon.find(query)
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(limit)
                .select('name pokedexNumber imageUrl sprites types')
                .lean(),
            Pokemon.countDocuments(query),
            Pokemon.countDocuments(),
            Pokemon.countDocuments({ _id: { $in: ownedPokemonIds } }),
        ])

        const rows = pokemon.map((entry) => ({
            _id: entry._id,
            pokedexNumber: entry.pokedexNumber,
            name: entry.name,
            types: Array.isArray(entry.types) ? entry.types : [],
            imageUrl: entry.imageUrl || '',
            sprite: entry.sprites?.icon || entry.sprites?.normal || entry.imageUrl || '',
            got: ownedSet.has(entry._id.toString()),
        }))

        const completionPercent = totalSpecies > 0 ? Math.round((ownedCount / totalSpecies) * 100) : 0

        res.json({
            ok: true,
            pokemon: rows,
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
            completion: {
                owned: ownedCount,
                total: totalSpecies,
                percent: completionPercent,
            },
            filters: {
                search,
                incomplete: showIncomplete,
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon/pokedex error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/pokemon/:id
// Publicly accessible or protected? Let's make it open so people can share links.
// But we might want to populate owner info which is safe.
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params

        const userPokemon = await UserPokemon.findById(id)
            .populate('pokemonId')
            .populate('userId', 'username _id') // Populating owner info
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        const basePokemon = userPokemon.pokemonId
        if (!basePokemon) {
            return res.status(404).json({ ok: false, message: 'Base Pokemon data missing' })
        }

        // Calculate actual stats based on level, rarity, (and potentially IVs/EVs in future)
        const level = userPokemon.level || 1
        const rarity = basePokemon.rarity

        // Base stats from species
        const stats = calcStatsForLevel(basePokemon.baseStats, level, rarity)
        const maxHp = calcMaxHp(basePokemon.baseStats?.hp, level, rarity)

        // Enhance response with calculated stats
        const responseData = {
            ...userPokemon,
            stats: {
                ...stats,
                maxHp,
                currentHp: maxHp // Assuming full health for display or retrieve from separate state if tracked
            },
            // Helper to show total wins/losses if we had them. 
            // Currently UserPokemon schema doesn't seem to track wins/losses directly?
            // Checking schema... it has 'firstCatcher', 'originalTrainer' etc.
        }

        res.json({
            ok: true,
            pokemon: responseData
        })

    } catch (error) {
        console.error('Get Pokemon Detail Error:', error)
        res.status(500).json({ ok: false, message: 'Server Error' })
    }
})

export default router
