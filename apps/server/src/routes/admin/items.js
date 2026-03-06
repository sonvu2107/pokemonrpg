import express from 'express'
import mongoose from 'mongoose'
import Item, { ITEM_TYPES, ITEM_RARITIES } from '../../models/Item.js'
import ItemPurchaseLog from '../../models/ItemPurchaseLog.js'

const router = express.Router()

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toBoolean = (value, fallback = false) => {
    if (value === undefined) return fallback
    if (typeof value === 'boolean') return value
    const normalized = String(value).trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

// GET /api/admin/items - List items with search & pagination
router.get('/', async (req, res) => {
    try {
        const { search, type, rarity, page = 1, limit = 20 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))

        const query = {}

        if (search) {
            query.nameLower = { $regex: escapeRegExp(String(search).toLowerCase()), $options: 'i' }
        }

        if (type) {
            query.type = type
        }

        if (rarity) {
            query.rarity = rarity
        }

        const skip = (safePage - 1) * safeLimit

        const [items, total] = await Promise.all([
            Item.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            Item.countDocuments(query),
        ])

        res.json({
            ok: true,
            items,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.ceil(total / safeLimit),
            },
            meta: {
                types: ITEM_TYPES,
                rarities: ITEM_RARITIES,
            }
        })
    } catch (error) {
        console.error('GET /api/admin/items error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/items/purchase-history - Purchase audit logs
router.get('/purchase-history', async (req, res) => {
    try {
        const { search, itemId, page = 1, limit = 20 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
        const skip = (safePage - 1) * safeLimit

        const preMatch = {}
        if (itemId && mongoose.Types.ObjectId.isValid(String(itemId))) {
            preMatch.itemId = new mongoose.Types.ObjectId(String(itemId))
        }

        const escapedSearch = String(search || '').trim()
        const hasSearch = escapedSearch.length > 0

        const [result, shopItems] = await Promise.all([
            ItemPurchaseLog.aggregate([
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
                        from: 'items',
                        localField: 'itemId',
                        foreignField: '_id',
                        as: 'item',
                    },
                },
                {
                    $unwind: {
                        path: '$item',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                ...(hasSearch
                    ? [{
                        $match: {
                            $or: [
                                { itemName: { $regex: escapeRegExp(escapedSearch), $options: 'i' } },
                                { 'item.name': { $regex: escapeRegExp(escapedSearch), $options: 'i' } },
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
                                    item: {
                                        _id: '$item._id',
                                        name: { $ifNull: ['$item.name', '$itemName'] },
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
            Item.find({ isShopEnabled: true })
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
                shopItems,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/items/purchase-history error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/items/:id - Get single item
router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id)

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        res.json({ ok: true, item })
    } catch (error) {
        console.error('GET /api/admin/items/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/items - Create item
router.post('/', async (req, res) => {
    try {
        const { name, type, rarity, imageUrl, description, shopPrice, isShopEnabled, effectType, effectValue, effectValueMp } = req.body

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Thiếu trường bắt buộc' })
        }

        if (type && !ITEM_TYPES.includes(type)) {
            return res.status(400).json({ ok: false, message: 'Loại vật phẩm không hợp lệ' })
        }

        if (rarity && !ITEM_RARITIES.includes(rarity)) {
            return res.status(400).json({ ok: false, message: 'Độ hiếm vật phẩm không hợp lệ' })
        }

        if (shopPrice !== undefined && (!Number.isFinite(Number(shopPrice)) || Number(shopPrice) < 0)) {
            return res.status(400).json({ ok: false, message: 'Giá cửa hàng không hợp lệ' })
        }

        if (effectValue !== undefined && !Number.isFinite(Number(effectValue))) {
            return res.status(400).json({ ok: false, message: 'Giá trị hiệu ứng không hợp lệ' })
        }

        if (effectValueMp !== undefined && !Number.isFinite(Number(effectValueMp))) {
            return res.status(400).json({ ok: false, message: 'Giá trị PP không hợp lệ' })
        }

        const resolvedEffectType = effectType || 'none'
        if (resolvedEffectType === 'catchMultiplier') {
            const catchChancePercent = Number.isFinite(Number(effectValue)) ? Number(effectValue) : 0
            if (catchChancePercent < 0 || catchChancePercent > 100) {
                return res.status(400).json({ ok: false, message: 'Tỉ lệ bắt phải nằm trong khoảng 0-100%' })
            }
        }

        const existing = await Item.findOne({ name })

        if (existing) {
            return res.status(409).json({ ok: false, message: 'Tên vật phẩm đã tồn tại' })
        }

        const item = new Item({
            name,
            type: type || 'misc',
            rarity: rarity || 'common',
            imageUrl: imageUrl || '',
            description: description || '',
            shopPrice: Number.isFinite(Number(shopPrice)) ? Number(shopPrice) : 0,
            isShopEnabled: toBoolean(isShopEnabled, false),
            effectType: resolvedEffectType,
            effectValue: resolvedEffectType === 'catchMultiplier'
                ? Math.min(100, Math.max(0, Number(effectValue) || 0))
                : (effectValue !== undefined ? Number(effectValue) : 0),
            effectValueMp: effectValueMp !== undefined ? Number(effectValueMp) : 0,
        })

        await item.save()

        res.status(201).json({ ok: true, item })
    } catch (error) {
        console.error('POST /api/admin/items error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/items/:id - Update item
router.put('/:id', async (req, res) => {
    try {
        const { name, type, rarity, imageUrl, description, shopPrice, isShopEnabled, effectType, effectValue, effectValueMp } = req.body

        const item = await Item.findById(req.params.id)

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        if (type && !ITEM_TYPES.includes(type)) {
            return res.status(400).json({ ok: false, message: 'Loại vật phẩm không hợp lệ' })
        }

        if (rarity && !ITEM_RARITIES.includes(rarity)) {
            return res.status(400).json({ ok: false, message: 'Độ hiếm vật phẩm không hợp lệ' })
        }

        if (shopPrice !== undefined && (!Number.isFinite(Number(shopPrice)) || Number(shopPrice) < 0)) {
            return res.status(400).json({ ok: false, message: 'Giá cửa hàng không hợp lệ' })
        }

        if (effectValue !== undefined && !Number.isFinite(Number(effectValue))) {
            return res.status(400).json({ ok: false, message: 'Giá trị hiệu ứng không hợp lệ' })
        }

        if (effectValueMp !== undefined && !Number.isFinite(Number(effectValueMp))) {
            return res.status(400).json({ ok: false, message: 'Giá trị PP không hợp lệ' })
        }

        const nextEffectType = effectType !== undefined ? effectType : item.effectType
        if (nextEffectType === 'catchMultiplier' && effectValue !== undefined) {
            const catchChancePercent = Number(effectValue)
            if (catchChancePercent < 0 || catchChancePercent > 100) {
                return res.status(400).json({ ok: false, message: 'Tỉ lệ bắt phải nằm trong khoảng 0-100%' })
            }
        }

        if (name && name !== item.name) {
            const conflict = await Item.findOne({ _id: { $ne: item._id }, name })
            if (conflict) {
                return res.status(409).json({ ok: false, message: 'Tên vật phẩm đã tồn tại' })
            }
        }

        if (name !== undefined) item.name = name
        if (type !== undefined) item.type = type
        if (rarity !== undefined) item.rarity = rarity
        if (imageUrl !== undefined) item.imageUrl = imageUrl
        if (description !== undefined) item.description = description
        if (shopPrice !== undefined) item.shopPrice = Number(shopPrice)
        if (isShopEnabled !== undefined) item.isShopEnabled = toBoolean(isShopEnabled, item.isShopEnabled)
        if (effectType !== undefined) item.effectType = effectType
        if (effectValue !== undefined) {
            item.effectValue = nextEffectType === 'catchMultiplier'
                ? Math.min(100, Math.max(0, Number(effectValue) || 0))
                : Number(effectValue)
        } else if (nextEffectType === 'catchMultiplier') {
            item.effectValue = Math.min(100, Math.max(0, Number(item.effectValue) || 0))
        }
        if (effectValueMp !== undefined) item.effectValueMp = Number(effectValueMp)

        await item.save()

        res.json({ ok: true, item })
    } catch (error) {
        console.error('PUT /api/admin/items/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/items/:id - Delete item (cascade delete ItemDropRate)
router.delete('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id)

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        const ItemDropRate = (await import('../../models/ItemDropRate.js')).default
        await ItemDropRate.deleteMany({ itemId: item._id })

        await item.deleteOne()

        res.json({ ok: true, message: 'Đã xóa vật phẩm' })
    } catch (error) {
        console.error('DELETE /api/admin/items/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
