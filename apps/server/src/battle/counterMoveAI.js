import { estimateBattleDamage } from './battleCalc.js'
import { normalizeFieldState } from './battleState.js'
import {
    inferMoveType,
    normalizePokemonTypes,
    normalizeTypeToken,
    resolveTypeEffectiveness,
} from './typeSystem.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const normalizeMoveName = (value) => String(value || '').trim().toLowerCase()

export const normalizeCounterMoveEntry = (entry = null, fallbackIndex = -1) => {
    if (!entry || typeof entry !== 'object') return null

    const name = String(entry?.name || entry?.moveName || '').trim()
    if (!name) return null

    const normalizedName = normalizeMoveName(name)
    const fallbackPower = normalizedName === 'struggle' ? 35 : 0
    const powerRaw = Number(entry?.power)
    const resolvedPower = Number.isFinite(powerRaw) && powerRaw > 0
        ? Math.floor(powerRaw)
        : fallbackPower

    const categoryRaw = normalizeTypeToken(entry?.category)
    const resolvedCategory = categoryRaw === 'physical' || categoryRaw === 'special' || categoryRaw === 'status'
        ? categoryRaw
        : (resolvedPower > 0 ? 'physical' : 'status')

    const type = normalizeTypeToken(entry?.type || inferMoveType(name)) || 'normal'
    const priorityRaw = Number(entry?.priority)
    const priority = Number.isFinite(priorityRaw) ? clamp(Math.floor(priorityRaw), -7, 7) : 0
    const accuracyRaw = Number(entry?.accuracy)
    const accuracy = Number.isFinite(accuracyRaw) && accuracyRaw > 0
        ? clamp(Math.floor(accuracyRaw), 1, 100)
        : 100

    const maxPpRaw = Number(entry?.maxPp ?? entry?.pp)
    const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0
        ? Math.max(1, Math.floor(maxPpRaw))
        : (normalizedName === 'struggle' ? 99 : 10)
    const currentPpRaw = Number(entry?.currentPp ?? entry?.pp)
    const currentPp = Number.isFinite(currentPpRaw)
        ? clamp(Math.floor(currentPpRaw), 0, maxPp)
        : maxPp

    return {
        ...entry,
        __index: Number.isInteger(entry?.__index) ? entry.__index : fallbackIndex,
        name,
        type,
        power: resolvedPower,
        category: resolvedCategory,
        accuracy,
        priority,
        maxPp,
        currentPp,
    }
}

const selectWeightedRandomCandidate = (candidates = [], scoreSelector = null) => {
    const normalizedCandidates = Array.isArray(candidates) ? candidates : []
    if (normalizedCandidates.length === 0) return null
    if (normalizedCandidates.length === 1) return normalizedCandidates[0]

    const weighted = normalizedCandidates.map((candidate) => {
        const scoreRaw = typeof scoreSelector === 'function' ? Number(scoreSelector(candidate)) : 1
        const weight = Number.isFinite(scoreRaw) && scoreRaw > 0 ? scoreRaw : 1
        return { candidate, weight }
    })

    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0)
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return weighted[Math.floor(Math.random() * weighted.length)]?.candidate || weighted[0]?.candidate || null
    }

    let randomRoll = Math.random() * totalWeight
    for (const entry of weighted) {
        if (randomRoll <= entry.weight) {
            return entry.candidate
        }
        randomRoll -= entry.weight
    }

    return weighted[weighted.length - 1]?.candidate || weighted[0]?.candidate || null
}

export const resolveCounterMoveSelection = ({
    moves = [],
    mode = 'ordered',
    cursor = 0,
    defenderTypes = [],
    attackerTypes = [],
    fieldState = {},
    defenderCurrentHp = 0,
    defenderMaxHp = 1,
    attackerCurrentHp = 0,
    attackerMaxHp = 1,
    attackerLevel = 1,
    attackerAttackStat = 1,
    attackerSpecialAttackStat = 1,
    defenderDefenseStat = 1,
    defenderSpecialDefenseStat = 1,
} = {}) => {
    const normalizedMoves = (Array.isArray(moves) ? moves : [])
        .map((entry, index) => normalizeCounterMoveEntry({ ...(entry || {}), __index: index }, index))
        .filter(Boolean)

    const fallbackMove = {
        __index: -1,
        name: 'Struggle',
        type: 'normal',
        power: 35,
        category: 'physical',
        accuracy: 100,
        priority: 0,
        maxPp: 99,
        currentPp: 99,
    }

    if (normalizedMoves.length === 0) {
        return {
            selectedMove: fallbackMove,
            selectedIndex: -1,
            nextCursor: 0,
            normalizedMoves,
        }
    }

    const normalizedFieldState = normalizeFieldState(fieldState)
    const hasActiveTerrain = Boolean(normalizedFieldState?.terrain)
    const usableMoves = normalizedMoves
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => {
            const key = normalizeMoveName(entry?.name)
            if (key === 'struggle') return true
            if (Boolean(entry?.requiresTerrain) && !hasActiveTerrain) return false
            return Number(entry?.currentPp) > 0
        })

    if (usableMoves.length === 0) {
        return {
            selectedMove: fallbackMove,
            selectedIndex: -1,
            nextCursor: Number.isFinite(Number(cursor)) ? Math.max(0, Math.floor(Number(cursor))) : 0,
            normalizedMoves,
        }
    }

    const normalizedMode = String(mode || '').trim().toLowerCase()
    const resolvedCursorBase = Number.isFinite(Number(cursor)) ? Math.max(0, Math.floor(Number(cursor))) : 0
    const resolvedCursor = normalizedMoves.length > 0 ? (resolvedCursorBase % normalizedMoves.length) : 0
    const normalizedAttackerTypes = normalizePokemonTypes(attackerTypes)
    const normalizedDefenderCurrentHp = Math.max(0, Number(defenderCurrentHp) || 0)
    const normalizedDefenderMaxHp = Math.max(1, Number(defenderMaxHp) || 1)
    const normalizedAttackerCurrentHp = Math.max(0, Number(attackerCurrentHp) || 0)
    const normalizedAttackerMaxHp = Math.max(1, Number(attackerMaxHp) || 1)
    const normalizedAttackerHpRatio = normalizedAttackerCurrentHp / normalizedAttackerMaxHp
    const normalizedDefenderHpRatio = normalizedDefenderCurrentHp / normalizedDefenderMaxHp

    if (normalizedMode === 'smart-random' || normalizedMode === 'smart_random' || normalizedMode === 'smartrandom') {
        const scoredChoices = usableMoves.map((candidate) => {
            const move = candidate.entry
            const normalizedName = normalizeMoveName(move?.name)
            const effectiveness = resolveTypeEffectiveness(move?.type || 'normal', defenderTypes).multiplier
            const isOffensiveMove = move?.category !== 'status'
            const isSameTypeMove = normalizedAttackerTypes.includes(normalizeTypeToken(move?.type || 'normal'))
            const powerBase = move?.category === 'status'
                ? 12
                : Math.max(1, Number(move?.power) || (normalizedName === 'struggle' ? 35 : 30))
            const accuracyFactor = Math.max(0.35, Math.min(1, (Number(move?.accuracy) || 100) / 100))
            const effectivenessFactor = (!isOffensiveMove)
                ? 1
                : (effectiveness <= 0 ? 0.05 : Math.max(0.2, effectiveness))
            const sameTypeBonus = isSameTypeMove ? 1.2 : 1
            const priorityBonus = (Number(move?.priority) || 0) * 8
            const remainingPpBonus = Math.min(4, Number(move?.currentPp) || 0)
            const offensiveAttackStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(attackerSpecialAttackStat) || 1)
                    : Math.max(1, Number(attackerAttackStat) || 1))
                : 1
            const defensiveStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(defenderSpecialDefenseStat) || 1)
                    : Math.max(1, Number(defenderDefenseStat) || 1))
                : 1
            const stabMultiplier = isSameTypeMove ? 1.5 : 1
            const estimatedDamage = (!isOffensiveMove || effectiveness <= 0)
                ? 0
                : estimateBattleDamage({
                    attackerLevel,
                    movePower: powerBase,
                    attackStat: offensiveAttackStat,
                    defenseStat: defensiveStat,
                    modifier: stabMultiplier * effectiveness,
                })
            const canFinish = isOffensiveMove && normalizedDefenderCurrentHp > 0 && estimatedDamage >= normalizedDefenderCurrentHp
            const lowTargetBonus = normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.35
                ? Math.min(42, estimatedDamage * 0.45)
                : 0
            const finisherBonus = canFinish ? 120 : 0
            const panicBonus = normalizedAttackerHpRatio <= 0.3
                ? (((Number(move?.priority) || 0) > 0 ? 24 : 0) + accuracyFactor * 8)
                : 0
            const statusPenaltyWhenNeedFinish = (!isOffensiveMove && normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.3)
                ? 28
                : 0
            const randomVariance = 0.9 + Math.random() * 0.25
            const score = Math.max(
                0.25,
                ((((powerBase * effectivenessFactor * accuracyFactor) * sameTypeBonus) + priorityBonus + remainingPpBonus + lowTargetBonus + finisherBonus + panicBonus - statusPenaltyWhenNeedFinish) * randomVariance)
            )

            return {
                ...candidate,
                score,
                effectiveness,
                isOffensiveMove,
                isSameTypeMove,
                canFinish,
                estimatedDamage,
            }
        })

        const finisherChoices = scoredChoices.filter((entry) => entry.canFinish)
        const sameTypeOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.isSameTypeMove && entry.effectiveness > 0)
        const effectiveOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.effectiveness > 1)
        const viableOffensive = scoredChoices.filter((entry) => entry.isOffensiveMove && entry.effectiveness > 0)
        const sameTypeAny = scoredChoices.filter((entry) => entry.isSameTypeMove && (entry.effectiveness > 0 || !entry.isOffensiveMove))
        const viableAny = scoredChoices.filter((entry) => entry.effectiveness > 0 || !entry.isOffensiveMove)

        let selectionPool = scoredChoices
        if (viableAny.length > 0) selectionPool = viableAny
        if (sameTypeAny.length > 0) selectionPool = sameTypeAny
        if (viableOffensive.length > 0) selectionPool = viableOffensive
        if (effectiveOffensive.length > 0) selectionPool = effectiveOffensive
        if (sameTypeOffensive.length > 0) selectionPool = sameTypeOffensive
        if (finisherChoices.length > 0) selectionPool = finisherChoices

        const selectedChoice = selectWeightedRandomCandidate(selectionPool, (entry) => entry.score) || selectionPool[0] || scoredChoices[0]

        return {
            selectedMove: selectedChoice.entry,
            selectedIndex: selectedChoice.index,
            nextCursor: normalizedMoves.length > 0 ? ((selectedChoice.index + 1) % normalizedMoves.length) : 0,
            normalizedMoves,
        }
    }

    if (normalizedMode === 'smart') {
        let bestChoice = usableMoves[0]
        let bestScore = Number.NEGATIVE_INFINITY

        for (const candidate of usableMoves) {
            const move = candidate.entry
            const normalizedName = normalizeMoveName(move?.name)
            const effectiveness = resolveTypeEffectiveness(move?.type || 'normal', defenderTypes).multiplier
            const isOffensiveMove = move?.category !== 'status'
            const isSameTypeMove = normalizedAttackerTypes.includes(normalizeTypeToken(move?.type || 'normal'))
            const powerBase = move?.category === 'status'
                ? 18
                : Math.max(1, Number(move?.power) || (normalizedName === 'struggle' ? 35 : 30))
            const accuracyFactor = Math.max(0.4, Math.min(1, (Number(move?.accuracy) || 100) / 100))
            const effectivenessFactor = (!isOffensiveMove)
                ? 1
                : (effectiveness <= 0 ? 0.05 : Math.max(0.2, effectiveness))
            const sameTypeBonus = isSameTypeMove ? 1.2 : 1
            const priorityBonus = (Number(move?.priority) || 0) * 10
            const remainingPpBonus = Math.min(6, Number(move?.currentPp) || 0)
            const offensiveAttackStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(attackerSpecialAttackStat) || 1)
                    : Math.max(1, Number(attackerAttackStat) || 1))
                : 1
            const defensiveStat = isOffensiveMove
                ? (move?.category === 'special'
                    ? Math.max(1, Number(defenderSpecialDefenseStat) || 1)
                    : Math.max(1, Number(defenderDefenseStat) || 1))
                : 1
            const stabMultiplier = isSameTypeMove ? 1.5 : 1
            const estimatedDamage = (!isOffensiveMove || effectiveness <= 0)
                ? 0
                : estimateBattleDamage({
                    attackerLevel,
                    movePower: powerBase,
                    attackStat: offensiveAttackStat,
                    defenseStat: defensiveStat,
                    modifier: stabMultiplier * effectiveness,
                })
            const finisherBonus = (isOffensiveMove && normalizedDefenderCurrentHp > 0 && estimatedDamage >= normalizedDefenderCurrentHp) ? 120 : 0
            const lowTargetBonus = normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.35
                ? Math.min(42, estimatedDamage * 0.45)
                : 0
            const panicBonus = normalizedAttackerHpRatio <= 0.3
                ? (((Number(move?.priority) || 0) > 0 ? 24 : 0) + accuracyFactor * 8)
                : 0
            const statusPenaltyWhenNeedFinish = (!isOffensiveMove && normalizedDefenderCurrentHp > 0 && normalizedDefenderHpRatio <= 0.3)
                ? 28
                : 0
            const score = ((powerBase * effectivenessFactor * accuracyFactor) * sameTypeBonus)
                + priorityBonus
                + remainingPpBonus
                + finisherBonus
                + lowTargetBonus
                + panicBonus
                - statusPenaltyWhenNeedFinish

            if (score > bestScore) {
                bestScore = score
                bestChoice = candidate
            }
        }

        return {
            selectedMove: bestChoice.entry,
            selectedIndex: bestChoice.index,
            nextCursor: normalizedMoves.length > 0 ? ((bestChoice.index + 1) % normalizedMoves.length) : 0,
            normalizedMoves,
        }
    }

    for (let step = 0; step < normalizedMoves.length; step += 1) {
        const index = (resolvedCursor + step) % normalizedMoves.length
        const candidate = normalizedMoves[index]
        if (!candidate) continue
        const normalizedName = normalizeMoveName(candidate.name)
        if (normalizedName !== 'struggle' && Number(candidate.currentPp) <= 0) {
            continue
        }
        return {
            selectedMove: candidate,
            selectedIndex: index,
            nextCursor: (index + 1) % normalizedMoves.length,
            normalizedMoves,
        }
    }

    return {
        selectedMove: fallbackMove,
        selectedIndex: -1,
        nextCursor: resolvedCursor,
        normalizedMoves,
    }
}

export const applyCounterMovePpConsumption = ({ moves = [], selectedIndex = -1, shouldConsume = false } = {}) => {
    const normalizedMoves = (Array.isArray(moves) ? moves : []).map((entry, index) => normalizeCounterMoveEntry(entry, index)).filter(Boolean)
    if (!shouldConsume || selectedIndex < 0 || selectedIndex >= normalizedMoves.length) {
        return normalizedMoves
    }

    return normalizedMoves.map((entry, index) => {
        if (index !== selectedIndex) return entry
        const normalizedName = normalizeMoveName(entry?.name)
        if (normalizedName === 'struggle') return entry
        return {
            ...entry,
            currentPp: Math.max(0, Number(entry.currentPp) - 1),
        }
    })
}
