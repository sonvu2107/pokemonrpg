import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

const router = express.Router()
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BOX_ENTRY_SELECT = '_id userId pokemonId nickname level formId isShiny location obtainedAt createdAt'
const BOX_POKEMON_SELECT = '_id name pokedexNumber rarity imageUrl sprites defaultFormId forms evolution'

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
        const query = withActiveUserPokemonFilter({ userId: req.user.userId, location: 'box' })
        if (search) {
            const searchRegex = new RegExp(escapeRegExp(search), 'i')
            const species = await Pokemon.find({ name: searchRegex }).select('_id').lean()
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

        const [total, partyCount] = await Promise.all([
            UserPokemon.countDocuments(query),
            UserPokemon.countDocuments(withActiveUserPokemonFilter({ userId: req.user.userId, location: 'party' })),
        ])

        let userPokemon = []

        if (sort === 'type') {
            userPokemon = await UserPokemon.aggregate([
                { $match: query },
                {
                    $lookup: {
                        from: 'pokemons',
                        let: { targetPokemonId: '$pokemonId' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$_id', '$$targetPokemonId'] } } },
                            {
                                $project: {
                                    _id: 1,
                                    name: 1,
                                    nameLower: 1,
                                    pokedexNumber: 1,
                                    rarity: 1,
                                    imageUrl: 1,
                                    sprites: 1,
                                    defaultFormId: 1,
                                    forms: 1,
                                    evolution: 1,
                                    types: 1,
                                },
                            },
                        ],
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
                        _id: 1,
                        userId: 1,
                        pokemonId: 1,
                        nickname: 1,
                        level: 1,
                        formId: 1,
                        isShiny: 1,
                        location: 1,
                        obtainedAt: 1,
                        createdAt: 1,
                        sortType: 0,
                        sortName: 0,
                    },
                },
            ])
        } else {
            userPokemon = await UserPokemon.find(query)
                .select(BOX_ENTRY_SELECT)
                .populate('pokemonId', BOX_POKEMON_SELECT)
                .sort(sortOptions)
                .skip((pageNum - 1) * limitNum)
                .limit(limitNum)
                .lean()
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
                total: total + partyCount,
                box: total,
                party: partyCount,
            }
        })

    } catch (error) {
        console.error('Box Error:', error)
        res.status(500).json({ message: 'Không thể tải kho Pokemon' })
    }
})

export default router
