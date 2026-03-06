import express from 'express'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import DailyActivity from '../models/DailyActivity.js'
import User from '../models/User.js'
import Pokemon from '../models/Pokemon.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'

const router = express.Router()
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(source?.avatarFrameUrl || '').trim(),
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)
    return {
        ...current,
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
    }
}

const buildVipTierLookup = async (users = []) => {
    const tierIdSet = new Set()
    const tierLevelSet = new Set()

    for (const entry of users) {
        const vipTierId = String(entry?.vipTierId || '').trim()
        if (vipTierId) {
            tierIdSet.add(vipTierId)
            continue
        }
        const vipTierLevel = Math.max(0, parseInt(entry?.vipTierLevel, 10) || 0)
        if (vipTierLevel > 0) {
            tierLevelSet.add(vipTierLevel)
        }
    }

    const conditions = []
    if (tierIdSet.size > 0) {
        conditions.push({ _id: { $in: Array.from(tierIdSet) } })
    }
    if (tierLevelSet.size > 0) {
        conditions.push({ level: { $in: Array.from(tierLevelSet) } })
    }

    if (conditions.length === 0) {
        return {
            tierById: new Map(),
            tierByLevel: new Map(),
        }
    }

    const tiers = await VipPrivilegeTier.find({ $or: conditions }).select('_id level benefits').lean()
    const tierById = new Map()
    const tierByLevel = new Map()

    for (const tier of tiers) {
        const idKey = String(tier?._id || '').trim()
        if (idKey) {
            tierById.set(idKey, tier)
        }
        const levelKey = Math.max(0, parseInt(tier?.level, 10) || 0)
        if (levelKey > 0) {
            tierByLevel.set(levelKey, tier)
        }
    }

    return { tierById, tierByLevel }
}

const resolveTierBenefitsForUser = (userLike, tierById, tierByLevel) => {
    const vipTierId = String(userLike?.vipTierId || '').trim()
    if (vipTierId && tierById.has(vipTierId)) {
        return normalizeVipBenefits(tierById.get(vipTierId)?.benefits)
    }

    const vipTierLevel = Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0)
    if (vipTierLevel > 0 && tierByLevel.has(vipTierLevel)) {
        return normalizeVipBenefits(tierByLevel.get(vipTierLevel)?.benefits)
    }

    return normalizeVipBenefits({})
}

const buildEffectiveVipBenefitsByUserId = async (users = []) => {
    const normalizedUsers = Array.isArray(users) ? users.filter(Boolean) : []
    if (normalizedUsers.length === 0) return new Map()

    const { tierById, tierByLevel } = await buildVipTierLookup(normalizedUsers)
    const benefitsByUserId = new Map()

    for (const entry of normalizedUsers) {
        const userId = String(entry?._id || '').trim()
        if (!userId) continue
        benefitsByUserId.set(
            userId,
            mergeVipVisualBenefits(
                entry?.vipBenefits,
                resolveTierBenefitsForUser(entry, tierById, tierByLevel)
            )
        )
    }

    return benefitsByUserId
}

const getAdminUserIds = async () => {
    const admins = await User.find({ role: 'admin' }).select('_id').lean()
    return admins.map((entry) => entry._id)
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

const normalizeRankingMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'power' || normalized === 'combat' || normalized === 'combat_power' || normalized === 'lucchien') {
        return 'power'
    }
    return 'collection'
}

const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'

const resolvePokemonForm = (pokemon = {}, formId = 'normal') => {
    const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
    const normalizedFormId = normalizeFormId(formId)
    const defaultFormId = normalizeFormId(pokemon.defaultFormId || 'normal')
    return forms.find((entry) => normalizeFormId(entry?.formId) === normalizedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
}

const resolvePokemonSprite = (entry) => {
    const pokemon = entry?.pokemon || {}
    const resolvedForm = resolvePokemonForm(pokemon, entry?.formId)
    const formSprites = resolvedForm?.sprites || {}
    const pokedexNumber = Number(pokemon?.pokedexNumber || 0)
    const fallbackSprite = pokedexNumber > 0
        ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexNumber}.png`
        : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'

    const baseNormal = pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.icon || fallbackSprite
    const formNormal = resolvedForm?.imageUrl || formSprites.normal || formSprites.icon || baseNormal
    const shinySprite = formSprites.shiny || pokemon.sprites?.shiny || formNormal

    return entry?.isShiny ? shinySprite : formNormal
}

const resolvePokemonBaseStats = (entry) => {
    const pokemon = entry?.pokemon || {}
    const resolvedForm = resolvePokemonForm(pokemon, entry?.formId)
    return resolvedForm?.stats || pokemon.baseStats || {}
}

const toStatNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toSafePositiveInt = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1)
    return Math.max(1, Math.floor(parsed))
}

const calcPokemonCombatPower = (entry) => {
    const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
    const pokemon = entry?.pokemon || {}
    const baseStats = resolvePokemonBaseStats(entry)
    const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity || 'd')
    const ivs = entry?.ivs && typeof entry.ivs === 'object' ? entry.ivs : {}
    const evs = entry?.evs && typeof entry.evs === 'object' ? entry.evs : {}

    const resolveStat = (key, aliases = []) => {
        const iv = toStatNumber(ivs[key] ?? aliases.map((alias) => ivs[alias]).find((value) => value != null))
        const ev = toStatNumber(evs[key] ?? aliases.map((alias) => evs[alias]).find((value) => value != null))
        const base = toStatNumber(scaledStats[key] ?? aliases.map((alias) => scaledStats[alias]).find((value) => value != null))
        return Math.max(1, Math.floor(base + iv + (ev / 8)))
    }

    const hp = resolveStat('hp')
    const atk = resolveStat('atk')
    const def = resolveStat('def')
    const spatk = resolveStat('spatk')
    const spdef = resolveStat('spdef', ['spldef'])
    const spd = resolveStat('spd')

    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (level * 2)
    const shinyBonus = entry?.isShiny ? 1.03 : 1
    return toSafePositiveInt(rawPower * shinyBonus, 1)
}

const countDexEntriesForSpecies = (species = {}) => {
    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const uniqueFormIds = new Set([defaultFormId])
    for (const form of forms) {
        const normalizedFormId = normalizeFormId(form?.formId || defaultFormId)
        if (normalizedFormId) uniqueFormIds.add(normalizedFormId)
    }
    return Math.max(1, uniqueFormIds.size)
}

const getTotalDexEntries = async () => {
    const speciesRows = await Pokemon.find({})
        .select('defaultFormId forms')
        .lean()
    return speciesRows.reduce((total, species) => total + countDexEntriesForSpecies(species), 0)
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
                .populate('userId', 'username avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
                .lean(),
        ])

        const userIds = activities
            .map((activity) => activity.userId?._id)
            .filter(Boolean)
        const playerStates = await PlayerState.find({ userId: { $in: userIds } })
            .select('userId level')
            .lean()
        const playerLevelByUserId = new Map(playerStates.map((state) => [state.userId.toString(), state.level || 1]))
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(activities.map((activity) => activity?.userId))

        const rankings = activities.map((activity, index) => ({
            rank: skip + index + 1,
            userId: activity.userId?._id || null,
            username: activity.userId?.username || 'Unknown',
            avatar: normalizeAvatarUrl(activity.userId?.avatar),
            role: String(activity?.userId?.role || 'user').trim() || 'user',
            vipTierLevel: Math.max(0, parseInt(activity?.userId?.vipTierLevel, 10) || 0),
            vipTierCode: String(activity?.userId?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(activity?.userId?._id || ''))),
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
                .populate('userId', 'username avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
                .lean(),
        ])

        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(playerStates.map((state) => state?.userId))

        // Build rankings with rank numbers
        const rankings = playerStates.map((state, index) => ({
            rank: skip + index + 1,
            userId: state.userId?._id,
            username: state.userId?.username || 'Unknown',
            avatar: normalizeAvatarUrl(state.userId?.avatar),
            role: String(state?.userId?.role || 'user').trim() || 'user',
            vipTierLevel: Math.max(0, parseInt(state?.userId?.vipTierLevel, 10) || 0),
            vipTierCode: String(state?.userId?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(state?.userId?._id || ''))),
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

// GET /api/rankings/pokemon - Pokemon collection leaderboard by user
router.get('/pokemon', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 35))
        const skip = (page - 1) * limit
        const adminUserIds = await getAdminUserIds()
        const rankingMode = normalizeRankingMode(req.query.mode)

        const baseMatch = {}
        if (adminUserIds.length > 0) {
            baseMatch.userId = { $nin: adminUserIds }
        }

        if (rankingMode === 'power') {
            const rows = await UserPokemon.aggregate([
                { $match: baseMatch },
                {
                    $lookup: {
                        from: 'pokemons',
                        localField: 'pokemonId',
                        foreignField: '_id',
                        as: 'pokemon',
                    },
                },
                { $unwind: '$pokemon' },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'owner',
                    },
                },
                {
                    $unwind: {
                        path: '$owner',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $project: {
                        level: 1,
                        experience: 1,
                        nickname: 1,
                        isShiny: 1,
                        formId: 1,
                        ivs: 1,
                        evs: 1,
                        pokemon: {
                            _id: '$pokemon._id',
                            name: '$pokemon.name',
                            pokedexNumber: '$pokemon.pokedexNumber',
                            types: '$pokemon.types',
                            rarity: '$pokemon.rarity',
                            forms: '$pokemon.forms',
                            baseStats: '$pokemon.baseStats',
                            defaultFormId: '$pokemon.defaultFormId',
                            imageUrl: '$pokemon.imageUrl',
                            sprites: '$pokemon.sprites',
                        },
                        owner: {
                            _id: '$owner._id',
                            username: '$owner.username',
                            avatar: '$owner.avatar',
                            role: '$owner.role',
                            vipTierId: '$owner.vipTierId',
                            vipTierLevel: '$owner.vipTierLevel',
                            vipTierCode: '$owner.vipTierCode',
                            vipBenefits: '$owner.vipBenefits',
                        },
                    },
                },
            ]).allowDiskUse(true)

            const sortedRows = rows
                .map((entry) => {
                    const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
                    const experience = Math.max(0, Number(entry?.experience || 0))
                    const combatPower = toSafePositiveInt(calcPokemonCombatPower(entry), Math.max(1, level * 10))
                    return {
                        ...entry,
                        level,
                        experience,
                        combatPower,
                    }
                })
                .sort((a, b) => {
                    if (b.combatPower !== a.combatPower) return b.combatPower - a.combatPower
                    if (b.level !== a.level) return b.level - a.level
                    if (b.experience !== a.experience) return b.experience - a.experience
                    return String(a._id || '').localeCompare(String(b._id || ''))
                })

            const total = sortedRows.length
            const totalPages = Math.max(1, Math.ceil(total / limit))
            const pageRows = sortedRows.slice(skip, skip + limit)
            const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(
                pageRows.map((entry) => entry?.owner)
            )
            const rankings = pageRows.map((entry, index) => ({
                rank: skip + index + 1,
                userPokemonId: entry._id,
                level: entry.level,
                experience: entry.experience,
                nickname: entry.nickname || '',
                isShiny: Boolean(entry.isShiny),
                formId: entry.formId || 'normal',
                combatPower: entry.combatPower,
                power: entry.combatPower,
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
                    avatar: normalizeAvatarUrl(entry.owner?.avatar),
                    role: String(entry?.owner?.role || 'user').trim() || 'user',
                    vipTierLevel: Math.max(0, parseInt(entry?.owner?.vipTierLevel, 10) || 0),
                    vipTierCode: String(entry?.owner?.vipTierCode || '').trim().toUpperCase(),
                    vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(entry?.owner?._id || ''))),
                },
            }))

            return res.json({
                ok: true,
                mode: rankingMode,
                rankings,
                pagination: {
                    currentPage: page,
                    totalPages,
                    total,
                    limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                },
            })
        }

        const [rows, totalUsers, totalDexEntries] = await Promise.all([
            UserPokemon.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: '$userId',
                        totalPokemon: { $sum: 1 },
                        uniqueDexEntryKeys: {
                            $addToSet: {
                                $let: {
                                    vars: {
                                        rawFormId: {
                                            $toLower: {
                                                $ifNull: ['$formId', 'normal'],
                                            },
                                        },
                                    },
                                    in: {
                                        $concat: [
                                            { $toString: '$pokemonId' },
                                            ':',
                                            {
                                                $cond: [
                                                    { $eq: ['$$rawFormId', ''] },
                                                    'normal',
                                                    '$$rawFormId',
                                                ],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                {
                    $project: {
                        totalPokemon: 1,
                        collectedCount: {
                            $size: {
                                $ifNull: ['$uniqueDexEntryKeys', []],
                            },
                        },
                    },
                },
                { $sort: { collectedCount: -1, totalPokemon: -1, _id: 1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                {
                    $unwind: {
                        path: '$user',
                        preserveNullAndEmptyArrays: true,
                    },
                },
            ]).allowDiskUse(true),
            UserPokemon.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: '$userId',
                    },
                },
                {
                    $count: 'total',
                },
            ]).allowDiskUse(true),
            getTotalDexEntries(),
        ])

        const normalizedTotalUsers = Math.max(0, Number(totalUsers?.[0]?.total || 0))
        const totalPages = Math.max(1, Math.ceil(normalizedTotalUsers / limit))
        const normalizedTotalDexEntries = Math.max(0, Number(totalDexEntries || 0))
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(rows.map((entry) => entry?.user))

        const rankings = rows.map((entry, index) => ({
            rank: skip + index + 1,
            userId: entry._id || null,
            username: entry.user?.username || 'Unknown',
            avatar: normalizeAvatarUrl(entry.user?.avatar),
            role: String(entry?.user?.role || 'user').trim() || 'user',
            vipTierLevel: Math.max(0, parseInt(entry?.user?.vipTierLevel, 10) || 0),
            vipTierCode: String(entry?.user?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: normalizeVipBenefits(benefitsByUserId.get(String(entry?.user?._id || ''))),
            collectedCount: Math.max(0, Number(entry.collectedCount || 0)),
            totalPokemon: Math.max(0, Number(entry.totalPokemon || 0)),
            completionPercent: normalizedTotalDexEntries > 0
                ? Math.round((Math.max(0, Number(entry.collectedCount || 0)) / normalizedTotalDexEntries) * 100)
                : 0,
        }))

        res.json({
            ok: true,
            mode: rankingMode,
            rankings,
            totalSpecies: normalizedTotalDexEntries,
            totalDexEntries: normalizedTotalDexEntries,
            pagination: {
                currentPage: page,
                totalPages,
                total: normalizedTotalUsers,
                totalUsers: normalizedTotalUsers,
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
