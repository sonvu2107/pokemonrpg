import assert from 'assert'
import UserPokemon from './models/UserPokemon.js'
import UserPokedexEntry from './models/UserPokedexEntry.js'
import { createMethodPatchHarness } from './test/helpers/routeTestHarness.js'
import {
    __userPokedexServiceInternals,
    getUserPokedexFormSet,
    syncUserPokedexEntriesForPokemonDocs,
} from './services/userPokedexService.js'

const IDS = {
    user: '64b0000000000000000000f1',
    speciesA: '64b0000000000000000000a1',
    speciesB: '64b0000000000000000000a2',
}

const testIncrementalReconcileAddsMissingEntries = async () => {
    const harness = createMethodPatchHarness()
    const bulkCalls = []

    try {
        harness.patch(UserPokedexEntry, 'find', () => ({
            select() { return this },
            lean: async () => [
                { pokemonId: IDS.speciesA, formId: 'normal' },
            ],
        }))
        harness.patch(UserPokemon, 'find', () => ({
            select() { return this },
            lean: async () => [
                {
                    userId: IDS.user,
                    pokemonId: IDS.speciesA,
                    formId: 'normal',
                    obtainedAt: new Date('2026-01-01T00:00:00.000Z'),
                },
                {
                    userId: IDS.user,
                    pokemonId: IDS.speciesB,
                    formId: 'shadow',
                    obtainedAt: new Date('2026-01-02T00:00:00.000Z'),
                },
            ],
        }))
        harness.patch(UserPokedexEntry, 'bulkWrite', async (ops = [], options = {}) => {
            bulkCalls.push({ ops, options })
            return { ok: 1 }
        })

        const formSet = await getUserPokedexFormSet(IDS.user, { syncCurrentOwned: true })

        assert.deepStrictEqual(
            [...formSet].sort(),
            [`${IDS.speciesA}:normal`, `${IDS.speciesB}:shadow`].sort()
        )
        assert.strictEqual(bulkCalls.length, 1)
        assert.strictEqual(bulkCalls[0].ops.length, 1)
        assert.deepStrictEqual(bulkCalls[0].ops[0].updateOne.filter, {
            userId: IDS.user,
            pokemonId: IDS.speciesB,
            formId: 'shadow',
        })
    } finally {
        harness.restore()
    }
}

const testExplicitBulkSyncDeduplicatesPokemonDocs = async () => {
    const harness = createMethodPatchHarness()
    const bulkCalls = []

    try {
        harness.patch(UserPokedexEntry, 'bulkWrite', async (ops = [], options = {}) => {
            bulkCalls.push({ ops, options })
            return { ok: 1 }
        })

        const session = { id: 'session-1' }
        const formSet = await syncUserPokedexEntriesForPokemonDocs([
            {
                userId: IDS.user,
                pokemonId: IDS.speciesA,
                formId: 'normal',
                obtainedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                userId: IDS.user,
                pokemonId: IDS.speciesA,
                formId: 'normal',
                obtainedAt: new Date('2026-01-03T00:00:00.000Z'),
            },
        ], { session })

        assert.deepStrictEqual([...formSet], [`${IDS.speciesA}:normal`])
        assert.strictEqual(bulkCalls.length, 1)
        assert.strictEqual(bulkCalls[0].ops.length, 1)
        assert.strictEqual(bulkCalls[0].options.session, session)
        assert.strictEqual(
            bulkCalls[0].ops[0].updateOne.update.$max.lastObtainedAt.toISOString(),
            '2026-01-03T00:00:00.000Z'
        )
    } finally {
        harness.restore()
    }
}

const testReadReconcileCacheSkipsRepeatedUserPokemonScan = async () => {
    const harness = createMethodPatchHarness()
    const userPokemonFindCalls = []
    const entryFindCalls = []

    try {
        __userPokedexServiceInternals.clearReadReconcileCache()

        harness.patch(UserPokedexEntry, 'find', () => ({
            select() { return this },
            lean: async () => {
                entryFindCalls.push(true)
                return [
                    { pokemonId: IDS.speciesA, formId: 'normal' },
                ]
            },
        }))
        harness.patch(UserPokemon, 'find', () => ({
            select() { return this },
            lean: async () => {
                userPokemonFindCalls.push(true)
                return [
                    {
                        userId: IDS.user,
                        pokemonId: IDS.speciesA,
                        formId: 'normal',
                        obtainedAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                ]
            },
        }))
        harness.patch(UserPokedexEntry, 'bulkWrite', async () => ({ ok: 1 }))

        const first = await getUserPokedexFormSet(IDS.user, { syncCurrentOwned: true })
        const second = await getUserPokedexFormSet(IDS.user, { syncCurrentOwned: true })

        assert.deepStrictEqual([...first], [`${IDS.speciesA}:normal`])
        assert.deepStrictEqual([...second], [`${IDS.speciesA}:normal`])
        assert.strictEqual(userPokemonFindCalls.length, 1)
        assert.strictEqual(entryFindCalls.length, 2)
    } finally {
        __userPokedexServiceInternals.clearReadReconcileCache()
        harness.restore()
    }
}

const run = async () => {
    await testIncrementalReconcileAddsMissingEntries()
    await testExplicitBulkSyncDeduplicatesPokemonDocs()
    await testReadReconcileCacheSkipsRepeatedUserPokemonScan()
    console.log('testUserPokedexServiceFlow passed')
}

run().catch((error) => {
    console.error('UserPokedex service tests failed:', error)
    process.exitCode = 1
})
