import assert from 'assert'
import { __battleEffectInternals } from './routes/game.js'
import { __trainerPenaltyInternals } from './services/trainerPenaltyTurnService.js'

const {
    buildAbilityResolutionContext,
    resolveIgnoreTargetAbilityFromEffectAggregates,
    resolveIgnoreTargetAbilityFromEffectSpecs,
    resolveSuppressTargetAbilityFromEffectSpecs,
    resolveAbilityHitDefense,
    resolveAbilityStatusGuard,
} = __battleEffectInternals

const {
    resolveIgnoreTargetAbilityFromEffectSpecs: resolvePenaltyIgnoreFromEffectSpecs,
    resolveSuppressTargetAbilityFromEffectSpecs: resolvePenaltySuppressFromEffectSpecs,
    buildAbilityResolutionContext: buildPenaltyAbilityResolutionContext,
    resolveAbilityHitDefense: resolvePenaltyAbilityHitDefense,
} = __trainerPenaltyInternals

const testIgnoreTargetAbilityOnlyAppliesCurrentResolution = () => {
    const normalContext = buildAbilityResolutionContext()
    const ignoreContext = buildAbilityResolutionContext({ ignoreTargetAbility: true })

    const normalDefense = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 100,
        defenderMaxHp: 100,
        resolutionContext: normalContext,
    })
    assert.strictEqual(normalDefense.preventDamage, true)

    const ignoredDefense = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 100,
        defenderMaxHp: 100,
        resolutionContext: ignoreContext,
    })
    assert.strictEqual(ignoredDefense.preventDamage, false)

    const nextResolutionDefense = resolveAbilityHitDefense({
        ability: 'levitate',
        incomingMoveType: 'ground',
        incomingMoveCategory: 'physical',
        didMoveHit: true,
        defenderCurrentHp: 100,
        defenderMaxHp: 100,
        resolutionContext: normalContext,
    })
    assert.strictEqual(nextResolutionDefense.preventDamage, true)
}

const testIgnoreTargetAbilityDoesNotMutateAbilitySnapshot = () => {
    const defenderAbility = 'immunity'
    const ignored = resolveAbilityStatusGuard({
        ability: defenderAbility,
        incomingStatus: 'poison',
        resolutionContext: buildAbilityResolutionContext({ ignoreTargetAbility: true }),
    })
    assert.strictEqual(ignored.preventStatus, false)
    assert.strictEqual(defenderAbility, 'immunity')

    const normal = resolveAbilityStatusGuard({
        ability: defenderAbility,
        incomingStatus: 'poison',
        resolutionContext: buildAbilityResolutionContext(),
    })
    assert.strictEqual(normal.preventStatus, true)
}

const testIgnoreFlagExtractionFromAggregatesAndSpecs = () => {
    const fromAggregates = resolveIgnoreTargetAbilityFromEffectAggregates({
        aggregates: [
            { statePatches: { self: {} } },
            {
                statePatches: {
                    self: {
                        ignoreTargetAbility: true,
                        ignoreTargetAbilityMode: 'ignore',
                    },
                },
            },
        ],
    })
    assert.strictEqual(fromAggregates.ignoreTargetAbility, true)
    assert.strictEqual(fromAggregates.ignoreTargetAbilityMode, 'ignore')

    const fromSpecs = resolveIgnoreTargetAbilityFromEffectSpecs({
        effectSpecs: [{
            op: 'ignore_target_ability',
            trigger: 'on_calculate_damage',
            chance: 1,
            params: { mode: 'ignore' },
        }],
        random: () => 0,
    })
    assert.strictEqual(fromSpecs.ignoreTargetAbility, true)

    const suppressModeShouldNotBeIgnore = resolveIgnoreTargetAbilityFromEffectSpecs({
        effectSpecs: [{
            op: 'ignore_target_ability',
            trigger: 'on_calculate_damage',
            chance: 1,
            params: { mode: 'suppress_if_target_moved' },
        }],
        random: () => 0,
    })
    assert.strictEqual(suppressModeShouldNotBeIgnore.ignoreTargetAbility, false)

    const suppressFromSpecs = resolveSuppressTargetAbilityFromEffectSpecs({
        effectSpecs: [{
            op: 'ignore_target_ability',
            trigger: 'on_calculate_damage',
            chance: 1,
            params: { mode: 'suppress_if_target_moved' },
        }],
        random: () => 0,
        targetMovedBeforeAction: true,
    })
    assert.strictEqual(suppressFromSpecs.suppressTargetAbility, true)
}

const testPenaltyFlowHelperRespectsIgnoreFlag = () => {
    const ignoreFromPenaltySpecs = resolvePenaltyIgnoreFromEffectSpecs({
        effectSpecs: [{
            op: 'ignore_target_ability',
            trigger: 'on_calculate_damage',
            chance: 1,
            params: { mode: 'ignore' },
        }],
        random: () => 0,
    })
    const context = buildPenaltyAbilityResolutionContext(ignoreFromPenaltySpecs)
    const defense = resolvePenaltyAbilityHitDefense({
        ability: 'water_absorb',
        incomingMoveType: 'water',
        incomingMoveCategory: 'special',
        didMoveHit: true,
        defenderCurrentHp: 50,
        defenderMaxHp: 100,
        resolutionContext: context,
    })
    assert.strictEqual(defense.preventDamage, false)

    const suppressFromPenaltySpecs = resolvePenaltySuppressFromEffectSpecs({
        effectSpecs: [{
            op: 'ignore_target_ability',
            trigger: 'on_calculate_damage',
            chance: 1,
            params: { mode: 'suppress_if_target_moved' },
        }],
        random: () => 0,
        targetMovedBeforeAction: true,
    })
    assert.strictEqual(suppressFromPenaltySpecs.suppressTargetAbility, true)
}

const main = () => {
    testIgnoreTargetAbilityOnlyAppliesCurrentResolution()
    testIgnoreTargetAbilityDoesNotMutateAbilitySnapshot()
    testIgnoreFlagExtractionFromAggregatesAndSpecs()
    testPenaltyFlowHelperRespectsIgnoreFlag()
    console.log('Ability ignore resolution tests passed')
}

main()
