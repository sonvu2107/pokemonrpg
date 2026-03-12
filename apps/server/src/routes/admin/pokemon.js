import express from 'express'
import mongoose from 'mongoose'
import Pokemon from '../../models/Pokemon.js'
import PokemonFormVariant from '../../models/PokemonFormVariant.js'
import Item from '../../models/Item.js'

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

const VALID_RARITIES = new Set(['sss+', 'sss', 'ss', 's', 'a', 'b', 'c', 'd'])
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

const BASE_STAT_KEYS = Object.freeze(['hp', 'atk', 'def', 'spatk', 'spldef', 'spd'])

const toComparableBaseStats = (stats = {}) => {
    const normalized = normalizeBaseStats(stats || {}) || {}
    return {
        hp: Number.parseInt(normalized?.hp, 10) || 0,
        atk: Number.parseInt(normalized?.atk, 10) || 0,
        def: Number.parseInt(normalized?.def, 10) || 0,
        spatk: Number.parseInt(normalized?.spatk, 10) || 0,
        spldef: Number.parseInt(normalized?.spldef ?? normalized?.spdef, 10) || 0,
        spd: Number.parseInt(normalized?.spd, 10) || 0,
    }
}

const hasMeaningfulBaseStats = (stats = {}) => BASE_STAT_KEYS.some((key) => Number(stats?.[key] || 0) > 0)

const areBaseStatsEqual = (left = {}, right = {}) => BASE_STAT_KEYS.every((key) => Number(left?.[key] || 0) === Number(right?.[key] || 0))

const normalizeFormStatsForStorage = (stats = {}, options = {}) => {
    const comparableStats = toComparableBaseStats(stats)
    if (!hasMeaningfulBaseStats(comparableStats)) {
        return {}
    }

    const previousBaseStats = options?.previousBaseStats ? toComparableBaseStats(options.previousBaseStats) : null
    const nextBaseStats = options?.nextBaseStats ? toComparableBaseStats(options.nextBaseStats) : null

    if (previousBaseStats && areBaseStatsEqual(comparableStats, previousBaseStats)) {
        return {}
    }

    if (nextBaseStats && areBaseStatsEqual(comparableStats, nextBaseStats)) {
        return {}
    }

    return {
        hp: comparableStats.hp,
        atk: comparableStats.atk,
        def: comparableStats.def,
        spatk: comparableStats.spatk,
        spdef: comparableStats.spldef,
        spd: comparableStats.spd,
    }
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

const normalizeEvolutionTargetFormId = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized || null
}

const normalizeEvolutionPayload = (value) => {
    const source = value && typeof value === 'object' ? value : {}
    const evolvesTo = normalizeEvolutionTargetId(source?.evolvesTo)
    if (!evolvesTo) return null

    const parsedMinLevel = Number.parseInt(source?.minLevel, 10)
    const minLevel = Number.isFinite(parsedMinLevel) && parsedMinLevel > 0 ? parsedMinLevel : null
    const targetFormId = normalizeEvolutionTargetFormId(source?.targetFormId)
    const requiredItemId = normalizeEvolutionTargetId(source?.requiredItemId)
    const parsedRequiredItemQuantity = Number.parseInt(source?.requiredItemQuantity, 10)
    const requiredItemQuantity = requiredItemId
        ? (Number.isFinite(parsedRequiredItemQuantity) && parsedRequiredItemQuantity > 0 ? parsedRequiredItemQuantity : 1)
        : null

    return {
        evolvesTo,
        targetFormId,
        minLevel,
        requiredItemId: requiredItemId || null,
        requiredItemQuantity,
    }
}

const collectRequiredEvolutionItemIds = (entries = []) => {
    const ids = new Set()
    for (const entry of Array.isArray(entries) ? entries : []) {
        const normalized = normalizeEvolutionTargetId(entry)
        if (normalized) ids.add(normalized)
    }
    return [...ids]
}

const validateEvolutionMaterialItems = async (itemIds = []) => {
    const normalizedIds = collectRequiredEvolutionItemIds(itemIds)
    if (normalizedIds.length === 0) return { ok: true, itemById: new Map() }

    for (const itemId of normalizedIds) {
        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return { ok: false, message: `requiredItemId không hợp lệ: ${itemId}` }
        }
    }

    const rows = await Item.find({
        _id: { $in: normalizedIds },
        isEvolutionMaterial: true,
    })
        .select('_id evolutionRarityFrom evolutionRarityTo')
        .lean()

    const itemById = new Map(rows.map((entry) => [String(entry?._id || '').trim(), entry]))
    const missingIds = normalizedIds.filter((entry) => !itemById.has(entry))
    if (missingIds.length > 0) {
        return {
            ok: false,
            message: `Có vật phẩm tiến hóa không hợp lệ hoặc chưa bật cờ tiến hóa: ${missingIds.slice(0, 5).join(', ')}`,
        }
    }

    return { ok: true, itemById }
}

const POKEMON_RARITY_ORDER = ['d', 'c', 'b', 'a', 's', 'ss', 'sss', 'sss+']
const normalizePokemonRarity = (value = '') => normalizeRarity(value)
const isEvolutionItemAllowedForRarity = (item, rarity) => {
    const rarityIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(rarity))
    if (rarityIndex < 0) return true

    const fromIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(item?.evolutionRarityFrom || 'd'))
    const toIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(item?.evolutionRarityTo || 'sss+'))
    if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) return false
    return rarityIndex >= fromIndex && rarityIndex <= toIndex
}

const validateRequiredItemsAgainstRarity = ({
    rarity,
    entries = [],
    itemById = new Map(),
}) => {
    const normalizedRarity = normalizePokemonRarity(rarity)
    for (const entry of Array.isArray(entries) ? entries : []) {
        const requiredItemId = String(entry?.requiredItemId || '').trim()
        if (!requiredItemId) continue

        const item = itemById.get(requiredItemId)
        if (!item) {
            return {
                ok: false,
                message: `Không tìm thấy vật phẩm tiến hóa: ${requiredItemId}`,
            }
        }

        if (!isEvolutionItemAllowedForRarity(item, normalizedRarity)) {
            return {
                ok: false,
                message: `Vật phẩm tiến hóa ${requiredItemId} không áp dụng cho rank ${normalizedRarity.toUpperCase()}`,
            }
        }
    }

    return { ok: true }
}

const validateEvolutionTargetFormIds = ({ entries = [], targetPokemonById = new Map() }) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
        const evolvesTo = String(entry?.evolvesTo || '').trim()
        const targetFormId = normalizeEvolutionTargetFormId(entry?.targetFormId)
        if (!evolvesTo || !targetFormId) continue

        const targetPokemon = targetPokemonById.get(evolvesTo)
        if (!targetPokemon) {
            return { ok: false, message: `Không tìm thấy Pokemon tiến hóa đích: ${evolvesTo}` }
        }

        const targetForms = Array.isArray(targetPokemon?.forms) ? targetPokemon.forms : []
        const hasForm = targetForms.length > 0
            ? targetForms.some((form) => normalizeEvolutionTargetFormId(form?.formId) === targetFormId)
            : targetFormId === normalizeEvolutionTargetFormId(targetPokemon?.defaultFormId || 'normal')

        if (!hasForm) {
            return {
                ok: false,
                message: `Form tiến hóa đích không tồn tại: ${targetPokemon.name || evolvesTo} (${targetFormId})`,
            }
        }
    }

    return { ok: true }
}

const normalizeForms = (forms, options = {}) => {
    if (!Array.isArray(forms)) return []
    return forms
        .map((f) => ({
            formId: String(f?.formId || '').trim(),
            formName: String(f?.formName || '').trim(),
            imageUrl: String(f?.imageUrl || '').trim(),
            sprites: f?.sprites || {},
            stats: normalizeFormStatsForStorage(f?.stats || {}, options),
            evolution: normalizeEvolutionPayload(f?.evolution),
        }))
        .filter(f => f.formId)
}

const syncFormsBaseStats = (forms = [], options = {}) => {
    const forceOverride = options?.forceOverride === true
    const previousBaseStats = options?.previousBaseStats ? toComparableBaseStats(options.previousBaseStats) : null
    const nextBaseStats = options?.nextBaseStats ? toComparableBaseStats(options.nextBaseStats) : null
    let syncedForms = 0
    let changed = false

    const nextForms = (Array.isArray(forms) ? forms : []).map((entry) => {
        const currentStats = toComparableBaseStats(entry?.stats || {})
        const hasCurrentStats = hasMeaningfulBaseStats(currentStats)
        const nextStats = forceOverride
            ? {}
            : normalizeFormStatsForStorage(entry?.stats || {}, { previousBaseStats, nextBaseStats })
        const comparableNextStats = toComparableBaseStats(nextStats)
        const nextStatsChanged = hasCurrentStats !== hasMeaningfulBaseStats(comparableNextStats)
            || !areBaseStatsEqual(currentStats, comparableNextStats)

        if (nextStatsChanged) {
            changed = true
            syncedForms += 1
        }

        return {
            formId: String(entry?.formId || '').trim(),
            formName: String(entry?.formName || '').trim(),
            imageUrl: String(entry?.imageUrl || '').trim(),
            sprites: entry?.sprites || {},
            stats: nextStats,
            evolution: normalizeEvolutionPayload(entry?.evolution),
        }
    })

    return {
        forms: nextForms.filter((entry) => entry.formId),
        changed,
        syncedForms,
    }
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
    const invalidStat = Object.entries(stats).find(([, value]) => !Number.isFinite(value) || value < 1 || value > 100000)
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
                .populate('evolution.requiredItemId', 'name imageUrl isEvolutionMaterial')
                .populate('forms.evolution.evolvesTo', 'name pokedexNumber')
                .populate('forms.evolution.requiredItemId', 'name imageUrl isEvolutionMaterial')
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
            const targetFormId = evolvesTo ? normalizeEvolutionTargetFormId(entry?.targetFormId) : null

            const requiredItemId = evolvesTo ? normalizeEvolutionTargetId(entry?.requiredItemId) : null
            const parsedRequiredItemQuantity = Number.parseInt(entry?.requiredItemQuantity, 10)
            const requiredItemQuantity = requiredItemId
                ? (Number.isFinite(parsedRequiredItemQuantity) && parsedRequiredItemQuantity > 0 ? parsedRequiredItemQuantity : 1)
                : null

            normalizedUpdates.push({
                pokemonId,
                formId,
                evolvesTo,
                targetFormId,
                minLevel,
                requiredItemId,
                requiredItemQuantity,
            })
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
        let targetPokemonById = new Map()
        if (targetIds.length > 0) {
            const targetRows = await Pokemon.find({ _id: { $in: targetIds } })
                .select('_id name defaultFormId forms.formId')
                .lean()
            targetPokemonById = new Map(targetRows.map((entry) => [String(entry?._id || '').trim(), entry]))
            if (targetRows.length !== targetIds.length) {
                return res.status(400).json({ ok: false, message: 'Có Pokemon tiến hóa đích không tồn tại' })
            }
        }

        const targetFormValidation = validateEvolutionTargetFormIds({
            entries: updates,
            targetPokemonById,
        })
        if (!targetFormValidation.ok) {
            return res.status(400).json({ ok: false, message: targetFormValidation.message })
        }

        const requiredItemIds = [...new Set(updates.map((entry) => entry.requiredItemId).filter(Boolean))]
        let requiredItemValidation = { ok: true, itemById: new Map() }
        if (requiredItemIds.length > 0) {
            requiredItemValidation = await validateEvolutionMaterialItems(requiredItemIds)
            if (!requiredItemValidation.ok) {
                return res.status(400).json({ ok: false, message: requiredItemValidation.message })
            }
        }

        for (const entry of updates) {
            if (!entry.requiredItemId) continue
            const sourcePokemon = pokemonById.get(entry.pokemonId)
            if (!sourcePokemon) continue

            const rarityValidation = validateRequiredItemsAgainstRarity({
                rarity: sourcePokemon.rarity,
                entries: [entry],
                itemById: requiredItemValidation.itemById,
            })
            if (!rarityValidation.ok) {
                return res.status(400).json({
                    ok: false,
                    message: `${sourcePokemon.name}: ${rarityValidation.message}`,
                })
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
                        targetFormId: entry.targetFormId,
                        minLevel: entry.minLevel,
                        requiredItemId: entry.requiredItemId || null,
                        requiredItemQuantity: entry.requiredItemId ? entry.requiredItemQuantity : null,
                    }
                    : null
            } else {
                doc.evolution = {
                    evolvesTo: entry.evolvesTo || null,
                    targetFormId: entry.evolvesTo ? (entry.targetFormId || null) : null,
                    minLevel: entry.evolvesTo ? entry.minLevel : null,
                    requiredItemId: entry.evolvesTo ? (entry.requiredItemId || null) : null,
                    requiredItemQuantity: entry.evolvesTo && entry.requiredItemId ? entry.requiredItemQuantity : null,
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
            .populate('evolution.requiredItemId', 'name imageUrl isEvolutionMaterial')
            .populate('forms.evolution.evolvesTo', 'name pokedexNumber')
            .populate('forms.evolution.requiredItemId', 'name imageUrl isEvolutionMaterial')
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

// POST /api/admin/pokemon/forms/sync-base-stats - Force all forms to inherit current base stats
router.post('/forms/sync-base-stats', async (req, res) => {
    try {
        const forceOverride = req.body?.forceOverride !== false
        const batchSize = Math.min(500, Math.max(10, parseInt(req.body?.batchSize, 10) || 100))
        const cursor = Pokemon.find({ 'forms.0': { $exists: true } })
            .select('_id baseStats forms')
            .lean()
            .cursor()

        let inspectedPokemon = 0
        let updatedPokemon = 0
        let syncedForms = 0
        let pendingOperations = []

        for await (const pokemon of cursor) {
            inspectedPokemon += 1
            const baseStats = normalizeBaseStats(pokemon?.baseStats || {})
            const result = syncFormsBaseStats(pokemon?.forms || [], {
                forceOverride,
                previousBaseStats: baseStats,
                nextBaseStats: baseStats,
            })

            if (!result.changed) {
                continue
            }

            updatedPokemon += 1
            syncedForms += result.syncedForms
            pendingOperations.push({
                updateOne: {
                    filter: { _id: pokemon._id },
                    update: { $set: { forms: result.forms } },
                },
            })

            if (pendingOperations.length >= batchSize) {
                await Pokemon.bulkWrite(pendingOperations, { ordered: false })
                pendingOperations = []
            }
        }

        if (pendingOperations.length > 0) {
            await Pokemon.bulkWrite(pendingOperations, { ordered: false })
        }

        return res.json({
            ok: true,
            summary: {
                mode: forceOverride ? 'ghi_de_tat_ca' : 'dong_bo_an_toan',
                inspectedPokemon,
                updatedPokemon,
                untouchedPokemon: Math.max(0, inspectedPokemon - updatedPokemon),
                syncedForms,
            },
            message: updatedPokemon > 0
                ? (forceOverride
                    ? `Đã ghi đè ${syncedForms} form của ${updatedPokemon} Pokemon theo stat gốc.`
                    : `Đã đồng bộ an toàn ${syncedForms} form của ${updatedPokemon} Pokemon.`)
                : 'Không có form nào cần đồng bộ.',
        })
    } catch (error) {
        console.error('POST /api/admin/pokemon/forms/sync-base-stats error:', error)
        return res.status(500).json({ ok: false, message: 'Đồng bộ stat form hàng loạt thất bại' })
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
        const rawForms = normalizeForms(req.body.forms)
        const normalizedEvolution = normalizeEvolutionPayload(evolution)
        const resolvedBaseStats = normalizeBaseStats(baseStats || rawForms[0]?.stats)
        const forms = normalizeForms(req.body.forms, { nextBaseStats: resolvedBaseStats })
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

        const requiredItemIds = [
            normalizedEvolution?.requiredItemId,
            ...forms.map((entry) => entry?.evolution?.requiredItemId),
        ].filter(Boolean)
        let requiredItemValidation = { ok: true, itemById: new Map() }
        if (requiredItemIds.length > 0) {
            requiredItemValidation = await validateEvolutionMaterialItems(requiredItemIds)
            if (!requiredItemValidation.ok) {
                return res.status(400).json({ ok: false, message: requiredItemValidation.message })
            }
        }

        const rarityValidation = validateRequiredItemsAgainstRarity({
            rarity: normalizeRarity(rarity),
            entries: [normalizedEvolution, ...forms.map((entry) => entry?.evolution)],
            itemById: requiredItemValidation.itemById,
        })
        if (!rarityValidation.ok) {
            return res.status(400).json({ ok: false, message: rarityValidation.message })
        }

        const targetIds = [...new Set([
            normalizedEvolution?.evolvesTo,
            ...forms.map((entry) => entry?.evolution?.evolvesTo),
        ].filter(Boolean))]
        let targetPokemonById = new Map()
        if (targetIds.length > 0) {
            const targetRows = await Pokemon.find({ _id: { $in: targetIds } })
                .select('_id name defaultFormId forms.formId')
                .lean()
            targetPokemonById = new Map(targetRows.map((entry) => [String(entry?._id || '').trim(), entry]))
            if (targetRows.length !== targetIds.length) {
                return res.status(400).json({ ok: false, message: 'Có Pokemon tiến hóa đích không tồn tại' })
            }
        }

        const targetFormValidation = validateEvolutionTargetFormIds({
            entries: [normalizedEvolution, ...forms.map((entry) => entry?.evolution)],
            targetPokemonById,
        })
        if (!targetFormValidation.ok) {
            return res.status(400).json({ ok: false, message: targetFormValidation.message })
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
            evolution: normalizedEvolution,
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
        const normalizedEvolution = evolution !== undefined ? normalizeEvolutionPayload(evolution) : undefined
        const shouldUpdateLevelUpMoves = levelUpMoves !== undefined
        const { moves: resolvedLevelUpMoves, error: levelUpMovesError } = shouldUpdateLevelUpMoves
            ? await resolveLevelUpMovesFromCatalog(levelUpMoves)
            : { moves: null, error: null }

        if (levelUpMovesError) {
            return res.status(400).json({ ok: false, message: levelUpMovesError })
        }

        const requiredItemIds = [
            normalizedEvolution?.requiredItemId,
            ...(Array.isArray(forms) ? forms.map((entry) => entry?.evolution?.requiredItemId) : []),
        ].filter(Boolean)
        let requiredItemValidation = { ok: true, itemById: new Map() }
        if (requiredItemIds.length > 0) {
            requiredItemValidation = await validateEvolutionMaterialItems(requiredItemIds)
            if (!requiredItemValidation.ok) {
                return res.status(400).json({ ok: false, message: requiredItemValidation.message })
            }
        }

        const pokemon = await Pokemon.findById(req.params.id)

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const previousBaseStats = normalizeBaseStats(pokemon.baseStats)
        const nextBaseStats = baseStats !== undefined ? normalizeBaseStats(baseStats) : previousBaseStats
        const forms = 'forms' in req.body
            ? normalizeForms(req.body.forms, { previousBaseStats, nextBaseStats })
            : null

        const effectiveRarity = normalizeRarity(rarity !== undefined ? rarity : pokemon.rarity)
        const pendingRarityEntries = [
            ...(evolution !== undefined ? [normalizedEvolution] : []),
            ...(Array.isArray(forms) ? forms.map((entry) => entry?.evolution) : []),
        ]
        if (pendingRarityEntries.some((entry) => entry?.requiredItemId)) {
            const rarityValidation = validateRequiredItemsAgainstRarity({
                rarity: effectiveRarity,
                entries: pendingRarityEntries,
                itemById: requiredItemValidation.itemById,
            })
            if (!rarityValidation.ok) {
                return res.status(400).json({ ok: false, message: rarityValidation.message })
            }
        }

        const targetEntries = [
            ...(evolution !== undefined ? [normalizedEvolution] : [pokemon.evolution]),
            ...(Array.isArray(forms)
                ? forms.map((entry) => entry?.evolution)
                : (Array.isArray(pokemon.forms) ? pokemon.forms.map((entry) => entry?.evolution) : [])),
        ]
        const targetIds = [...new Set(targetEntries.map((entry) => entry?.evolvesTo).filter(Boolean))]
        let targetPokemonById = new Map()
        if (targetIds.length > 0) {
            const targetRows = await Pokemon.find({ _id: { $in: targetIds } })
                .select('_id name defaultFormId forms.formId')
                .lean()
            targetPokemonById = new Map(targetRows.map((entry) => [String(entry?._id || '').trim(), entry]))
            if (targetRows.length !== targetIds.length) {
                return res.status(400).json({ ok: false, message: 'Có Pokemon tiến hóa đích không tồn tại' })
            }
        }

        const targetFormValidation = validateEvolutionTargetFormIds({
            entries: targetEntries,
            targetPokemonById,
        })
        if (!targetFormValidation.ok) {
            return res.status(400).json({ ok: false, message: targetFormValidation.message })
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
        if (evolution !== undefined) pokemon.evolution = normalizedEvolution
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
