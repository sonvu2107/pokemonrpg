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
const BOX_SPECIES_SEARCH_CACHE_TTL_MS = 60 * 1000

let boxSpeciesSearchCache = {
    rows: [],
    expiresAt: 0,
}

const loadBoxSpeciesSearchRows = async () => {
    const now = Date.now()
    if (boxSpeciesSearchCache.expiresAt > now) {
        return boxSpeciesSearchCache.rows
    }

    const rows = await Pokemon.find({})
        .select('_id nameLower')
        .lean()

    boxSpeciesSearchCache = {
        rows,
        expiresAt: now + BOX_SPECIES_SEARCH_CACHE_TTL_MS,
    }

    return rows
}

const resolveBoxSpeciesIdsBySearch = async (search = '') => {
    const normalizedSearch = String(search || '').trim().toLowerCase()
    if (!normalizedSearch) return []

    const rows = await loadBoxSpeciesSearchRows()
    return rows
        .filter((entry) => String(entry?.nameLower || '').includes(normalizedSearch))
        .map((entry) => entry?._id)
        .filter(Boolean)
}

const getPokemonRarityRank = (rarity = '') => {
    const index = POKEMON_RARITY_ORDER.indexOf(String(rarity || '').trim().toLowerCase())
    return index >= 0 ? index : -1
}

const loadRaritySortedUserPokemonPage = async ({ query, page, limit }) => {
    const normalizedPage = Math.max(1, Number(page) || 1)
    const normalizedLimit = Math.max(1, Number(limit) || 1)
    const allMatchingRows = await UserPokemon.find(query)
        .select(BOX_ENTRY_SELECT)
        .populate('pokemonId', BOX_POKEMON_SELECT)
        .lean()

    allMatchingRows.sort((left, right) => {
        const rarityDiff = getPokemonRarityRank(right?.pokemonId?.rarity) - getPokemonRarityRank(left?.pokemonId?.rarity)
        if (rarityDiff !== 0) return rarityDiff

        const levelDiff = Number(right?.level || 0) - Number(left?.level || 0)
        if (levelDiff !== 0) return levelDiff

        const createdAtDiff = new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime()
        if (createdAtDiff !== 0) return createdAtDiff

        return String(right?._id || '').localeCompare(String(left?._id || ''))
    })

    const start = (normalizedPage - 1) * normalizedLimit
    return allMatchingRows.slice(start, start + normalizedLimit)
}

router.use(authMiddleware)
router.get('/', async (req, res) => {
    try {
        const {
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
            const speciesIds = await resolveBoxSpeciesIdsBySearch(search)

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
            userPokemon = await loadRaritySortedUserPokemonPage({
                query,
                page: normalizedPage,
                limit: limitNum,
            })
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

export const __boxRouteInternals = {
    clearSpeciesSearchCache() {
        boxSpeciesSearchCache = {
            rows: [],
            expiresAt: 0,
        }
    },
}

export default router
