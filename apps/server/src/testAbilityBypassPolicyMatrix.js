import assert from 'assert'
import {
    getAbilityBypassPolicy,
    resolveAbilityBypassDecision,
    shouldBypassDefensiveAbilityHook,
} from './battle/abilities/abilityBypassPolicy.js'

const testHitDefensePolicyAllowsBothSources = () => {
    const policy = getAbilityBypassPolicy('hit_defense')
    assert.strictEqual(policy.moveIgnore, true)
    assert.strictEqual(policy.attackerBypass, true)

    const moveDecision = resolveAbilityBypassDecision({
        hookKey: 'hit_defense',
        ignoreTargetAbilityFromMove: true,
        ignoreTargetAbilityFromAttackerAbility: false,
    })
    assert.strictEqual(moveDecision.shouldBypass, true)
    assert.strictEqual(moveDecision.source, 'move')

    const attackerDecision = resolveAbilityBypassDecision({
        hookKey: 'hit_defense',
        ignoreTargetAbilityFromMove: false,
        ignoreTargetAbilityFromAttackerAbility: true,
    })
    assert.strictEqual(attackerDecision.shouldBypass, true)
    assert.strictEqual(attackerDecision.source, 'attacker_ability')
}

const testStatusGuardPolicyAllowsBothSources = () => {
    const decision = resolveAbilityBypassDecision({
        hookKey: 'status_guard',
        ignoreTargetAbilityFromMove: true,
        ignoreTargetAbilityFromAttackerAbility: true,
    })
    assert.strictEqual(decision.shouldBypass, true)
    assert.strictEqual(decision.source, 'move_and_attacker_ability')
}

const testNonDefensiveHookDoesNotBypass = () => {
    const speedPolicy = getAbilityBypassPolicy('speed_modifier')
    assert.strictEqual(speedPolicy.moveIgnore, false)
    assert.strictEqual(speedPolicy.attackerBypass, false)

    const decision = resolveAbilityBypassDecision({
        hookKey: 'speed_modifier',
        ignoreTargetAbilityFromMove: true,
        ignoreTargetAbilityFromAttackerAbility: true,
    })
    assert.strictEqual(decision.shouldBypass, false)
    assert.strictEqual(
        shouldBypassDefensiveAbilityHook({
            hookKey: 'speed_modifier',
            ignoreTargetAbilityFromMove: true,
            ignoreTargetAbilityFromAttackerAbility: true,
        }),
        false,
    )
}

const testUnknownHookUsesSafeDefault = () => {
    const policy = getAbilityBypassPolicy('unknown_hook')
    assert.strictEqual(policy.moveIgnore, false)
    assert.strictEqual(policy.attackerBypass, false)
}

const main = () => {
    testHitDefensePolicyAllowsBothSources()
    testStatusGuardPolicyAllowsBothSources()
    testNonDefensiveHookDoesNotBypass()
    testUnknownHookUsesSafeDefault()
    console.log('Ability bypass policy matrix tests passed')
}

main()
