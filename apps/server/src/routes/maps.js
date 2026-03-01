import express from 'express'
import Map from '../models/Map.js'

const router = express.Router()

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

const toSpecialPokemonDisplay = (pokemon, formId = null) => {
    if (!pokemon) return null
    const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon.defaultFormId)
    const resolvedFormId = normalizeFormId(formId || defaultFormId)
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === resolvedFormId) || null
    const imageUrl = resolvedForm?.imageUrl
        || resolvedForm?.sprites?.normal
        || resolvedForm?.sprites?.icon
        || pokemon.imageUrl
        || pokemon.sprites?.normal
        || pokemon.sprites?.icon
        || ''

    return {
        id: pokemon._id,
        name: pokemon.name,
        pokedexNumber: pokemon.pokedexNumber,
        formId: resolvedFormId,
        formName: resolvedForm?.formName || resolvedFormId,
        imageUrl,
    }
}

const resolveSpecialPokemonsForMap = (map) => {
    const configs = Array.isArray(map?.specialPokemonConfigs) ? map.specialPokemonConfigs : []
    if (configs.length > 0) {
        return configs
            .map((entry) => toSpecialPokemonDisplay(entry?.pokemonId, entry?.formId))
            .filter(Boolean)
    }

    return (Array.isArray(map?.specialPokemonIds) ? map.specialPokemonIds : [])
        .map((entry) => toSpecialPokemonDisplay(entry, 'normal'))
        .filter(Boolean)
}

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

// GET /api/maps/legendary - Get all legendary maps (public endpoint)
router.get('/legendary', async (req, res) => {
    try {
        const legendaryMaps = await Map.find({ isLegendary: true })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .select('name slug iconId specialPokemonImages specialPokemonIds specialPokemonConfigs mapImageUrl requiredPlayerLevel')
            .sort({ createdAt: 1 })
            .lean()

        const maps = legendaryMaps.map((map) => ({
            ...map,
            specialPokemons: resolveSpecialPokemonsForMap(map),
        }))

        res.json({ ok: true, maps })
    } catch (error) {
        console.error('GET /api/maps/legendary error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/maps - Get all maps (public endpoint, maybe filtered?)
router.get('/', async (req, res) => {
    try {
        const maps = await Map.find({})
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .select('name slug levelMin levelMax isLegendary iconId specialPokemonImages specialPokemonIds specialPokemonConfigs mapImageUrl requiredPlayerLevel')
            .sort({ levelMin: 1 })
            .lean()

        const resolvedMaps = maps.map((map) => ({
            ...map,
            specialPokemons: resolveSpecialPokemonsForMap(map),
        }))
        res.json({ ok: true, maps: resolvedMaps })
    } catch (error) {
        console.error('GET /api/maps error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/maps/:slug - Get map details by slug (public endpoint)
router.get('/:slug', async (req, res) => {
    try {
        const { slug } = req.params
        const map = await Map.findOne({ slug })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .lean()

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const DropRate = (await import('../models/DropRate.js')).default

        const dropRates = await DropRate.find({ mapId: map._id })
            .populate('pokemonId', 'name pokedexNumber sprites imageUrl types rarity forms defaultFormId')
            .sort({ weight: -1 })
            .lean()

        const resolvedMap = {
            ...map,
            specialPokemons: resolveSpecialPokemonsForMap(map),
        }

        const resolvedDropRates = dropRates.map((dr) => {
            const { formId, form } = resolveFormForDrop(dr.pokemonId, dr.formId)
            const resolvedSprites = form?.sprites || dr.pokemonId?.sprites || {}
            const resolvedImageUrl = form?.imageUrl || dr.pokemonId?.imageUrl || ''
            return {
                ...dr,
                formId,
                form,
                resolvedSprites,
                resolvedImageUrl,
            }
        })

        res.json({ ok: true, map: resolvedMap, dropRates: resolvedDropRates })
    } catch (error) {
        console.error(`GET /api/maps/${req.params.slug} error:`, error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
