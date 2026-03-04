import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import Move from '../models/Move.js'
import UserMoveInventory from '../models/UserMoveInventory.js'
import { calcStatsForLevel, calcMaxHp } from '../utils/gameUtils.js'
import {
    buildMovesForLevel,
    buildMoveLookupByName,
    buildMovePpStateFromMoves,
    mergeKnownMovesWithFallback,
    normalizeMoveName,
    syncUserPokemonMovesAndPp,
} from '../utils/movePpUtils.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value
    const normalized = String(value || '').trim().toLowerCase()
    return ['1', 'true', 'yes', 'on'].includes(normalized)
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const normalizeStringSet = (values) => new Set(
    (Array.isArray(values) ? values : [])
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
)

const toDisplayMovePpState = (entries = []) => (Array.isArray(entries) ? entries : [])
    .map((entry) => {
        const moveName = String(entry?.moveName || '').trim()
        const maxPp = Math.max(1, Number(entry?.maxPp || 1))
        return {
            moveName,
            currentPp: maxPp,
            maxPp,
        }
    })
    .filter((entry) => entry.moveName)

const evaluateMoveLearnRestriction = (move, pokemonSpecies) => {
    const learnScope = String(move?.learnScope || 'all').trim().toLowerCase() || 'all'
    const speciesId = String(pokemonSpecies?._id || '').trim()
    const speciesTypes = normalizeStringSet(pokemonSpecies?.types)
    const speciesRarity = String(pokemonSpecies?.rarity || '').trim().toLowerCase()

    if (learnScope === 'all') {
        return { canLearn: true, reason: '' }
    }

    if (learnScope === 'move_type') {
        const moveType = String(move?.type || '').trim().toLowerCase()
        if (!moveType || !speciesTypes.has(moveType)) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon cùng hệ với kỹ năng',
            }
        }
        return { canLearn: true, reason: '' }
    }

    if (learnScope === 'type') {
        const allowedTypeSet = normalizeStringSet(move?.allowedTypes)
        const intersects = [...speciesTypes].some((entry) => allowedTypeSet.has(entry))
        if (!intersects) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon đúng hệ yêu cầu',
            }
        }
        return { canLearn: true, reason: '' }
    }

    if (learnScope === 'species') {
        const allowedIds = new Set((Array.isArray(move?.allowedPokemonIds) ? move.allowedPokemonIds : [])
            .map((entry) => {
                if (typeof entry === 'object') return String(entry?._id || '').trim()
                return String(entry || '').trim()
            })
            .filter(Boolean))
        if (!speciesId || !allowedIds.has(speciesId)) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ dành cho một số Pokemon đặc biệt',
            }
        }
        return { canLearn: true, reason: '' }
    }

    if (learnScope === 'rarity') {
        const allowedRarities = normalizeStringSet(move?.allowedRarities)
        if (!speciesRarity || !allowedRarities.has(speciesRarity)) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon huyền thoại/thần thoại',
            }
        }
        return { canLearn: true, reason: '' }
    }

    return { canLearn: true, reason: '' }
}

const resolveEvolutionRule = (species, currentFormId) => {
    const baseEvolution = species?.evolution || null
    const baseMinLevel = Number.parseInt(baseEvolution?.minLevel, 10)
    if (baseEvolution?.evolvesTo && Number.isFinite(baseMinLevel) && baseMinLevel >= 1) {
        return {
            evolvesTo: baseEvolution.evolvesTo,
            minLevel: baseMinLevel,
        }
    }

    const normalizedFormId = String(currentFormId || '').trim().toLowerCase()
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const matchedForm = forms.find((entry) => String(entry?.formId || '').trim().toLowerCase() === normalizedFormId) || null
    const formEvolution = matchedForm?.evolution || null
    const formMinLevel = Number.parseInt(formEvolution?.minLevel, 10)
    if (formEvolution?.evolvesTo && Number.isFinite(formMinLevel) && formMinLevel >= 1) {
        return {
            evolvesTo: formEvolution.evolvesTo,
            minLevel: formMinLevel,
        }
    }

    return null
}

const resolvePokemonFormDisplay = (pokemonLike, requestedFormId = null) => {
    if (!pokemonLike) {
        return {
            form: null,
            formId: 'normal',
            formName: 'normal',
            sprite: '',
        }
    }

    const forms = Array.isArray(pokemonLike.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike.defaultFormId || 'normal')
    const normalizedRequestedFormId = normalizeFormId(requestedFormId || defaultFormId)
    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === normalizedRequestedFormId) || null
    let resolvedFormId = normalizedRequestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return {
        form: resolvedForm,
        formId: resolvedFormId,
        formName: String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim(),
        sprite: resolvedForm?.sprites?.normal
            || resolvedForm?.sprites?.icon
            || resolvedForm?.imageUrl
            || pokemonLike.imageUrl
            || pokemonLike.sprites?.normal
            || pokemonLike.sprites?.icon
            || '',
    }
}

// GET /api/pokemon - Public master list (lightweight)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 200 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 200))
        const skip = (safePage - 1) * safeLimit

        const [pokemon, total] = await Promise.all([
            Pokemon.find({})
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(safeLimit)
                .select('name pokedexNumber imageUrl sprites types rarity forms defaultFormId')
                .lean(),
            Pokemon.countDocuments(),
        ])

        res.json({
            ok: true,
            pokemon,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
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
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
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
            .populate('userId', 'username _id avatar') // Populating owner info
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const basePokemon = userPokemon.pokemonId
        if (!basePokemon) {
            return res.status(404).json({ ok: false, message: 'Thiếu dữ liệu gốc của Pokemon' })
        }

        // Calculate actual stats based on level, rarity, (and potentially IVs/EVs in future)
        const level = userPokemon.level || 1
        const rarity = basePokemon.rarity
        const mergedMoves = mergeKnownMovesWithFallback(userPokemon.moves, basePokemon, level)
        const moveLookupMap = await buildMoveLookupByName(mergedMoves)
        const movePpState = buildMovePpStateFromMoves({
            moveNames: mergedMoves,
            movePpState: userPokemon.movePpState,
            moveLookupMap,
        })
        const movePpMap = new Map(
            movePpState.map((entry) => [
                normalizeMoveName(entry?.moveName),
                {
                    currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                    maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                },
            ])
        )
        const moveDetails = mergedMoves.map((moveName) => {
            const moveKey = normalizeMoveName(moveName)
            const moveMeta = moveLookupMap.get(moveKey) || {}
            const ppState = movePpMap.get(moveKey) || { currentPp: 0, maxPp: Math.max(1, Number(moveMeta?.pp) || 1) }
            return {
                name: String(moveMeta?.name || moveName || '').trim(),
                type: String(moveMeta?.type || '').trim().toLowerCase(),
                category: String(moveMeta?.category || '').trim().toLowerCase(),
                power: Number.isFinite(Number(moveMeta?.power)) ? Number(moveMeta.power) : null,
                accuracy: Number.isFinite(Number(moveMeta?.accuracy)) ? Number(moveMeta.accuracy) : null,
                currentPp: ppState.currentPp,
                maxPp: ppState.maxPp,
            }
        })

        // Base stats from species
        const stats = calcStatsForLevel(basePokemon.baseStats, level, rarity)
        const maxHp = calcMaxHp(basePokemon.baseStats?.hp, level, rarity)

        // Enhance response with calculated stats
        const responseData = {
            ...userPokemon,
            moves: mergedMoves,
            moveDetails,
            movePpState: toDisplayMovePpState(movePpState),
            stats: {
                ...stats,
                maxHp,
                currentHp: maxHp // Assuming full health for display or retrieve from separate state if tracked
            },
        }

        const currentFormId = normalizeFormId(userPokemon.formId || basePokemon.defaultFormId || 'normal')
        const evolutionRule = resolveEvolutionRule(basePokemon, userPokemon.formId)
        const minLevel = Number.isFinite(evolutionRule?.minLevel) ? evolutionRule.minLevel : null
        const hasValidRule = Boolean(evolutionRule?.evolvesTo) && Number.isFinite(minLevel) && minLevel >= 1
        let targetPokemon = null
        let previousPokemon = null

        if (hasValidRule) {
            const target = await Pokemon.findById(evolutionRule.evolvesTo)
                .select('name pokedexNumber imageUrl sprites forms defaultFormId')
                .lean()

            if (target) {
                const targetDisplay = resolvePokemonFormDisplay(target, currentFormId)
                targetPokemon = {
                    _id: target._id,
                    name: target.name,
                    pokedexNumber: target.pokedexNumber,
                    formId: targetDisplay.formId,
                    formName: targetDisplay.formName,
                    defaultFormId: target.defaultFormId || 'normal',
                    forms: Array.isArray(target.forms) ? target.forms : [],
                    sprites: {
                        normal: targetDisplay.sprite,
                    },
                }
            }
        }

        const previousSpecies = await Pokemon.findOne({
            'evolution.evolvesTo': basePokemon._id,
        })
            .select('name pokedexNumber imageUrl sprites forms defaultFormId')
            .lean()

        if (previousSpecies) {
            const previousDisplay = resolvePokemonFormDisplay(previousSpecies, currentFormId)
            previousPokemon = {
                _id: previousSpecies._id,
                name: previousSpecies.name,
                pokedexNumber: previousSpecies.pokedexNumber,
                sprites: {
                    normal: previousDisplay.sprite,
                },
            }
        }

        const speciesTotalInServer = await UserPokemon.countDocuments({ pokemonId: basePokemon._id })
        const [totalPokemonInServer, trackedSpeciesInServer, higherRankedSpecies] = await Promise.all([
            UserPokemon.countDocuments({}),
            UserPokemon.distinct('pokemonId').then((ids) => ids.length),
            UserPokemon.aggregate([
                {
                    $group: {
                        _id: '$pokemonId',
                        count: { $sum: 1 },
                    },
                },
                {
                    $match: {
                        count: { $gt: speciesTotalInServer },
                    },
                },
                { $count: 'total' },
            ]).allowDiskUse(true),
        ])

        const speciesRank = speciesTotalInServer > 0
            ? (Number(higherRankedSpecies?.[0]?.total) || 0) + 1
            : null

        responseData.evolution = {
            canEvolve: Boolean(targetPokemon) && level >= minLevel,
            evolutionLevel: hasValidRule ? minLevel : null,
            targetPokemon,
            previousPokemon,
        }

        responseData.serverStats = {
            speciesTotal: speciesTotalInServer,
            speciesRank,
            totalPokemon: totalPokemonInServer,
            trackedSpecies: trackedSpeciesInServer,
        }

        res.json({
            ok: true,
            pokemon: responseData
        })

    } catch (error) {
        console.error('Get Pokemon Detail Error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/:id/skills (protected) - Skills available from user inventory
router.get('/:id/skills', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const userPokemon = await UserPokemon.findOne({ _id: req.params.id, userId })
            .select('moves pokemonId level')
            .populate('pokemonId', 'types rarity levelUpMoves')
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }

        const knownMoves = mergeKnownMovesWithFallback(
            userPokemon.moves,
            userPokemon.pokemonId,
            Number(userPokemon.level) || 1
        )
        const knownMoveSet = new Set(knownMoves.map((entry) => normalizeMoveName(entry)))

        const inventoryEntries = await UserMoveInventory.find({
            userId,
            quantity: { $gt: 0 },
        })
            .populate('moveId', 'name type category power accuracy pp priority description imageUrl rarity isActive learnScope allowedTypes allowedPokemonIds allowedRarities')
            .sort({ updatedAt: -1, _id: -1 })
            .lean()

        const skills = inventoryEntries
            .map((entry) => {
                const move = entry.moveId
                if (!move || move.isActive === false) return null
                const moveName = String(move.name || '').trim()
                const moveKey = normalizeMoveName(moveName)
                const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId)

                let canLearn = Boolean(moveName) && !knownMoveSet.has(moveKey)
                let reason = canLearn ? '' : 'Pokemon đã biết kỹ năng này'

                if (canLearn && !restrictionResult.canLearn) {
                    canLearn = false
                    reason = restrictionResult.reason
                }

                return {
                    _id: entry._id,
                    moveId: move._id,
                    quantity: Number(entry.quantity || 0),
                    canLearn,
                    reason,
                    move: {
                        _id: move._id,
                        name: moveName,
                        type: move.type,
                        category: move.category,
                        power: move.power,
                        accuracy: move.accuracy,
                        pp: move.pp,
                        priority: move.priority,
                        description: move.description || '',
                        imageUrl: move.imageUrl || '',
                        rarity: move.rarity || 'common',
                        learnScope: move.learnScope || 'all',
                        allowedTypes: Array.isArray(move.allowedTypes) ? move.allowedTypes : [],
                        allowedPokemonIds: Array.isArray(move.allowedPokemonIds)
                            ? move.allowedPokemonIds.map((entry) => {
                                if (typeof entry === 'object') return String(entry?._id || '').trim()
                                return String(entry || '').trim()
                            }).filter(Boolean)
                            : [],
                        allowedRarities: Array.isArray(move.allowedRarities) ? move.allowedRarities : [],
                    },
                }
            })
            .filter(Boolean)
            .sort((a, b) => {
                const nameA = String(a?.move?.name || '').toLowerCase()
                const nameB = String(b?.move?.name || '').toLowerCase()
                if (nameA < nameB) return -1
                if (nameA > nameB) return 1
                return String(a.moveId).localeCompare(String(b.moveId))
            })

        res.json({
            ok: true,
            pokemon: {
                _id: req.params.id,
                moves: knownMoves,
            },
            skills,
        })
    } catch (error) {
        console.error('GET /api/pokemon/:id/skills error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/:id/teach-skill (protected)
router.post('/:id/teach-skill', authMiddleware, async (req, res) => {
    let consumedSkill = false
    let consumeIdentity = null

    try {
        const userId = req.user.userId
        const moveId = String(req.body?.moveId || '').trim()
        const rawReplaceMoveIndex = req.body?.replaceMoveIndex

        if (!moveId) {
            return res.status(400).json({ ok: false, message: 'Thiếu moveId' })
        }

        const [userPokemon, move] = await Promise.all([
            UserPokemon.findOne({ _id: req.params.id, userId })
                .populate('pokemonId', 'types rarity levelUpMoves'),
            Move.findOne({ _id: moveId, isActive: true })
                .select('name type category power accuracy pp priority learnScope allowedTypes allowedPokemonIds allowedRarities')
                .lean(),
        ])

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }
        if (!move || !String(move.name || '').trim()) {
            return res.status(404).json({ ok: false, message: 'Kỹ năng không tồn tại hoặc đã bị vô hiệu hóa' })
        }

        const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId)
        if (!restrictionResult.canLearn) {
            return res.status(400).json({ ok: false, message: restrictionResult.reason })
        }

        const inventoryEntry = await UserMoveInventory.findOne({
            userId,
            moveId,
            quantity: { $gt: 0 },
        })
            .select('quantity')
            .lean()

        if (!inventoryEntry) {
            return res.status(400).json({ ok: false, message: 'Bạn không có kỹ năng này trong kho' })
        }

        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            level: userPokemon.level,
        })
        const currentMoves = Array.isArray(userPokemon.moves)
            ? userPokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
            : []

        const moveName = String(move.name || '').trim()
        const moveKey = normalizeMoveName(moveName)
        const knownMoveSet = new Set(currentMoves.map((entry) => normalizeMoveName(entry)))
        if (knownMoveSet.has(moveKey)) {
            return res.status(400).json({ ok: false, message: 'Pokemon đã biết kỹ năng này' })
        }

        let replaceMoveIndex = null
        if (rawReplaceMoveIndex !== undefined && rawReplaceMoveIndex !== null && rawReplaceMoveIndex !== '') {
            const parsed = parseInt(rawReplaceMoveIndex, 10)
            replaceMoveIndex = Number.isInteger(parsed) ? parsed : null
        }

        if (currentMoves.length >= 4 && (replaceMoveIndex === null || replaceMoveIndex < 0 || replaceMoveIndex >= currentMoves.length)) {
            return res.status(400).json({
                ok: false,
                message: 'Pokemon đã đủ 4 kỹ năng, vui lòng chọn kỹ năng cần thay thế',
            })
        }

        const consumeFilter = {
            userId,
            moveId,
            quantity: { $gte: 1 },
        }
        consumeIdentity = { userId, moveId }

        const consumedEntry = await UserMoveInventory.findOneAndUpdate(
            consumeFilter,
            { $inc: { quantity: -1 } },
            { new: true }
        )

        if (!consumedEntry) {
            return res.status(409).json({ ok: false, message: 'Kỹ năng trong kho đã thay đổi, vui lòng thử lại' })
        }
        consumedSkill = true

        const nextMoves = [...currentMoves]
        let replacedMove = null
        if (nextMoves.length < 4) {
            nextMoves.push(moveName)
        } else {
            replacedMove = nextMoves[replaceMoveIndex]
            nextMoves[replaceMoveIndex] = moveName
        }

        userPokemon.moves = nextMoves
        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            level: userPokemon.level,
        })
        await userPokemon.save()

        if (consumedEntry.quantity <= 0) {
            await UserMoveInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
        }

        return res.json({
            ok: true,
            message: replacedMove
                ? `${userPokemon.nickname || 'Pokemon'} đã học ${moveName} và quên ${replacedMove}`
                : `${userPokemon.nickname || 'Pokemon'} đã học ${moveName}`,
            pokemon: {
                _id: userPokemon._id,
                moves: userPokemon.moves,
                movePpState: toDisplayMovePpState(userPokemon.movePpState),
            },
            taughtMove: {
                _id: move._id,
                name: moveName,
                type: move.type,
                category: move.category,
                power: move.power,
                accuracy: move.accuracy,
                pp: move.pp,
                priority: move.priority,
            },
            replacedMove,
            inventory: {
                moveId,
                remainingQuantity: Math.max(0, Number(consumedEntry.quantity || 0)),
            },
        })
    } catch (error) {
        if (consumedSkill && consumeIdentity) {
            try {
                await UserMoveInventory.updateOne(consumeIdentity, { $inc: { quantity: 1 } }, { upsert: true })
            } catch (rollbackError) {
                console.error('POST /api/pokemon/:id/teach-skill rollback error:', rollbackError)
            }
        }
        console.error('POST /api/pokemon/:id/teach-skill error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/:id/remove-skill (protected)
router.post('/:id/remove-skill', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const rawMoveName = String(req.body?.moveName || '').trim()
        const rawMoveIndex = req.body?.moveIndex

        const userPokemon = await UserPokemon.findOne({ _id: req.params.id, userId })
            .populate('pokemonId', 'levelUpMoves')

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }

        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            level: userPokemon.level,
        })

        const currentMoves = Array.isArray(userPokemon.moves)
            ? userPokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
            : []

        let moveIndex = -1
        if (rawMoveName) {
            const targetKey = normalizeMoveName(rawMoveName)
            moveIndex = currentMoves.findIndex((entry) => normalizeMoveName(entry) === targetKey)
        } else if (rawMoveIndex !== undefined && rawMoveIndex !== null && rawMoveIndex !== '') {
            const parsed = Number.parseInt(rawMoveIndex, 10)
            if (Number.isInteger(parsed)) {
                moveIndex = parsed
            }
        }

        if (moveIndex < 0 || moveIndex >= currentMoves.length) {
            return res.status(400).json({ ok: false, message: 'Không tìm thấy kỹ năng cần gỡ' })
        }

        const moveName = currentMoves[moveIndex]
        const levelLearnedMoves = buildMovesForLevel(userPokemon.pokemonId, userPokemon.level)
        const defaultMoveSet = new Set(levelLearnedMoves.map((entry) => normalizeMoveName(entry)))
        defaultMoveSet.add('struggle')

        if (defaultMoveSet.has(normalizeMoveName(moveName))) {
            return res.status(400).json({ ok: false, message: 'Không thể gỡ kỹ năng mặc định của Pokemon' })
        }

        let nextMoves = currentMoves.filter((_, index) => index !== moveIndex)
        if (nextMoves.length === 0) {
            const fallbackMoves = mergeKnownMovesWithFallback([], userPokemon.pokemonId, userPokemon.level)
            nextMoves = fallbackMoves.length > 0 ? fallbackMoves : ['Struggle']
        }
        const removeKey = normalizeMoveName(moveName)
        let nextMovePpState = (Array.isArray(userPokemon.movePpState) ? userPokemon.movePpState : [])
            .filter((entry) => normalizeMoveName(entry?.moveName) !== removeKey)

        if (nextMoves.length > 0) {
            const nextMoveKeySet = new Set(nextMoves.map((entry) => normalizeMoveName(entry)))
            nextMovePpState = nextMovePpState.filter((entry) => nextMoveKeySet.has(normalizeMoveName(entry?.moveName)))
        }

        userPokemon.moves = nextMoves
        userPokemon.movePpState = nextMovePpState
        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            level: userPokemon.level,
        })
        await userPokemon.save()

        res.json({
            ok: true,
            message: `${userPokemon.nickname || 'Pokemon'} đã gỡ kỹ năng ${moveName}`,
            pokemon: {
                _id: userPokemon._id,
                moves: userPokemon.moves,
                movePpState: toDisplayMovePpState(userPokemon.movePpState),
            },
            removedMove: moveName,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/remove-skill error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/:id/evolve (protected)
router.post('/:id/evolve', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const userPokemon = await UserPokemon.findOne({ _id: req.params.id, userId })
            .populate('pokemonId')

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const currentSpecies = userPokemon.pokemonId
        if (!currentSpecies) {
            return res.status(404).json({ ok: false, message: 'Thiếu dữ liệu gốc của Pokemon' })
        }

        const evolutionRule = resolveEvolutionRule(currentSpecies, userPokemon.formId)
        if (!evolutionRule?.evolvesTo || !Number.isFinite(evolutionRule.minLevel) || evolutionRule.minLevel < 1) {
            return res.status(400).json({ ok: false, message: 'Pokemon này không có tiến hóa theo cấp độ' })
        }

        if (userPokemon.level < evolutionRule.minLevel) {
            return res.status(400).json({ ok: false, message: `Cần đạt cấp ${evolutionRule.minLevel} để tiến hóa` })
        }

        const targetSpecies = await Pokemon.findById(evolutionRule.evolvesTo)
            .select('name imageUrl sprites forms defaultFormId levelUpMoves')
            .lean()

        if (!targetSpecies) {
            return res.status(404).json({ ok: false, message: 'Pokemon tiến hóa không tồn tại' })
        }

        const targetForms = Array.isArray(targetSpecies.forms) ? targetSpecies.forms : []
        const currentFormId = String(userPokemon.formId || '').trim().toLowerCase()
        const canKeepForm = currentFormId && targetForms.some((entry) => String(entry?.formId || '').trim().toLowerCase() === currentFormId)
        const nextFormId = canKeepForm
            ? currentFormId
            : (String(targetSpecies.defaultFormId || '').trim().toLowerCase() || 'normal')

        const fromName = currentSpecies.name
        userPokemon.pokemonId = targetSpecies._id
        userPokemon.formId = nextFormId
        userPokemon.moves = buildMovesForLevel(targetSpecies, userPokemon.level)
        await syncUserPokemonMovesAndPp(userPokemon, {
            pokemonSpecies: targetSpecies,
            level: userPokemon.level,
        })
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
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
