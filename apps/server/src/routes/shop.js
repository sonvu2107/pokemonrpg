import express from 'express'
import mongoose from 'mongoose'
import { authMiddleware } from '../middleware/auth.js'
import MarketListing from '../models/MarketListing.js'
import ItemMarketListing from '../models/ItemMarketListing.js'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import User from '../models/User.js'
import Item from '../models/Item.js'
import UserInventory from '../models/UserInventory.js'
import ItemPurchaseLog from '../models/ItemPurchaseLog.js'
import Move from '../models/Move.js'
import UserMoveInventory from '../models/UserMoveInventory.js'
import MovePurchaseLog from '../models/MovePurchaseLog.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

const router = express.Router()

const ORDER_BY_MAP = {
    date: 'listedAt',
    level: 'level',
    user: 'seller.username',
    price: 'price',
}

const SHOP_TYPE_ITEM = 'item'
const SHOP_TYPE_MOON = 'moon'
const SHOP_LIMIT_TIMEZONE = String(process.env.GAME_TIMEZONE || 'Asia/Ho_Chi_Minh').trim() || 'Asia/Ho_Chi_Minh'


const toSafePage = (value) => Math.max(1, parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(50, Math.max(1, parseInt(value, 10) || 20))
const toSafePrice = (value) => Math.max(1, parseInt(value, 10) || 0)
const toSafeQuantity = (value) => Math.min(999, Math.max(1, parseInt(value, 10) || 1))
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ITEM_MARKET_EFFECT_LABELS = Object.freeze({
    none: 'Khác',
    catchMultiplier: 'Bắt Pokemon',
    heal: 'Hồi phục',
    healAmount: 'Hồi phục',
    grantVipTier: 'VIP',
    allowOffTypeSkills: 'Skill khác hệ',
    grantPokemonExp: 'EXP Pokemon',
    grantPokemonLevel: 'Tăng cấp Pokemon',
    transferPokemonLevel: 'Chuyển level Pokemon',
    fusionStone: 'Đá ghép',
    fusionLuckyStone: 'Đá may mắn',
    fusionProtectionStone: 'Đá bảo hộ',
    superFusionStone: 'Super Fusion',
})

const resolveVipLevel = (userLike = null) => Math.max(0, Number.parseInt(userLike?.vipTierLevel, 10) || 0)

const resolveBasePurchaseLimit = (item = null, shopType = SHOP_TYPE_ITEM) => {
    const specificLimitField = shopType === SHOP_TYPE_MOON ? 'moonShopPurchaseLimit' : 'itemShopPurchaseLimit'
    const specificLimit = item?.[specificLimitField]
    if (specificLimit !== undefined && specificLimit !== null) {
        return Math.max(0, Number(specificLimit) || 0)
    }

    return Math.max(0, Number(item?.purchaseLimit) || 0)
}

const computeEffectivePurchaseLimit = (item = null, vipLevel = 0, shopType = SHOP_TYPE_ITEM) => {
    const baseLimit = resolveBasePurchaseLimit(item, shopType)
    if (baseLimit <= 0) {
        return 0
    }

    const bonusPerLevel = Math.max(0, Number(item?.vipPurchaseLimitBonusPerLevel) || 0)
    const effectiveLimit = baseLimit + (Math.max(0, vipLevel) * bonusPerLevel)
    return Math.max(0, Math.floor(effectiveLimit))
}

const buildCurrentWeekExpr = (fieldName = '$createdAt') => {
    const now = new Date()
    return {
        $eq: [
            {
                $dateTrunc: {
                    date: fieldName,
                    unit: 'week',
                    startOfWeek: 'monday',
                    timezone: SHOP_LIMIT_TIMEZONE,
                },
            },
            {
                $dateTrunc: {
                    date: now,
                    unit: 'week',
                    startOfWeek: 'monday',
                    timezone: SHOP_LIMIT_TIMEZONE,
                },
            },
        ],
    }
}

const serializeWallet = (playerState) => {
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerState?.moonPoints || 0),
    }
}

const resolvePokemonForm = (pokemon = null, formId = null) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)

    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    let resolvedFormId = requestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return { form: resolvedForm, formId: resolvedFormId }
}

const resolvePokemonSpriteByForm = (pokemon = null, formId = null) => {
    const { form } = resolvePokemonForm(pokemon, formId)
    return form?.imageUrl
        || form?.sprites?.normal
        || form?.sprites?.icon
        || pokemon?.imageUrl
        || pokemon?.sprites?.normal
        || pokemon?.sprites?.front_default
        || ''
}

const buildAvailableSellPokemonPipeline = ({ userIdObject, page = 1, limit = 24, search = '' }) => {
    const safePage = toSafePage(page)
    const safeLimit = toSafeLimit(limit)
    const normalizedSearch = String(search || '').trim()

    return [
        {
            $match: withActiveUserPokemonFilter({
                userId: userIdObject,
                location: 'box',
            }),
        },
        {
            $lookup: {
                from: 'marketlistings',
                let: { userPokemonId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$userPokemonId', '$$userPokemonId'] },
                                    { $eq: ['$status', 'active'] },
                                ],
                            },
                        },
                    },
                    { $project: { _id: 1 } },
                ],
                as: 'activeListing',
            },
        },
        {
            $match: {
                activeListing: { $eq: [] },
            },
        },
        {
            $lookup: {
                from: 'pokemons',
                localField: 'pokemonId',
                foreignField: '_id',
                as: 'pokemon',
            },
        },
        {
            $unwind: {
                path: '$pokemon',
                preserveNullAndEmptyArrays: true,
            },
        },
        ...(normalizedSearch
            ? [{
                $match: {
                    $or: [
                        { nickname: { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
                        { formId: { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
                        { 'pokemon.name': { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
                        { 'pokemon.forms.formName': { $regex: escapeRegExp(normalizedSearch), $options: 'i' } },
                    ],
                },
            }]
            : []),
        { $sort: { updatedAt: -1, _id: -1 } },
        {
            $facet: {
                rows: [
                    { $skip: (safePage - 1) * safeLimit },
                    { $limit: safeLimit },
                    {
                        $project: {
                            _id: 1,
                            nickname: 1,
                            level: 1,
                            formId: 1,
                            pokemon: {
                                name: '$pokemon.name',
                                types: '$pokemon.types',
                                imageUrl: '$pokemon.imageUrl',
                                sprites: '$pokemon.sprites',
                                forms: '$pokemon.forms',
                                defaultFormId: '$pokemon.defaultFormId',
                            },
                        },
                    },
                ],
                total: [
                    { $count: 'count' },
                ],
            },
        },
    ]
}

const mapAvailableSellPokemonEntry = (entry = null) => {
    const resolvedForm = resolvePokemonForm(entry?.pokemon, entry?.formId)
    return {
        id: entry?._id,
        pokemonName: entry?.nickname || entry?.pokemon?.name || 'Pokemon',
        speciesName: entry?.pokemon?.name || 'Pokemon',
        level: entry?.level || 1,
        formId: resolvedForm.formId,
        formName: resolvedForm.form?.formName || resolvedForm.formId,
        sprite: resolvePokemonSpriteByForm(entry?.pokemon, resolvedForm.formId),
        type: entry?.pokemon?.types || [],
    }
}

const fetchAvailableSellPokemon = async ({ userId, page = 1, limit = 24, search = '' }) => {
    const safePage = toSafePage(page)
    const safeLimit = toSafeLimit(limit)
    const facetRows = await UserPokemon.aggregate(
        buildAvailableSellPokemonPipeline({
            userIdObject: new mongoose.Types.ObjectId(userId),
            page: safePage,
            limit: safeLimit,
            search,
        })
    ).allowDiskUse(true)

    const facet = facetRows?.[0] || {}
    const rows = facet.rows || []
    const total = facet.total?.[0]?.count || 0

    return {
        rows: rows.map(mapAvailableSellPokemonEntry),
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            totalPages: Math.max(1, Math.ceil(total / safeLimit)),
        },
    }
}

const buildItemEffectCategory = (itemLike = {}) => {
    const effectType = String(itemLike?.effectType || 'none').trim()
    if (effectType && effectType !== 'none') return effectType
    const itemType = String(itemLike?.type || itemLike?.itemType || 'misc').trim()
    return itemType || 'misc'
}

const mapItemMarketListing = (row = {}) => ({
    id: row._id,
    itemId: row.itemId,
    itemName: row.itemName || 'Vật phẩm',
    itemType: row.itemType || 'misc',
    itemRarity: row.itemRarity || 'common',
    itemImageUrl: row.itemImageUrl || '',
    effectType: row.effectType || 'none',
    effectCategory: buildItemEffectCategory(row),
    effectCategoryLabel: ITEM_MARKET_EFFECT_LABELS[String(row.effectType || 'none').trim()] || 'Công dụng khác',
    quantity: Math.max(1, Number(row.quantity || 1)),
    price: Math.max(0, Number(row.price || 0)),
    listedAt: row.listedAt || null,
    soldAt: row.soldAt || null,
    status: row.status || 'active',
    seller: row?.seller ? {
        id: row.seller._id || null,
        username: row.seller.username || 'Không rõ',
        role: row.seller.role || 'user',
        vipTierLevel: Math.max(0, Number.parseInt(row.seller.vipTierLevel, 10) || 0),
        vipTierCode: String(row.seller.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: row.seller.vipBenefits || {},
    } : null,
    buyer: row?.buyer ? {
        id: row.buyer._id || null,
        username: row.buyer.username || 'Không rõ',
        role: row.buyer.role || 'user',
        vipTierLevel: Math.max(0, Number.parseInt(row.buyer.vipTierLevel, 10) || 0),
        vipTierCode: String(row.buyer.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: row.buyer.vipBenefits || {},
    } : null,
})

router.use(authMiddleware)

// GET /api/shop/items
router.get('/items', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const type = String(req.query.type || '').trim().toLowerCase()

        const query = {
            isShopEnabled: true,
            shopPrice: { $gt: 0 },
        }
        if (type) {
            query.type = type
        }

        const [playerState, user, items, total] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            User.findById(userId).select('vipTierLevel').lean(),
            Item.find(query)
                .select('name type rarity imageUrl description shopPrice purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel effectType effectValue effectValueMp')
                .sort({ shopPrice: 1, nameLower: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Item.countDocuments(query),
        ])

        const vipLevel = resolveVipLevel(user)
        const itemIds = items.map((entry) => entry?._id).filter(Boolean)
        const purchaseSummary = itemIds.length > 0
            ? await ItemPurchaseLog.aggregate([
                {
                    $match: {
                        buyerId: new mongoose.Types.ObjectId(userId),
                        shopType: SHOP_TYPE_ITEM,
                        itemId: { $in: itemIds },
                        $expr: buildCurrentWeekExpr('$createdAt'),
                    },
                },
                {
                    $group: {
                        _id: '$itemId',
                        totalQuantity: { $sum: '$quantity' },
                    },
                },
            ])
            : []

        const purchasedByItemId = new Map(
            purchaseSummary.map((entry) => [String(entry?._id || ''), Math.max(0, Number(entry?.totalQuantity) || 0)])
        )

        const mappedItems = items.map((entry) => {
            const purchasedQuantity = purchasedByItemId.get(String(entry?._id || '')) || 0
            const effectivePurchaseLimit = computeEffectivePurchaseLimit(entry, vipLevel, SHOP_TYPE_ITEM)
            const remainingPurchaseLimit = effectivePurchaseLimit > 0
                ? Math.max(0, effectivePurchaseLimit - purchasedQuantity)
                : 0
            return {
                ...entry,
                shopType: SHOP_TYPE_ITEM,
                effectivePurchaseLimit,
                purchasedQuantity,
                remainingPurchaseLimit,
            }
        })

        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            items: mappedItems,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/items error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng vật phẩm' })
    }
})

// GET /api/shop/items/:itemId
router.get('/items/:itemId', async (req, res) => {
    try {
        const userId = req.user.userId
        const itemId = String(req.params.itemId || '').trim()

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const [item, playerState, inventoryEntry, user] = await Promise.all([
            Item.findById(itemId)
                .select('name type rarity imageUrl description shopPrice isShopEnabled purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel effectType effectValue effectValueMp effectDurationUnit')
                .lean(),
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            UserInventory.findOne({ userId, itemId }).select('quantity').lean(),
            User.findById(userId).select('vipTierLevel').lean(),
        ])

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        const purchasedQuantityAgg = await ItemPurchaseLog.aggregate([
            {
                $match: {
                    buyerId: new mongoose.Types.ObjectId(userId),
                    itemId: new mongoose.Types.ObjectId(itemId),
                    shopType: SHOP_TYPE_ITEM,
                    $expr: buildCurrentWeekExpr('$createdAt'),
                },
            },
            {
                $group: {
                    _id: '$itemId',
                    totalQuantity: { $sum: '$quantity' },
                },
            },
        ])
        const purchasedQuantity = Math.max(0, Number(purchasedQuantityAgg?.[0]?.totalQuantity) || 0)
        const effectivePurchaseLimit = computeEffectivePurchaseLimit(item, resolveVipLevel(user), SHOP_TYPE_ITEM)
        const remainingPurchaseLimit = effectivePurchaseLimit > 0 ? Math.max(0, effectivePurchaseLimit - purchasedQuantity) : 0

        res.json({
            ok: true,
            item: {
                ...item,
                shopType: SHOP_TYPE_ITEM,
                effectivePurchaseLimit,
                purchasedQuantity,
                remainingPurchaseLimit,
            },
            wallet: serializeWallet(playerState),
            inventory: {
                quantity: Number(inventoryEntry?.quantity || 0),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/items/:itemId error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải chi tiết vật phẩm' })
    }
})

// POST /api/shop/items/:itemId/buy
router.post('/items/:itemId/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const itemId = String(req.params.itemId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const item = await Item.findOne({
            _id: itemId,
            isShopEnabled: true,
            shopPrice: { $gt: 0 },
        })
            .select('name shopPrice purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel')
            .lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Vật phẩm không tồn tại hoặc không bán trong cửa hàng' })
        }

        const [user, purchasedQuantityAgg] = await Promise.all([
            User.findById(userId).select('vipTierLevel').lean(),
            ItemPurchaseLog.aggregate([
                {
                    $match: {
                        buyerId: new mongoose.Types.ObjectId(userId),
                        itemId: new mongoose.Types.ObjectId(itemId),
                        shopType: SHOP_TYPE_ITEM,
                        $expr: buildCurrentWeekExpr('$createdAt'),
                    },
                },
                {
                    $group: {
                        _id: '$itemId',
                        totalQuantity: { $sum: '$quantity' },
                    },
                },
            ]),
        ])

        const totalCost = Number(item.shopPrice || 0) * quantity
        if (!Number.isFinite(totalCost) || totalCost <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá mua không hợp lệ' })
        }

        const purchasedQuantity = Math.max(0, Number(purchasedQuantityAgg?.[0]?.totalQuantity) || 0)
        const effectivePurchaseLimit = computeEffectivePurchaseLimit(item, resolveVipLevel(user), SHOP_TYPE_ITEM)
        if (effectivePurchaseLimit > 0 && (purchasedQuantity + quantity) > effectivePurchaseLimit) {
            const remainingPurchaseLimit = Math.max(0, effectivePurchaseLimit - purchasedQuantity)
            return res.status(400).json({
                ok: false,
                message: `Vật phẩm này chỉ còn mua được ${remainingPurchaseLimit} lần theo giới hạn hiện tại`,
            })
        }

        const playerState = await PlayerState.findOneAndUpdate(
            {
                userId,
                gold: { $gte: totalCost },
            },
            {
                $inc: { gold: -totalCost },
            },
            { new: true }
        )

        if (!playerState) {
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua vật phẩm này' })
        }

        const inventoryEntry = await UserInventory.findOneAndUpdate(
            {
                userId,
                itemId,
            },
            {
                $setOnInsert: { userId, itemId },
                $inc: { quantity },
            },
            { new: true, upsert: true }
        )

        await ItemPurchaseLog.create({
            buyerId: userId,
            itemId,
            itemName: item.name || '',
            shopType: SHOP_TYPE_ITEM,
            walletCurrency: 'gold',
            quantity,
            unitPrice: Number(item.shopPrice || 0),
            totalCost,
            walletGoldBefore: Number(playerState.gold || 0) + totalCost,
            walletGoldAfter: Number(playerState.gold || 0),
        })

        res.json({
            ok: true,
            message: `Mua thành công ${quantity} ${item.name}`,
            purchase: {
                itemId,
                quantity,
                unitPrice: item.shopPrice,
                totalCost,
                shopType: SHOP_TYPE_ITEM,
            },
            wallet: serializeWallet(playerState),
            inventory: {
                itemId,
                quantity: Number(inventoryEntry?.quantity || 0),
            },
            limit: {
                period: 'week',
                purchaseLimit: resolveBasePurchaseLimit(item, SHOP_TYPE_ITEM),
                effectivePurchaseLimit,
                purchasedQuantity: purchasedQuantity + quantity,
                remainingPurchaseLimit: effectivePurchaseLimit > 0
                    ? Math.max(0, effectivePurchaseLimit - purchasedQuantity - quantity)
                    : 0,
            },
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Xung đột dữ liệu kho đồ, vui lòng thử lại' })
        }
        console.error('POST /api/shop/items/:itemId/buy error:', error)
        res.status(500).json({ ok: false, message: 'Mua vật phẩm thất bại' })
    }
})

router.get('/moon-items', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const type = String(req.query.type || '').trim().toLowerCase()

        const query = {
            isMoonShopEnabled: true,
            moonShopPrice: { $gt: 0 },
        }
        if (type) {
            query.type = type
        }

        const [playerState, user, items, total] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            User.findById(userId).select('vipTierLevel').lean(),
            Item.find(query)
                .select('name type rarity imageUrl description moonShopPrice purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel effectType effectValue effectValueMp')
                .sort({ moonShopPrice: 1, nameLower: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Item.countDocuments(query),
        ])

        const vipLevel = resolveVipLevel(user)
        const itemIds = items.map((entry) => entry?._id).filter(Boolean)
        const purchaseSummary = itemIds.length > 0
            ? await ItemPurchaseLog.aggregate([
                {
                    $match: {
                        buyerId: new mongoose.Types.ObjectId(userId),
                        shopType: SHOP_TYPE_MOON,
                        itemId: { $in: itemIds },
                        $expr: buildCurrentWeekExpr('$createdAt'),
                    },
                },
                {
                    $group: {
                        _id: '$itemId',
                        totalQuantity: { $sum: '$quantity' },
                    },
                },
            ])
            : []

        const purchasedByItemId = new Map(
            purchaseSummary.map((entry) => [String(entry?._id || ''), Math.max(0, Number(entry?.totalQuantity) || 0)])
        )

        const mappedItems = items.map((entry) => {
            const purchasedQuantity = purchasedByItemId.get(String(entry?._id || '')) || 0
            const effectivePurchaseLimit = computeEffectivePurchaseLimit(entry, vipLevel, SHOP_TYPE_MOON)
            const remainingPurchaseLimit = effectivePurchaseLimit > 0
                ? Math.max(0, effectivePurchaseLimit - purchasedQuantity)
                : 0
            return {
                ...entry,
                shopPrice: Number(entry?.moonShopPrice || 0),
                shopType: SHOP_TYPE_MOON,
                effectivePurchaseLimit,
                purchasedQuantity,
                remainingPurchaseLimit,
            }
        })

        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            items: mappedItems,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/moon-items error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu Cửa hàng Nguyệt Các' })
    }
})

// GET /api/shop/moon-items/:itemId
router.get('/moon-items/:itemId', async (req, res) => {
    try {
        const userId = req.user.userId
        const itemId = String(req.params.itemId || '').trim()

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const [item, playerState, inventoryEntry, user] = await Promise.all([
            Item.findById(itemId)
                .select('name type rarity imageUrl description moonShopPrice isMoonShopEnabled purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel effectType effectValue effectValueMp')
                .lean(),
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            UserInventory.findOne({ userId, itemId }).select('quantity').lean(),
            User.findById(userId).select('vipTierLevel').lean(),
        ])

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        const purchasedQuantityAgg = await ItemPurchaseLog.aggregate([
            {
                $match: {
                    buyerId: new mongoose.Types.ObjectId(userId),
                    itemId: new mongoose.Types.ObjectId(itemId),
                    shopType: SHOP_TYPE_MOON,
                    $expr: buildCurrentWeekExpr('$createdAt'),
                },
            },
            {
                $group: {
                    _id: '$itemId',
                    totalQuantity: { $sum: '$quantity' },
                },
            },
        ])

        const purchasedQuantity = Math.max(0, Number(purchasedQuantityAgg?.[0]?.totalQuantity) || 0)
        const effectivePurchaseLimit = computeEffectivePurchaseLimit(item, resolveVipLevel(user), SHOP_TYPE_MOON)
        const remainingPurchaseLimit = effectivePurchaseLimit > 0
            ? Math.max(0, effectivePurchaseLimit - purchasedQuantity)
            : 0

        res.json({
            ok: true,
            item: {
                ...item,
                shopPrice: Number(item?.moonShopPrice || 0),
                shopType: SHOP_TYPE_MOON,
                effectivePurchaseLimit,
                purchasedQuantity,
                remainingPurchaseLimit,
            },
            wallet: serializeWallet(playerState),
            inventory: {
                quantity: Number(inventoryEntry?.quantity || 0),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/moon-items/:itemId error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải chi tiết vật phẩm Nguyệt Các' })
    }
})

router.post('/moon-items/:itemId/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const itemId = String(req.params.itemId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const item = await Item.findOne({
            _id: itemId,
            isMoonShopEnabled: true,
            moonShopPrice: { $gt: 0 },
        })
            .select('name moonShopPrice purchaseLimit itemShopPurchaseLimit moonShopPurchaseLimit vipPurchaseLimitBonusPerLevel')
            .lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Vật phẩm không tồn tại hoặc không bán trong Cửa hàng Nguyệt Các' })
        }

        const [user, purchasedQuantityAgg] = await Promise.all([
            User.findById(userId).select('vipTierLevel').lean(),
            ItemPurchaseLog.aggregate([
                {
                    $match: {
                        buyerId: new mongoose.Types.ObjectId(userId),
                        itemId: new mongoose.Types.ObjectId(itemId),
                        shopType: SHOP_TYPE_MOON,
                        $expr: buildCurrentWeekExpr('$createdAt'),
                    },
                },
                {
                    $group: {
                        _id: '$itemId',
                        totalQuantity: { $sum: '$quantity' },
                    },
                },
            ]),
        ])

        const totalCost = Number(item.moonShopPrice || 0) * quantity
        if (!Number.isFinite(totalCost) || totalCost <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá mua không hợp lệ' })
        }

        const purchasedQuantity = Math.max(0, Number(purchasedQuantityAgg?.[0]?.totalQuantity) || 0)
        const effectivePurchaseLimit = computeEffectivePurchaseLimit(item, resolveVipLevel(user), SHOP_TYPE_MOON)
        if (effectivePurchaseLimit > 0 && (purchasedQuantity + quantity) > effectivePurchaseLimit) {
            const remainingPurchaseLimit = Math.max(0, effectivePurchaseLimit - purchasedQuantity)
            return res.status(400).json({
                ok: false,
                message: `Vật phẩm này chỉ còn mua được ${remainingPurchaseLimit} lần theo giới hạn hiện tại`,
            })
        }

        const playerState = await PlayerState.findOneAndUpdate(
            {
                userId,
                moonPoints: { $gte: totalCost },
            },
            {
                $inc: { moonPoints: -totalCost },
            },
            { new: true }
        )

        if (!playerState) {
            return res.status(400).json({ ok: false, message: 'Không đủ Điểm Nguyệt Các để mua vật phẩm này' })
        }

        const inventoryEntry = await UserInventory.findOneAndUpdate(
            {
                userId,
                itemId,
            },
            {
                $setOnInsert: { userId, itemId },
                $inc: { quantity },
            },
            { new: true, upsert: true }
        )

        await ItemPurchaseLog.create({
            buyerId: userId,
            itemId,
            itemName: item.name || '',
            shopType: SHOP_TYPE_MOON,
            walletCurrency: 'moonPoints',
            quantity,
            unitPrice: Number(item.moonShopPrice || 0),
            totalCost,
            walletGoldBefore: Number(playerState.moonPoints || 0) + totalCost,
            walletGoldAfter: Number(playerState.moonPoints || 0),
        })

        res.json({
            ok: true,
            message: `Mua thành công ${quantity} ${item.name}`,
            purchase: {
                itemId,
                quantity,
                unitPrice: item.moonShopPrice,
                totalCost,
                shopType: SHOP_TYPE_MOON,
            },
            wallet: serializeWallet(playerState),
            inventory: {
                itemId,
                quantity: Number(inventoryEntry?.quantity || 0),
            },
            limit: {
                period: 'week',
                purchaseLimit: resolveBasePurchaseLimit(item, SHOP_TYPE_MOON),
                effectivePurchaseLimit,
                purchasedQuantity: purchasedQuantity + quantity,
                remainingPurchaseLimit: effectivePurchaseLimit > 0
                    ? Math.max(0, effectivePurchaseLimit - purchasedQuantity - quantity)
                    : 0,
            },
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Xung đột dữ liệu kho đồ, vui lòng thử lại' })
        }
        console.error('POST /api/shop/moon-items/:itemId/buy error:', error)
        res.status(500).json({ ok: false, message: 'Mua vật phẩm thất bại' })
    }
})

// GET /api/shop/skills
router.get('/skills', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const type = String(req.query.type || '').trim().toLowerCase()
        const category = String(req.query.category || '').trim().toLowerCase()
        const rarity = String(req.query.rarity || '').trim().toLowerCase()
        const sort = String(req.query.sort || '').trim().toLowerCase()
        const search = String(req.query.search || '').trim()

        const sortOptions = {
            price_asc: { shopPrice: 1, nameLower: 1, _id: 1 },
            price_desc: { shopPrice: -1, nameLower: 1, _id: 1 },
            type_asc: { type: 1, nameLower: 1, _id: 1 },
            type_desc: { type: -1, nameLower: 1, _id: 1 },
            rarity_asc: { rarity: 1, nameLower: 1, _id: 1 },
            rarity_desc: { rarity: -1, nameLower: 1, _id: 1 },
            name_asc: { nameLower: 1, _id: 1 },
            name_desc: { nameLower: -1, _id: 1 },
        }
        const sortQuery = sortOptions[sort] || sortOptions.price_asc

        const query = {
            isShopEnabled: true,
            isActive: true,
            shopPrice: { $gt: 0 },
        }
        if (type) {
            query.type = type
        }
        if (category) {
            query.category = category
        }
        if (rarity) {
            query.rarity = rarity
        }
        if (search) {
            const escaped = escapeRegExp(search)
            query.$or = [
                { name: { $regex: escaped, $options: 'i' } },
                { description: { $regex: escaped, $options: 'i' } },
            ]
        }

        const [playerState, skills, total] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            Move.find(query)
                .select('name type category power accuracy pp priority description imageUrl rarity shopPrice learnScope allowedTypes allowedRarities')
                .sort(sortQuery)
                .skip(skip)
                .limit(limit)
                .lean(),
            Move.countDocuments(query),
        ])

        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            skills,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/skills error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng kỹ năng' })
    }
})

// POST /api/shop/skills/:moveId/buy
router.post('/skills/:moveId/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const moveId = String(req.params.moveId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)

        if (!mongoose.Types.ObjectId.isValid(moveId)) {
            return res.status(400).json({ ok: false, message: 'moveId không hợp lệ' })
        }

        const move = await Move.findOne({
            _id: moveId,
            isShopEnabled: true,
            isActive: true,
            shopPrice: { $gt: 0 },
        })
            .select('name shopPrice')
            .lean()

        if (!move) {
            return res.status(404).json({ ok: false, message: 'Kỹ năng không tồn tại hoặc không bán trong cửa hàng' })
        }

        const totalCost = Number(move.shopPrice || 0) * quantity
        if (!Number.isFinite(totalCost) || totalCost <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá mua không hợp lệ' })
        }

        const playerState = await PlayerState.findOneAndUpdate(
            {
                userId,
                gold: { $gte: totalCost },
            },
            {
                $inc: { gold: -totalCost },
            },
            { new: true }
        )

        if (!playerState) {
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua kỹ năng này' })
        }

        const moveInventoryEntry = await UserMoveInventory.findOneAndUpdate(
            {
                userId,
                moveId,
            },
            {
                $setOnInsert: { userId, moveId },
                $inc: { quantity },
            },
            { new: true, upsert: true }
        )

        await MovePurchaseLog.create({
            buyerId: userId,
            moveId,
            moveName: move.name || '',
            quantity,
            unitPrice: Number(move.shopPrice || 0),
            totalCost,
            walletGoldBefore: Number(playerState.gold || 0) + totalCost,
            walletGoldAfter: Number(playerState.gold || 0),
        })

        res.json({
            ok: true,
            message: `Mua thành công ${quantity} kỹ năng ${move.name}`,
            purchase: {
                moveId,
                quantity,
                unitPrice: move.shopPrice,
                totalCost,
            },
            wallet: serializeWallet(playerState),
            inventory: {
                moveId,
                quantity: Number(moveInventoryEntry?.quantity || 0),
            },
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Xung đột dữ liệu kho kỹ năng, vui lòng thử lại' })
        }
        console.error('POST /api/shop/skills/:moveId/buy error:', error)
        res.status(500).json({ ok: false, message: 'Mua kỹ năng thất bại' })
    }
})

// GET /api/shop/sell
router.get('/sell', async (req, res) => {
    try {
        const userId = req.user.userId
        const userIdObject = new mongoose.Types.ObjectId(userId)
        const activePage = toSafePage(req.query.activePage)
        const soldPage = toSafePage(req.query.soldPage)
        const limit = toSafeLimit(req.query.limit)
        const includeAvailable = String(req.query.includeAvailable || '1') !== '0'

        const availablePokemonPromise = includeAvailable
            ? UserPokemon.aggregate([
                {
                    $match: withActiveUserPokemonFilter({
                        userId: userIdObject,
                        location: 'box',
                    }),
                },
                {
                    $lookup: {
                        from: 'marketlistings',
                        let: { userPokemonId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$userPokemonId', '$$userPokemonId'] },
                                            { $eq: ['$status', 'active'] },
                                        ],
                                    },
                                },
                            },
                            { $project: { _id: 1 } },
                        ],
                        as: 'activeListing',
                    },
                },
                {
                    $match: {
                        activeListing: { $eq: [] },
                    },
                },
                { $sort: { updatedAt: -1, _id: -1 } },
                { $limit: 200 },
                {
                    $lookup: {
                        from: 'pokemons',
                        localField: 'pokemonId',
                        foreignField: '_id',
                        as: 'pokemon',
                    },
                },
                {
                    $unwind: {
                        path: '$pokemon',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $project: {
                        _id: 1,
                        nickname: 1,
                        level: 1,
                        formId: 1,
                        pokemon: {
                            name: '$pokemon.name',
                            types: '$pokemon.types',
                            imageUrl: '$pokemon.imageUrl',
                            sprites: '$pokemon.sprites',
                            forms: '$pokemon.forms',
                            defaultFormId: '$pokemon.defaultFormId',
                        },
                    },
                },
            ]).allowDiskUse(true)
            : Promise.resolve([])

        const [playerState, listingFacet, availableRows] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            MarketListing.aggregate([
                {
                    $match: {
                        sellerId: userIdObject,
                    },
                },
                {
                    $facet: {
                        activeRows: [
                            { $match: { status: 'active' } },
                            { $sort: { listedAt: -1, _id: -1 } },
                            { $skip: (activePage - 1) * limit },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'pokemons',
                                    localField: 'pokemonId',
                                    foreignField: '_id',
                                    as: 'pokemon',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$pokemon',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
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
                                $project: {
                                    _id: 1,
                                    userPokemonId: 1,
                                    nickname: 1,
                                    formId: 1,
                                    level: 1,
                                    price: 1,
                                    otName: 1,
                                    listedAt: 1,
                                    soldAt: 1,
                                    status: 1,
                                    pokemon: {
                                        name: '$pokemon.name',
                                        types: '$pokemon.types',
                                        imageUrl: '$pokemon.imageUrl',
                                        sprites: '$pokemon.sprites',
                                        forms: '$pokemon.forms',
                                        defaultFormId: '$pokemon.defaultFormId',
                                    },
                                    buyer: {
                                        _id: '$buyer._id',
                                        username: '$buyer.username',
                                        role: '$buyer.role',
                                        vipTierLevel: '$buyer.vipTierLevel',
                                        vipTierCode: '$buyer.vipTierCode',
                                        vipBenefits: '$buyer.vipBenefits',
                                    },
                                },
                            },
                        ],
                        soldRows: [
                            { $match: { status: 'sold' } },
                            { $sort: { soldAt: -1, _id: -1 } },
                            { $skip: (soldPage - 1) * limit },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'pokemons',
                                    localField: 'pokemonId',
                                    foreignField: '_id',
                                    as: 'pokemon',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$pokemon',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
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
                                $project: {
                                    _id: 1,
                                    userPokemonId: 1,
                                    nickname: 1,
                                    formId: 1,
                                    level: 1,
                                    price: 1,
                                    otName: 1,
                                    listedAt: 1,
                                    soldAt: 1,
                                    status: 1,
                                    pokemon: {
                                        name: '$pokemon.name',
                                        types: '$pokemon.types',
                                        imageUrl: '$pokemon.imageUrl',
                                        sprites: '$pokemon.sprites',
                                        forms: '$pokemon.forms',
                                        defaultFormId: '$pokemon.defaultFormId',
                                    },
                                    buyer: {
                                        _id: '$buyer._id',
                                        username: '$buyer.username',
                                        role: '$buyer.role',
                                        vipTierLevel: '$buyer.vipTierLevel',
                                        vipTierCode: '$buyer.vipTierCode',
                                        vipBenefits: '$buyer.vipBenefits',
                                    },
                                },
                            },
                        ],
                        activeTotal: [
                            { $match: { status: 'active' } },
                            { $count: 'count' },
                        ],
                        soldTotal: [
                            { $match: { status: 'sold' } },
                            { $count: 'count' },
                        ],
                    },
                },
            ]).allowDiskUse(true),
            availablePokemonPromise,
        ])

        const listingData = listingFacet?.[0] || {}
        const activeRows = listingData.activeRows || []
        const soldRows = listingData.soldRows || []
        const activeTotal = listingData.activeTotal?.[0]?.count || 0
        const soldTotal = listingData.soldTotal?.[0]?.count || 0

        const availablePokemon = includeAvailable
            ? availableRows.map((entry) => {
                const resolvedForm = resolvePokemonForm(entry?.pokemon, entry?.formId)
                return {
                    id: entry._id,
                    pokemonName: entry.nickname || entry?.pokemon?.name || 'Pokemon',
                    speciesName: entry?.pokemon?.name || 'Pokemon',
                    level: entry.level || 1,
                    formId: resolvedForm.formId,
                    formName: resolvedForm.form?.formName || resolvedForm.formId,
                    sprite: resolvePokemonSpriteByForm(entry?.pokemon, resolvedForm.formId),
                    type: entry?.pokemon?.types || [],
                }
            })
            : null

        const mapListing = (row) => {
            const resolvedForm = resolvePokemonForm(row?.pokemon, row?.formId)
            return {
                id: row._id,
                userPokemonId: row.userPokemonId,
                pokemonName: row.nickname || row?.pokemon?.name || 'Pokemon',
                speciesName: row?.pokemon?.name || 'Pokemon',
                level: row.level || 1,
                formId: resolvedForm.formId,
                formName: resolvedForm.form?.formName || resolvedForm.formId,
                price: row.price || 0,
                otName: row.otName || '',
                listedAt: row.listedAt,
                soldAt: row.soldAt,
                sprite: resolvePokemonSpriteByForm(row?.pokemon, resolvedForm.formId),
                buyer: row?.buyer
                    ? {
                        id: row.buyer._id,
                        username: row.buyer.username || 'Không rõ',
                        role: row.buyer.role || 'user',
                        vipTierLevel: Math.max(0, Number.parseInt(row.buyer.vipTierLevel, 10) || 0),
                        vipTierCode: String(row.buyer.vipTierCode || '').trim().toUpperCase(),
                        vipBenefits: row.buyer.vipBenefits || {},
                    }
                    : null,
                status: row.status,
            }
        }

        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            availablePokemon,
            activeListings: activeRows.map(mapListing),
            soldListings: soldRows.map(mapListing),
            pagination: {
                limit,
                active: {
                    page: activePage,
                    total: activeTotal,
                    totalPages: Math.max(1, Math.ceil(activeTotal / limit)),
                },
                sold: {
                    page: soldPage,
                    total: soldTotal,
                    totalPages: Math.max(1, Math.ceil(soldTotal / limit)),
                },
            },
        })
    } catch (error) {
        console.error('GET /api/shop/sell error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng bán' })
    }
})

router.get('/sell/available-pokemon', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit || 24)
        const search = String(req.query.search || '').trim()

        const result = await fetchAvailableSellPokemon({ userId, page, limit, search })

        res.json({
            ok: true,
            availablePokemon: result.rows,
            pagination: result.pagination,
        })
    } catch (error) {
        console.error('GET /api/shop/sell/available-pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải Pokemon khả dụng để đăng bán' })
    }
})

// POST /api/shop/sell/list
router.post('/sell/list', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const userPokemonId = String(req.body?.userPokemonId || '').trim()
        const price = toSafePrice(req.body?.price)

        if (!mongoose.Types.ObjectId.isValid(userPokemonId)) {
            return res.status(400).json({ ok: false, message: 'userPokemonId không hợp lệ' })
        }
        if (!Number.isFinite(price) || price <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá bán không hợp lệ' })
        }

        const userPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({
            _id: userPokemonId,
            userId: sellerId,
            location: 'box',
        }))
            .select('pokemonId nickname formId level')
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon không tồn tại trong kho hoặc không thuộc sở hữu của bạn' })
        }

        const existingListing = await MarketListing.findOne({
            userPokemonId,
            status: 'active',
        })
            .select('_id')
            .lean()

        if (existingListing) {
            return res.status(409).json({ ok: false, message: 'Pokemon này đang được rao bán' })
        }

        const seller = await User.findById(sellerId).select('username').lean()

        await MarketListing.create({
            sellerId,
            userPokemonId,
            pokemonId: userPokemon.pokemonId,
            nickname: userPokemon.nickname || '',
            formId: userPokemon.formId || 'normal',
            level: Math.max(1, Number(userPokemon.level) || 1),
            price,
            otName: seller?.username || 'Không rõ',
            status: 'active',
            listedAt: new Date(),
        })

        res.status(201).json({ ok: true, message: 'Đăng bán Pokemon thành công!' })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Pokemon này đang được rao bán' })
        }
        console.error('POST /api/shop/sell/list error:', error)
        res.status(500).json({ ok: false, message: 'Tạo tin đăng thất bại' })
    }
})

// POST /api/shop/sell/:listingId/cancel
router.post('/sell/:listingId/cancel', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()

        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const cancelled = await MarketListing.findOneAndUpdate(
            {
                _id: listingId,
                sellerId,
                status: 'active',
            },
            {
                $set: {
                    status: 'cancelled',
                },
            },
            { new: true }
        )

        if (!cancelled) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng đang hoạt động để hủy' })
        }

        res.json({ ok: true, message: 'Đã hủy đăng bán Pokemon' })
    } catch (error) {
        console.error('POST /api/shop/sell/:listingId/cancel error:', error)
        res.status(500).json({ ok: false, message: 'Hủy tin đăng thất bại' })
    }
})

// GET /api/shop/buy
router.get('/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const type = String(req.query.type || 'all').trim().toLowerCase()
        const pokemonName = String(req.query.pokemonName || 'all').trim()
        const display = String(req.query.display || 'all').trim().toLowerCase()
        const orderBy = String(req.query.orderBy || 'date').trim().toLowerCase()
        const direction = String(req.query.direction || 'desc').trim().toLowerCase() === 'asc' ? 1 : -1

        const baseMatch = {}
        if (display === 'sold_by_you') {
            baseMatch.sellerId = new mongoose.Types.ObjectId(userId)
            baseMatch.status = 'sold'
        } else {
            baseMatch.status = 'active'
            if (display === 'to_you') {
                baseMatch.reservedForUserId = new mongoose.Types.ObjectId(userId)
            }
        }

        const orderField = ORDER_BY_MAP[orderBy] || ORDER_BY_MAP.date
        const sortStage = { [orderField]: direction, _id: -1 }

        const postLookupMatch = {}
        if (type !== 'all') {
            postLookupMatch['pokemon.types'] = type
        }
        if (pokemonName !== 'all') {
            postLookupMatch['pokemon.name'] = pokemonName
        }

        const listingsPromise = MarketListing.aggregate([
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
                    localField: 'sellerId',
                    foreignField: '_id',
                    as: 'seller',
                },
            },
            {
                $unwind: {
                    path: '$seller',
                    preserveNullAndEmptyArrays: true,
                },
            },
            ...(Object.keys(postLookupMatch).length > 0 ? [{ $match: postLookupMatch }] : []),
            {
                $project: {
                    userPokemonId: 1,
                    nickname: 1,
                    formId: 1,
                    level: 1,
                    price: 1,
                    otName: 1,
                    listedAt: 1,
                    status: 1,
                    reservedForUserId: 1,
                    pokemon: {
                        _id: '$pokemon._id',
                        name: '$pokemon.name',
                        types: '$pokemon.types',
                        imageUrl: '$pokemon.imageUrl',
                        sprites: '$pokemon.sprites',
                        forms: '$pokemon.forms',
                        defaultFormId: '$pokemon.defaultFormId',
                    },
                    seller: {
                        _id: '$seller._id',
                        username: '$seller.username',
                        role: '$seller.role',
                        vipTierLevel: '$seller.vipTierLevel',
                        vipTierCode: '$seller.vipTierCode',
                        vipBenefits: '$seller.vipBenefits',
                    },
                },
            },
            {
                $facet: {
                    rows: [
                        { $sort: sortStage },
                        { $skip: skip },
                        { $limit: limit },
                    ],
                    total: [{ $count: 'count' }],
                    options: [
                        {
                            $group: {
                                _id: null,
                                types: { $addToSet: '$pokemon.types' },
                                pokemonNames: { $addToSet: '$pokemon.name' },
                            },
                        },
                    ],
                },
            },
        ]).allowDiskUse(true)

        const [listingResultRows, playerState] = await Promise.all([
            listingsPromise,
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
        ])

        const result = listingResultRows?.[0] || {}

        const rows = result?.rows || []
        const total = result?.total?.[0]?.count || 0
        const optionTypesNested = result?.options?.[0]?.types || []
        const typeOptions = ['all', ...new Set(optionTypesNested.flat().map((entry) => String(entry || '').toLowerCase()).filter(Boolean))]
        const pokemonNameOptions = ['all', ...new Set((result?.options?.[0]?.pokemonNames || []).filter(Boolean).sort((a, b) => a.localeCompare(b)))]

        const listings = rows.map((row) => {
            const resolvedForm = resolvePokemonForm(row?.pokemon, row?.formId)
            const sprite = resolvePokemonSpriteByForm(row?.pokemon, resolvedForm.formId)
            return {
                id: row._id,
                userPokemonId: row.userPokemonId,
                pokemonName: row.nickname || row?.pokemon?.name || 'Pokemon',
                speciesName: row?.pokemon?.name || 'Pokemon',
                type: row?.pokemon?.types || [],
                level: row.level || 1,
                formId: resolvedForm.formId,
                formName: resolvedForm.form?.formName || resolvedForm.formId,
                price: row.price || 0,
                otName: row.otName || row?.seller?.username || 'Không rõ',
                seller: {
                    id: row?.seller?._id || null,
                    username: row?.seller?.username || 'Không rõ',
                },
                listedAt: row.listedAt,
                sprite,
                status: row.status,
                reservedForUserId: row.reservedForUserId || null,
            }
        })

        res.json({
            ok: true,
            listings,
            wallet: serializeWallet(playerState),
            filters: {
                typeOptions,
                pokemonNameOptions,
            },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/buy error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải danh sách cửa hàng' })
    }
})

// POST /api/shop/buy/:listingId
router.post('/buy/:listingId', async (req, res) => {
    try {
        const buyerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const preview = await MarketListing.findById(listingId)
            .select('status sellerId reservedForUserId price userPokemonId')
            .lean()

        if (!preview) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng' })
        }
        if (preview.status !== 'active') {
            return res.status(409).json({ ok: false, message: 'Tin đăng không còn khả dụng' })
        }
        if (String(preview.sellerId) === String(buyerId)) {
            return res.status(400).json({ ok: false, message: 'Bạn không thể mua tin đăng của chính mình' })
        }
        if (preview.reservedForUserId && String(preview.reservedForUserId) !== String(buyerId)) {
            return res.status(403).json({ ok: false, message: 'Tin đăng này đã dành cho người chơi khác' })
        }

        const claimedListing = await MarketListing.findOneAndUpdate(
            {
                _id: listingId,
                status: 'active',
                sellerId: { $ne: buyerId },
                ...(preview.reservedForUserId ? { reservedForUserId: buyerId } : {}),
            },
            {
                $set: {
                    status: 'sold',
                    buyerId,
                    soldAt: new Date(),
                },
            },
            { new: true }
        )

        if (!claimedListing) {
            return res.status(409).json({ ok: false, message: 'Tin đăng đã được mua' })
        }

        const restoreListing = async () => {
            await MarketListing.updateOne(
                { _id: claimedListing._id, status: 'sold', buyerId },
                {
                    $set: {
                        status: 'active',
                        buyerId: null,
                        soldAt: null,
                    },
                }
            )
        }

        const refundBuyer = async () => {
            await PlayerState.updateOne(
                { userId: buyerId },
                { $inc: { gold: claimedListing.price } }
            )
        }

        const restorePokemonToSeller = async () => {
            await UserPokemon.updateOne(
                withActiveUserPokemonFilter({
                    _id: claimedListing.userPokemonId,
                    userId: buyerId,
                }),
                {
                    $set: {
                        userId: claimedListing.sellerId,
                        location: 'box',
                        partyIndex: null,
                        boxNumber: 1,
                        status: 'active',
                        updatedAt: new Date(),
                    },
                }
            )
        }

        const buyerState = await PlayerState.findOneAndUpdate(
            { userId: buyerId, gold: { $gte: claimedListing.price } },
            { $inc: { gold: -claimedListing.price } },
            { new: true }
        )

        if (!buyerState) {
            await restoreListing()
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua Pokemon này' })
        }

        const transferResult = await UserPokemon.updateOne(
            withActiveUserPokemonFilter({
                _id: claimedListing.userPokemonId,
                userId: claimedListing.sellerId,
            }),
            {
                $set: {
                    userId: buyerId,
                    location: 'box',
                    partyIndex: null,
                    boxNumber: 1,
                    status: 'active',
                    updatedAt: new Date(),
                },
            }
        )

        if (!transferResult.modifiedCount) {
            await refundBuyer()
            await restoreListing()
            return res.status(409).json({ ok: false, message: 'Chuyển Pokemon thất bại. Tin đăng đã được khôi phục.' })
        }

        try {
            await PlayerState.findOneAndUpdate(
                { userId: claimedListing.sellerId },
                {
                    $setOnInsert: { userId: claimedListing.sellerId },
                    $inc: { gold: claimedListing.price },
                },
                { new: true, upsert: true }
            )
        } catch (creditError) {
            try {
                await restorePokemonToSeller()
                await refundBuyer()
                await restoreListing()
            } catch (rollbackError) {
                console.error('POST /api/shop/buy/:listingId rollback error:', rollbackError)
            }
            throw creditError
        }

        res.json({ ok: true, message: 'Mua Pokemon thành công!' })
    } catch (error) {
        if (error?.isRequestError) {
            return res.status(Number(error.status) || 400).json({ ok: false, message: error.message || 'Mua Pokemon thất bại' })
        }
        console.error('POST /api/shop/buy/:listingId error:', error)
        res.status(500).json({ ok: false, message: 'Hoàn tất mua thất bại' })
    }
})

// GET /api/shop/item-market/sell
router.get('/item-market/sell', async (req, res) => {
    try {
        const userId = req.user.userId
        const userIdObject = new mongoose.Types.ObjectId(userId)
        const activePage = toSafePage(req.query.activePage)
        const soldPage = toSafePage(req.query.soldPage)
        const limit = toSafeLimit(req.query.limit)
        const includeAvailable = String(req.query.includeAvailable || '1') !== '0'

        const availableItemsPromise = includeAvailable
            ? UserInventory.aggregate([
                { $match: { userId: userIdObject, quantity: { $gt: 0 } } },
                {
                    $lookup: {
                        from: 'items',
                        localField: 'itemId',
                        foreignField: '_id',
                        as: 'item',
                    },
                },
                { $unwind: '$item' },
                { $match: { 'item.isTradable': true } },
                { $sort: { updatedAt: -1, _id: -1 } },
                { $limit: 300 },
                {
                    $project: {
                        _id: 1,
                        itemId: 1,
                        quantity: 1,
                        item: {
                            name: '$item.name',
                            type: '$item.type',
                            rarity: '$item.rarity',
                            imageUrl: '$item.imageUrl',
                            effectType: '$item.effectType',
                            isTradable: '$item.isTradable',
                        },
                    },
                },
            ]).allowDiskUse(true)
            : Promise.resolve([])

        const [playerState, listingFacet, availableRows] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            ItemMarketListing.aggregate([
                { $match: { sellerId: userIdObject } },
                {
                    $facet: {
                        activeRows: [
                            { $match: { status: 'active' } },
                            { $sort: { listedAt: -1, _id: -1 } },
                            { $skip: (activePage - 1) * limit },
                            { $limit: limit },
                            { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
                            { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
                        ],
                        soldRows: [
                            { $match: { status: 'sold' } },
                            { $sort: { soldAt: -1, _id: -1 } },
                            { $skip: (soldPage - 1) * limit },
                            { $limit: limit },
                            { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
                            { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
                        ],
                        activeTotal: [{ $match: { status: 'active' } }, { $count: 'count' }],
                        soldTotal: [{ $match: { status: 'sold' } }, { $count: 'count' }],
                    },
                },
            ]).allowDiskUse(true),
            availableItemsPromise,
        ])

        const listingData = listingFacet?.[0] || {}
        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            availableItems: includeAvailable ? availableRows.map((entry) => ({
                inventoryEntryId: entry._id,
                itemId: entry.itemId,
                quantity: Math.max(0, Number(entry.quantity || 0)),
                itemName: entry?.item?.name || 'Vật phẩm',
                itemType: entry?.item?.type || 'misc',
                itemRarity: entry?.item?.rarity || 'common',
                itemImageUrl: entry?.item?.imageUrl || '',
                effectType: entry?.item?.effectType || 'none',
                effectCategory: buildItemEffectCategory(entry?.item),
            })) : null,
            activeListings: (listingData.activeRows || []).map(mapItemMarketListing),
            soldListings: (listingData.soldRows || []).map(mapItemMarketListing),
            pagination: {
                limit,
                active: {
                    page: activePage,
                    total: listingData.activeTotal?.[0]?.count || 0,
                    totalPages: Math.max(1, Math.ceil((listingData.activeTotal?.[0]?.count || 0) / limit)),
                },
                sold: {
                    page: soldPage,
                    total: listingData.soldTotal?.[0]?.count || 0,
                    totalPages: Math.max(1, Math.ceil((listingData.soldTotal?.[0]?.count || 0) / limit)),
                },
            },
        })
    } catch (error) {
        console.error('GET /api/shop/item-market/sell error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu chợ vật phẩm' })
    }
})

// POST /api/shop/item-market/sell/list
router.post('/item-market/sell/list', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const itemId = String(req.body?.itemId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)
        const price = toSafePrice(req.body?.price)

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const item = await Item.findOne({ _id: itemId, isTradable: true })
            .select('name type rarity imageUrl effectType isTradable')
            .lean()
        if (!item) {
            return res.status(404).json({ ok: false, message: 'Vật phẩm không tồn tại hoặc không cho phép giao dịch' })
        }

        const inventoryEntry = await UserInventory.findOneAndUpdate(
            { userId: sellerId, itemId, quantity: { $gte: quantity } },
            { $inc: { quantity: -quantity } },
            { new: true }
        )
        if (!inventoryEntry) {
            return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm để đăng bán' })
        }
        if (inventoryEntry.quantity <= 0) {
            await UserInventory.deleteOne({ _id: inventoryEntry._id, quantity: { $lte: 0 } })
        }

        const seller = await User.findById(sellerId).select('username').lean()
        await ItemMarketListing.create({
            sellerId,
            itemId,
            itemName: item.name || '',
            itemType: item.type || 'misc',
            itemRarity: item.rarity || 'common',
            itemImageUrl: item.imageUrl || '',
            effectType: item.effectType || 'none',
            quantity,
            price,
            otName: seller?.username || 'Không rõ',
            status: 'active',
            listedAt: new Date(),
        })

        res.status(201).json({ ok: true, message: 'Đăng bán vật phẩm thành công!' })
    } catch (error) {
        console.error('POST /api/shop/item-market/sell/list error:', error)
        res.status(500).json({ ok: false, message: 'Tạo tin đăng vật phẩm thất bại' })
    }
})

// POST /api/shop/item-market/sell/:listingId/cancel
router.post('/item-market/sell/:listingId/cancel', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const listing = await ItemMarketListing.findOneAndUpdate(
            { _id: listingId, sellerId, status: 'active' },
            { $set: { status: 'cancelled' } },
            { new: true }
        ).lean()
        if (!listing) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng vật phẩm đang hoạt động' })
        }

        await UserInventory.findOneAndUpdate(
            { userId: sellerId, itemId: listing.itemId },
            { $setOnInsert: { userId: sellerId, itemId: listing.itemId }, $inc: { quantity: Math.max(1, Number(listing.quantity || 1)) } },
            { upsert: true, new: true }
        )

        res.json({ ok: true, message: 'Đã hủy đăng bán vật phẩm' })
    } catch (error) {
        console.error('POST /api/shop/item-market/sell/:listingId/cancel error:', error)
        res.status(500).json({ ok: false, message: 'Hủy tin đăng vật phẩm thất bại' })
    }
})

// GET /api/shop/item-market/buy
router.get('/item-market/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const utility = String(req.query.utility || 'all').trim().toLowerCase()
        const itemType = String(req.query.itemType || 'all').trim().toLowerCase()
        const itemName = String(req.query.itemName || '').trim()
        const display = String(req.query.display || 'all').trim().toLowerCase()
        const direction = String(req.query.direction || 'desc').trim().toLowerCase() === 'asc' ? 1 : -1
        const orderBy = String(req.query.orderBy || 'date').trim().toLowerCase()
        const orderField = orderBy === 'price' ? 'price' : 'listedAt'

        const baseMatch = display === 'sold_by_you'
            ? { sellerId: new mongoose.Types.ObjectId(userId), status: 'sold' }
            : (display === 'bought_by_you'
                ? { buyerId: new mongoose.Types.ObjectId(userId), status: 'sold' }
                : { status: 'active' })

        const query = [...Object.keys(baseMatch).length ? [{ $match: baseMatch }] : []]
        if (utility !== 'all') query.push({ $match: { effectType: utility } })
        if (itemType !== 'all') query.push({ $match: { itemType } })
        if (itemName) query.push({ $match: { itemName: { $regex: escapeRegExp(itemName), $options: 'i' } } })
        query.push(
            { $lookup: { from: 'users', localField: 'sellerId', foreignField: '_id', as: 'seller' } },
            { $unwind: { path: '$seller', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'users', localField: 'buyerId', foreignField: '_id', as: 'buyer' } },
            { $unwind: { path: '$buyer', preserveNullAndEmptyArrays: true } },
            {
                $facet: {
                    rows: [
                        { $sort: { [orderField]: direction, _id: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ],
                    total: [{ $count: 'count' }],
                    options: [
                        {
                            $group: {
                                _id: null,
                                itemTypes: { $addToSet: '$itemType' },
                                utilities: { $addToSet: '$effectType' },
                            },
                        },
                    ],
                },
            }
        )

        const [marketRows, playerState] = await Promise.all([
            ItemMarketListing.aggregate(query).allowDiskUse(true),
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
        ])

        const result = marketRows?.[0] || {}
        res.json({
            ok: true,
            wallet: serializeWallet(playerState),
            listings: (result.rows || []).map(mapItemMarketListing),
            filters: {
                itemTypeOptions: ['all', ...new Set((result?.options?.[0]?.itemTypes || []).filter(Boolean).map((entry) => String(entry).trim().toLowerCase()))],
                utilityOptions: ['all', ...new Set((result?.options?.[0]?.utilities || []).filter(Boolean).map((entry) => String(entry).trim()))],
                displayOptions: ['all', 'sold_by_you', 'bought_by_you'],
            },
            pagination: {
                page,
                limit,
                total: result?.total?.[0]?.count || 0,
                totalPages: Math.max(1, Math.ceil((result?.total?.[0]?.count || 0) / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/item-market/buy error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải chợ vật phẩm' })
    }
})

// POST /api/shop/item-market/buy/:listingId
router.post('/item-market/buy/:listingId', async (req, res) => {
    try {
        const buyerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const preview = await ItemMarketListing.findById(listingId).select('status sellerId price itemId quantity').lean()
        if (!preview) return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng vật phẩm' })
        if (preview.status !== 'active') return res.status(409).json({ ok: false, message: 'Tin đăng không còn khả dụng' })
        if (String(preview.sellerId) === String(buyerId)) return res.status(400).json({ ok: false, message: 'Bạn không thể mua tin đăng của chính mình' })

        const claimed = await ItemMarketListing.findOneAndUpdate(
            { _id: listingId, status: 'active', sellerId: { $ne: buyerId } },
            { $set: { status: 'sold', buyerId, soldAt: new Date() } },
            { new: true }
        )
        if (!claimed) return res.status(409).json({ ok: false, message: 'Tin đăng đã được mua' })

        const buyerState = await PlayerState.findOneAndUpdate(
            { userId: buyerId, gold: { $gte: claimed.price } },
            { $inc: { gold: -claimed.price } },
            { new: true }
        )
        if (!buyerState) {
            await ItemMarketListing.updateOne({ _id: claimed._id, status: 'sold', buyerId }, { $set: { status: 'active', buyerId: null, soldAt: null } })
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua vật phẩm này' })
        }

        await PlayerState.findOneAndUpdate(
            { userId: claimed.sellerId },
            { $setOnInsert: { userId: claimed.sellerId }, $inc: { gold: claimed.price } },
            { new: true, upsert: true }
        )
        await UserInventory.findOneAndUpdate(
            { userId: buyerId, itemId: claimed.itemId },
            { $setOnInsert: { userId: buyerId, itemId: claimed.itemId }, $inc: { quantity: Math.max(1, Number(claimed.quantity || 1)) } },
            { upsert: true, new: true }
        )

        res.json({ ok: true, message: 'Mua vật phẩm thành công!' })
    } catch (error) {
        console.error('POST /api/shop/item-market/buy/:listingId error:', error)
        res.status(500).json({ ok: false, message: 'Hoàn tất mua vật phẩm thất bại' })
    }
})

export default router
