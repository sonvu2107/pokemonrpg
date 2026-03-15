import assert from 'assert'
import boxRouter, { __boxRouteInternals } from './routes/box.js'
import UserPokemon from './models/UserPokemon.js'
import Pokemon from './models/Pokemon.js'
import { createMethodPatchHarness, createMockReq, createMockRes, getRouteHandler, runRouteHandler } from './test/helpers/routeTestHarness.js'

const boxHandler = getRouteHandler(boxRouter, '/', { handlerIndex: 'last' })

const IDS = {
    pokemonA: '64b0000000000000000000a1',
    pokemonB: '64b0000000000000000000a2',
    pokemonC: '64b0000000000000000000a3',
    pokemonD: '64b0000000000000000000a4',
    speciesA: '64b0000000000000000000b1',
    speciesB: '64b0000000000000000000b2',
    speciesC: '64b0000000000000000000b3',
    speciesD: '64b0000000000000000000b4',
    user: '64b0000000000000000000f1',
}

const testRaritySortUsesPopulatedRowsAndPreservesOrder = async () => {
    const harness = createMethodPatchHarness()
    const countQueries = []
    const findFilters = []

    try {
        harness.patch(UserPokemon, 'countDocuments', async (query = {}) => {
            countQueries.push(query)
            return countQueries.length === 1 ? 12 : 3
        })
        harness.patch(UserPokemon, 'find', (filter = {}) => {
            findFilters.push(filter)
            return {
                select() { return this },
                populate() { return this },
                sort() { return this },
                skip() { return this },
                limit() { return this },
                lean: async () => [
                    {
                        _id: IDS.pokemonA,
                        pokemonId: { _id: IDS.speciesA, rarity: 'ss' },
                        level: 70,
                        createdAt: new Date('2026-03-01T00:00:00.000Z'),
                    },
                    {
                        _id: IDS.pokemonB,
                        pokemonId: { _id: IDS.speciesB, rarity: 'sss' },
                        level: 65,
                        createdAt: new Date('2026-03-02T00:00:00.000Z'),
                    },
                    {
                        _id: IDS.pokemonC,
                        pokemonId: { _id: IDS.speciesC, rarity: 'sss+' },
                        level: 80,
                        createdAt: new Date('2026-03-03T00:00:00.000Z'),
                    },
                    {
                        _id: IDS.pokemonD,
                        pokemonId: { _id: IDS.speciesD, rarity: 'sss' },
                        level: 90,
                        createdAt: new Date('2026-03-04T00:00:00.000Z'),
                    },
                ],
            }
        })

        const req = createMockReq({
            userId: IDS.user,
            query: {
                page: '2',
                limit: '2',
                sort: 'rarity',
                filter: 'all',
            },
        })
        const res = createMockRes()

        await runRouteHandler(boxHandler, { req, res })

        assert.strictEqual(res.statusCode, 200)
        assert.strictEqual(findFilters.length, 1)
        assert.deepStrictEqual(
            findFilters[0],
            {
                userId: IDS.user,
                location: 'box',
                $and: [
                    {
                        $or: [
                            { status: 'active' },
                            { status: { $exists: false } },
                            { status: null },
                        ],
                    },
                ],
            }
        )

        assert.deepStrictEqual(
            res.payload?.pokemon?.map((entry) => String(entry?._id || '')),
            [IDS.pokemonB, IDS.pokemonA]
        )
        assert.deepStrictEqual(res.payload?.pagination, {
            page: 2,
            limit: 2,
            total: 12,
            pages: 6,
        })
        assert.deepStrictEqual(res.payload?.counts, {
            total: 15,
            box: 12,
            party: 3,
        })
    } finally {
        harness.restore()
    }
}

const testSearchUsesCachedSpeciesRows = async () => {
    const harness = createMethodPatchHarness()
    const pokemonFindCalls = []

    try {
        __boxRouteInternals.clearSpeciesSearchCache()

        harness.patch(Pokemon, 'find', () => {
            pokemonFindCalls.push(true)
            return {
                select() { return this },
                lean: async () => [
                    { _id: IDS.speciesA, nameLower: 'pikachu' },
                    { _id: IDS.speciesB, nameLower: 'raichu' },
                ],
            }
        })
        harness.patch(UserPokemon, 'countDocuments', async () => 0)
        harness.patch(UserPokemon, 'find', () => ({
            select() { return this },
            populate() { return this },
            sort() { return this },
            skip() { return this },
            limit() { return this },
            lean: async () => [],
        }))

        const firstReq = createMockReq({
            userId: IDS.user,
            query: { search: 'chu', sort: 'level' },
        })
        const secondReq = createMockReq({
            userId: IDS.user,
            query: { search: 'pika', sort: 'level' },
        })

        await runRouteHandler(boxHandler, { req: firstReq, res: createMockRes() })
        await runRouteHandler(boxHandler, { req: secondReq, res: createMockRes() })

        assert.strictEqual(pokemonFindCalls.length, 1)
    } finally {
        __boxRouteInternals.clearSpeciesSearchCache()
        harness.restore()
    }
}

const run = async () => {
    await testRaritySortUsesPopulatedRowsAndPreservesOrder()
    await testSearchUsesCachedSpeciesRows()
    console.log('testBoxRouteFlow passed')
}

run().catch((error) => {
    console.error('Box route tests failed:', error)
    process.exitCode = 1
})
