import assert from 'assert'
import { __battleEffectInternals } from '../routes/game.js'
import { __onlineChallengeInternals } from '../routes/stats.js'
import {
    applyTrainerSessionForcedPlayerSwitch,
    resolveTrainerSessionActivePlayerIndex,
    serializeTrainerPlayerPartyState,
    setTrainerSessionActivePlayerByIndex,
    syncTrainerSessionActivePlayerToParty,
} from '../services/trainerBattlePlayerStateService.js'

const {
    resolveBattleTurnOrder,
    createTurnTimeline,
    resolveTurnActorPhaseKeys,
    appendTurnPhaseEvent,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
} = __battleEffectInternals
const { createEmptyPartySlots, serializePartyPokemon } = __onlineChallengeInternals

const runTurnOrderTests = () => {
    const priorityWin = resolveBattleTurnOrder({
        playerPriority: 1,
        opponentPriority: 0,
        playerSpeed: 10,
        opponentSpeed: 999,
        random: () => 0.9,
    })
    assert(priorityWin.playerActsFirst === true, 'Expected higher priority move to act first')
    assert(priorityWin.reason === 'priority', 'Expected priority reason when priorities differ')

    const speedWin = resolveBattleTurnOrder({
        playerPriority: 0,
        opponentPriority: 0,
        playerSpeed: 180,
        opponentSpeed: 120,
        random: () => 0.9,
    })
    assert(speedWin.playerActsFirst === true, 'Expected faster Pokemon to act first when priority ties')
    assert(speedWin.reason === 'speed', 'Expected speed reason when speed decides order')

    const speedLoss = resolveBattleTurnOrder({
        playerPriority: 0,
        opponentPriority: 0,
        playerSpeed: 90,
        opponentSpeed: 140,
        random: () => 0.1,
    })
    assert(speedLoss.playerActsFirst === false, 'Expected slower Pokemon to move second')

    const tiePlayer = resolveBattleTurnOrder({
        playerPriority: 0,
        opponentPriority: 0,
        playerSpeed: 120,
        opponentSpeed: 120,
        random: () => 0.2,
    })
    assert(tiePlayer.playerActsFirst === true, 'Expected tie to allow player first when random < 0.5')
    assert(tiePlayer.reason === 'speed-tie', 'Expected speed-tie reason for equal priority and speed')

    const tieOpponent = resolveBattleTurnOrder({
        playerPriority: 0,
        opponentPriority: 0,
        playerSpeed: 120,
        opponentSpeed: 120,
        random: () => 0.8,
    })
    assert(tieOpponent.playerActsFirst === false, 'Expected tie to allow opponent first when random >= 0.5')
}

const buildMockSpecies = (name, types, stats) => ({
    _id: `${name.toLowerCase()}-species`,
    name,
    types,
    rarity: 'b',
    baseStats: stats,
    imageUrl: `${name.toLowerCase()}.png`,
    sprites: { normal: `${name.toLowerCase()}-normal.png` },
    defaultFormId: 'normal',
    forms: [],
})

const runOnlineChallengeSerializationTests = () => {
    const moveLookupMap = new Map([
        ['quick attack', { name: 'Quick Attack', pp: 30, type: 'normal', category: 'physical', power: 40, accuracy: 100, priority: 1 }],
        ['thunderbolt', { name: 'Thunderbolt', pp: 15, type: 'electric', category: 'special', power: 90, accuracy: 100, priority: 0 }],
        ['vine whip', { name: 'Vine Whip', pp: 25, type: 'grass', category: 'physical', power: 45, accuracy: 100, priority: 0 }],
        ['sleep powder', { name: 'Sleep Powder', pp: 15, type: 'grass', category: 'status', power: null, accuracy: 75, priority: 0 }],
    ])

    const pikachuEntry = {
        _id: 'party-1',
        nickname: 'Speedster',
        level: 35,
        formId: 'normal',
        isShiny: false,
        partyIndex: 0,
        ivs: { hp: 5, atk: 4, def: 3, spatk: 2, spdef: 1, spd: 6 },
        evs: { hp: 8, atk: 0, def: 0, spatk: 16, spdef: 0, spd: 24 },
        moves: ['Quick Attack', 'Thunderbolt'],
        movePpState: [
            { moveName: 'Quick Attack', currentPp: 19, maxPp: 30 },
            { moveName: 'Thunderbolt', currentPp: 11, maxPp: 15 },
        ],
        pokemonId: buildMockSpecies('Pikachu', ['electric'], { hp: 35, atk: 55, def: 40, spatk: 50, spdef: 50, spd: 90 }),
    }

    const bulbasaurEntry = {
        _id: 'party-2',
        nickname: 'Control',
        level: 28,
        formId: 'normal',
        isShiny: false,
        partyIndex: 1,
        ivs: { hp: 1, atk: 2, def: 3, spatk: 4, spdef: 5, spd: 6 },
        evs: { hp: 0, atk: 0, def: 8, spatk: 12, spdef: 4, spd: 0 },
        moves: ['Vine Whip', 'Sleep Powder'],
        movePpState: [
            { moveName: 'Vine Whip', currentPp: 17, maxPp: 25 },
            { moveName: 'Sleep Powder', currentPp: 9, maxPp: 15 },
        ],
        pokemonId: buildMockSpecies('Bulbasaur', ['grass', 'poison'], { hp: 45, atk: 49, def: 49, spatk: 65, spdef: 65, spd: 45 }),
    }

    const slots = createEmptyPartySlots()
    const firstSnapshot = serializePartyPokemon(pikachuEntry, moveLookupMap)
    const secondSnapshot = serializePartyPokemon(bulbasaurEntry, moveLookupMap)
    slots[firstSnapshot.partyIndex] = firstSnapshot
    slots[secondSnapshot.partyIndex] = secondSnapshot

    assert(Array.isArray(firstSnapshot.moves) && firstSnapshot.moves.length === 2, 'Expected first party snapshot to include move names')
    assert(firstSnapshot.moveDetails[0].priority === 1, 'Expected move details to preserve priority for Quick Attack')
    assert(firstSnapshot.movePpState[1].currentPp === 11, 'Expected Thunderbolt PP state preserved')
    assert(secondSnapshot.moveDetails[1].category === 'status', 'Expected second party snapshot to include status move metadata')
    assert(secondSnapshot.movePpState[0].currentPp === 17, 'Expected Vine Whip PP state preserved')
    assert(slots.filter(Boolean).length === 2, 'Expected multiple Pokemon snapshots to fit challenge party slots')
}

const runTurnTimelineTests = () => {
    const timeline = createTurnTimeline({ playerActsFirst: false })
    const playerPhaseKeys = resolveTurnActorPhaseKeys(timeline, 'player')
    const opponentPhaseKeys = resolveTurnActorPhaseKeys(timeline, 'opponent')

    assert(playerPhaseKeys.action === 'action_2', 'Expected slower player to occupy second action slot')
    assert(opponentPhaseKeys.action === 'action_1', 'Expected faster opponent to occupy first action slot')

    appendTurnPhaseEvent(timeline, {
        phaseKey: 'turn_end',
        actor: 'system',
        kind: 'residual_damage',
        line: 'Bulbasaur chịu 10 sát thương do bỏng.',
    })
    appendTurnPhaseEvent(timeline, {
        phaseKey: opponentPhaseKeys.action,
        actor: 'opponent',
        kind: 'move_used',
        line: 'Charizard dùng Flamethrower! Gây 50 sát thương.',
    })
    appendTurnPhaseEvent(timeline, {
        phaseKey: playerPhaseKeys.preAction,
        actor: 'player',
        kind: 'status_check',
        line: 'Pokemon của bạn: Đã tỉnh giấc.',
    })

    const phases = finalizeTurnTimeline(timeline)
    assert(phases[0].key === 'action_1', 'Expected first populated phase to remain ordered as action_1')
    assert(phases[1].key === 'pre_action_2', 'Expected second populated phase to remain ordered as pre_action_2')
    assert(phases[2].key === 'turn_end', 'Expected turn_end to remain last in populated phase order')

    const flattenedLines = flattenTurnPhaseLines(phases)
    assert(flattenedLines[0] === 'Charizard dùng Flamethrower! Gây 50 sát thương.', 'Expected flattened phase lines to preserve action order')
    assert(flattenedLines[1] === 'Pokemon của bạn: Đã tỉnh giấc.', 'Expected flattened phase lines to preserve pre-action order')
    assert(flattenedLines[2] === 'Bulbasaur chịu 10 sát thương do bỏng.', 'Expected flattened phase lines to keep turn-end message last')
}

const runTrainerForcedSwitchTests = () => {
    const session = {
        playerPokemonId: 'p1',
        playerCurrentHp: 12,
        playerMaxHp: 100,
        playerStatus: 'burn',
        playerStatusTurns: 1,
        playerStatStages: { atk: 2 },
        playerDamageGuards: { physical: { turns: 1, multiplier: 0.5 } },
        playerWasDamagedLastTurn: true,
        playerVolatileState: { bindTurns: 2 },
        playerTeam: [
            { slot: 0, userPokemonId: 'p1', name: 'Lead', currentHp: 12, maxHp: 100, status: '', statusTurns: 0 },
            { slot: 1, userPokemonId: 'p2', name: 'Bench 1', currentHp: 55, maxHp: 90, status: 'paralyze', statusTurns: 1 },
            { slot: 2, userPokemonId: 'p3', name: 'Bench 2', currentHp: 0, maxHp: 80, status: '', statusTurns: 0 },
        ],
    }

    syncTrainerSessionActivePlayerToParty(session)
    assert(session.playerTeam[0].currentHp === 12, 'Expected active player HP synced into party entry')
    assert(session.playerTeam[0].status === 'burn', 'Expected active player status synced into party entry')

    session.playerCurrentHp = 0
    session.playerStatus = ''
    session.playerStatusTurns = 0
    syncTrainerSessionActivePlayerToParty(session)
    const forcedSwitch = applyTrainerSessionForcedPlayerSwitch(session)

    assert(forcedSwitch.switched === true, 'Expected forced switch when another alive party member exists')
    assert(forcedSwitch.nextIndex === 1, 'Expected next alive party member to be selected')
    assert(String(session.playerPokemonId) === 'p2', 'Expected active player Pokemon to change after forced switch')
    assert(session.playerCurrentHp === 55, 'Expected switched-in Pokemon HP to load from party state')
    assert(session.playerStatus === 'paralyze', 'Expected switched-in Pokemon persistent status to load from party state')
    assert(resolveTrainerSessionActivePlayerIndex(session) === 1, 'Expected active player index to match switched-in slot')
    assert(Object.keys(session.playerStatStages).length === 0, 'Expected transient stat stages reset after switch')
    assert(Object.keys(session.playerVolatileState).length === 0, 'Expected volatile state reset after switch')

    const serializedParty = serializeTrainerPlayerPartyState(session)
    assert(serializedParty.activeIndex === 1, 'Expected serialized player party to expose active switched-in index')

    setTrainerSessionActivePlayerByIndex(session, 0)
    assert(String(session.playerPokemonId) === 'p1', 'Expected helper to restore active player by index')
}

const main = () => {
    runTurnOrderTests()
    runOnlineChallengeSerializationTests()
    runTurnTimelineTests()
    runTrainerForcedSwitchTests()
    console.log('Battle turn order and online challenge serialization tests passed')
}

main()
