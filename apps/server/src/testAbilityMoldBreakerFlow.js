import assert from 'assert'
import { __battleEffectInternals } from './routes/game.js'

const {
    buildAbilityResolutionContext,
    hasMoldBreakerStyleBypass,
    resolveAbilityHitDefense,
    resolveAbilityStatusGuard,
    resolveAbilityMutations,
    resolveAbilitySuppressionMutations,
} = __battleEffectInternals

const testMoldBreakerBypassesDefensiveImmunity = () => {
    const context = buildAbilityResolutionContext({
        ignoreTargetAbilityFromAttackerAbility: hasMoldBreakerStyleBypass({ attackerAbility: 'mold_breaker' }),
    })
    const defense = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 100,
        defenderMaxHp: 100,
        resolutionContext: context,
    })
    assert.strictEqual(defense.preventDamage, false)
}

const testNoMoldBreakerKeepsDefensiveImmunity = () => {
    const context = buildAbilityResolutionContext({
        ignoreTargetAbilityFromAttackerAbility: hasMoldBreakerStyleBypass({ attackerAbility: 'intimidate' }),
    })
    const defense = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 100,
        defenderMaxHp: 100,
        resolutionContext: context,
    })
    assert.strictEqual(defense.preventDamage, true)
}

const testMoldBreakerBypassesStatusGuard = () => {
    const context = buildAbilityResolutionContext({
        ignoreTargetAbilityFromAttackerAbility: hasMoldBreakerStyleBypass({ attackerAbility: 'mold_breaker' }),
    })
    const guarded = resolveAbilityStatusGuard({
        ability: 'immunity',
        incomingStatus: 'poison',
        resolutionContext: context,
    })
    assert.strictEqual(guarded.preventStatus, false)
}

const testMoldBreakerWithSuppressedTargetStaysConsistent = () => {
    const context = buildAbilityResolutionContext({
        ignoreTargetAbilityFromAttackerAbility: hasMoldBreakerStyleBypass({ attackerAbility: 'mold_breaker' }),
    })
    const defense = resolveAbilityHitDefense({
        ability: 'water_absorb',
        incomingMoveType: 'water',
        incomingMoveCategory: 'special',
        didMoveHit: true,
        defenderCurrentHp: 60,
        defenderMaxHp: 100,
        resolutionContext: context,
        isSuppressed: true,
    })
    assert.strictEqual(defense.preventDamage, false)
}

const testMoveIgnoreAndMoldBreakerDoNotMutateState = () => {
    const context = buildAbilityResolutionContext({
        ignoreTargetAbilityFromMove: true,
        ignoreTargetAbilityFromAttackerAbility: hasMoldBreakerStyleBypass({ attackerAbility: 'mold_breaker' }),
    })
    assert.strictEqual(context.ignoreTargetAbility, true)
    assert.strictEqual(context.ignoreTargetAbilitySource, 'move_and_attacker_ability')

    const mutation = resolveAbilityMutations({
        selfAbility: 'mold_breaker',
        opponentAbility: 'levitate',
        selfPatches: {},
        opponentPatches: {},
    })
    assert.strictEqual(mutation.changed, false)

    const suppression = resolveAbilitySuppressionMutations({
        selfSuppressed: false,
        opponentSuppressed: false,
        selfPatches: {},
        opponentPatches: {},
    })
    assert.strictEqual(suppression.changed, false)
}

const main = () => {
    testMoldBreakerBypassesDefensiveImmunity()
    testNoMoldBreakerKeepsDefensiveImmunity()
    testMoldBreakerBypassesStatusGuard()
    testMoldBreakerWithSuppressedTargetStaysConsistent()
    testMoveIgnoreAndMoldBreakerDoNotMutateState()
    console.log('Ability mold breaker flow tests passed')
}

main()
