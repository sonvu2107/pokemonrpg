import express from 'express'
import Pokemon from '../../models/Pokemon.js'

const router = express.Router()

const normalizeForms = (forms) => {
    if (!Array.isArray(forms)) return []
    return forms
        .map(f => ({
            formId: String(f?.formId || '').trim(),
            formName: String(f?.formName || '').trim(),
            imageUrl: String(f?.imageUrl || '').trim(),
            sprites: f?.sprites || {},
            stats: f?.stats || {},
        }))
        .filter(f => f.formId)
}

// GET /api/admin/pokemon - List all Pokemon with search, filter, pagination
router.get('/', async (req, res) => {
    try {
        const { search, type, page = 1, limit = 20 } = req.query

        const query = {}

        // Search by name (case-insensitive using nameLower)
        if (search) {
            query.nameLower = { $regex: search.toLowerCase(), $options: 'i' }
        }

        // Filter by type
        if (type) {
            query.types = type.toLowerCase()
        }

        const skip = (parseInt(page) - 1) * parseInt(limit)

        const [pokemon, total] = await Promise.all([
            Pokemon.find(query)
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Pokemon.countDocuments(query),
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
        console.error('GET /api/admin/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/admin/pokemon/:id - Get single Pokemon
router.get('/:id', async (req, res) => {
    try {
        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        res.json({ ok: true, pokemon })
    } catch (error) {
        console.error('GET /api/admin/pokemon/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/admin/pokemon - Create Pokemon
router.post('/', async (req, res) => {
    try {
        const { pokedexNumber, name, baseStats, types, initialMoves, sprites, imageUrl, description, rarity, rarityWeight, defaultFormId } = req.body
        const forms = normalizeForms(req.body.forms)
        const resolvedBaseStats = baseStats || forms[0]?.stats

        // Validation
        if (!pokedexNumber || !name || !resolvedBaseStats || !types || types.length < 1 || types.length > 2) {
            return res.status(400).json({ ok: false, message: 'Invalid input' })
        }

        // Check duplicates
        const existing = await Pokemon.findOne({
            $or: [{ pokedexNumber }, { name }]
        })

        if (existing) {
            return res.status(409).json({
                ok: false,
                message: existing.pokedexNumber === pokedexNumber
                    ? 'Pokedex number already exists'
                    : 'Pokemon name already exists'
            })
        }

        const pokemon = new Pokemon({
            pokedexNumber,
            name,
            baseStats: resolvedBaseStats,
            types: types.map(t => t.toLowerCase()),
            initialMoves: initialMoves || [],
            sprites: sprites || forms[0]?.sprites || {},
            imageUrl: imageUrl || forms[0]?.imageUrl || '',
            description: description || '',
            rarity: rarity || 'common',
            rarityWeight,
            defaultFormId: defaultFormId || forms[0]?.formId || 'normal',
            forms,
        })

        await pokemon.save()

        res.status(201).json({ ok: true, pokemon })
    } catch (error) {
        console.error('POST /api/admin/pokemon error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/pokemon/:id - Update Pokemon
router.put('/:id', async (req, res) => {
    try {
        const { pokedexNumber, name, baseStats, types, initialMoves, sprites, imageUrl, description, rarity, rarityWeight, defaultFormId } = req.body
        const forms = 'forms' in req.body ? normalizeForms(req.body.forms) : null

        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        // Check if new name/pokedex conflicts with other Pokemon
        if (pokedexNumber !== pokemon.pokedexNumber || name !== pokemon.name) {
            const conflict = await Pokemon.findOne({
                _id: { $ne: req.params.id },
                $or: [{ pokedexNumber }, { name }]
            })

            if (conflict) {
                return res.status(409).json({ ok: false, message: 'Duplicate pokedex number or name' })
            }
        }

        // Update fields
        pokemon.pokedexNumber = pokedexNumber
        pokemon.name = name
        pokemon.baseStats = baseStats
        pokemon.types = types.map(t => t.toLowerCase())
        pokemon.initialMoves = initialMoves || []
        pokemon.sprites = sprites || pokemon.sprites
        if (imageUrl !== undefined) pokemon.imageUrl = imageUrl
        pokemon.description = description || ''
        pokemon.rarity = rarity || 'common'
        if (rarityWeight !== undefined) pokemon.rarityWeight = rarityWeight
        if (defaultFormId !== undefined) pokemon.defaultFormId = defaultFormId
        if (forms) pokemon.forms = forms

        if (forms && forms.length > 0) {
            const ids = new Set(forms.map(f => f.formId))
            if (!ids.has(pokemon.defaultFormId)) {
                pokemon.defaultFormId = forms[0].formId
            }
        }

        await pokemon.save()

        res.json({ ok: true, pokemon })
    } catch (error) {
        console.error('PUT /api/admin/pokemon/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/pokemon/:id - Delete Pokemon (cascade delete DropRates)
router.delete('/:id', async (req, res) => {
    try {
        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        // Cascade delete DropRates
        const DropRate = (await import('../../models/DropRate.js')).default
        await DropRate.deleteMany({ pokemonId: pokemon._id })

        await pokemon.deleteOne()

        res.json({ ok: true, message: 'Pokemon deleted' })
    } catch (error) {
        console.error('DELETE /api/admin/pokemon/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
