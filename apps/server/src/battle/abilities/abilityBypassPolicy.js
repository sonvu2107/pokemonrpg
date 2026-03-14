const normalizeHookKey = (value = '') => String(value || '').trim().toLowerCase()

const DEFAULT_BYPASS_POLICY = Object.freeze({
    moveIgnore: false,
    attackerBypass: false,
})

export const ABILITY_BYPASS_POLICY_MATRIX = Object.freeze({
    hit_defense: Object.freeze({ moveIgnore: true, attackerBypass: true }),
    status_guard: Object.freeze({ moveIgnore: true, attackerBypass: true }),
    type_immunity: Object.freeze({ moveIgnore: true, attackerBypass: true }),
    speed_modifier: Object.freeze({ moveIgnore: false, attackerBypass: false }),
    switch_in_reaction: Object.freeze({ moveIgnore: false, attackerBypass: false }),
    end_turn_passive: Object.freeze({ moveIgnore: false, attackerBypass: false }),
})

export const getAbilityBypassPolicy = (hookKey = '') => {
    const normalized = normalizeHookKey(hookKey)
    if (!normalized) return DEFAULT_BYPASS_POLICY
    return ABILITY_BYPASS_POLICY_MATRIX[normalized] || DEFAULT_BYPASS_POLICY
}

export const resolveAbilityBypassDecision = ({
    hookKey = '',
    ignoreTargetAbilityFromMove = false,
    ignoreTargetAbilityFromAttackerAbility = false,
} = {}) => {
    const policy = getAbilityBypassPolicy(hookKey)
    const moveBypass = Boolean(policy.moveIgnore) && Boolean(ignoreTargetAbilityFromMove)
    const attackerBypass = Boolean(policy.attackerBypass) && Boolean(ignoreTargetAbilityFromAttackerAbility)
    const shouldBypass = moveBypass || attackerBypass

    const source = moveBypass && attackerBypass
        ? 'move_and_attacker_ability'
        : (moveBypass ? 'move' : (attackerBypass ? 'attacker_ability' : null))

    return {
        hookKey: normalizeHookKey(hookKey),
        policy,
        shouldBypass,
        source,
        moveBypass,
        attackerBypass,
    }
}

export const shouldBypassDefensiveAbilityHook = (options = {}) => (
    resolveAbilityBypassDecision(options).shouldBypass
)
