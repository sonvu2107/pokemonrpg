import DropRate from '../models/DropRate.js'
import ItemDropRate from '../models/ItemDropRate.js'

const DROP_CACHE_TTL_MS = 30 * 1000
const DROP_CACHE_MAX_ENTRIES = 200

const pokemonDropCache = new Map()
const itemDropCache = new Map()

const getMapKey = (mapId) => String(mapId || '').trim()

const pruneCache = (cache) => {
    const now = Date.now()

    for (const [key, cached] of cache.entries()) {
        if (!cached || cached.expiresAt <= now) {
            cache.delete(key)
        }
    }

    while (cache.size > DROP_CACHE_MAX_ENTRIES) {
        const oldestKey = cache.keys().next().value
        if (!oldestKey) break
        cache.delete(oldestKey)
    }
}

const readCachedValue = (cache, key) => {
    pruneCache(cache)
    const cached = cache.get(key)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
        cache.delete(key)
        return null
    }
    return cached.value
}

const writeCachedValue = (cache, key, value) => {
    pruneCache(cache)
    cache.set(key, {
        value,
        expiresAt: Date.now() + DROP_CACHE_TTL_MS,
    })
    return value
}

export const invalidateMapDropRateCache = (mapId = null) => {
    const mapKey = getMapKey(mapId)
    if (!mapKey) {
        pokemonDropCache.clear()
        itemDropCache.clear()
        return
    }

    pokemonDropCache.delete(mapKey)
    itemDropCache.delete(mapKey)
}

export const getPokemonDropRatesCached = async (mapId) => {
    const mapKey = getMapKey(mapId)
    if (!mapKey) return []

    const cached = readCachedValue(pokemonDropCache, mapKey)
    if (cached) return cached

    const dropRates = await DropRate.find({ mapId })
        .select('mapId pokemonId formId weight')
        .lean()

    return writeCachedValue(pokemonDropCache, mapKey, dropRates)
}

export const getItemDropRatesCached = async (mapId) => {
    const mapKey = getMapKey(mapId)
    if (!mapKey) return []

    const cached = readCachedValue(itemDropCache, mapKey)
    if (cached) return cached

    const itemDropRates = await ItemDropRate.find({ mapId })
        .select('mapId itemId weight')
        .populate('itemId', 'name description imageUrl')
        .lean()

    return writeCachedValue(itemDropCache, mapKey, itemDropRates)
}
