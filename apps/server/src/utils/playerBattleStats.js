import { calcMaxHp } from './gameUtils.js'

export const normalizeHpBonusPercent = (value = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, parsed)
}

export const resolvePlayerBattleMaxHp = ({
    baseHp = 1,
    level = 1,
    rarity = 'd',
    hpBonusPercent = 0,
} = {}) => {
    const normalizedLevel = Math.max(1, Number(level) || 1)
    const baseMaxHp = Math.max(1, calcMaxHp(baseHp, normalizedLevel, rarity))
    const normalizedHpBonusPercent = normalizeHpBonusPercent(hpBonusPercent)
    return Math.max(1, Math.floor(baseMaxHp * (1 + (normalizedHpBonusPercent / 100))))
}
