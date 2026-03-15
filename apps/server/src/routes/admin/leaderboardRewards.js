import express from 'express'
import mongoose from 'mongoose'
import User from '../../models/User.js'
import PlayerState from '../../models/PlayerState.js'
import Item from '../../models/Item.js'
import Pokemon from '../../models/Pokemon.js'
import UserInventory from '../../models/UserInventory.js'
import UserPokemon from '../../models/UserPokemon.js'
import WeeklyLeaderboardReward from '../../models/WeeklyLeaderboardReward.js'
import LeaderboardCosmeticConfig from '../../models/LeaderboardCosmeticConfig.js'
import upload from '../../middleware/upload.js'
import { syncUserPokedexEntriesForPokemonDocs } from '../../services/userPokedexService.js'
import { attachSession, getSessionOptions, runWithOptionalTransaction } from '../../utils/mongoTransactions.js'
import { uploadVipAssetImageToCloudinary } from '../../utils/cloudinary.js'

const router = express.Router()

const VALID_MODES = new Set(['wealth', 'trainerBattle', 'lc'])
const VALID_REWARD_TYPES = new Set(['platinumCoins', 'moonPoints', 'item', 'pokemon', 'titleImage', 'avatarFrame'])
const COSMETIC_REWARD_TYPE_SET = new Set(['titleImage', 'avatarFrame'])
const COSMETIC_CONFIG_RANKS = [1, 2, 3]
let rewardIndexesSyncPromise = null

const ensureRewardIndexesSynced = async () => {
    if (!rewardIndexesSyncPromise) {
        rewardIndexesSyncPromise = WeeklyLeaderboardReward.createIndexes()
            .catch((error) => {
                console.error('WeeklyLeaderboardReward.createIndexes error:', error)
            })
    }
    await rewardIndexesSyncPromise
}

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const buildWeeklyPeriod = (sourceDate = new Date()) => {
    const now = new Date(sourceDate)
    now.setHours(0, 0, 0, 0)

    const mondayOffset = (now.getDay() + 6) % 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - mondayOffset)

    return {
        weekStart: toDailyDateKey(weekStart),
        weekEnd: toDailyDateKey(now),
    }
}

const normalizeMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (
        normalized === 'trainerbattle'
        || normalized === 'trainer_battle'
        || normalized === 'trainer'
        || normalized === 'trainerlevel'
        || normalized === 'trainer_level'
        || normalized === 'hvl'
    ) {
        return 'trainerBattle'
    }
    if (
        normalized === 'lc'
        || normalized === 'combat'
        || normalized === 'power'
        || normalized === 'combat_power'
        || normalized === 'lucchien'
    ) {
        return 'lc'
    }
    return 'wealth'
}

const normalizeWeekStart = (value = '') => {
    const normalized = String(value || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        return normalized
    }
    return ''
}

const normalizeRewardType = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'moon' || normalized === 'moonpoint' || normalized === 'moon_points') return 'moonPoints'
    if (normalized === 'coin' || normalized === 'coins' || normalized === 'gold' || normalized === 'xu' || normalized === 'taiphu') return 'platinumCoins'
    if (normalized === 'pokemon' || normalized === 'pkm') return 'pokemon'
    if (normalized === 'item' || normalized === 'vatpham') return 'item'
    if (normalized === 'title' || normalized === 'titleimage' || normalized === 'title_image' || normalized === 'danhhieu') return 'titleImage'
    if (normalized === 'avatarframe' || normalized === 'avatar_frame' || normalized === 'frame' || normalized === 'khung') return 'avatarFrame'
    return 'platinumCoins'
}

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toSafeInt = (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : fallback
}

const toPokemonLookupRow = (pokemonLike = {}) => {
    const forms = Array.isArray(pokemonLike?.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')

    const normalizedForms = forms.length > 0
        ? forms.map((entry) => ({
            formId: normalizeFormId(entry?.formId || defaultFormId),
            formName: String(entry?.formName || '').trim() || normalizeFormId(entry?.formId || defaultFormId),
        }))
        : [{ formId: defaultFormId, formName: defaultFormId }]

    const defaultForm = forms.find((entry) => normalizeFormId(entry?.formId || '') === defaultFormId) || forms[0] || null
    const sprite = String(
        defaultForm?.sprites?.normal
        || defaultForm?.sprites?.icon
        || defaultForm?.imageUrl
        || pokemonLike?.sprites?.normal
        || pokemonLike?.sprites?.icon
        || pokemonLike?.imageUrl
        || ''
    ).trim()

    return {
        _id: pokemonLike?._id || null,
        name: String(pokemonLike?.name || '').trim(),
        pokedexNumber: Math.max(0, Number(pokemonLike?.pokedexNumber || 0)),
        defaultFormId,
        forms: normalizedForms,
        sprite,
    }
}

const getRewardTypeLabel = (rewardType = 'platinumCoins') => {
    if (rewardType === 'moonPoints') return 'Điểm Nguyệt Các'
    if (rewardType === 'item') return 'Vật phẩm'
    if (rewardType === 'pokemon') return 'Pokemon'
    if (rewardType === 'titleImage') return 'Danh hiệu ảnh'
    if (rewardType === 'avatarFrame') return 'Khung avatar'
    return 'Xu Bạch Kim'
}

const normalizeRewardEntriesFromBody = (body = {}) => {
    const entries = Array.isArray(body?.rewardEntries) ? body.rewardEntries : []
    if (entries.length > 0) {
        return entries
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({ ...entry }))
    }

    return [{
        rewardType: body?.rewardType,
        rewardAmount: body?.rewardAmount,
        itemId: body?.itemId,
        pokemonId: body?.pokemonId,
        pokemonFormId: body?.pokemonFormId || body?.formId,
        pokemonLevel: body?.pokemonLevel,
        pokemonIsShiny: body?.pokemonIsShiny || body?.isShiny,
        titleImageUrl: body?.titleImageUrl,
        avatarFrameUrl: body?.avatarFrameUrl,
    }]
}

const serializeRewardEntry = (entry = {}) => ({
    id: String(entry?._id || ''),
    weekStart: String(entry?.weekStart || '').trim(),
    weekEnd: String(entry?.weekEnd || '').trim(),
    mode: String(entry?.mode || 'wealth').trim(),
    userId: String(entry?.userId || '').trim(),
    usernameSnapshot: String(entry?.usernameSnapshot || '').trim(),
    rank: Math.max(0, Number(entry?.rank || 0)),
    scoreValue: Math.max(0, Number(entry?.scoreValue || 0)),
    rewardType: String(entry?.rewardType || 'platinumCoins').trim(),
    rewardAmount: Math.max(0, Number(entry?.rewardAmount || 0)),
    rewardItemId: String(entry?.rewardItemId || '').trim(),
    rewardItemNameSnapshot: String(entry?.rewardItemNameSnapshot || '').trim(),
    rewardPokemonId: String(entry?.rewardPokemonId || '').trim(),
    rewardPokemonNameSnapshot: String(entry?.rewardPokemonNameSnapshot || '').trim(),
    rewardPokemonFormId: String(entry?.rewardPokemonFormId || '').trim(),
    rewardPokemonLevel: Math.max(1, Number(entry?.rewardPokemonLevel || 1)),
    rewardPokemonIsShiny: Boolean(entry?.rewardPokemonIsShiny),
    rewardTitleImageUrl: String(entry?.rewardTitleImageUrl || '').trim(),
    rewardAvatarFrameUrl: String(entry?.rewardAvatarFrameUrl || '').trim(),
    note: String(entry?.note || '').trim(),
    rewardedAt: entry?.rewardedAt || entry?.createdAt || null,
    rewardedBy: {
        userId: String(entry?.rewardedBy?._id || entry?.rewardedBy || '').trim(),
        username: String(entry?.rewardedBy?.username || '').trim(),
    },
})

const buildPokemonRewardOriginToken = ({ weekStart = '', mode = 'wealth', rewardedBy = '' } = {}) => (
    `weekly_leaderboard_reward:${String(weekStart || '').trim()}:${String(mode || 'wealth').trim()}:admin:${String(rewardedBy || '').trim()}`
)

const serializeCosmeticConfig = (entry = {}) => ({
    id: String(entry?._id || '').trim(),
    mode: String(entry?.mode || 'wealth').trim(),
    rank: Math.max(1, Number(entry?.rank || 1)),
    titleImageUrl: String(entry?.titleImageUrl || '').trim(),
    avatarFrameUrl: String(entry?.avatarFrameUrl || '').trim(),
    updatedAt: entry?.updatedAt || entry?.createdAt || null,
})

// POST /api/admin/leaderboard-rewards/upload-image
router.post('/upload-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'Chưa có tệp ảnh được tải lên' })
        }

        const { imageUrl, publicId } = await uploadVipAssetImageToCloudinary({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
        })

        return res.json({
            ok: true,
            imageUrl,
            publicId,
            message: 'Tải ảnh thưởng top tuần thành công',
        })
    } catch (error) {
        console.error('POST /api/admin/leaderboard-rewards/upload-image error:', error)
        return res.status(500).json({ ok: false, message: error.message || 'Tải ảnh thất bại' })
    }
})

// GET /api/admin/leaderboard-rewards/cosmetic-configs?mode=wealth
router.get('/cosmetic-configs', async (req, res) => {
    try {
        const mode = normalizeMode(req.query.mode)
        if (!VALID_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Mode leaderboard không hợp lệ' })
        }

        const rows = await LeaderboardCosmeticConfig.find({ mode, rank: { $in: COSMETIC_CONFIG_RANKS } })
            .sort({ rank: 1, _id: 1 })
            .lean()
        const rowByRank = new Map(rows.map((entry) => [Number(entry?.rank || 0), entry]))

        return res.json({
            ok: true,
            mode,
            configs: COSMETIC_CONFIG_RANKS.map((rank) => serializeCosmeticConfig(rowByRank.get(rank) || { mode, rank })),
        })
    } catch (error) {
        console.error('GET /api/admin/leaderboard-rewards/cosmetic-configs error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải cấu hình khung/danh hiệu top tuần' })
    }
})

// PUT /api/admin/leaderboard-rewards/cosmetic-configs/:mode/:rank
router.put('/cosmetic-configs/:mode/:rank', async (req, res) => {
    try {
        const mode = normalizeMode(req.params.mode)
        const rank = clamp(toSafeInt(req.params.rank, 0), 0, 999)
        if (!VALID_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Mode leaderboard không hợp lệ' })
        }
        if (!COSMETIC_CONFIG_RANKS.includes(rank)) {
            return res.status(400).json({ ok: false, message: 'Chỉ hỗ trợ cấu hình top 1-3' })
        }

        const row = await LeaderboardCosmeticConfig.findOneAndUpdate(
            { mode, rank },
            {
                $set: {
                    mode,
                    rank,
                    titleImageUrl: String(req.body?.titleImageUrl || '').trim(),
                    avatarFrameUrl: String(req.body?.avatarFrameUrl || '').trim(),
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean()

        return res.json({
            ok: true,
            message: `Đã lưu cấu hình cosmetic cho top ${rank}`,
            config: serializeCosmeticConfig(row),
        })
    } catch (error) {
        console.error('PUT /api/admin/leaderboard-rewards/cosmetic-configs/:mode/:rank error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể lưu cấu hình khung/danh hiệu top tuần' })
    }
})

// GET /api/admin/leaderboard-rewards/meta/items?search=&limit=
router.get('/meta/items', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const limit = clamp(toSafeInt(req.query.limit, 30), 1, 300)

        const filter = {}
        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i')
            filter.$or = [
                { name: { $regex: regex } },
                { type: { $regex: regex } },
                { rarity: { $regex: regex } },
            ]
        }

        const rows = await Item.find(filter)
            .select('name type rarity imageUrl')
            .sort({ nameLower: 1, _id: 1 })
            .limit(limit)
            .lean()

        return res.json({
            ok: true,
            items: rows.map((entry) => ({
                _id: entry?._id || null,
                name: String(entry?.name || '').trim(),
                type: String(entry?.type || '').trim(),
                rarity: String(entry?.rarity || '').trim(),
                imageUrl: String(entry?.imageUrl || '').trim(),
            })),
        })
    } catch (error) {
        console.error('GET /api/admin/leaderboard-rewards/meta/items error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách vật phẩm' })
    }
})

// GET /api/admin/leaderboard-rewards/meta/pokemon?search=&limit=
router.get('/meta/pokemon', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const page = clamp(toSafeInt(req.query.page, 1), 1, 99999)
        const limit = clamp(toSafeInt(req.query.limit, 40), 1, 500)
        const skip = (page - 1) * limit

        const filter = {}
        if (search) {
            const regex = new RegExp(escapeRegex(search), 'i')
            filter.$or = [
                { name: { $regex: regex } },
                { pokedexNumber: Number.isFinite(Number(search)) ? Number(search) : -1 },
            ]
        }

        const [total, rows] = await Promise.all([
            Pokemon.countDocuments(filter),
            Pokemon.find(filter)
                .select('name pokedexNumber defaultFormId forms sprites imageUrl')
                .sort({ pokedexNumber: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ])

        const pages = Math.max(1, Math.ceil(total / limit))

        return res.json({
            ok: true,
            pokemon: rows.map((entry) => toPokemonLookupRow(entry)),
            pagination: {
                page,
                pages,
                total,
                limit,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/leaderboard-rewards/meta/pokemon error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách Pokemon' })
    }
})

// GET /api/admin/leaderboard-rewards?mode=wealth&weekStart=YYYY-MM-DD
router.get('/', async (req, res) => {
    try {
        await ensureRewardIndexesSynced()

        const mode = normalizeMode(req.query.mode)
        if (!VALID_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Mode leaderboard không hợp lệ' })
        }

        const defaultPeriod = buildWeeklyPeriod(new Date())
        const weekStart = normalizeWeekStart(req.query.weekStart) || defaultPeriod.weekStart
        const rows = await WeeklyLeaderboardReward.find({ weekStart, mode })
            .sort({ rank: 1, rewardedAt: 1, _id: 1 })
            .populate('rewardedBy', 'username')
            .lean()

        return res.json({
            ok: true,
            mode,
            period: {
                weekStart,
                weekEnd: defaultPeriod.weekEnd,
            },
            totalRewarded: rows.length,
            rewards: rows.map((entry) => serializeRewardEntry(entry)),
        })
    } catch (error) {
        console.error('GET /api/admin/leaderboard-rewards error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu trao thưởng leaderboard' })
    }
})

// POST /api/admin/leaderboard-rewards/award
router.post('/award', async (req, res) => {
    try {
        await ensureRewardIndexesSynced()

        const mode = normalizeMode(req.body?.mode)
        if (!VALID_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Mode leaderboard không hợp lệ' })
        }

        const requestedWeekStart = normalizeWeekStart(req.body?.weekStart)
        const currentPeriod = buildWeeklyPeriod(new Date())
        const weekStart = requestedWeekStart || currentPeriod.weekStart
        const weekEnd = String(req.body?.weekEnd || '').trim() || currentPeriod.weekEnd

        const targetUserId = String(req.body?.userId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'userId không hợp lệ' })
        }

        const rawRewardEntries = normalizeRewardEntriesFromBody(req.body)
        if (!Array.isArray(rawRewardEntries) || rawRewardEntries.length === 0) {
            return res.status(400).json({ ok: false, message: 'Vui lòng chọn ít nhất 1 loại thưởng' })
        }

        const rewardTypesInRequest = new Set()
        const normalizedRewardEntries = []

        for (const rawEntry of rawRewardEntries) {
            const rewardType = normalizeRewardType(rawEntry?.rewardType)
            if (!VALID_REWARD_TYPES.has(rewardType)) {
                return res.status(400).json({ ok: false, message: 'Có loại thưởng không hợp lệ trong danh sách' })
            }
            if (rewardTypesInRequest.has(rewardType)) {
                return res.status(400).json({ ok: false, message: `Mỗi loại thưởng chỉ nên xuất hiện một lần trong cùng đợt trao (${getRewardTypeLabel(rewardType)})` })
            }

            const rewardAmount = clamp(toSafeInt(rawEntry?.rewardAmount, 0), 0, 99999)
            if (rewardAmount <= 0) {
                return res.status(400).json({ ok: false, message: `Số lượng thưởng của ${getRewardTypeLabel(rewardType)} phải lớn hơn 0` })
            }
            if (rewardType === 'pokemon' && rewardAmount > 100) {
                return res.status(400).json({ ok: false, message: 'Số lượng Pokemon thưởng tối đa cho mỗi lần trao là 100' })
            }

            const titleImageUrl = String(rawEntry?.titleImageUrl || '').trim()
            const avatarFrameUrl = String(rawEntry?.avatarFrameUrl || '').trim()

            normalizedRewardEntries.push({
                rewardType,
                rewardAmount: COSMETIC_REWARD_TYPE_SET.has(rewardType) ? 1 : rewardAmount,
                cosmeticConfigRank: clamp(toSafeInt(rawEntry?.cosmeticConfigRank, 0), 0, 999),
                itemId: String(rawEntry?.itemId || '').trim(),
                pokemonId: String(rawEntry?.pokemonId || '').trim(),
                pokemonFormId: normalizeFormId(rawEntry?.pokemonFormId || rawEntry?.formId || 'normal'),
                pokemonLevel: clamp(toSafeInt(rawEntry?.pokemonLevel, 5), 1, 3000),
                pokemonIsShiny: Boolean(rawEntry?.pokemonIsShiny || rawEntry?.isShiny),
                titleImageUrl,
                avatarFrameUrl,
            })

            rewardTypesInRequest.add(rewardType)
        }

        const rank = Math.max(1, Number.parseInt(req.body?.rank, 10) || 1)
        const scoreValue = Math.max(0, Number(req.body?.scoreValue || 0))
        const note = String(req.body?.note || '').trim().slice(0, 300)

        const requestedCosmeticRanks = Array.from(new Set(
            normalizedRewardEntries
                .filter((entry) => COSMETIC_REWARD_TYPE_SET.has(entry.rewardType))
                .map((entry) => Math.max(0, Number(entry?.cosmeticConfigRank || 0)))
        ))
        const cosmeticConfigByRank = new Map()
        if (requestedCosmeticRanks.length > 0) {
            for (const cosmeticRank of requestedCosmeticRanks) {
                if (!COSMETIC_CONFIG_RANKS.includes(cosmeticRank)) {
                    return res.status(400).json({ ok: false, message: 'Khung và danh hiệu top tuần chỉ cho chọn cấu hình top 1-3' })
                }
            }

            const cosmeticConfigs = await LeaderboardCosmeticConfig.find({ mode, rank: { $in: requestedCosmeticRanks } }).lean()
            cosmeticConfigs.forEach((entry) => {
                cosmeticConfigByRank.set(Math.max(0, Number(entry?.rank || 0)), entry)
            })

            for (const cosmeticRank of requestedCosmeticRanks) {
                if (!cosmeticConfigByRank.has(cosmeticRank)) {
                    return res.status(400).json({ ok: false, message: `Chưa cấu hình khung/danh hiệu cố định cho top ${cosmeticRank}` })
                }
            }
        }

        const [targetUser, rewardedBy] = await Promise.all([
            User.findById(targetUserId).select('username').lean(),
            User.findById(req.user.userId).select('username').lean(),
        ])

        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người chơi cần trao thưởng' })
        }
        if (!rewardedBy) {
            return res.status(401).json({ ok: false, message: 'Không xác định được admin trao thưởng' })
        }

        const requestRewardTypes = Array.from(rewardTypesInRequest)
        const alreadyRewardedRows = await WeeklyLeaderboardReward.find({
            weekStart,
            mode,
            userId: targetUserId,
            rewardType: { $in: requestRewardTypes },
        })
            .select('rewardType')
            .lean()

        if (alreadyRewardedRows.length > 0) {
            const labels = Array.from(new Set(alreadyRewardedRows
                .map((entry) => getRewardTypeLabel(String(entry?.rewardType || 'platinumCoins')))
                .filter(Boolean)))
            return res.status(409).json({
                ok: false,
                message: `Người chơi này đã được trao trước đó: ${labels.join(', ')}`,
            })
        }

        const itemIds = normalizedRewardEntries
            .filter((entry) => entry.rewardType === 'item')
            .map((entry) => entry.itemId)
        const pokemonIds = normalizedRewardEntries
            .filter((entry) => entry.rewardType === 'pokemon')
            .map((entry) => entry.pokemonId)

        for (const itemId of itemIds) {
            if (!mongoose.Types.ObjectId.isValid(itemId)) {
                return res.status(400).json({ ok: false, message: 'itemId không hợp lệ trong danh sách thưởng' })
            }
        }
        for (const pokemonId of pokemonIds) {
            if (!mongoose.Types.ObjectId.isValid(pokemonId)) {
                return res.status(400).json({ ok: false, message: 'pokemonId không hợp lệ trong danh sách thưởng' })
            }
        }

        const [itemDocs, pokemonDocs] = await Promise.all([
            itemIds.length > 0
                ? Item.find({ _id: { $in: itemIds } }).select('name').lean()
                : [],
            pokemonIds.length > 0
                ? Pokemon.find({ _id: { $in: pokemonIds } }).select('name defaultFormId forms').lean()
                : [],
        ])

        const itemDocById = new Map(itemDocs.map((entry) => [String(entry?._id || ''), entry]))
        const pokemonDocById = new Map(pokemonDocs.map((entry) => [String(entry?._id || ''), entry]))

        const toRewardText = (entry = {}) => {
            if (entry.rewardType === 'moonPoints') {
                return `${entry.rewardAmount.toLocaleString('vi-VN')} Điểm Nguyệt Các`
            }
            if (entry.rewardType === 'item') {
                return `${entry.rewardAmount.toLocaleString('vi-VN')} ${entry.rewardItemNameSnapshot || 'vật phẩm'}`
            }
            if (entry.rewardType === 'pokemon') {
                const shinyText = entry.rewardPokemonIsShiny ? ' (Shiny)' : ''
                return `${entry.rewardAmount.toLocaleString('vi-VN')} ${entry.rewardPokemonNameSnapshot || 'Pokemon'} Lv.${entry.rewardPokemonLevel}${shinyText}`
            }
            if (entry.rewardType === 'titleImage') {
                return 'ảnh danh hiệu'
            }
            if (entry.rewardType === 'avatarFrame') {
                return 'ảnh khung avatar'
            }
            return `${entry.rewardAmount.toLocaleString('vi-VN')} Xu Bạch Kim`
        }

        const now = new Date()
        const createDocs = []

        for (const rewardEntry of normalizedRewardEntries) {
            const rewardType = rewardEntry.rewardType
            const rewardAmount = rewardEntry.rewardAmount

            let rewardItemId = null
            let rewardItemNameSnapshot = ''
            let rewardPokemonId = null
            let rewardPokemonNameSnapshot = ''
            let rewardPokemonFormId = 'normal'
            let rewardPokemonLevel = rewardEntry.pokemonLevel
            let rewardPokemonIsShiny = rewardEntry.pokemonIsShiny
            let rewardTitleImageUrl = ''
            let rewardAvatarFrameUrl = ''

            if (rewardType === 'platinumCoins' || rewardType === 'moonPoints') {
                await PlayerState.findOneAndUpdate(
                    { userId: targetUserId },
                    {
                        $setOnInsert: { userId: targetUserId },
                        $inc: rewardType === 'platinumCoins'
                            ? { gold: rewardAmount }
                            : { moonPoints: rewardAmount },
                    },
                    { new: true, upsert: true }
                )
            }

            if (rewardType === 'item') {
                const itemDoc = itemDocById.get(rewardEntry.itemId)
                if (!itemDoc) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm để trao thưởng' })
                }

                await UserInventory.findOneAndUpdate(
                    { userId: targetUserId, itemId: rewardEntry.itemId },
                    {
                        $setOnInsert: { userId: targetUserId, itemId: rewardEntry.itemId },
                        $inc: { quantity: rewardAmount },
                    },
                    { new: true, upsert: true }
                )

                rewardItemId = itemDoc._id
                rewardItemNameSnapshot = String(itemDoc?.name || '').trim()
            }

            if (rewardType === 'pokemon') {
                const pokemonDoc = pokemonDocById.get(rewardEntry.pokemonId)
                if (!pokemonDoc) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon để trao thưởng' })
                }

                const forms = Array.isArray(pokemonDoc?.forms) ? pokemonDoc.forms : []
                const formIdSet = new Set(
                    forms
                        .map((entry) => normalizeFormId(entry?.formId || 'normal'))
                        .filter(Boolean)
                )
                const defaultFormId = normalizeFormId(pokemonDoc?.defaultFormId || 'normal')
                rewardPokemonFormId = formIdSet.has(rewardEntry.pokemonFormId)
                    ? rewardEntry.pokemonFormId
                    : (formIdSet.has(defaultFormId) ? defaultFormId : 'normal')
                rewardPokemonLevel = clamp(toSafeInt(rewardEntry.pokemonLevel, 5), 1, 3000)
                rewardPokemonIsShiny = Boolean(rewardEntry.pokemonIsShiny)

                const originToken = buildPokemonRewardOriginToken({ weekStart, mode, rewardedBy: req.user.userId })
                const pokemonAwardDocs = Array.from({ length: rewardAmount }, () => ({
                    userId: targetUserId,
                    pokemonId: rewardEntry.pokemonId,
                    level: rewardPokemonLevel,
                    experience: 0,
                    formId: rewardPokemonFormId,
                    isShiny: rewardPokemonIsShiny,
                    location: 'box',
                    moves: [],
                    movePpState: [],
                    originalTrainer: originToken,
                }))
                await UserPokemon.insertMany(pokemonAwardDocs)
                await syncUserPokedexEntriesForPokemonDocs(pokemonAwardDocs)

                rewardPokemonId = pokemonDoc._id
                rewardPokemonNameSnapshot = String(pokemonDoc?.name || '').trim()
            }

            if (rewardType === 'titleImage') {
                const cosmeticConfigRank = Math.max(0, Number(rewardEntry?.cosmeticConfigRank || 0))
                const cosmeticConfig = cosmeticConfigByRank.get(cosmeticConfigRank) || null
                rewardTitleImageUrl = String(cosmeticConfig?.titleImageUrl || rewardEntry?.titleImageUrl || '').trim()
                if (!rewardTitleImageUrl) {
                    return res.status(400).json({ ok: false, message: `Chưa cấu hình ảnh danh hiệu cho top ${cosmeticConfigRank}` })
                }
            }

            if (rewardType === 'avatarFrame') {
                const cosmeticConfigRank = Math.max(0, Number(rewardEntry?.cosmeticConfigRank || 0))
                const cosmeticConfig = cosmeticConfigByRank.get(cosmeticConfigRank) || null
                rewardAvatarFrameUrl = String(cosmeticConfig?.avatarFrameUrl || rewardEntry?.avatarFrameUrl || '').trim()
                if (!rewardAvatarFrameUrl) {
                    return res.status(400).json({ ok: false, message: `Chưa cấu hình ảnh khung avatar cho top ${cosmeticConfigRank}` })
                }
            }

            createDocs.push({
                weekStart,
                weekEnd,
                mode,
                userId: targetUserId,
                usernameSnapshot: String(targetUser?.username || '').trim(),
                rank,
                scoreValue,
                rewardType,
                rewardAmount,
                rewardItemId,
                rewardItemNameSnapshot,
                rewardPokemonId,
                rewardPokemonNameSnapshot,
                rewardPokemonFormId,
                rewardPokemonLevel,
                rewardPokemonIsShiny,
                rewardTitleImageUrl,
                rewardAvatarFrameUrl,
                note,
                rewardedBy: req.user.userId,
                rewardedAt: now,
            })
        }

        const createdRows = await WeeklyLeaderboardReward.insertMany(createDocs)
        const createdIds = createdRows.map((entry) => entry?._id).filter(Boolean)
        const createdWithAdmin = await WeeklyLeaderboardReward.find({ _id: { $in: createdIds } })
            .populate('rewardedBy', 'username')
            .sort({ rewardedAt: -1, _id: -1 })
            .lean()

        const rewardTexts = createdWithAdmin.map((entry) => toRewardText(entry))
        return res.json({
            ok: true,
            message: `Đã trao ${rewardTexts.join(', ')} cho ${targetUser?.username || 'người chơi'}`,
            reward: createdWithAdmin.length > 0 ? serializeRewardEntry(createdWithAdmin[0]) : null,
            rewards: createdWithAdmin.map((entry) => serializeRewardEntry(entry)),
        })
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ ok: false, message: 'Người chơi này đã được trao loại thưởng này trong tuần này' })
        }
        console.error('POST /api/admin/leaderboard-rewards/award error:', error)
        return res.status(500).json({ ok: false, message: 'Trao thưởng leaderboard thất bại' })
    }
})

// POST /api/admin/leaderboard-rewards/revoke
router.post('/revoke', async (req, res) => {
    try {
        await ensureRewardIndexesSynced()

        const mode = normalizeMode(req.body?.mode)
        if (!VALID_MODES.has(mode)) {
            return res.status(400).json({ ok: false, message: 'Mode leaderboard không hợp lệ' })
        }

        const requestedWeekStart = normalizeWeekStart(req.body?.weekStart)
        const currentPeriod = buildWeeklyPeriod(new Date())
        const weekStart = requestedWeekStart || currentPeriod.weekStart

        const targetUserId = String(req.body?.userId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'userId không hợp lệ' })
        }

        const rewardRows = await WeeklyLeaderboardReward.find({ weekStart, mode, userId: targetUserId })
            .sort({ rewardedAt: -1, _id: -1 })
            .lean()

        if (rewardRows.length === 0) {
            return res.status(404).json({ ok: false, message: 'Người chơi này chưa có phần thưởng để thu hồi trong tuần đã chọn' })
        }

        const warnings = []

        await runWithOptionalTransaction(async (session) => {
            for (const rewardRow of rewardRows) {
                const rewardType = normalizeRewardType(rewardRow?.rewardType)
                const rewardAmount = Math.max(1, Number.parseInt(rewardRow?.rewardAmount, 10) || 1)

                if (rewardType === 'platinumCoins' || rewardType === 'moonPoints') {
                    const playerState = await attachSession(PlayerState.findOne({ userId: targetUserId }), session)
                    if (playerState) {
                        const field = rewardType === 'platinumCoins' ? 'gold' : 'moonPoints'
                        const currentValue = Math.max(0, Number(playerState?.[field] || 0))
                        playerState[field] = Math.max(0, currentValue - rewardAmount)
                        await playerState.save(getSessionOptions(session))
                    }
                }

                if (rewardType === 'item' && rewardRow?.rewardItemId) {
                    const inventoryDoc = await attachSession(UserInventory.findOne({ userId: targetUserId, itemId: rewardRow.rewardItemId }), session)
                    if (inventoryDoc) {
                        const currentQuantity = Math.max(0, Number(inventoryDoc?.quantity || 0))
                        const nextQuantity = Math.max(0, currentQuantity - rewardAmount)
                        if (nextQuantity <= 0) {
                            await inventoryDoc.deleteOne(getSessionOptions(session))
                        } else {
                            inventoryDoc.quantity = nextQuantity
                            await inventoryDoc.save(getSessionOptions(session))
                        }
                    } else {
                        warnings.push(`Không tìm thấy vật phẩm đã trao để thu hồi: ${rewardRow.rewardItemNameSnapshot || 'Item'}`)
                    }
                }

                if (rewardType === 'pokemon' && rewardRow?.rewardPokemonId) {
                    const originToken = buildPokemonRewardOriginToken({
                        weekStart,
                        mode,
                        rewardedBy: rewardRow?.rewardedBy,
                    })

                    const pokemonDocs = UserPokemon.find({
                        userId: targetUserId,
                        pokemonId: rewardRow.rewardPokemonId,
                        formId: normalizeFormId(rewardRow.rewardPokemonFormId || 'normal'),
                        level: Math.max(1, Number.parseInt(rewardRow.rewardPokemonLevel, 10) || 5),
                        isShiny: Boolean(rewardRow.rewardPokemonIsShiny),
                        originalTrainer: originToken,
                    })
                        .sort({ createdAt: -1, _id: -1 })
                        .limit(rewardAmount)

                    const resolvedPokemonDocs = await attachSession(pokemonDocs, session)

                    if (resolvedPokemonDocs.length < rewardAmount) {
                        warnings.push(`Chỉ tìm thấy ${resolvedPokemonDocs.length}/${rewardAmount} Pokemon để thu hồi: ${rewardRow.rewardPokemonNameSnapshot || 'Pokemon'}`)
                    }

                    const pokemonIdsToDelete = resolvedPokemonDocs.map((entry) => entry?._id).filter(Boolean)
                    if (pokemonIdsToDelete.length > 0) {
                        await attachSession(UserPokemon.deleteMany({ _id: { $in: pokemonIdsToDelete } }), session)
                    }
                }
            }

            await attachSession(WeeklyLeaderboardReward.deleteMany({ _id: { $in: rewardRows.map((entry) => entry._id) } }), session)
        })

        return res.json({
            ok: true,
            message: `Đã thu hồi ${rewardRows.length} phần thưởng của người chơi trong tuần này`,
            revokedCount: rewardRows.length,
            warnings,
        })
    } catch (error) {
        console.error('POST /api/admin/leaderboard-rewards/revoke error:', error)
        return res.status(500).json({ ok: false, message: 'Thu hồi phần thưởng leaderboard thất bại' })
    }
})

export default router
