import assert from 'assert'
import inventoryRouter from './routes/inventory.js'
import battleRouter from './routes/game/battle.js'
import UserInventory from './models/UserInventory.js'
import UserPokemon from './models/UserPokemon.js'
import BattleSession from './models/BattleSession.js'
import BattleTrainer from './models/BattleTrainer.js'
import Item from './models/Item.js'
import Move from './models/Move.js'
import BadgeDefinition from './models/BadgeDefinition.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'
import { resolvePlayerBattleMaxHp } from './utils/playerBattleStats.js'
import {
    invalidateCachedActiveBadgeBonuses,
    resolveOrHydrateBattleBadgeSnapshot,
} from './utils/badgeUtils.js'

const IDS = {
    trainer: '64b000000000000000000001',
    item: '64b000000000000000000002',
    badge: '64b000000000000000000003',
    inventory: '64b000000000000000000004',
    userA: '64b000000000000000000011',
    userB: '64b000000000000000000012',
    userC: '64b000000000000000000013',
    userD: '64b000000000000000000014',
    partyA: '64b000000000000000000021',
    partyB: '64b000000000000000000022',
    partyC: '64b000000000000000000023',
}

const inventoryLayer = inventoryRouter.stack.find((layer) => layer?.route?.path === '/use')
const switchLayer = battleRouter.stack.find((layer) => layer?.route?.path === '/battle/trainer/switch')

if (!inventoryLayer || !inventoryLayer?.route?.stack?.length) {
    throw new Error('Cannot resolve /api/inventory/use test handler')
}
if (!switchLayer || !switchLayer?.route?.stack?.length) {
    throw new Error('Cannot resolve /api/game/battle/trainer/switch test handler')
}

const inventoryUseHandler = inventoryLayer.route.stack[inventoryLayer.route.stack.length - 1].handle
const trainerSwitchHandler = switchLayer.route.stack[switchLayer.route.stack.length - 1].handle

const mkRes = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
})

const patchMethod = (patches, target, key, replacement) => {
    patches.push({ target, key, original: target[key] })
    target[key] = replacement
}

const restorePatchedMethods = (patches) => {
    for (let index = patches.length - 1; index >= 0; index -= 1) {
        const entry = patches[index]
        entry.target[entry.key] = entry.original
    }
}

const createFindManyQuery = (rows = []) => ({
    select() { return this },
    populate() { return this },
    sort: async () => rows,
    lean: async () => rows,
})

const createLeanQuery = (doc = null) => ({
    select() { return this },
    populate() { return this },
    sort() { return this },
    lean: async () => doc,
})

const createPopulateQuery = (doc = null) => ({
    populate: async () => doc,
    sort: () => ({ populate: async () => doc }),
})

const createPartyPokemon = ({ _id, name, level, baseHp, rarity = 'd' }) => ({
    _id,
    nickname: `${name} Nick`,
    level,
    formId: 'normal',
    partyIndex: 0,
    pokemonId: {
        _id: `${_id}aa`.slice(0, 24),
        name,
        types: ['normal'],
        rarity,
        baseStats: {
            hp: baseHp,
            atk: 45,
            def: 45,
            spatk: 45,
            spdef: 45,
            spd: 45,
        },
        forms: [],
        defaultFormId: 'normal',
        levelUpMoves: [],
        initialMoves: [],
    },
    saveCalls: 0,
    async save() {
        this.saveCalls += 1
        return this
    },
})

const createTrainerSession = ({
    activePokemonId,
    currentHp,
    maxHp,
    badgeSnapshot = {},
    playerTeam = [],
}) => ({
    _id: '64b000000000000000000099',
    trainerId: IDS.trainer,
    team: [{ name: 'Trainer Opponent', status: 'sleep', statusTurns: 1 }],
    currentIndex: 0,
    playerPokemonId: activePokemonId,
    playerCurrentHp: currentHp,
    playerMaxHp: maxHp,
    playerStatus: '',
    playerStatusTurns: 0,
    playerStatStages: {},
    playerDamageGuards: {},
    playerWasDamagedLastTurn: false,
    playerVolatileState: {},
    fieldState: {},
    badgeSnapshot,
    playerTeam,
    saveCalls: 0,
    async save() {
        this.saveCalls += 1
        return this
    },
})

const createTrainerDoc = () => ({
    _id: IDS.trainer,
    team: [{ pokemonId: { levelUpMoves: [], initialMoves: [] } }],
})

const createItemDoc = (hpHeal = 999) => ({
    _id: IDS.item,
    name: 'Hyper Potion',
    type: 'healing',
    effectType: 'heal',
    effectValue: hpHeal,
    effectValueMp: 0,
})

const createInventoryEntry = (quantity = 3) => ({
    _id: IDS.inventory,
    quantity,
})

const applyBadgeLiveMocks = ({
    patches,
    userId,
    liveHpBonusRef,
    ownedRows = [],
    throwOnLoad = false,
    calls = null,
}) => {
    patchMethod(patches, BadgeDefinition, 'find', () => {
        if (throwOnLoad) {
            throw new Error('Live badge load must not be called for this test')
        }
        if (calls) calls.definitionFind += 1
        return {
            select() { return this },
            sort() { return this },
            lean: async () => [{
                _id: IDS.badge,
                isActive: true,
                missionType: 'collect_total_count',
                missionConfig: { requiredCount: 1 },
                rewardEffects: [{ effectType: 'party_hp_percent', percent: liveHpBonusRef.value }],
            }],
        }
    })

    patchMethod(patches, User, 'findById', () => createLeanQuery({
        _id: userId,
        role: 'user',
        equippedBadgeIds: [IDS.badge],
        completedBattleTrainers: [],
        vipTierLevel: 0,
        catchFailCount: 0,
        totalOnlineMs: 0,
    }))

    patchMethod(patches, PlayerState, 'findOne', () => createLeanQuery({
        userId,
        gold: 0,
        moonPoints: 0,
    }))

    patchMethod(patches, UserPokemon, 'find', () => createFindManyQuery(ownedRows))
}

const runInventoryUse = async ({
    userId,
    body,
    partyRows,
    pokemonById,
    trainerSession,
    inventoryEntry,
    liveHpBonusRef,
    throwOnLiveBadgeLoad = false,
}) => {
    const patches = []
    try {
        applyBadgeLiveMocks({
            patches,
            userId,
            liveHpBonusRef,
            ownedRows: partyRows,
            throwOnLoad: throwOnLiveBadgeLoad,
        })

        patchMethod(patches, Item, 'findById', () => ({ lean: async () => createItemDoc(999) }))
        patchMethod(patches, UserInventory, 'findOne', async () => inventoryEntry)
        patchMethod(patches, UserInventory, 'findOneAndUpdate', async () => {
            if (inventoryEntry.quantity <= 0) return null
            inventoryEntry.quantity = Math.max(0, inventoryEntry.quantity - 1)
            return { _id: IDS.inventory, quantity: inventoryEntry.quantity }
        })
        patchMethod(patches, UserInventory, 'deleteOne', async () => ({ acknowledged: true }))
        patchMethod(patches, BattleSession, 'findOne', async () => trainerSession)
        patchMethod(patches, BattleTrainer, 'findById', () => createLeanQuery(createTrainerDoc()))
        patchMethod(patches, Move, 'find', () => ({
            select() { return this },
            lean: async () => [],
        }))

        patchMethod(patches, UserPokemon, 'findOne', (query = {}) => {
            const normalizedId = String(query?._id || '').trim()
            const resolvedDoc = normalizedId
                ? (pokemonById.get(normalizedId) || null)
                : (partyRows[0] || null)
            return createPopulateQuery(resolvedDoc)
        })

        patchMethod(patches, UserPokemon, 'find', () => createFindManyQuery(partyRows))

        const req = { user: { userId }, body }
        const res = mkRes()
        await inventoryUseHandler(req, res)
        return { res }
    } finally {
        restorePatchedMethods(patches)
    }
}

const runTrainerSwitch = async ({
    userId,
    body,
    partyRows,
    pokemonById,
    trainerSession,
    liveHpBonusRef,
    throwOnLiveBadgeLoad = false,
}) => {
    const patches = []
    try {
        applyBadgeLiveMocks({
            patches,
            userId,
            liveHpBonusRef,
            ownedRows: partyRows,
            throwOnLoad: throwOnLiveBadgeLoad,
        })

        patchMethod(patches, BattleTrainer, 'findById', () => createLeanQuery(createTrainerDoc()))
        patchMethod(patches, BattleSession, 'findOne', async () => trainerSession)
        patchMethod(patches, Move, 'find', () => ({
            select() { return this },
            lean: async () => [],
        }))

        patchMethod(patches, UserPokemon, 'findOne', (query = {}) => {
            const normalizedId = String(query?._id || '').trim()
            return createPopulateQuery(pokemonById.get(normalizedId) || null)
        })
        patchMethod(patches, UserPokemon, 'find', () => createFindManyQuery(partyRows))

        const req = { user: { userId }, body }
        const res = mkRes()
        let nextError = null
        await trainerSwitchHandler(req, res, (error) => {
            nextError = error || null
        })
        if (nextError) throw nextError
        return { res }
    } finally {
        restorePatchedMethods(patches)
    }
}

const testTrainerHealClampUsesSnapshot = async () => {
    const userId = IDS.userA
    await invalidateCachedActiveBadgeBonuses(userId)

    const hpBonusPercent = 50
    const activePokemon = createPartyPokemon({ _id: IDS.partyA, name: 'Alpha', level: 12, baseHp: 80 })
    const expectedMaxHp = resolvePlayerBattleMaxHp({
        baseHp: activePokemon.pokemonId.baseStats.hp,
        level: activePokemon.level,
        rarity: activePokemon.pokemonId.rarity,
        hpBonusPercent,
    })
    const trainerSession = createTrainerSession({
        activePokemonId: IDS.partyA,
        currentHp: 20,
        maxHp: expectedMaxHp,
        badgeSnapshot: {
            partyDamagePercent: 0,
            partySpeedPercent: 0,
            partyHpPercent: hpBonusPercent,
            typeDamagePercentByType: {},
        },
        playerTeam: [],
    })

    const { res } = await runInventoryUse({
        userId,
        body: {
            itemId: IDS.item,
            quantity: 1,
            activePokemonId: IDS.partyA,
            context: {
                mode: 'trainer',
                trainerId: IDS.trainer,
                playerCurrentHp: 20,
                playerMaxHp: 9999,
            },
        },
        partyRows: [activePokemon],
        pokemonById: new Map([[IDS.partyA, activePokemon]]),
        trainerSession,
        inventoryEntry: createInventoryEntry(2),
        liveHpBonusRef: { value: 999 },
        throwOnLiveBadgeLoad: true,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload?.effect?.hpContext, 'battle')
    assert.strictEqual(res.payload?.effect?.maxHp, expectedMaxHp)
    assert.strictEqual(res.payload?.effect?.hp, expectedMaxHp)
    assert.strictEqual(trainerSession.badgeSnapshot?.partyHpPercent, hpBonusPercent)
}

const testTrainerSwitchUsesSnapshotForTarget = async () => {
    const userId = IDS.userB
    await invalidateCachedActiveBadgeBonuses(userId)

    const hpBonusPercent = 30
    const first = createPartyPokemon({ _id: IDS.partyA, name: 'Alpha', level: 15, baseHp: 70 })
    const second = createPartyPokemon({ _id: IDS.partyB, name: 'Beta', level: 15, baseHp: 110 })
    const expectedSecondMaxHp = resolvePlayerBattleMaxHp({
        baseHp: second.pokemonId.baseStats.hp,
        level: second.level,
        rarity: second.pokemonId.rarity,
        hpBonusPercent,
    })

    const trainerSession = createTrainerSession({
        activePokemonId: IDS.partyA,
        currentHp: 40,
        maxHp: resolvePlayerBattleMaxHp({
            baseHp: first.pokemonId.baseStats.hp,
            level: first.level,
            rarity: first.pokemonId.rarity,
            hpBonusPercent,
        }),
        badgeSnapshot: {
            partyDamagePercent: 0,
            partySpeedPercent: 0,
            partyHpPercent: hpBonusPercent,
            typeDamagePercentByType: {},
        },
        playerTeam: [],
    })

    const { res } = await runTrainerSwitch({
        userId,
        body: {
            trainerId: IDS.trainer,
            activePokemonId: IDS.partyB,
            playerCurrentHp: expectedSecondMaxHp,
            playerMaxHp: expectedSecondMaxHp,
        },
        partyRows: [first, second],
        pokemonById: new Map([
            [IDS.partyA, first],
            [IDS.partyB, second],
        ]),
        trainerSession,
        liveHpBonusRef: { value: 999 },
        throwOnLiveBadgeLoad: true,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(String(res.payload?.player?.pokemonId || ''), IDS.partyB)
    assert.strictEqual(res.payload?.player?.maxHp, expectedSecondMaxHp)
    assert.strictEqual(trainerSession.playerMaxHp, expectedSecondMaxHp)
    assert.strictEqual(trainerSession.badgeSnapshot?.partyHpPercent, hpBonusPercent)
}

const testProfileBadgeChangeDoesNotAffectActiveSnapshot = async () => {
    const userId = IDS.userC
    await invalidateCachedActiveBadgeBonuses(userId)

    const liveHpBonusRef = { value: 20 }
    const activePokemon = createPartyPokemon({ _id: IDS.partyC, name: 'Gamma', level: 20, baseHp: 95 })
    const expectedMaxHpFromSnapshotA = resolvePlayerBattleMaxHp({
        baseHp: activePokemon.pokemonId.baseStats.hp,
        level: activePokemon.level,
        rarity: activePokemon.pokemonId.rarity,
        hpBonusPercent: 20,
    })
    const trainerSession = createTrainerSession({
        activePokemonId: IDS.partyC,
        currentHp: 30,
        maxHp: expectedMaxHpFromSnapshotA,
        badgeSnapshot: {},
        playerTeam: [],
    })

    const firstRun = await runInventoryUse({
        userId,
        body: {
            itemId: IDS.item,
            quantity: 1,
            activePokemonId: IDS.partyC,
            context: {
                mode: 'trainer',
                trainerId: IDS.trainer,
                playerCurrentHp: 30,
                playerMaxHp: 9999,
            },
        },
        partyRows: [activePokemon],
        pokemonById: new Map([[IDS.partyC, activePokemon]]),
        trainerSession,
        inventoryEntry: createInventoryEntry(3),
        liveHpBonusRef,
    })

    assert.strictEqual(firstRun.res.statusCode, 200)
    assert.strictEqual(firstRun.res.payload?.effect?.maxHp, expectedMaxHpFromSnapshotA)
    assert.strictEqual(trainerSession.badgeSnapshot?.partyHpPercent, 20)

    trainerSession.team[0].status = 'sleep'
    trainerSession.team[0].statusTurns = 1
    trainerSession.playerCurrentHp = 10
    liveHpBonusRef.value = 80
    await invalidateCachedActiveBadgeBonuses(userId)

    const secondRun = await runInventoryUse({
        userId,
        body: {
            itemId: IDS.item,
            quantity: 1,
            activePokemonId: IDS.partyC,
            context: {
                mode: 'trainer',
                trainerId: IDS.trainer,
                playerCurrentHp: 10,
                playerMaxHp: 9999,
            },
        },
        partyRows: [activePokemon],
        pokemonById: new Map([[IDS.partyC, activePokemon]]),
        trainerSession,
        inventoryEntry: createInventoryEntry(3),
        liveHpBonusRef,
        throwOnLiveBadgeLoad: true,
    })

    assert.strictEqual(secondRun.res.statusCode, 200)
    assert.strictEqual(secondRun.res.payload?.effect?.maxHp, expectedMaxHpFromSnapshotA)
    assert.strictEqual(trainerSession.badgeSnapshot?.partyHpPercent, 20)
}

const testLegacySessionHydratesSnapshotOnce = async () => {
    const userId = IDS.userD
    await invalidateCachedActiveBadgeBonuses(userId)

    const liveHpBonusRef = { value: 35 }
    const calls = { definitionFind: 0 }
    const patches = []
    try {
        const ownedRows = [createPartyPokemon({ _id: IDS.partyA, name: 'Delta', level: 8, baseHp: 60 })]
        applyBadgeLiveMocks({
            patches,
            userId,
            liveHpBonusRef,
            ownedRows,
            calls,
        })

        const session = { badgeSnapshot: {} }
        const firstSummary = await resolveOrHydrateBattleBadgeSnapshot(session, userId)
        assert.strictEqual(firstSummary.partyHpPercent, 35)
        assert.strictEqual(session.badgeSnapshot?.partyHpPercent, 35)
        assert.strictEqual(calls.definitionFind, 1)

        liveHpBonusRef.value = 70
        await invalidateCachedActiveBadgeBonuses(userId)

        const secondSummary = await resolveOrHydrateBattleBadgeSnapshot(session, userId)
        assert.strictEqual(secondSummary.partyHpPercent, 35)
        assert.strictEqual(session.badgeSnapshot?.partyHpPercent, 35)
        assert.strictEqual(calls.definitionFind, 1)
    } finally {
        restorePatchedMethods(patches)
        await invalidateCachedActiveBadgeBonuses(userId)
    }
}

const main = async () => {
    await testTrainerHealClampUsesSnapshot()
    await testTrainerSwitchUsesSnapshotForTarget()
    await testProfileBadgeChangeDoesNotAffectActiveSnapshot()
    await testLegacySessionHydratesSnapshotOnce()
    console.log('Battle badge snapshot flow tests passed')
}

main().catch((error) => {
    console.error('Battle badge snapshot flow tests failed:', error)
    process.exitCode = 1
})
