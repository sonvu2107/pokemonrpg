import express from 'express'
import Item, { ITEM_TYPES, ITEM_RARITIES } from '../../models/Item.js'

const router = express.Router()

// GET /api/admin/items - List items with search & pagination
router.get('/', async (req, res) => {
    try {
        const { search, type, rarity, page = 1, limit = 20 } = req.query

        const query = {}

        if (search) {
            query.nameLower = { $regex: search.toLowerCase(), $options: 'i' }
        }

        if (type) {
            query.type = type
        }

        if (rarity) {
            query.rarity = rarity
        }

        const skip = (parseInt(page) - 1) * parseInt(limit)

        const [items, total] = await Promise.all([
            Item.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Item.countDocuments(query),
        ])

        res.json({
            ok: true,
            items,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
            meta: {
                types: ITEM_TYPES,
                rarities: ITEM_RARITIES,
            }
        })
    } catch (error) {
        console.error('GET /api/admin/items error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/admin/items/:id - Get single item
router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id)

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Item not found' })
        }

        res.json({ ok: true, item })
    } catch (error) {
        console.error('GET /api/admin/items/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/admin/items - Create item
router.post('/', async (req, res) => {
    try {
        const { name, type, rarity, imageUrl, description } = req.body

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Missing required fields' })
        }

        if (type && !ITEM_TYPES.includes(type)) {
            return res.status(400).json({ ok: false, message: 'Invalid item type' })
        }

        if (rarity && !ITEM_RARITIES.includes(rarity)) {
            return res.status(400).json({ ok: false, message: 'Invalid item rarity' })
        }

        const existing = await Item.findOne({ name })

        if (existing) {
            return res.status(409).json({ ok: false, message: 'Item name already exists' })
        }

        const item = new Item({
            name,
            type: type || 'misc',
            rarity: rarity || 'common',
            imageUrl: imageUrl || '',
            description: description || '',
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
        const { name, type, rarity, imageUrl, description } = req.body

        const item = await Item.findById(req.params.id)

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Item not found' })
        }

        if (type && !ITEM_TYPES.includes(type)) {
            return res.status(400).json({ ok: false, message: 'Invalid item type' })
        }

        if (rarity && !ITEM_RARITIES.includes(rarity)) {
            return res.status(400).json({ ok: false, message: 'Invalid item rarity' })
        }

        if (name && name !== item.name) {
            const conflict = await Item.findOne({ _id: { $ne: item._id }, name })
            if (conflict) {
                return res.status(409).json({ ok: false, message: 'Item name already exists' })
            }
        }

        if (name !== undefined) item.name = name
        if (type !== undefined) item.type = type
        if (rarity !== undefined) item.rarity = rarity
        if (imageUrl !== undefined) item.imageUrl = imageUrl
        if (description !== undefined) item.description = description

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
            return res.status(404).json({ ok: false, message: 'Item not found' })
        }

        const ItemDropRate = (await import('../../models/ItemDropRate.js')).default
        await ItemDropRate.deleteMany({ itemId: item._id })

        await item.deleteOne()

        res.json({ ok: true, message: 'Item deleted' })
    } catch (error) {
        console.error('DELETE /api/admin/items/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
