import assert from 'assert'
import pokemonRouter from './routes/pokemon.js'
import partyRouter from './routes/party.js'
import UserPokemon from './models/UserPokemon.js'
import UserInventory from './models/UserInventory.js'
import Item from './models/Item.js'
import MarketListing from './models/MarketListing.js'
import Pokemon from './models/Pokemon.js'
import {
    createMethodPatchHarness,
    createMockReq,
    createMockRes,
    getRouteHandler,
    runRouteHandler,
    withMockedRandom,
} from './test/helpers/routeTestHarness.js'
import { resolveUserPokemonFinalStats } from './utils/userPokemonStats.js'

const IDS = {
    user: '64b0000000000000000000a1',
    target: '64b0000000000000000000a2',
    material: '64b0000000000000000000a3',
    speciesA: '64b0000000000000000000b1',
    speciesB: '64b0000000000000000000b2',
    fusionStone: '64b0000000000000000000c1',
    protectStone: '64b0000000000000000000c2',
}

const fusionHandler = getRouteHandler(pokemonRouter, '/:id/fusion', { handlerIndex: 'last' })
const detailHandler = getRouteHandler(pokemonRouter, '/:id', { handlerIndex: 'last' })
const partyHandler = getRouteHandler(partyRouter, '/', { handlerIndex: 'last' })

const createThenableDocQuery = (doc = null) => ({
    select() { return this },
    populate() { return this },
    session() { return this },
    then(resolve, reject) {
        return Promise.resolve(doc).then(resolve, reject)
    },
})

const createItemFindQuery = (rows = []) => ({
    select() { return this },
    session() { return this },
    lean: async () => rows,
})

const createListQuery = (rows = []) => ({
    select() { return this },
    populate() { return this },
    sort() { return Promise.resolve(rows) },
    session() { return this },
    lean: async () => rows,
})

const createLeanQuery = (doc = null) => ({
    select() { return this },
    populate() { return this },
    sort() { return this },
    session() { return this },
    lean: async () => doc,
})

const createAggregateQuery = (rows = []) => ({
    allowDiskUse: async () => rows,
})

const createPokemonDoc = ({
    _id,
    speciesId,
    speciesName,
    rarity,
    nickname,
    level,
    fusionLevel,
    formId = 'normal',
    ivs = {},
    evs = {},
    isShiny = false,
    moves = [],
    movePpState = [],
}) => ({
    _id,
    userId: IDS.user,
    pokemonId: {
        _id: speciesId,
        name: speciesName,
        rarity,
        baseStats: {
            hp: 110,
            atk: 90,
            def: 80,
            spatk: 70,
            spdef: 65,
            spd: 60,
        },
        forms: [],
        defaultFormId: 'normal',
        types: ['normal'],
        levelUpMoves: [],
        initialMoves: [],
        sprites: {
            normal: '',
            shiny: '',
            icon: '',
        },
        evolution: null,
    },
    nickname,
    level,
    formId,
    fusionLevel,
    location: 'box',
    isShiny,
    moves,
    movePpState,
    ivs,
    evs,
    saveCalls: 0,
    async save() {
        this.saveCalls += 1
        return this
    },
    toObject() {
        return {
            _id: this._id,
            userId: this.userId,
            pokemonId: this.pokemonId,
            nickname: this.nickname,
            level: this.level,
            formId: this.formId,
            fusionLevel: this.fusionLevel,
            location: this.location,
            partyIndex: this.partyIndex ?? null,
            boxNumber: this.boxNumber ?? null,
            isShiny: Boolean(this.isShiny),
            moves: Array.isArray(this.moves) ? [...this.moves] : [],
            movePpState: Array.isArray(this.movePpState) ? [...this.movePpState] : [],
            ivs: this.ivs && typeof this.ivs === 'object' ? { ...this.ivs } : {},
            evs: this.evs && typeof this.evs === 'object' ? { ...this.evs } : {},
        }
    },
})

const runFusionRequest = async ({
    targetPokemon,
    materialPokemon,
    itemRows,
    initialInventoryByItemId,
    body = {},
    randomValue = 0,
    forceMaterialDeleteConflict = false,
    afterRun = null,
}) => {
    const patchHarness = createMethodPatchHarness()
    const inventoryByItemId = new Map(Object.entries(initialInventoryByItemId || {}).map(([key, value]) => [String(key), Number(value || 0)]))
    const pokemonById = new Map([
        [String(targetPokemon?._id || ''), targetPokemon],
        [String(materialPokemon?._id || ''), materialPokemon],
    ])
    const rollbackState = {
        inventoryUpserts: 0,
        targetRollbacks: 0,
        materialDeletedCount: 0,
    }

    try {
        patchHarness.patch(UserPokemon, 'findOne', (query = {}) => {
            const id = String(query?._id || '').trim()
            const userId = String(query?.userId || '').trim()
            const location = String(query?.location || '').trim()
            const doc = (userId === IDS.user && location === 'box')
                ? (pokemonById.get(id) || null)
                : null
            return createThenableDocQuery(doc)
        })

        patchHarness.patch(UserPokemon, 'findById', (id = '') => {
            const doc = pokemonById.get(String(id || '').trim()) || null
            return createLeanQuery(doc ? doc.toObject() : null)
        })

        patchHarness.patch(UserPokemon, 'find', (query = {}) => {
            const userId = String(query?.userId || '').trim()
            const location = String(query?.location || '').trim()
            const rows = [...pokemonById.values()]
                .filter((entry) => {
                    if (userId && String(entry?.userId || '').trim() !== userId) return false
                    if (location && String(entry?.location || '').trim() !== location) return false
                    return true
                })
                .sort((left, right) => Number(left?.partyIndex ?? 9999) - Number(right?.partyIndex ?? 9999))
            return createListQuery(rows)
        })

        patchHarness.patch(UserPokemon, 'aggregate', (pipeline = []) => {
            const rows = [...pokemonById.values()].filter((entry) => String(entry?.location || '') !== 'released')
            const hasTotalGroup = Array.isArray(pipeline)
                && pipeline.some((stage) => stage?.$group && stage.$group._id === null)

            if (hasTotalGroup) {
                return createAggregateQuery([{ _id: null, total: rows.length }])
            }

            const grouped = new Map()
            rows.forEach((entry) => {
                const key = String(entry?.pokemonId?._id || '').trim()
                if (!key) return
                grouped.set(key, Number(grouped.get(key) || 0) + 1)
            })
            return createAggregateQuery(
                [...grouped.entries()].map(([key, count]) => ({ _id: key, count }))
            )
        })

        patchHarness.patch(UserPokemon, 'deleteOne', async (query = {}) => {
            const id = String(query?._id || '').trim()
            const existing = pokemonById.get(id)
            if (!existing) return { acknowledged: true, deletedCount: 0 }
            if (forceMaterialDeleteConflict && id === IDS.material) {
                return { acknowledged: true, deletedCount: 0 }
            }
            pokemonById.delete(id)
            rollbackState.materialDeletedCount += 1
            return { acknowledged: true, deletedCount: 1 }
        })

        patchHarness.patch(UserPokemon, 'updateOne', async (query = {}, update = {}) => {
            const id = String(query?._id || '').trim()
            const doc = pokemonById.get(id)
            if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }
            if (Object.prototype.hasOwnProperty.call(update?.$set || {}, 'fusionLevel')) {
                doc.fusionLevel = Number(update.$set.fusionLevel || 0)
                rollbackState.targetRollbacks += 1
            }
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
        })

        patchHarness.patch(Item, 'find', (query = {}) => {
            const ids = Array.isArray(query?._id?.$in) ? query._id.$in.map((value) => String(value)) : []
            const rows = (Array.isArray(itemRows) ? itemRows : []).filter((entry) => ids.includes(String(entry?._id || '')))
            return createItemFindQuery(rows)
        })

        patchHarness.patch(MarketListing, 'find', () => createLeanQuery([]))
        patchHarness.patch(Pokemon, 'findOne', () => createLeanQuery(null))
        patchHarness.patch(Pokemon, 'findById', () => createLeanQuery(null))

        patchHarness.patch(UserInventory, 'findOneAndUpdate', async (query = {}, update = {}) => {
            const itemId = String(query?.itemId || '').trim()
            const currentQuantity = Number(inventoryByItemId.get(itemId) || 0)
            const requiredQuantity = Number(query?.quantity?.$gte || 0)
            if (currentQuantity < requiredQuantity) {
                return null
            }
            const incQuantity = Number(update?.$inc?.quantity || 0)
            const nextQuantity = currentQuantity + incQuantity
            inventoryByItemId.set(itemId, nextQuantity)
            return {
                _id: `inv-${itemId}`,
                userId: IDS.user,
                itemId,
                quantity: nextQuantity,
            }
        })

        patchHarness.patch(UserInventory, 'updateOne', async (query = {}, update = {}) => {
            const itemId = String(query?.itemId || '').trim()
            const incQuantity = Number(update?.$inc?.quantity || 0)
            const currentQuantity = Number(inventoryByItemId.get(itemId) || 0)
            inventoryByItemId.set(itemId, currentQuantity + incQuantity)
            rollbackState.inventoryUpserts += 1
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
        })

        patchHarness.patch(UserInventory, 'deleteOne', async (query = {}) => {
            const rawId = String(query?._id || '').trim()
            const itemId = rawId.startsWith('inv-') ? rawId.slice(4) : String(query?.itemId || '').trim()
            if (itemId) {
                const currentQuantity = Number(inventoryByItemId.get(itemId) || 0)
                if (currentQuantity <= 0) {
                    inventoryByItemId.delete(itemId)
                }
            }
            return { acknowledged: true, deletedCount: 1 }
        })

        const req = createMockReq({
            userId: IDS.user,
            params: { id: IDS.target },
            body: {
                materialPokemonId: IDS.material,
                fusionStoneItemId: IDS.fusionStone,
                ...body,
            },
        })
        const res = createMockRes()

        await withMockedRandom(randomValue, async () => {
            await runRouteHandler(fusionHandler, { req, res })
        })

        const afterRunResult = typeof afterRun === 'function'
            ? await afterRun({ pokemonById })
            : null

        return {
            res,
            targetPokemon,
            materialPokemon,
            inventoryByItemId,
            rollbackState,
            afterRunResult,
        }
    } finally {
        patchHarness.restore()
    }
}

const testFusionSuccessFlow = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Target',
        level: 30,
        fusionLevel: 1,
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Mat',
        level: 30,
        fusionLevel: 0,
    })

    const { res, inventoryByItemId, rollbackState } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [{ _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 }],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 2,
        },
        randomValue: 0,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(Boolean(res.payload?.fusion?.success), true)
    assert.strictEqual(Number(targetPokemon.fusionLevel || 0), 2)
    assert.strictEqual(Number(inventoryByItemId.get(IDS.fusionStone) || 0), 1)
    assert.strictEqual(Number(rollbackState.targetRollbacks || 0), 0)
}

const testFusionFailurePenaltyFlow = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'b',
        nickname: 'Target',
        level: 30,
        fusionLevel: 6,
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesB,
        speciesName: 'Matmon',
        rarity: 'b',
        nickname: 'Mat',
        level: 12,
        fusionLevel: 0,
    })

    const { res, inventoryByItemId } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [{ _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 }],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 3,
        },
        randomValue: 0.999999,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(Boolean(res.payload?.fusion?.success), false)
    assert.strictEqual(Number(res.payload?.fusion?.failurePenalty || 0), 1)
    assert.strictEqual(Number(targetPokemon.fusionLevel || 0), 5)
    assert.strictEqual(Number(inventoryByItemId.get(IDS.fusionStone) || 0), 2)
}

const testFusionFailureWithProtectionFlow = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'b',
        nickname: 'Target',
        level: 30,
        fusionLevel: 6,
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesB,
        speciesName: 'Matmon',
        rarity: 'b',
        nickname: 'Mat',
        level: 12,
        fusionLevel: 0,
    })

    const { res, inventoryByItemId } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [
            { _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 },
            { _id: IDS.protectStone, name: 'Protection Stone', effectType: 'fusionProtectionStone', effectValue: 0 },
        ],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 2,
            [IDS.protectStone]: 1,
        },
        body: {
            fusionProtectionStoneItemId: IDS.protectStone,
        },
        randomValue: 0.999999,
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(Boolean(res.payload?.fusion?.success), false)
    assert.strictEqual(Boolean(res.payload?.fusion?.protectionApplied), true)
    assert.strictEqual(Number(res.payload?.fusion?.failurePenalty || 0), 0)
    assert.strictEqual(Number(targetPokemon.fusionLevel || 0), 6)
    assert.strictEqual(Number(inventoryByItemId.get(IDS.fusionStone) || 0), 1)
    assert.strictEqual(Number(inventoryByItemId.get(IDS.protectStone) || 0), 0)
}

const testStandaloneRollbackWhenMaterialDeleteFails = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Target',
        level: 30,
        fusionLevel: 2,
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Mat',
        level: 30,
        fusionLevel: 0,
    })

    const { res, inventoryByItemId, rollbackState } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [{ _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 }],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 4,
        },
        randomValue: 0,
        forceMaterialDeleteConflict: true,
    })

    assert.strictEqual(res.statusCode, 409)
    assert.strictEqual(Boolean(res.payload?.ok), false)
    assert.match(String(res.payload?.message || ''), /không còn trong kho/i)
    assert.strictEqual(Number(targetPokemon.fusionLevel || 0), 2)
    assert.strictEqual(Number(inventoryByItemId.get(IDS.fusionStone) || 0), 4)
    assert.strictEqual(Number(rollbackState.targetRollbacks || 0), 1)
    assert.strictEqual(Number(rollbackState.inventoryUpserts || 0), 1)
}

const testFusionThenPartyStatsSynced = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Target',
        level: 30,
        fusionLevel: 1,
        ivs: { hp: 22, atk: 11, def: 4, spatk: 3, spdef: 2, spd: 1 },
        evs: { hp: 40, atk: 80, def: 16, spatk: 8, spdef: 0, spd: 7 },
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Mat',
        level: 30,
        fusionLevel: 0,
    })

    const beforeStats = resolveUserPokemonFinalStats({
        baseStats: targetPokemon.pokemonId.baseStats,
        level: targetPokemon.level,
        rarity: targetPokemon.pokemonId.rarity,
        fusionLevel: 1,
        ivs: targetPokemon.ivs,
        evs: targetPokemon.evs,
        isShiny: targetPokemon.isShiny,
    })

    const { res, afterRunResult } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [{ _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 }],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 2,
        },
        randomValue: 0,
        afterRun: async () => {
            targetPokemon.location = 'party'
            targetPokemon.partyIndex = 0

            const req = createMockReq({ userId: IDS.user })
            const partyRes = createMockRes()
            await runRouteHandler(partyHandler, { req, res: partyRes })
            return { partyRes }
        },
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(Boolean(res.payload?.fusion?.success), true)

    const partyRes = afterRunResult?.partyRes
    assert.strictEqual(partyRes?.statusCode, 200)
    assert.strictEqual(Boolean(partyRes?.payload?.ok), true)
    const active = partyRes?.payload?.party?.[0]
    assert.ok(active)

    const expectedAfter = resolveUserPokemonFinalStats({
        baseStats: targetPokemon.pokemonId.baseStats,
        level: targetPokemon.level,
        rarity: targetPokemon.pokemonId.rarity,
        fusionLevel: 2,
        ivs: targetPokemon.ivs,
        evs: targetPokemon.evs,
        isShiny: targetPokemon.isShiny,
    })

    assert.strictEqual(Number(active?.stats?.atk || 0), Number(expectedAfter.finalStats.atk || 0))
    assert.strictEqual(Number(active?.stats?.hp || 0), Number(expectedAfter.finalStats.hp || 0))
    assert.strictEqual(Number(active?.stats?.maxHp || 0), Number(expectedAfter.maxHp || 0))
    assert.strictEqual(Number(active?.combatPower || 0), Number(expectedAfter.combatPower || 0))
    assert.ok(Number(active?.stats?.atk || 0) > Number(beforeStats.finalStats.atk || 0))
}

const testFusionThenDetailStatsSynced = async () => {
    const targetPokemon = createPokemonDoc({
        _id: IDS.target,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Target',
        level: 28,
        fusionLevel: 0,
        ivs: { hp: 10, atk: 15, def: 8, spatk: 3, spdef: 1, spd: 0 },
        evs: { hp: 24, atk: 64, def: 8, spatk: 0, spdef: 0, spd: 0 },
    })
    const materialPokemon = createPokemonDoc({
        _id: IDS.material,
        speciesId: IDS.speciesA,
        speciesName: 'Targetchu',
        rarity: 'a',
        nickname: 'Mat',
        level: 28,
        fusionLevel: 0,
    })

    const { res, afterRunResult } = await runFusionRequest({
        targetPokemon,
        materialPokemon,
        itemRows: [{ _id: IDS.fusionStone, name: 'Fusion Stone', effectType: 'fusionStone', effectValue: 0 }],
        initialInventoryByItemId: {
            [IDS.fusionStone]: 1,
        },
        randomValue: 0,
        afterRun: async () => {
            const req = createMockReq({
                params: { id: IDS.target },
            })
            const detailRes = createMockRes()
            await runRouteHandler(detailHandler, { req, res: detailRes })
            return { detailRes }
        },
    })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(Boolean(res.payload?.fusion?.success), true)

    const detailRes = afterRunResult?.detailRes
    assert.strictEqual(detailRes?.statusCode, 200)
    assert.strictEqual(Boolean(detailRes?.payload?.ok), true)

    const expectedAfter = resolveUserPokemonFinalStats({
        baseStats: targetPokemon.pokemonId.baseStats,
        level: targetPokemon.level,
        rarity: targetPokemon.pokemonId.rarity,
        fusionLevel: 1,
        ivs: targetPokemon.ivs,
        evs: targetPokemon.evs,
        isShiny: targetPokemon.isShiny,
    })

    const payloadPokemon = detailRes?.payload?.pokemon || {}
    assert.strictEqual(Number(payloadPokemon?.stats?.atk || 0), Number(expectedAfter.finalStats.atk || 0))
    assert.strictEqual(Number(payloadPokemon?.stats?.hp || 0), Number(expectedAfter.finalStats.hp || 0))
    assert.strictEqual(Number(payloadPokemon?.stats?.maxHp || 0), Number(expectedAfter.maxHp || 0))
    assert.strictEqual(Number(payloadPokemon?.combatPower || 0), Number(expectedAfter.combatPower || 0))
}

const run = async () => {
    await testFusionSuccessFlow()
    await testFusionFailurePenaltyFlow()
    await testFusionFailureWithProtectionFlow()
    await testStandaloneRollbackWhenMaterialDeleteFails()
    await testFusionThenPartyStatsSynced()
    await testFusionThenDetailStatsSynced()
    console.log('testFusionRouteFlow passed')
}

run().catch((error) => {
    console.error('Fusion route flow tests failed:', error)
    process.exitCode = 1
})
