import express from 'express'
import UserPokemon from '../models/UserPokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'

const router = express.Router()

router.use(authMiddleware)

// GET /api/party
// Return list of 6 slots found in party
router.get('/', async (req, res) => {
    try {
        const party = await UserPokemon.find({
            userId: req.user.userId,
            location: 'party'
        })
            .populate('pokemonId')
            .sort({ partyIndex: 1 })

        // Ensure we always return 6 slots, even if empty
        const slots = Array(6).fill(null)
        party.forEach(p => {
            if (p.partyIndex >= 0 && p.partyIndex < 6) {
                // Calculate stats for this pokemon
                const base = p.pokemonId || {}
                const stats = calcStatsForLevel(base.baseStats, p.level, base.rarity)

                // Return a plain object with stats injected
                const po = p.toObject()
                po.stats = stats

                slots[p.partyIndex] = po
            } else {
                // If index is messed up, put in first available slot
                const firstEmpty = slots.findIndex(s => s === null)
                if (firstEmpty !== -1) {
                    const base = p.pokemonId || {}
                    const stats = calcStatsForLevel(base.baseStats, p.level, base.rarity)
                    const po = p.toObject()
                    po.stats = stats
                    slots[firstEmpty] = po
                }
            }
        })

        res.json({ ok: true, party: slots })
    } catch (error) {
        console.error('Get Party Error:', error)
        res.status(500).json({ ok: false, message: 'Server Error' })
    }
})

// POST /api/party/swap
// Body: { fromIndex: number, toIndex: number }
router.post('/swap', async (req, res) => {
    try {
        const { fromIndex, toIndex } = req.body
        const userId = req.user.userId

        if (fromIndex === undefined || toIndex === undefined) {
            return res.status(400).json({ ok: false, message: 'Indices required' })
        }
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            return res.status(400).json({ ok: false, message: 'Indices must be integers' })
        }
        if (fromIndex < 0 || fromIndex > 5 || toIndex < 0 || toIndex > 5) {
            return res.status(400).json({ ok: false, message: 'Indices must be in range 0-5' })
        }
        if (fromIndex === toIndex) {
            return res.json({ ok: true, message: 'No change' })
        }

        // Find pokes at these indices
        const p1 = await UserPokemon.findOne({ userId, location: 'party', partyIndex: fromIndex })
        const p2 = await UserPokemon.findOne({ userId, location: 'party', partyIndex: toIndex })

        if (!p1) {
            return res.status(400).json({ ok: false, message: 'No Pokemon in source slot' })
        }

        // Swap indices
        p1.partyIndex = toIndex
        await p1.save()

        if (p2) {
            p2.partyIndex = fromIndex
            await p2.save()
        }

        res.json({ ok: true, message: 'Swapped' })

    } catch (error) {
        console.error('Swap Party Error:', error)
        res.status(500).json({ ok: false, message: 'Swap Failed' })
    }
})

// POST /api/party/add
// Body: { pokemonId: string, slotIndex: number (optional) }
router.post('/add', async (req, res) => {
    try {
        const { pokemonId, slotIndex } = req.body
        const userId = req.user.userId

        const pokemon = await UserPokemon.findOne({ _id: pokemonId, userId })
        if (!pokemon) return res.status(404).json({ ok: false, message: 'Pokemon not found' })

        if (pokemon.location === 'party') {
            return res.status(400).json({ ok: false, message: 'Already in party' })
        }

        // Count current party size
        const party = await UserPokemon.find({ userId, location: 'party' })
        if (party.length >= 6) {
            return res.status(400).json({ ok: false, message: 'Party is full' })
        }

        // Determine index
        let targetIndex = slotIndex
        if (targetIndex === undefined || targetIndex === null) {
            // Find first empty slot
            const occupied = new Set(party.map(p => p.partyIndex))
            for (let i = 0; i < 6; i++) {
                if (!occupied.has(i)) {
                    targetIndex = i
                    break
                }
            }
        } else {
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 5) {
                return res.status(400).json({ ok: false, message: 'slotIndex must be in range 0-5' })
            }
            const occupied = party.some(p => p.partyIndex === targetIndex)
            if (occupied) {
                return res.status(400).json({ ok: false, message: 'Target slot is occupied' })
            }
        }

        // Move to party
        pokemon.location = 'party'
        pokemon.partyIndex = targetIndex
        pokemon.boxNumber = null
        await pokemon.save()

        res.json({ ok: true, message: 'Added to party' })

    } catch (error) {
        console.error('Add Party Error:', error)
        res.status(500).json({ ok: false, message: 'Add Failed' })
    }
})

// POST /api/party/remove
// Body: { pokemonId: string }
router.post('/remove', async (req, res) => {
    try {
        const { pokemonId } = req.body
        const userId = req.user.userId

        const pokemon = await UserPokemon.findOne({ _id: pokemonId, userId, location: 'party' })
        if (!pokemon) return res.status(404).json({ ok: false, message: 'Pokemon not in party' })

        // Move to box
        pokemon.location = 'box'
        pokemon.partyIndex = null
        pokemon.boxNumber = 1 // Default box 1 for now
        await pokemon.save()

        res.json({ ok: true, message: 'Removed from party' })

    } catch (error) {
        console.error('Remove Party Error:', error)
        res.status(500).json({ ok: false, message: 'Remove Failed' })
    }
})


export default router
