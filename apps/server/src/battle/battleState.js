const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const SUPPORTED_STAT_STAGE_KEYS = new Set(['atk', 'def', 'spatk', 'spdef', 'spd', 'acc', 'eva'])

const STATUS_ALIASES = {
    burn: 'burn',
    burned: 'burn',
    poison: 'poison',
    poisoned: 'poison',
    toxic: 'poison',
    paralysis: 'paralyze',
    paralyzed: 'paralyze',
    paralyze: 'paralyze',
    freeze: 'freeze',
    frozen: 'freeze',
    sleep: 'sleep',
    asleep: 'sleep',
    confuse: 'confuse',
    confusion: 'confuse',
    flinch: 'flinch',
}

const DEFAULT_STATUS_TURN_RANGES = {
    sleep: [1, 3],
    freeze: [2, 4],
    confuse: [2, 4],
    flinch: [1, 1],
}

const clampGuardMultiplier = (value = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 1
    return Math.max(0, Math.min(1, parsed))
}

const normalizeDamageGuardEntry = (value = null) => {
    if (!value || typeof value !== 'object') return null
    const turns = normalizeStatusTurns(value.turns)
    if (turns <= 0) return null
    return {
        multiplier: clampGuardMultiplier(value.multiplier),
        turns,
    }
}

export const clampFraction = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(1, parsed))
}

const normalizeWeather = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['sun', 'rain', 'sandstorm', 'hail'].includes(normalized)) return normalized
    return ''
}

const normalizeTerrain = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['electric', 'grassy', 'misty', 'psychic'].includes(normalized)) return normalized
    return ''
}

const pickStatusTurnCount = (status = '', random = Math.random) => {
    const normalizedStatus = normalizeBattleStatus(status)
    const range = DEFAULT_STATUS_TURN_RANGES[normalizedStatus]
    if (!range) return 0
    const minTurns = Math.max(1, Math.floor(Number(range[0]) || 1))
    const maxTurns = Math.max(minTurns, Math.floor(Number(range[1]) || minTurns))
    return minTurns + Math.floor(random() * (maxTurns - minTurns + 1))
}

const clampStatStage = (value) => clamp(Math.floor(Number(value) || 0), -6, 6)

const resolveStatStageMultiplier = (stage = 0) => {
    const normalizedStage = clampStatStage(stage)
    if (normalizedStage >= 0) {
        return (2 + normalizedStage) / 2
    }
    return 2 / (2 - normalizedStage)
}

export const normalizeBattleStatus = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return STATUS_ALIASES[normalized] || ''
}

export const normalizeStatusTurns = (value = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
}

export const normalizeDamageGuards = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const physical = normalizeDamageGuardEntry(source.physical)
    const special = normalizeDamageGuardEntry(source.special)
    return {
        ...(physical ? { physical } : {}),
        ...(special ? { special } : {}),
    }
}

export const mergeDamageGuards = (base = {}, patch = {}) => {
    const current = normalizeDamageGuards(base)
    const nextPatch = normalizeDamageGuards(patch)
    return {
        ...current,
        ...nextPatch,
    }
}

export const decrementDamageGuards = (value = {}) => {
    const current = normalizeDamageGuards(value)
    const next = {}

    if (current.physical && current.physical.turns > 1) {
        next.physical = {
            ...current.physical,
            turns: current.physical.turns - 1,
        }
    }
    if (current.special && current.special.turns > 1) {
        next.special = {
            ...current.special,
            turns: current.special.turns - 1,
        }
    }

    return next
}

export const applyDamageGuardsToDamage = (damage = 0, category = 'physical', guards = {}) => {
    const baseDamage = Math.max(0, Math.floor(Number(damage) || 0))
    if (baseDamage <= 0) return 0
    const normalizedCategory = String(category || '').trim().toLowerCase()
    if (normalizedCategory !== 'physical' && normalizedCategory !== 'special') return baseDamage

    const normalizedGuards = normalizeDamageGuards(guards)
    const guard = normalizedGuards[normalizedCategory]
    if (!guard || guard.turns <= 0) return baseDamage
    return Math.max(0, Math.floor(baseDamage * clampGuardMultiplier(guard.multiplier)))
}

export const normalizeVolatileState = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const rechargeTurns = normalizeStatusTurns(source.rechargeTurns)
    const bindTurns = normalizeStatusTurns(source.bindTurns)
    const bindFraction = clampFraction(source.bindFraction, 1 / 16)
    const lockedRepeatMoveName = String(source.lockedRepeatMoveName || '').trim()
    const statusShieldTurns = normalizeStatusTurns(source.statusShieldTurns)
    const statDropShieldTurns = normalizeStatusTurns(source.statDropShieldTurns)
    const healBlockTurns = normalizeStatusTurns(source.healBlockTurns)
    const critBlockTurns = normalizeStatusTurns(source.critBlockTurns)
    const statusMoveBlockTurns = normalizeStatusTurns(source.statusMoveBlockTurns)
    const pendingAlwaysCrit = Boolean(source.pendingAlwaysCrit)
    const pendingNeverMiss = Boolean(source.pendingNeverMiss)

    return {
        ...(rechargeTurns > 0 ? { rechargeTurns } : {}),
        ...(bindTurns > 0 ? { bindTurns } : {}),
        ...(bindTurns > 0 ? { bindFraction } : {}),
        ...(lockedRepeatMoveName ? { lockedRepeatMoveName } : {}),
        ...(statusShieldTurns > 0 ? { statusShieldTurns } : {}),
        ...(statDropShieldTurns > 0 ? { statDropShieldTurns } : {}),
        ...(healBlockTurns > 0 ? { healBlockTurns } : {}),
        ...(critBlockTurns > 0 ? { critBlockTurns } : {}),
        ...(statusMoveBlockTurns > 0 ? { statusMoveBlockTurns } : {}),
        ...(pendingAlwaysCrit ? { pendingAlwaysCrit: true } : {}),
        ...(pendingNeverMiss ? { pendingNeverMiss: true } : {}),
    }
}

export const normalizeFieldState = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const weather = normalizeWeather(source.weather)
    const terrain = normalizeTerrain(source.terrain)
    const weatherTurns = weather ? normalizeStatusTurns(source.weatherTurns) : 0
    const terrainTurns = terrain ? normalizeStatusTurns(source.terrainTurns) : 0
    const normalMovesBecomeElectricTurns = normalizeStatusTurns(source.normalMovesBecomeElectricTurns)

    return {
        ...(weather && weatherTurns > 0 ? { weather, weatherTurns } : {}),
        ...(terrain && terrainTurns > 0 ? { terrain, terrainTurns } : {}),
        ...(normalMovesBecomeElectricTurns > 0 ? { normalMovesBecomeElectricTurns } : {}),
    }
}

export const mergeFieldState = (base = {}, patch = {}) => {
    const current = normalizeFieldState(base)
    const next = patch && typeof patch === 'object' ? patch : {}

    if (next.clearTerrain) {
        const withoutTerrain = { ...current }
        delete withoutTerrain.terrain
        delete withoutTerrain.terrainTurns
        return normalizeFieldState(withoutTerrain)
    }

    const merged = { ...current }

    const patchWeather = normalizeWeather(next.weather)
    if (patchWeather) {
        merged.weather = patchWeather
        merged.weatherTurns = Math.max(1, normalizeStatusTurns(next.weatherTurns) || 5)
    }

    const patchTerrain = normalizeTerrain(next.terrain)
    if (patchTerrain) {
        merged.terrain = patchTerrain
        merged.terrainTurns = Math.max(1, normalizeStatusTurns(next.terrainTurns) || 5)
    }

    if (normalizeStatusTurns(next.normalMovesBecomeElectricTurns) > 0) {
        merged.normalMovesBecomeElectricTurns = Math.max(1, normalizeStatusTurns(next.normalMovesBecomeElectricTurns))
    }

    return normalizeFieldState(merged)
}

export const decrementFieldState = (value = {}) => {
    const current = normalizeFieldState(value)
    const next = { ...current }

    if (next.weather) {
        const turns = normalizeStatusTurns(next.weatherTurns)
        if (turns > 1) {
            next.weatherTurns = turns - 1
        } else {
            delete next.weather
            delete next.weatherTurns
        }
    }

    if (next.terrain) {
        const turns = normalizeStatusTurns(next.terrainTurns)
        if (turns > 1) {
            next.terrainTurns = turns - 1
        } else {
            delete next.terrain
            delete next.terrainTurns
        }
    }

    if (next.normalMovesBecomeElectricTurns) {
        const turns = normalizeStatusTurns(next.normalMovesBecomeElectricTurns)
        if (turns > 1) {
            next.normalMovesBecomeElectricTurns = turns - 1
        } else {
            delete next.normalMovesBecomeElectricTurns
        }
    }

    return normalizeFieldState(next)
}

export const mergeVolatileState = (base = {}, patch = {}) => {
    const current = normalizeVolatileState(base)
    const nextPatch = normalizeVolatileState(patch)

    const merged = {
        ...current,
        ...nextPatch,
    }

    if (!merged.bindTurns || merged.bindTurns <= 0) {
        delete merged.bindTurns
        delete merged.bindFraction
    }

    return normalizeVolatileState(merged)
}

export const applyStatusPatch = ({
    currentStatus = '',
    currentTurns = 0,
    nextStatus = '',
    nextTurns = null,
    random = Math.random,
} = {}) => {
    const normalizedNextStatus = normalizeBattleStatus(nextStatus)
    if (!normalizedNextStatus) {
        return {
            status: normalizeBattleStatus(currentStatus),
            statusTurns: normalizeStatusTurns(currentTurns),
        }
    }

    const explicitTurns = normalizeStatusTurns(nextTurns)
    return {
        status: normalizedNextStatus,
        statusTurns: explicitTurns > 0 ? explicitTurns : pickStatusTurnCount(normalizedNextStatus, random),
    }
}

export const normalizeStatStages = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return Object.entries(source).reduce((acc, [rawKey, rawValue]) => {
        const key = String(rawKey || '').trim().toLowerCase()
        if (!SUPPORTED_STAT_STAGE_KEYS.has(key)) return acc
        const stage = clampStatStage(rawValue)
        if (stage === 0) return acc
        return {
            ...acc,
            [key]: stage,
        }
    }, {})
}

export const combineStatStageDeltas = (base = {}, nextValue = {}) => {
    const current = normalizeStatStages(base)
    const delta = normalizeStatStages(nextValue)
    const merged = { ...current }

    Object.entries(delta).forEach(([key, value]) => {
        merged[key] = clampStatStage((merged[key] || 0) + value)
    })

    return normalizeStatStages(merged)
}

export const applyAbsoluteStatStages = (base = {}, absoluteValues = {}) => {
    const current = normalizeStatStages(base)
    const absolute = normalizeStatStages(absoluteValues)
    return {
        ...current,
        ...absolute,
    }
}

export const filterNegativeStatStageDeltas = (delta = {}, shieldTurns = 0) => {
    const normalizedDelta = normalizeStatStages(delta)
    if (normalizeStatusTurns(shieldTurns) <= 0) return normalizedDelta
    return Object.entries(normalizedDelta).reduce((acc, [key, value]) => {
        if (Number(value) < 0) return acc
        return {
            ...acc,
            [key]: value,
        }
    }, {})
}

export const decrementVolatileTurnState = (value = {}) => {
    const current = normalizeVolatileState(value)
    const next = { ...current }

    if (next.statusShieldTurns > 0) {
        next.statusShieldTurns -= 1
        if (next.statusShieldTurns <= 0) {
            delete next.statusShieldTurns
        }
    }

    if (next.statDropShieldTurns > 0) {
        next.statDropShieldTurns -= 1
        if (next.statDropShieldTurns <= 0) {
            delete next.statDropShieldTurns
        }
    }

    if (next.healBlockTurns > 0) {
        next.healBlockTurns -= 1
        if (next.healBlockTurns <= 0) {
            delete next.healBlockTurns
        }
    }

    if (next.critBlockTurns > 0) {
        next.critBlockTurns -= 1
        if (next.critBlockTurns <= 0) {
            delete next.critBlockTurns
        }
    }

    return normalizeVolatileState(next)
}

export const applyStatStageToValue = (value, stage = 0) => {
    const numericValue = Math.max(1, Number(value) || 1)
    const multiplier = resolveStatStageMultiplier(stage)
    return Math.max(1, Math.floor(numericValue * multiplier))
}

export const resolveBattleTurnOrder = ({
    playerPriority = 0,
    opponentPriority = 0,
    playerSpeed = 1,
    opponentSpeed = 1,
    random = Math.random,
} = {}) => {
    const normalizedPlayerPriority = clamp(Math.floor(Number(playerPriority) || 0), -7, 7)
    const normalizedOpponentPriority = clamp(Math.floor(Number(opponentPriority) || 0), -7, 7)
    const normalizedPlayerSpeed = Math.max(1, Math.floor(Number(playerSpeed) || 1))
    const normalizedOpponentSpeed = Math.max(1, Math.floor(Number(opponentSpeed) || 1))

    if (normalizedPlayerPriority !== normalizedOpponentPriority) {
        return {
            playerActsFirst: normalizedPlayerPriority > normalizedOpponentPriority,
            reason: 'priority',
            playerPriority: normalizedPlayerPriority,
            opponentPriority: normalizedOpponentPriority,
            playerSpeed: normalizedPlayerSpeed,
            opponentSpeed: normalizedOpponentSpeed,
        }
    }

    if (normalizedPlayerSpeed !== normalizedOpponentSpeed) {
        return {
            playerActsFirst: normalizedPlayerSpeed > normalizedOpponentSpeed,
            reason: 'speed',
            playerPriority: normalizedPlayerPriority,
            opponentPriority: normalizedOpponentPriority,
            playerSpeed: normalizedPlayerSpeed,
            opponentSpeed: normalizedOpponentSpeed,
        }
    }

    return {
        playerActsFirst: random() < 0.5,
        reason: 'speed-tie',
        playerPriority: normalizedPlayerPriority,
        opponentPriority: normalizedOpponentPriority,
        playerSpeed: normalizedPlayerSpeed,
        opponentSpeed: normalizedOpponentSpeed,
    }
}

export const resolveActionAvailabilityByStatus = ({ status = '', statusTurns = 0, random = Math.random } = {}) => {
    const normalizedStatus = normalizeBattleStatus(status)
    const normalizedTurns = normalizeStatusTurns(statusTurns)
    if (!normalizedStatus) {
        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
        }
    }

    if (normalizedStatus === 'flinch') {
        return {
            canAct: false,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'flinch',
            log: 'Bị choáng nên không thể hành động.',
        }
    }

    if (normalizedStatus === 'paralyze') {
        if (random() < 0.25) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: 0,
                reason: 'paralyze',
                log: 'Bị tê liệt nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: normalizedStatus,
            statusTurnsAfterCheck: 0,
        }
    }

    if (normalizedStatus === 'sleep') {
        if (normalizedTurns > 1) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: normalizedTurns - 1,
                reason: 'sleep',
                log: 'Đang ngủ nên không thể hành động.',
            }
        }

        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'wakeup',
            log: 'Đã tỉnh giấc.',
        }
    }

    if (normalizedStatus === 'freeze') {
        if (normalizedTurns > 1 && random() >= 0.2) {
            return {
                canAct: false,
                statusAfterCheck: normalizedStatus,
                statusTurnsAfterCheck: normalizedTurns - 1,
                reason: 'freeze',
                log: 'Bị đóng băng nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: '',
            statusTurnsAfterCheck: 0,
            reason: 'thaw',
            log: 'Đã tan băng.',
        }
    }

    if (normalizedStatus === 'confuse') {
        const nextTurns = normalizedTurns > 0 ? normalizedTurns - 1 : 0
        if (random() < 0.33) {
            return {
                canAct: false,
                statusAfterCheck: nextTurns > 0 ? normalizedStatus : '',
                statusTurnsAfterCheck: nextTurns,
                reason: 'confuse',
                log: 'Bị rối loạn nên không thể hành động.',
            }
        }
        return {
            canAct: true,
            statusAfterCheck: nextTurns > 0 ? normalizedStatus : '',
            statusTurnsAfterCheck: nextTurns,
            reason: nextTurns <= 0 ? 'confuse_end' : '',
            log: nextTurns <= 0 ? 'Không còn rối loạn nữa.' : '',
        }
    }

    return {
        canAct: true,
        statusAfterCheck: normalizedStatus,
        statusTurnsAfterCheck: normalizedTurns,
    }
}

export const calcResidualStatusDamage = ({ status = '', maxHp = 1 } = {}) => {
    const normalizedStatus = normalizeBattleStatus(status)
    if (normalizedStatus !== 'burn' && normalizedStatus !== 'poison') return 0
    const resolvedMaxHp = Math.max(1, Number(maxHp) || 1)
    return Math.max(1, Math.floor(resolvedMaxHp / 16))
}
