import express from 'express'
import DropRate from '../../models/DropRate.js'
import Pokemon from '../../models/Pokemon.js'

const router = express.Router()

// POST /api/admin/drop-rates - Create or Update drop rate (upsert)
router.post('/', async (req, res) => {
    try {
        const { mapId, pokemonId, formId, weight } = req.body
        const normalizedFormId = String(formId || '').trim() || 'normal'

        if (!mapId || !pokemonId || weight === undefined) {
            return res.status(400).json({ ok: false, message: 'Missing required fields' })
        }

        if (weight < 0 || weight > 100000) {
            return res.status(400).json({ ok: false, message: 'Weight must be between 0 and 100000' })
        }

        const pokemon = await Pokemon.findById(pokemonId).select('forms defaultFormId').lean()
        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
        const availableFormIds = forms.map((form) => form.formId)
        const fallbackFormId = pokemon.defaultFormId || 'normal'
        const isValidFormId = forms.length
            ? availableFormIds.includes(normalizedFormId)
            : normalizedFormId === fallbackFormId || normalizedFormId === 'normal'

        if (!isValidFormId) {
            return res.status(400).json({
                ok: false,
                message: 'formId is not valid for this Pokemon',
            })
        }

        // Upsert: update if exists, create if not
        const dropRate = await DropRate.findOneAndUpdate(
            { mapId, pokemonId, formId: normalizedFormId },
            { weight, formId: normalizedFormId },
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
        const { mapId, pokemonId, formId } = req.query
        const normalizedFormId = String(formId || '').trim()

        const query = {}
        if (mapId) query.mapId = mapId
        if (pokemonId) query.pokemonId = pokemonId
        if (normalizedFormId) query.formId = normalizedFormId

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

// DELETE /api/admin/drop-rates/map/:mapId - Delete all drop rates for a map
router.delete('/map/:mapId', async (req, res) => {
    try {
        const { mapId } = req.params

        if (!mapId) {
            return res.status(400).json({ ok: false, message: 'mapId is required' })
        }

        const result = await DropRate.deleteMany({ mapId })

        res.json({
            ok: true,
            message: 'All drop rates deleted',
            deletedCount: result.deletedCount || 0,
        })
    } catch (error) {
        console.error('DELETE /api/admin/drop-rates/map/:mapId error:', error)
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
