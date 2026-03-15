import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

const router = express.Router()
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BOX_ENTRY_SELECT = '_id userId pokemonId nickname level fusionLevel formId isShiny location obtainedAt createdAt obtainedVipMapLevel'
const BOX_POKEMON_SELECT = '_id name pokedexNumber rarity imageUrl sprites defaultFormId forms evolution'
const POKEMON_RARITY_ORDER = ['d', 'c', 'b', 'a', 's', 'ss', 'sss', 'sss+']
const getPokemonRarityRank = (rarity = '') => {
    const index = POKEMON_RARITY_ORDER.indexOf(String(rarity || '').trim().toLowerCase())
    return index >= 0 ? index : -1
}

router.use(authMiddleware)
router.get('/', async (req, res) => {
    try {
        let {
            page = 1,
            limit = 28,
            search = '',
            sort = 'level',
            filter = 'all'
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
                sortOptions = { level: -1, fusionLevel: -1, createdAt: -1 }
                break
            case 'fusion':
                sortOptions = { fusionLevel: -1, level: -1, createdAt: -1 }
                break
            case 'id':
                sortOptions = { pokemonId: 1 }
                break
            case 'ig':
            default:
                sortOptions = { createdAt: -1 }
                break
        }

        const [total, partyCount] = await Promise.all([
            UserPokemon.countDocuments(query),
            UserPokemon.countDocuments(withActiveUserPokemonFilter({ userId: req.user.userId, location: 'party' })),
        ])

        const totalPages = Math.max(1, Math.ceil(total / limitNum))
        const normalizedPage = total > 0 ? Math.min(pageNum, totalPages) : 1

        let userPokemon = []

        if (sort === 'rarity') {
            const allMatchingPokemon = await UserPokemon.find(query)
                .select(BOX_ENTRY_SELECT)
                .populate('pokemonId', BOX_POKEMON_SELECT)
                .lean()

            allMatchingPokemon.sort((left, right) => {
                const rarityDiff = getPokemonRarityRank(right?.pokemonId?.rarity) - getPokemonRarityRank(left?.pokemonId?.rarity)
                if (rarityDiff !== 0) return rarityDiff

                const levelDiff = (Number(right?.level || 0) - Number(left?.level || 0))
                if (levelDiff !== 0) return levelDiff

                const createdAtDiff = new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime()
                if (createdAtDiff !== 0) return createdAtDiff

                return String(right?._id || '').localeCompare(String(left?._id || ''))
            })

            userPokemon = allMatchingPokemon.slice((normalizedPage - 1) * limitNum, normalizedPage * limitNum)
        } else {
            userPokemon = await UserPokemon.find(query)
                .select(BOX_ENTRY_SELECT)
                .populate('pokemonId', BOX_POKEMON_SELECT)
                .sort(sortOptions)
                .skip((normalizedPage - 1) * limitNum)
                .limit(limitNum)
                .lean()
        }

        res.json({
            pokemon: userPokemon,
            pagination: {
                page: normalizedPage,
                limit: limitNum,
                total,
                pages: totalPages,
            },
            counts: {
                total: total + partyCount,
                box: total,
                party: partyCount,
            }
        })

    } catch (error) {
        console.error('Box Error:', error)
        res.status(500).json({ message: 'Không thể tải kho Pokémon' })
    }
})

export default router
