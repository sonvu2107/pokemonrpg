import { calcStatsForLevel } from './gameUtils.js'
import { getFusionTotalStatBonusPercent } from './fusionUtils.js'

const toStatNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toSafePositiveInt = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1)
    return Math.max(1, Math.floor(parsed))
}

const resolveStatWithIvEv = ({
    key,
    aliases = [],
    scaledStats = {},
    ivs = {},
    evs = {},
} = {}) => {
    const iv = toStatNumber(ivs[key] ?? aliases.map((alias) => ivs[alias]).find((value) => value != null))
    const ev = toStatNumber(evs[key] ?? aliases.map((alias) => evs[alias]).find((value) => value != null))
    const scaled = toStatNumber(scaledStats[key] ?? aliases.map((alias) => scaledStats[alias]).find((value) => value != null))
    return Math.max(1, Math.floor(scaled + iv + (ev / 8)))
}

export const buildFinalStatsFromScaled = ({ scaledStats = {}, ivs = {}, evs = {} } = {}) => ({
    hp: resolveStatWithIvEv({ key: 'hp', scaledStats, ivs, evs }),
    atk: resolveStatWithIvEv({ key: 'atk', scaledStats, ivs, evs }),
    def: resolveStatWithIvEv({ key: 'def', scaledStats, ivs, evs }),
    spatk: resolveStatWithIvEv({ key: 'spatk', scaledStats, ivs, evs }),
    spdef: resolveStatWithIvEv({ key: 'spdef', aliases: ['spldef'], scaledStats, ivs, evs }),
    spd: resolveStatWithIvEv({ key: 'spd', scaledStats, ivs, evs }),
})

export const computeCombatPowerFromStats = ({ stats = {}, level = 1, isShiny = false, fallback = 1 } = {}) => {
    const hp = Math.max(1, Number(stats?.hp) || 1)
    const atk = Math.max(1, Number(stats?.atk) || 1)
    const def = Math.max(1, Number(stats?.def) || 1)
    const spatk = Math.max(1, Number(stats?.spatk) || 1)
    const spdef = Math.max(1, Number(stats?.spdef) || Number(stats?.spldef) || 1)
    const spd = Math.max(1, Number(stats?.spd) || 1)
    const normalizedLevel = Math.max(1, Number(level) || 1)

    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (normalizedLevel * 2)
    const shinyBonus = isShiny ? 1.03 : 1

    return toSafePositiveInt(rawPower * shinyBonus, fallback)
}

export const resolveUserPokemonFinalStats = ({
    baseStats = {},
    level = 1,
    rarity = 'd',
    fusionLevel = 0,
    fusionBonusPercent = null,
    totalStatBonusPercentByFusionLevel = [],
    ivs = {},
    evs = {},
    isShiny = false,
} = {}) => {
    const normalizedLevel = Math.max(1, Number(level) || 1)
    const resolvedFusionBonusPercent = fusionBonusPercent != null
        ? Math.max(0, Number(fusionBonusPercent) || 0)
        : getFusionTotalStatBonusPercent(fusionLevel, totalStatBonusPercentByFusionLevel)

    const scaledStats = calcStatsForLevel(baseStats, normalizedLevel, rarity, {
        fusionBonusPercent: resolvedFusionBonusPercent,
    })
    const finalStats = buildFinalStatsFromScaled({
        scaledStats,
        ivs,
        evs,
    })
    const maxHp = Math.max(10, Math.floor(Number(finalStats?.hp) || 1))
    const combatPower = computeCombatPowerFromStats({
        stats: finalStats,
        level: normalizedLevel,
        isShiny,
        fallback: Math.max(1, normalizedLevel * 10),
    })

    return {
        fusionBonusPercent: resolvedFusionBonusPercent,
        scaledStats,
        finalStats,
        maxHp,
        combatPower,
    }
}
