import assert from 'assert'
import { __battleEffectInternals } from './routes/game.js'

const { resolveAbilityMutations } = __battleEffectInternals

const testSetTargetAbility = () => {
    const result = resolveAbilityMutations({
        selfAbility: 'intimidate',
        opponentAbility: 'levitate',
        selfPatches: {},
        opponentPatches: { setAbility: 'flash_fire' },
        selfLabel: 'SelfMon',
        opponentLabel: 'OppMon',
    })

    assert.strictEqual(result.selfAbility, 'intimidate')
    assert.strictEqual(result.opponentAbility, 'flash_fire')
    assert.strictEqual(result.changed, true)
}

const testCopyTargetAbility = () => {
    const result = resolveAbilityMutations({
        selfAbility: 'levitate',
        opponentAbility: 'water_absorb',
        selfPatches: { copyTargetAbility: true },
        opponentPatches: {},
    })

    assert.strictEqual(result.selfAbility, 'water_absorb')
    assert.strictEqual(result.opponentAbility, 'water_absorb')
    assert.strictEqual(result.changed, true)
}

const testSwapAbility = () => {
    const result = resolveAbilityMutations({
        selfAbility: 'swift_swim',
        opponentAbility: 'chlorophyll',
        selfPatches: { swapAbilityWithTarget: true },
        opponentPatches: { swapAbilityWithUser: true },
    })

    assert.strictEqual(result.selfAbility, 'chlorophyll')
    assert.strictEqual(result.opponentAbility, 'swift_swim')
    assert.strictEqual(result.changed, true)
}

const testSetThenSwapOrdering = () => {
    const result = resolveAbilityMutations({
        selfAbility: 'intimidate',
        opponentAbility: 'levitate',
        selfPatches: {
            setAbility: 'water_absorb',
            swapAbilityWithTarget: true,
        },
        opponentPatches: {},
    })

    assert.strictEqual(result.selfAbility, 'levitate')
    assert.strictEqual(result.opponentAbility, 'water_absorb')
    assert.strictEqual(result.changed, true)
}

const main = () => {
    testSetTargetAbility()
    testCopyTargetAbility()
    testSwapAbility()
    testSetThenSwapOrdering()
    console.log('Ability mutation ops tests passed')
}

main()
