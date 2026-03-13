import BattleSession from '../models/BattleSession.js'
import { calcMaxHp, calcStatsForLevel } from '../utils/gameUtils.js'
import {
    normalizeFormId,
    resolveEffectivePokemonBaseStats,
    resolvePokemonFormEntry,
} from '../utils/pokemonFormStats.js'

const ACTIVE_TRAINER_BATTLE_TTL_MS = 30 * 60 * 1000

const normalizePokemonTypes = (types = []) => {
    const entries = Array.isArray(types) ? types : []
    return [...new Set(entries.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))]
}

const normalizeTrainerPokemonDamagePercent = (value, fallback = 100) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return Math.max(0, Math.min(1000, fallback))
    return Math.max(0, Math.min(1000, parsed))
}

export const getTrainerBattleSessionExpiryDate = () => new Date(Date.now() + ACTIVE_TRAINER_BATTLE_TTL_MS)

export const buildTrainerBattleTeam = (trainer = {}) => {
    const team = Array.isArray(trainer?.team) ? trainer.team : []
    return team
        .map((entry, index) => {
            const pokemon = entry?.pokemonId
            if (!pokemon || typeof pokemon !== 'object') return null

            const level = Math.max(1, Number(entry?.level) || 1)
            const formId = normalizeFormId(entry?.formId || pokemon?.defaultFormId || 'normal')
            const resolvedForm = resolvePokemonFormEntry(pokemon, formId)
            const baseStats = resolveEffectivePokemonBaseStats({
                pokemonLike: pokemon,
                formId,
                resolvedForm,
            })
            const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
            const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)

            return {
                slot: index,
                pokemonId: pokemon._id,
                name: String(pokemon.name || 'Pokemon').trim() || 'Pokemon',
                level,
                formId,
                damagePercent: normalizeTrainerPokemonDamagePercent(entry?.damagePercent, 100),
                types: normalizePokemonTypes(pokemon.types),
                baseStats: scaledStats,
                currentHp: maxHp,
                maxHp,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
                counterMoves: [],
                counterMoveCursor: 0,
                counterMoveMode: 'smart-random',
            }
        })
        .filter(Boolean)
}

export const buildTrainerBattleSessionPayload = ({ userId, trainerId, trainer, activePokemonId = null } = {}) => ({
    userId,
    trainerId,
    team: buildTrainerBattleTeam(trainer),
    playerTeam: [],
    knockoutCounts: [],
    currentIndex: 0,
    playerPokemonId: activePokemonId || null,
    playerCurrentHp: 0,
    playerMaxHp: 1,
    playerStatus: '',
    playerStatusTurns: 0,
    playerStatStages: {},
    playerDamageGuards: {},
    playerWasDamagedLastTurn: false,
    playerVolatileState: {},
    fieldState: {},
    expiresAt: getTrainerBattleSessionExpiryDate(),
})

export const getOrCreateTrainerBattleSession = async (userId, trainerId, trainer, activePokemonId = null, existingSession = null) => {
    const now = new Date()
    const expiresAt = getTrainerBattleSessionExpiryDate()
    const normalizedTrainerId = String(trainerId || '').trim()
    const existingSessionTrainerId = String(existingSession?.trainerId || '').trim()
    const canReuseExistingSession = Boolean(existingSession && existingSessionTrainerId && normalizedTrainerId && existingSessionTrainerId === normalizedTrainerId)
    let session = canReuseExistingSession ? existingSession : null

    if (!session) {
        session = await BattleSession.findOne({ userId, trainerId })
    }

    if (!session) {
        return BattleSession.create({
            ...buildTrainerBattleSessionPayload({ userId, trainerId, trainer, activePokemonId }),
            expiresAt,
        })
    }

    const isActive = session.expiresAt && session.expiresAt > now && Array.isArray(session.team) && session.team.length > 0
    if (!isActive) {
        const payload = buildTrainerBattleSessionPayload({ userId, trainerId, trainer, activePokemonId })
        session.team = payload.team
        session.playerTeam = payload.playerTeam
        session.knockoutCounts = payload.knockoutCounts
        session.currentIndex = payload.currentIndex
        session.playerPokemonId = payload.playerPokemonId
        session.playerCurrentHp = payload.playerCurrentHp
        session.playerMaxHp = payload.playerMaxHp
        session.playerStatus = payload.playerStatus
        session.playerStatusTurns = payload.playerStatusTurns
        session.playerStatStages = payload.playerStatStages
        session.playerDamageGuards = payload.playerDamageGuards
        session.playerWasDamagedLastTurn = payload.playerWasDamagedLastTurn
        session.playerVolatileState = payload.playerVolatileState
        session.fieldState = payload.fieldState
    }

    session.expiresAt = expiresAt
    session.updatedAt = now
    await session.save()
    return session
}

export const buildCompletedTrainerBattleSessionPayload = ({ userId, trainer, activePokemonId = null } = {}) => {
    const team = buildTrainerBattleTeam(trainer)
    const resolvedTrainerId = trainer?._id || trainer?.id || null
    return {
        userId,
        trainerId: resolvedTrainerId,
        team,
        playerTeam: [],
        knockoutCounts: activePokemonId
            ? [{ userPokemonId: activePokemonId, defeatedCount: Math.max(1, team.length) }]
            : [],
        currentIndex: team.length,
        playerPokemonId: activePokemonId || null,
        playerCurrentHp: 1,
        playerMaxHp: 1,
        playerStatus: '',
        playerStatusTurns: 0,
        playerStatStages: {},
        playerDamageGuards: {},
        playerWasDamagedLastTurn: false,
        playerVolatileState: {},
        fieldState: {},
        expiresAt: getTrainerBattleSessionExpiryDate(),
    }
}

export const createCompletedTrainerBattleSession = async ({ userId, trainer, activePokemonId = null } = {}) => {
    const payload = buildCompletedTrainerBattleSessionPayload({ userId, trainer, activePokemonId })
    if (!payload.trainerId) {
        throw new Error('Thiếu trainerId khi tạo completed trainer battle session')
    }
    return BattleSession.findOneAndUpdate(
        { userId, trainerId: payload.trainerId },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
}
