const noopAsyncSave = async function save() {
    this.saveCalls = Math.max(0, Number(this.saveCalls || 0)) + 1
    return this
}

export const createBadgeSnapshot = (overrides = {}) => ({
    partyDamagePercent: 0,
    partySpeedPercent: 0,
    partyHpPercent: 0,
    typeDamagePercentByType: {},
    ...overrides,
})

export const createPartyPokemon = ({
    _id,
    name = 'Pokemon',
    level = 10,
    baseHp = 80,
    rarity = 'd',
    types = ['normal'],
    moves = ['Tackle'],
    partyIndex = 0,
    formId = 'normal',
    movePpState = [],
} = {}) => ({
    _id,
    nickname: `${name} Nick`,
    level,
    moves,
    movePpState,
    partyIndex,
    formId,
    pokemonId: {
        _id: String(_id || '').padEnd(24, '0').slice(0, 24),
        name,
        rarity,
        types,
        baseStats: {
            hp: baseHp,
            atk: 50,
            def: 50,
            spatk: 50,
            spdef: 50,
            spd: 50,
        },
        forms: [],
        defaultFormId: 'normal',
        levelUpMoves: [],
        initialMoves: ['Tackle'],
    },
    saveCalls: 0,
    save: noopAsyncSave,
})

export const createTrainerOpponent = (overrides = {}) => ({
    slot: 0,
    pokemonId: 'trainer-opponent-species',
    name: 'Trainer Opponent',
    level: 20,
    damagePercent: 100,
    types: ['normal'],
    maxHp: 800,
    currentHp: 800,
    baseStats: {
        hp: 120,
        atk: 55,
        def: 55,
        spatk: 55,
        spdef: 55,
        spd: 55,
    },
    status: '',
    statusTurns: 0,
    statStages: {},
    damageGuards: {},
    wasDamagedLastTurn: false,
    volatileState: {},
    counterMoveMode: 'smart-random',
    counterMoveCursor: 0,
    counterMoves: [
        {
            name: 'Growl',
            type: 'normal',
            category: 'status',
            power: 0,
            accuracy: 100,
            priority: 0,
            currentPp: 20,
            maxPp: 20,
        },
    ],
    ...overrides,
})

export const createTrainerSession = ({
    _id = '64b000000000000000000099',
    trainerId = '64b000000000000000000001',
    expiresAt = new Date(Date.now() + 10 * 60 * 1000),
    badgeSnapshot = createBadgeSnapshot(),
    playerPokemonId = null,
    playerCurrentHp = 100,
    playerMaxHp = 100,
    playerTeam = [],
    team = [createTrainerOpponent()],
    currentIndex = 0,
    knockoutCounts = [],
    fieldState = {},
} = {}) => ({
    _id,
    trainerId,
    team,
    currentIndex,
    knockoutCounts,
    playerTeam,
    playerPokemonId,
    playerCurrentHp,
    playerMaxHp,
    playerStatus: '',
    playerStatusTurns: 0,
    playerStatStages: {},
    playerDamageGuards: {},
    playerWasDamagedLastTurn: false,
    playerVolatileState: {},
    fieldState,
    badgeSnapshot,
    expiresAt,
    saveCalls: 0,
    save: noopAsyncSave,
})

export const createTrainerDoc = (overrides = {}) => ({
    _id: '64b000000000000000000001',
    name: 'Trainer',
    team: [
        {
            pokemonId: {
                levelUpMoves: [],
                initialMoves: ['Tackle'],
                types: ['normal'],
                baseStats: {
                    hp: 80,
                    atk: 50,
                    def: 50,
                    spatk: 50,
                    spdef: 50,
                    spd: 50,
                },
            },
        },
    ],
    ...overrides,
})
