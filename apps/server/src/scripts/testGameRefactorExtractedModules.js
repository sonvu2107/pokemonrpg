import assert from 'assert'
import {
    inferMoveType,
    normalizePokemonTypes,
    resolveEffectivenessText,
    resolveTypeEffectiveness,
} from '../battle/typeSystem.js'
import { calcBattleDamage, estimateBattleDamage } from '../battle/battleCalc.js'
import {
    applyStatusPatch,
    mergeFieldState,
    normalizeFieldState,
    normalizeBattleStatus,
    normalizeStatusTurns,
    resolveEntryHazardSwitchInOutcome,
    resolveActionAvailabilityByStatus,
} from '../battle/battleState.js'
import {
    applyCounterMovePpConsumption,
    normalizeCounterMoveEntry,
    resolveCounterMoveSelection,
} from '../battle/counterMoveAI.js'
import {
    resolveMoveAccuracy,
    resolveMoveCategory,
    resolveMoveCriticalChance,
    resolveMovePriority,
} from '../battle/moveHelpers.js'
import {
    createEmptyEffectAggregate,
    mergeEffectAggregate,
    mergeMovePpStateEntries,
    isMovePpStateEqual,
} from '../battle/effectAggregate.js'
import {
    applyPercentBonus,
    applyPercentMultiplier,
    isImmuneToWeatherChip,
    rollDamage,
} from '../battle/battleRuntimeUtils.js'
import {
    buildProgressIndex,
    buildUnlockRequirement,
    distributeExpByDefeats,
    normalizeLevelExpState,
    resolveNextMapInTrack,
    resolveSourceMapForUnlock,
    toDailyDateKey,
} from '../services/mapProgressionService.js'
import {
    calcCatchChance,
    calcLowHpCatchBonusPercent,
    resolveMapRarityCatchBonusPercent,
    resolvePokemonForm,
    resolvePokemonImageForForm,
    serializePlayerWallet,
} from '../services/wildEncounterService.js'
import {
    getAliveOpponentIndex,
    normalizeTrainerPokemonDamagePercent,
    resolveTrainerAverageLevel,
} from '../services/trainerBattleStateService.js'

const runTypeSystemTests = () => {
    assert(inferMoveType('Thunder Shock') === 'electric')
    assert.deepStrictEqual(normalizePokemonTypes(['Fire', 'fire', '', 'Grass']), ['fire', 'grass'])

    const fireVsGrassSteel = resolveTypeEffectiveness('fire', ['grass', 'steel'])
    assert(fireVsGrassSteel.multiplier === 4)

    const dragonVsFairy = resolveTypeEffectiveness('dragon', ['fairy'])
    assert(dragonVsFairy.multiplier === 0)
    assert(resolveEffectivenessText(0) === 'Không có tác dụng.')
}

const runBattleCalcTests = () => {
    const estimated = estimateBattleDamage({
        attackerLevel: 50,
        movePower: 80,
        attackStat: 120,
        defenseStat: 100,
        modifier: 1,
    })
    assert(estimated >= 1)

    const originalRandom = Math.random
    Math.random = () => 0
    const rolled = calcBattleDamage({
        attackerLevel: 50,
        movePower: 80,
        attackStat: 120,
        defenseStat: 100,
        modifier: 1,
    })
    Math.random = originalRandom

    assert(rolled >= 1)
    assert(rolled <= estimated)
}

const runBattleStateTests = () => {
    assert(normalizeBattleStatus('Paralyzed') === 'paralyze')
    assert(normalizeStatusTurns(3.8) === 3)

    const patched = applyStatusPatch({
        currentStatus: '',
        nextStatus: 'sleep',
        random: () => 0,
    })
    assert(patched.status === 'sleep')
    assert(patched.statusTurns >= 1)

    const frozenBlocked = resolveActionAvailabilityByStatus({
        status: 'freeze',
        statusTurns: 3,
        random: () => 0.9,
    })
    assert(frozenBlocked.canAct === false)

    const hazardField = mergeFieldState({}, {
        setEntryHazard: { side: 'opponent', hazard: 'spikes' },
    })
    const hazardFieldWithSecondLayer = mergeFieldState(hazardField, {
        setEntryHazard: { side: 'opponent', hazard: 'spikes' },
    })
    const hazardFieldWithStickyWeb = mergeFieldState(hazardFieldWithSecondLayer, {
        setEntryHazard: { side: 'opponent', hazard: 'sticky_web' },
    })
    const hazardFieldWithStealthRock = mergeFieldState(hazardFieldWithStickyWeb, {
        setEntryHazard: { side: 'opponent', hazard: 'stealth_rock' },
    })

    const normalizedHazardField = normalizeFieldState(hazardFieldWithStealthRock)
    assert(normalizedHazardField?.entryHazards?.opponent?.spikesLayers === 2)
    assert(normalizedHazardField?.entryHazards?.opponent?.stickyWeb === true)
    assert(normalizedHazardField?.entryHazards?.opponent?.stealthRock === true)

    const hazardOutcome = resolveEntryHazardSwitchInOutcome({
        fieldState: normalizedHazardField,
        targetSide: 'opponent',
        targetMaxHp: 160,
        rockEffectivenessMultiplier: 2,
    })
    assert(hazardOutcome.damage === 66)
    assert(hazardOutcome.statStageDelta?.spd === -1)

    const clearedHazardField = mergeFieldState(normalizedHazardField, {
        clearEntryHazards: { side: 'opponent' },
    })
    assert(!clearedHazardField?.entryHazards?.opponent)
}

const runCounterMoveTests = () => {
    const normalized = normalizeCounterMoveEntry({ name: 'Quick Attack', pp: 30, currentPp: 5, priority: 1 })
    assert(normalized.name === 'Quick Attack')
    assert(normalized.priority === 1)

    const ordered = resolveCounterMoveSelection({
        moves: [
            { name: 'Move A', currentPp: 0, pp: 10 },
            { name: 'Move B', currentPp: 5, pp: 10 },
        ],
        mode: 'ordered',
        cursor: 0,
    })
    assert(ordered.selectedMove.name === 'Move B')

    const consumed = applyCounterMovePpConsumption({
        moves: ordered.normalizedMoves,
        selectedIndex: ordered.selectedIndex,
        shouldConsume: true,
    })
    assert(consumed[1].currentPp === 4)
}

const runMoveHelperTests = () => {
    assert(resolveMoveCategory({ category: 'special' }, null, 0) === 'special')
    assert(resolveMoveAccuracy({ accuracy: 150 }, null) === 100)
    assert(resolveMovePriority({ priority: -9 }, null) === -7)
    assert(resolveMoveCriticalChance({ description: 'High critical hit ratio' }, null) === 0.125)
}

const runEffectAggregateTests = () => {
    const mergedPp = mergeMovePpStateEntries(
        [{ moveName: 'Tackle', currentPp: 5, maxPp: 35 }],
        [{ moveName: 'Tackle', currentPp: 4, maxPp: 35 }]
    )
    assert(mergedPp.length === 1)
    assert(mergedPp[0].currentPp === 4)
    assert(isMovePpStateEqual(mergedPp, [{ moveName: 'Tackle', currentPp: 4, maxPp: 35 }]) === true)

    const aggregate = mergeEffectAggregate(createEmptyEffectAggregate(), {
        appliedEffects: [{ op: 'dummy' }],
        logs: ['ok'],
        statePatches: { self: { statusTurns: 2 }, opponent: {}, field: {} },
    })
    assert(aggregate.appliedEffects.length === 1)
    assert(aggregate.logs.length === 1)
}

const runRuntimeUtilsTests = () => {
    assert(applyPercentBonus(100, 50) === 150)
    assert(applyPercentMultiplier(100, 25) === 125)
    assert(isImmuneToWeatherChip('hail', ['ice']) === true)
    const damage = rollDamage(10)
    assert(damage >= 5)
}

const runMapProgressionPureTests = () => {
    const distributed = distributeExpByDefeats(11, [
        { userPokemonId: 'a', defeatedCount: 2 },
        { userPokemonId: 'b', defeatedCount: 1 },
    ])
    assert(distributed.reduce((sum, entry) => sum + entry.baseExp, 0) === 11)

    const leveled = normalizeLevelExpState(1, 0, 250)
    assert(leveled.level >= 2)

    const maps = [
        { _id: 'm1', slug: 'a', name: 'A', isLegendary: false, requiredSearches: 0, requiredPlayerLevel: 1, requiredVipLevel: 0 },
        { _id: 'm2', slug: 'b', name: 'B', isLegendary: false, requiredSearches: 5, requiredPlayerLevel: 2, requiredVipLevel: 1 },
    ]
    const progressIndex = buildProgressIndex([{ mapId: 'm1', totalSearches: 3 }])

    const source = resolveSourceMapForUnlock(maps, 1)
    assert(source._id === 'm1')

    const next = resolveNextMapInTrack(maps, 0)
    assert(next._id === 'm2')

    const requirement = buildUnlockRequirement(maps, 1, progressIndex, 1, 0)
    assert(requirement.remainingSearches === 0)
    assert(requirement.remainingPlayerLevels === 1)
    assert(requirement.remainingVipLevels === 1)

    assert(/^\d{4}-\d{2}-\d{2}$/.test(toDailyDateKey(new Date('2024-01-02T00:00:00Z'))))
}

const runWildEncounterTests = () => {
    const mapBonus = resolveMapRarityCatchBonusPercent({
        mapLike: { rarityCatchBonusPercent: { s: 10, ss: 20, sss: 30 } },
        rarity: 'ss',
    })
    assert(mapBonus === 20)

    const chance = calcCatchChance({ catchRate: 45, hp: 10, maxHp: 100 })
    assert(chance > 0 && chance <= 0.95)

    const lowHpBonus = calcLowHpCatchBonusPercent({ hp: 1, maxHp: 100, rarity: 'sss' })
    assert(lowHpBonus > 0)

    const pokemon = {
        imageUrl: 'species.png',
        sprites: { normal: 'species-normal.png', shiny: 'species-shiny.png' },
        defaultFormId: 'normal',
        forms: [
            { formId: 'normal', imageUrl: 'form.png', sprites: { normal: 'form-normal.png', shiny: 'form-shiny.png' } },
        ],
    }
    const resolved = resolvePokemonForm(pokemon, 'normal')
    assert(resolved.formId === 'normal')
    assert(resolvePokemonImageForForm(pokemon, 'normal', false) === 'form.png')
    assert(resolvePokemonImageForForm(pokemon, 'normal', true) === 'form-shiny.png')

    const wallet = serializePlayerWallet({ gold: 12, moonPoints: 34 })
    assert.deepStrictEqual(wallet, { platinumCoins: 12, moonPoints: 34 })
}

const runTrainerBattleStateTests = () => {
    assert(normalizeTrainerPokemonDamagePercent(2000, 100) === 1000)
    assert(normalizeTrainerPokemonDamagePercent(-5, 100) === 0)

    const idx = getAliveOpponentIndex([
        { currentHp: 0 },
        { currentHp: 10 },
    ], 0)
    assert(idx === 1)

    const avg = resolveTrainerAverageLevel({
        team: [{ level: 10 }, { level: 20 }, { level: 21 }],
    })
    assert(avg === 17)
}

const main = () => {
    runTypeSystemTests()
    runBattleCalcTests()
    runBattleStateTests()
    runCounterMoveTests()
    runMoveHelperTests()
    runEffectAggregateTests()
    runRuntimeUtilsTests()
    runMapProgressionPureTests()
    runWildEncounterTests()
    runTrainerBattleStateTests()
    console.log('Refactored game module tests passed')
}

main()
