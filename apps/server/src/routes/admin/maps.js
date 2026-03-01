import express from 'express'
import Map from '../../models/Map.js'
import Pokemon from '../../models/Pokemon.js'
import Item from '../../models/Item.js'
import upload from '../../middleware/upload.js'
import { uploadMapImageToCloudinary, uploadSpecialPokemonImageToCloudinary } from '../../utils/cloudinary.js'
import { invalidateOrderedMapsCache } from '../../utils/orderedMapsCache.js'
import { invalidateMapDropRateCache } from '../../utils/dropRateCache.js'

const router = express.Router()

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

const resolveFormForDrop = (pokemon, formId) => {
    if (!pokemon) return { formId: 'normal', form: null }
    const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
    const defaultFormId = pokemon.defaultFormId || 'normal'
    let resolvedFormId = formId || defaultFormId
    let form = forms.find((entry) => entry.formId === resolvedFormId) || null

    if (!form && forms.length > 0) {
        resolvedFormId = defaultFormId || forms[0].formId
        form = forms.find((entry) => entry.formId === resolvedFormId) || forms[0]
    }

    return { formId: resolvedFormId, form }
}

const normalizeSpecialPokemonIds = (value) => {
    if (!Array.isArray(value)) return []
    return [...new Set(
        value
            .map((entry) => {
                if (!entry) return ''
                if (typeof entry === 'string') return entry
                return entry._id || entry.pokemonId?._id || entry.pokemonId || ''
            })
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )]
}

const toSafeWeight = (value) => {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed
}

const normalizeSpecialPokemonConfigs = (value) => {
    if (!Array.isArray(value)) return []

    const normalized = []
    const seen = new Set()

    for (const entry of value) {
        const pokemonIdRaw = typeof entry === 'string'
            ? entry
            : (entry?.pokemonId?._id || entry?.pokemonId)
        const pokemonId = String(pokemonIdRaw || '').trim()
        const formIdRaw = typeof entry === 'object' && entry !== null ? entry.formId : 'normal'
        const formId = normalizeFormId(formIdRaw)
        const uniqueKey = `${pokemonId}:${formId}`

        if (!pokemonId || seen.has(uniqueKey)) continue

        const weightRaw = typeof entry === 'object' && entry !== null ? entry.weight : 1
        const weight = toSafeWeight(weightRaw) || 1

        normalized.push({ pokemonId, formId, weight })
        seen.add(uniqueKey)

        if (normalized.length >= 5) break
    }

    return normalized
}

const validateSpecialPokemonConfigs = async (configs) => {
    if (configs.length > 5) {
        return 'specialPokemonConfigs phải là mảng tối đa 5 phần tử'
    }

    if (!configs.length) return null

    const hasInvalidWeight = configs.some((entry) => !Number.isFinite(entry?.weight) || Number(entry.weight) <= 0)
    if (hasInvalidWeight) {
        return 'specialPokemonConfigs.weight phải lớn hơn 0'
    }

    const pokemonIds = [...new Set(configs.map((entry) => String(entry?.pokemonId || '').trim()).filter(Boolean))]
    const pokemonRows = await Pokemon.find({ _id: { $in: pokemonIds } })
        .select('_id forms defaultFormId')
        .lean()

    if (pokemonRows.length !== pokemonIds.length) {
        return 'specialPokemonConfigs chứa Pokemon id không hợp lệ'
    }

    const pokemonById = new globalThis.Map(pokemonRows.map((entry) => [String(entry._id), entry]))
    for (const config of configs) {
        const pokemonId = String(config?.pokemonId || '').trim()
        const formId = normalizeFormId(config?.formId)
        const pokemon = pokemonById.get(pokemonId)
        if (!pokemon) {
            return 'specialPokemonConfigs chứa Pokemon id không hợp lệ'
        }

        const defaultFormId = normalizeFormId(pokemon.defaultFormId)
        const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
        if (forms.length > 0) {
            const validFormIds = new Set(forms.map((entry) => normalizeFormId(entry?.formId)).filter(Boolean))
            validFormIds.add(defaultFormId)
            if (!validFormIds.has(formId)) {
                return `specialPokemonConfigs chứa formId không hợp lệ cho Pokemon ${pokemonId}`
            }
        }
    }

    return null
}

// GET /api/admin/maps - List all Maps
router.get('/', async (req, res) => {
    try {
        const maps = await Map.find()
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .sort({ createdAt: 1 })
            .lean()
        res.json({ ok: true, maps })
    } catch (error) {
        console.error('GET /api/admin/maps error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/maps/lookup/items - Lightweight item list for map drop-rate config
router.get('/lookup/items', async (req, res) => {
    try {
        const items = await Item.find({})
            .select('name type rarity imageUrl')
            .sort({ name: 1 })
            .lean()

        res.json({ ok: true, items })
    } catch (error) {
        console.error('GET /api/admin/maps/lookup/items error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/maps/:id - Get single Map
router.get('/:id', async (req, res) => {
    try {
        const map = await Map.findById(req.params.id)
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        res.json({ ok: true, map })
    } catch (error) {
        console.error('GET /api/admin/maps/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/maps/upload-special-image - Upload single special Pokemon image
router.post('/upload-special-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'Chưa có tệp ảnh được tải lên' })
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
            message: 'Tải ảnh lên thành công'
        })
    } catch (error) {
        console.error('POST /api/admin/maps/upload-special-image error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Tải ảnh lên thất bại' })
    }
})

// POST /api/admin/maps/upload-map-image - Upload map image
router.post('/upload-map-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'Chưa có tệp ảnh được tải lên' })
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
            message: 'Tải ảnh bản đồ lên thành công'
        })
    } catch (error) {
        console.error('POST /api/admin/maps/upload-map-image error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Tải ảnh lên thất bại' })
    }
})

// POST /api/admin/maps - Create Map
router.post('/', async (req, res) => {
    try {
        const {
            name,
            description,
            mapImageUrl,
            levelMin,
            levelMax,
            isLegendary,
            iconId,
            specialPokemonImages,
            specialPokemonIds,
            specialPokemonConfigs,
            specialPokemonEncounterRate,
            requiredSearches,
            requiredPlayerLevel,
            encounterRate,
            itemDropRate,
            orderIndex,
        } = req.body

        if (!name || !levelMin || !levelMax) {
            return res.status(400).json({ ok: false, message: 'Thiếu trường bắt buộc' })
        }

        if (levelMax < levelMin) {
            return res.status(400).json({ ok: false, message: 'levelMax phải >= levelMin' })
        }

        if (iconId && (iconId < 1 || iconId > 1000)) {
            return res.status(400).json({ ok: false, message: 'iconId phải trong khoảng 1 đến 1000' })
        }

        // Validate specialPokemonImages
        if (specialPokemonImages && (!Array.isArray(specialPokemonImages) || specialPokemonImages.length > 5)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonImages phải là mảng tối đa 5 phần tử' })
        }

        const normalizedSpecialPokemonIds = normalizeSpecialPokemonIds(specialPokemonIds)
        const hasSpecialPokemonConfigs = specialPokemonConfigs !== undefined
        const normalizedSpecialPokemonConfigs = hasSpecialPokemonConfigs
            ? normalizeSpecialPokemonConfigs(specialPokemonConfigs)
            : normalizedSpecialPokemonIds.map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))

        const specialPokemonConfigValidationError = await validateSpecialPokemonConfigs(normalizedSpecialPokemonConfigs)
        if (specialPokemonConfigValidationError) {
            return res.status(400).json({ ok: false, message: specialPokemonConfigValidationError })
        }

        const normalizedSpecialPokemonIdsFromConfigs = [...new Set(normalizedSpecialPokemonConfigs.map((entry) => entry.pokemonId))]

        if (specialPokemonEncounterRate !== undefined && (specialPokemonEncounterRate < 0 || specialPokemonEncounterRate > 1)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonEncounterRate phải trong khoảng 0 đến 1' })
        }

        // Validate requiredSearches
        if (requiredSearches !== undefined && requiredSearches < 0) {
            return res.status(400).json({ ok: false, message: 'requiredSearches phải >= 0' })
        }

        if (requiredPlayerLevel !== undefined && Number(requiredPlayerLevel) < 1) {
            return res.status(400).json({ ok: false, message: 'requiredPlayerLevel phải >= 1' })
        }

        // Validate encounterRate
        if (encounterRate !== undefined && (encounterRate < 0 || encounterRate > 1)) {
            return res.status(400).json({ ok: false, message: 'encounterRate phải trong khoảng 0 đến 1' })
        }

        // Validate itemDropRate
        if (itemDropRate !== undefined && (itemDropRate < 0 || itemDropRate > 1)) {
            return res.status(400).json({ ok: false, message: 'itemDropRate phải trong khoảng 0 đến 1' })
        }

        // Validate orderIndex  
        if (orderIndex !== undefined && orderIndex < 0) {
            return res.status(400).json({ ok: false, message: 'orderIndex phải >= 0' })
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
            specialPokemonIds: normalizedSpecialPokemonIdsFromConfigs,
            specialPokemonConfigs: normalizedSpecialPokemonConfigs,
            specialPokemonEncounterRate: specialPokemonEncounterRate !== undefined ? specialPokemonEncounterRate : 0,
            requiredSearches: requiredSearches !== undefined ? requiredSearches : 0,
            requiredPlayerLevel: requiredPlayerLevel !== undefined ? Math.max(1, Number(requiredPlayerLevel) || 1) : 1,
            encounterRate: encounterRate !== undefined ? encounterRate : 1,
            itemDropRate: itemDropRate !== undefined ? itemDropRate : 0,
            orderIndex: orderIndex !== undefined ? orderIndex : 0,
        })

        await map.save()
        invalidateOrderedMapsCache()
        invalidateMapDropRateCache()

        res.status(201).json({ ok: true, map })
    } catch (error) {
        console.error('POST /api/admin/maps error:', error)

        if (error.code === 11000) {
            return res.status(409).json({ ok: false, message: 'Slug bản đồ đã tồn tại' })
        }

        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/maps/:id - Update Map
router.put('/:id', async (req, res) => {
    try {
        const {
            name,
            description,
            mapImageUrl,
            levelMin,
            levelMax,
            isLegendary,
            iconId,
            specialPokemonImages,
            specialPokemonIds,
            specialPokemonConfigs,
            specialPokemonEncounterRate,
            requiredSearches,
            requiredPlayerLevel,
            encounterRate,
            itemDropRate,
            orderIndex,
        } = req.body

        const map = await Map.findById(req.params.id)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        if (levelMax < levelMin) {
            return res.status(400).json({ ok: false, message: 'levelMax phải >= levelMin' })
        }

        if (iconId && (iconId < 1 || iconId > 1000)) {
            return res.status(400).json({ ok: false, message: 'iconId phải trong khoảng 1 đến 1000' })
        }

        // Validate specialPokemonImages
        if (specialPokemonImages && (!Array.isArray(specialPokemonImages) || specialPokemonImages.length > 5)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonImages phải là mảng tối đa 5 phần tử' })
        }

        const normalizedSpecialPokemonIds = normalizeSpecialPokemonIds(specialPokemonIds)
        const hasSpecialPokemonConfigs = specialPokemonConfigs !== undefined
        const shouldUpdateSpecialPokemonPool = hasSpecialPokemonConfigs || specialPokemonIds !== undefined
        const normalizedSpecialPokemonConfigs = hasSpecialPokemonConfigs
            ? normalizeSpecialPokemonConfigs(specialPokemonConfigs)
            : normalizedSpecialPokemonIds.map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))

        if (shouldUpdateSpecialPokemonPool) {
            const specialPokemonConfigValidationError = await validateSpecialPokemonConfigs(normalizedSpecialPokemonConfigs)
            if (specialPokemonConfigValidationError) {
                return res.status(400).json({ ok: false, message: specialPokemonConfigValidationError })
            }
        }

        if (specialPokemonEncounterRate !== undefined && (specialPokemonEncounterRate < 0 || specialPokemonEncounterRate > 1)) {
            return res.status(400).json({ ok: false, message: 'specialPokemonEncounterRate phải trong khoảng 0 đến 1' })
        }

        // Validate requiredSearches
        if (requiredSearches !== undefined && requiredSearches < 0) {
            return res.status(400).json({ ok: false, message: 'requiredSearches phải >= 0' })
        }

        if (requiredPlayerLevel !== undefined && Number(requiredPlayerLevel) < 1) {
            return res.status(400).json({ ok: false, message: 'requiredPlayerLevel phải >= 1' })
        }

        // Validate encounterRate
        if (encounterRate !== undefined && (encounterRate < 0 || encounterRate > 1)) {
            return res.status(400).json({ ok: false, message: 'encounterRate phải trong khoảng 0 đến 1' })
        }

        // Validate itemDropRate
        if (itemDropRate !== undefined && (itemDropRate < 0 || itemDropRate > 1)) {
            return res.status(400).json({ ok: false, message: 'itemDropRate phải trong khoảng 0 đến 1' })
        }

        // Validate orderIndex
        if (orderIndex !== undefined && orderIndex < 0) {
            return res.status(400).json({ ok: false, message: 'orderIndex phải >= 0' })
        }

        map.name = name
        map.description = description || ''
        map.mapImageUrl = mapImageUrl !== undefined ? mapImageUrl : map.mapImageUrl
        map.levelMin = levelMin
        map.levelMax = levelMax
        map.isLegendary = isLegendary !== undefined ? isLegendary : map.isLegendary
        map.iconId = iconId !== undefined ? iconId : map.iconId
        map.specialPokemonImages = specialPokemonImages !== undefined ? specialPokemonImages : map.specialPokemonImages
        map.specialPokemonIds = shouldUpdateSpecialPokemonPool
            ? [...new Set(normalizedSpecialPokemonConfigs.map((entry) => entry.pokemonId))]
            : map.specialPokemonIds
        map.specialPokemonConfigs = shouldUpdateSpecialPokemonPool
            ? normalizedSpecialPokemonConfigs
            : map.specialPokemonConfigs
        map.specialPokemonEncounterRate = specialPokemonEncounterRate !== undefined ? specialPokemonEncounterRate : map.specialPokemonEncounterRate
        map.requiredSearches = requiredSearches !== undefined ? requiredSearches : map.requiredSearches
        map.requiredPlayerLevel = requiredPlayerLevel !== undefined
            ? Math.max(1, Number(requiredPlayerLevel) || 1)
            : map.requiredPlayerLevel
        map.encounterRate = encounterRate !== undefined ? encounterRate : map.encounterRate
        map.itemDropRate = itemDropRate !== undefined ? itemDropRate : map.itemDropRate
        map.orderIndex = orderIndex !== undefined ? orderIndex : map.orderIndex

        await map.save()
        invalidateOrderedMapsCache()
        invalidateMapDropRateCache(map._id)

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
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        // Cascade delete handled by Map model middleware
        await map.deleteOne()
        invalidateOrderedMapsCache()
        invalidateMapDropRateCache(map._id)

        res.json({ ok: true, message: 'Đã xóa bản đồ' })
    } catch (error) {
        console.error('DELETE /api/admin/maps/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/maps/:mapId/drop-rates - Get all Pokemon + drop rates for a map (populated)
router.get('/:mapId/drop-rates', async (req, res) => {
    try {
        const map = await Map.findById(req.params.mapId)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const DropRate = (await import('../../models/DropRate.js')).default
        const dropRates = await DropRate.find({ mapId: map._id })
            .populate('pokemonId')
            .sort({ weight: -1 })
            .lean()

        // Calculate total weight and relative percentages
        const totalWeight = dropRates.reduce((sum, dr) => sum + dr.weight, 0)

        const enrichedDropRates = dropRates.map(dr => {
            const { formId, form } = resolveFormForDrop(dr.pokemonId, dr.formId)
            const resolvedSprites = form?.sprites || dr.pokemonId?.sprites || {}
            const resolvedImageUrl = form?.imageUrl || dr.pokemonId?.imageUrl || ''
            return {
            _id: dr._id,
            pokemon: dr.pokemonId,
            formId,
            form,
            resolvedSprites,
            resolvedImageUrl,
            weight: dr.weight,
            relativePercent: totalWeight > 0 ? ((dr.weight / totalWeight) * 100).toFixed(2) : 0,
            }
        })

        res.json({
            ok: true,
            map,
            dropRates: enrichedDropRates,
            totalWeight,
        })
    } catch (error) {
        console.error('GET /api/admin/maps/:mapId/drop-rates error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/maps/:mapId/item-drop-rates - Get all Items + drop rates for a map (populated)
router.get('/:mapId/item-drop-rates', async (req, res) => {
    try {
        const map = await Map.findById(req.params.mapId)

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const ItemDropRate = (await import('../../models/ItemDropRate.js')).default
        const itemDropRates = await ItemDropRate.find({ mapId: map._id })
            .populate('itemId')
            .sort({ weight: -1 })
            .lean()

        const totalWeight = itemDropRates.reduce((sum, dr) => sum + dr.weight, 0)

        const enrichedItemDropRates = itemDropRates.map(dr => ({
            _id: dr._id,
            item: dr.itemId,
            weight: dr.weight,
            relativePercent: totalWeight > 0 ? ((dr.weight / totalWeight) * 100).toFixed(2) : 0,
        }))

        res.json({
            ok: true,
            map,
            itemDropRates: enrichedItemDropRates,
            totalWeight,
        })
    } catch (error) {
        console.error('GET /api/admin/maps/:mapId/item-drop-rates error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
