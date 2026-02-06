import express from 'express'
import Map from '../models/Map.js'

const router = express.Router()

const toSpecialPokemonDisplay = (pokemon) => {
    if (!pokemon) return null
    const imageUrl = pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.icon || ''
    return {
        id: pokemon._id,
        name: pokemon.name,
        pokedexNumber: pokemon.pokedexNumber,
        imageUrl,
    }
}

// GET /api/maps/legendary - Get all legendary maps (public endpoint)
router.get('/legendary', async (req, res) => {
    try {
        const legendaryMaps = await Map.find({ isLegendary: true })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites')
            .select('name slug iconId specialPokemonImages specialPokemonIds mapImageUrl')
            .sort({ createdAt: 1 })
            .lean()

        const maps = legendaryMaps.map((map) => ({
            ...map,
            specialPokemons: (map.specialPokemonIds || []).map(toSpecialPokemonDisplay).filter(Boolean),
        }))

        res.json({ ok: true, maps })
    } catch (error) {
        console.error('GET /api/maps/legendary error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/maps - Get all maps (public endpoint, maybe filtered?)
router.get('/', async (req, res) => {
    try {
        const maps = await Map.find({})
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites')
            .select('name slug levelMin levelMax isLegendary iconId specialPokemonImages specialPokemonIds mapImageUrl')
            .sort({ levelMin: 1 })
            .lean()

        const resolvedMaps = maps.map((map) => ({
            ...map,
            specialPokemons: (map.specialPokemonIds || []).map(toSpecialPokemonDisplay).filter(Boolean),
        }))
        res.json({ ok: true, maps: resolvedMaps })
    } catch (error) {
        console.error('GET /api/maps error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/maps/:slug - Get map details by slug (public endpoint)
router.get('/:slug', async (req, res) => {
    try {
        const { slug } = req.params
        const map = await Map.findOne({ slug })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites')
            .lean()

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Map not found' })
        }

        // Fetch DropRates for this map to show available pokemon
        // We need to import DropRate model first, or use mongoose.model if circular dep issues
        const DropRate = (await import('../models/DropRate.js')).default

        const dropRates = await DropRate.find({ mapId: map._id })
            .populate('pokemonId', 'name pokedexNumber sprites imageUrl types rarity')
            .sort({ weight: -1 }) // Show common ones first or rares? Maybe rares first for hype? Let's sort by weight for now.
            // Actually usually games show rares first. Let's do nothing here and let frontend sort or sort by rarity.
            .lean()

        const resolvedMap = {
            ...map,
            specialPokemons: (map.specialPokemonIds || []).map(toSpecialPokemonDisplay).filter(Boolean),
        }

        res.json({ ok: true, map: resolvedMap, dropRates })
    } catch (error) {
        console.error(`GET /api/maps/${req.params.slug} error:`, error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
