import express from 'express'
import mongoose from 'mongoose'
import Move, { MOVE_LEARN_SCOPES, MOVE_RARITIES, POKEMON_RARITIES, POKEMON_TYPES } from '../../models/Move.js'
import MovePurchaseLog from '../../models/MovePurchaseLog.js'
import Pokemon from '../../models/Pokemon.js'
import { parseMoveEffectText } from '../../battle/effects/effectParser.js'
import { getRegisteredEffectOps } from '../../battle/effects/effectRegistry.js'
import {
    buildEffectOpMeta,
    buildEffectReasonMeta,
    getDefaultEffectSpecForOp,
    getEffectTargetOptions,
    getEffectTriggerOptions,
    isImplementedEffectOp,
} from '../../battle/effects/effectMeta.js'

const router = express.Router()

const MOVE_TYPES = Move.schema.path('type')?.enumValues || []
const MOVE_CATEGORIES = Move.schema.path('category')?.enumValues || []
const LEARN_SCOPE_SET = new Set(MOVE_LEARN_SCOPES)
const POKEMON_TYPE_SET = new Set(POKEMON_TYPES)
const POKEMON_RARITY_SET = new Set(POKEMON_RARITIES)

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toBoolean = (value, fallback = false) => {
    if (value === undefined) return fallback
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

const parseNumberOrUndefined = (value) => {
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : NaN
}

const DEFAULT_MOVE_SORT = 'createdAt_desc'
const MOVE_SORT_OPTIONS = new Set([
    'createdAt_desc',
    'name_asc',
    'name_desc',
    'implemented_effects_desc',
])

const resolveMoveSortKey = (value = '') => {
    const normalized = String(value || '').trim()
    if (!normalized) return DEFAULT_MOVE_SORT
    return MOVE_SORT_OPTIONS.has(normalized) ? normalized : DEFAULT_MOVE_SORT
}

const resolveMoveSortStage = (sortBy = DEFAULT_MOVE_SORT) => {
    if (sortBy === 'name_asc') return { nameLower: 1, _id: 1 }
    if (sortBy === 'name_desc') return { nameLower: -1, _id: -1 }
    if (sortBy === 'implemented_effects_desc') {
        return {
            hasImplementedEffects: -1,
            implementedEffectCount: -1,
            effectSpecCount: -1,
            createdAt: -1,
            _id: -1,
        }
    }
    return { createdAt: -1, _id: -1 }
}

const normalizeEffectStateFilter = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return 'all'
    if (['all', 'implemented', 'incomplete', 'none'].includes(normalized)) return normalized
    return 'all'
}

const buildEffectStateMatchStage = (effectState = 'all') => {
    if (effectState === 'implemented') return { implementedEffectCount: { $gt: 0 } }
    if (effectState === 'incomplete') {
        return {
            $expr: {
                $and: [
                    { $gt: ['$effectSpecCount', 0] },
                    { $eq: ['$implementedEffectCount', 0] },
                ],
            },
        }
    }
    if (effectState === 'none') return { effectSpecCount: { $eq: 0 } }
    return null
}

const IMPORT_MAX_ROWS = 500

const normalizeImportToken = (value = '') => String(value || '').trim().toLowerCase().replace(/\s+/g, '_')

const normalizeImportedMoveType = (value = '') => {
    const token = normalizeImportToken(value)
    const aliases = {
        psychic: 'psychic',
        psych: 'psychic',
        normal: 'normal',
        fire: 'fire',
        water: 'water',
        grass: 'grass',
        electric: 'electric',
        ice: 'ice',
        fighting: 'fighting',
        poison: 'poison',
        ground: 'ground',
        flying: 'flying',
        bug: 'bug',
        rock: 'rock',
        ghost: 'ghost',
        dragon: 'dragon',
        dark: 'dark',
        steel: 'steel',
        fairy: 'fairy',
    }

    return aliases[token] || token
}

const normalizeImportedMoveCategory = (value = '') => {
    const token = normalizeImportToken(value)
    const aliases = {
        physical: 'physical',
        vat_ly: 'physical',
        special: 'special',
        dac_biet: 'special',
        status: 'status',
        trang_thai: 'status',
    }
    return aliases[token] || token
}

const parseMoveImportNumber = (value, { allowNull = true } = {}) => {
    const raw = String(value ?? '').trim()
    if (!raw || ['-', '--', '---', '_', '—', '–'].includes(raw)) {
        return allowNull ? null : NaN
    }
    if (raw === '∞' || raw.toLowerCase() === 'inf' || raw.toLowerCase() === 'infinity') {
        return 100
    }
    const parsed = Number(raw.replace(/,/g, '.'))
    if (!Number.isFinite(parsed)) return NaN
    return parsed
}

const normalizeEffectSpecsInput = (effectSpecs = []) => {
    if (!Array.isArray(effectSpecs)) return []
    return effectSpecs
        .map((entry) => {
            const op = String(entry?.op || '').trim()
            if (!op) return null
            const trigger = String(entry?.trigger || 'on_hit').trim() || 'on_hit'
            const target = String(entry?.target || 'opponent').trim() || 'opponent'
            const chanceRaw = Number(entry?.chance)
            const chance = Number.isFinite(chanceRaw)
                ? Math.max(0, Math.min(1, chanceRaw))
                : 1
            return {
                op,
                trigger,
                target,
                chance,
                params: entry?.params && typeof entry.params === 'object' ? entry.params : {},
                sourceText: String(entry?.sourceText || '').trim(),
                parserConfidence: Number.isFinite(Number(entry?.parserConfidence))
                    ? Math.max(0, Math.min(1, Number(entry.parserConfidence)))
                    : 1,
            }
        })
        .filter(Boolean)
}

const resolveEffectSpecsFromPayload = ({ effectSpecs, description, effectChance }) => {
    const normalized = normalizeEffectSpecsInput(effectSpecs)
    if (normalized.length > 0) {
        return {
            effectSpecs: normalized,
            parserWarnings: [],
            parserConfidence: 1,
        }
    }

    return parseMoveEffectText({ description, probability: effectChance })
}

const buildBulkImportMoveEntry = (entry, index) => {
    const name = String(entry?.name || '').trim()
    if (!name) {
        return { error: `Tên chiêu trống ở dòng ${index + 1}` }
    }

    const normalizedType = normalizeImportedMoveType(entry?.type)
    if (!MOVE_TYPES.includes(normalizedType)) {
        return { error: `Hệ kỹ năng không hợp lệ (${entry?.type || '-'}) ở dòng ${index + 1}` }
    }

    const normalizedCategory = normalizeImportedMoveCategory(entry?.category)
    const parsedPower = parseMoveImportNumber(entry?.power)
    const parsedAccuracy = parseMoveImportNumber(entry?.accuracy)
    const parsedPp = parseMoveImportNumber(entry?.pp)
    const parsedPriority = parseMoveImportNumber(entry?.priority)
    const parsedShopPrice = parseMoveImportNumber(entry?.shopPrice)
    const parsedEffectChance = parseMoveImportNumber(entry?.effectChance)

    if (Number.isNaN(parsedPower) || Number.isNaN(parsedAccuracy) || Number.isNaN(parsedPp) || Number.isNaN(parsedPriority) || Number.isNaN(parsedShopPrice) || Number.isNaN(parsedEffectChance)) {
        return { error: `Có trường số không hợp lệ ở dòng ${index + 1}` }
    }

    const resolvedCategory = MOVE_CATEGORIES.includes(normalizedCategory)
        ? normalizedCategory
        : (parsedPower == null ? 'status' : 'physical')

    if (!MOVE_CATEGORIES.includes(resolvedCategory)) {
        return { error: `Phân loại kỹ năng không hợp lệ (${entry?.category || '-'}) ở dòng ${index + 1}` }
    }

    const normalizedRarityToken = normalizeImportToken(entry?.rarity || '')
    const resolvedRarity = MOVE_RARITIES.includes(normalizedRarityToken) ? normalizedRarityToken : 'common'

    const normalizedLearnConfig = normalizeLearnConfigInput({
        learnScope: entry?.learnScope,
        allowedTypes: entry?.allowedTypes,
        allowedPokemonIds: entry?.allowedPokemonIds,
        allowedRarities: entry?.allowedRarities,
    })
    const learnValidationError = validateLearnConfig(normalizedLearnConfig)
    if (learnValidationError) {
        return { error: `${learnValidationError} (dòng ${index + 1})` }
    }
    const resolvedLearnConfig = resolveLearnConfigByScope(normalizedLearnConfig)

    const description = String(entry?.description || '').trim()

    const baseEffects = entry?.effects && typeof entry.effects === 'object'
        ? { ...entry.effects }
        : {}
    if (parsedEffectChance != null) {
        baseEffects.effectChance = Math.max(0, Math.min(100, parsedEffectChance))
    }

    const parsedEffects = resolveEffectSpecsFromPayload({
        effectSpecs: entry?.effectSpecs,
        description,
        effectChance: parsedEffectChance,
    })
    if (parsedEffects.parserWarnings.length > 0) {
        baseEffects.parserWarnings = parsedEffects.parserWarnings.slice(0, 5)
    }
    if (Number.isFinite(parsedEffects.parserConfidence)) {
        baseEffects.parserConfidence = parsedEffects.parserConfidence
    }

    return {
        value: {
            name,
            type: normalizedType,
            category: resolvedCategory,
            power: parsedPower,
            accuracy: parsedAccuracy == null ? 100 : parsedAccuracy,
            pp: parsedPp == null ? 10 : parsedPp,
            priority: parsedPriority == null ? 0 : parsedPriority,
            description,
            imageUrl: String(entry?.imageUrl || '').trim(),
            rarity: resolvedRarity,
            shopPrice: Math.max(0, parsedShopPrice == null ? 0 : parsedShopPrice),
            isShopEnabled: toBoolean(entry?.isShopEnabled, false),
            isActive: toBoolean(entry?.isActive, true),
            learnScope: resolvedLearnConfig.learnScope,
            allowedTypes: resolvedLearnConfig.allowedTypes,
            allowedPokemonIds: resolvedLearnConfig.allowedPokemonIds,
            allowedRarities: resolvedLearnConfig.allowedRarities,
            effects: baseEffects,
            effectSpecs: parsedEffects.effectSpecs,
        },
    }
}

const normalizeStringArray = (values = []) => {
    if (!Array.isArray(values)) return []
    return [...new Set(values
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
    )]
}

const normalizeObjectIdArray = (values = []) => {
    if (!Array.isArray(values)) return []
    const normalizedIds = []
    const seen = new Set()

    values.forEach((entry) => {
        const resolved = typeof entry === 'object' ? String(entry?._id || '') : String(entry || '')
        const normalized = resolved.trim()
        if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return
        if (seen.has(normalized)) return
        seen.add(normalized)
        normalizedIds.push(normalized)
    })

    return normalizedIds
}

const normalizeLearnConfigInput = ({ learnScope, allowedTypes, allowedPokemonIds, allowedRarities } = {}) => {
    const normalizedLearnScope = LEARN_SCOPE_SET.has(String(learnScope || '').trim().toLowerCase())
        ? String(learnScope).trim().toLowerCase()
        : 'all'

    return {
        learnScope: normalizedLearnScope,
        allowedTypes: normalizeStringArray(allowedTypes),
        allowedPokemonIds: normalizeObjectIdArray(allowedPokemonIds),
        allowedRarities: normalizeStringArray(allowedRarities),
    }
}

const validateLearnConfig = ({ learnScope, allowedTypes, allowedPokemonIds, allowedRarities }) => {
    const invalidType = allowedTypes.find((entry) => !POKEMON_TYPE_SET.has(entry))
    if (invalidType) {
        return `Hệ Pokemon không hợp lệ: ${invalidType}`
    }

    const invalidRarity = allowedRarities.find((entry) => !POKEMON_RARITY_SET.has(entry))
    if (invalidRarity) {
        return `Độ hiếm Pokemon không hợp lệ: ${invalidRarity}`
    }

    if (learnScope === 'type' && allowedTypes.length === 0) {
        return 'Phạm vi học theo hệ cần ít nhất 1 hệ Pokemon'
    }

    if (learnScope === 'species' && allowedPokemonIds.length === 0) {
        return 'Phạm vi học theo Pokemon đặc biệt cần ít nhất 1 loài Pokemon'
    }

    if (learnScope === 'rarity' && allowedRarities.length === 0) {
        return 'Phạm vi học theo độ hiếm cần ít nhất 1 độ hiếm Pokemon'
    }

    return ''
}

const resolveLearnConfigByScope = ({ learnScope, allowedTypes, allowedPokemonIds, allowedRarities }) => {
    if (learnScope === 'move_type') {
        return {
            learnScope,
            allowedTypes: [],
            allowedPokemonIds: [],
            allowedRarities: [],
        }
    }

    if (learnScope === 'type') {
        return {
            learnScope,
            allowedTypes,
            allowedPokemonIds: [],
            allowedRarities: [],
        }
    }
    if (learnScope === 'species') {
        return {
            learnScope,
            allowedTypes: [],
            allowedPokemonIds,
            allowedRarities: [],
        }
    }
    if (learnScope === 'rarity') {
        return {
            learnScope,
            allowedTypes: [],
            allowedPokemonIds: [],
            allowedRarities,
        }
    }

    return {
        learnScope: 'all',
        allowedTypes: [],
        allowedPokemonIds: [],
        allowedRarities: [],
    }
}

const ensureAllowedPokemonIdsExist = async (allowedPokemonIds = []) => {
    if (!Array.isArray(allowedPokemonIds) || allowedPokemonIds.length === 0) return true
    const count = await Pokemon.countDocuments({ _id: { $in: allowedPokemonIds } })
    return count === allowedPokemonIds.length
}

const countPokemonUsingMove = async (move) => {
    if (!move?._id) return 0
    const normalizedMoveName = String(move?.name || '').trim()

    const usageQuery = {
        $or: [
            { 'levelUpMoves.moveId': move._id },
        ],
    }

    if (normalizedMoveName) {
        usageQuery.$or.push({
            levelUpMoves: {
                $elemMatch: {
                    moveName: { $regex: `^${escapeRegExp(normalizedMoveName)}$`, $options: 'i' },
                    $or: [{ moveId: null }, { moveId: { $exists: false } }],
                },
            },
        })
    }

    return Pokemon.countDocuments(usageQuery)
}

const getMoveEffectProgressSnapshot = async () => {
    const [coverageRows, opUsageRows, flavorReasonRows] = await Promise.all([
        Move.aggregate([
            {
                $addFields: {
                    effectSpecsSafe: { $ifNull: ['$effectSpecs', []] },
                },
            },
            {
                $addFields: {
                    effectSpecCount: { $size: '$effectSpecsSafe' },
                    implementedEffectCount: {
                        $size: {
                            $filter: {
                                input: '$effectSpecsSafe',
                                as: 'spec',
                                cond: {
                                    $and: [
                                        { $ne: ['$$spec.op', 'flavor_only'] },
                                        { $ne: ['$$spec.op', 'no_op'] },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    totalMoves: { $sum: 1 },
                    movesWithAnyEffects: {
                        $sum: {
                            $cond: [{ $gt: ['$effectSpecCount', 0] }, 1, 0],
                        },
                    },
                    movesWithImplementedEffects: {
                        $sum: {
                            $cond: [{ $gt: ['$implementedEffectCount', 0] }, 1, 0],
                        },
                    },
                    movesOnlyIncompleteEffects: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: ['$effectSpecCount', 0] },
                                        { $eq: ['$implementedEffectCount', 0] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        Move.aggregate([
            {
                $unwind: {
                    path: '$effectSpecs',
                    preserveNullAndEmptyArrays: false,
                },
            },
            {
                $group: {
                    _id: '$effectSpecs.op',
                    usageCount: { $sum: 1 },
                },
            },
            { $sort: { usageCount: -1, _id: 1 } },
        ]),
        Move.aggregate([
            {
                $unwind: {
                    path: '$effectSpecs',
                    preserveNullAndEmptyArrays: false,
                },
            },
            {
                $match: {
                    'effectSpecs.op': 'flavor_only',
                },
            },
            {
                $group: {
                    _id: {
                        $ifNull: ['$effectSpecs.params.reason', 'unmodeled_effect'],
                    },
                    usageCount: { $sum: 1 },
                },
            },
            { $sort: { usageCount: -1, _id: 1 } },
        ]),
    ])

    const coverage = coverageRows?.[0] || {
        totalMoves: 0,
        movesWithAnyEffects: 0,
        movesWithImplementedEffects: 0,
        movesOnlyIncompleteEffects: 0,
    }

    const opUsageMap = new Map(
        (opUsageRows || []).map((entry) => [String(entry?._id || '').trim().toLowerCase(), Number(entry?.usageCount || 0)])
    )
    const registeredOps = [...new Set(getRegisteredEffectOps().map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))]
    const allOps = [...new Set([...registeredOps, ...opUsageMap.keys()])]

    const completeEffects = allOps
        .filter((op) => isImplementedEffectOp(op))
        .map((op) => ({
            ...buildEffectOpMeta(op),
            usageCount: Number(opUsageMap.get(op) || 0),
        }))
        .sort((a, b) => b.usageCount - a.usageCount || a.id.localeCompare(b.id))

    const incompleteEffects = (flavorReasonRows || [])
        .map((entry) => ({
            ...buildEffectReasonMeta(entry?._id),
            usageCount: Number(entry?.usageCount || 0),
        }))
        .sort((a, b) => b.usageCount - a.usageCount || a.id.localeCompare(b.id))

    const selectableEffects = completeEffects
        .map((entry) => ({
            ...entry,
            defaultEffectSpec: getDefaultEffectSpecForOp(entry.id),
        }))
        .sort((a, b) => a.nameEn.localeCompare(b.nameEn))

    const totalMoves = Number(coverage.totalMoves || 0)
    const movesWithImplementedEffects = Number(coverage.movesWithImplementedEffects || 0)
    const completionRate = totalMoves > 0
        ? Number(((movesWithImplementedEffects / totalMoves) * 100).toFixed(2))
        : 0

    return {
        summary: {
            totalMoves,
            movesWithAnyEffects: Number(coverage.movesWithAnyEffects || 0),
            movesWithImplementedEffects,
            movesOnlyIncompleteEffects: Number(coverage.movesOnlyIncompleteEffects || 0),
            completionRate,
            totalCompleteEffects: completeEffects.length,
            totalIncompleteEffects: incompleteEffects.length,
        },
        completeEffects,
        incompleteEffects,
        selectableEffects,
        triggerOptions: getEffectTriggerOptions(),
        targetOptions: getEffectTargetOptions(),
    }
}

router.get('/effects/progress', async (_req, res) => {
    try {
        const progress = await getMoveEffectProgressSnapshot()
        res.json({ ok: true, ...progress })
    } catch (error) {
        console.error('GET /api/admin/moves/effects/progress error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.get('/effects/catalog', async (_req, res) => {
    try {
        const progress = await getMoveEffectProgressSnapshot()
        res.json({
            ok: true,
            effects: progress.selectableEffects,
            triggerOptions: progress.triggerOptions,
            targetOptions: progress.targetOptions,
        })
    } catch (error) {
        console.error('GET /api/admin/moves/effects/catalog error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/moves - List moves with search & pagination
router.get('/', async (req, res) => {
    try {
        const {
            search,
            type,
            category,
            rarity,
            sortBy,
            effectState,
            page = 1,
            limit = 20,
        } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
        const resolvedSortBy = resolveMoveSortKey(sortBy)
        const resolvedEffectState = normalizeEffectStateFilter(effectState)

        const query = {}

        if (search) {
            query.nameLower = { $regex: escapeRegExp(String(search).toLowerCase()), $options: 'i' }
        }
        if (type) {
            query.type = String(type).trim().toLowerCase()
        }
        if (category) {
            query.category = String(category).trim().toLowerCase()
        }
        if (rarity) {
            query.rarity = String(rarity).trim().toLowerCase()
        }

        const skip = (safePage - 1) * safeLimit
        const effectStateMatch = buildEffectStateMatchStage(resolvedEffectState)
        const sortStage = resolveMoveSortStage(resolvedSortBy)

        const aggregationResult = await Move.aggregate([
            { $match: query },
            {
                $addFields: {
                    effectSpecsSafe: { $ifNull: ['$effectSpecs', []] },
                },
            },
            {
                $addFields: {
                    effectSpecCount: { $size: '$effectSpecsSafe' },
                    implementedEffectCount: {
                        $size: {
                            $filter: {
                                input: '$effectSpecsSafe',
                                as: 'spec',
                                cond: {
                                    $and: [
                                        { $ne: ['$$spec.op', 'flavor_only'] },
                                        { $ne: ['$$spec.op', 'no_op'] },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
            {
                $addFields: {
                    incompleteEffectCount: {
                        $max: [
                            0,
                            { $subtract: ['$effectSpecCount', '$implementedEffectCount'] },
                        ],
                    },
                    hasImplementedEffects: { $gt: ['$implementedEffectCount', 0] },
                },
            },
            ...(effectStateMatch ? [{ $match: effectStateMatch }] : []),
            {
                $facet: {
                    rows: [
                        { $sort: sortStage },
                        { $skip: skip },
                        { $limit: safeLimit },
                        {
                            $project: {
                                effectSpecsSafe: 0,
                            },
                        },
                    ],
                    total: [{ $count: 'count' }],
                },
            },
        ])

        const moves = aggregationResult?.[0]?.rows || []
        const total = Number(aggregationResult?.[0]?.total?.[0]?.count || 0)

        res.json({
            ok: true,
            moves,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
            meta: {
                types: MOVE_TYPES,
                categories: MOVE_CATEGORIES,
                rarities: MOVE_RARITIES,
                learnScopes: MOVE_LEARN_SCOPES,
                sortOptions: [...MOVE_SORT_OPTIONS],
                currentSort: resolvedSortBy,
                effectStateOptions: ['all', 'implemented', 'incomplete', 'none'],
                currentEffectState: resolvedEffectState,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/moves error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/moves/shop/bulk-apply - Bulk enable shop for implemented-effect moves
router.post('/shop/bulk-apply', async (req, res) => {
    try {
        const parsedShopPrice = Number(req.body?.shopPrice)
        if (!Number.isFinite(parsedShopPrice) || parsedShopPrice < 0) {
            return res.status(400).json({ ok: false, message: 'Giá bán phải là số không âm' })
        }

        const shopPrice = Math.floor(parsedShopPrice)
        const implementedEffectQuery = {
            effectSpecs: {
                $elemMatch: {
                    op: { $nin: ['flavor_only', 'no_op'] },
                },
            },
        }

        const updatableQuery = {
            ...implementedEffectQuery,
            $or: [
                { isShopEnabled: { $ne: true } },
                { shopPrice: { $ne: shopPrice } },
            ],
        }

        const [eligibleCount, updateResult, sampleMoves] = await Promise.all([
            Move.countDocuments(implementedEffectQuery),
            Move.updateMany(updatableQuery, {
                $set: {
                    isShopEnabled: true,
                    shopPrice,
                },
            }),
            Move.find(implementedEffectQuery)
                .sort({ createdAt: -1, _id: -1 })
                .limit(10)
                .select('name shopPrice isShopEnabled')
                .lean(),
        ])

        const updatedCount = Number(updateResult?.modifiedCount || 0)
        const unchangedCount = Math.max(0, Number(eligibleCount || 0) - updatedCount)

        return res.json({
            ok: true,
            message: `Đã cập nhật ${updatedCount.toLocaleString('vi-VN')} kỹ năng lên shop (chỉ kỹ năng có effect).`,
            result: {
                shopPrice,
                eligibleCount,
                updatedCount,
                unchangedCount,
                sampleMoves,
            },
        })
    } catch (error) {
        console.error('POST /api/admin/moves/shop/bulk-apply error:', error)
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/moves/shop/bulk-hide - Bulk hide moves from shop
router.post('/shop/bulk-hide', async (req, res) => {
    try {
        const onlyImplemented = toBoolean(req.body?.onlyImplemented, true)

        const baseQuery = onlyImplemented
            ? {
                isShopEnabled: true,
                effectSpecs: {
                    $elemMatch: {
                        op: { $nin: ['flavor_only', 'no_op'] },
                    },
                },
            }
            : { isShopEnabled: true }

        const [eligibleCount, updateResult, sampleMoves] = await Promise.all([
            Move.countDocuments(baseQuery),
            Move.updateMany(baseQuery, {
                $set: {
                    isShopEnabled: false,
                },
            }),
            Move.find(baseQuery)
                .sort({ createdAt: -1, _id: -1 })
                .limit(10)
                .select('name shopPrice isShopEnabled')
                .lean(),
        ])

        const updatedCount = Number(updateResult?.modifiedCount || 0)
        const unchangedCount = Math.max(0, Number(eligibleCount || 0) - updatedCount)

        return res.json({
            ok: true,
            message: `Đã ẩn ${updatedCount.toLocaleString('vi-VN')} kỹ năng khỏi shop.`,
            result: {
                onlyImplemented,
                eligibleCount,
                updatedCount,
                unchangedCount,
                sampleMoves,
            },
        })
    } catch (error) {
        console.error('POST /api/admin/moves/shop/bulk-hide error:', error)
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/moves/purchase-history - Purchase audit logs
router.get('/purchase-history', async (req, res) => {
    try {
        const { search, moveId, page = 1, limit = 20 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
        const skip = (safePage - 1) * safeLimit

        const preMatch = {}
        if (moveId && mongoose.Types.ObjectId.isValid(String(moveId))) {
            preMatch.moveId = new mongoose.Types.ObjectId(String(moveId))
        }

        const escapedSearch = String(search || '').trim()
        const hasSearch = escapedSearch.length > 0

        const [result, shopMoves] = await Promise.all([
            MovePurchaseLog.aggregate([
                ...(Object.keys(preMatch).length > 0 ? [{ $match: preMatch }] : []),
                {
                    $lookup: {
                        from: 'users',
                        localField: 'buyerId',
                        foreignField: '_id',
                        as: 'buyer',
                    },
                },
                {
                    $unwind: {
                        path: '$buyer',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $lookup: {
                        from: 'moves',
                        localField: 'moveId',
                        foreignField: '_id',
                        as: 'move',
                    },
                },
                {
                    $unwind: {
                        path: '$move',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                ...(hasSearch
                    ? [{
                        $match: {
                            $or: [
                                { moveName: { $regex: escapeRegExp(escapedSearch), $options: 'i' } },
                                { 'move.name': { $regex: escapeRegExp(escapedSearch), $options: 'i' } },
                                { 'buyer.username': { $regex: escapeRegExp(escapedSearch), $options: 'i' } },
                            ],
                        },
                    }]
                    : []),
                {
                    $facet: {
                        rows: [
                            { $sort: { createdAt: -1, _id: -1 } },
                            { $skip: skip },
                            { $limit: safeLimit },
                            {
                                $project: {
                                    _id: 1,
                                    quantity: 1,
                                    unitPrice: 1,
                                    totalCost: 1,
                                    walletGoldBefore: 1,
                                    walletGoldAfter: 1,
                                    createdAt: 1,
                                    move: {
                                        _id: '$move._id',
                                        name: { $ifNull: ['$move.name', '$moveName'] },
                                    },
                                    buyer: {
                                        _id: '$buyer._id',
                                        username: '$buyer.username',
                                        email: '$buyer.email',
                                    },
                                },
                            },
                        ],
                        total: [{ $count: 'count' }],
                    },
                },
            ]).allowDiskUse(true),
            Move.find({ isShopEnabled: true })
                .select('_id name')
                .sort({ nameLower: 1, _id: 1 })
                .lean(),
        ])

        const rows = result?.[0]?.rows || []
        const total = result?.[0]?.total?.[0]?.count || 0

        res.json({
            ok: true,
            logs: rows,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
            meta: {
                shopMoves,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/moves/purchase-history error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/moves/import/csv - Bulk create moves from parsed rows
router.post('/import/csv', async (req, res) => {
    try {
        const rawEntries = Array.isArray(req.body?.moves) ? req.body.moves : []
        if (rawEntries.length === 0) {
            return res.status(400).json({ ok: false, message: 'Thiếu danh sách kỹ năng import' })
        }
        if (rawEntries.length > IMPORT_MAX_ROWS) {
            return res.status(400).json({ ok: false, message: `Số lượng import quá lớn (tối đa ${IMPORT_MAX_ROWS} dòng)` })
        }

        const normalizedEntries = []
        const precheckErrors = []

        rawEntries.forEach((entry, index) => {
            const built = buildBulkImportMoveEntry(entry, index)
            if (built.error) {
                precheckErrors.push(built.error)
                return
            }
            normalizedEntries.push(built.value)
        })

        const namesInPayload = new Set()
        const dedupedEntries = []
        const skipped = []

        normalizedEntries.forEach((entry) => {
            const nameLower = String(entry.name || '').trim().toLowerCase()
            if (!nameLower || namesInPayload.has(nameLower)) {
                skipped.push({
                    name: entry.name,
                    reason: 'Trùng dữ liệu trong file import',
                })
                return
            }
            namesInPayload.add(nameLower)
            dedupedEntries.push(entry)
        })

        const existingDocs = await Move.find({ nameLower: { $in: dedupedEntries.map((entry) => String(entry.name || '').trim().toLowerCase()) } })
            .select('name nameLower')
            .lean()
        const existingNameSet = new Set(existingDocs.map((entry) => String(entry.nameLower || '').trim()).filter(Boolean))

        const created = []
        const saveErrors = []

        for (const entry of dedupedEntries) {
            const nameLower = String(entry.name || '').trim().toLowerCase()
            if (existingNameSet.has(nameLower)) {
                skipped.push({
                    name: entry.name,
                    reason: 'Đã tồn tại trong hệ thống',
                })
                continue
            }

            if (entry.learnScope === 'species') {
                const hasAllSpecies = await ensureAllowedPokemonIdsExist(entry.allowedPokemonIds)
                if (!hasAllSpecies) {
                    saveErrors.push(`Không thể tạo ${entry.name}: danh sách Pokemon đặc biệt không hợp lệ`)
                    continue
                }
            }

            try {
                const createdDoc = await Move.create(entry)
                created.push({
                    _id: createdDoc._id,
                    name: createdDoc.name,
                })
                existingNameSet.add(nameLower)
            } catch (error) {
                saveErrors.push(`Không thể tạo ${entry.name}: ${error.message}`)
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
        console.error('POST /api/admin/moves/import/csv error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Lỗi máy chủ' })
    }
})

// GET /api/admin/moves/:id - Get single move
router.get('/:id', async (req, res) => {
    try {
        const move = await Move.findById(req.params.id)
            .populate('allowedPokemonIds', 'name pokedexNumber')
            .lean()

        if (!move) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy kỹ năng' })
        }

        res.json({ ok: true, move })
    } catch (error) {
        console.error('GET /api/admin/moves/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/moves - Create move
router.post('/', async (req, res) => {
    try {
        const {
            name,
            type,
            category,
            power,
            accuracy,
            pp,
            priority,
            description,
            imageUrl,
            rarity,
            shopPrice,
            isShopEnabled,
            isActive,
            learnScope,
            allowedTypes,
            allowedPokemonIds,
            allowedRarities,
            effects,
            effectSpecs,
        } = req.body

        if (!name || !type || !category) {
            return res.status(400).json({ ok: false, message: 'Thiếu trường bắt buộc' })
        }

        if (!MOVE_TYPES.includes(String(type).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Hệ kỹ năng không hợp lệ' })
        }
        if (!MOVE_CATEGORIES.includes(String(category).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Nhóm kỹ năng không hợp lệ' })
        }
        if (rarity !== undefined && !MOVE_RARITIES.includes(String(rarity).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Độ hiếm kỹ năng không hợp lệ' })
        }

        const normalizedLearnConfig = normalizeLearnConfigInput({
            learnScope,
            allowedTypes,
            allowedPokemonIds,
            allowedRarities,
        })
        const learnValidationError = validateLearnConfig(normalizedLearnConfig)
        if (learnValidationError) {
            return res.status(400).json({ ok: false, message: learnValidationError })
        }
        const learnConfig = resolveLearnConfigByScope(normalizedLearnConfig)
        if (learnConfig.learnScope === 'species') {
            const hasAllSpecies = await ensureAllowedPokemonIdsExist(learnConfig.allowedPokemonIds)
            if (!hasAllSpecies) {
                return res.status(400).json({ ok: false, message: 'Danh sách Pokemon đặc biệt chứa id không tồn tại' })
            }
        }

        const parsedPower = parseNumberOrUndefined(power)
        const parsedAccuracy = parseNumberOrUndefined(accuracy)
        const parsedPp = parseNumberOrUndefined(pp)
        const parsedPriority = parseNumberOrUndefined(priority)
        const parsedShopPrice = parseNumberOrUndefined(shopPrice)

        if (Number.isNaN(parsedPower) || Number.isNaN(parsedAccuracy) || Number.isNaN(parsedPp) || Number.isNaN(parsedPriority) || Number.isNaN(parsedShopPrice)) {
            return res.status(400).json({ ok: false, message: 'Có trường số không hợp lệ' })
        }
        if (parsedShopPrice !== undefined && parsedShopPrice !== null && parsedShopPrice < 0) {
            return res.status(400).json({ ok: false, message: 'Giá cửa hàng không hợp lệ' })
        }

        const effectChance = Number.isFinite(Number(effects?.effectChance))
            ? Number(effects.effectChance)
            : null
        const parsedEffects = resolveEffectSpecsFromPayload({
            effectSpecs,
            description,
            effectChance,
        })
        const baseEffects = effects && typeof effects === 'object' ? { ...effects } : {}
        if (parsedEffects.parserWarnings.length > 0) {
            baseEffects.parserWarnings = parsedEffects.parserWarnings.slice(0, 5)
        }
        if (Number.isFinite(parsedEffects.parserConfidence)) {
            baseEffects.parserConfidence = parsedEffects.parserConfidence
        }

        const existing = await Move.findOne({ name })
        if (existing) {
            return res.status(409).json({ ok: false, message: 'Tên kỹ năng đã tồn tại' })
        }

        const move = new Move({
            name,
            type: String(type).trim().toLowerCase(),
            category: String(category).trim().toLowerCase(),
            power: parsedPower,
            accuracy: parsedAccuracy === null ? 100 : parsedAccuracy,
            pp: parsedPp === null ? 10 : parsedPp,
            priority: parsedPriority === null ? 0 : parsedPriority,
            description: description || '',
            imageUrl: imageUrl || '',
            rarity: rarity ? String(rarity).trim().toLowerCase() : 'common',
            shopPrice: parsedShopPrice === null || parsedShopPrice === undefined ? 0 : parsedShopPrice,
            isShopEnabled: toBoolean(isShopEnabled, false),
            isActive: toBoolean(isActive, true),
            learnScope: learnConfig.learnScope,
            allowedTypes: learnConfig.allowedTypes,
            allowedPokemonIds: learnConfig.allowedPokemonIds,
            allowedRarities: learnConfig.allowedRarities,
            effects: baseEffects,
            effectSpecs: parsedEffects.effectSpecs,
        })

        await move.save()

        res.status(201).json({ ok: true, move })
    } catch (error) {
        console.error('POST /api/admin/moves error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/moves/:id - Update move
router.put('/:id', async (req, res) => {
    try {
        const {
            name,
            type,
            category,
            power,
            accuracy,
            pp,
            priority,
            description,
            imageUrl,
            rarity,
            shopPrice,
            isShopEnabled,
            isActive,
            learnScope,
            allowedTypes,
            allowedPokemonIds,
            allowedRarities,
            effects,
            effectSpecs,
        } = req.body

        const move = await Move.findById(req.params.id)
        if (!move) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy kỹ năng' })
        }

        const usageCount = await countPokemonUsingMove(move)
        if (usageCount > 0) {
            return res.status(409).json({
                ok: false,
                message: `Không thể sửa kỹ năng đang được ${usageCount} Pokemon sử dụng trong bộ học chiêu`,
                errorCode: 'MOVE_IN_USE_BY_POKEMON',
                usageCount,
            })
        }

        if (type !== undefined && !MOVE_TYPES.includes(String(type).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Hệ kỹ năng không hợp lệ' })
        }
        if (category !== undefined && !MOVE_CATEGORIES.includes(String(category).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Nhóm kỹ năng không hợp lệ' })
        }
        if (rarity !== undefined && !MOVE_RARITIES.includes(String(rarity).trim().toLowerCase())) {
            return res.status(400).json({ ok: false, message: 'Độ hiếm kỹ năng không hợp lệ' })
        }

        const normalizedLearnConfig = normalizeLearnConfigInput({
            learnScope: learnScope !== undefined ? learnScope : move.learnScope,
            allowedTypes: allowedTypes !== undefined ? allowedTypes : move.allowedTypes,
            allowedPokemonIds: allowedPokemonIds !== undefined ? allowedPokemonIds : move.allowedPokemonIds,
            allowedRarities: allowedRarities !== undefined ? allowedRarities : move.allowedRarities,
        })
        const learnValidationError = validateLearnConfig(normalizedLearnConfig)
        if (learnValidationError) {
            return res.status(400).json({ ok: false, message: learnValidationError })
        }
        const learnConfig = resolveLearnConfigByScope(normalizedLearnConfig)
        if (learnConfig.learnScope === 'species') {
            const hasAllSpecies = await ensureAllowedPokemonIdsExist(learnConfig.allowedPokemonIds)
            if (!hasAllSpecies) {
                return res.status(400).json({ ok: false, message: 'Danh sách Pokemon đặc biệt chứa id không tồn tại' })
            }
        }

        if (name && name !== move.name) {
            const conflict = await Move.findOne({ _id: { $ne: move._id }, name })
            if (conflict) {
                return res.status(409).json({ ok: false, message: 'Tên kỹ năng đã tồn tại' })
            }
        }

        const parsedPower = parseNumberOrUndefined(power)
        const parsedAccuracy = parseNumberOrUndefined(accuracy)
        const parsedPp = parseNumberOrUndefined(pp)
        const parsedPriority = parseNumberOrUndefined(priority)
        const parsedShopPrice = parseNumberOrUndefined(shopPrice)

        if (Number.isNaN(parsedPower) || Number.isNaN(parsedAccuracy) || Number.isNaN(parsedPp) || Number.isNaN(parsedPriority) || Number.isNaN(parsedShopPrice)) {
            return res.status(400).json({ ok: false, message: 'Có trường số không hợp lệ' })
        }
        if (parsedShopPrice !== undefined && parsedShopPrice !== null && parsedShopPrice < 0) {
            return res.status(400).json({ ok: false, message: 'Giá cửa hàng không hợp lệ' })
        }

        const nextDescriptionForParse = description !== undefined ? description : move.description
        const fallbackEffectChance = Number.isFinite(Number(move?.effects?.effectChance))
            ? Number(move.effects.effectChance)
            : null
        const nextEffectChance = Number.isFinite(Number(effects?.effectChance))
            ? Number(effects.effectChance)
            : fallbackEffectChance

        let resolvedEffectSpecs = move.effectSpecs || []
        let resolvedEffects = move.effects && typeof move.effects === 'object' ? { ...move.effects } : {}

        if (effectSpecs !== undefined || description !== undefined || effects !== undefined) {
            const parsedEffects = resolveEffectSpecsFromPayload({
                effectSpecs,
                description: nextDescriptionForParse,
                effectChance: nextEffectChance,
            })
            resolvedEffectSpecs = parsedEffects.effectSpecs
            resolvedEffects = {
                ...(effects && typeof effects === 'object' ? effects : resolvedEffects),
            }
            if (parsedEffects.parserWarnings.length > 0) {
                resolvedEffects.parserWarnings = parsedEffects.parserWarnings.slice(0, 5)
            }
            if (Number.isFinite(parsedEffects.parserConfidence)) {
                resolvedEffects.parserConfidence = parsedEffects.parserConfidence
            }
        }

        if (name !== undefined) move.name = name
        if (type !== undefined) move.type = String(type).trim().toLowerCase()
        if (category !== undefined) move.category = String(category).trim().toLowerCase()
        if (power !== undefined) move.power = parsedPower
        if (accuracy !== undefined) move.accuracy = parsedAccuracy === null ? 100 : parsedAccuracy
        if (pp !== undefined) move.pp = parsedPp === null ? 10 : parsedPp
        if (priority !== undefined) move.priority = parsedPriority === null ? 0 : parsedPriority
        if (description !== undefined) move.description = description || ''
        if (imageUrl !== undefined) move.imageUrl = imageUrl || ''
        if (rarity !== undefined) move.rarity = String(rarity).trim().toLowerCase()
        if (shopPrice !== undefined) move.shopPrice = parsedShopPrice === null ? 0 : parsedShopPrice
        if (isShopEnabled !== undefined) move.isShopEnabled = toBoolean(isShopEnabled, move.isShopEnabled)
        if (isActive !== undefined) move.isActive = toBoolean(isActive, move.isActive)
        if (learnScope !== undefined || allowedTypes !== undefined || allowedPokemonIds !== undefined || allowedRarities !== undefined) {
            move.learnScope = learnConfig.learnScope
            move.allowedTypes = learnConfig.allowedTypes
            move.allowedPokemonIds = learnConfig.allowedPokemonIds
            move.allowedRarities = learnConfig.allowedRarities
        }
        if (effectSpecs !== undefined || description !== undefined || effects !== undefined) {
            move.effects = resolvedEffects
            move.effectSpecs = resolvedEffectSpecs
        }

        await move.save()

        res.json({ ok: true, move })
    } catch (error) {
        console.error('PUT /api/admin/moves/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/moves/:id
router.delete('/:id', async (req, res) => {
    try {
        const move = await Move.findById(req.params.id)
        if (!move) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy kỹ năng' })
        }

        const usageCount = await countPokemonUsingMove(move)
        if (usageCount > 0) {
            return res.status(409).json({
                ok: false,
                message: `Không thể xóa kỹ năng đang được ${usageCount} Pokemon sử dụng trong bộ học chiêu`,
                errorCode: 'MOVE_IN_USE_BY_POKEMON',
                usageCount,
            })
        }

        await move.deleteOne()

        res.json({ ok: true, message: 'Đã xóa kỹ năng' })
    } catch (error) {
        console.error('DELETE /api/admin/moves/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
