import MapModel from '../models/Map.js'

const MAP_CACHE_TTL_MS = 30 * 1000

let orderedMapsCache = {
    maps: null,
    expiresAt: 0,
}

export const invalidateOrderedMapsCache = () => {
    orderedMapsCache = {
        maps: null,
        expiresAt: 0,
    }
}

export const getOrderedMapsCached = async ({ forceRefresh = false } = {}) => {
    const now = Date.now()
    if (!forceRefresh && orderedMapsCache.maps && orderedMapsCache.expiresAt > now) {
        return orderedMapsCache.maps
    }

    const maps = await MapModel.find({})
        .select('name slug levelMin levelMax isLegendary isEventMap iconId requiredSearches requiredPlayerLevel requiredVipLevel autoSearchRequiredVipLevel orderIndex')
        .sort({ orderIndex: 1, createdAt: 1, _id: 1 })
        .lean()

    orderedMapsCache = {
        maps,
        expiresAt: now + MAP_CACHE_TTL_MS,
    }

    return maps
}
