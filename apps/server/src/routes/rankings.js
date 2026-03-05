import express from 'express'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import DailyActivity from '../models/DailyActivity.js'
import User from '../models/User.js'
import Pokemon from '../models/Pokemon.js'

const router = express.Router()

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const getAdminUserIds = async () => {
    const admins = await User.find({ role: 'admin' }).select('_id').lean()
    return admins.map((entry) => entry._id)
}

const buildPokemonSort = (order = 'level_desc') => {
    switch (order) {
        case 'level_asc':
            return { level: 1, experience: 1, _id: 1 }
        case 'exp_desc':
            return { experience: -1, level: -1, _id: -1 }
        case 'exp_asc':
            return { experience: 1, level: 1, _id: 1 }
        case 'newest':
            return { obtainedAt: -1, _id: -1 }
        case 'oldest':
            return { obtainedAt: 1, _id: 1 }
        case 'level_desc':
        default:
            return { level: -1, experience: -1, _id: -1 }
    }
}

const pokemonLookupStage = {
    $lookup: {
        from: 'pokemons',
        let: { pokemonId: '$pokemonId' },
        pipeline: [
            {
                $match: {
                    $expr: { $eq: ['$_id', '$$pokemonId'] },
                },
            },
            {
                $project: {
                    name: 1,
                    pokedexNumber: 1,
                    types: 1,
                    forms: 1,
                    sprites: 1,
                    imageUrl: 1,
                },
            },
        ],
        as: 'pokemon',
    },
}

const ownerLookupStage = {
    $lookup: {
        from: 'users',
        let: { ownerId: '$userId' },
        pipeline: [
            {
                $match: {
                    $expr: { $eq: ['$_id', '$$ownerId'] },
                },
            },
            {
                $project: {
                    username: 1,
                    avatar: 1,
                },
            },
        ],
        as: 'owner',
    },
}

const pokemonLeaderboardProjection = {
    $project: {
        level: 1,
        experience: 1,
        nickname: 1,
        originalTrainer: 1,
        isShiny: 1,
        formId: 1,
        pokemon: 1,
        owner: 1,
    },
}

const resolvePokemonSprite = (entry) => {
    const pokemon = entry.pokemon || {}
    const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
    const resolvedForm = forms.find((form) => form.formId === entry.formId) || null
    const formSprites = resolvedForm?.sprites || {}
    const pokedexNumber = pokemon.pokedexNumber || 0
    const fallbackSprite = pokedexNumber
        ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexNumber}.png`
        : ''

    const baseNormal = pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.icon || fallbackSprite
    const formNormal = resolvedForm?.imageUrl || formSprites.normal || formSprites.icon || baseNormal
    const shinySprite = formSprites.shiny || pokemon.sprites?.shiny || formNormal

    return entry.isShiny ? shinySprite : formNormal
}

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const normalizeDailyType = (type = '') => {
    const normalized = String(type || '').trim().toLowerCase()
    if (normalized === 'mapexp' || normalized === 'exp' || normalized === 'map_exp') return 'mapExp'
    if (normalized === 'moonpoints' || normalized === 'moon' || normalized === 'moon_points') return 'moonPoints'
    return 'search'
}

const buildDailySort = (type = 'search') => {
    if (type === 'mapExp') {
        return { mapExp: -1, searches: -1, moonPoints: -1, userId: 1 }
    }
    if (type === 'moonPoints') {
        return { moonPoints: -1, mapExp: -1, searches: -1, userId: 1 }
    }
    return { searches: -1, mapExp: -1, moonPoints: -1, userId: 1 }
}

// GET /api/rankings/daily - Daily rankings by searches/map exp/moon points
router.get('/daily', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()

        const requestedDate = String(req.query.date || '').trim()
        const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : toDailyDateKey()
        const rankingType = normalizeDailyType(req.query.type)
        const sort = buildDailySort(rankingType)

        const filter = { date }
        if (adminUserIds.length > 0) {
            filter.userId = { $nin: adminUserIds }
        }
        const [totalUsers, activities] = await Promise.all([
            DailyActivity.countDocuments(filter),
            DailyActivity.find(filter)
                .select('userId searches mapExp moonPoints')
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('userId', 'username avatar')
                .lean(),
        ])

        const userIds = activities
            .map((activity) => activity.userId?._id)
            .filter(Boolean)
        const playerStates = await PlayerState.find({ userId: { $in: userIds } })
            .select('userId level')
            .lean()
        const playerLevelByUserId = new Map(playerStates.map((state) => [state.userId.toString(), state.level || 1]))

        const rankings = activities.map((activity, index) => ({
            rank: skip + index + 1,
            userId: activity.userId?._id || null,
            username: activity.userId?.username || 'Unknown',
            avatar: activity.userId?.avatar || '',
            level: activity.userId?._id ? (playerLevelByUserId.get(activity.userId._id.toString()) || 1) : 1,
            searches: activity.searches || 0,
            mapExp: activity.mapExp || 0,
            moonPoints: activity.moonPoints || 0,
            date,
        }))

        const totalPages = Math.max(1, Math.ceil(totalUsers / limit))

        res.json({
            ok: true,
            rankings,
            type: rankingType,
            date,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/daily error:', error)
        next(error)
    }
})

// GET /api/rankings/overall - Get overall rankings by EXP/Level
router.get('/overall', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()
        const playerFilter = adminUserIds.length > 0 ? { userId: { $nin: adminUserIds } } : {}

        const [totalUsers, playerStates] = await Promise.all([
            PlayerState.countDocuments(playerFilter),
            PlayerState.find(playerFilter)
                .select('userId experience level')
                .sort({ experience: -1, level: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .populate('userId', 'username')
                .lean(),
        ])

        // Build rankings with rank numbers
        const rankings = playerStates.map((state, index) => ({
            rank: skip + index + 1,
            userId: state.userId?._id,
            username: state.userId?.username || 'Unknown',
            experience: state.experience || 0,
            level: state.level || 1,
        }))

        const totalPages = Math.max(1, Math.ceil(totalUsers / limit))

        res.json({
            ok: true,
            rankings,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/overall error:', error)
        next(error)
    }
})

// GET /api/rankings/pokemon - Pokemon leaderboard with filters
router.get('/pokemon', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()

        const pokemonName = String(req.query.pokemonName || '').trim()
        const username = String(req.query.username || '').trim()
        const type = String(req.query.type || '').trim().toLowerCase()
        const ot = String(req.query.ot || '').trim()
        const order = String(req.query.order || 'level_desc').trim()

        const minLevelRaw = Number.parseInt(req.query.minLevel, 10)
        const maxLevelRaw = Number.parseInt(req.query.maxLevel, 10)
        const hasMinLevel = Number.isFinite(minLevelRaw)
        const hasMaxLevel = Number.isFinite(maxLevelRaw)
        const minLevel = hasMinLevel ? Math.max(1, minLevelRaw) : null
        const maxLevel = hasMaxLevel ? Math.max(1, maxLevelRaw) : null
        const normalizedMinLevel = minLevel != null && maxLevel != null ? Math.min(minLevel, maxLevel) : minLevel
        const normalizedMaxLevel = minLevel != null && maxLevel != null ? Math.max(minLevel, maxLevel) : maxLevel

        const baseMatch = {}
        if (adminUserIds.length > 0) {
            baseMatch.userId = { $nin: adminUserIds }
        }
        if (normalizedMinLevel != null || normalizedMaxLevel != null) {
            baseMatch.level = {}
            if (normalizedMinLevel != null) baseMatch.level.$gte = normalizedMinLevel
            if (normalizedMaxLevel != null) baseMatch.level.$lte = normalizedMaxLevel
        }
        if (ot) {
            baseMatch.originalTrainer = { $regex: escapeRegExp(ot), $options: 'i' }
        }

        if (pokemonName || type) {
            const pokemonFilter = {}
            if (pokemonName) {
                pokemonFilter.name = { $regex: escapeRegExp(pokemonName), $options: 'i' }
            }
            if (type) {
                pokemonFilter.types = type
            }

            const pokemonMatches = await Pokemon.find(pokemonFilter).select('_id').lean()
            const pokemonIds = pokemonMatches.map((entry) => entry._id)
            if (pokemonIds.length === 0) {
                return res.json({
                    ok: true,
                    rankings: [],
                    filters: {
                        pokemonName,
                        type,
                        minLevel: normalizedMinLevel,
                        maxLevel: normalizedMaxLevel,
                        username,
                        ot,
                        order,
                    },
                    pagination: {
                        currentPage: page,
                        totalPages: 1,
                        total: 0,
                        limit,
                        hasNextPage: false,
                        hasPrevPage: page > 1,
                    },
                })
            }
            baseMatch.pokemonId = { $in: pokemonIds }
        }

        if (username) {
            const ownerMatches = await User.find({
                username: { $regex: escapeRegExp(username), $options: 'i' },
                role: { $ne: 'admin' },
            })
                .select('_id')
                .lean()
            const ownerIds = ownerMatches.map((entry) => entry._id)
            if (ownerIds.length === 0) {
                return res.json({
                    ok: true,
                    rankings: [],
                    filters: {
                        pokemonName,
                        type,
                        minLevel: normalizedMinLevel,
                        maxLevel: normalizedMaxLevel,
                        username,
                        ot,
                        order,
                    },
                    pagination: {
                        currentPage: page,
                        totalPages: 1,
                        total: 0,
                        limit,
                        hasNextPage: false,
                        hasPrevPage: page > 1,
                    },
                })
            }
            if (baseMatch.userId?.$nin) {
                baseMatch.userId = { $in: ownerIds, $nin: baseMatch.userId.$nin }
            } else {
                baseMatch.userId = { $in: ownerIds }
            }
        }

        const sortOptions = buildPokemonSort(order)

        const [rows, total] = await Promise.all([
            UserPokemon.aggregate([
                { $match: baseMatch },
                { $sort: sortOptions },
                { $skip: skip },
                { $limit: limit },
                pokemonLookupStage,
                { $unwind: '$pokemon' },
                ownerLookupStage,
                {
                    $unwind: {
                        path: '$owner',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                pokemonLeaderboardProjection,
            ]).allowDiskUse(true),
            UserPokemon.countDocuments(baseMatch),
        ])

        const totalPages = Math.max(1, Math.ceil(total / limit))

        const rankings = rows.map((entry, index) => ({
            rank: skip + index + 1,
            userPokemonId: entry._id,
            level: entry.level || 1,
            experience: entry.experience || 0,
            nickname: entry.nickname || '',
            originalTrainer: entry.originalTrainer || '',
            isShiny: Boolean(entry.isShiny),
            formId: entry.formId || 'normal',
            sprite: resolvePokemonSprite(entry),
            pokemon: {
                _id: entry.pokemon?._id,
                name: entry.pokemon?.name || 'Unknown',
                pokedexNumber: entry.pokemon?.pokedexNumber || 0,
                types: Array.isArray(entry.pokemon?.types) ? entry.pokemon.types : [],
            },
            owner: {
                _id: entry.owner?._id || null,
                username: entry.owner?.username || 'Unknown',
                avatar: entry.owner?.avatar || '',
            },
        }))

        res.json({
            ok: true,
            rankings,
            filters: {
                pokemonName,
                type,
                minLevel: normalizedMinLevel,
                maxLevel: normalizedMaxLevel,
                username,
                ot,
                order,
            },
            pagination: {
                currentPage: page,
                totalPages,
                total,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/pokemon error:', error)
        next(error)
    }
})

export default router
