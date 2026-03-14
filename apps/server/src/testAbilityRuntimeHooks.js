import assert from 'assert'
import { applyAbilityHook } from './battle/abilities/abilityRuntime.js'

const testIntimidateSwitchIn = () => {
    const result = applyAbilityHook('onSwitchIn', { ability: 'intimidate' })
    assert.strictEqual(result.applied, true)
    assert.strictEqual(Number(result?.statePatches?.opponent?.statStages?.atk || 0), -1)
}

const testLevitateGroundImmunity = () => {
    const result = applyAbilityHook('onTryHit', {
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        isDamagingMove: true,
        didMoveHit: true,
    })
    assert.strictEqual(result.applied, true)
    assert.strictEqual(Boolean(result?.statePatches?.self?.preventDamage), true)
}

const testWaterAbsorb = () => {
    const result = applyAbilityHook('onTryHit', {
        ability: 'water_absorb',
        incomingMoveType: 'water',
        incomingMoveCategory: 'special',
        isDamagingMove: true,
        didMoveHit: true,
    })
    assert.strictEqual(result.applied, true)
    assert.strictEqual(Boolean(result?.statePatches?.self?.preventDamage), true)
    assert.strictEqual(Number(result?.statePatches?.self?.healFractionMaxHp || 0), 0.25)
}

const testImmunityBlocksPoison = () => {
    const result = applyAbilityHook('onStatusAttempt', {
        ability: 'immunity',
        incomingStatus: 'poison',
    })
    assert.strictEqual(result.applied, true)
    assert.strictEqual(Boolean(result?.statePatches?.self?.preventStatus), true)
}

const testSwiftSwimSpeedBoost = () => {
    const activeResult = applyAbilityHook('beforeSpeedCalc', {
        ability: 'swift_swim',
        weather: 'rain',
        baseSpeed: 100,
    })
    assert.strictEqual(activeResult.applied, true)
    assert.strictEqual(Number(activeResult?.statePatches?.self?.speedMultiplier || 1), 2)

    const inactiveResult = applyAbilityHook('beforeSpeedCalc', {
        ability: 'swift_swim',
        weather: 'sun',
        baseSpeed: 100,
    })
    assert.strictEqual(inactiveResult.applied, false)
}

const main = () => {
    testIntimidateSwitchIn()
    testLevitateGroundImmunity()
    testWaterAbsorb()
    testImmunityBlocksPoison()
    testSwiftSwimSpeedBoost()
    console.log('Ability runtime hook tests passed')
}

main()
