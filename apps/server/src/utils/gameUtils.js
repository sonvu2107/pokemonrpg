
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
    a: 1.05,
    s: 1.10,
    ss: 1.12,
    sss: 1.15,
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
    const gain = getRarityStatGain(rarity)
    const multiplier = getRarityStatMultiplier(rarity)
    const step = Math.max(0, level - 1) * gain
    return {
        hp: Math.max(1, Math.floor(((baseStats.hp || 0) + step) * multiplier)),
        atk: Math.max(1, Math.floor(((baseStats.atk || 0) + step) * multiplier)),
        def: Math.max(1, Math.floor(((baseStats.def || 0) + step) * multiplier)),
        spatk: Math.max(1, Math.floor(((baseStats.spatk || 0) + step) * multiplier)),
        spdef: Math.max(1, Math.floor(((baseStats.spldef || 0) + step) * multiplier)),
        spd: Math.max(1, Math.floor(((baseStats.spd || 0) + step) * multiplier)),
    }
}

export const calcMaxHp = (baseHp, level, rarity) => {
    const stats = calcStatsForLevel({ hp: baseHp }, level, rarity)
    return Math.max(10, Math.floor(stats.hp))
}
