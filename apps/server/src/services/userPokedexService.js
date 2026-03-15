import UserPokemon from '../models/UserPokemon.js'
import UserPokedexEntry from '../models/UserPokedexEntry.js'
import { normalizeFormId } from '../utils/pokemonFormStats.js'

const OBJECT_ID_HEX_REGEX = /^[a-f\d]{24}$/i
const USER_POKEDEX_READ_RECONCILE_TTL_MS = 30 * 1000
const userPokedexReadReconcileCache = new Map()

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

const normalizeObtainedAtValue = (value) => {
    const resolvedDate = value instanceof Date ? value : new Date(value || Date.now())
    return Number.isNaN(resolvedDate.getTime()) ? new Date() : resolvedDate
}

const buildEntrySnapshotMap = (rows = []) => {
    const map = new Map()

    for (const row of (Array.isArray(rows) ? rows : [])) {
        const userId = normalizeObjectIdValue(row?.userId)
        const pokemonId = normalizeObjectIdValue(row?.pokemonId)
        const formId = normalizeFormId(row?.formId || 'normal')
        const entryKey = buildEntryKey(pokemonId, formId)
        if (!userId || !entryKey) continue

        const obtainedAt = normalizeObtainedAtValue(row?.obtainedAt || row?.lastObtainedAt || row?.firstObtainedAt)
        const current = map.get(entryKey)
        if (!current) {
            map.set(entryKey, {
                userId,
                pokemonId,
                formId,
                firstObtainedAt: obtainedAt,
                lastObtainedAt: obtainedAt,
            })
            continue
        }

        if (obtainedAt < current.firstObtainedAt) current.firstObtainedAt = obtainedAt
        if (obtainedAt > current.lastObtainedAt) current.lastObtainedAt = obtainedAt
    }

    return map
}

const buildBulkOpsFromEntryMap = (entryMap, { existingKeys = null } = {}) => {
    const allowedExistingKeys = existingKeys instanceof Set ? existingKeys : null

    return Array.from(entryMap.entries())
        .filter(([entryKey]) => !allowedExistingKeys || !allowedExistingKeys.has(entryKey))
        .map(([, entry]) => ({
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
}

const buildBulkWriteOptions = (options = {}) => {
    const resolved = { ordered: false }
    if (options?.session) {
        resolved.session = options.session
    }
    return resolved
}

const markUserPokedexRecentlyReconciled = (userId) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return
    userPokedexReadReconcileCache.set(normalizedUserId, Date.now() + USER_POKEDEX_READ_RECONCILE_TTL_MS)
}

const shouldReconcileUserPokedexOnRead = (userId) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return false

    const expiresAt = Number(userPokedexReadReconcileCache.get(normalizedUserId) || 0)
    if (expiresAt > Date.now()) {
        return false
    }

    userPokedexReadReconcileCache.delete(normalizedUserId)
    return true
}

const loadUserPokedexEntrySet = async (userId) => {
    const entries = await UserPokedexEntry.find({ userId })
        .select('pokemonId formId')
        .lean()

    return new Set(entries.map((entry) => buildEntryKey(entry?.pokemonId, entry?.formId)).filter(Boolean))
}

export const ensureUserPokedexEntry = async ({ userId, pokemonId, formId = 'normal', obtainedAt = null } = {}) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    const normalizedPokemonId = normalizeObjectIdValue(pokemonId)
    if (!normalizedUserId || !normalizedPokemonId) return false

    const resolvedObtainedAt = normalizeObtainedAtValue(obtainedAt)
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
    markUserPokedexRecentlyReconciled(normalizedUserId)

    return true
}

export const syncUserPokedexEntriesForPokemonDocs = async (pokemonDocs = [], options = {}) => {
    const entryMap = buildEntrySnapshotMap(pokemonDocs)
    const bulkOps = buildBulkOpsFromEntryMap(entryMap)

    if (bulkOps.length > 0) {
        await UserPokedexEntry.bulkWrite(bulkOps, buildBulkWriteOptions(options))
    }

    for (const entry of entryMap.values()) {
        markUserPokedexRecentlyReconciled(entry?.userId)
    }

    return new Set(entryMap.keys())
}

export const syncUserPokedexEntriesFromUserPokemon = async (userId, options = {}) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return new Set()

    const [existingEntries, userPokemonRows] = await Promise.all([
        UserPokedexEntry.find({ userId: normalizedUserId })
            .select('pokemonId formId')
            .lean(),
        UserPokemon.find({ userId: normalizedUserId })
            .select('userId pokemonId formId obtainedAt')
            .lean(),
    ])

    const currentEntryMap = buildEntrySnapshotMap(userPokemonRows)
    const existingKeys = new Set(
        (existingEntries || [])
            .map((entry) => buildEntryKey(entry?.pokemonId, entry?.formId))
            .filter(Boolean)
    )
    const bulkOps = buildBulkOpsFromEntryMap(currentEntryMap, { existingKeys })

    if (bulkOps.length > 0) {
        await UserPokedexEntry.bulkWrite(bulkOps, buildBulkWriteOptions(options))
    }
    markUserPokedexRecentlyReconciled(normalizedUserId)

    return new Set(currentEntryMap.keys())
}

export const getUserPokedexFormSet = async (userId, options = {}) => {
    const normalizedUserId = normalizeObjectIdValue(userId)
    if (!normalizedUserId) return new Set()

    if (options?.syncCurrentOwned && shouldReconcileUserPokedexOnRead(normalizedUserId)) {
        return syncUserPokedexEntriesFromUserPokemon(normalizedUserId, options)
    }

    return loadUserPokedexEntrySet(normalizedUserId)
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

export const __userPokedexServiceInternals = {
    clearReadReconcileCache() {
        userPokedexReadReconcileCache.clear()
    },
}
