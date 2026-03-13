import UserPokemon from '../models/UserPokemon.js'
import UserPokedexEntry from '../models/UserPokedexEntry.js'
import { normalizeFormId } from '../utils/pokemonFormStats.js'

const OBJECT_ID_HEX_REGEX = /^[a-f\d]{24}$/i

const normalizeObjectIdValue = (value, visited = new Set()) => {
    if (typeof value === 'string') {
        const raw = value.trim()
        if (!raw) return ''
        if (OBJECT_ID_HEX_REGEX.test(raw)) return raw

        const objectIdMatch = raw.match(/ObjectId\(["']?([a-f\d]{24})["']?\)/i)
        return objectIdMatch?.[1] || ''
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return normalizeObjectIdValue(String(value), visited)
    }

    if (value && typeof value === 'object') {
        if (visited.has(value)) return ''
        visited.add(value)

        if (typeof value.toHexString === 'function') {
            try {
                const normalizedHex = normalizeObjectIdValue(value.toHexString(), visited)
                if (normalizedHex) return normalizedHex
            } catch {
                return ''
            }
        }

        if (typeof value.$oid === 'string') {
            const normalizedOid = normalizeObjectIdValue(value.$oid, visited)
            if (normalizedOid) return normalizedOid
        }

        if (value._id != null && value._id !== value) {
            const normalizedNestedId = normalizeObjectIdValue(value._id, visited)
            if (normalizedNestedId) return normalizedNestedId
        }

        if (value.id != null && value.id !== value) {
            const normalizedId = normalizeObjectIdValue(value.id, visited)
            if (normalizedId) return normalizedId
        }
    }

    return ''
}

const buildEntryKey = (pokemonId, formId) => {
    const normalizedPokemonId = normalizeObjectIdValue(pokemonId)
    if (!normalizedPokemonId) return ''
    return `${normalizedPokemonId}:${normalizeFormId(formId || 'normal')}`
}

export const ensureUserPokedexEntry = async ({ userId, pokemonId, formId = 'normal', obtainedAt = null } = {}) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    const normalizedPokemonId = normalizeObjectIdValue(pokemonId)
    if (!normalizedUserId || !normalizedPokemonId) return false

    const resolvedObtainedAt = obtainedAt instanceof Date ? obtainedAt : new Date(obtainedAt || Date.now())
    const normalizedForm = normalizeFormId(formId || 'normal')

    await UserPokedexEntry.updateOne(
        {
            userId: normalizedUserId,
            pokemonId: normalizedPokemonId,
            formId: normalizedForm,
        },
        {
            $setOnInsert: {
                firstObtainedAt: resolvedObtainedAt,
            },
            $max: {
                lastObtainedAt: resolvedObtainedAt,
            },
        },
        { upsert: true }
    )

    return true
}

export const syncUserPokedexEntriesFromUserPokemon = async (userId) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return new Set()

    const userPokemonRows = await UserPokemon.find({ userId: normalizedUserId })
        .select('pokemonId formId obtainedAt')
        .lean()

    const entryMap = new Map()
    for (const row of userPokemonRows) {
        const key = buildEntryKey(row?.pokemonId, row?.formId)
        if (!key) continue

        const obtainedAt = row?.obtainedAt instanceof Date ? row.obtainedAt : new Date(row?.obtainedAt || Date.now())
        const existing = entryMap.get(key)
        if (!existing) {
            entryMap.set(key, {
                userId: normalizedUserId,
                pokemonId: normalizeObjectIdValue(row?.pokemonId),
                formId: normalizeFormId(row?.formId || 'normal'),
                firstObtainedAt: obtainedAt,
                lastObtainedAt: obtainedAt,
            })
            continue
        }

        if (obtainedAt < existing.firstObtainedAt) existing.firstObtainedAt = obtainedAt
        if (obtainedAt > existing.lastObtainedAt) existing.lastObtainedAt = obtainedAt
    }

    const bulkOps = Array.from(entryMap.values()).map((entry) => ({
        updateOne: {
            filter: {
                userId: entry.userId,
                pokemonId: entry.pokemonId,
                formId: entry.formId,
            },
            update: {
                $setOnInsert: {
                    firstObtainedAt: entry.firstObtainedAt,
                },
                $max: {
                    lastObtainedAt: entry.lastObtainedAt,
                },
            },
            upsert: true,
        },
    }))

    if (bulkOps.length > 0) {
        await UserPokedexEntry.bulkWrite(bulkOps, { ordered: false })
    }

    return new Set(Array.from(entryMap.keys()))
}

export const getUserPokedexFormSet = async (userId, options = {}) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return new Set()

    if (options?.syncCurrentOwned) {
        await syncUserPokedexEntriesFromUserPokemon(normalizedUserId)
    }

    const entries = await UserPokedexEntry.find({ userId: normalizedUserId })
        .select('pokemonId formId')
        .lean()

    return new Set(entries.map((entry) => buildEntryKey(entry?.pokemonId, entry?.formId)).filter(Boolean))
}

export const hasUserPokedexEntry = async (userId, pokemonId, formId = 'normal') => {
    const entryKey = buildEntryKey(pokemonId, formId)
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId || !entryKey) return false

    const [resolvedPokemonId, resolvedFormId] = entryKey.split(':')
    const existingEntry = await UserPokedexEntry.exists({
        userId: normalizedUserId,
        pokemonId: resolvedPokemonId,
        formId: resolvedFormId,
    })
    if (existingEntry) return true

    const syncedEntryKeys = await syncUserPokedexEntriesFromUserPokemon(normalizedUserId)
    return syncedEntryKeys.has(entryKey)
}
