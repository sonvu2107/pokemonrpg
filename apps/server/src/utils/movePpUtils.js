import Move from '../models/Move.js'

export const normalizeMoveName = (value = '') => String(value || '').trim().toLowerCase()

const toMoveName = (entry) => {
    if (typeof entry === 'string') return String(entry || '').trim()
    return String(entry?.moveName || entry?.name || '').trim()
}

export const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon?.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter((entry) => Number.isFinite(entry?.level) && entry.level <= level)
        .sort((a, b) => a.level - b.level)
        .map((entry) => String(entry?.moveName || entry?.moveId?.name || '').trim())
        .filter(Boolean)
    return learned.slice(-4)
}

export const mergeKnownMovesWithFallback = (moves = []) => {
    const explicitMoves = (Array.isArray(moves) ? moves : [])
        .map((entry) => toMoveName(entry))
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)

    return explicitMoves.slice(0, 4)
}

export const buildMoveLookupByName = async (moveNames = []) => {
    const normalizedKeys = [...new Set(
        (Array.isArray(moveNames) ? moveNames : [])
            .map((entry) => normalizeMoveName(entry))
            .filter(Boolean)
    )]
    if (normalizedKeys.length === 0) {
        return new Map()
    }

    const docs = await Move.find({ nameLower: { $in: normalizedKeys } })
        .select('name nameLower pp type category power accuracy priority')
        .lean()

    const map = new Map()
    docs.forEach((doc) => {
        const key = normalizeMoveName(doc?.nameLower || doc?.name || '')
        if (!key || map.has(key)) return
        map.set(key, doc)
    })
    return map
}

const normalizeExistingPpStateMap = (movePpState = []) => {
    const map = new Map()
    ;(Array.isArray(movePpState) ? movePpState : []).forEach((entry) => {
        const moveName = String(entry?.moveName || '').trim()
        const key = normalizeMoveName(moveName)
        if (!key || map.has(key)) return

        const maxPpRaw = Number(entry?.maxPp)
        const currentPpRaw = Number(entry?.currentPp)
        const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0 ? Math.floor(maxPpRaw) : 10
        const currentPp = Number.isFinite(currentPpRaw)
            ? Math.max(0, Math.min(maxPp, Math.floor(currentPpRaw)))
            : maxPp

        map.set(key, {
            moveName,
            maxPp,
            currentPp,
        })
    })
    return map
}

export const buildMovePpStateFromMoves = ({ moveNames = [], movePpState = [], moveLookupMap = null } = {}) => {
    const normalizedMoveNames = [...new Set(
        (Array.isArray(moveNames) ? moveNames : [])
            .map((entry) => toMoveName(entry))
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    )].slice(0, 4)

    const existingMap = normalizeExistingPpStateMap(movePpState)
    const lookupMap = moveLookupMap instanceof Map ? moveLookupMap : new Map()

    return normalizedMoveNames.map((moveName) => {
        const key = normalizeMoveName(moveName)
        const lookup = lookupMap.get(key)
        const existing = existingMap.get(key)

        const lookupPp = Number(lookup?.pp)
        const maxPp = Number.isFinite(lookupPp) && lookupPp > 0
            ? Math.max(1, Math.floor(lookupPp))
            : Math.max(1, Math.floor(Number(existing?.maxPp) || 10))

        const currentPpRaw = Number(existing?.currentPp)
        const currentPp = Number.isFinite(currentPpRaw)
            ? Math.max(0, Math.min(maxPp, Math.floor(currentPpRaw)))
            : maxPp

        return {
            moveName: String(lookup?.name || existing?.moveName || moveName).trim(),
            currentPp,
            maxPp,
        }
    })
}

const isMoveListEqual = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (String(left[index] || '') !== String(right[index] || '')) return false
    }
    return true
}

const isPpStateEqual = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        const l = left[index] || {}
        const r = right[index] || {}
        if (normalizeMoveName(l.moveName) !== normalizeMoveName(r.moveName)) return false
        if (Number(l.currentPp) !== Number(r.currentPp)) return false
        if (Number(l.maxPp) !== Number(r.maxPp)) return false
    }
    return true
}

export const syncUserPokemonMovesAndPp = async (userPokemon) => {
    if (!userPokemon) {
        return {
            moves: [],
            movePpState: [],
            changed: false,
        }
    }

    const nextMoves = mergeKnownMovesWithFallback(userPokemon.moves)
    const moveLookupMap = await buildMoveLookupByName(nextMoves)
    const nextMovePpState = buildMovePpStateFromMoves({
        moveNames: nextMoves,
        movePpState: userPokemon.movePpState,
        moveLookupMap,
    })

    const currentMoves = Array.isArray(userPokemon.moves)
        ? userPokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
        : []
    const currentMovePpState = Array.isArray(userPokemon.movePpState)
        ? userPokemon.movePpState
        : []

    const changed = !isMoveListEqual(currentMoves, nextMoves) || !isPpStateEqual(currentMovePpState, nextMovePpState)

    userPokemon.moves = nextMoves
    userPokemon.movePpState = nextMovePpState

    return {
        moves: nextMoves,
        movePpState: nextMovePpState,
        changed,
    }
}
