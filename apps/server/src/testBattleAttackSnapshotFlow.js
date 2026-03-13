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
    createTrainerSession,
    createTrainerDoc,
} from './test/helpers/battleSessionFactory.js'
import {
    assertNoLiveBadgeRead,
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

const main = async () => {
    await testAttackUsesSessionSnapshotWithoutLiveBadgeRead()
    await testAttackKeepsSnapshotAfterProfileBadgeChange()
    console.log('Battle attack snapshot flow tests passed')
}

main().catch((error) => {
    console.error('Battle attack snapshot flow tests failed:', error)
    process.exitCode = 1
})
