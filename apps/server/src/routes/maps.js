import express from 'express'
import MapModel from '../models/Map.js'
import DropRate from '../models/DropRate.js'
import ItemDropRate from '../models/ItemDropRate.js'

const router = express.Router()
const MAPS_CACHE_TTL_MS = 30 * 1000
const MAP_DETAIL_CACHE_MAX_ENTRIES = 200

let legendaryMapsCache = {
    value: null,
    expiresAt: 0,
}

let allMapsCache = {
    value: null,
    expiresAt: 0,
}

const mapDetailCache = new globalThis.Map()

export const invalidatePublicMapsCache = () => {
    legendaryMapsCache = {
        value: null,
        expiresAt: 0,
    }
    allMapsCache = {
        value: null,
        expiresAt: 0,
    }
    mapDetailCache.clear()
}

const pruneMapDetailCache = () => {
    const now = Date.now()
    for (const [key, cached] of mapDetailCache.entries()) {
        if (!cached || cached.expiresAt <= now) {
            mapDetailCache.delete(key)
        }
    }

    while (mapDetailCache.size > MAP_DETAIL_CACHE_MAX_ENTRIES) {
        const oldestKey = mapDetailCache.keys().next().value
        if (!oldestKey) break
        mapDetailCache.delete(oldestKey)
    }
}

const readCachedResponse = (cacheState) => {
    const now = Date.now()
    if (!cacheState.value || cacheState.expiresAt <= now) {
        return null
    }
    return cacheState.value
}

const writeCachedResponse = (cacheState, value) => {
    cacheState.value = value
    cacheState.expiresAt = Date.now() + MAPS_CACHE_TTL_MS
}

const readMapDetailCached = (slug) => {
    pruneMapDetailCache()
    const key = String(slug || '').trim().toLowerCase()
    if (!key) return null
    const cached = mapDetailCache.get(key)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
        mapDetailCache.delete(key)
        return null
    }
    return cached.value
}

const writeMapDetailCached = (slug, value) => {
    pruneMapDetailCache()
    const key = String(slug || '').trim().toLowerCase()
    if (!key) return
    mapDetailCache.set(key, {
        value,
        expiresAt: Date.now() + MAPS_CACHE_TTL_MS,
    })
}

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
const clampRate = (value) => Math.max(0, Math.min(1, Number(value) || 0))
const toPercent = (value) => Number((clampRate(value) * 100).toFixed(4))

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

const resolveSpecialPokemonConfigsForMap = (map) => {
    const configs = Array.isArray(map?.specialPokemonConfigs) ? map.specialPokemonConfigs : []
    if (configs.length > 0) {
        return configs
            .map((entry) => {
                const pokemon = entry?.pokemonId
                const weight = Number(entry?.weight)
                if (!pokemon || !(weight > 0)) return null
                return {
                    pokemon,
                    formId: normalizeFormId(entry?.formId),
                    weight,
                }
            })
            .filter(Boolean)
    }

    return (Array.isArray(map?.specialPokemonIds) ? map.specialPokemonIds : [])
        .map((pokemon) => (pokemon ? {
            pokemon,
            formId: 'normal',
            weight: 1,
        } : null))
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

const buildMapPokemonEncounters = (map, dropRates = []) => {
    const encounterRate = clampRate(map?.encounterRate)
    const specialConfigs = resolveSpecialPokemonConfigsForMap(map)
    const hasSpecialPool = specialConfigs.length > 0
    const specialPoolShare = hasSpecialPool ? clampRate(map?.specialPokemonEncounterRate) : 0
    const normalPoolShare = hasSpecialPool ? Math.max(0, 1 - specialPoolShare) : 1
    const specialTotalWeight = specialConfigs.reduce((sum, entry) => sum + (Number(entry?.weight) > 0 ? Number(entry.weight) : 0), 0)
    const normalTotalWeight = dropRates.reduce((sum, entry) => sum + (Number(entry?.weight) > 0 ? Number(entry.weight) : 0), 0)

    const specialEntries = specialConfigs.map((entry) => {
        const pokemon = entry.pokemon
        const weight = Number(entry.weight) > 0 ? Number(entry.weight) : 0
        const { formId, form } = resolveFormForDrop(pokemon, entry.formId)
        const poolRate = specialTotalWeight > 0 ? (weight / specialTotalWeight) : 0
        const encounterChance = encounterRate * specialPoolShare * poolRate
        const resolvedImageUrl = form?.imageUrl || form?.sprites?.normal || form?.sprites?.icon || pokemon?.imageUrl || pokemon?.sprites?.normal || pokemon?.sprites?.icon || ''

        return {
            _id: `special:${pokemon?._id || pokemon?.id || pokemon?.name || formId}`,
            source: 'special',
            pokemonId: pokemon,
            formId,
            form,
            resolvedSprites: form?.sprites || pokemon?.sprites || {},
            resolvedImageUrl,
            weight,
            poolPercent: toPercent(poolRate),
            encounterPercent: toPercent(encounterChance),
        }
    })

    const normalEntries = dropRates.map((entry) => {
        const weight = Number(entry?.weight) > 0 ? Number(entry.weight) : 0
        const poolRate = normalTotalWeight > 0 ? (weight / normalTotalWeight) : 0
        const encounterChance = encounterRate * normalPoolShare * poolRate
        return {
            ...entry,
            source: 'normal',
            poolPercent: toPercent(poolRate),
            encounterPercent: toPercent(encounterChance),
        }
    })

    return [...specialEntries, ...normalEntries]
        .filter((entry) => entry?.pokemonId)
        .sort((left, right) => {
            const encounterDiff = Number(right?.encounterPercent || 0) - Number(left?.encounterPercent || 0)
            if (encounterDiff !== 0) return encounterDiff
            return String(left?.pokemonId?.name || '').localeCompare(String(right?.pokemonId?.name || ''), 'vi')
        })
}

const buildMapItemDrops = (map, itemDropRates = []) => {
    const itemDropRate = clampRate(map?.itemDropRate)
    const totalWeight = itemDropRates.reduce((sum, entry) => sum + (Number(entry?.weight) > 0 ? Number(entry.weight) : 0), 0)

    return itemDropRates
        .map((entry) => {
            const weight = Number(entry?.weight) > 0 ? Number(entry.weight) : 0
            const poolRate = totalWeight > 0 ? (weight / totalWeight) : 0
            return {
                ...entry,
                poolPercent: toPercent(poolRate),
                dropPercent: toPercent(itemDropRate * poolRate),
            }
        })
        .filter((entry) => entry?.itemId)
        .sort((left, right) => {
            const dropDiff = Number(right?.dropPercent || 0) - Number(left?.dropPercent || 0)
            if (dropDiff !== 0) return dropDiff
            return String(left?.itemId?.name || '').localeCompare(String(right?.itemId?.name || ''), 'vi')
        })
}

// GET /api/maps/legendary - Get all legendary maps (public endpoint)
router.get('/legendary', async (req, res) => {
    try {
        const cached = readCachedResponse(legendaryMapsCache)
        if (cached) {
            return res.json(cached)
        }

        const legendaryMaps = await MapModel.find({ isLegendary: true })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .select('name slug iconId isEventMap specialPokemonImages specialPokemonIds specialPokemonConfigs mapImageUrl requiredPlayerLevel requiredVipLevel autoSearchRequiredVipLevel')
            .sort({ createdAt: 1 })
            .lean()

        const maps = legendaryMaps.map((map) => ({
            ...map,
            specialPokemons: resolveSpecialPokemonsForMap(map),
        }))

        const response = { ok: true, maps }
        writeCachedResponse(legendaryMapsCache, response)
        res.json(response)
    } catch (error) {
        console.error('GET /api/maps/legendary error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/maps - Get all maps (public endpoint, maybe filtered?)
router.get('/', async (req, res) => {
    try {
        const cached = readCachedResponse(allMapsCache)
        if (cached) {
            return res.json(cached)
        }

        const maps = await MapModel.find({})
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .select('name slug levelMin levelMax isLegendary isEventMap iconId specialPokemonImages specialPokemonIds specialPokemonConfigs mapImageUrl requiredPlayerLevel requiredVipLevel autoSearchRequiredVipLevel')
            .sort({ levelMin: 1 })
            .lean()

        const resolvedMaps = maps.map((map) => ({
            ...map,
            specialPokemons: resolveSpecialPokemonsForMap(map),
        }))

        const response = { ok: true, maps: resolvedMaps }
        writeCachedResponse(allMapsCache, response)
        res.json(response)
    } catch (error) {
        console.error('GET /api/maps error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/maps/:slug - Get map details by slug (public endpoint)
router.get('/:slug', async (req, res) => {
    try {
        const { slug } = req.params
        const cached = readMapDetailCached(slug)
        if (cached) {
            return res.json(cached)
        }

        const map = await MapModel.findOne({ slug })
            .populate('specialPokemonIds', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .populate('specialPokemonConfigs.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId rarity')
            .lean()

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const dropRates = await DropRate.find({ mapId: map._id })
            .populate('pokemonId', 'name pokedexNumber sprites imageUrl types rarity forms defaultFormId')
            .sort({ weight: -1 })
            .lean()

        const itemDropRates = await ItemDropRate.find({ mapId: map._id })
            .populate('itemId', 'name description imageUrl type rarity effectType effectValue effectValueMp')
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

        const resolvedItemDropRates = buildMapItemDrops(map, itemDropRates)
        const pokemonEncounters = buildMapPokemonEncounters(map, resolvedDropRates)

        const response = {
            ok: true,
            map: resolvedMap,
            dropRates: resolvedDropRates,
            itemDropRates: resolvedItemDropRates,
            pokemonEncounters,
        }
        writeMapDetailCached(slug, response)
        res.json(response)
    } catch (error) {
        console.error(`GET /api/maps/${req.params.slug} error:`, error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
