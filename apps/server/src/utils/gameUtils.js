
export const EXP_PER_SEARCH = 1
export const expToNext = (level) => 250 + Math.max(0, level - 1) * 100

export const RARITY_STAT_GAIN = {
    d: 1,
    c: 3,
    b: 6,
    a: 9,
    s: 13,
    ss: 20,
    sss: 50,
}

export const RARITY_STAT_MULTIPLIER = {
    d: 1.0,
    c: 1.0,
    b: 1.0,
    a: 1.02,
    s: 1.04,
    ss: 1.06,
    sss: 1.08,
}

export const RARITY_EXP_MULTIPLIER = {
    d: 1.0,
    c: 1.0,
    b: 1.0,
    a: 1.1,
    s: 1.25,
    ss: 1.35,
    sss: 1.5,
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

export const getRarityStatMultiplier = (rarity) => RARITY_STAT_MULTIPLIER[normalizeRarity(rarity)] ?? 1.0

export const getRarityExpMultiplier = (rarity) => RARITY_EXP_MULTIPLIER[normalizeRarity(rarity)] ?? 1.0

export const calcStatsForLevel = (baseStats = {}, level = 1, rarity = 'd') => {
    const safeLevel = Math.max(1, Number(level) || 1)
    const specialDefense = baseStats.spdef ?? baseStats.spldef ?? 0
    const scaleStat = (baseValue) => {
        const safeBase = Math.max(1, Number(baseValue) || 0)
        if (safeLevel <= 1) return safeBase
        const levelGain = Math.floor((2 * safeBase * safeLevel) / 100)
        return Math.max(1, safeBase + levelGain)
    }

    return {
        hp: scaleStat(baseStats.hp || 0),
        atk: scaleStat(baseStats.atk || 0),
        def: scaleStat(baseStats.def || 0),
        spatk: scaleStat(baseStats.spatk || 0),
        spdef: scaleStat(specialDefense),
        spd: scaleStat(baseStats.spd || 0),
    }
}

export const calcMaxHp = (baseHp, level, rarity) => {
    const stats = calcStatsForLevel({ hp: baseHp }, level, rarity)
    return Math.max(10, Math.floor(stats.hp))
}
