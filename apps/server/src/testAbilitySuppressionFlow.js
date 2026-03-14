import assert from 'assert'
import { __battleEffectInternals } from './routes/game.js'
import { applyTrainerSessionForcedPlayerSwitch } from './services/trainerBattlePlayerStateService.js'
import { createTrainerSession } from './test/helpers/battleSessionFactory.js'

const {
    buildAbilityResolutionContext,
    resolveAbilityHitDefense,
    resolveAbilityStatusGuard,
    resolveAbilityMutations,
    resolveAbilitySuppressionMutations,
} = __battleEffectInternals

const testSuppressedAbilitySkipsHooksUntilCleared = () => {
    const blocked = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 80,
        defenderMaxHp: 100,
        resolutionContext: buildAbilityResolutionContext(),
        isSuppressed: true,
    })
    assert.strictEqual(blocked.preventDamage, false)

    const activeAgain = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 80,
        defenderMaxHp: 100,
        resolutionContext: buildAbilityResolutionContext(),
        isSuppressed: false,
    })
    assert.strictEqual(activeAgain.preventDamage, true)
}

const testSuppressionDoesNotMutateAbilityString = () => {
    const ability = 'immunity'
    const guarded = resolveAbilityStatusGuard({
        ability,
        incomingStatus: 'poison',
        resolutionContext: buildAbilityResolutionContext(),
        isSuppressed: true,
    })
    assert.strictEqual(guarded.preventStatus, false)
    assert.strictEqual(ability, 'immunity')
}

const testSwitchOutClearsSuppression = () => {
    const trainerSession = createTrainerSession({
        playerPokemonId: '64b000000000000000007001',
        playerAbility: 'intimidate',
        playerAbilitySuppressed: true,
        playerTeam: [
            {
                slot: 0,
                userPokemonId: '64b000000000000000007001',
                name: 'LeadMon',
                currentHp: 40,
                maxHp: 100,
                status: '',
                statusTurns: 0,
                ability: 'intimidate',
                abilitySuppressed: true,
            },
            {
                slot: 1,
                userPokemonId: '64b000000000000000007002',
                name: 'BenchMon',
                currentHp: 60,
                maxHp: 100,
                status: '',
                statusTurns: 0,
                ability: 'levitate',
                abilitySuppressed: false,
            },
        ],
    })

    const forced = applyTrainerSessionForcedPlayerSwitch(trainerSession)
    assert.strictEqual(forced.switched, true)
    assert.strictEqual(trainerSession.playerPokemonId, '64b000000000000000007002')
    assert.strictEqual(Boolean(trainerSession.playerTeam[0]?.abilitySuppressed), false)
    assert.strictEqual(Boolean(trainerSession.playerAbilitySuppressed), false)
}

const testMutationOpsDoNotBreakSuppressionState = () => {
    const mutation = resolveAbilityMutations({
        selfAbility: 'intimidate',
        opponentAbility: 'levitate',
        selfPatches: { copyTargetAbility: true },
        opponentPatches: {},
    })
    assert.strictEqual(mutation.selfAbility, 'levitate')

    const suppression = resolveAbilitySuppressionMutations({
        selfSuppressed: true,
        opponentSuppressed: false,
        selfPatches: {},
        opponentPatches: {},
    })
    assert.strictEqual(suppression.selfSuppressed, true)
    assert.strictEqual(suppression.opponentSuppressed, false)
}

const testPerResolutionIgnoreDoesNotMutateLongSuppression = () => {
    const suppressedFlag = true
    const ignored = resolveAbilityHitDefense({
        ability: 'water_absorb',
        incomingMoveType: 'water',
        incomingMoveCategory: 'special',
        didMoveHit: true,
        defenderCurrentHp: 50,
        defenderMaxHp: 100,
        resolutionContext: buildAbilityResolutionContext({ ignoreTargetAbility: true }),
        isSuppressed: suppressedFlag,
    })

    assert.strictEqual(ignored.preventDamage, false)
    assert.strictEqual(suppressedFlag, true)
}

const main = () => {
    testSuppressedAbilitySkipsHooksUntilCleared()
    testSuppressionDoesNotMutateAbilityString()
    testSwitchOutClearsSuppression()
    testMutationOpsDoNotBreakSuppressionState()
    testPerResolutionIgnoreDoesNotMutateLongSuppression()
    console.log('Ability suppression flow tests passed')
}

main()
