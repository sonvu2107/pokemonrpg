import express from 'express'
import BattleTrainer from '../models/BattleTrainer.js'

const router = express.Router()

// GET /api/battle-trainers - Public list
router.get('/', async (req, res) => {
    try {
        const trainers = await BattleTrainer.find({ isActive: true })
            .sort({ orderIndex: 1, createdAt: 1 })
            .populate('team.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId baseStats rarity')
            .populate('prizePokemonId', 'name pokedexNumber imageUrl sprites')
            .lean()

        res.json({ ok: true, trainers })
    } catch (error) {
        console.error('GET /api/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
