export const calcBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat, modifier = 1 }) => {
    if (!Number.isFinite(modifier) || modifier <= 0) return 0
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const randomFactor = 0.85 + Math.random() * 0.15
    return Math.max(1, Math.floor(base * modifier * randomFactor))
}

export const estimateBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat, modifier = 1 }) => {
    if (!Number.isFinite(modifier) || modifier <= 0) return 0
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const averageRandomFactor = 0.925
    return Math.max(1, Math.floor(base * modifier * averageRandomFactor))
}
