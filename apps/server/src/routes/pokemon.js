import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import { calcStatsForLevel, calcMaxHp } from '../utils/gameUtils.js'

const router = express.Router()

// GET /api/pokemon/:id
// Publicly accessible or protected? Let's make it open so people can share links.
// But we might want to populate owner info which is safe.
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params

        const userPokemon = await UserPokemon.findById(id)
            .populate('pokemonId')
            .populate('userId', 'username _id') // Populating owner info
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        const basePokemon = userPokemon.pokemonId
        if (!basePokemon) {
            return res.status(404).json({ ok: false, message: 'Base Pokemon data missing' })
        }

        // Calculate actual stats based on level, rarity, (and potentially IVs/EVs in future)
        const level = userPokemon.level || 1
        const rarity = basePokemon.rarity

        // Base stats from species
        const stats = calcStatsForLevel(basePokemon.baseStats, level, rarity)
        const maxHp = calcMaxHp(basePokemon.baseStats?.hp, level, rarity)

        // Enhance response with calculated stats
        const responseData = {
            ...userPokemon,
            stats: {
                ...stats,
                maxHp,
                currentHp: maxHp // Assuming full health for display or retrieve from separate state if tracked
            },
            // Helper to show total wins/losses if we had them. 
            // Currently UserPokemon schema doesn't seem to track wins/losses directly?
            // Checking schema... it has 'firstCatcher', 'originalTrainer' etc.
        }

        res.json({
            ok: true,
            pokemon: responseData
        })

    } catch (error) {
        console.error('Get Pokemon Detail Error:', error)
        res.status(500).json({ ok: false, message: 'Server Error' })
    }
})

export default router
