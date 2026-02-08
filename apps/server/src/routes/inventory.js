import express from 'express'
import UserInventory from '../models/UserInventory.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

// All routes require authentication
router.use(authMiddleware)

// GET /api/inventory - List user's items
router.get('/', async (req, res) => {
    try {
        const items = await UserInventory.find({ userId: req.user.userId })
            .populate('itemId')
            .lean()

        const inventory = items.map((entry) => ({
            _id: entry._id,
            item: entry.itemId,
            quantity: entry.quantity,
        }))

        res.json({ ok: true, inventory })
    } catch (error) {
        console.error('GET /api/inventory error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/inventory/use - Use an item (placeholder effect)
router.post('/use', async (req, res) => {
    try {
        const { itemId, quantity = 1 } = req.body
        const qty = Number(quantity)

        if (!itemId || !Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ ok: false, message: 'Invalid item or quantity' })
        }

        const entry = await UserInventory.findOne({ userId: req.user.userId, itemId })

        if (!entry || entry.quantity < qty) {
            return res.status(400).json({ ok: false, message: 'Not enough items' })
        }

        entry.quantity -= qty
        if (entry.quantity <= 0) {
            await entry.deleteOne()
        } else {
            await entry.save()
        }

        res.json({ ok: true, message: 'Item used', itemId, quantity: qty })
    } catch (error) {
        console.error('POST /api/inventory/use error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
