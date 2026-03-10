import DailyActivity from '../models/DailyActivity.js'
import MapProgress from '../models/MapProgress.js'
import PlayerState from '../models/PlayerState.js'
import User from '../models/User.js'
import { EXP_PER_SEARCH, expToNext } from '../utils/gameUtils.js'

const isDuplicateKeyError = (error) => Number(error?.code) === 11000

export const ensureTrainerCompletionTracked = async (userId, trainerId, completedAt = new Date()) => {
    const normalizedUserId = String(userId || '').trim()
    const normalizedTrainerId = String(trainerId || '').trim()
    if (!normalizedUserId || !normalizedTrainerId) return null

    const user = await User.findById(normalizedUserId)
        .select('_id completedBattleTrainers completedBattleTrainerReachedAt')
    if (!user) return null

    const completedTrainerIds = Array.isArray(user.completedBattleTrainers)
        ? user.completedBattleTrainers.map((value) => String(value || '').trim()).filter(Boolean)
        : []
    const completionMapRaw = user.completedBattleTrainerReachedAt instanceof Map
        ? Object.fromEntries(user.completedBattleTrainerReachedAt.entries())
        : (user.completedBattleTrainerReachedAt && typeof user.completedBattleTrainerReachedAt === 'object'
            ? user.completedBattleTrainerReachedAt
            : {})

    let shouldSave = false
    if (!completedTrainerIds.includes(normalizedTrainerId)) {
        completedTrainerIds.push(normalizedTrainerId)
        user.completedBattleTrainers = completedTrainerIds
        shouldSave = true
    }

    const completionTimestamp = completionMapRaw?.[normalizedTrainerId]
    const hasCompletionTimestamp = completionTimestamp && Number.isFinite(new Date(completionTimestamp).getTime())
    if (!hasCompletionTimestamp) {
        user.set(`completedBattleTrainerReachedAt.${normalizedTrainerId}`, completedAt)
        shouldSave = true
    }

    if (shouldSave) {
        await user.save()
    }

    return {
        completedTrainerIds,
        completionAt: user.completedBattleTrainerReachedAt?.get?.(normalizedTrainerId)
            || completionMapRaw?.[normalizedTrainerId]
            || completedAt,
    }
}

export const distributeExpByDefeats = (totalExp, participants = []) => {
    const normalizedTotalExp = Math.max(0, Math.floor(Number(totalExp) || 0))
    const normalizedParticipants = (Array.isArray(participants) ? participants : [])
        .map((entry, index) => ({
            ...entry,
            index,
            defeatedCount: Math.max(0, Math.floor(Number(entry?.defeatedCount) || 0)),
        }))
        .filter((entry) => entry.defeatedCount > 0)

    if (normalizedTotalExp <= 0 || normalizedParticipants.length === 0) {
        return normalizedParticipants.map((entry) => ({ ...entry, baseExp: 0 }))
    }

    const totalDefeats = normalizedParticipants.reduce((sum, entry) => sum + entry.defeatedCount, 0)
    if (totalDefeats <= 0) {
        return normalizedParticipants.map((entry) => ({ ...entry, baseExp: 0 }))
    }

    const withAllocation = normalizedParticipants.map((entry) => {
        const weighted = normalizedTotalExp * entry.defeatedCount
        return {
            ...entry,
            baseExp: Math.floor(weighted / totalDefeats),
            remainder: weighted % totalDefeats,
        }
    })

    const distributed = withAllocation.reduce((sum, entry) => sum + entry.baseExp, 0)
    const remaining = normalizedTotalExp - distributed

    if (remaining > 0) {
        const remainderSorted = [...withAllocation]
            .sort((a, b) => (
                (b.remainder - a.remainder) ||
                (b.defeatedCount - a.defeatedCount) ||
                (a.index - b.index)
            ))

        for (let i = 0; i < remaining; i += 1) {
            const target = remainderSorted[i % remainderSorted.length]
            target.baseExp += 1
        }
    }

    return withAllocation
        .sort((a, b) => a.index - b.index)
        .map(({ remainder, index, ...entry }) => entry)
}

export const normalizeLevelExpState = (level = 1, exp = 0, gain = 0) => {
    let nextLevel = Math.max(1, Number(level) || 1)
    let nextExp = Math.max(0, Number(exp) || 0) + Math.max(0, Number(gain) || 0)
    let levelsGained = 0

    while (nextExp >= expToNext(nextLevel)) {
        nextExp -= expToNext(nextLevel)
        nextLevel += 1
        levelsGained += 1
    }

    return {
        level: nextLevel,
        exp: nextExp,
        levelsGained,
    }
}

export const updateMapProgress = async (userId, mapId) => {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const now = new Date()
        const progress = await MapProgress.findOne({ userId, mapId })
            .select('level exp totalSearches isUnlocked unlockedAt __v')
            .lean()

        if (!progress) {
            const normalized = normalizeLevelExpState(1, 0, EXP_PER_SEARCH)
            try {
                const created = await MapProgress.create({
                    userId,
                    mapId,
                    level: normalized.level,
                    exp: normalized.exp,
                    totalSearches: 1,
                    isUnlocked: true,
                    unlockedAt: now,
                    lastSearchedAt: now,
                })
                return created
            } catch (error) {
                if (isDuplicateKeyError(error)) {
                    continue
                }
                throw error
            }
        }

        const normalized = normalizeLevelExpState(progress.level, progress.exp, EXP_PER_SEARCH)
        const updated = await MapProgress.findOneAndUpdate(
            { _id: progress._id, __v: progress.__v },
            {
                $set: {
                    level: normalized.level,
                    exp: normalized.exp,
                    totalSearches: (progress.totalSearches || 0) + 1,
                    isUnlocked: true,
                    unlockedAt: progress.unlockedAt || now,
                    lastSearchedAt: now,
                },
                $inc: { __v: 1 },
            },
            { new: true }
        )

        if (updated) {
            return updated
        }
    }

    throw new Error('Không thể cập nhật tiến trình bản đồ do xung đột cập nhật đồng thời')
}

export const updatePlayerLevel = async (userId) => {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const playerState = await PlayerState.findOne({ userId })
            .select('level experience __v')
            .lean()

        if (!playerState) {
            const normalized = normalizeLevelExpState(1, 0, EXP_PER_SEARCH)
            try {
                const created = await PlayerState.create({
                    userId,
                    level: normalized.level,
                    experience: normalized.exp,
                })
                return {
                    playerState: created,
                    leveledUp: normalized.levelsGained > 0,
                    levelsGained: normalized.levelsGained,
                }
            } catch (error) {
                if (isDuplicateKeyError(error)) {
                    continue
                }
                throw error
            }
        }

        const normalized = normalizeLevelExpState(playerState.level, playerState.experience, EXP_PER_SEARCH)
        const updated = await PlayerState.findOneAndUpdate(
            { _id: playerState._id, __v: playerState.__v },
            {
                $set: {
                    level: normalized.level,
                    experience: normalized.exp,
                },
                $inc: { __v: 1 },
            },
            { new: true }
        )

        if (updated) {
            return {
                playerState: updated,
                leveledUp: normalized.levelsGained > 0,
                levelsGained: normalized.levelsGained,
            }
        }
    }

    throw new Error('Không thể cập nhật cấp người chơi do xung đột cập nhật đồng thời')
}

export const formatMapProgress = (progress) => ({
    level: progress.level,
    exp: progress.exp,
    expToNext: expToNext(progress.level),
    totalSearches: progress.totalSearches,
})

export const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export const trackDailyActivity = async (userId, increments = {}) => {
    const searchableKeys = [
        'searches',
        'mapExp',
        'moonPoints',
        'battles',
        'levels',
        'battleMoonPoints',
        'platinumCoins',
        'mines',
        'shards',
        'diamondCoins',
        'trainerExp',
    ]
    const $inc = {}

    searchableKeys.forEach((key) => {
        const value = Number(increments[key])
        if (Number.isFinite(value) && value > 0) {
            $inc[key] = Math.floor(value)
        }
    })

    if (Object.keys($inc).length === 0) {
        if (!increments?.mapSlug && !increments?.mapName) {
            return
        }
    }

    const date = toDailyDateKey()
    await DailyActivity.findOneAndUpdate(
        { userId, date },
        {
            $inc,
            $setOnInsert: {
                userId,
                date,
            },
        },
        { upsert: true }
    )

    const mapSlug = String(increments?.mapSlug || '').trim()
    const mapName = String(increments?.mapName || '').trim()
    const mapSearches = Number.isFinite(Number(increments?.searches)) && Number(increments.searches) > 0
        ? Math.floor(Number(increments.searches))
        : 0
    const mapExp = Number.isFinite(Number(increments?.mapExp)) && Number(increments.mapExp) > 0
        ? Math.floor(Number(increments.mapExp))
        : 0
    const mapMoonPoints = Number.isFinite(Number(increments?.mapMoonPoints)) && Number(increments.mapMoonPoints) > 0
        ? Math.floor(Number(increments.mapMoonPoints))
        : 0

    if (!mapSlug && !mapName) {
        return
    }

    const mapInc = {}
    if (mapSearches > 0) mapInc['mapStats.$[entry].searches'] = mapSearches
    if (mapExp > 0) mapInc['mapStats.$[entry].mapExp'] = mapExp
    if (mapMoonPoints > 0) mapInc['mapStats.$[entry].moonPoints'] = mapMoonPoints

    const mapSet = {
        ...(mapSlug ? { 'mapStats.$[entry].mapSlug': mapSlug } : {}),
        ...(mapName ? { 'mapStats.$[entry].mapName': mapName } : {}),
    }

    const mapArrayFilter = (mapSlug && mapName)
        ? { $or: [{ 'entry.mapSlug': mapSlug }, { 'entry.mapName': mapName }] }
        : (mapSlug ? { 'entry.mapSlug': mapSlug } : { 'entry.mapName': mapName })

    if (Object.keys(mapInc).length > 0 || Object.keys(mapSet).length > 0) {
        const updatePayload = {}
        if (Object.keys(mapInc).length > 0) updatePayload.$inc = mapInc
        if (Object.keys(mapSet).length > 0) updatePayload.$set = mapSet

        const updated = await DailyActivity.updateOne(
            { userId, date },
            updatePayload,
            { arrayFilters: [mapArrayFilter] }
        )

        if (updated.modifiedCount > 0) {
            return
        }
    }

    await DailyActivity.updateOne(
        { userId, date },
        {
            $push: {
                mapStats: {
                    mapSlug,
                    mapName,
                    searches: mapSearches,
                    mapExp,
                    moonPoints: mapMoonPoints,
                },
            },
        }
    )
}

export const buildProgressIndex = (progresses) => {
    const byId = new Map()
    progresses.forEach((progress) => {
        byId.set(progress.mapId.toString(), progress)
    })
    return byId
}

export const resolveSourceMapForUnlock = (maps, index) => {
    if (index <= 0) return null

    const currentMap = maps[index] || null
    if (!currentMap) return null

    const currentTrack = Boolean(currentMap.isLegendary)
    for (let sourceIndex = index - 1; sourceIndex >= 0; sourceIndex -= 1) {
        const candidate = maps[sourceIndex]
        if (!candidate) continue
        if (Boolean(candidate.isLegendary) === currentTrack) {
            return candidate
        }
    }

    return null
}

export const resolveNextMapInTrack = (maps, index) => {
    const currentMap = maps[index] || null
    if (!currentMap) return null

    const currentTrack = Boolean(currentMap.isLegendary)
    for (let nextIndex = index + 1; nextIndex < maps.length; nextIndex += 1) {
        const candidate = maps[nextIndex]
        if (!candidate) continue
        if (Boolean(candidate.isLegendary) === currentTrack) {
            return candidate
        }
    }

    return null
}

export const buildUnlockRequirement = (maps, index, progressById, playerLevel = 1, vipLevel = 0) => {
    const currentMap = maps[index] || null
    const currentPlayerLevel = Math.max(1, Number(playerLevel) || 1)
    const requiredPlayerLevel = Math.max(1, Number(currentMap?.requiredPlayerLevel) || 1)
    const remainingPlayerLevels = Math.max(0, requiredPlayerLevel - currentPlayerLevel)
    const currentVipLevel = Math.max(0, Number(vipLevel) || 0)
    const requiredVipLevel = Math.max(0, Number(currentMap?.requiredVipLevel) || 0)
    const remainingVipLevels = Math.max(0, requiredVipLevel - currentVipLevel)

    const sourceMap = resolveSourceMapForUnlock(maps, index)
    if (!sourceMap) {
        return {
            requiredSearches: 0,
            currentSearches: 0,
            remainingSearches: 0,
            requiredPlayerLevel,
            currentPlayerLevel,
            remainingPlayerLevels,
            requiredVipLevel,
            currentVipLevel,
            remainingVipLevels,
            isSearchRequirementMet: true,
            isLevelRequirementMet: remainingPlayerLevels === 0,
            isVipRequirementMet: remainingVipLevels === 0,
            sourceMap: null,
        }
    }

    const sourceProgress = progressById.get(sourceMap._id.toString())
    const requiredSearches = Math.max(0, sourceMap.requiredSearches || 0)
    const currentSearches = sourceProgress?.totalSearches || 0
    const remainingSearches = Math.max(0, requiredSearches - currentSearches)

    return {
        requiredSearches,
        currentSearches,
        remainingSearches,
        requiredPlayerLevel,
        currentPlayerLevel,
        remainingPlayerLevels,
        requiredVipLevel,
        currentVipLevel,
        remainingVipLevels,
        isSearchRequirementMet: remainingSearches === 0,
        isLevelRequirementMet: remainingPlayerLevels === 0,
        isVipRequirementMet: remainingVipLevels === 0,
        sourceMap: {
            id: sourceMap._id,
            name: sourceMap.name,
            slug: sourceMap.slug,
        },
    }
}

export const ensureMapUnlocked = async (userId, mapId) => {
    const now = new Date()
    const progress = await MapProgress.findOneAndUpdate(
        { userId, mapId },
        {
            $set: {
                isUnlocked: true,
            },
            $setOnInsert: {
                userId,
                mapId,
                level: 1,
                exp: 0,
                totalSearches: 0,
                lastSearchedAt: null,
                unlockedAt: now,
            },
        },
        { new: true, upsert: true }
    )
    if (!progress.unlockedAt) {
        progress.unlockedAt = now
        await progress.save()
    }
    return progress
}

export const unlockMapsInBulk = async (userId, mapIds = []) => {
    const uniqueMapIds = [...new Set(
        (Array.isArray(mapIds) ? mapIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    )]

    if (uniqueMapIds.length === 0) {
        return new Map()
    }

    const now = new Date()
    await MapProgress.bulkWrite(
        uniqueMapIds.map((mapId) => ({
            updateOne: {
                filter: { userId, mapId },
                update: {
                    $set: { isUnlocked: true },
                    $setOnInsert: {
                        userId,
                        mapId,
                        level: 1,
                        exp: 0,
                        totalSearches: 0,
                        lastSearchedAt: null,
                        unlockedAt: now,
                    },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    )

    await MapProgress.updateMany(
        { userId, mapId: { $in: uniqueMapIds }, unlockedAt: null },
        { $set: { unlockedAt: now } }
    )

    const unlockedProgresses = await MapProgress.find({ userId, mapId: { $in: uniqueMapIds } })
        .select('mapId totalSearches isUnlocked')
        .lean()
    return buildProgressIndex(unlockedProgresses)
}
