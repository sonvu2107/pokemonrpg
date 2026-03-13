import express from 'express'
import BattleTrainer from '../../models/BattleTrainer.js'
import Pokemon from '../../models/Pokemon.js'
import Item from '../../models/Item.js'
import User from '../../models/User.js'
import BattleSession from '../../models/BattleSession.js'

const router = express.Router()

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
const TEAM_DAMAGE_PERCENT_MIN = 0
const TEAM_DAMAGE_PERCENT_MAX = 1000
const TEAM_DAMAGE_BONUS_MIN = -100
const TEAM_DAMAGE_BONUS_MAX = 900
const TRAINER_LEVEL_MIN = 1
const activeBattleTrainerFilter = {
    $or: [
        { isActive: true },
        { isActive: { $exists: false } },
        { isActive: null },
    ],
}

const clampNumber = (value, min, max) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return min
    return Math.min(max, Math.max(min, parsed))
}

const parseRewardNumber = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback
    return Math.max(0, Number.parseInt(value, 10) || 0)
}

const parseOptionalRewardNumber = (value) => {
    if (value === undefined || value === null || value === '') return null
    return parseRewardNumber(value, 0)
}

const resolveMoonPointsReward = ({ moonPointsReward, fallback = 0 }) => {
    return parseRewardNumber(moonPointsReward, fallback)
}

const parsePositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return fallback
    return parsed
}

const parseNonNegativeInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return fallback
    return parsed
}

const parseOptionalPrizeLevel = (value) => {
    if (value === undefined || value === null || value === '') return 0
    return clampNumber(value, 1, 1000)
}

const parsePoolPrizeLevel = (value) => {
    if (value === undefined || value === null || value === '') return 0
    return clampNumber(value, 0, 1000)
}

const parseTeamDamagePercent = (value, fallback = 100) => {
    if (value === undefined || value === null || value === '') return fallback
    return clampNumber(value, TEAM_DAMAGE_PERCENT_MIN, TEAM_DAMAGE_PERCENT_MAX)
}

const parseTeamDamageBonusPercent = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback
    return clampNumber(value, TEAM_DAMAGE_BONUS_MIN, TEAM_DAMAGE_BONUS_MAX)
}

const parseDamageBonusRules = (rulesLike = []) => {
    if (!Array.isArray(rulesLike)) return []

    return rulesLike
        .map((rule) => {
            if (!rule || typeof rule !== 'object') return null

            const fromInput = parsePositiveInt(rule?.fromLevel ?? rule?.startLevel ?? rule?.minLevel, 1)
            const toInput = parsePositiveInt(rule?.toLevel ?? rule?.endLevel ?? rule?.maxLevel, fromInput)
            const normalizedFrom = Math.max(1, Math.min(fromInput, toInput))
            const normalizedTo = Math.max(normalizedFrom, Math.max(fromInput, toInput))
            const bonusPercent = parseTeamDamageBonusPercent(rule?.bonusPercent ?? rule?.damageBonusPercent, 0)

            return {
                fromLevel: normalizedFrom,
                toLevel: normalizedTo,
                bonusPercent,
            }
        })
        .filter(Boolean)
}

const resolveDefaultAutoDamagePercentByLevel = (level) => {
    const normalizedLevel = parsePositiveInt(level, 1)
    if (normalizedLevel >= 1900) return 320
    if (normalizedLevel >= 1700) return 280
    if (normalizedLevel >= 1500) return 240
    if (normalizedLevel >= 1200) return 210
    if (normalizedLevel >= 900) return 180
    if (normalizedLevel >= 700) return 160
    if (normalizedLevel >= 500) return 140
    return 100
}

const resolveTeamDamagePercentByLevel = (level, damageBonusRules = []) => {
    const normalizedLevel = parsePositiveInt(level, 1)
    if (!Array.isArray(damageBonusRules) || damageBonusRules.length === 0) {
        return resolveDefaultAutoDamagePercentByLevel(normalizedLevel)
    }

    let appliedBonusPercent = 0
    damageBonusRules.forEach((rule) => {
        const fromLevel = parsePositiveInt(rule?.fromLevel, 1)
        const toLevel = Math.max(fromLevel, parsePositiveInt(rule?.toLevel, fromLevel))
        if (normalizedLevel >= fromLevel && normalizedLevel <= toLevel) {
            appliedBonusPercent = parseTeamDamageBonusPercent(rule?.bonusPercent, 0)
        }
    })

    return clampNumber(100 + appliedBonusPercent, TEAM_DAMAGE_PERCENT_MIN, TEAM_DAMAGE_PERCENT_MAX)
}

const resolveMilestoneRarityPatternByLevel = (level, teamSize = 3) => {
    const normalizedLevel = parsePositiveInt(level, 1)
    const normalizedTeamSize = Math.max(1, parsePositiveInt(teamSize, 3))

    if (normalizedLevel % 500 === 0) {
        return Array.from({ length: normalizedTeamSize }, () => 'sss')
    }

    if (normalizedLevel % 100 === 0) {
        const pattern = ['ss', 'sss', 'ss']
        return Array.from({ length: normalizedTeamSize }, (_, index) => pattern[index % pattern.length])
    }

    return []
}

const createSeededRandom = (seedValue = Date.now()) => {
    let state = (Math.abs(Number(seedValue) || 0) + 1) >>> 0
    return () => {
        state = (state + 0x6D2B79F5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const normalizeTeam = (team) => {
    if (!Array.isArray(team)) return []
    return team
        .map((entry) => ({
            pokemonId: entry?.pokemonId || entry?.pokemon || entry?._id || '',
            level: Number(entry?.level) || 5,
            formId: String(entry?.formId || 'normal').trim(),
            damagePercent: parseTeamDamagePercent(entry?.damagePercent, 100),
        }))
        .filter((entry) => entry.pokemonId)
}

const validateTeam = async (team) => {
    if (!team.length) return null
    const ids = team.map((entry) => entry.pokemonId)
    const count = await Pokemon.countDocuments({ _id: { $in: ids } })
    if (count !== ids.length) return 'Đội hình chứa Pokemon id không hợp lệ'
    return null
}

const resolvePrizePokemonSelection = async (pokemonId, formId) => {
    const normalizedPokemonId = String(pokemonId || '').trim()
    if (!normalizedPokemonId) {
        return {
            prizePokemonId: null,
            prizePokemonFormId: 'normal',
            error: null,
        }
    }

    const prizePokemon = await Pokemon.findById(normalizedPokemonId)
        .select('_id forms defaultFormId')
        .lean()

    if (!prizePokemon) {
        return {
            prizePokemonId: null,
            prizePokemonFormId: 'normal',
            error: 'Pokemon phần thưởng không hợp lệ',
        }
    }

    const forms = Array.isArray(prizePokemon.forms) ? prizePokemon.forms : []
    const defaultFormId = normalizeFormId(prizePokemon.defaultFormId)
    const requestedFormId = normalizeFormId(formId)

    let resolvedFormId = requestedFormId
    if (forms.length > 0) {
        const hasRequestedForm = forms.some((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        if (!hasRequestedForm) {
            const fallbackFormId = normalizeFormId(forms[0]?.formId)
            resolvedFormId = defaultFormId || fallbackFormId || 'normal'
        }
    } else {
        resolvedFormId = defaultFormId || requestedFormId || 'normal'
    }

    return {
        prizePokemonId: prizePokemon._id,
        prizePokemonFormId: resolvedFormId,
        error: null,
    }
}

const resolvePrizePokemonPoolSelections = async (poolLike = []) => {
    const rawEntries = Array.isArray(poolLike) ? poolLike : []
    const normalizedEntries = rawEntries
        .map((entry) => {
            if (typeof entry === 'string') {
                return {
                    pokemonId: String(entry || '').trim(),
                    formId: 'normal',
                    level: 0,
                }
            }

            if (!entry || typeof entry !== 'object') return null

            return {
                pokemonId: String(entry?.pokemonId || entry?._id || entry?.id || '').trim(),
                formId: normalizeFormId(entry?.formId || 'normal'),
                level: parsePoolPrizeLevel(entry?.level),
            }
        })
        .filter((entry) => entry && entry.pokemonId)

    if (normalizedEntries.length === 0) {
        return {
            selections: [],
            error: null,
        }
    }

    const resolvedEntries = await Promise.all(
        normalizedEntries.map(async (entry) => {
            const resolved = await resolvePrizePokemonSelection(entry.pokemonId, entry.formId)
            if (resolved.error || !resolved.prizePokemonId) {
                return {
                    error: resolved.error || `Pokemon phần thưởng không hợp lệ (${entry.pokemonId})`,
                    value: null,
                }
            }

            return {
                error: null,
                value: {
                    prizePokemonId: resolved.prizePokemonId,
                    prizePokemonFormId: resolved.prizePokemonFormId,
                    prizePokemonLevel: entry.level,
                },
            }
        })
    )

    const failedEntry = resolvedEntries.find((entry) => entry?.error)
    if (failedEntry) {
        return {
            selections: [],
            error: failedEntry.error,
        }
    }

    const dedupMap = new Map()
    resolvedEntries.forEach((entry) => {
        const value = entry?.value
        if (!value?.prizePokemonId) return
        const key = [
            String(value.prizePokemonId),
            String(value.prizePokemonFormId || 'normal').trim().toLowerCase(),
            Math.max(0, Number(value.prizePokemonLevel) || 0),
        ].join(':')
        if (!dedupMap.has(key)) {
            dedupMap.set(key, {
                prizePokemonId: value.prizePokemonId,
                prizePokemonFormId: String(value.prizePokemonFormId || 'normal').trim().toLowerCase() || 'normal',
                prizePokemonLevel: Math.max(0, Number(value.prizePokemonLevel) || 0),
            })
        }
    })

    return {
        selections: [...dedupMap.values()],
        error: null,
    }
}

const resolvePrizeItemSelection = async (itemId, quantity) => {
    const normalizedItemId = String(itemId || '').trim()
    if (!normalizedItemId) {
        return {
            prizeItemId: null,
            prizeItemQuantity: 1,
            error: null,
        }
    }

    const item = await Item.findById(normalizedItemId)
        .select('_id name')
        .lean()
    if (!item) {
        return {
            prizeItemId: null,
            prizeItemQuantity: 1,
            error: 'Vật phẩm phần thưởng không hợp lệ',
        }
    }

    return {
        prizeItemId: item._id,
        prizeItemQuantity: Math.max(1, Number.parseInt(quantity, 10) || 1),
        error: null,
    }
}

const buildAutoTeam = (pokemonPool, level, seed, teamSize = 3, damagePercent = 100) => {
    if (!Array.isArray(pokemonPool) || pokemonPool.length === 0) return []
    const normalizedTeamSize = clampNumber(teamSize, 1, 6)
    const normalizedDamagePercent = parseTeamDamagePercent(damagePercent, 100)
    const normalizedSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) : 1
    const random = createSeededRandom(normalizedSeed + parsePositiveInt(level, 1) * 9973 + normalizedTeamSize * 389)
    const normalizeRarity = (value) => String(value || '').trim().toLowerCase()
    const allowedRaritiesByLevel = (() => {
        const normalizedLevel = parsePositiveInt(level, 1)
        if (normalizedLevel >= 3200) return ['sss']
        if (normalizedLevel >= 2400) return ['sss', 'ss']
        if (normalizedLevel >= 1800) return ['ss', 'sss']
        if (normalizedLevel >= 1400) return ['s', 'ss', 'sss']
        if (normalizedLevel >= 1000) return ['a', 's', 'ss']
        if (normalizedLevel >= 700) return ['a', 'b', 's']
        if (normalizedLevel >= 500) return ['a', 'b', 'c']
        if (normalizedLevel >= 300) return ['b', 'c', 'd']
        if (normalizedLevel >= 120) return ['c', 'd']
        return ['d']
    })()

    const rarityPool = pokemonPool.filter((pokemon) => {
        const rarity = normalizeRarity(pokemon?.rarity)
        return allowedRaritiesByLevel.includes(rarity)
    })

    const pickUniquePokemon = (pool, count, pickedIds = new Set()) => {
        const available = pool.filter((entry) => !pickedIds.has(String(entry?._id || '')))
        const selected = []
        while (available.length > 0 && selected.length < count) {
            const pickIndex = Math.floor(random() * available.length)
            const [picked] = available.splice(pickIndex, 1)
            if (!picked?._id) continue
            pickedIds.add(String(picked._id))
            selected.push(picked)
        }
        return selected
    }

    const pickUniqueByRarity = (rarity, pickedIds = new Set()) => {
        const normalizedRarity = normalizeRarity(rarity)
        const pool = pokemonPool.filter((entry) => normalizeRarity(entry?.rarity) === normalizedRarity)
        const available = pool.filter((entry) => !pickedIds.has(String(entry?._id || '')))
        if (available.length === 0) return null
        const pickIndex = Math.floor(random() * available.length)
        const picked = available[pickIndex]
        if (!picked?._id) return null
        pickedIds.add(String(picked._id))
        return picked
    }

    const pickedIds = new Set()
    const primaryCandidates = rarityPool.length > 0 ? rarityPool : pokemonPool
    const milestoneRarityPattern = resolveMilestoneRarityPatternByLevel(level, normalizedTeamSize)
    const selectedPokemons = []

    if (milestoneRarityPattern.length > 0) {
        milestoneRarityPattern.forEach((rarity) => {
            const picked = pickUniqueByRarity(rarity, pickedIds)
            if (picked) selectedPokemons.push(picked)
        })
    }

    if (selectedPokemons.length < normalizedTeamSize) {
        const remaining = normalizedTeamSize - selectedPokemons.length
        selectedPokemons.push(...pickUniquePokemon(primaryCandidates, remaining, pickedIds))
    }

    if (selectedPokemons.length < normalizedTeamSize) {
        const remaining = normalizedTeamSize - selectedPokemons.length
        selectedPokemons.push(...pickUniquePokemon(pokemonPool, remaining, pickedIds))
    }

    const resolveRandomFormId = (pokemonLike = {}) => {
        const forms = Array.isArray(pokemonLike?.forms) ? pokemonLike.forms : []
        const formIds = forms
            .map((entry) => normalizeFormId(entry?.formId || entry?.name || ''))
            .filter(Boolean)

        const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
        if (!formIds.includes(defaultFormId)) {
            formIds.unshift(defaultFormId)
        }

        if (formIds.length === 0) return 'normal'
        const pickIndex = Math.floor(random() * formIds.length)
        return formIds[pickIndex] || defaultFormId || 'normal'
    }

    const levelSpread = Math.max(1, Math.min(12, Math.floor(parsePositiveInt(level, 1) * 0.08)))
    const team = []
    for (let slot = 0; slot < selectedPokemons.length; slot += 1) {
        const selectedPokemon = selectedPokemons[slot]
        const levelDelta = Math.floor(random() * (levelSpread * 2 + 1)) - levelSpread
        const adjustedLevel = Math.max(
            TRAINER_LEVEL_MIN,
            parsePositiveInt(level, TRAINER_LEVEL_MIN) + levelDelta
        )
        const formId = resolveRandomFormId(selectedPokemon)
        team.push({
            pokemonId: selectedPokemon._id,
            level: adjustedLevel,
            formId,
            damagePercent: normalizedDamagePercent,
        })
    }
    return team
}

// GET /api/admin/battle-trainers
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
        const skip = (page - 1) * limit

        const [trainers, total, autoGeneratedTotal] = await Promise.all([
            BattleTrainer.find()
                .sort({ orderIndex: 1, createdAt: 1 })
                .skip(skip)
                .limit(limit)
                .populate('team.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
                .populate('prizePokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
                .populate('prizeItemId', 'name imageUrl type rarity')
                .lean(),
            BattleTrainer.countDocuments(),
            BattleTrainer.countDocuments({ autoGenerated: true }),
        ])

        res.json({
            ok: true,
            trainers,
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
            summary: {
                autoGeneratedTotal,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/battle-trainers/usage-summary
router.get('/usage-summary', async (_req, res) => {
    try {
        const usageRows = await BattleTrainer.find({})
            .select('_id name milestoneLevel prizePokemonId prizePokemonFormId team.pokemonId')
            .lean()

        const usages = (Array.isArray(usageRows) ? usageRows : [])
            .map((trainer) => {
                const trainerId = String(trainer?._id || '').trim()
                const prizePokemonId = String(trainer?.prizePokemonId || '').trim()
                const prizePokemonFormId = String(trainer?.prizePokemonFormId || '').trim().toLowerCase() || 'normal'
                const teamEntries = Array.isArray(trainer?.team) ? trainer.team : []
                const teamPokemonIds = [...new Set(
                    teamEntries
                        .map((entry) => String(entry?.pokemonId || '').trim())
                        .filter(Boolean)
                )]

                return {
                    trainerId,
                    trainerName: String(trainer?.name || '').trim(),
                    milestoneLevel: Math.max(0, Number(trainer?.milestoneLevel || 0) || 0),
                    prizePokemonId,
                    prizePokemonFormId,
                    teamPokemonIds,
                }
            })
            .filter((entry) => entry.trainerId)

        res.json({
            ok: true,
            usages,
            total: usages.length,
        })
    } catch (error) {
        console.error('GET /api/admin/battle-trainers/usage-summary error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/battle-trainers/reset-history
router.post('/reset-history', async (req, res) => {
    try {
        const keepSessions = Boolean(req.body?.keepSessions)

        const [
            firstTrainer,
            totalUsers,
            usersWithHistory,
            activeSessions,
        ] = await Promise.all([
            BattleTrainer.findOne(activeBattleTrainerFilter)
                .sort({ orderIndex: 1, createdAt: 1 })
                .select('_id name orderIndex')
                .lean(),
            User.countDocuments({}),
            User.countDocuments({ completedBattleTrainers: { $exists: true, $ne: [] } }),
            BattleSession.countDocuments({}),
        ])

        const resetUsersResult = await User.updateMany(
            {
                $or: [
                    { completedBattleTrainers: { $exists: true, $ne: [] } },
                    { completedBattleTrainerReachedAt: { $exists: true, $ne: {} } },
                    { 'autoTrainer.enabled': true },
                    { 'autoTrainer.trainerId': { $exists: true, $ne: '' } },
                    { 'autoTrainer.clientInstanceId': { $exists: true, $ne: '' } },
                    { 'autoTrainer.startedAt': { $ne: null } },
                    { 'autoTrainer.lastRuntimeAt': { $ne: null } },
                    { 'autoTrainer.logs.0': { $exists: true } },
                    { 'autoTrainer.lastAction.at': { $ne: null } },
                ],
            },
            {
                $set: {
                    completedBattleTrainers: [],
                    completedBattleTrainerReachedAt: {},
                    'autoTrainer.enabled': false,
                    'autoTrainer.trainerId': '',
                    'autoTrainer.clientInstanceId': '',
                    'autoTrainer.startedAt': null,
                    'autoTrainer.lastRuntimeAt': null,
                    'autoTrainer.lastAction': {
                        action: 'admin_reset_history',
                        result: 'reset',
                        reason: 'BATTLE_TRAINER_HISTORY_RESET',
                        targetId: '',
                        at: new Date(),
                    },
                    'autoTrainer.logs': [],
                },
            }
        )

        let deletedSessions = 0
        if (!keepSessions) {
            const deleteSessionResult = await BattleSession.deleteMany({})
            deletedSessions = Number(deleteSessionResult.deletedCount || 0)
        }

        res.json({
            ok: true,
            message: 'Đã reset toàn bộ lịch sử leo battle trainer về mốc đầu.',
            keepSessions,
            summary: {
                totalUsers,
                usersWithHistory,
                activeSessions,
                usersMatched: Number(resetUsersResult?.matchedCount || 0),
                usersModified: Number(resetUsersResult?.modifiedCount || 0),
                sessionsDeleted: deletedSessions,
            },
            firstTrainer: firstTrainer
                ? {
                    _id: firstTrainer._id,
                    name: firstTrainer.name,
                    orderIndex: firstTrainer.orderIndex,
                }
                : null,
        })
    } catch (error) {
        console.error('POST /api/admin/battle-trainers/reset-history error:', error)
        res.status(500).json({ ok: false, message: 'Reset lịch sử battle trainer thất bại' })
    }
})

// POST /api/admin/battle-trainers
router.post('/', async (req, res) => {
    try {
        const {
            name,
            imageUrl,
            quote,
            isActive,
            orderIndex,
            team,
            prizePokemonId,
            prizePokemonFormId,
            prizePokemonLevel,
            prizeItemId,
            prizeItemQuantity,
            platinumCoinsReward,
            expReward,
            moonPointsReward,
            autoGenerated,
            milestoneLevel,
        } = req.body

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Tên là bắt buộc' })
        }

        const normalizedTeam = normalizeTeam(team)
        const teamError = await validateTeam(normalizedTeam)
        if (teamError) {
            return res.status(400).json({ ok: false, message: teamError })
        }

        const resolvedPrizeSelection = await resolvePrizePokemonSelection(prizePokemonId, prizePokemonFormId)
        if (resolvedPrizeSelection.error) {
            return res.status(400).json({ ok: false, message: resolvedPrizeSelection.error })
        }

        const resolvedPrizeItemSelection = await resolvePrizeItemSelection(prizeItemId, prizeItemQuantity)
        if (resolvedPrizeItemSelection.error) {
            return res.status(400).json({ ok: false, message: resolvedPrizeItemSelection.error })
        }

        const isAutoGeneratedTrainer = Boolean(autoGenerated)

        const trainer = new BattleTrainer({
            name,
            imageUrl: imageUrl || '',
            quote: quote || '',
            isActive: isActive !== undefined ? isActive : true,
            orderIndex: orderIndex !== undefined ? orderIndex : 0,
            team: normalizedTeam,
            prizePokemonId: resolvedPrizeSelection.prizePokemonId,
            prizePokemonFormId: resolvedPrizeSelection.prizePokemonFormId,
            prizePokemonLevel: resolvedPrizeSelection.prizePokemonId
                ? parseOptionalPrizeLevel(prizePokemonLevel)
                : 0,
            prizeItemId: resolvedPrizeItemSelection.prizeItemId,
            prizeItemQuantity: resolvedPrizeItemSelection.prizeItemQuantity,
            platinumCoinsReward: parseRewardNumber(platinumCoinsReward, 0),
            expReward: parseRewardNumber(expReward, 0),
            moonPointsReward: resolveMoonPointsReward({
                moonPointsReward,
                fallback: 0,
            }),
            autoGenerated: isAutoGeneratedTrainer,
            milestoneLevel: parseNonNegativeInt(milestoneLevel, 0),
        })

        await trainer.save()

        res.status(201).json({ ok: true, trainer })
    } catch (error) {
        console.error('POST /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/battle-trainers/:id
router.put('/:id', async (req, res) => {
    try {
        const {
            name,
            imageUrl,
            quote,
            isActive,
            orderIndex,
            team,
            prizePokemonId,
            prizePokemonFormId,
            prizePokemonLevel,
            prizeItemId,
            prizeItemQuantity,
            platinumCoinsReward,
            expReward,
            moonPointsReward,
            autoGenerated,
            milestoneLevel,
        } = req.body

        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên' })
        }

        const normalizedTeam = normalizeTeam(team)
        const shouldUpdateTeam = team !== undefined
        if (shouldUpdateTeam) {
            const teamError = await validateTeam(normalizedTeam)
            if (teamError) {
                return res.status(400).json({ ok: false, message: teamError })
            }
        }

        if (name !== undefined) trainer.name = name
        if (imageUrl !== undefined) trainer.imageUrl = imageUrl
        if (quote !== undefined) trainer.quote = quote
        if (isActive !== undefined) trainer.isActive = isActive
        if (orderIndex !== undefined) trainer.orderIndex = orderIndex
        if (shouldUpdateTeam) trainer.team = normalizedTeam

        if (prizePokemonId !== undefined || prizePokemonFormId !== undefined) {
            const nextPrizePokemonId = prizePokemonId !== undefined ? prizePokemonId : trainer.prizePokemonId
            const nextPrizePokemonFormId = prizePokemonFormId !== undefined ? prizePokemonFormId : trainer.prizePokemonFormId
            const resolvedPrizeSelection = await resolvePrizePokemonSelection(nextPrizePokemonId, nextPrizePokemonFormId)
            if (resolvedPrizeSelection.error) {
                return res.status(400).json({ ok: false, message: resolvedPrizeSelection.error })
            }
            trainer.prizePokemonId = resolvedPrizeSelection.prizePokemonId
            trainer.prizePokemonFormId = resolvedPrizeSelection.prizePokemonFormId

            if (!resolvedPrizeSelection.prizePokemonId) {
                trainer.prizePokemonLevel = 0
            } else if (prizePokemonLevel !== undefined) {
                trainer.prizePokemonLevel = parseOptionalPrizeLevel(prizePokemonLevel)
            }
        } else if (prizePokemonLevel !== undefined) {
            trainer.prizePokemonLevel = trainer.prizePokemonId
                ? parseOptionalPrizeLevel(prizePokemonLevel)
                : 0
        }

        if (prizeItemId !== undefined || prizeItemQuantity !== undefined) {
            const nextPrizeItemId = prizeItemId !== undefined ? prizeItemId : trainer.prizeItemId
            const nextPrizeItemQuantity = prizeItemQuantity !== undefined ? prizeItemQuantity : trainer.prizeItemQuantity
            const resolvedPrizeItemSelection = await resolvePrizeItemSelection(nextPrizeItemId, nextPrizeItemQuantity)
            if (resolvedPrizeItemSelection.error) {
                return res.status(400).json({ ok: false, message: resolvedPrizeItemSelection.error })
            }
            trainer.prizeItemId = resolvedPrizeItemSelection.prizeItemId
            trainer.prizeItemQuantity = resolvedPrizeItemSelection.prizeItemQuantity
        }

        if (platinumCoinsReward !== undefined) trainer.platinumCoinsReward = parseRewardNumber(platinumCoinsReward, 0)
        if (expReward !== undefined) trainer.expReward = parseRewardNumber(expReward, 0)
        const nextAutoGenerated = autoGenerated !== undefined ? Boolean(autoGenerated) : Boolean(trainer.autoGenerated)
        if (moonPointsReward !== undefined) {
            trainer.moonPointsReward = resolveMoonPointsReward({
                moonPointsReward,
                fallback: 0,
            })
        }
        if (autoGenerated !== undefined) trainer.autoGenerated = nextAutoGenerated
        if (milestoneLevel !== undefined) {
            trainer.milestoneLevel = parseNonNegativeInt(milestoneLevel, 0)
        }

        await trainer.save()

        res.json({ ok: true, trainer })
    } catch (error) {
        console.error('PUT /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// POST /api/admin/battle-trainers/auto-generate
router.post('/auto-generate', async (req, res) => {
    try {
        const startLevel = parsePositiveInt(req.body?.startLevel, 1)
        const maxLevel = Math.max(startLevel, parsePositiveInt(req.body?.maxLevel, startLevel))
        const step = parsePositiveInt(req.body?.step, 10)
        const teamSize = clampNumber(req.body?.teamSize, 1, 6)
        const configuredCoinsReward = parseOptionalRewardNumber(req.body?.platinumCoinsReward)
        const configuredExpReward = parseOptionalRewardNumber(req.body?.expReward)
        const configuredCoinsRewardMultiplier = parseOptionalRewardNumber(req.body?.platinumCoinsRewardMultiplier)
        const configuredExpRewardMultiplier = parseOptionalRewardNumber(req.body?.expRewardMultiplier)
        const configuredDamageBonusRules = parseDamageBonusRules(req.body?.damageBonusRules)
        const generationSeedBase = Number.isFinite(Number(req.body?.seed))
            ? Math.floor(Number(req.body.seed))
            : Date.now()
        const configuredPrizeEveryTrainer = clampNumber(req.body?.prizePokemonEveryTrainer, 0, 100000)
        const resolvedPrizePoolResult = await resolvePrizePokemonPoolSelections(req.body?.prizePokemonPool)
        if (resolvedPrizePoolResult.error) {
            return res.status(400).json({ ok: false, message: resolvedPrizePoolResult.error })
        }
        const resolvedPrizePool = resolvedPrizePoolResult.selections
        const shouldAssignRandomPrize = resolvedPrizePool.length > 0 && configuredPrizeEveryTrainer > 0
        const autoImageUrl = String(req.body?.imageUrl || '').trim()
        const requestedImageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : []
        const autoImagePool = requestedImageUrls
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        if (autoImagePool.length === 0 && autoImageUrl) {
            autoImagePool.push(autoImageUrl)
        }

        const pokemonPool = await Pokemon.find({})
            .select('_id name pokedexNumber rarity defaultFormId forms')
            .sort({ pokedexNumber: 1, _id: 1 })
            .lean()

        if (!Array.isArray(pokemonPool) || pokemonPool.length === 0) {
            return res.status(400).json({ ok: false, message: 'Không có Pokemon để tạo đội hình trainer tự động' })
        }

        const levelSet = new Set([startLevel])
        for (let level = step; level <= maxLevel; level += step) {
            if (level >= startLevel) {
                levelSet.add(level)
            }
        }
        const levels = [...levelSet].sort((a, b) => a - b)

        const rewardedTrainerCount = shouldAssignRandomPrize
            ? levels.reduce((count, _level, index) => (index % configuredPrizeEveryTrainer === 0 ? count + 1 : count), 0)
            : 0

        const buildPrizePoolSelectionKey = (entry) => {
            if (!entry?.prizePokemonId) return ''
            return [
                String(entry.prizePokemonId),
                normalizeFormId(entry.prizePokemonFormId || 'normal'),
                Math.max(0, Number(entry.prizePokemonLevel) || 0),
            ].join(':')
        }

        const prizeRandom = createSeededRandom(generationSeedBase + (resolvedPrizePool.length * 37) + (levels.length * 503))
        const shufflePrizePool = (poolRows = []) => {
            const next = [...poolRows]
            for (let index = next.length - 1; index > 0; index -= 1) {
                const pickIndex = Math.floor(prizeRandom() * (index + 1))
                const picked = next[pickIndex]
                next[pickIndex] = next[index]
                next[index] = picked
            }
            return next
        }

        let lastPrizeSelectionKey = ''
        const createNextPrizePoolRotation = () => {
            const nextRotation = shufflePrizePool(resolvedPrizePool)
            if (nextRotation.length <= 1 || !lastPrizeSelectionKey) {
                return nextRotation
            }

            const firstKey = buildPrizePoolSelectionKey(nextRotation[0])
            if (firstKey !== lastPrizeSelectionKey) {
                return nextRotation
            }

            const swapIndex = nextRotation.findIndex((entry, index) => (
                index > 0 && buildPrizePoolSelectionKey(entry) !== lastPrizeSelectionKey
            ))

            if (swapIndex > 0) {
                const firstEntry = nextRotation[0]
                nextRotation[0] = nextRotation[swapIndex]
                nextRotation[swapIndex] = firstEntry
            }

            return nextRotation
        }

        let currentPrizePoolRotation = shouldAssignRandomPrize ? createNextPrizePoolRotation() : []
        let currentPrizePoolIndex = 0
        const pickNextPrizeFromPool = () => {
            if (!shouldAssignRandomPrize || resolvedPrizePool.length === 0) {
                return null
            }

            if (currentPrizePoolIndex >= currentPrizePoolRotation.length) {
                currentPrizePoolRotation = createNextPrizePoolRotation()
                currentPrizePoolIndex = 0
            }

            const selectedEntry = currentPrizePoolRotation[currentPrizePoolIndex] || null
            currentPrizePoolIndex += 1
            lastPrizeSelectionKey = buildPrizePoolSelectionKey(selectedEntry)
            return selectedEntry
        }

        const coinsRewardMultiplier = configuredCoinsRewardMultiplier !== null ? configuredCoinsRewardMultiplier : 10
        const expRewardMultiplier = configuredExpRewardMultiplier !== null ? configuredExpRewardMultiplier : 10

        const upsertResults = await Promise.all(
            levels.map(async (level, index) => {
                const computedCoinsReward = Math.max(0, level * coinsRewardMultiplier)
                const computedExpReward = Math.max(0, level * expRewardMultiplier)
                const platinumCoinsReward = configuredCoinsReward !== null ? configuredCoinsReward : computedCoinsReward
                const expReward = configuredExpReward !== null ? configuredExpReward : computedExpReward
                const teamDamagePercent = resolveTeamDamagePercentByLevel(level, configuredDamageBonusRules)
                const team = buildAutoTeam(
                    pokemonPool,
                    level,
                    generationSeedBase + (index * 101) + (level * 1009),
                    teamSize,
                    teamDamagePercent
                )
                const shouldRewardTrainer = shouldAssignRandomPrize && (index % configuredPrizeEveryTrainer === 0)
                const selectedPrize = shouldRewardTrainer
                    ? pickNextPrizeFromPool()
                    : null
                const trainerPatch = {
                    name: `HLV Mốc Lv ${level}`,
                    quote: `Vượt qua mốc sức mạnh cấp ${level}!`,
                    isActive: true,
                    orderIndex: level,
                    team,
                    prizePokemonId: selectedPrize?.prizePokemonId || null,
                    prizePokemonFormId: selectedPrize?.prizePokemonFormId || 'normal',
                    prizePokemonLevel: selectedPrize ? selectedPrize.prizePokemonLevel : 0,
                    prizeItemId: null,
                    prizeItemQuantity: 1,
                    platinumCoinsReward,
                    expReward,
                    moonPointsReward: 0,
                    autoGenerated: true,
                    milestoneLevel: level,
                }

                if (autoImagePool.length > 0) {
                    trainerPatch.imageUrl = autoImagePool[index % autoImagePool.length]
                }

                const trainerDoc = await BattleTrainer.findOneAndUpdate(
                    {
                        autoGenerated: true,
                        milestoneLevel: level,
                    },
                    {
                        $set: trainerPatch,
                    },
                    {
                        new: true,
                        upsert: true,
                    }
                ).lean()
                return trainerDoc
            })
        )

        res.json({
            ok: true,
            message: `Đã tạo/cập nhật ${upsertResults.length} trainer theo mốc cấp`,
            generatedCount: upsertResults.length,
            rewardedTrainerCount,
            levels,
            randomPrizeConfig: {
                rewardEveryTrainer: configuredPrizeEveryTrainer,
                poolSize: resolvedPrizePool.length,
            },
            damageBonusConfig: {
                ruleCount: configuredDamageBonusRules.length,
                rules: configuredDamageBonusRules,
            },
            trainers: upsertResults,
        })
    } catch (error) {
        console.error('POST /api/admin/battle-trainers/auto-generate error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/battle-trainers
router.delete('/', async (_req, res) => {
    try {
        const result = await BattleTrainer.deleteMany({})
        const deletedCount = Math.max(0, Number(result?.deletedCount) || 0)
        res.json({
            ok: true,
            message: `Đã xóa ${deletedCount} huấn luyện viên`,
            deletedCount,
        })
    } catch (error) {
        console.error('DELETE /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// DELETE /api/admin/battle-trainers/auto-generated
router.delete('/auto-generated', async (req, res) => {
    try {
        const parsedFromLevel = Number.parseInt(req.query?.fromLevel, 10)
        const parsedToLevel = Number.parseInt(req.query?.toLevel, 10)
        const hasFromLevel = Number.isFinite(parsedFromLevel)
        const hasToLevel = Number.isFinite(parsedToLevel)
        const fromLevel = hasFromLevel ? Math.max(0, parsedFromLevel) : null
        const toLevel = hasToLevel ? Math.max(0, parsedToLevel) : null

        if (fromLevel !== null && toLevel !== null && fromLevel > toLevel) {
            return res.status(400).json({ ok: false, message: 'Mốc từ level phải nhỏ hơn hoặc bằng mốc đến level.' })
        }

        const deleteFilter = { autoGenerated: true }
        if (fromLevel !== null || toLevel !== null) {
            deleteFilter.milestoneLevel = {}
            if (fromLevel !== null) {
                deleteFilter.milestoneLevel.$gte = fromLevel
            }
            if (toLevel !== null) {
                deleteFilter.milestoneLevel.$lte = toLevel
            }
        }

        const result = await BattleTrainer.deleteMany(deleteFilter)
        const deletedCount = Math.max(0, Number(result?.deletedCount) || 0)
        const rangeText = fromLevel !== null || toLevel !== null
            ? ` trong mốc level ${fromLevel !== null ? fromLevel : '-∞'} đến ${toLevel !== null ? toLevel : '+∞'}`
            : ''
        res.json({
            ok: true,
            message: `Đã xóa ${deletedCount} trainer auto-generated${rangeText}`,
            deletedCount,
            filters: {
                fromLevel,
                toLevel,
            },
        })
    } catch (error) {
        console.error('DELETE /api/admin/battle-trainers/auto-generated error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// DELETE /api/admin/battle-trainers/:id
router.delete('/:id', async (req, res) => {
    try {
        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên' })
        }
        await trainer.deleteOne()
        res.json({ ok: true, message: 'Đã xóa huấn luyện viên' })
    } catch (error) {
        console.error('DELETE /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
