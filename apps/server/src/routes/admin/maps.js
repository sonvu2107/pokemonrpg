import express from 'express'
import Map from '../../models/Map.js'
import upload from '../../middleware/upload.js'
import { uploadMapImageToCloudinary, uploadSpecialPokemonImageToCloudinary } from '../../utils/cloudinary.js'

const router = express.Router()

// GET /api/admin/maps - List all Maps
router.get('/', async (req, res) => {
    try {
        const maps = await Map.find().sort({ createdAt: 1 }).lean()
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

// POST /api/admin/maps/upload-special-image - Upload single special Pokemon image
router.post('/upload-special-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'No image file provided' })
        }

        const { imageUrl, publicId } = await uploadSpecialPokemonImageToCloudinary({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
        })

        res.json({
            ok: true,
            imageUrl,
            publicId,
            message: 'Image uploaded successfully'
        })
    } catch (error) {
        console.error('POST /api/admin/maps/upload-special-image error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Upload failed' })
    }
})

// POST /api/admin/maps/upload-map-image - Upload map image
router.post('/upload-map-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'No image file provided' })
        }

        const { imageUrl, publicId } = await uploadMapImageToCloudinary({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
        })

        res.json({
            ok: true,
            imageUrl,
            publicId,
            message: 'Map image uploaded successfully'
        })
    } catch (error) {
        console.error('POST /api/admin/maps/upload-map-image error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Upload failed' })
    }
})

// POST /api/admin/maps - Create Map
router.post('/', async (req, res) => {
    try {
        const { name, description, mapImageUrl, levelMin, levelMax, isLegendary, iconId, specialPokemonImages, requiredSearches, orderIndex } = req.body

        if (!name || !levelMin || !levelMax) {
            return res.status(400).json({ ok: false, message: 'Missing required fields' })
        }

        if (levelMax < levelMin) {
            return res.status(400).json({ ok: false, message: 'levelMax must be >= levelMin' })
        }

        if (iconId && (iconId < 1 || iconId > 1000)) {
            return res.status(400).json({ ok: false, message: 'iconId must be between 1 and 1000' })
        }

        // Validate specialPokemonImages
        if (specialPokemonImages && (!Array.isArray(specialPokemonImages) || specialPokemonImages.length > 5)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonImages must be an array with max 5 items' })
        }

        // Validate requiredSearches
        if (requiredSearches !== undefined && (requiredSearches < 0 || requiredSearches > 10000)) {
            return res.status(400).json({ ok: false, message: 'requiredSearches must be between 0 and 10000' })
        }

        // Validate orderIndex  
        if (orderIndex !== undefined && orderIndex < 0) {
            return res.status(400).json({ ok: false, message: 'orderIndex must be >= 0' })
        }

        const map = new Map({
            name,
            description: description || '',
            mapImageUrl: mapImageUrl || '',
            levelMin,
            levelMax,
            isLegendary: isLegendary || false,
            iconId: iconId || undefined,
            specialPokemonImages: specialPokemonImages || [],
            requiredSearches: requiredSearches !== undefined ? requiredSearches : 0,
            orderIndex: orderIndex !== undefined ? orderIndex : 0,
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
        const { name, description, mapImageUrl, levelMin, levelMax, isLegendary, iconId, specialPokemonImages, requiredSearches, orderIndex } = req.body

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

        // Validate specialPokemonImages
        if (specialPokemonImages && (!Array.isArray(specialPokemonImages) || specialPokemonImages.length > 5)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonImages must be an array with max 5 items' })
        }

        // Validate requiredSearches
        if (requiredSearches !== undefined && (requiredSearches < 0 || requiredSearches > 10000)) {
            return res.status(400).json({ ok: false, message: 'requiredSearches must be between 0 and 10000' })
        }

        // Validate orderIndex
        if (orderIndex !== undefined && orderIndex < 0) {
            return res.status(400).json({ ok: false, message: 'orderIndex must be >= 0' })
        }

        map.name = name
        map.description = description || ''
        map.mapImageUrl = mapImageUrl !== undefined ? mapImageUrl : map.mapImageUrl
        map.levelMin = levelMin
        map.levelMax = levelMax
        map.isLegendary = isLegendary !== undefined ? isLegendary : map.isLegendary
        map.iconId = iconId !== undefined ? iconId : map.iconId
        map.specialPokemonImages = specialPokemonImages !== undefined ? specialPokemonImages : map.specialPokemonImages
        map.requiredSearches = requiredSearches !== undefined ? requiredSearches : map.requiredSearches
        map.orderIndex = orderIndex !== undefined ? orderIndex : map.orderIndex

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
