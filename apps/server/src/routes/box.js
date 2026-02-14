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
            limit = 28,
            search = '',
            sort = 'id',
            filter = 'all',
            type = 'all'
        } = req.query

        const pageNum = parseInt(page) || 1
        const limitNum = parseInt(limit) || 28

        // Build query
        const query = { userId: req.user.userId }

        // Search by nickname or species name
        if (search) {
            const searchRegex = new RegExp(search, 'i')
            const species = await Pokemon.find({ name: searchRegex }).select('_id')
            const speciesIds = species.map(s => s._id)

            query.$or = [
                { nickname: searchRegex },
                { pokemonId: { $in: speciesIds } }
            ]
        }

        if (filter && filter !== 'all') {
            const lowerFilter = filter.toLowerCase()

            if (lowerFilter === 'shiny') {
                query.isShiny = true
            } else if (lowerFilter === 'normal') {
                query.isShiny = false
            } else {
                query.formId = lowerFilter
            }
        }

        // Sorting
        let sortOptions = {}
        switch (sort) {
            case 'level':
                sortOptions = { level: -1 }
                break
            case 'id':
                sortOptions = { pokemonId: 1 }
                break
            case 'ig':
            default:
                sortOptions = { createdAt: -1 }
                break
        }

        if (sort === 'id') {
            sortOptions = { pokemonId: 1 }
        }

        const total = await UserPokemon.countDocuments(query)

        const userPokemon = await UserPokemon.find(query)
            .populate('pokemonId')
            .sort(sortOptions)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)

        const countBox = total

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
                box: total,
                party: 0
            }
        })

    } catch (error) {
        console.error('Box Error:', error)
        res.status(500).json({ message: 'Failed to fetch box' })
    }
})

export default router
