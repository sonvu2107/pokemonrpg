import {
    combineStatStageDeltas,
    mergeDamageGuards,
    mergeVolatileState,
    normalizeStatusTurns,
} from './battleState.js'

const normalizeMoveName = (value) => String(value || '').trim().toLowerCase()

export const normalizeEffectSpecs = (value) => (Array.isArray(value) ? value : [])

export const effectSpecsByTrigger = (effectSpecs = [], trigger = '') => {
    const normalizedTrigger = String(trigger || '').trim()
    return normalizeEffectSpecs(effectSpecs)
        .filter((entry) => String(entry?.trigger || '').trim() === normalizedTrigger)
}

const normalizeMovePpEntry = (entry = {}) => {
    const moveName = String(entry?.moveName || entry?.name || '').trim()
    if (!moveName) return null
    const maxPp = Math.max(1, Math.floor(Number(entry?.maxPp) || 1))
    const currentPp = Math.max(0, Math.min(maxPp, Math.floor(Number(entry?.currentPp ?? entry?.pp) || 0)))
    return {
        moveName,
        currentPp,
        maxPp,
    }
}

export const mergeMovePpStateEntries = (base = [], patches = []) => {
    const merged = []
    const indexByKey = new Map()
    const pushOrReplace = (entry) => {
        const normalized = normalizeMovePpEntry(entry)
        if (!normalized) return
        const key = normalizeMoveName(normalized.moveName)
        if (!key) return
        if (indexByKey.has(key)) {
            merged[indexByKey.get(key)] = normalized
            return
        }
        indexByKey.set(key, merged.length)
        merged.push(normalized)
    }

    ;(Array.isArray(base) ? base : []).forEach(pushOrReplace)
    ;(Array.isArray(patches) ? patches : []).forEach(pushOrReplace)
    return merged
}

export const isMovePpStateEqual = (left = [], right = []) => {
    const normalizedLeft = mergeMovePpStateEntries([], left)
    const normalizedRight = mergeMovePpStateEntries([], right)
    if (normalizedLeft.length !== normalizedRight.length) return false
    for (let index = 0; index < normalizedLeft.length; index += 1) {
        const l = normalizedLeft[index]
        const r = normalizedRight[index]
        if (normalizeMoveName(l.moveName) !== normalizeMoveName(r.moveName)) return false
        if (Number(l.currentPp) !== Number(r.currentPp)) return false
        if (Number(l.maxPp) !== Number(r.maxPp)) return false
    }
    return true
}

export const mergeEffectStatePatches = (base = {}, nextPatch = {}) => ({
    ...base,
    ...nextPatch,
    powerMultiplier: Number.isFinite(Number(nextPatch?.powerMultiplier))
        ? Math.max(0.1, Number(nextPatch.powerMultiplier))
        : (Number.isFinite(Number(base?.powerMultiplier)) ? Math.max(0.1, Number(base.powerMultiplier)) : 1),
    statusTurns: Number.isFinite(Number(nextPatch?.statusTurns))
        ? normalizeStatusTurns(nextPatch.statusTurns)
        : normalizeStatusTurns(base?.statusTurns),
    damageGuards: mergeDamageGuards(base?.damageGuards, nextPatch?.damageGuards),
    volatileState: mergeVolatileState(base?.volatileState, nextPatch?.volatileState),
    statStages: combineStatStageDeltas(base?.statStages, nextPatch?.statStages),
    setStatStages: {
        ...(base?.setStatStages && typeof base.setStatStages === 'object' ? base.setStatStages : {}),
        ...(nextPatch?.setStatStages && typeof nextPatch.setStatStages === 'object' ? nextPatch.setStatStages : {}),
    },
})

export const mergeEffectAggregate = (base, nextAggregate) => {
    if (!nextAggregate) return base
    return {
        appliedEffects: [...(base?.appliedEffects || []), ...(nextAggregate?.appliedEffects || [])],
        logs: [...(base?.logs || []), ...(nextAggregate?.logs || [])],
        statePatches: {
            self: mergeEffectStatePatches(base?.statePatches?.self, nextAggregate?.statePatches?.self),
            opponent: mergeEffectStatePatches(base?.statePatches?.opponent, nextAggregate?.statePatches?.opponent),
            field: {
                ...(base?.statePatches?.field && typeof base.statePatches.field === 'object' ? base.statePatches.field : {}),
                ...(nextAggregate?.statePatches?.field && typeof nextAggregate.statePatches.field === 'object' ? nextAggregate.statePatches.field : {}),
            },
        },
    }
}

export const createEmptyEffectAggregate = () => ({
    appliedEffects: [],
    logs: [],
    statePatches: {
        self: {},
        opponent: {},
        field: {},
    },
})
