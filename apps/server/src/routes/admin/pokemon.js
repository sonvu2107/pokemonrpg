import express from 'express'
import mongoose from 'mongoose'
import Pokemon from '../../models/Pokemon.js'

const router = express.Router()

const RARITY_ALIASES = {
    superlegendary: 'ss',
    legendary: 's',
    ultra_rare: 'a',
    rare: 'b',
    uncommon: 'c',
    common: 'd',
}

const normalizeRarity = (rarity) => {
    if (!rarity) return 'd'
    const normalized = String(rarity).trim().toLowerCase()
    return RARITY_ALIASES[normalized] || normalized
}

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toSafePageLimit = (value, fallback) => Math.min(100, Math.max(1, parseInt(value, 10) || fallback))

const normalizeBaseStats = (stats) => {
    if (!stats || typeof stats !== 'object') return stats
    const normalized = { ...stats }
    if (normalized.spldef == null && normalized.spdef != null) {
        normalized.spldef = normalized.spdef
    }
    if (normalized.spdef == null && normalized.spldef != null) {
        normalized.spdef = normalized.spldef
    }
    return normalized
}

const normalizeForms = (forms) => {
    if (!Array.isArray(forms)) return []
    return forms
        .map((f) => {
            const rawEvolvesTo = f?.evolution?.evolvesTo
            const evolvesTo = typeof rawEvolvesTo === 'object'
                ? (rawEvolvesTo?._id || null)
                : (rawEvolvesTo || null)
            const parsedMinLevel = Number.parseInt(f?.evolution?.minLevel, 10)

            return {
                formId: String(f?.formId || '').trim(),
                formName: String(f?.formName || '').trim(),
                imageUrl: String(f?.imageUrl || '').trim(),
                sprites: f?.sprites || {},
                stats: f?.stats || {},
                evolution: evolvesTo
                    ? {
                        evolvesTo,
                        minLevel: Number.isFinite(parsedMinLevel) && parsedMinLevel > 0 ? parsedMinLevel : null,
                    }
                    : null,
            }
        })
        .filter(f => f.formId)
}

const normalizeEvolutionTargetId = (value) => {
    if (!value) return null
    if (typeof value === 'object') {
        const nested = value?._id || null
        return nested ? String(nested).trim() : null
    }
    const normalized = String(value).trim()
    return normalized || null
}

// GET /api/admin/pokemon - List all Pokemon with search, filter, pagination
router.get('/', async (req, res) => {
    try {
        const { search, type, page = 1, limit = 20 } = req.query

        const query = {}

        // Search by name (case-insensitive using nameLower)
        if (search) {
            const normalizedSearch = String(search).trim()
            const escapedSearch = escapeRegExp(normalizedSearch.toLowerCase())
            const numericSearch = Number.parseInt(normalizedSearch, 10)

            if (Number.isFinite(numericSearch)) {
                query.$or = [
                    { pokedexNumber: numericSearch },
                    { nameLower: { $regex: escapedSearch, $options: 'i' } },
                ]
            } else {
                query.nameLower = { $regex: escapedSearch, $options: 'i' }
            }
        }

        // Filter by type
        if (type) {
            query.types = type.toLowerCase()
        }

        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = toSafePageLimit(limit, 20)
        const skip = (safePage - 1) * safeLimit

        const [pokemon, total] = await Promise.all([
            Pokemon.find(query)
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(safeLimit)
                .populate('evolution.evolvesTo', 'name pokedexNumber')
                .lean(),
            Pokemon.countDocuments(query),
        ])

        res.set('Cache-Control', 'no-store')
        res.json({
            ok: true,
            pokemon,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.ceil(total / safeLimit),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// PUT /api/admin/pokemon/evolutions/bulk - Bulk update evolution rules
router.put('/evolutions/bulk', async (req, res) => {
    try {
        const rawUpdates = Array.isArray(req.body?.updates) ? req.body.updates : []
        if (rawUpdates.length === 0) {
            return res.status(400).json({ ok: false, message: 'Thiếu danh sách cập nhật tiến hóa' })
        }

        if (rawUpdates.length > 500) {
            return res.status(400).json({ ok: false, message: 'Số lượng cập nhật quá lớn (tối đa 500)' })
        }

        const normalizedUpdates = []

        for (const [index, entry] of rawUpdates.entries()) {
            const pokemonId = String(entry?.pokemonId || '').trim()
            if (!mongoose.Types.ObjectId.isValid(pokemonId)) {
                return res.status(400).json({ ok: false, message: `pokemonId không hợp lệ ở vị trí ${index + 1}` })
            }

            const formIdRaw = String(entry?.formId || '').trim()
            const formId = formIdRaw || null

            const evolvesTo = normalizeEvolutionTargetId(entry?.evolvesTo)
            if (evolvesTo && !mongoose.Types.ObjectId.isValid(evolvesTo)) {
                return res.status(400).json({ ok: false, message: `evolvesTo không hợp lệ ở vị trí ${index + 1}` })
            }

            if (evolvesTo && evolvesTo === pokemonId) {
                return res.status(400).json({ ok: false, message: `Pokemon không thể tiến hóa thành chính nó (vị trí ${index + 1})` })
            }

            const parsedMinLevel = Number.parseInt(entry?.minLevel, 10)
            const minLevel = evolvesTo
                ? (Number.isFinite(parsedMinLevel) && parsedMinLevel > 0 ? parsedMinLevel : null)
                : null

            normalizedUpdates.push({ pokemonId, formId, evolvesTo, minLevel })
        }

        const dedupedByKey = new Map()
        normalizedUpdates.forEach((entry) => {
            const key = `${entry.pokemonId}::${entry.formId || '__species__'}`
            dedupedByKey.set(key, entry)
        })
        const updates = [...dedupedByKey.values()]

        const pokemonIds = [...new Set(updates.map((entry) => entry.pokemonId))]
        const pokemonDocs = await Pokemon.find({ _id: { $in: pokemonIds } })
        const pokemonById = new Map(pokemonDocs.map((entry) => [String(entry._id), entry]))

        for (const pokemonId of pokemonIds) {
            if (!pokemonById.has(pokemonId)) {
                return res.status(404).json({ ok: false, message: `Không tìm thấy Pokemon: ${pokemonId}` })
            }
        }

        const targetIds = [...new Set(updates.map((entry) => entry.evolvesTo).filter(Boolean))]
        if (targetIds.length > 0) {
            const targetCount = await Pokemon.countDocuments({ _id: { $in: targetIds } })
            if (targetCount !== targetIds.length) {
                return res.status(400).json({ ok: false, message: 'Có Pokemon tiến hóa đích không tồn tại' })
            }
        }

        const touchedIds = new Set()

        for (const entry of updates) {
            const doc = pokemonById.get(entry.pokemonId)
            if (!doc) continue

            if (entry.formId) {
                const forms = Array.isArray(doc.forms) ? doc.forms : []
                const targetForm = forms.find((f) => String(f?.formId || '').trim() === entry.formId) || null
                if (!targetForm) {
                    return res.status(400).json({ ok: false, message: `Không tìm thấy formId "${entry.formId}" của Pokemon ${doc.name}` })
                }

                targetForm.evolution = entry.evolvesTo
                    ? {
                        evolvesTo: entry.evolvesTo,
                        minLevel: entry.minLevel,
                    }
                    : null
            } else {
                doc.evolution = {
                    evolvesTo: entry.evolvesTo || null,
                    minLevel: entry.evolvesTo ? entry.minLevel : null,
                }
            }

            touchedIds.add(String(doc._id))
        }

        const saveTasks = [...touchedIds]
            .map((id) => pokemonById.get(id))
            .filter(Boolean)
            .map((doc) => doc.save())

        await Promise.all(saveTasks)

        const updatedPokemon = await Pokemon.find({ _id: { $in: [...touchedIds] } })
            .select('name pokedexNumber evolution forms defaultFormId')
            .populate('evolution.evolvesTo', 'name pokedexNumber')
            .lean()

        res.json({
            ok: true,
            updatedCount: updates.length,
            pokemon: updatedPokemon,
        })
    } catch (error) {
        console.error('PUT /api/admin/pokemon/evolutions/bulk error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Lỗi máy chủ' })
    }
})

// GET /api/admin/pokemon/:id - Get single Pokemon
router.get('/:id', async (req, res) => {
    try {
        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        res.json({ ok: true, pokemon })
    } catch (error) {
        console.error('GET /api/admin/pokemon/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/pokemon - Create Pokemon
router.post('/', async (req, res) => {
    try {
        const { pokedexNumber, name, baseStats, types, initialMoves, sprites, imageUrl, description, rarity, rarityWeight, defaultFormId, evolution, levelUpMoves, catchRate, baseExperience, growthRate } = req.body
        const forms = normalizeForms(req.body.forms)
        const resolvedBaseStats = normalizeBaseStats(baseStats || forms[0]?.stats)

        // Validation
        if (!pokedexNumber || !name || !resolvedBaseStats || !types || types.length < 1 || types.length > 2) {
            return res.status(400).json({ ok: false, message: 'Dữ liệu nhập không hợp lệ' })
        }

        // Check duplicates
        const existing = await Pokemon.findOne({
            $or: [{ pokedexNumber }, { name }]
        })

        if (existing) {
            return res.status(409).json({
                ok: false,
                message: existing.pokedexNumber === pokedexNumber
                    ? 'Số Pokedex đã tồn tại'
                    : 'Tên Pokemon đã tồn tại'
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
            rarity: normalizeRarity(rarity),
            rarityWeight,
            defaultFormId: defaultFormId || forms[0]?.formId || 'normal',
            forms,
            evolution,
            levelUpMoves: levelUpMoves || [],
            catchRate,
            baseExperience,
            growthRate,
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
        const { pokedexNumber, name, baseStats, types, initialMoves, sprites, imageUrl, description, rarity, rarityWeight, defaultFormId, evolution, levelUpMoves, catchRate, baseExperience, growthRate } = req.body
        const forms = 'forms' in req.body ? normalizeForms(req.body.forms) : null

        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        // Check if new name/pokedex conflicts with other Pokemon
        if ((pokedexNumber !== undefined && pokedexNumber !== pokemon.pokedexNumber)
            || (name !== undefined && name !== pokemon.name)) {
            const conflict = await Pokemon.findOne({
                _id: { $ne: req.params.id },
                $or: [{ pokedexNumber }, { name }]
            })

            if (conflict) {
                return res.status(409).json({ ok: false, message: 'Trùng số Pokedex hoặc tên Pokemon' })
            }
        }

        // Update fields
        if (pokedexNumber !== undefined) pokemon.pokedexNumber = pokedexNumber
        if (name !== undefined) pokemon.name = name
        if (baseStats !== undefined) pokemon.baseStats = normalizeBaseStats(baseStats)
        pokemon.types = Array.isArray(types) ? types.map(t => t.toLowerCase()) : pokemon.types
        if (initialMoves !== undefined) pokemon.initialMoves = initialMoves || []
        if (sprites !== undefined) pokemon.sprites = sprites || pokemon.sprites
        if (imageUrl !== undefined) pokemon.imageUrl = imageUrl
        if (description !== undefined) pokemon.description = description || ''
        if (rarity !== undefined) pokemon.rarity = normalizeRarity(rarity)
        if (rarityWeight !== undefined) pokemon.rarityWeight = rarityWeight
        if (defaultFormId !== undefined) pokemon.defaultFormId = defaultFormId
        if (forms) pokemon.forms = forms

        // Update game mechanics fields
        if (evolution !== undefined) pokemon.evolution = evolution
        if (levelUpMoves !== undefined) pokemon.levelUpMoves = levelUpMoves
        if (catchRate !== undefined) pokemon.catchRate = catchRate
        if (baseExperience !== undefined) pokemon.baseExperience = baseExperience
        if (growthRate !== undefined) pokemon.growthRate = growthRate

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
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        // Cascade delete DropRates
        const DropRate = (await import('../../models/DropRate.js')).default
        await DropRate.deleteMany({ pokemonId: pokemon._id })

        await pokemon.deleteOne()

        res.json({ ok: true, message: 'Đã xóa Pokemon' })
    } catch (error) {
        console.error('DELETE /api/admin/pokemon/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
