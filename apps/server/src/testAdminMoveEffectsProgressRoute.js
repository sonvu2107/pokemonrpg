import assert from 'assert'
import adminMovesRouter from './routes/admin/moves.js'
import Move from './models/Move.js'
import {
    createMethodPatchHarness,
    createMockReq,
    createMockRes,
    getRouteHandler,
    runRouteHandler,
} from './test/helpers/routeTestHarness.js'

const progressHandler = getRouteHandler(adminMovesRouter, '/effects/progress', { handlerIndex: 'last' })

const testEffectsProgressExcludesUnsupportedRuleFromImplementedCoverage = async () => {
    const patchHarness = createMethodPatchHarness()

    try {
        let aggregateCallIndex = 0
        patchHarness.patch(Move, 'aggregate', async () => {
            aggregateCallIndex += 1

            if (aggregateCallIndex === 1) {
                return [{
                    totalMoves: 4,
                    movesWithAnyEffects: 3,
                    movesWithImplementedEffects: 1,
                    movesOnlyIncompleteEffects: 2,
                }]
            }

            if (aggregateCallIndex === 2) {
                return [
                    { _id: 'unsupported_rule', usageCount: 5 },
                    { _id: 'apply_status', usageCount: 2 },
                ]
            }

            if (aggregateCallIndex === 3) {
                return [
                    { _id: 'unmodeled_effect', usageCount: 5 },
                ]
            }

            throw new Error(`Unexpected Move.aggregate call #${aggregateCallIndex}`)
        })

        const req = createMockReq()
        const res = createMockRes()
        await runRouteHandler(progressHandler, { req, res })

        assert.strictEqual(res.statusCode, 200)
        assert.strictEqual(Boolean(res.payload?.ok), true)
        assert.strictEqual(Number(res.payload?.summary?.totalMoves || 0), 4)
        assert.strictEqual(Number(res.payload?.summary?.movesWithAnyEffects || 0), 3)
        assert.strictEqual(Number(res.payload?.summary?.movesWithImplementedEffects || 0), 1)
        assert.strictEqual(Number(res.payload?.summary?.movesOnlyIncompleteEffects || 0), 2)
        assert.strictEqual(Number(res.payload?.summary?.completionRate || 0), 25)

        const completeEffectIds = Array.isArray(res.payload?.completeEffects)
            ? res.payload.completeEffects.map((entry) => String(entry?.id || '').trim())
            : []
        const selectableEffectIds = Array.isArray(res.payload?.selectableEffects)
            ? res.payload.selectableEffects.map((entry) => String(entry?.id || '').trim())
            : []
        const incompleteReasonIds = Array.isArray(res.payload?.incompleteEffects)
            ? res.payload.incompleteEffects.map((entry) => String(entry?.id || '').trim())
            : []
        const triggerOptions = Array.isArray(res.payload?.triggerOptions) ? res.payload.triggerOptions : []

        assert(completeEffectIds.includes('apply_status'), 'Expected apply_status to remain in complete effects')
        assert(!completeEffectIds.includes('unsupported_rule'), 'Expected unsupported_rule to be excluded from complete effects')
        assert(!selectableEffectIds.includes('unsupported_rule'), 'Expected unsupported_rule to be excluded from selectable effects')
        assert(incompleteReasonIds.includes('unmodeled_effect'), 'Expected unsupported_rule reason bucket to remain in incomplete effects')
        assert(triggerOptions.includes('end_turn'), 'Expected progress endpoint to expose end_turn trigger option')
    } finally {
        patchHarness.restore()
    }
}

const run = async () => {
    await testEffectsProgressExcludesUnsupportedRuleFromImplementedCoverage()
    console.log('testAdminMoveEffectsProgressRoute passed')
}

run().catch((error) => {
    console.error('Admin move effects progress route tests failed:', error)
    process.exitCode = 1
})
