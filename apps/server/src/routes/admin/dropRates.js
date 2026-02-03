import express from 'express'
import DropRate from '../../models/DropRate.js'

const router = express.Router()

// POST /api/admin/drop-rates - Create or Update drop rate (upsert)
router.post('/', async (req, res) => {
    try {
        const { mapId, pokemonId, weight } = req.body

        if (!mapId || !pokemonId || weight === undefined) {
            return res.status(400).json({ ok: false, message: 'Missing required fields' })
        }

        if (weight < 0 || weight > 100000) {
            return res.status(400).json({ ok: false, message: 'Weight must be between 0 and 100000' })
        }

        // Upsert: update if exists, create if not
        const dropRate = await DropRate.findOneAndUpdate(
            { mapId, pokemonId },
            { weight },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        )

        res.json({ ok: true, dropRate })
    } catch (error) {
        console.error('POST /api/admin/drop-rates error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// GET /api/admin/drop-rates - Get drop rates by mapId or pokemonId
router.get('/', async (req, res) => {
    try {
        const { mapId, pokemonId } = req.query

        const query = {}
        if (mapId) query.mapId = mapId
        if (pokemonId) query.pokemonId = pokemonId

        const dropRates = await DropRate.find(query)
            .populate('mapId')
            .populate('pokemonId')
            .sort({ weight: -1 })
            .lean()

        res.json({ ok: true, dropRates })
    } catch (error) {
        console.error('GET /api/admin/drop-rates error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// DELETE /api/admin/drop-rates/:id - Delete drop rate
router.delete('/:id', async (req, res) => {
    try {
        const dropRate = await DropRate.findById(req.params.id)

        if (!dropRate) {
            return res.status(404).json({ ok: false, message: 'Drop rate not found' })
        }

        await dropRate.deleteOne()

        res.json({ ok: true, message: 'Drop rate deleted' })
    } catch (error) {
        console.error('DELETE /api/admin/drop-rates/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
