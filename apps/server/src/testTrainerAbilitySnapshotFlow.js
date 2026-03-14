import assert from 'assert'
import { buildTrainerBattleTeam } from './services/trainerBattleSessionService.js'
import { ensureTrainerSessionPlayerParty } from './services/trainerBattlePlayerStateService.js'
import { createPartyPokemon } from './test/helpers/battleSessionFactory.js'

const USER_ID = '64b000000000000000009901'
const PARTY_POKEMON_ID = '64b000000000000000009902'

const testBuildTrainerBattleTeamSnapshotsAbility = () => {
    const trainerWithSpeciesPool = {
        team: [{
            level: 24,
            pokemonId: {
                _id: '64b000000000000000009903',
                name: 'Gengar',
                rarity: 'a',
                types: ['ghost', 'poison'],
                abilities: ['levitate', 'cursed_body'],
                baseStats: {
                    hp: 60,
                    atk: 65,
                    def: 60,
                    spatk: 130,
                    spdef: 75,
                    spd: 110,
                },
                forms: [],
                defaultFormId: 'normal',
            },
        }],
    }

    const fromSpeciesPool = buildTrainerBattleTeam(trainerWithSpeciesPool)
    assert.strictEqual(fromSpeciesPool[0]?.ability, 'levitate')

    const trainerWithOverride = {
        team: [{
            level: 24,
            ability: 'cursed_body',
            pokemonId: trainerWithSpeciesPool.team[0].pokemonId,
        }],
    }
    const fromOverride = buildTrainerBattleTeam(trainerWithOverride)
    assert.strictEqual(fromOverride[0]?.ability, 'cursed_body')
}

const testPlayerAbilitySnapshotStaysFrozenAcrossRefresh = async () => {
    const trainerSession = {
        playerTeam: [],
        playerPokemonId: null,
        playerCurrentHp: 0,
        playerMaxHp: 1,
        playerStatus: '',
        playerStatusTurns: 0,
        playerAbility: '',
    }

    const partyPokemon = createPartyPokemon({
        _id: PARTY_POKEMON_ID,
        name: 'SnapshotMon',
        level: 18,
        ability: 'intimidate',
    })

    await ensureTrainerSessionPlayerParty({
        trainerSession,
        userId: USER_ID,
        preferredActivePokemonId: PARTY_POKEMON_ID,
        preloadedParty: [partyPokemon],
    })

    assert.strictEqual(trainerSession.playerTeam[0]?.ability, 'intimidate')
    assert.strictEqual(trainerSession.playerAbility, 'intimidate')

    partyPokemon.ability = 'moxie'
    partyPokemon.pokemonId.abilities = ['moxie', 'intimidate']

    await ensureTrainerSessionPlayerParty({
        trainerSession,
        userId: USER_ID,
        preferredActivePokemonId: PARTY_POKEMON_ID,
        preloadedParty: [partyPokemon],
    })

    assert.strictEqual(trainerSession.playerTeam[0]?.ability, 'intimidate')
    assert.strictEqual(trainerSession.playerAbility, 'intimidate')
}

const main = async () => {
    testBuildTrainerBattleTeamSnapshotsAbility()
    await testPlayerAbilitySnapshotStaysFrozenAcrossRefresh()
    console.log('Trainer ability snapshot flow tests passed')
}

main().catch((error) => {
    console.error('Trainer ability snapshot flow tests failed:', error)
    process.exitCode = 1
})
