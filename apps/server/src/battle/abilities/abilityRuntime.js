import { getAbilityHookHandler } from './abilityRegistry.js'

const normalizeAbilityId = (value = '') => String(value || '').trim().toLowerCase()
const normalizeHookName = (value = '') => String(value || '').trim()

const resolveContextAbility = (context = {}) => {
    const source = context && typeof context === 'object' ? context : {}
    return normalizeAbilityId(
        source.ability
        || source.userAbility
        || source.selfAbility
        || source.attackerAbility
    )
}

export const createEmptyAbilityHookResult = ({ hookName = '', abilityId = '' } = {}) => ({
    applied: false,
    hookName: normalizeHookName(hookName),
    abilityId: normalizeAbilityId(abilityId),
    logs: [],
    statePatches: {
        self: {},
        opponent: {},
        field: {},
    },
})

const normalizeHookResult = ({ result = null, hookName = '', abilityId = '' } = {}) => {
    if (!result || typeof result !== 'object') {
        return createEmptyAbilityHookResult({ hookName, abilityId })
    }
    const logs = Array.isArray(result.logs) ? result.logs.filter(Boolean).map((entry) => String(entry)) : []
    return {
        ...createEmptyAbilityHookResult({ hookName, abilityId }),
        ...result,
        applied: Boolean(result.applied),
        hookName: normalizeHookName(hookName),
        abilityId: normalizeAbilityId(abilityId),
        logs,
        statePatches: {
            self: result?.statePatches?.self && typeof result.statePatches.self === 'object' ? result.statePatches.self : {},
            opponent: result?.statePatches?.opponent && typeof result.statePatches.opponent === 'object' ? result.statePatches.opponent : {},
            field: result?.statePatches?.field && typeof result.statePatches.field === 'object' ? result.statePatches.field : {},
        },
    }
}

export const applyAbilityHook = (hookName = '', context = {}) => {
    const normalizedHookName = normalizeHookName(hookName)
    const normalizedContext = context && typeof context === 'object' ? context : {}
    const abilityId = resolveContextAbility(normalizedContext)

    if (!normalizedHookName || !abilityId) {
        return createEmptyAbilityHookResult({ hookName: normalizedHookName, abilityId })
    }

    const handler = getAbilityHookHandler({ abilityId, hookName: normalizedHookName })
    if (!handler) {
        return createEmptyAbilityHookResult({ hookName: normalizedHookName, abilityId })
    }

    const rawResult = handler(normalizedContext)
    return normalizeHookResult({
        result: rawResult,
        hookName: normalizedHookName,
        abilityId,
    })
}
