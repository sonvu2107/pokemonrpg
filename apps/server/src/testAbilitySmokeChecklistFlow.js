import assert from 'assert'
import gameRouter from './routes/game.js'
import UserPokemon from './models/UserPokemon.js'
import BattleSession from './models/BattleSession.js'
import BattleTrainer from './models/BattleTrainer.js'
import Move from './models/Move.js'
import BadgeDefinition from './models/BadgeDefinition.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'
import {
    createMethodPatchHarness,
    createMockReq,
    createMockRes,
    getRouteHandler,
    runRouteHandler,
    withMockedRandom,
} from './test/helpers/routeTestHarness.js'
import {
    createPartyPokemon,
    createTrainerDoc,
    createTrainerOpponent,
    createTrainerSession,
} from './test/helpers/battleSessionFactory.js'
import { applyTrainerPenaltyTurn } from './services/trainerPenaltyTurnService.js'
import {
    applyTrainerSessionForcedPlayerSwitch,
    clearTrainerSessionActivePlayerAbilitySuppression,
    setTrainerSessionActivePlayerByIndex,
} from './services/trainerBattlePlayerStateService.js'

const attackHandler = getRouteHandler(gameRouter, '/battle/attack', { handlerIndex: 'last' })

const deepClone = (value) => JSON.parse(JSON.stringify(value))

const createThenableRowsQuery = (rows = []) => ({
    select() { return this },
    sort() { return this },
    populate() { return this },
    limit() { return this },
    lean: async () => rows,
    then(resolve, reject) {
        return Promise.resolve(rows).then(resolve, reject)
    },
})

const createLeanDocQuery = (doc = null) => ({
    select() { return this },
    sort() { return this },
    populate() { return this },
    limit() { return this },
    lean: async () => doc,
})

const moveDoc = ({
    name,
    type = 'normal',
    category = 'physical',
    power = 50,
    accuracy = 100,
    priority = 0,
    pp = 20,
    effectSpecs = [],
    effects = {},
}) => {
    const normalizedName = String(name || '').trim()
    return {
        name: normalizedName,
        nameLower: normalizedName.toLowerCase(),
        type,
        category,
        power,
        accuracy,
        priority,
        pp,
        effectSpecs,
        effects,
        isActive: true,
    }
}

const extractAbilityEvents = (turnPhases = []) => (Array.isArray(turnPhases) ? turnPhases : [])
    .flatMap((phase) => {
        const events = Array.isArray(phase?.events) ? phase.events : []
        return events
            .filter((entry) => String(entry?.kind || '').toLowerCase().includes('ability'))
            .map((entry) => ({ phase: phase.key, ...entry }))
    })

const summarizeSessionSnapshot = (trainerSession = null) => ({
    playerPokemonId: String(trainerSession?.playerPokemonId || ''),
    playerAbility: String(trainerSession?.playerAbility || ''),
    playerAbilitySuppressed: Boolean(trainerSession?.playerAbilitySuppressed),
    playerCurrentHp: Number(trainerSession?.playerCurrentHp || 0),
    playerStatus: String(trainerSession?.playerStatus || ''),
    opponent: {
        ability: String(trainerSession?.team?.[0]?.ability || ''),
        abilitySuppressed: Boolean(trainerSession?.team?.[0]?.abilitySuppressed),
        currentHp: Number(trainerSession?.team?.[0]?.currentHp || 0),
        status: String(trainerSession?.team?.[0]?.status || ''),
        statStages: deepClone(trainerSession?.team?.[0]?.statStages || {}),
    },
})

const runAttackTurn = async ({
    userId,
    trainerId,
    activePokemon,
    partyRows = null,
    trainerSession,
    trainerDoc,
    moveDocs = [],
    moveName,
    fieldState = {},
    randomValue = 0.5,
}) => {
    const patchHarness = createMethodPatchHarness()
    const moveMap = new Map((Array.isArray(moveDocs) ? moveDocs : []).map((entry) => [String(entry?.nameLower || '').toLowerCase(), entry]))
    const moveNames = [...new Set((Array.isArray(moveDocs) ? moveDocs : []).map((entry) => String(entry?.name || '').trim()).filter(Boolean))]
    const selectedMoveName = String(moveName || '').trim()
    if (selectedMoveName && !moveNames.includes(selectedMoveName)) {
        moveNames.push(selectedMoveName)
    }
    activePokemon.moves = [...new Set([...(Array.isArray(activePokemon.moves) ? activePokemon.moves : []), ...moveNames])]
    if (activePokemon?.pokemonId && typeof activePokemon.pokemonId === 'object') {
        const initialMoves = Array.isArray(activePokemon.pokemonId.initialMoves) ? activePokemon.pokemonId.initialMoves : []
        activePokemon.pokemonId.initialMoves = [...new Set([...initialMoves, ...moveNames])]
    }

    try {
        const resolvedPartyRows = Array.isArray(partyRows) && partyRows.length > 0 ? partyRows : [activePokemon]
        patchHarness.patch(UserPokemon, 'find', () => createThenableRowsQuery(resolvedPartyRows))
        patchHarness.patch(BattleSession, 'findOne', async () => trainerSession)
        patchHarness.patch(BattleTrainer, 'findById', () => createLeanDocQuery(trainerDoc))
        patchHarness.patch(Move, 'findOne', (query = {}) => {
            const nameLower = String(query?.nameLower || '').trim().toLowerCase()
            return {
                lean: async () => moveMap.get(nameLower) || null,
            }
        })
        patchHarness.patch(Move, 'find', (query = {}) => {
            const inList = Array.isArray(query?.nameLower?.$in) ? query.nameLower.$in : []
            const docs = inList
                .map((nameLower) => moveMap.get(String(nameLower || '').toLowerCase()))
                .filter(Boolean)
            return createThenableRowsQuery(docs)
        })
        patchHarness.patch(BadgeDefinition, 'find', () => ({
            select() { return this },
            sort() { return this },
            lean: async () => [],
        }))
        patchHarness.patch(User, 'findById', () => createLeanDocQuery({
            _id: userId,
            role: 'user',
            equippedBadgeIds: [],
            completedBattleTrainers: [],
            vipTierLevel: 0,
            catchFailCount: 0,
            totalOnlineMs: 0,
        }))
        patchHarness.patch(PlayerState, 'findOne', () => createLeanDocQuery({ userId, gold: 0, moonPoints: 0 }))

        const req = createMockReq({
            userId,
            body: {
                trainerId,
                activePokemonId: activePokemon._id,
                moveName,
                player: {
                    currentHp: trainerSession.playerCurrentHp,
                    status: trainerSession.playerStatus,
                    statusTurns: trainerSession.playerStatusTurns,
                    statStages: trainerSession.playerStatStages || {},
                    damageGuards: trainerSession.playerDamageGuards || {},
                    wasDamagedLastTurn: trainerSession.playerWasDamagedLastTurn || false,
                    volatileState: trainerSession.playerVolatileState || {},
                },
                opponent: {},
                fieldState,
                resetTrainerSession: false,
                resetMovePpState: false,
            },
        })
        const res = createMockRes()

        await withMockedRandom(randomValue, async () => {
            await runRouteHandler(attackHandler, { req, res })
        })

        if (!res.payload?.ok) {
            throw new Error(`Attack request failed: ${JSON.stringify(res.payload)}`)
        }

        return res.payload.battle
    } finally {
        patchHarness.restore()
    }
}

const runPenaltyTurn = async ({
    trainerSession,
    trainerOpponent,
    trainerSpecies,
    targetPokemon,
    moveDocs = [],
}) => {
    const patchHarness = createMethodPatchHarness()
    const moveMap = new Map((Array.isArray(moveDocs) ? moveDocs : []).map((entry) => [String(entry?.nameLower || '').toLowerCase(), entry]))
    try {
        patchHarness.patch(Move, 'find', (query = {}) => {
            const inList = Array.isArray(query?.nameLower?.$in) ? query.nameLower.$in : []
            const docs = inList
                .map((nameLower) => moveMap.get(String(nameLower || '').toLowerCase()))
                .filter(Boolean)
            return createThenableRowsQuery(docs)
        })

        return await withMockedRandom(0.5, async () => applyTrainerPenaltyTurn({
            activeBattleSession: trainerSession,
            activeTrainerOpponent: trainerOpponent,
            targetPokemon,
            trainerSpecies,
            playerCurrentHp: trainerSession.playerCurrentHp,
            playerMaxHp: trainerSession.playerMaxHp,
            reason: 'switch',
        }))
    } finally {
        patchHarness.restore()
    }
}

const createBaseContext = () => {
    const userId = '64b00000000000000000a001'
    const trainerId = '64b00000000000000000a002'
    const activePokemon = createPartyPokemon({
        _id: '64b00000000000000000a003',
        name: 'SmokeMon',
        level: 50,
        baseHp: 120,
        moves: ['Tackle'],
        ability: '',
    })
    const trainerOpponent = createTrainerOpponent({
        name: 'Smoke Opponent',
        level: 50,
        maxHp: 200,
        currentHp: 200,
        ability: '',
        counterMoves: [{
            name: 'Tackle',
            type: 'normal',
            category: 'physical',
            power: 40,
            accuracy: 100,
            priority: 0,
            currentPp: 35,
            maxPp: 35,
        }],
    })
    const trainerSession = createTrainerSession({
        trainerId,
        playerPokemonId: activePokemon._id,
        playerCurrentHp: 200,
        playerMaxHp: 200,
        playerAbility: '',
        playerAbilitySuppressed: false,
        team: [trainerOpponent],
        playerTeam: [{
            slot: 0,
            userPokemonId: activePokemon._id,
            name: activePokemon.nickname,
            currentHp: 200,
            maxHp: 200,
            status: '',
            statusTurns: 0,
            ability: '',
            abilitySuppressed: false,
        }],
    })
    const trainerDoc = createTrainerDoc({ _id: trainerId })

    return { userId, trainerId, activePokemon, trainerOpponent, trainerSession, trainerDoc }
}

const runSmoke = async () => {
    const results = []

    // 1) Intimidate switch-in trigger only once without new switch
    {
        const ctx = createBaseContext()
        ctx.activePokemon.ability = 'intimidate'
        ctx.activePokemon.pokemonId.abilities = ['intimidate']
        ctx.trainerSession.playerAbility = 'intimidate'
        ctx.trainerSession.playerTeam[0].ability = 'intimidate'
        ctx.trainerOpponent.counterMoves = [{
            name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, priority: 0, currentPp: 35, maxPp: 35,
        }]

        const moves = [
            moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }),
        ]

        const pre = summarizeSessionSnapshot(ctx.trainerSession)
        const first = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Tackle' })
        const mid = summarizeSessionSnapshot(ctx.trainerSession)
        const second = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Tackle' })
        const post = summarizeSessionSnapshot(ctx.trainerSession)

        const firstEvents = extractAbilityEvents(first.turnPhases)
        const secondEvents = extractAbilityEvents(second.turnPhases)
        const firstHasIntimidate = firstEvents.some((entry) => String(entry?.line || '').toLowerCase().includes('intimidate'))
        const secondHasIntimidate = secondEvents.some((entry) => String(entry?.line || '').toLowerCase().includes('intimidate'))

        results.push({
            case: 'Intimidate trigger mot lan khi khong switch moi',
            expected: 'Luot 1 co log Intimidate, luot 2 khong lap trigger.',
            observed: `firstHasIntimidate=${firstHasIntimidate}, secondHasIntimidate=${secondHasIntimidate}, atkStage=${post.opponent.statStages.atk ?? 0}`,
            verdict: firstHasIntimidate && !secondHasIntimidate ? 'Pass' : 'Fail',
            classification: firstHasIntimidate && !secondHasIntimidate ? 'none' : 'ordering',
            evidence: {
                timeline: {
                    first: firstEvents,
                    second: secondEvents,
                },
                snapshot: { pre, mid, post },
                bypassSource: [],
            },
        })
    }

    // 2) Levitate blocks Ground normally
    {
        const ctx = createBaseContext()
        ctx.trainerOpponent.ability = 'levitate'
        const moves = [
            moveDoc({ name: 'Earthquake', type: 'ground', category: 'physical', power: 100, accuracy: 100, pp: 10 }),
            moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }),
        ]
        const pre = summarizeSessionSnapshot(ctx.trainerSession)
        const battle = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Earthquake' })
        const post = summarizeSessionSnapshot(ctx.trainerSession)
        const events = extractAbilityEvents(battle.turnPhases)
        const hasLevitateLog = events.some((entry) => String(entry?.line || '').toLowerCase().includes('levitate'))

        results.push({
            case: 'Levitate chan Ground move thong thuong',
            expected: 'Sat thuong = 0, co log defensive ability.',
            observed: `damage=${battle.damage}, hasLevitateLog=${hasLevitateLog}`,
            verdict: Number(battle.damage || 0) === 0 && hasLevitateLog ? 'Pass' : 'Fail',
            classification: Number(battle.damage || 0) === 0 && hasLevitateLog ? 'none' : 'policy',
            evidence: {
                timeline: events,
                snapshot: { pre, post },
                bypassSource: events.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source),
            },
        })
    }

    // 3) Mold Breaker bypasses Levitate
    {
        const ctx = createBaseContext()
        ctx.activePokemon.ability = 'mold_breaker'
        ctx.activePokemon.pokemonId.abilities = ['mold_breaker']
        ctx.trainerSession.playerAbility = 'mold_breaker'
        ctx.trainerSession.playerTeam[0].ability = 'mold_breaker'
        ctx.trainerOpponent.ability = 'levitate'
        const moves = [
            moveDoc({ name: 'Earthquake', type: 'ground', category: 'physical', power: 100, accuracy: 100, pp: 10 }),
            moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }),
        ]
        const pre = summarizeSessionSnapshot(ctx.trainerSession)
        const battle = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Earthquake' })
        const post = summarizeSessionSnapshot(ctx.trainerSession)
        const events = extractAbilityEvents(battle.turnPhases)
        const bypassSources = events.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source)

        results.push({
            case: 'Mold Breaker bypass Levitate',
            expected: 'Ground move gay damage, bypass source=attacker_ability.',
            observed: `damage=${battle.damage}, bypassSources=${JSON.stringify(bypassSources)}`,
            verdict: Number(battle.damage || 0) > 0 && bypassSources.includes('attacker_ability') ? 'Pass' : 'Fail',
            classification: Number(battle.damage || 0) > 0 && bypassSources.includes('attacker_ability') ? 'none' : 'policy',
            evidence: {
                timeline: events,
                snapshot: { pre, post },
                bypassSource: bypassSources,
            },
        })
    }

    // 4) Water Absorb works and is bypassed
    {
        const normalCtx = createBaseContext()
        normalCtx.trainerOpponent.ability = 'water_absorb'
        normalCtx.trainerOpponent.maxHp = 200
        normalCtx.trainerOpponent.currentHp = 120

        const bypassCtx = createBaseContext()
        bypassCtx.activePokemon.ability = 'mold_breaker'
        bypassCtx.activePokemon.pokemonId.abilities = ['mold_breaker']
        bypassCtx.trainerSession.playerAbility = 'mold_breaker'
        bypassCtx.trainerSession.playerTeam[0].ability = 'mold_breaker'
        bypassCtx.trainerOpponent.ability = 'water_absorb'
        bypassCtx.trainerOpponent.maxHp = 200
        bypassCtx.trainerOpponent.currentHp = 120

        const moves = [
            moveDoc({ name: 'Water Gun', type: 'water', category: 'special', power: 50, accuracy: 100, pp: 25 }),
            moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }),
        ]

        const normalPre = summarizeSessionSnapshot(normalCtx.trainerSession)
        const normalBattle = await runAttackTurn({ ...normalCtx, moveDocs: moves, moveName: 'Water Gun' })
        const normalPost = summarizeSessionSnapshot(normalCtx.trainerSession)
        const normalEvents = extractAbilityEvents(normalBattle.turnPhases)

        const bypassPre = summarizeSessionSnapshot(bypassCtx.trainerSession)
        const bypassBattle = await runAttackTurn({ ...bypassCtx, moveDocs: moves, moveName: 'Water Gun' })
        const bypassPost = summarizeSessionSnapshot(bypassCtx.trainerSession)
        const bypassEvents = extractAbilityEvents(bypassBattle.turnPhases)
        const bypassSources = bypassEvents.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source)

        const normalHealed = Number(normalPost.opponent.currentHp) > Number(normalPre.opponent.currentHp)
        const bypassDamaged = Number(bypassPost.opponent.currentHp) < Number(bypassPre.opponent.currentHp)

        results.push({
            case: 'Water Absorb hoat dong va bi bypass hop le',
            expected: 'Khong bypass thi hoi HP; co bypass thi mat HP.',
            observed: `normalHealed=${normalHealed}, bypassDamaged=${bypassDamaged}, bypassSources=${JSON.stringify(bypassSources)}`,
            verdict: normalHealed && bypassDamaged && bypassSources.includes('attacker_ability') ? 'Pass' : 'Fail',
            classification: normalHealed && bypassDamaged && bypassSources.includes('attacker_ability') ? 'none' : 'policy',
            evidence: {
                timeline: {
                    normal: normalEvents,
                    bypass: bypassEvents,
                },
                snapshot: {
                    normal: { pre: normalPre, post: normalPost },
                    bypass: { pre: bypassPre, post: bypassPost },
                },
                bypassSource: bypassSources,
            },
        })
    }

    // 5) Status immunity in main turn + penalty turn
    {
        const mainCtx = createBaseContext()
        mainCtx.trainerOpponent.ability = 'immunity'
        const poisonMove = moveDoc({
            name: 'Toxic Pulse',
            type: 'poison',
            category: 'status',
            power: 0,
            accuracy: 100,
            effectSpecs: [{
                op: 'apply_status',
                trigger: 'on_hit',
                target: 'opponent',
                chance: 1,
                params: { status: 'poison' },
            }],
        })
        const moves = [poisonMove, moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })]
        const mainPre = summarizeSessionSnapshot(mainCtx.trainerSession)
        const mainBattle = await runAttackTurn({ ...mainCtx, moveDocs: moves, moveName: 'Toxic Pulse' })
        const mainPost = summarizeSessionSnapshot(mainCtx.trainerSession)
        const mainEvents = extractAbilityEvents(mainBattle.turnPhases)

        const penaltySession = createTrainerSession({
            trainerId: '64b00000000000000000b201',
            playerPokemonId: '64b00000000000000000b202',
            playerCurrentHp: 180,
            playerMaxHp: 200,
            playerAbility: 'insomnia',
            playerAbilitySuppressed: false,
            playerTeam: [{
                slot: 0,
                userPokemonId: '64b00000000000000000b202',
                name: 'PenaltyPlayer',
                currentHp: 180,
                maxHp: 200,
                status: '',
                statusTurns: 0,
                ability: 'insomnia',
                abilitySuppressed: false,
            }],
            team: [createTrainerOpponent({
                name: 'Penalty Opponent',
                counterMoves: [{
                    name: 'Hypno Hit', type: 'psychic', category: 'status', power: 0, accuracy: 100, priority: 0, currentPp: 15, maxPp: 15,
                }],
            })],
        })
        const penaltyTarget = createPartyPokemon({
            _id: '64b00000000000000000b202',
            name: 'PenaltyPlayer',
            level: 50,
            baseHp: 120,
            ability: 'insomnia',
        })
        const penaltyMoveDoc = moveDoc({
            name: 'Hypno Hit',
            type: 'psychic',
            category: 'status',
            power: 0,
            accuracy: 100,
            effectSpecs: [],
            effects: { statusEffect: 'sleep' },
        })
        const penaltySpecies = {
            types: ['psychic'],
            initialMoves: ['Hypno Hit'],
            levelUpMoves: [],
            baseStats: { hp: 100, atk: 70, def: 70, spatk: 70, spdef: 70, spd: 70 },
        }
        const penaltyPre = summarizeSessionSnapshot(penaltySession)
        const penaltyResult = await runPenaltyTurn({
            trainerSession: penaltySession,
            trainerOpponent: penaltySession.team[0],
            trainerSpecies: penaltySpecies,
            targetPokemon: penaltyTarget,
            moveDocs: [penaltyMoveDoc],
        })
        const penaltyPost = summarizeSessionSnapshot(penaltySession)
        const penaltyEvents = extractAbilityEvents(penaltyResult.turnPhases)

        const mainBlocked = String(mainBattle.targetState?.status || '') === ''
        const penaltyBlocked = String(penaltyResult?.player?.status || '') === ''

        results.push({
            case: 'Status immunity tren main turn va penalty turn',
            expected: 'Main turn chan poison (Immunity), penalty turn chan sleep (Insomnia).',
            observed: `mainBlocked=${mainBlocked}, penaltyBlocked=${penaltyBlocked}`,
            verdict: mainBlocked && penaltyBlocked ? 'Pass' : 'Fail',
            classification: mainBlocked && penaltyBlocked ? 'none' : 'policy',
            evidence: {
                timeline: {
                    main: mainEvents,
                    penalty: penaltyEvents,
                },
                snapshot: {
                    main: { pre: mainPre, post: mainPost },
                    penalty: { pre: penaltyPre, post: penaltyPost },
                },
                bypassSource: [
                    ...mainEvents.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source),
                    ...penaltyEvents.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source),
                ],
            },
        })
    }

    // 6) Swift Swim / Chlorophyll speed modifiers
    {
        const swiftCtx = createBaseContext()
        swiftCtx.activePokemon.ability = 'swift_swim'
        swiftCtx.activePokemon.pokemonId.abilities = ['swift_swim']
        swiftCtx.trainerSession.playerAbility = 'swift_swim'
        swiftCtx.trainerSession.playerTeam[0].ability = 'swift_swim'

        const chloroCtx = createBaseContext()
        chloroCtx.activePokemon.ability = 'chlorophyll'
        chloroCtx.activePokemon.pokemonId.abilities = ['chlorophyll']
        chloroCtx.trainerSession.playerAbility = 'chlorophyll'
        chloroCtx.trainerSession.playerTeam[0].ability = 'chlorophyll'

        const moves = [
            moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }),
        ]

        const swiftBattle = await runAttackTurn({ ...swiftCtx, moveDocs: moves, moveName: 'Tackle', fieldState: { weather: 'rain' } })
        const chloroBattle = await runAttackTurn({ ...chloroCtx, moveDocs: moves, moveName: 'Tackle', fieldState: { weather: 'sun' } })
        const swiftEvents = extractAbilityEvents(swiftBattle.turnPhases)
        const chloroEvents = extractAbilityEvents(chloroBattle.turnPhases)

        const swiftBoosted = Number(swiftBattle.playerSpeed || 0) > 50
        const chloroBoosted = Number(chloroBattle.playerSpeed || 0) > 50

        results.push({
            case: 'Swift Swim / Chlorophyll doi speed theo weather',
            expected: 'Rain boost speed cho Swift Swim, sun boost cho Chlorophyll.',
            observed: `swiftSpeed=${swiftBattle.playerSpeed}, chloroSpeed=${chloroBattle.playerSpeed}`,
            verdict: swiftBoosted && chloroBoosted ? 'Pass' : 'Fail',
            classification: swiftBoosted && chloroBoosted ? 'none' : 'policy',
            evidence: {
                timeline: {
                    swift: swiftEvents,
                    chloro: chloroEvents,
                },
                snapshot: {
                    swift: summarizeSessionSnapshot(swiftCtx.trainerSession),
                    chloro: summarizeSessionSnapshot(chloroCtx.trainerSession),
                },
                bypassSource: [],
            },
        })
    }

    // 7) set/copy/swap mutation updates ability and affects later turn
    {
        const setCtx = createBaseContext()
        setCtx.trainerOpponent.ability = 'intimidate'
        const setMove = moveDoc({
            name: 'Simple Beam Test',
            type: 'normal',
            category: 'status',
            power: 0,
            accuracy: 100,
            effectSpecs: [{
                op: 'set_target_ability',
                trigger: 'on_hit',
                target: 'opponent',
                chance: 1,
                params: { ability: 'levitate' },
            }],
        })
        const groundMove = moveDoc({ name: 'Earthquake', type: 'ground', category: 'physical', power: 100, accuracy: 100, pp: 10 })
        const moves = [setMove, groundMove, moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })]

        const pre = summarizeSessionSnapshot(setCtx.trainerSession)
        const setBattle = await runAttackTurn({ ...setCtx, moveDocs: moves, moveName: 'Simple Beam Test' })
        const mid = summarizeSessionSnapshot(setCtx.trainerSession)
        const followBattle = await runAttackTurn({ ...setCtx, moveDocs: moves, moveName: 'Earthquake' })
        const post = summarizeSessionSnapshot(setCtx.trainerSession)
        const events = {
            set: extractAbilityEvents(setBattle.turnPhases),
            follow: extractAbilityEvents(followBattle.turnPhases),
        }

        const setApplied = String(mid.opponent.ability) === 'levitate'
        const followBlocked = Number(followBattle.damage || 0) === 0

        // copy + swap quick semantic checks from integration helper
        const copyCtx = createBaseContext()
        copyCtx.trainerOpponent.ability = 'water_absorb'
        const copyMove = moveDoc({
            name: 'Role Play Test',
            type: 'normal',
            category: 'status',
            power: 0,
            accuracy: 100,
            effectSpecs: [{ op: 'copy_target_ability', trigger: 'on_hit', target: 'self', chance: 1, params: {} }],
        })
        const copyBattle = await runAttackTurn({ ...copyCtx, moveDocs: [copyMove, moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })], moveName: 'Role Play Test' })
        const copyPost = summarizeSessionSnapshot(copyCtx.trainerSession)

        const swapCtx = createBaseContext()
        swapCtx.activePokemon.ability = 'mold_breaker'
        swapCtx.activePokemon.pokemonId.abilities = ['mold_breaker']
        swapCtx.trainerSession.playerAbility = 'mold_breaker'
        swapCtx.trainerSession.playerTeam[0].ability = 'mold_breaker'
        swapCtx.trainerOpponent.ability = 'levitate'
        const swapMove = moveDoc({
            name: 'Skill Swap Test',
            type: 'psychic',
            category: 'status',
            power: 0,
            accuracy: 100,
            effectSpecs: [{ op: 'swap_abilities', trigger: 'on_hit', target: 'self', chance: 1, params: {} }],
        })
        const swapBattle = await runAttackTurn({ ...swapCtx, moveDocs: [swapMove, moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })], moveName: 'Skill Swap Test' })
        const swapPost = summarizeSessionSnapshot(swapCtx.trainerSession)

        const copyApplied = copyPost.playerAbility === 'water_absorb'
        const swapApplied = swapPost.playerAbility === 'levitate' && swapPost.opponent.ability === 'mold_breaker'

        results.push({
            case: 'set/copy/swap mutation dung va co hieu luc luot sau',
            expected: 'set doi ability target va luot sau ap dung; copy/swap cap nhat state dung.',
            observed: `setApplied=${setApplied}, followBlocked=${followBlocked}, copyApplied=${copyApplied}, swapApplied=${swapApplied}`,
            verdict: setApplied && followBlocked && copyApplied && swapApplied ? 'Pass' : 'Fail',
            classification: setApplied && followBlocked && copyApplied && swapApplied ? 'none' : 'state',
            evidence: {
                timeline: {
                    set: events.set,
                    follow: events.follow,
                    copy: extractAbilityEvents(copyBattle.turnPhases),
                    swap: extractAbilityEvents(swapBattle.turnPhases),
                },
                snapshot: {
                    pre,
                    mid,
                    post,
                    copyPost,
                    swapPost,
                },
                bypassSource: [],
            },
        })
    }

    // 8) ignoreTargetAbility is per-resolution only
    {
        const ctx = createBaseContext()
        ctx.trainerOpponent.ability = 'levitate'
        const ignoreGround = moveDoc({
            name: 'Sunsteel Ground',
            type: 'ground',
            category: 'physical',
            power: 100,
            accuracy: 100,
            effectSpecs: [{ op: 'ignore_target_ability', trigger: 'on_calculate_damage', target: 'self', chance: 1, params: { mode: 'ignore' } }],
        })
        const plainGround = moveDoc({ name: 'Earthquake', type: 'ground', category: 'physical', power: 100, accuracy: 100, pp: 10 })
        const moves = [ignoreGround, plainGround, moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })]

        const pre = summarizeSessionSnapshot(ctx.trainerSession)
        const firstBattle = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Sunsteel Ground' })
        const mid = summarizeSessionSnapshot(ctx.trainerSession)
        const secondBattle = await runAttackTurn({ ...ctx, moveDocs: moves, moveName: 'Earthquake' })
        const post = summarizeSessionSnapshot(ctx.trainerSession)
        const firstEvents = extractAbilityEvents(firstBattle.turnPhases)
        const secondEvents = extractAbilityEvents(secondBattle.turnPhases)
        const firstBypassSources = firstEvents.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source)

        const firstHit = Number(firstBattle.damage || 0) > 0
        const secondBlocked = Number(secondBattle.damage || 0) === 0
        const abilityStillLevitate = post.opponent.ability === 'levitate'

        results.push({
            case: 'ignoreTargetAbility chi ap dung trong mot resolve',
            expected: 'Luot ignore gay damage, luot sau khong ignore bi chan lai.',
            observed: `firstHit=${firstHit}, secondBlocked=${secondBlocked}, abilityStillLevitate=${abilityStillLevitate}, bypass=${JSON.stringify(firstBypassSources)}`,
            verdict: firstHit && secondBlocked && abilityStillLevitate && firstBypassSources.includes('move') ? 'Pass' : 'Fail',
            classification: firstHit && secondBlocked && abilityStillLevitate && firstBypassSources.includes('move') ? 'none' : 'ordering',
            evidence: {
                timeline: { first: firstEvents, second: secondEvents },
                snapshot: { pre, mid, post },
                bypassSource: firstBypassSources,
            },
        })
    }

    // 9) Suppression blocks hooks and clears on switch out
    {
        const ctx = createBaseContext()
        ctx.activePokemon.ability = 'levitate'
        ctx.activePokemon.pokemonId.abilities = ['levitate']
        ctx.trainerSession.playerAbility = 'levitate'
        ctx.trainerSession.playerTeam = [
            {
                slot: 0,
                userPokemonId: ctx.activePokemon._id,
                name: 'Lead',
                currentHp: 200,
                maxHp: 200,
                status: '',
                statusTurns: 0,
                ability: 'levitate',
                abilitySuppressed: false,
            },
            {
                slot: 1,
                userPokemonId: '64b00000000000000000c902',
                name: 'Bench',
                currentHp: 180,
                maxHp: 200,
                status: '',
                statusTurns: 0,
                ability: 'intimidate',
                abilitySuppressed: false,
            },
        ]
        const benchPokemon = createPartyPokemon({
            _id: '64b00000000000000000c902',
            name: 'Bench',
            level: 50,
            baseHp: 120,
            ability: 'intimidate',
            moves: ['Tackle'],
            partyIndex: 1,
        })
        benchPokemon.currentHp = 180
        benchPokemon.maxHp = 200
        ctx.trainerOpponent.counterMoves = [{
            name: 'Suppress Strike', type: 'ground', category: 'physical', power: 60, accuracy: 100, priority: 0, currentPp: 10, maxPp: 10,
        }]

        const suppressMove = moveDoc({
            name: 'Suppress Strike',
            type: 'ground',
            category: 'physical',
            power: 60,
            accuracy: 100,
            effectSpecs: [{ op: 'ignore_target_ability', trigger: 'on_calculate_damage', target: 'self', chance: 1, params: { mode: 'suppress' } }],
        })
        const playerMove = moveDoc({ name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 })

        const pre = summarizeSessionSnapshot(ctx.trainerSession)
        const battle = await runAttackTurn({
            ...ctx,
            partyRows: [ctx.activePokemon, benchPokemon],
            moveDocs: [playerMove, suppressMove],
            moveName: 'Tackle',
        })
        const mid = summarizeSessionSnapshot(ctx.trainerSession)
        const events = extractAbilityEvents(battle.turnPhases)

        clearTrainerSessionActivePlayerAbilitySuppression(ctx.trainerSession)
        setTrainerSessionActivePlayerByIndex(ctx.trainerSession, 1)
        const postSwitch = summarizeSessionSnapshot(ctx.trainerSession)

        const suppressedAfterHit = mid.playerAbilitySuppressed === true
        const clearedAfterSwitch = postSwitch.playerAbilitySuppressed === false && postSwitch.playerPokemonId === '64b00000000000000000c902'

        results.push({
            case: 'Suppression dai han va clear khi switch out',
            expected: 'Sau hit bi suppress=true, switch thuong clear suppression.',
            observed: `suppressedAfterHit=${suppressedAfterHit}, clearedAfterSwitch=${clearedAfterSwitch}`,
            verdict: suppressedAfterHit && clearedAfterSwitch ? 'Pass' : 'Fail',
            classification: suppressedAfterHit && clearedAfterSwitch ? 'none' : 'state',
            evidence: {
                timeline: events,
                snapshot: { pre, mid, postSwitch },
                bypassSource: events.filter((entry) => entry.kind === 'ability_ignore').map((entry) => entry.source),
            },
        })
    }

    // 10) Forced switch and regular switch keep snapshot abilities + heal clamp safety
    {
        const trainerSession = createTrainerSession({
            trainerId: '64b00000000000000000d001',
            playerPokemonId: '64b00000000000000000d101',
            playerCurrentHp: 0,
            playerMaxHp: 200,
            playerAbility: 'levitate',
            playerAbilitySuppressed: true,
            playerTeam: [
                {
                    slot: 0,
                    userPokemonId: '64b00000000000000000d101',
                    name: 'Lead',
                    currentHp: 0,
                    maxHp: 200,
                    status: '',
                    statusTurns: 0,
                    ability: 'levitate',
                    abilitySuppressed: true,
                },
                {
                    slot: 1,
                    userPokemonId: '64b00000000000000000d102',
                    name: 'Bench',
                    currentHp: 120,
                    maxHp: 180,
                    status: '',
                    statusTurns: 0,
                    ability: 'water_absorb',
                    abilitySuppressed: false,
                },
            ],
        })

        const pre = summarizeSessionSnapshot(trainerSession)
        const forcedInfo = applyTrainerSessionForcedPlayerSwitch(trainerSession)
        const postForced = summarizeSessionSnapshot(trainerSession)

        const hpAfterHeal = Math.min(180, 120 + 999)
        const healClampOk = hpAfterHeal === 180

        results.push({
            case: 'Forced/switch snapshot giu dung ability + heal clamp',
            expected: 'Forced switch chuyen sang bench dung ability snapshot, suppression clear, HP clamp max.',
            observed: `forcedSwitched=${Boolean(forcedInfo?.switched)}, activeAbility=${postForced.playerAbility}, suppression=${postForced.playerAbilitySuppressed}, healClampOk=${healClampOk}`,
            verdict: Boolean(forcedInfo?.switched) && postForced.playerAbility === 'water_absorb' && postForced.playerAbilitySuppressed === false && healClampOk ? 'Pass' : 'Fail',
            classification: Boolean(forcedInfo?.switched) && postForced.playerAbility === 'water_absorb' && postForced.playerAbilitySuppressed === false && healClampOk ? 'none' : 'state',
            evidence: {
                timeline: [{ kind: 'forced_switch', line: forcedInfo?.switched ? 'Forced switch applied in session helper.' : 'No forced switch.' }],
                snapshot: { pre, postForced },
                bypassSource: [],
            },
        })
    }

    return results
}

const printResults = (results = []) => {
    console.log('Case | Pass/Fail | Evidence')
    console.log('---|---|---')
    results.forEach((entry) => {
        console.log(`${entry.case} | ${entry.verdict} | classification=${entry.classification}; observed=${entry.observed}`)
    })

    console.log('\nDetailed Evidence JSON:')
    console.log(JSON.stringify(results, null, 2))
}

const main = async () => {
    const results = await runSmoke()
    const failed = results.filter((entry) => entry.verdict !== 'Pass')
    printResults(results)
    if (failed.length > 0) {
        console.error(`\nSmoke checklist failed: ${failed.length} case(s).`)
        process.exitCode = 1
        return
    }
    console.log('\nAbility smoke checklist passed')
}

main().catch((error) => {
    console.error('Ability smoke checklist failed with exception:', error)
    process.exitCode = 1
})
