import { normalizeTypeToken } from './typeSystem.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const resolveMoveCategory = (moveDoc, fallbackMove, resolvedPower) => {
    const category = normalizeTypeToken(moveDoc?.category || fallbackMove?.category)
    if (category === 'physical' || category === 'special' || category === 'status') {
        return category
    }
    return resolvedPower > 0 ? 'physical' : 'status'
}

export const resolveMoveAccuracy = (moveDoc, fallbackMove) => {
    let accuracy = Number(moveDoc?.accuracy)
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
        accuracy = Number(fallbackMove?.accuracy)
    }
    if (!Number.isFinite(accuracy) || accuracy <= 0) {
        return 100
    }
    return clamp(Math.floor(accuracy), 1, 100)
}

export const resolveMovePriority = (moveDoc, fallbackMove) => {
    let priority = Number(moveDoc?.priority)
    if (!Number.isFinite(priority)) {
        priority = Number(fallbackMove?.priority)
    }
    if (!Number.isFinite(priority)) {
        return 0
    }
    return clamp(Math.floor(priority), -7, 7)
}

export const resolveMoveCriticalChance = (moveDoc, fallbackMove) => {
    const fromEffects = Number(moveDoc?.effects?.criticalChance ?? fallbackMove?.effects?.criticalChance)
    if (Number.isFinite(fromEffects)) {
        if (fromEffects > 1) {
            return Math.min(1, Math.max(0, fromEffects / 100))
        }
        return Math.min(1, Math.max(0, fromEffects))
    }

    const description = String(moveDoc?.description || fallbackMove?.description || '').toLowerCase()
    if (description.includes('always results in a critical hit') || description.includes('always critical')) {
        return 1
    }
    if (description.includes('high critical hit ratio')) {
        return 0.125
    }
    return 0.0625
}
