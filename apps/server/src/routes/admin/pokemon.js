import express from 'express'
import mongoose from 'mongoose'
import Pokemon from '../../models/Pokemon.js'
import PokemonFormVariant from '../../models/PokemonFormVariant.js'

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

const VALID_TYPES = new Set([
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
])

const VALID_RARITIES = new Set(['sss', 'ss', 's', 'a', 'b', 'c', 'd'])
const normalizeMoveName = (value = '') => String(value || '').trim().toLowerCase()
const FORM_VARIANT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,31}$/

const normalizeFormVariantId = (value = '') => String(value || '').trim().toLowerCase()
const normalizeFormVariantName = (value = '') => String(value || '').trim()

const toFormVariantResponse = (entry = null) => {
    if (!entry) return null
    return {
        id: String(entry.formId || '').trim().toLowerCase(),
        name: String(entry.formName || '').trim() || String(entry.formId || '').trim().toLowerCase(),
        isActive: Boolean(entry.isActive),
    }
}

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

const normalizeLevelUpMovesInput = (entries) => {
    if (!Array.isArray(entries)) return []
    return entries
        .map((entry) => {
            const parsedLevel = Number.parseInt(entry?.level, 10)
            const moveName = String(entry?.moveName || '').trim()
            return {
                level: Number.isFinite(parsedLevel) && parsedLevel > 0 ? parsedLevel : 1,
                moveName,
            }
        })
        .filter((entry) => entry.moveName)
}

const resolveLevelUpMovesFromCatalog = async (entries) => {
    const normalizedEntries = normalizeLevelUpMovesInput(entries)
    if (normalizedEntries.length === 0) {
        return { moves: [] }
    }

    const uniqueMoveKeys = [...new Set(
        normalizedEntries
            .map((entry) => normalizeMoveName(entry.moveName))
            .filter(Boolean)
    )]

    const Move = (await import('../../models/Move.js')).default
    const moveDocs = await Move.find({ nameLower: { $in: uniqueMoveKeys } })
        .select('_id name nameLower')
        .lean()

    const moveByKey = new Map(
        moveDocs
            .map((entry) => [normalizeMoveName(entry?.nameLower || entry?.name || ''), entry])
            .filter(([key]) => Boolean(key))
    )

    const missingKeys = uniqueMoveKeys.filter((key) => !moveByKey.has(key))
    if (missingKeys.length > 0) {
        return {
            error: `Không tìm thấy kỹ năng hợp lệ: ${missingKeys.slice(0, 10).join(', ')}`,
        }
    }

    const moves = normalizedEntries.map((entry) => {
        const key = normalizeMoveName(entry.moveName)
        const doc = moveByKey.get(key)
        return {
            level: entry.level,
            moveName: doc?.name || entry.moveName,
            moveId: doc?._id || null,
        }
    })

    return { moves }
}

const buildBulkImportEntry = (entry, index) => {
    const pokedexNumber = Number.parseInt(entry?.pokedexNumber, 10)
    if (!Number.isFinite(pokedexNumber) || pokedexNumber < 1 || pokedexNumber > 9999) {
        return { error: `ID khong hop le o vi tri ${index + 1}` }
    }

    const name = String(entry?.name || '').trim()
    if (!name) {
        return { error: `Name trong o vi tri ${index + 1}` }
    }

    const baseStats = normalizeBaseStats(entry?.baseStats || {})
    const hp = Number.parseInt(baseStats?.hp, 10)
    const atk = Number.parseInt(baseStats?.atk, 10)
    const def = Number.parseInt(baseStats?.def, 10)
    const spatk = Number.parseInt(baseStats?.spatk, 10)
    const spldef = Number.parseInt(baseStats?.spldef, 10)
    const spd = Number.parseInt(baseStats?.spd, 10)

    const stats = { hp, atk, def, spatk, spldef, spd }
    const invalidStat = Object.entries(stats).find(([, value]) => !Number.isFinite(value) || value < 1 || value > 255)
    if (invalidStat) {
        return { error: `Chi so ${invalidStat[0]} khong hop le o vi tri ${index + 1}` }
    }

    const rawTypes = Array.isArray(entry?.types) ? entry.types : []
    const normalizedTypes = [...new Set(rawTypes
        .map(t => String(t || '').trim().toLowerCase())
        .filter(Boolean)
    )]

    if (normalizedTypes.length < 1 || normalizedTypes.length > 2) {
        return { error: `Type phai co 1-2 he o vi tri ${index + 1}` }
    }

    const invalidType = normalizedTypes.find(type => !VALID_TYPES.has(type))
    if (invalidType) {
        return { error: `Type khong hop le (${invalidType}) o vi tri ${index + 1}` }
    }

    const rarity = normalizeRarity(entry?.rarity)
    const safeRarity = VALID_RARITIES.has(rarity) ? rarity : 'd'

    return {
        value: {
            pokedexNumber,
            name,
            baseStats: stats,
            types: normalizedTypes,
            rarity: safeRarity,
            initialMoves: [],
            levelUpMoves: [],
            defaultFormId: 'normal',
            forms: [],
        },
    }
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

// POST /api/admin/pokemon/import/csv - Bulk create Pokemon from parsed CSV rows
router.post('/import/csv', async (req, res) => {
    try {
        const rawEntries = Array.isArray(req.body?.pokemon) ? req.body.pokemon : []
        if (rawEntries.length === 0) {
            return res.status(400).json({ ok: false, message: 'Thieu danh sach Pokemon import' })
        }

        if (rawEntries.length > 500) {
            return res.status(400).json({ ok: false, message: 'So luong import qua lon (toi da 500 dong)' })
        }

        const normalizedEntries = []
        const precheckErrors = []

        rawEntries.forEach((entry, index) => {
            const built = buildBulkImportEntry(entry, index)
            if (built.error) {
                precheckErrors.push(built.error)
                return
            }
            normalizedEntries.push(built.value)
        })

        const dexSetInPayload = new Set()
        const nameSetInPayload = new Set()
        const dedupedEntries = []
        const skipped = []

        normalizedEntries.forEach((entry) => {
            const nameLower = String(entry.name || '').trim().toLowerCase()
            if (dexSetInPayload.has(entry.pokedexNumber) || nameSetInPayload.has(nameLower)) {
                skipped.push({
                    pokedexNumber: entry.pokedexNumber,
                    name: entry.name,
                    reason: 'Trung du lieu trong file import',
                })
                return
            }

            dexSetInPayload.add(entry.pokedexNumber)
            nameSetInPayload.add(nameLower)
            dedupedEntries.push(entry)
        })

        const dexNumbers = dedupedEntries.map(entry => entry.pokedexNumber)
        const namesLower = dedupedEntries.map(entry => String(entry.name || '').trim().toLowerCase())

        const existingDocs = await Pokemon.find({
            $or: [
                { pokedexNumber: { $in: dexNumbers } },
                { nameLower: { $in: namesLower } },
            ],
        })
            .select('pokedexNumber name nameLower')
            .lean()

        const existingDexSet = new Set(existingDocs.map(doc => Number.parseInt(doc.pokedexNumber, 10)).filter(Number.isFinite))
        const existingNameSet = new Set(existingDocs.map(doc => String(doc.nameLower || '').trim()).filter(Boolean))

        const created = []
        const saveErrors = []

        for (const entry of dedupedEntries) {
            const nameLower = String(entry.name || '').trim().toLowerCase()

            if (existingDexSet.has(entry.pokedexNumber) || existingNameSet.has(nameLower)) {
                skipped.push({
                    pokedexNumber: entry.pokedexNumber,
                    name: entry.name,
                    reason: 'Da ton tai trong he thong',
                })
                continue
            }

            try {
                const createdDoc = await Pokemon.create(entry)
                created.push({
                    _id: createdDoc._id,
                    pokedexNumber: createdDoc.pokedexNumber,
                    name: createdDoc.name,
                })
                existingDexSet.add(entry.pokedexNumber)
                existingNameSet.add(nameLower)
            } catch (error) {
                saveErrors.push(`Khong the tao #${entry.pokedexNumber} ${entry.name}: ${error.message}`)
            }
        }

        const errors = [...precheckErrors, ...saveErrors]

        res.json({
            ok: true,
            requestedCount: rawEntries.length,
            acceptedCount: dedupedEntries.length,
            createdCount: created.length,
            skippedCount: skipped.length,
            errorCount: errors.length,
            created,
            skipped: skipped.slice(0, 100),
            hiddenSkippedCount: Math.max(0, skipped.length - 100),
            errors: errors.slice(0, 100),
            hiddenErrorCount: Math.max(0, errors.length - 100),
        })
    } catch (error) {
        console.error('POST /api/admin/pokemon/import/csv error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Loi may chu' })
    }
})

// GET /api/admin/pokemon/lookup/moves - Search move catalog for form suggestions
router.get('/lookup/moves', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const type = String(req.query.type || '').trim().toLowerCase()
        const category = String(req.query.category || '').trim().toLowerCase()
        const limit = toSafePageLimit(req.query.limit, 100)

        const query = {}
        if (search) {
            query.nameLower = { $regex: escapeRegExp(search.toLowerCase()), $options: 'i' }
        }
        if (type) {
            query.type = type
        }
        if (category) {
            query.category = category
        }

        const Move = (await import('../../models/Move.js')).default
        const moves = await Move.find(query)
            .sort({ nameLower: 1, _id: 1 })
            .limit(limit)
            .select('_id name nameLower type category power accuracy pp priority isActive')
            .lean()

        res.json({ ok: true, moves })
    } catch (error) {
        console.error('GET /api/admin/pokemon/lookup/moves error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/pokemon/form-variants - List shared custom form variants
router.get('/form-variants', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim().toLowerCase()
        const safePage = Math.max(1, parseInt(req.query.page, 10) || 1)
        const safeLimit = toSafePageLimit(req.query.limit, 200)

        const query = { isActive: true }
        if (search) {
            const escaped = escapeRegExp(search)
            query.$or = [
                { formId: { $regex: escaped, $options: 'i' } },
                { formNameLower: { $regex: escaped, $options: 'i' } },
            ]
        }

        const skip = (safePage - 1) * safeLimit
        const [rows, total] = await Promise.all([
            PokemonFormVariant.find(query)
                .sort({ formId: 1, _id: 1 })
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            PokemonFormVariant.countDocuments(query),
        ])

        res.json({
            ok: true,
            formVariants: rows.map((entry) => toFormVariantResponse(entry)).filter(Boolean),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/pokemon/form-variants error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/pokemon/form-variants - Create/update shared form variant
router.post('/form-variants', async (req, res) => {
    try {
        const formId = normalizeFormVariantId(req.body?.formId)
        const formNameRaw = normalizeFormVariantName(req.body?.formName)

        if (!formId || !FORM_VARIANT_ID_REGEX.test(formId)) {
            return res.status(400).json({
                ok: false,
                message: 'formId không hợp lệ. Chỉ cho phép a-z, 0-9, _, -, tối đa 32 ký tự.',
            })
        }

        const formName = formNameRaw || formId
        const updaterUserId = mongoose.Types.ObjectId.isValid(String(req.user?.userId || ''))
            ? req.user.userId
            : null

        const variant = await PokemonFormVariant.findOneAndUpdate(
            { formId },
            {
                $set: {
                    formId,
                    formName,
                    formNameLower: formName.toLowerCase(),
                    isActive: true,
                    updatedBy: updaterUserId,
                },
                $setOnInsert: {
                    createdBy: updaterUserId,
                },
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
            }
        ).lean()

        res.json({
            ok: true,
            formVariant: toFormVariantResponse(variant),
            message: `Đã lưu dạng ${formName} (${formId})`,
        })
    } catch (error) {
        console.error('POST /api/admin/pokemon/form-variants error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
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
        const { moves: resolvedLevelUpMoves, error: levelUpMovesError } = await resolveLevelUpMovesFromCatalog(levelUpMoves || [])

        if (levelUpMovesError) {
            return res.status(400).json({ ok: false, message: levelUpMovesError })
        }

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
            levelUpMoves: resolvedLevelUpMoves,
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
        const shouldUpdateLevelUpMoves = levelUpMoves !== undefined
        const { moves: resolvedLevelUpMoves, error: levelUpMovesError } = shouldUpdateLevelUpMoves
            ? await resolveLevelUpMovesFromCatalog(levelUpMoves)
            : { moves: null, error: null }

        if (levelUpMovesError) {
            return res.status(400).json({ ok: false, message: levelUpMovesError })
        }

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
        if (shouldUpdateLevelUpMoves) pokemon.levelUpMoves = resolvedLevelUpMoves
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
