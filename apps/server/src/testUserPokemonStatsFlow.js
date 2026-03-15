import assert from 'assert'
import {
    computeCombatPowerFromStats,
    resolveUserPokemonFinalStats,
} from './utils/userPokemonStats.js'

const baseStats = {
    hp: 100,
    atk: 90,
    def: 80,
    spatk: 70,
    spdef: 60,
    spd: 50,
}

const testLevelOnlyStats = () => {
    const resolved = resolveUserPokemonFinalStats({
        baseStats,
        level: 1,
        rarity: 'd',
    })

    assert.deepStrictEqual(resolved.scaledStats, {
        hp: 100,
        atk: 90,
        def: 80,
        spatk: 70,
        spdef: 60,
        spd: 50,
    })
    assert.deepStrictEqual(resolved.finalStats, resolved.scaledStats)
    assert.strictEqual(resolved.maxHp, 100)
}

const testFusionBonusStats = () => {
    const resolved = resolveUserPokemonFinalStats({
        baseStats,
        level: 30,
        rarity: 'd',
        fusionBonusPercent: 10,
    })

    assert.deepStrictEqual(resolved.scaledStats, {
        hp: 176,
        atk: 158,
        def: 141,
        spatk: 123,
        spdef: 106,
        spd: 88,
    })
    assert.deepStrictEqual(resolved.finalStats, resolved.scaledStats)
    assert.strictEqual(resolved.maxHp, 176)
}

const testFusionAndIvEvStats = () => {
    const resolved = resolveUserPokemonFinalStats({
        baseStats,
        level: 30,
        rarity: 'd',
        fusionLevel: 2,
        totalStatBonusPercentByFusionLevel: [0, 1, 10],
        ivs: { hp: 31, atk: 20, def: 10, spatk: 5, spdef: 3, spd: 1 },
        evs: { hp: 200, atk: 80, def: 40, spatk: 16, spdef: 8, spd: 7 },
    })

    assert.deepStrictEqual(resolved.scaledStats, {
        hp: 176,
        atk: 158,
        def: 141,
        spatk: 123,
        spdef: 106,
        spd: 88,
    })
    assert.deepStrictEqual(resolved.finalStats, {
        hp: 232,
        atk: 188,
        def: 156,
        spatk: 130,
        spdef: 110,
        spd: 89,
    })
    assert.strictEqual(resolved.maxHp, 232)
}

const testEvRoundingAndCombatPowerConsistency = () => {
    const lowEv = resolveUserPokemonFinalStats({
        baseStats,
        level: 10,
        evs: { spd: 7 },
    })
    const highEv = resolveUserPokemonFinalStats({
        baseStats,
        level: 10,
        evs: { spd: 8 },
    })

    assert.strictEqual(highEv.finalStats.spd, lowEv.finalStats.spd + 1)

    const expectedPower = computeCombatPowerFromStats({
        stats: highEv.finalStats,
        level: 10,
        isShiny: false,
    })
    assert.strictEqual(highEv.combatPower, expectedPower)
}

const run = () => {
    testLevelOnlyStats()
    testFusionBonusStats()
    testFusionAndIvEvStats()
    testEvRoundingAndCombatPowerConsistency()
    console.log('testUserPokemonStatsFlow passed')
}

run()
