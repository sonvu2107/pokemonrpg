import assert from 'assert'
import inventoryRouter from './routes/inventory.js'
import UserInventory from './models/UserInventory.js'
import PlayerState from './models/PlayerState.js'
import UserPokemon from './models/UserPokemon.js'
import BattleSession from './models/BattleSession.js'
import Item from './models/Item.js'
import { calcMaxHp } from './utils/gameUtils.js'

const IDS = {
    user: '64b000000000000000000001',
    item: '64b000000000000000000002',
    trainer: '64b000000000000000000003',
    active: '64b000000000000000000004',
    switched: '64b000000000000000000005',
    old: '64b000000000000000000006',
}

const routeLayer = inventoryRouter.stack.find((layer) => layer?.route?.path === '/use')
if (!routeLayer || routeLayer?.route?.stack?.length < 2) {
    throw new Error('Cannot resolve /api/inventory/use test handler')
}
const useItemHandler = routeLayer.route.stack[1].handle

const mkRes = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
})

const mkEntry = (quantity = 3) => ({
    quantity,
    saveCalls: 0,
    deleteCalls: 0,
    async save() { this.saveCalls += 1; return this },
    async deleteOne() { this.deleteCalls += 1; return this },
})

const mkPlayerState = ({ hp = 50, maxHp = 100 } = {}) => ({
    hp,
    maxHp,
    saveCalls: 0,
    async save() { this.saveCalls += 1; return this },
})

const mkSession = ({
    playerPokemonId = IDS.active,
    playerCurrentHp = 40,
    playerMaxHp = 100,
    team = [{ slot: 0 }],
    currentIndex = 0,
} = {}) => ({
    trainerId: IDS.trainer,
    playerPokemonId,
    playerCurrentHp,
    playerMaxHp,
    team,
    currentIndex,
    saveCalls: 0,
    async save() { this.saveCalls += 1; return this },
})

const mkPokemon = ({ _id = IDS.active, level = 10, baseHp = 80, rarity = 'd' } = {}) => ({
    _id,
    level,
    pokemonId: {
        baseStats: { hp: baseHp },
        rarity,
    },
    movePpState: [],
    saveCalls: 0,
    async save() { this.saveCalls += 1; return this },
})

const mkItem = ({ hp = 20, pp = 0 } = {}) => ({
    _id: IDS.item,
    type: 'healing',
    effectType: 'heal',
    effectValue: hp,
    effectValueMp: pp,
})

const mkBody = ({
    mode = 'trainer',
    trainerId = IDS.trainer,
    activePokemonId = IDS.active,
    playerCurrentHp,
    playerMaxHp,
} = {}) => ({
    itemId: IDS.item,
    quantity: 1,
    activePokemonId,
    context: {
        mode,
        trainerId,
        ...(Number.isFinite(playerCurrentHp) ? { playerCurrentHp } : {}),
        ...(Number.isFinite(playerMaxHp) ? { playerMaxHp } : {}),
    },
})

const queryOf = (doc) => ({
    populate: async () => doc,
    sort: () => ({ populate: async () => doc }),
})

const hasLogTag = (logs, tag) => logs.some((entry) => String(entry?.args?.[0] || '') === tag)

const runUseItem = async ({
    body,
    item,
    entry,
    session = null,
    playerState = null,
    pokemonById = new Map(),
    fallbackPokemon = null,
    captureLogs = false,
}) => {
    const originals = {
        itemFindById: Item.findById,
        invFindOne: UserInventory.findOne,
        playerFindOne: PlayerState.findOne,
        sessionFindOne: BattleSession.findOne,
        userPokemonFindOne: UserPokemon.findOne,
        warn: console.warn,
        info: console.info,
    }

    const logs = []
    const calls = { playerStateFindOne: 0 }

    try {
        Item.findById = () => ({ lean: async () => item })
        UserInventory.findOne = async () => entry
        PlayerState.findOne = async () => {
            calls.playerStateFindOne += 1
            return playerState
        }
        BattleSession.findOne = async () => session
        UserPokemon.findOne = (query = {}) => {
            if (query?._id) return queryOf(pokemonById.get(String(query._id)) || null)
            return queryOf(fallbackPokemon)
        }

        if (captureLogs) {
            console.warn = (...args) => logs.push({ level: 'warn', args })
            console.info = (...args) => logs.push({ level: 'info', args })
        }

        const req = { user: { userId: IDS.user }, body }
        const res = mkRes()
        await useItemHandler(req, res)
        return { res, logs, calls }
    } finally {
        Item.findById = originals.itemFindById
        UserInventory.findOne = originals.invFindOne
        PlayerState.findOne = originals.playerFindOne
        BattleSession.findOne = originals.sessionFindOne
        UserPokemon.findOne = originals.userPokemonFindOne
        console.warn = originals.warn
        console.info = originals.info
    }
}

const testTrainerHeal = async () => {
    const entry = mkEntry(3)
    const session = mkSession({ playerPokemonId: IDS.active, playerCurrentHp: 40, playerMaxHp: 100 })
    const active = mkPokemon({ _id: IDS.active, level: 10, baseHp: 80 })

    const { res, calls } = await runUseItem({
        body: mkBody({ mode: 'trainer', activePokemonId: IDS.active }),
        item: mkItem({ hp: 20 }),
        entry,
        session,
        playerState: mkPlayerState({ hp: 90, maxHp: 120 }),
        pokemonById: new Map([[IDS.active, active]]),
        fallbackPokemon: active,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload?.effect?.hpContext, 'battle')
    assert.strictEqual(session.playerCurrentHp, 60)
    assert.strictEqual(entry.quantity, 2)
    assert.strictEqual(calls.playerStateFindOne, 0)
}

const testSwitchThenHeal = async () => {
    const entry = mkEntry(3)
    const session = mkSession({ playerPokemonId: IDS.old, playerCurrentHp: 85, playerMaxHp: 120 })
    const switched = mkPokemon({ _id: IDS.switched, level: 10, baseHp: 100 })

    const { res } = await runUseItem({
        body: mkBody({ mode: 'trainer', activePokemonId: IDS.switched, playerCurrentHp: 30, playerMaxHp: 90 }),
        item: mkItem({ hp: 15 }),
        entry,
        session,
        playerState: mkPlayerState(),
        pokemonById: new Map([[IDS.switched, switched]]),
        fallbackPokemon: switched,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(session.playerPokemonId, IDS.switched)
    assert.strictEqual(session.playerCurrentHp, 45)
    assert.strictEqual(session.playerMaxHp, 90)
    assert.strictEqual(entry.quantity, 2)
}

const testTrainerMissingSession = async () => {
    const entry = mkEntry(4)
    const active = mkPokemon({ _id: IDS.active })
    const { res, logs } = await runUseItem({
        body: mkBody({ mode: 'trainer', activePokemonId: IDS.active }),
        item: mkItem({ hp: 20 }),
        entry,
        session: null,
        playerState: mkPlayerState(),
        pokemonById: new Map([[IDS.active, active]]),
        fallbackPokemon: active,
        captureLogs: true,
    })

    assert.strictEqual(res.statusCode, 409)
    assert.strictEqual(entry.quantity, 4)
    assert.strictEqual(entry.saveCalls, 0)
    assert(hasLogTag(logs, 'inventory_use_trainer_session_missing'))
}

const testBlockedMode = async () => {
    const entry = mkEntry(2)
    const { res, logs } = await runUseItem({
        body: mkBody({ mode: 'duel', activePokemonId: IDS.active }),
        item: mkItem({ hp: 20 }),
        entry,
        captureLogs: true,
    })

    assert.strictEqual(res.statusCode, 403)
    assert.strictEqual(entry.quantity, 2)
    assert.strictEqual(entry.saveCalls, 0)
    assert(hasLogTag(logs, 'inventory_use_blocked_mode'))
}

const testNoEffectItem = async () => {
    const entry = mkEntry(3)
    const { res, logs } = await runUseItem({
        body: mkBody({ mode: 'trainer', activePokemonId: IDS.active }),
        item: mkItem({ hp: 0, pp: 0 }),
        entry,
        captureLogs: true,
    })

    assert.strictEqual(res.statusCode, 400)
    assert(String(res.payload?.message || '').includes('không có hiệu ứng hồi phục'))
    assert.strictEqual(entry.quantity, 3)
    assert(hasLogTag(logs, 'inventory_use_no_effect'))
}

const testStaleSession = async () => {
    const entry = mkEntry(3)
    const stale = mkSession({ team: [], currentIndex: 0 })
    const active = mkPokemon({ _id: IDS.active })

    const { res, logs } = await runUseItem({
        body: mkBody({ mode: 'trainer', activePokemonId: IDS.active }),
        item: mkItem({ hp: 20 }),
        entry,
        session: stale,
        pokemonById: new Map([[IDS.active, active]]),
        fallbackPokemon: active,
        captureLogs: true,
    })

    assert.strictEqual(res.statusCode, 409)
    assert.strictEqual(entry.quantity, 3)
    assert(hasLogTag(logs, 'inventory_use_trainer_session_missing'))
}

const testClampInflatedMaxHp = async () => {
    const entry = mkEntry(3)
    const session = mkSession({ playerPokemonId: IDS.old, playerCurrentHp: 10, playerMaxHp: 50 })
    const switched = mkPokemon({ _id: IDS.switched, level: 5, baseHp: 60, rarity: 'd' })
    const canonical = calcMaxHp(60, 5, 'd')

    const { res } = await runUseItem({
        body: mkBody({
            mode: 'trainer',
            activePokemonId: IDS.switched,
            playerCurrentHp: 20,
            playerMaxHp: 9999,
        }),
        item: mkItem({ hp: 10 }),
        entry,
        session,
        pokemonById: new Map([[IDS.switched, switched]]),
        fallbackPokemon: switched,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(session.playerMaxHp, canonical)
    assert.strictEqual(res.payload?.effect?.maxHp, canonical)
    assert.strictEqual(session.playerCurrentHp, 30)
    assert.strictEqual(entry.quantity, 2)
}

const main = async () => {
    await testTrainerHeal()
    await testSwitchThenHeal()
    await testTrainerMissingSession()
    await testBlockedMode()
    await testNoEffectItem()
    await testStaleSession()
    await testClampInflatedMaxHp()
    console.log('Inventory healing flow tests passed')
}

main().catch((error) => {
    console.error('Inventory healing flow tests failed:', error)
    process.exitCode = 1
})
