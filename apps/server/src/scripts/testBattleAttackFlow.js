import assert from 'assert'
import { __battleEffectInternals } from '../routes/game.js'

const {
    normalizeBattleStatus,
    normalizeStatusTurns,
    normalizeVolatileState,
    mergeVolatileState,
    applyStatusPatch,
    resolveActionAvailabilityByStatus,
    resolveDrowsySleepAtEndTurn,
    calcResidualStatusDamage,
    applyDamageGuardsToDamage,
    decrementDamageGuards,
    applyEntryHazardsOnSwitchIn,
} = __battleEffectInternals

const runStatusLifecycleTests = () => {
    const appliedSleep = applyStatusPatch({
        currentStatus: '',
        currentTurns: 0,
        nextStatus: 'sleep',
        random: () => 0,
    })

    assert(appliedSleep.status === 'sleep', 'Expected sleep status applied')
    assert(appliedSleep.statusTurns >= 2, 'Expected generated sleep turns to last through at least one blocked action')

    const sleepBlocked = resolveActionAvailabilityByStatus({
        status: 'sleep',
        statusTurns: 2,
        random: () => 0.9,
    })
    assert(sleepBlocked.canAct === false, 'Expected sleep to block action with turns > 1')
    assert(sleepBlocked.statusAfterCheck === 'sleep', 'Expected sleep to remain active')
    assert(sleepBlocked.statusTurnsAfterCheck === 1, 'Expected sleep turns to decrement')

    const sleepWakeup = resolveActionAvailabilityByStatus({
        status: 'sleep',
        statusTurns: 1,
        random: () => 0.9,
    })
    assert(sleepWakeup.canAct === true, 'Expected wakeup turn to allow action')
    assert(sleepWakeup.statusAfterCheck === '', 'Expected sleep removed on wakeup')

    const flinchBlocked = resolveActionAvailabilityByStatus({
        status: 'flinch',
        statusTurns: 1,
        random: () => 0.9,
    })
    assert(flinchBlocked.canAct === false, 'Expected flinch to block once')
    assert(flinchBlocked.statusAfterCheck === '', 'Expected flinch to clear immediately')
}

const runResidualTests = () => {
    const burnDamage = calcResidualStatusDamage({ status: 'burn', maxHp: 160 })
    assert(burnDamage === 10, 'Expected burn residual = floor(160 / 16)')

    const poisonDamage = calcResidualStatusDamage({ status: 'poison', maxHp: 95 })
    assert(poisonDamage === 5, 'Expected poison residual = floor(95 / 16)')

    const noneDamage = calcResidualStatusDamage({ status: 'sleep', maxHp: 160 })
    assert(noneDamage === 0, 'Expected no residual for sleep')
}

const runDrowsyTests = () => {
    const firstTurn = resolveDrowsySleepAtEndTurn({
        status: '',
        statusTurns: 0,
        volatileState: { drowsyTurns: 2 },
        random: () => 0,
    })
    assert(firstTurn.fellAsleep === false, 'Expected drowsy first turn to not sleep immediately')
    assert(firstTurn.volatileStateAfter.drowsyTurns === 1, 'Expected drowsy turns to decrement after first turn')

    const secondTurn = resolveDrowsySleepAtEndTurn({
        status: '',
        statusTurns: 0,
        volatileState: { drowsyTurns: 1 },
        random: () => 0,
    })
    assert(secondTurn.fellAsleep === true, 'Expected drowsy second turn to apply sleep')
    assert(secondTurn.statusAfter === 'sleep', 'Expected delayed drowsy effect to become sleep')
    assert(!secondTurn.volatileStateAfter.drowsyTurns, 'Expected drowsy marker cleared after sleep')
}

const runDamageGuardTests = () => {
    const reducedPhysical = applyDamageGuardsToDamage(100, 'physical', {
        physical: { multiplier: 0.5, turns: 3 },
    })
    assert(reducedPhysical === 50, 'Expected physical guard to halve damage')

    const reducedSpecial = applyDamageGuardsToDamage(90, 'special', {
        special: { multiplier: 0.5, turns: 2 },
    })
    assert(reducedSpecial === 45, 'Expected special guard to halve damage')

    const guardsAfterTurn = decrementDamageGuards({
        physical: { multiplier: 0.5, turns: 2 },
        special: { multiplier: 0.5, turns: 1 },
    })
    assert(guardsAfterTurn.physical?.turns === 1, 'Expected physical guard turns decremented')
    assert(!guardsAfterTurn.special, 'Expected expired special guard removed')
}

const runVolatileStateTests = () => {
    const merged = mergeVolatileState(
        { rechargeTurns: 1, lockedRepeatMoveName: 'Blood Moon' },
        { bindTurns: 5, bindFraction: 0.125 }
    )
    assert(merged.rechargeTurns === 1, 'Expected rechargeTurns preserved in volatile merge')
    assert(merged.lockedRepeatMoveName === 'Blood Moon', 'Expected lockedRepeatMoveName preserved')
    assert(merged.bindTurns === 5, 'Expected bindTurns added in volatile merge')

    const normalized = normalizeVolatileState({ bindTurns: 0, bindFraction: 2 })
    assert(!normalized.bindTurns, 'Expected bind turns removed when zero')
}

const runNormalizationTests = () => {
    assert(normalizeBattleStatus('Paralyzed') === 'paralyze', 'Expected status alias normalization')
    assert(normalizeStatusTurns(2.9) === 2, 'Expected status turns floor to integer')
    assert(normalizeStatusTurns(-10) === 0, 'Expected status turns clamp to zero')
}

const runEntryHazardSwitchInTests = () => {
    const hazardApplied = applyEntryHazardsOnSwitchIn({
        fieldState: {
            entryHazards: {
                opponent: {
                    spikesLayers: 2,
                    stealthRock: true,
                    stickyWeb: true,
                },
            },
        },
        side: 'opponent',
        targetName: 'HazardMon',
        targetTypes: ['fire'],
        currentHp: 160,
        maxHp: 160,
        statStages: {},
    })

    assert(hazardApplied.nextHp === 94, 'Expected spikes + stealth rock chip to reduce hp by 66')
    assert(hazardApplied.nextStatStages.spd === -1, 'Expected sticky web to lower speed stage')
    assert(hazardApplied.logs.some((line) => line.includes('HazardMon:')), 'Expected hazard logs prefixed with target name')
}

const main = () => {
    runNormalizationTests()
    runStatusLifecycleTests()
    runResidualTests()
    runDrowsyTests()
    runDamageGuardTests()
    runVolatileStateTests()
    runEntryHazardSwitchInTests()
    console.log('Battle attack flow tests passed')
}

main()
