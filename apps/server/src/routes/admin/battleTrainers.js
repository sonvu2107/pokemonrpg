import express from 'express'
import BattleTrainer from '../../models/BattleTrainer.js'
import Pokemon from '../../models/Pokemon.js'

const router = express.Router()

const normalizeTeam = (team) => {
    if (!Array.isArray(team)) return []
    return team
        .map((entry) => ({
            pokemonId: entry?.pokemonId || entry?.pokemon || entry?._id || '',
            level: Number(entry?.level) || 5,
            formId: String(entry?.formId || 'normal').trim(),
        }))
        .filter((entry) => entry.pokemonId)
}

const validateTeam = async (team) => {
    if (!team.length) return null
    const ids = team.map((entry) => entry.pokemonId)
    const count = await Pokemon.countDocuments({ _id: { $in: ids } })
    if (count !== ids.length) return 'Team contains invalid Pokemon id'
    return null
}

// GET /api/admin/battle-trainers
router.get('/', async (req, res) => {
    try {
        const trainers = await BattleTrainer.find()
            .sort({ orderIndex: 1, createdAt: 1 })
            .populate('team.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('prizePokemonId', 'name pokedexNumber imageUrl sprites')
            .lean()
        res.json({ ok: true, trainers })
    } catch (error) {
        console.error('GET /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/admin/battle-trainers
router.post('/', async (req, res) => {
    try {
        const { name, imageUrl, quote, isActive, orderIndex, team, prizePokemonId, platinumCoinsReward, expReward } = req.body

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Name is required' })
        }

        const normalizedTeam = normalizeTeam(team)
        const teamError = await validateTeam(normalizedTeam)
        if (teamError) {
            return res.status(400).json({ ok: false, message: teamError })
        }

        const trainer = new BattleTrainer({
            name,
            imageUrl: imageUrl || '',
            quote: quote || '',
            isActive: isActive !== undefined ? isActive : true,
            orderIndex: orderIndex !== undefined ? orderIndex : 0,
            team: normalizedTeam,
            prizePokemonId: prizePokemonId || null,
            platinumCoinsReward: platinumCoinsReward !== undefined ? platinumCoinsReward : 0,
            expReward: expReward !== undefined ? expReward : 0,
        })

        await trainer.save()

        res.status(201).json({ ok: true, trainer })
    } catch (error) {
        console.error('POST /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/battle-trainers/:id
router.put('/:id', async (req, res) => {
    try {
        const { name, imageUrl, quote, isActive, orderIndex, team, prizePokemonId, platinumCoinsReward, expReward } = req.body

        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Trainer not found' })
        }

        const normalizedTeam = normalizeTeam(team)
        const shouldUpdateTeam = team !== undefined
        if (shouldUpdateTeam) {
            const teamError = await validateTeam(normalizedTeam)
            if (teamError) {
                return res.status(400).json({ ok: false, message: teamError })
            }
        }

        if (name !== undefined) trainer.name = name
        if (imageUrl !== undefined) trainer.imageUrl = imageUrl
        if (quote !== undefined) trainer.quote = quote
        if (isActive !== undefined) trainer.isActive = isActive
        if (orderIndex !== undefined) trainer.orderIndex = orderIndex
        if (shouldUpdateTeam) trainer.team = normalizedTeam
        if (prizePokemonId !== undefined) trainer.prizePokemonId = prizePokemonId
        if (platinumCoinsReward !== undefined) trainer.platinumCoinsReward = platinumCoinsReward
        if (expReward !== undefined) trainer.expReward = expReward

        await trainer.save()

        res.json({ ok: true, trainer })
    } catch (error) {
        console.error('PUT /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/battle-trainers/:id
router.delete('/:id', async (req, res) => {
    try {
        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Trainer not found' })
        }
        await trainer.deleteOne()
        res.json({ ok: true, message: 'Trainer deleted' })
    } catch (error) {
        console.error('DELETE /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
