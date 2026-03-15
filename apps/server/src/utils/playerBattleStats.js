import { calcMaxHp } from './gameUtils.js'
import { resolveUserPokemonFinalStats } from './userPokemonStats.js'

export const normalizeHpBonusPercent = (value = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, parsed)
}

export const resolvePlayerBattleMaxHp = ({
    baseHp = 1,
    baseStats = null,
    level = 1,
    rarity = 'd',
    ivs = {},
    evs = {},
    fusionBonusPercent = 0,
    hpBonusPercent = 0,
} = {}) => {
    const normalizedLevel = Math.max(1, Number(level) || 1)
    const resolvedBaseStats = baseStats && typeof baseStats === 'object'
        ? baseStats
        : { hp: baseHp }
    const baseMaxHp = baseStats && typeof baseStats === 'object'
        ? resolveUserPokemonFinalStats({
            baseStats: resolvedBaseStats,
            level: normalizedLevel,
            rarity,
            fusionBonusPercent,
            ivs,
            evs,
        }).maxHp
        : Math.max(1, calcMaxHp(baseHp, normalizedLevel, rarity, { fusionBonusPercent }))
    const normalizedHpBonusPercent = normalizeHpBonusPercent(hpBonusPercent)
    return Math.max(1, Math.floor(baseMaxHp * (1 + (normalizedHpBonusPercent / 100))))
}
