import express from 'express'
import Map from '../../models/Map.js'

const router = express.Router()

// GET /api/admin/maps - List all Maps
router.get('/', async (req, res) => {
    try {
        const maps = await Map.find().sort({ name: 1 }).lean()
        res.json({ ok: true, maps })
    } catch (error) {
        console.error('GET /api/admin/maps error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/admin/maps/:id - Get single Map
router.get('/:id', async (req, res) => {
    try {
        const map = await Map.findById(req.params.id)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        res.json({ ok: true, map })
    } catch (error) {
        console.error('GET /api/admin/maps/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/admin/maps - Create Map
router.post('/', async (req, res) => {
    try {
        const { name, description, levelMin, levelMax, isLegendary, iconId } = req.body

        if (!name || !levelMin || !levelMax) {
            return res.status(400).json({ ok: false, message: 'Missing required fields' })
        }

        if (levelMax < levelMin) {
            return res.status(400).json({ ok: false, message: 'levelMax must be >= levelMin' })
        }

        if (iconId && (iconId < 1 || iconId > 1000)) {
            return res.status(400).json({ ok: false, message: 'iconId must be between 1 and 1000' })
        }

        const map = new Map({
            name,
            description: description || '',
            levelMin,
            levelMax,
            isLegendary: isLegendary || false,
            iconId: iconId || undefined,
        })

        await map.save()

        res.status(201).json({ ok: true, map })
    } catch (error) {
        console.error('POST /api/admin/maps error:', error)

        if (error.code === 11000) {
            return res.status(409).json({ ok: false, message: 'Map slug already exists' })
        }

        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/maps/:id - Update Map
router.put('/:id', async (req, res) => {
    try {
        const { name, description, levelMin, levelMax, isLegendary, iconId } = req.body

        const map = await Map.findById(req.params.id)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        if (levelMax < levelMin) {
            return res.status(400).json({ ok: false, message: 'levelMax must be >= levelMin' })
        }

        if (iconId && (iconId < 1 || iconId > 1000)) {
            return res.status(400).json({ ok: false, message: 'iconId must be between 1 and 1000' })
        }

        map.name = name
        map.description = description || ''
        map.levelMin = levelMin
        map.levelMax = levelMax
        map.isLegendary = isLegendary !== undefined ? isLegendary : map.isLegendary
        map.iconId = iconId !== undefined ? iconId : map.iconId

        await map.save()

        res.json({ ok: true, map })
    } catch (error) {
        console.error('PUT /api/admin/maps/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/maps/:id - Delete Map (cascade delete DropRates via middleware)
router.delete('/:id', async (req, res) => {
    try {
        const map = await Map.findById(req.params.id)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        // Cascade delete handled by Map model middleware
        await map.deleteOne()

        res.json({ ok: true, message: 'Map deleted' })
    } catch (error) {
        console.error('DELETE /api/admin/maps/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/admin/maps/:mapId/drop-rates - Get all Pokemon + drop rates for a map (populated)
router.get('/:mapId/drop-rates', async (req, res) => {
    try {
        const map = await Map.findById(req.params.mapId)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        const DropRate = (await import('../../models/DropRate.js')).default
        const dropRates = await DropRate.find({ mapId: map._id })
            .populate('pokemonId')
            .sort({ weight: -1 })
            .lean()

        // Calculate total weight and relative percentages
        const totalWeight = dropRates.reduce((sum, dr) => sum + dr.weight, 0)

        const enrichedDropRates = dropRates.map(dr => ({
            _id: dr._id,
            pokemon: dr.pokemonId,
            weight: dr.weight,
            relativePercent: totalWeight > 0 ? ((dr.weight / totalWeight) * 100).toFixed(2) : 0,
        }))

        res.json({
            ok: true,
            map,
            dropRates: enrichedDropRates,
            totalWeight,
        })
    } catch (error) {
        console.error('GET /api/admin/maps/:mapId/drop-rates error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
