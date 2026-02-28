import express from 'express'
import ItemDropRate from '../../models/ItemDropRate.js'
import { invalidateMapDropRateCache } from '../../utils/dropRateCache.js'

const router = express.Router()

// POST /api/admin/item-drop-rates - Create or Update item drop rate (upsert)
router.post('/', async (req, res) => {
    try {
        const { mapId, itemId, weight } = req.body

        if (!mapId || !itemId || weight === undefined) {
            return res.status(400).json({ ok: false, message: 'Thiếu trường bắt buộc' })
        }

        if (weight < 0 || weight > 100000) {
            return res.status(400).json({ ok: false, message: 'Trọng số phải trong khoảng 0 đến 100000' })
        }

        const itemDropRate = await ItemDropRate.findOneAndUpdate(
            { mapId, itemId },
            { weight },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        )

        invalidateMapDropRateCache(mapId)

        res.json({ ok: true, itemDropRate })
    } catch (error) {
        console.error('POST /api/admin/item-drop-rates error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// GET /api/admin/item-drop-rates - Get item drop rates by mapId or itemId
router.get('/', async (req, res) => {
    try {
        const { mapId, itemId } = req.query

        const query = {}
        if (mapId) query.mapId = mapId
        if (itemId) query.itemId = itemId

        const itemDropRates = await ItemDropRate.find(query)
            .populate('mapId')
            .populate('itemId')
            .sort({ weight: -1 })
            .lean()

        res.json({ ok: true, itemDropRates })
    } catch (error) {
        console.error('GET /api/admin/item-drop-rates error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// DELETE /api/admin/item-drop-rates/:id - Delete item drop rate
router.delete('/:id', async (req, res) => {
    try {
        const itemDropRate = await ItemDropRate.findById(req.params.id)

        if (!itemDropRate) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tỉ lệ rơi vật phẩm' })
        }

        await itemDropRate.deleteOne()
        invalidateMapDropRateCache(itemDropRate.mapId)

        res.json({ ok: true, message: 'Đã xóa tỉ lệ rơi vật phẩm' })
    } catch (error) {
        console.error('DELETE /api/admin/item-drop-rates/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
