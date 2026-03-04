import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

router.use(authMiddleware)
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

        const pageNum = Math.max(1, parseInt(page, 10) || 1)
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 28))
        const query = { userId: req.user.userId }
        if (search) {
            const searchRegex = new RegExp(escapeRegExp(search), 'i')
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

        let userPokemon = []

        if (sort === 'type') {
            userPokemon = await UserPokemon.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'pokemons',
                        localField: 'pokemonId',
                        foreignField: '_id',
                        as: 'pokemonId',
                    },
                },
                {
                    $unwind: {
                        path: '$pokemonId',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $addFields: {
                        sortType: {
                            $ifNull: [
                                { $arrayElemAt: ['$pokemonId.types', 0] },
                                'zzz',
                            ],
                        },
                        sortName: {
                            $ifNull: ['$pokemonId.nameLower', 'zzz'],
                        },
                    },
                },
                {
                    $sort: {
                        sortType: 1,
                        sortName: 1,
                        level: -1,
                        _id: 1,
                    },
                },
                { $skip: (pageNum - 1) * limitNum },
                { $limit: limitNum },
                {
                    $project: {
                        sortType: 0,
                        sortName: 0,
                    },
                },
            ])
        } else {
            userPokemon = await UserPokemon.find(query)
                .populate('pokemonId')
                .sort(sortOptions)
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
        }

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
        res.status(500).json({ message: 'Không thể tải kho Pokemon' })
    }
})

export default router
