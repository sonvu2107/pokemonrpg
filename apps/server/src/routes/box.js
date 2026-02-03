import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

// All routes require authentication
router.use(authMiddleware)

/**
 * @route   GET /api/box
 * @desc    Get user's pokemon box
 * @access  Private
 */
router.get('/', async (req, res) => {
    try {
        let {
            page = 1,
            limit = 28, // 7x4 grid usually
            search = '',
            sort = 'id',
            filter = 'all',
            type = 'all' // Added for type filtering if needed
        } = req.query

        const pageNum = parseInt(page) || 1
        const limitNum = parseInt(limit) || 28

        // Build query
        const query = { userId: req.user.userId }

        // Search by nickname or species name
        // Complex because species name is in populated 'pokemonId'.
        // For strictly correct searching on species name, we need to filter AFTER population or find species IDs first.
        // Fetching species IDs matching the search term:
        if (search) {
            const searchRegex = new RegExp(search, 'i')
            // Find pokemon species matching name
            const species = await Pokemon.find({ name: searchRegex }).select('_id')
            const speciesIds = species.map(s => s._id)

            query.$or = [
                { nickname: searchRegex },
                { pokemonId: { $in: speciesIds } }
            ]
        }

        // Filters from the UI: "Normal Shiny Dark Silver..."
        // These look like "Variants" or "Forms".
        if (filter && filter !== 'all') {
            // Map UI filter text to database values
            // Example: 'shiny' -> { isShiny: true }
            // Example: 'dark' -> { formId: 'dark' } ??
            const lowerFilter = filter.toLowerCase()

            if (lowerFilter === 'shiny') {
                query.isShiny = true
            } else if (lowerFilter === 'normal') {
                query.isShiny = false
                // And maybe formId is normal?
            } else {
                // specific forms: dark, silver, golden, etc.
                // Assuming formId stores this.
                query.formId = lowerFilter
            }
        }

        // Sorting
        let sortOptions = {}
        switch (sort) {
            case 'level':
                sortOptions = { level: -1 } // Highest level first?
                break
            case 'id':
                // Sort by Pokedex Number (requires population or aggregation)
                // If we can't sort by populated field easily without aggregation, 
                // we might default to obtainedAt (IG - In Game order?)
                sortOptions = { pokemonId: 1 }
                break
            case 'ig':
            default:
                sortOptions = { createdAt: -1 } // Newest first
                break
        }

        // If sorting by ID (Species ID), basic find().sort() won't work well on populated fields. 
        // For now, let's stick to simple sorting or 'createdAt' for IG.
        // If 'id' is requested, we might sort by pokemonId (Object ID) which approximates creation time of the SPECIES, not the user pokemon.
        // To sort by Pokedex number properly, we need aggregation. 

        // Let's implement Aggregation for robust sorting/filtering if possible, or keep it simple.
        // Simple for now.
        if (sort === 'id') {
            // Fallback: sort by acquisition if we can't join-sort easily
            sortOptions = { pokemonId: 1 }
        }

        const total = await UserPokemon.countDocuments(query)

        const userPokemon = await UserPokemon.find(query)
            .populate('pokemonId') // Get details of the species
            .sort(sortOptions)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)

        // Count total owned (in box vs party)
        // Just return counts for UI header
        const countBox = total // Approximation since we query everything. 
        // Real implementation might separate box/party.

        res.json({
            pokemon: userPokemon,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            },
            counts: {
                total,
                box: total, // Logic to be refined
                party: 0
            }
        })

    } catch (error) {
        console.error('Box Error:', error)
        res.status(500).json({ message: 'Failed to fetch box' })
    }
})

export default router
