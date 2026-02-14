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

const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon?.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter((entry) => Number.isFinite(entry?.level) && entry.level <= level)
        .sort((a, b) => a.level - b.level)
        .map((entry) => entry.moveName || '')
        .filter(Boolean)
    return learned.slice(-4)
}

const resolveEvolutionRule = (species, currentFormId) => {
    const normalizedFormId = String(currentFormId || '').trim()
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const matchedForm = forms.find((entry) => String(entry?.formId || '').trim() === normalizedFormId) || null
    const formEvolution = matchedForm?.evolution || null
    if (formEvolution?.evolvesTo) return formEvolution
    return species?.evolution || null
}

const resolvePokemonSprite = (pokemonLike) => {
    if (!pokemonLike) return ''
    const forms = Array.isArray(pokemonLike.forms) ? pokemonLike.forms : []
    const defaultFormId = String(pokemonLike.defaultFormId || 'normal').trim() || 'normal'
    const defaultForm = forms.find((entry) => String(entry?.formId || '').trim() === defaultFormId) || null
    return defaultForm?.sprites?.normal || defaultForm?.sprites?.icon || defaultForm?.imageUrl || pokemonLike.imageUrl || pokemonLike.sprites?.normal || pokemonLike.sprites?.icon || ''
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
                .select('name pokedexNumber imageUrl sprites types forms defaultFormId')
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
            defaultFormId: String(entry.defaultFormId || 'normal').trim() || 'normal',
            forms: (Array.isArray(entry.forms) ? entry.forms : []).map((form) => ({
                formId: String(form?.formId || '').trim(),
                formName: String(form?.formName || '').trim(),
                sprite: form?.sprites?.icon || form?.sprites?.normal || form?.imageUrl || '',
            })),
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
        }

        const evolutionRule = resolveEvolutionRule(basePokemon, userPokemon.formId)
        const minLevel = Number.parseInt(evolutionRule?.minLevel, 10)
        const hasValidRule = Boolean(evolutionRule?.evolvesTo) && Number.isFinite(minLevel) && minLevel >= 1
        let targetPokemon = null
        let previousPokemon = null

        if (hasValidRule) {
            const target = await Pokemon.findById(evolutionRule.evolvesTo)
                .select('name pokedexNumber imageUrl sprites forms defaultFormId')
                .lean()

            if (target) {
                targetPokemon = {
                    _id: target._id,
                    name: target.name,
                    pokedexNumber: target.pokedexNumber,
                    sprites: {
                        normal: resolvePokemonSprite(target),
                    },
                }
            }
        }

        const previousSpecies = await Pokemon.findOne({
            $or: [
                { 'evolution.evolvesTo': basePokemon._id },
                { 'forms.evolution.evolvesTo': basePokemon._id },
            ],
        })
            .select('name pokedexNumber imageUrl sprites forms defaultFormId')
            .lean()

        if (previousSpecies) {
            previousPokemon = {
                _id: previousSpecies._id,
                name: previousSpecies.name,
                pokedexNumber: previousSpecies.pokedexNumber,
                sprites: {
                    normal: resolvePokemonSprite(previousSpecies),
                },
            }
        }

        responseData.evolution = {
            canEvolve: Boolean(targetPokemon) && level >= minLevel,
            evolutionLevel: hasValidRule ? minLevel : null,
            targetPokemon,
            previousPokemon,
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

// POST /api/pokemon/:id/evolve (protected)
router.post('/:id/evolve', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const userPokemon = await UserPokemon.findOne({ _id: req.params.id, userId })
            .populate('pokemonId')

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        const currentSpecies = userPokemon.pokemonId
        if (!currentSpecies) {
            return res.status(404).json({ ok: false, message: 'Base Pokemon data missing' })
        }

        const evolutionRule = resolveEvolutionRule(currentSpecies, userPokemon.formId)
        const minLevel = Number.parseInt(evolutionRule?.minLevel, 10)
        if (!evolutionRule?.evolvesTo || !Number.isFinite(minLevel) || minLevel < 1) {
            return res.status(400).json({ ok: false, message: 'Pokemon này không có tiến hóa theo cấp độ' })
        }

        if (userPokemon.level < minLevel) {
            return res.status(400).json({ ok: false, message: `Cần đạt cấp ${minLevel} để tiến hóa` })
        }

        const targetSpecies = await Pokemon.findById(evolutionRule.evolvesTo)
            .select('name imageUrl sprites forms defaultFormId levelUpMoves')
            .lean()

        if (!targetSpecies) {
            return res.status(404).json({ ok: false, message: 'Pokemon tiến hóa không tồn tại' })
        }

        const targetForms = Array.isArray(targetSpecies.forms) ? targetSpecies.forms : []
        const currentFormId = String(userPokemon.formId || '').trim()
        const canKeepForm = currentFormId && targetForms.some((entry) => String(entry?.formId || '').trim() === currentFormId)
        const nextFormId = canKeepForm
            ? currentFormId
            : (String(targetSpecies.defaultFormId || '').trim() || 'normal')

        const fromName = currentSpecies.name
        userPokemon.pokemonId = targetSpecies._id
        userPokemon.formId = nextFormId
        userPokemon.moves = buildMovesForLevel(targetSpecies, userPokemon.level)
        await userPokemon.save()
        await userPokemon.populate('pokemonId')

        res.json({
            ok: true,
            message: `${fromName} đã tiến hóa thành ${targetSpecies.name}!`,
            evolution: {
                from: fromName,
                to: targetSpecies.name,
                level: userPokemon.level,
            },
            pokemon: userPokemon,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/evolve error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
