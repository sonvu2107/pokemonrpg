import PlayerState from '../models/PlayerState.js'
import MapProgress from '../models/MapProgress.js'
import { getOrderedMapsCached } from '../utils/orderedMapsCache.js'
import {
    buildProgressIndex,
    buildUnlockRequirement,
    unlockMapsInBulk,
} from './mapProgressionService.js'

export const canViewVipMap = (mapLike = {}, currentVipLevel = 0, isAdmin = false) => {
    if (isAdmin) return true
    const requiredVipLevel = Math.max(0, Number(mapLike?.vipVisibilityLevel) || 0)
    return requiredVipLevel === 0 || currentVipLevel >= requiredVipLevel
}

export const buildVisibleMapsResponse = async ({ userId, isAdmin = false, currentVipLevel = 0, eventOnly = false } = {}) => {
    const orderedMaps = await getOrderedMapsCached({ forceRefresh: eventOnly })
    const filteredMaps = eventOnly
        ? orderedMaps.filter((map) => Boolean(map?.isEventMap))
        : orderedMaps
    const mapIds = filteredMaps.map((map) => map._id)
    const playerLevelState = await PlayerState.findOne({ userId })
        .select('level')
        .lean()
    const currentPlayerLevel = Math.max(1, Number(playerLevelState?.level) || 1)
    const progresses = await MapProgress.find({ userId, mapId: { $in: mapIds } })
        .select('mapId totalSearches isUnlocked')
        .lean()
    const progressById = buildProgressIndex(progresses)

    const mapsWithUnlockState = filteredMaps.map((map, index) => {
        const unlockRequirement = buildUnlockRequirement(filteredMaps, index, progressById, currentPlayerLevel, currentVipLevel)
        const isUnlocked = isAdmin || (
            unlockRequirement.remainingSearches === 0
            && unlockRequirement.remainingPlayerLevels === 0
            && unlockRequirement.remainingVipLevels === 0
        )
        return { map, unlockRequirement, isUnlocked }
    })

    if (!isAdmin) {
        const mapIdsToUnlock = mapsWithUnlockState
            .filter(({ map, isUnlocked }) => {
                if (!isUnlocked) return false
                const existing = progressById.get(map._id.toString())
                return !existing || !existing.isUnlocked
            })
            .map(({ map }) => map._id)

        const unlockedProgressById = await unlockMapsInBulk(userId, mapIdsToUnlock)
        unlockedProgressById.forEach((progress, key) => {
            progressById.set(key, progress)
        })
    }

    return mapsWithUnlockState
        .filter(({ map }) => canViewVipMap(map, currentVipLevel, isAdmin))
        .map(({ map, unlockRequirement, isUnlocked }) => {
            const progress = progressById.get(map._id.toString())
            return {
                ...map,
                isUnlocked,
                unlockRequirement,
                progress: {
                    totalSearches: progress?.totalSearches || 0,
                },
            }
        })
}
