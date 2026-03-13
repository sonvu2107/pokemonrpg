import assert from 'assert'
import battleRouter from './routes/game/battle.js'
import BattleSession from './models/BattleSession.js'
import BattleTrainer from './models/BattleTrainer.js'
import UserPokemon from './models/UserPokemon.js'
import PlayerState from './models/PlayerState.js'
import BadgeDefinition from './models/BadgeDefinition.js'
import {
    createMethodPatchHarness,
    createMockReq,
    createMockRes,
    getRouteHandler,
    runRouteHandler,
} from './test/helpers/routeTestHarness.js'
import {
    createBadgeSnapshot,
    createTrainerSession,
    createTrainerDoc,
} from './test/helpers/battleSessionFactory.js'
import {
    assertNoLiveBadgeRead,
    assertSnapshotUnchanged,
} from './test/helpers/battleAssertions.js'

const USER_ID = '64b000000000000000001201'
const TRAINER_ID = '64b000000000000000000001'
const ACTIVE_POKEMON_ID = '64b000000000000000001299'

const resolveHandler = getRouteHandler(battleRouter, '/battle/resolve', { handlerIndex: 'last' })

const createLeanDocQuery = (doc = null) => ({
    select() { return this },
    sort() { return this },
    populate() { return this },
    lean: async () => doc,
})

const runResolveRequest = async ({
    activeSession,
    claimedSession,
    defeatedPokemonDoc = null,
    throwOnLiveBadgeRead = true,
}) => {
    const patchHarness = createMethodPatchHarness()
    const counters = {
        liveBadgeReads: 0,
        deleteCalls: 0,
    }

    try {
        patchHarness.patch(BadgeDefinition, 'find', () => {
            if (throwOnLiveBadgeRead) {
                throw new Error('Unexpected live badge read during battle resolve')
            }
            counters.liveBadgeReads += 1
            return {
                select() { return this },
                sort() { return this },
                lean: async () => [],
            }
        })

        patchHarness.patch(BattleTrainer, 'findById', () => createLeanDocQuery(createTrainerDoc({ _id: TRAINER_ID })))
        patchHarness.patch(BattleSession, 'findOne', () => createLeanDocQuery(activeSession))
        patchHarness.patch(BattleSession, 'findOneAndDelete', async () => {
            counters.deleteCalls += 1
            return claimedSession
        })
        patchHarness.patch(PlayerState, 'findOne', () => createLeanDocQuery({
            userId: USER_ID,
            gold: 100,
            moonPoints: 10,
        }))
        patchHarness.patch(UserPokemon, 'findOne', () => createLeanDocQuery(defeatedPokemonDoc))

        const req = createMockReq({
            userId: USER_ID,
            body: {
                trainerId: TRAINER_ID,
            },
        })
        const res = createMockRes()

        await runRouteHandler(resolveHandler, { req, res })
        return { res, counters }
    } finally {
        patchHarness.restore()
    }
}

const testResolveUsesSessionTeamStateForEndCondition = async () => {
    const activeSession = {
        _id: '64b000000000000000001301',
        currentIndex: 0,
        team: [{ slot: 0 }],
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 0,
        playerMaxHp: 240,
        playerTeam: [{
            userPokemonId: ACTIVE_POKEMON_ID,
            name: 'Still Alive',
            currentHp: 5,
            maxHp: 240,
        }],
        knockoutCounts: [],
    }

    const { res, counters } = await runResolveRequest({
        activeSession,
        claimedSession: null,
        defeatedPokemonDoc: null,
        throwOnLiveBadgeRead: true,
    })

    assert.strictEqual(res.statusCode, 400)
    assert(String(res.payload?.message || '').includes('chưa kết thúc'))
    assert.strictEqual(counters.deleteCalls, 0, 'Expected unresolved battle to skip session claim delete')
    assertNoLiveBadgeRead(counters.liveBadgeReads)
}

const testResolveDefeatBranchKeepsSnapshotAndAvoidsLiveBadgeRead = async () => {
    const snapshot = createBadgeSnapshot({ partyHpPercent: 33 })
    const activeSession = {
        _id: '64b000000000000000001302',
        currentIndex: 0,
        team: [{ slot: 0 }],
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 999,
        playerMaxHp: 210,
        playerTeam: [{
            userPokemonId: ACTIVE_POKEMON_ID,
            name: 'Legacy Snapshot User',
            currentHp: 0,
            maxHp: 210,
        }],
        knockoutCounts: [],
        badgeSnapshot: snapshot,
    }

    const claimedSession = createTrainerSession({
        _id: '64b000000000000000001303',
        trainerId: TRAINER_ID,
        badgeSnapshot: snapshot,
        playerPokemonId: ACTIVE_POKEMON_ID,
        playerCurrentHp: 999,
        playerMaxHp: 210,
        playerTeam: [{
            userPokemonId: ACTIVE_POKEMON_ID,
            name: 'Legacy Snapshot User',
            currentHp: 0,
            maxHp: 210,
        }],
        team: [{ slot: 0 }],
        currentIndex: 0,
    })

    const snapshotBeforeResolve = JSON.parse(JSON.stringify(claimedSession.badgeSnapshot))

    const defeatedPokemonDoc = {
        _id: ACTIVE_POKEMON_ID,
        nickname: 'Snapshot Hero',
        level: 35,
        experience: 1200,
        formId: 'normal',
        isShiny: false,
        obtainedVipMapLevel: 0,
        pokemonId: {
            name: 'Snapshot Hero Species',
            imageUrl: 'https://img.test/snapshot.png',
            sprites: {},
            forms: [],
            defaultFormId: 'normal',
        },
    }

    const { res, counters } = await runResolveRequest({
        activeSession,
        claimedSession,
        defeatedPokemonDoc,
        throwOnLiveBadgeRead: true,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload?.results?.resultType, 'defeat')
    assert.strictEqual(res.payload?.results?.pokemon?.name, 'Snapshot Hero')
    assert.strictEqual(counters.deleteCalls, 1)
    assertNoLiveBadgeRead(counters.liveBadgeReads)
    assertSnapshotUnchanged({
        before: snapshotBeforeResolve,
        after: claimedSession.badgeSnapshot,
    })
}

const main = async () => {
    await testResolveUsesSessionTeamStateForEndCondition()
    await testResolveDefeatBranchKeepsSnapshotAndAvoidsLiveBadgeRead()
    console.log('Battle resolve snapshot flow tests passed')
}

main().catch((error) => {
    console.error('Battle resolve snapshot flow tests failed:', error)
    process.exitCode = 1
})
