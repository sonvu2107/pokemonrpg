import {
    normalizeBattleStatus,
    normalizeDamageGuards,
    normalizeStatStages,
    normalizeStatusTurns,
    normalizeVolatileState,
} from '../battle/battleState.js'
import { normalizePokemonTypes } from '../battle/typeSystem.js'

const TRAINER_POKEMON_DAMAGE_PERCENT_MIN = 0
const TRAINER_POKEMON_DAMAGE_PERCENT_MAX = 1000

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const getSpecialDefenseStat = (stats = {}) => (
    Number(stats?.spdef) || Number(stats?.spldef) || 0
)

export const getSpecialAttackStat = (stats = {}) => (
    Number(stats?.spatk) || 0
)

export const normalizeTrainerPokemonDamagePercent = (value, fallback = 100) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) {
        return clamp(fallback, TRAINER_POKEMON_DAMAGE_PERCENT_MIN, TRAINER_POKEMON_DAMAGE_PERCENT_MAX)
    }
    return clamp(parsed, TRAINER_POKEMON_DAMAGE_PERCENT_MIN, TRAINER_POKEMON_DAMAGE_PERCENT_MAX)
}

export const getAliveOpponentIndex = (team, startIndex = 0) => {
    if (!Array.isArray(team) || team.length === 0) return -1
    for (let index = Math.max(0, startIndex); index < team.length; index += 1) {
        if ((team[index]?.currentHp || 0) > 0) return index
    }
    return -1
}

export const serializeTrainerBattleState = (trainerSession = null) => {
    if (!trainerSession || !Array.isArray(trainerSession.team)) return null
    const currentIndex = Math.max(0, Number(trainerSession.currentIndex) || 0)
    return {
        currentIndex,
        defeatedAll: currentIndex >= trainerSession.team.length,
        fieldState: trainerSession.fieldState && typeof trainerSession.fieldState === 'object'
            ? trainerSession.fieldState
            : {},
        playerTeam: Array.isArray(trainerSession.playerTeam)
            ? trainerSession.playerTeam.map((entry, index) => ({
                slot: Math.max(0, Number(entry?.slot ?? index) || 0),
                userPokemonId: entry?.userPokemonId || null,
                name: String(entry?.name || `Pokemon ${index + 1}`).trim() || `Pokemon ${index + 1}`,
                currentHp: Math.max(0, Number(entry?.currentHp || 0)),
                maxHp: Math.max(1, Number(entry?.maxHp || 1)),
                status: normalizeBattleStatus(entry?.status),
                statusTurns: normalizeStatusTurns(entry?.statusTurns),
            }))
            : [],
        team: trainerSession.team.map((entry) => ({
            slot: Math.max(0, Number(entry?.slot) || 0),
            pokemonId: entry?.pokemonId || null,
            name: String(entry?.name || 'Pokemon').trim() || 'Pokemon',
            level: Math.max(1, Number(entry?.level) || 1),
            formId: String(entry?.formId || 'normal').trim().toLowerCase() || 'normal',
            currentHp: Math.max(0, Number(entry?.currentHp || 0)),
            maxHp: Math.max(1, Number(entry?.maxHp || 1)),
            status: normalizeBattleStatus(entry?.status),
            statusTurns: normalizeStatusTurns(entry?.statusTurns),
            statStages: normalizeStatStages(entry?.statStages),
            damageGuards: normalizeDamageGuards(entry?.damageGuards),
            wasDamagedLastTurn: Boolean(entry?.wasDamagedLastTurn),
            volatileState: normalizeVolatileState(entry?.volatileState),
            effectiveStats: entry?.effectiveStats && typeof entry.effectiveStats === 'object' ? entry.effectiveStats : null,
            baseStats: entry?.baseStats && typeof entry.baseStats === 'object' ? entry.baseStats : {},
            types: normalizePokemonTypes(entry?.types),
            damagePercent: normalizeTrainerPokemonDamagePercent(entry?.damagePercent, 100),
            counterMoves: Array.isArray(entry?.counterMoves) ? entry.counterMoves : [],
            counterMoveCursor: Math.max(0, Number(entry?.counterMoveCursor) || 0),
            counterMoveMode: String(entry?.counterMoveMode || '').trim(),
        })),
    }
}

export const resolveTrainerAverageLevel = (trainerLike = {}) => {
    const levels = (Array.isArray(trainerLike?.team) ? trainerLike.team : [])
        .map((entry) => Math.max(1, Number(entry?.level || 1)))
    if (levels.length === 0) return 1
    const total = levels.reduce((sum, level) => sum + level, 0)
    return Math.max(1, Math.round(total / levels.length))
}
