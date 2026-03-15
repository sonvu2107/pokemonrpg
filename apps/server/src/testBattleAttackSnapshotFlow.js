import assert from 'assert'
import gameRouter from './routes/game.js'
import UserPokemon from './models/UserPokemon.js'
import BattleSession from './models/BattleSession.js'
import BattleTrainer from './models/BattleTrainer.js'
import Move from './models/Move.js'
import BadgeDefinition from './models/BadgeDefinition.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'
import {
    createMethodPatchHarness,
    createMockReq,
    createMockRes,
    getRouteHandler,
    runRouteHandler,
    withMockedRandom,
} from './test/helpers/routeTestHarness.js'
import {
    createBadgeSnapshot,
    createPartyPokemon,
    createTrainerOpponent,
    createTrainerSession,
    createTrainerDoc,
} from './test/helpers/battleSessionFactory.js'
import {
    assertNoLiveBadgeRead,
    assertForcedSwitchHazardSequence,
    assertOkResponse,
    assertPlayerMaxHpFromSnapshot,
    assertSnapshotUnchanged,
} from './test/helpers/battleAssertions.js'
import { invalidateCachedActiveBadgeBonuses } from './utils/badgeUtils.js'

const USER_IDS = {
    snapshotOnly: '64b000000000000000001101',
    hydrateThenFreeze: '64b000000000000000001102',
}

const TRAINER_ID = '64b000000000000000000001'
const ACTIVE_POKEMON_ID = '64b000000000000000000111'
const BADGE_ID = '64b000000000000000000222'

const attackHandler = getRouteHandler(gameRouter, '/battle/attack', { handlerIndex: 'last' })

const buildOpponentEntryHazardsFieldState = ({
    spikesLayers = 0,
    stealthRock = false,
    stickyWeb = false,
} = {}) => ({
    entryHazards: {
        opponent: {
            spikesLayers,
            stealthRock,
            stickyWeb,
        },
    },
})

const createThenableRowsQuery = (rows = []) => ({
    select() { return this },
    sort() { return this },
    populate() { return this },
    limit() { return this },
    lean: async () => rows,
    then(resolve, reject) {
        return Promise.resolve(rows).then(resolve, reject)
    },
})

const createLeanDocQuery = (doc = null) => ({
    select() { return this },
    sort() { return this },
    populate() { return this },
    limit() { return this },
    lean: async () => doc,
})

const createMoveDocByNameLower = (nameLower = '') => {
    const normalized = String(nameLower || '').trim().toLowerCase()
    if (normalized === 'growl') {
        return {
            name: 'Growl',
            nameLower: 'growl',
            type: 'normal',
            category: 'status',
            power: 0,
            accuracy: 100,
            priority: 0,
            pp: 20,
            effectSpecs: [],
        }
    }
    if (normalized === 'tackle') {
        return {
            name: 'Tackle',
            nameLower: 'tackle',
            type: 'normal',
            category: 'physical',
            power: 40,
            accuracy: 100,
            priority: 0,
            pp: 35,
            effectSpecs: [],
        }
    }
    return null
}

const runAttackRequest = async ({
    userId,
    trainerSession,
    partyRows,
    liveBadgeBonusPercent,
    throwOnLiveBadgeRead = false,
}) => {
    const patchHarness = createMethodPatchHarness()
    const counters = {
        liveBadgeReads: 0,
    }

    try {
        patchHarness.patch(UserPokemon, 'find', () => createThenableRowsQuery(partyRows))
        patchHarness.patch(BattleSession, 'findOne', async () => trainerSession)
        patchHarness.patch(BattleTrainer, 'findById', () => createLeanDocQuery(createTrainerDoc({ _id: TRAINER_ID })))
        patchHarness.patch(Move, 'findOne', (query = {}) => {
            const nameLower = String(query?.nameLower || '').trim().toLowerCase()
            return {
                lean: async () => createMoveDocByNameLower(nameLower),
            }
        })
        patchHarness.patch(Move, 'find', () => createThenableRowsQuery([]))

        patchHarness.patch(BadgeDefinition, 'find', () => {
            if (throwOnLiveBadgeRead) {
                throw new Error('Unexpected live badge read during battle attack')
            }
            counters.liveBadgeReads += 1
            return {
                select() { return this },
                sort() { return this },
                lean: async () => [{
                    _id: BADGE_ID,
                    isActive: true,
                    missionType: 'collect_total_count',
                    missionConfig: { requiredCount: 1 },
                    rewardEffects: [{ effectType: 'party_hp_percent', percent: liveBadgeBonusPercent }],
                }],
            }
        })
        patchHarness.patch(User, 'findById', () => createLeanDocQuery({
            _id: userId,
            role: 'user',
            equippedBadgeIds: [BADGE_ID],
            completedBattleTrainers: [],
            vipTierLevel: 0,
            catchFailCount: 0,
            totalOnlineMs: 0,
        }))
        patchHarness.patch(PlayerState, 'findOne', () => createLeanDocQuery({
            userId,
            gold: 0,
            moonPoints: 0,
        }))

        await invalidateCachedActiveBadgeBonuses(userId)

        const req = createMockReq({
            userId,
            body: {
                trainerId: TRAINER_ID,
                activePokemonId: ACTIVE_POKEMON_ID,
                moveName: 'Struggle',
                player: {
                    currentHp: 9999,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                },
                opponent: {},
                fieldState: {},
                resetTrainerSession: false,
                resetMovePpState: false,
            },
        })
        const res = createMockRes()

        await withMockedRandom(0.5, async () => {
            await runRouteHandler(attackHandler, { req, res })
        })

        return { res, counters }
    } finally {
        patchHarness.restore()
    }
}

const testAttackUsesSessionSnapshotWithoutLiveBadgeRead = async () => {
    const userId = USER_IDS.snapshotOnly
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'SnapshotMon',
        level: 30,
        baseHp: 92,
        moves: ['Tackle'],
    })
    const snapshot = createBadgeSnapshot({ partyHpPercent: 45 })
    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: snapshot,
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 100,
        playerMaxHp: 100,
    })

    const { res, counters } = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 999,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(res)
    assertNoLiveBadgeRead(counters.liveBadgeReads)

    const actualMaxHp = Number(res.payload?.battle?.player?.maxHp || 0)
    const expectedMaxHp = assertPlayerMaxHpFromSnapshot({
        actualMaxHp,
        pokemon: partyPokemon,
        snapshot,
    })
    assert.strictEqual(Number(trainerSession.playerMaxHp || 0), expectedMaxHp)
}

const testAttackKeepsSnapshotAfterProfileBadgeChange = async () => {
    const userId = USER_IDS.hydrateThenFreeze
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'HydrateMon',
        level: 24,
        baseHp: 88,
        moves: ['Tackle'],
    })
    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: {},
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 100,
        playerMaxHp: 100,
    })

    const firstRun = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 20,
        throwOnLiveBadgeRead: false,
    })

    assertOkResponse(firstRun.res)
    assert.strictEqual(firstRun.counters.liveBadgeReads > 0, true, 'Expected first run to hydrate snapshot from live badge')
    assert.strictEqual(Number(trainerSession.badgeSnapshot?.partyHpPercent || 0), 20)

    const snapshotAfterFirstRun = JSON.parse(JSON.stringify(trainerSession.badgeSnapshot))
    const expectedMaxHp = assertPlayerMaxHpFromSnapshot({
        actualMaxHp: Number(firstRun.res.payload?.battle?.player?.maxHp || 0),
        pokemon: partyPokemon,
        snapshot: snapshotAfterFirstRun,
    })

    const secondRun = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 80,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(secondRun.res)
    assertNoLiveBadgeRead(secondRun.counters.liveBadgeReads)
    assert.strictEqual(Number(secondRun.res.payload?.battle?.player?.maxHp || 0), expectedMaxHp)
    assertSnapshotUnchanged({
        before: snapshotAfterFirstRun,
        after: trainerSession.badgeSnapshot,
    })
}

const testAttackAppliesEntryHazardsOnForcedOpponentSwitch = async () => {
    const userId = USER_IDS.snapshotOnly
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'Hazard Tester',
        level: 40,
        baseHp: 96,
        moves: ['Tackle'],
    })

    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: createBadgeSnapshot({ partyHpPercent: 10 }),
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 120,
        playerMaxHp: 120,
        team: [
            createTrainerOpponent({
                slot: 0,
                name: 'Lead Opponent',
                currentHp: 1,
                maxHp: 120,
                types: ['normal'],
            }),
            createTrainerOpponent({
                slot: 1,
                name: 'Hazard Target',
                currentHp: 160,
                maxHp: 160,
                types: ['fire'],
            }),
        ],
        currentIndex: 0,
        fieldState: buildOpponentEntryHazardsFieldState({
            spikesLayers: 2,
            stealthRock: true,
            stickyWeb: true,
        }),
    })

    const { res } = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 10,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(res)
    assertForcedSwitchHazardSequence({
        turnPhases: res.payload?.battle?.turnPhases,
        expectedLogSnippets: ['Hazard Target vào sân thay thế.', 'Hazard Target: Stealth Rock'],
        phaseMessage: 'Expected forced_switch phase when lead opponent faints',
    })
}

const testAttackChainsForcedSwitchWhenSpikesKOsIncomingOpponent = async () => {
    const userId = USER_IDS.snapshotOnly
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'Hazard Chain Tester',
        level: 40,
        baseHp: 96,
        moves: ['Tackle'],
    })

    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: createBadgeSnapshot({ partyHpPercent: 10 }),
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 120,
        playerMaxHp: 120,
        team: [
            createTrainerOpponent({
                slot: 0,
                name: 'Lead Opponent',
                currentHp: 1,
                maxHp: 120,
                types: ['normal'],
            }),
            createTrainerOpponent({
                slot: 1,
                name: 'Spike Victim',
                currentHp: 25,
                maxHp: 120,
                types: ['normal'],
            }),
            createTrainerOpponent({
                slot: 2,
                name: 'Final Opponent',
                currentHp: 120,
                maxHp: 120,
                types: ['normal'],
            }),
        ],
        currentIndex: 0,
        fieldState: buildOpponentEntryHazardsFieldState({
            spikesLayers: 3,
        }),
    })

    const { res } = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 10,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(res)
    assert.strictEqual(Number(res.payload?.battle?.opponent?.currentIndex || -1), 2, 'Expected chain switch to third opponent')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[1]?.currentHp || 0), 0, 'Expected second opponent to faint on entry hazards')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[2]?.currentHp || 0), 90, 'Expected third opponent HP to be reduced by Spikes')

    const forcedSwitchPhase = assertForcedSwitchHazardSequence({
        turnPhases: res.payload?.battle?.turnPhases,
        expectedEntryHazardEventCount: 2,
        expectedLogSnippets: [
            'Final Opponent vào sân thay thế.',
            'Spike Victim: Spikes gay',
            'Final Opponent: Spikes gay',
        ],
        phaseMessage: 'Expected forced_switch phase for opponent chain switch',
    })

    const forcedSwitchEvent = (forcedSwitchPhase.events || []).find((event) => event?.kind === 'forced_switch')
    assert.strictEqual(Number(forcedSwitchEvent?.nextIndex || -1), 2)
}

const testAttackStickyWebOnlyAppliesSpeedDropWithoutChainSwitch = async () => {
    const userId = USER_IDS.snapshotOnly
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'Sticky Web Tester',
        level: 36,
        baseHp: 90,
        moves: ['Tackle'],
    })

    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: createBadgeSnapshot({ partyHpPercent: 5 }),
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 120,
        playerMaxHp: 120,
        team: [
            createTrainerOpponent({
                slot: 0,
                name: 'Lead Opponent',
                currentHp: 1,
                maxHp: 100,
                types: ['normal'],
            }),
            createTrainerOpponent({
                slot: 1,
                name: 'Web Target',
                currentHp: 140,
                maxHp: 140,
                types: ['electric'],
                statStages: {},
            }),
        ],
        currentIndex: 0,
        fieldState: buildOpponentEntryHazardsFieldState({
            stickyWeb: true,
        }),
    })

    const { res } = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 5,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(res)
    assert.strictEqual(Number(res.payload?.battle?.opponent?.currentIndex || -1), 1, 'Expected switch to second opponent without chain')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[1]?.currentHp || 0), 140, 'Expected Sticky Web to deal no HP damage')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[1]?.statStages?.spd || 0), -1, 'Expected Sticky Web to apply speed drop')

    assertForcedSwitchHazardSequence({
        turnPhases: res.payload?.battle?.turnPhases,
        expectedEntryHazardEventCount: 1,
        expectedLogSnippets: ['Web Target vào sân thay thế.', 'Web Target: Sticky Web'],
        phaseMessage: 'Expected forced_switch phase for incoming opponent',
    })
}

const testAttackStealthRockAndStickyWebApplyInOrderOnSameSwitchIn = async () => {
    const userId = USER_IDS.snapshotOnly
    const partyPokemon = createPartyPokemon({
        _id: ACTIVE_POKEMON_ID,
        name: 'Mixed Hazard Tester',
        level: 38,
        baseHp: 94,
        moves: ['Tackle'],
    })

    const trainerSession = createTrainerSession({
        trainerId: TRAINER_ID,
        badgeSnapshot: createBadgeSnapshot({ partyHpPercent: 8 }),
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 120,
        playerMaxHp: 120,
        team: [
            createTrainerOpponent({
                slot: 0,
                name: 'Lead Opponent',
                currentHp: 1,
                maxHp: 100,
                types: ['normal'],
            }),
            createTrainerOpponent({
                slot: 1,
                name: 'Rock Web Target',
                currentHp: 160,
                maxHp: 160,
                types: ['fire'],
                statStages: {},
            }),
        ],
        currentIndex: 0,
        fieldState: buildOpponentEntryHazardsFieldState({
            stealthRock: true,
            stickyWeb: true,
        }),
    })

    const { res } = await runAttackRequest({
        userId,
        trainerSession,
        partyRows: [partyPokemon],
        liveBadgeBonusPercent: 8,
        throwOnLiveBadgeRead: true,
    })

    assertOkResponse(res)
    assert.strictEqual(Number(res.payload?.battle?.opponent?.currentIndex || -1), 1, 'Expected switch to second opponent without chain')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[1]?.currentHp || 0), 120, 'Expected Stealth Rock to deal 40 HP to Fire-type target')
    assert.strictEqual(Number(res.payload?.battle?.opponent?.team?.[1]?.statStages?.spd || 0), -1, 'Expected Sticky Web to apply speed drop alongside Stealth Rock')

    assertForcedSwitchHazardSequence({
        turnPhases: res.payload?.battle?.turnPhases,
        expectedEntryHazardEventCount: 2,
        expectedLogSnippets: [
            'Rock Web Target vào sân thay thế.',
            'Rock Web Target: Stealth Rock gay 40 sat thuong khi vao san.',
            'Rock Web Target: Sticky Web lam giam 1 bac Toc do khi vao san.',
        ],
        phaseMessage: 'Expected forced_switch phase for multi-effect hazard switch-in',
    })
}

const main = async () => {
    await testAttackUsesSessionSnapshotWithoutLiveBadgeRead()
    await testAttackKeepsSnapshotAfterProfileBadgeChange()
    await testAttackAppliesEntryHazardsOnForcedOpponentSwitch()
    await testAttackChainsForcedSwitchWhenSpikesKOsIncomingOpponent()
    await testAttackStickyWebOnlyAppliesSpeedDropWithoutChainSwitch()
    await testAttackStealthRockAndStickyWebApplyInOrderOnSameSwitchIn()
    console.log('Battle attack snapshot flow tests passed')
}

main().catch((error) => {
    console.error('Battle attack snapshot flow tests failed:', error)
    process.exitCode = 1
})
