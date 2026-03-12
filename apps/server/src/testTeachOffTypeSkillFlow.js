import assert from 'assert'
import pokemonRouter from './routes/pokemon.js'
import UserPokemon from './models/UserPokemon.js'
import Move from './models/Move.js'
import UserMoveInventory from './models/UserMoveInventory.js'

const IDS = {
    user: '64b000000000000000000011',
    pokemon: '64b000000000000000000012',
    species: '64b000000000000000000013',
    move: '64b000000000000000000014',
    inventory: '64b000000000000000000015',
}

const routeLayer = pokemonRouter.stack.find((layer) => layer?.route?.path === '/:id/teach-skill')
if (!routeLayer) {
    throw new Error('Cannot resolve /api/pokemon/:id/teach-skill test handler')
}
const teachSkillHandler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle

const mkRes = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
})

const mkUserPokemon = ({ offTypeSkillAllowance = 1, allowOffTypeSkills = true } = {}) => ({
    _id: IDS.pokemon,
    nickname: 'Testmon',
    moves: ['Water Gun'],
    movePpState: [
        { moveName: 'Water Gun', currentPp: 25, maxPp: 25 },
    ],
    offTypeSkillAllowance,
    allowOffTypeSkills,
    pokemonId: {
        _id: IDS.species,
        types: ['water'],
        rarity: 'd',
        levelUpMoves: [],
    },
    async save() { return this },
})

const mkMove = () => ({
    _id: IDS.move,
    name: 'Flamethrower',
    type: 'fire',
    category: 'special',
    power: 90,
    accuracy: 100,
    pp: 15,
    priority: 0,
    learnScope: 'move_type',
    allowedTypes: [],
    allowedPokemonIds: [],
    allowedRarities: [],
})

const moveLookupDocs = [
    {
        _id: 'move-db-1',
        name: 'Water Gun',
        nameLower: 'water gun',
        pp: 25,
        type: 'water',
        category: 'special',
        power: 40,
        accuracy: 100,
        priority: 0,
    },
    {
        _id: 'move-db-2',
        name: 'Flamethrower',
        nameLower: 'flamethrower',
        pp: 15,
        type: 'fire',
        category: 'special',
        power: 90,
        accuracy: 100,
        priority: 0,
    },
]

const runTeachSkill = async ({
    userPokemon = mkUserPokemon(),
    persistedPokemon = null,
} = {}) => {
    const originals = {
        userPokemonFindOne: UserPokemon.findOne,
        userPokemonFindOneAndUpdate: UserPokemon.findOneAndUpdate,
        moveFindOne: Move.findOne,
        moveFind: Move.find,
        moveInventoryFindOne: UserMoveInventory.findOne,
        moveInventoryFindOneAndUpdate: UserMoveInventory.findOneAndUpdate,
        moveInventoryDeleteOne: UserMoveInventory.deleteOne,
        moveInventoryUpdateOne: UserMoveInventory.updateOne,
    }

    const calls = {
        updateFilter: null,
        updatePayload: null,
        rollbackCalls: 0,
    }

    try {
        UserPokemon.findOne = () => ({
            populate: async () => userPokemon,
        })
        UserPokemon.findOneAndUpdate = async (filter, update) => {
            calls.updateFilter = filter
            calls.updatePayload = update
            return persistedPokemon
        }
        Move.findOne = () => ({
            select: () => ({ lean: async () => mkMove() }),
        })
        Move.find = () => ({
            select: () => ({ lean: async () => moveLookupDocs }),
        })
        UserMoveInventory.findOne = () => ({
            select: () => ({ lean: async () => ({ quantity: 1 }) }),
        })
        UserMoveInventory.findOneAndUpdate = async () => ({
            _id: IDS.inventory,
            quantity: 0,
        })
        UserMoveInventory.deleteOne = async () => ({ deletedCount: 1 })
        UserMoveInventory.updateOne = async () => {
            calls.rollbackCalls += 1
            return { acknowledged: true }
        }

        const req = {
            user: { userId: IDS.user },
            params: { id: IDS.pokemon },
            body: { moveId: IDS.move },
        }
        const res = mkRes()

        await teachSkillHandler(req, res)

        return { res, calls }
    } finally {
        UserPokemon.findOne = originals.userPokemonFindOne
        UserPokemon.findOneAndUpdate = originals.userPokemonFindOneAndUpdate
        Move.findOne = originals.moveFindOne
        Move.find = originals.moveFind
        UserMoveInventory.findOne = originals.moveInventoryFindOne
        UserMoveInventory.findOneAndUpdate = originals.moveInventoryFindOneAndUpdate
        UserMoveInventory.deleteOne = originals.moveInventoryDeleteOne
        UserMoveInventory.updateOne = originals.moveInventoryUpdateOne
    }
}

const testTeachSkillConsumesOffTypeAllowance = async () => {
    const persistedPokemon = {
        _id: IDS.pokemon,
        moves: ['Water Gun', 'Flamethrower'],
        movePpState: [
            { moveName: 'Water Gun', currentPp: 25, maxPp: 25 },
            { moveName: 'Flamethrower', currentPp: 15, maxPp: 15 },
        ],
        offTypeSkillAllowance: 0,
        allowOffTypeSkills: false,
    }

    const { res, calls } = await runTeachSkill({ persistedPokemon })

    assert.strictEqual(res.statusCode, 200)
    assert.strictEqual(res.payload?.ok, true)
    assert.strictEqual(res.payload?.pokemon?.offTypeSkillAllowance, 0)
    assert.strictEqual(res.payload?.pokemon?.allowOffTypeSkills, false)
    assert.deepStrictEqual(calls.updateFilter?.offTypeSkillAllowance, 1)
    assert.deepStrictEqual(calls.updatePayload?.$set?.moves, ['Water Gun', 'Flamethrower'])
    assert.strictEqual(calls.updatePayload?.$set?.offTypeSkillAllowance, 0)
    assert.strictEqual(calls.updatePayload?.$set?.allowOffTypeSkills, false)
    assert.strictEqual(calls.rollbackCalls, 0)
}

const testTeachSkillRollsBackOnAllowanceConflict = async () => {
    const { res, calls } = await runTeachSkill({ persistedPokemon: null })

    assert.strictEqual(res.statusCode, 409)
    assert.strictEqual(res.payload?.ok, false)
    assert(String(res.payload?.message || '').includes('Lượt học skill khác hệ đã thay đổi'))
    assert.strictEqual(calls.rollbackCalls, 1)
}

const run = async () => {
    await testTeachSkillConsumesOffTypeAllowance()
    await testTeachSkillRollsBackOnAllowanceConflict()
    console.log('testTeachOffTypeSkillFlow passed')
}

run().catch((error) => {
    console.error(error)
    process.exit(1)
})
