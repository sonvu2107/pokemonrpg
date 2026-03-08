import mongoose from 'mongoose'
import UserPokemon from '../models/UserPokemon.js'

const ACTIVE_PARTY_FILTER = {
    location: 'party',
    status: 'active',
}

const isValidPartyIndex = (value) => Number.isInteger(value) && value >= 0 && value < 6

const toComparablePartyIndex = (value) => {
    const numeric = Number(value)
    return Number.isInteger(numeric) ? numeric : null
}

const toTime = (value) => {
    if (!value) return 0
    const date = new Date(value)
    const time = date.getTime()
    return Number.isFinite(time) ? time : 0
}

const comparePartyEntries = (left, right) => {
    const leftIndex = toComparablePartyIndex(left?.partyIndex)
    const rightIndex = toComparablePartyIndex(right?.partyIndex)
    const leftRank = isValidPartyIndex(leftIndex) ? leftIndex : 999
    const rightRank = isValidPartyIndex(rightIndex) ? rightIndex : 999

    if (leftRank !== rightRank) return leftRank - rightRank

    const leftUpdatedAt = toTime(left?.updatedAt)
    const rightUpdatedAt = toTime(right?.updatedAt)
    if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt

    const leftCreatedAt = toTime(left?.createdAt)
    const rightCreatedAt = toTime(right?.createdAt)
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt

    return String(left?._id || '').localeCompare(String(right?._id || ''))
}

const normalizeBoxNumber = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return 1
    return parsed
}

export const enforcePartyUniqueSpeciesForUser = async (userId, { dryRun = false } = {}) => {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId || !mongoose.Types.ObjectId.isValid(normalizedUserId)) {
        return {
            ok: false,
            userId: normalizedUserId || null,
            scanned: 0,
            duplicateSpeciesCount: 0,
            movedToBox: 0,
            modifiedCount: 0,
        }
    }

    const entries = await UserPokemon.find({
        userId: normalizedUserId,
        ...ACTIVE_PARTY_FILTER,
    })
        .select('_id userId pokemonId location partyIndex boxNumber createdAt updatedAt')
        .lean()

    if (!Array.isArray(entries) || entries.length <= 1) {
        return {
            ok: true,
            userId: normalizedUserId,
            scanned: Array.isArray(entries) ? entries.length : 0,
            duplicateSpeciesCount: 0,
            movedToBox: 0,
            modifiedCount: 0,
        }
    }

    const entriesBySpeciesId = new Map()
    entries.forEach((entry) => {
        const speciesId = String(entry?.pokemonId || '').trim()
        if (!speciesId) return
        if (!entriesBySpeciesId.has(speciesId)) {
            entriesBySpeciesId.set(speciesId, [])
        }
        entriesBySpeciesId.get(speciesId).push(entry)
    })

    const bulkOps = []
    let duplicateSpeciesCount = 0
    let movedToBox = 0

    entriesBySpeciesId.forEach((rows) => {
        if (!Array.isArray(rows) || rows.length <= 1) return

        duplicateSpeciesCount += 1
        const orderedRows = rows.slice().sort(comparePartyEntries)
        const duplicateRows = orderedRows.slice(1)

        duplicateRows.forEach((entry) => {
            movedToBox += 1
            if (dryRun) return

            bulkOps.push({
                updateOne: {
                    filter: { _id: entry._id },
                    update: {
                        $set: {
                            location: 'box',
                            partyIndex: null,
                            boxNumber: normalizeBoxNumber(entry?.boxNumber),
                        },
                    },
                },
            })
        })
    })

    let modifiedCount = 0
    if (!dryRun && bulkOps.length > 0) {
        const writeResult = await UserPokemon.bulkWrite(bulkOps, { ordered: true })
        modifiedCount = Number(writeResult?.modifiedCount || 0)
    }

    return {
        ok: true,
        userId: normalizedUserId,
        scanned: entries.length,
        duplicateSpeciesCount,
        movedToBox,
        modifiedCount,
    }
}

export const findUsersWithDuplicatePartySpecies = async () => {
    const rows = await UserPokemon.aggregate([
        {
            $match: {
                ...ACTIVE_PARTY_FILTER,
                pokemonId: { $ne: null },
            },
        },
        {
            $group: {
                _id: {
                    userId: '$userId',
                    pokemonId: '$pokemonId',
                },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gt: 1 },
            },
        },
        {
            $group: {
                _id: '$_id.userId',
            },
        },
    ])

    return rows
        .map((entry) => String(entry?._id || '').trim())
        .filter(Boolean)
}

export const enforcePartyUniqueSpeciesGlobally = async ({ dryRun = false } = {}) => {
    const userIds = await findUsersWithDuplicatePartySpecies()
    const stats = {
        usersScanned: userIds.length,
        usersChanged: 0,
        movedToBox: 0,
        modifiedCount: 0,
    }

    for (const userId of userIds) {
        const result = await enforcePartyUniqueSpeciesForUser(userId, { dryRun })
        if (!result?.ok || result.movedToBox <= 0) continue

        stats.usersChanged += 1
        stats.movedToBox += Number(result.movedToBox || 0)
        stats.modifiedCount += Number(result.modifiedCount || 0)
    }

    return stats
}
