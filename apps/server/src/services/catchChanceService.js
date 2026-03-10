export const LOW_HP_CATCH_BONUS_CAP_BY_RARITY = Object.freeze({
    'sss+': 5,
    d: 24,
    c: 22,
    b: 20,
    a: 18,
    s: 14,
    ss: 10,
    sss: 7,
})
export const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 16
export const CATCH_CHANCE_MIN = 0.02
export const CATCH_CHANCE_MAX = 0.99

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const calcBaseChance = ({ catchRate, hp, maxHp }) => {
    const rate = clamp(catchRate || 45, 1, 255)
    const safeMaxHp = Math.max(1, Number(maxHp) || 1)
    const safeHp = clamp(Number(hp) || safeMaxHp, 0, safeMaxHp)
    const hpFactor = (3 * safeMaxHp - 2 * safeHp) / (3 * safeMaxHp)
    return clamp((rate / 255) * hpFactor, CATCH_CHANCE_MIN, 0.95)
}
const resolveLowHpBonusCapPercent = (rarity = '') => {
    const r = String(rarity || '').trim().toLowerCase()
    const cap = Number(LOW_HP_CATCH_BONUS_CAP_BY_RARITY[r])
    return Number.isFinite(cap) && cap >= 0 ? cap : LOW_HP_CATCH_BONUS_CAP_FALLBACK
}

const calcLowHpBonusPercent = ({ hp, maxHp, rarity }) => {
    const safeMaxHp = Math.max(1, Number(maxHp) || 1)
    const safeHp = clamp(Number(hp) || safeMaxHp, 0, safeMaxHp)
    const missingRatio = (safeMaxHp - safeHp) / safeMaxHp
    return Math.max(0, missingRatio * resolveLowHpBonusCapPercent(rarity))
}

export const calcCatchChance = ({
    catchRate,
    hp,
    maxHp,
    rarity = 'd',
    ballItem = null,
    vipSsBonusPct = 0,
    mode = 'wild',
}) => {
    const isValley = mode === 'valley'
    const effectiveHp = isValley ? (maxHp ?? 100) : (hp ?? maxHp ?? 100)
    const effectiveMaxHp = maxHp ?? 100
    const baseChance = calcBaseChance({
        catchRate,
        hp: effectiveHp,
        maxHp: effectiveMaxHp,
    })
    const pokemonRarity = String(rarity || '').trim().toLowerCase()
    const ssBonusPct = pokemonRarity === 'ss' ? Math.max(0, Number(vipSsBonusPct) || 0) : 0
    const chanceAfterVip = ssBonusPct > 0
        ? clamp(baseChance * (1 + ssBonusPct / 100), CATCH_CHANCE_MIN, 0.95)
        : baseChance
    const lowHpBonusPercent = isValley
        ? 0
        : calcLowHpBonusPercent({ hp: effectiveHp, maxHp: effectiveMaxHp, rarity })
    const hasFixedRate =
        ballItem?.effectType === 'catchMultiplier' &&
        Number.isFinite(Number(ballItem.effectValue))

    let chanceBeforeLowHp
    let ballLabel = ballItem?.name || 'Poké Ball'

    if (hasFixedRate) {
        chanceBeforeLowHp = clamp(Number(ballItem.effectValue) / 100, 0, 1)
    } else {
        chanceBeforeLowHp = chanceAfterVip
    }
    const minChance = hasFixedRate ? 0 : CATCH_CHANCE_MIN
    const chance = clamp(
        chanceBeforeLowHp * (1 + lowHpBonusPercent / 100),
        minChance,
        CATCH_CHANCE_MAX,
    )

    return {
        chance,
        lowHpBonusPercent,
        ballLabel,
    }
}

export const rollCatch = (chance) => Math.random() < chance
export const catchChanceLabel = (chance) => {
    if (chance >= 0.75) return 'Rất cao'
    if (chance >= 0.45) return 'Cao'
    if (chance >= 0.20) return 'Trung bình'
    return 'Thấp'
}
