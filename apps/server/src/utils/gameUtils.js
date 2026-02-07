
export const EXP_PER_SEARCH = 1
export const expToNext = (level) => 250 + Math.max(0, level - 1) * 100

export const RARITY_STAT_GAIN = {
    d: 1,
    c: 3,
    b: 6,
    a: 9,
    s: 13,
    ss: 20,
}

export const RARITY_ALIASES = {
    superlegendary: 'ss',
    legendary: 's',
    ultra_rare: 'a',
    rare: 'b',
    uncommon: 'c',
    common: 'd',
}

export const normalizeRarity = (rarity) => {
    const normalized = String(rarity || 'd').trim().toLowerCase()
    return RARITY_ALIASES[normalized] || normalized
}

export const getRarityStatGain = (rarity) => RARITY_STAT_GAIN[normalizeRarity(rarity)] ?? 1

export const calcStatsForLevel = (baseStats = {}, level = 1, rarity = 'd') => {
    const gain = getRarityStatGain(rarity)
    const step = Math.max(0, level - 1) * gain
    return {
        hp: Math.max(1, (baseStats.hp || 0) + step),
        atk: Math.max(1, (baseStats.atk || 0) + step),
        def: Math.max(1, (baseStats.def || 0) + step),
        spatk: Math.max(1, (baseStats.spatk || 0) + step),
        spdef: Math.max(1, (baseStats.spldef || 0) + step),
        spd: Math.max(1, (baseStats.spd || 0) + step),
    }
}

export const calcMaxHp = (baseHp, level, rarity) => {
    const stats = calcStatsForLevel({ hp: baseHp }, level, rarity)
    return Math.max(10, Math.floor(stats.hp))
}
