import assert from 'assert'
import UserPokemon from './models/UserPokemon.js'

const IDS = {
    pokemonA: '64b0000000000000000000d1',
    pokemonB: '64b0000000000000000000d2',
    user: '64b0000000000000000000f1',
    species: '64b0000000000000000000f2',
}

const testProjectionValidateDoesNotResetFusionOrOffType = async () => {
    const doc = UserPokemon.hydrate({
        _id: IDS.pokemonA,
        userId: IDS.user,
        pokemonId: IDS.species,
        level: 25,
        experience: 1200,
        fusionLevel: 7,
        offTypeSkillAllowance: 3,
        allowOffTypeSkills: true,
        location: 'party',
    })

    doc.isSelected = (path = '') => ['_id', 'userId', 'pokemonId', 'level', 'experience', 'location'].includes(String(path || ''))

    await doc.validate()

    assert.strictEqual(doc.fusionLevel, 7)
    assert.strictEqual(doc.offTypeSkillAllowance, 3)
    assert.strictEqual(doc.allowOffTypeSkills, true)
}

const testSelectedFusionLevelStillNormalized = async () => {
    const doc = UserPokemon.hydrate({
        _id: IDS.pokemonB,
        userId: IDS.user,
        pokemonId: IDS.species,
        level: 10,
        experience: 100,
        fusionLevel: -5,
        location: 'box',
    })

    doc.isSelected = (path = '') => ['_id', 'userId', 'pokemonId', 'level', 'experience', 'fusionLevel', 'location'].includes(String(path || ''))

    await doc.validate()

    assert.strictEqual(doc.fusionLevel, 0)
}

const run = async () => {
    await testProjectionValidateDoesNotResetFusionOrOffType()
    await testSelectedFusionLevelStillNormalized()
    console.log('testUserPokemonModelProjectionFlow passed')
}

run().catch((error) => {
    console.error('UserPokemon projection validation tests failed:', error)
    process.exitCode = 1
})
