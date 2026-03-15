import assert from 'assert'
import {
    FUSION_BASE_SUCCESS_RATE_BY_LEVEL,
    FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET,
    FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET,
    FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT,
    FUSION_MILESTONE_PRESETS,
    FUSION_SUPER_STONE_BONUS_PERCENT,
    FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL,
    buildDefaultStrictMaterialRulesByRarity,
    normalizeFusionRuntimeConfig,
    normalizeFusionLevel,
    getFusionBaseSuccessRate,
    getFusionFailurePenalty,
    getFusionTotalStatBonusPercent,
    resolveFusionStrictMaterialRule,
    computeFusionFinalSuccessRate,
    resolveFusionMilestoneLabel,
} from './utils/fusionUtils.js'

const testNormalizeFusionLevel = () => {
    assert.strictEqual(normalizeFusionLevel(undefined), 0)
    assert.strictEqual(normalizeFusionLevel(null), 0)
    assert.strictEqual(normalizeFusionLevel(-5), 0)
    assert.strictEqual(normalizeFusionLevel('7'), 7)
    assert.strictEqual(normalizeFusionLevel('7.9'), 7)
    assert.strictEqual(normalizeFusionLevel('abc'), 0)
}

const testBaseSuccessRateByLevel = () => {
    assert.strictEqual(getFusionBaseSuccessRate(0), FUSION_BASE_SUCCESS_RATE_BY_LEVEL[0])
    assert.strictEqual(getFusionBaseSuccessRate(5), FUSION_BASE_SUCCESS_RATE_BY_LEVEL[5])
    assert.strictEqual(getFusionBaseSuccessRate(9999), FUSION_BASE_SUCCESS_RATE_BY_LEVEL[FUSION_BASE_SUCCESS_RATE_BY_LEVEL.length - 1])
}

const testFailurePenaltyBrackets = () => {
    assert.strictEqual(getFusionFailurePenalty(0), 0)
    assert.strictEqual(getFusionFailurePenalty(4), 0)
    assert.strictEqual(getFusionFailurePenalty(5), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel5 || 0))
    assert.strictEqual(getFusionFailurePenalty(9), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel5 || 0))
    assert.strictEqual(getFusionFailurePenalty(10), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel10 || 0))
    assert.strictEqual(getFusionFailurePenalty(14), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel10 || 0))
    assert.strictEqual(getFusionFailurePenalty(15), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel15 || 0))
    assert.strictEqual(getFusionFailurePenalty(9999), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel15 || 0))

    const customThresholds = {
        fromLevel5: 3,
        fromLevel10: 6,
        fromLevel15: 12,
    }
    assert.strictEqual(getFusionFailurePenalty(2, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET, customThresholds), 0)
    assert.strictEqual(getFusionFailurePenalty(3, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET, customThresholds), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel5 || 0))
    assert.strictEqual(getFusionFailurePenalty(6, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET, customThresholds), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel10 || 0))
    assert.strictEqual(getFusionFailurePenalty(12, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET, customThresholds), Number(FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel15 || 0))
}

const testFinalSuccessRateComputation = () => {
    const plain = computeFusionFinalSuccessRate({ fusionLevel: 0 })
    assert.deepStrictEqual(plain, {
        baseSuccessRate: FUSION_BASE_SUCCESS_RATE_BY_LEVEL[0],
        luckyBonusPercent: 0,
        superBonusPercent: 0,
        finalSuccessRate: FUSION_BASE_SUCCESS_RATE_BY_LEVEL[0],
    })

    const withLuckyAndSuper = computeFusionFinalSuccessRate({
        fusionLevel: 10,
        luckyBonusPercent: 22,
        hasSuperFusionStone: true,
    })
    assert.strictEqual(withLuckyAndSuper.baseSuccessRate, FUSION_BASE_SUCCESS_RATE_BY_LEVEL[10])
    assert.strictEqual(withLuckyAndSuper.luckyBonusPercent, 22)
    assert.strictEqual(withLuckyAndSuper.superBonusPercent, FUSION_SUPER_STONE_BONUS_PERCENT)
    assert.strictEqual(withLuckyAndSuper.finalSuccessRate, Math.min(FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT, FUSION_BASE_SUCCESS_RATE_BY_LEVEL[10] + 22 + FUSION_SUPER_STONE_BONUS_PERCENT))

    const clamped = computeFusionFinalSuccessRate({
        fusionLevel: 0,
        luckyBonusPercent: 500,
        hasSuperFusionStone: true,
    })
    assert.strictEqual(clamped.luckyBonusPercent, 100)
    assert.strictEqual(clamped.finalSuccessRate, FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT)

    const customCap = computeFusionFinalSuccessRate({
        fusionLevel: 0,
        luckyBonusPercent: 20,
        hasSuperFusionStone: true,
        finalSuccessRateCapPercent: 80,
    })
    assert.strictEqual(customCap.finalSuccessRate, 80)
}

const testNormalizeRuntimeConfig = () => {
    const normalized = normalizeFusionRuntimeConfig({
        strictMaterialUntilFusionLevel: -2,
        superFusionStoneBonusPercent: 150,
        finalSuccessRateCapPercent: 120,
        baseSuccessRateByFusionLevel: [120, -10, 45],
        failurePenaltyByLevelBracket: {
            fromLevel5: -2,
            fromLevel10: 3,
            fromLevel15: 4,
        },
        failureLevelThresholdByBracket: {
            fromLevel5: -10,
            fromLevel10: 6,
            fromLevel15: 15,
        },
    })

    assert.strictEqual(normalized.strictMaterialUntilFusionLevel, 0)
    assert.strictEqual(Boolean(normalized.strictMaterialRulesByRarity?.d), true)
    assert.strictEqual(normalized.superFusionStoneBonusPercent, 100)
    assert.strictEqual(normalized.finalSuccessRateCapPercent, 100)
    assert.deepStrictEqual(normalized.baseSuccessRateByFusionLevel, [100, 0, 45])
    assert.deepStrictEqual(normalized.totalStatBonusPercentByFusionLevel, [...FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL])
    assert.strictEqual(normalized.failurePenaltyByLevelBracket.fromLevel5, 0)
    assert.strictEqual(normalized.failurePenaltyByLevelBracket.fromLevel10, 3)
    assert.strictEqual(normalized.failureLevelThresholdByBracket.fromLevel5, 0)
    assert.strictEqual(normalized.failureLevelThresholdByBracket.fromLevel10, 6)
}

const testTotalStatBonusByLevel = () => {
    assert.strictEqual(getFusionTotalStatBonusPercent(0), FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL[0])
    assert.strictEqual(getFusionTotalStatBonusPercent(6), FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL[6])
    assert.strictEqual(getFusionTotalStatBonusPercent(20), FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL[20])
    assert.strictEqual(
        getFusionTotalStatBonusPercent(9999),
        FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL[FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL.length - 1]
    )
}

const testStrictMaterialRuleByRarity = () => {
    const defaultRules = buildDefaultStrictMaterialRulesByRarity(5)
    const strictAtLowLevel = resolveFusionStrictMaterialRule({
        fusionLevel: 3,
        targetRarity: 'a',
        strictMaterialRulesByRarity: defaultRules,
        strictMaterialUntilFusionLevel: 5,
    })
    assert.strictEqual(strictAtLowLevel.isStrict, true)
    assert.strictEqual(strictAtLowLevel.requireSameSpecies, true)
    assert.strictEqual(strictAtLowLevel.requireSameForm, true)
    assert.strictEqual(strictAtLowLevel.requireSameLevel, true)

    const customRules = {
        ...defaultRules,
        a: {
            enabled: true,
            fromFusionLevel: 0,
            toFusionLevel: 7,
            requireSameSpecies: true,
            requireSameForm: true,
            requireSameLevel: false,
        },
    }
    const strictCustom = resolveFusionStrictMaterialRule({
        fusionLevel: 6,
        targetRarity: 'a',
        strictMaterialRulesByRarity: customRules,
        strictMaterialUntilFusionLevel: 5,
    })
    assert.strictEqual(strictCustom.isStrict, true)
    assert.strictEqual(strictCustom.requireSameLevel, false)

    const nonStrictAtHighLevel = resolveFusionStrictMaterialRule({
        fusionLevel: 8,
        targetRarity: 'a',
        strictMaterialRulesByRarity: customRules,
        strictMaterialUntilFusionLevel: 5,
    })
    assert.strictEqual(nonStrictAtHighLevel.isStrict, false)
}

const testMilestonesShape = () => {
    assert(Array.isArray(FUSION_MILESTONE_PRESETS) && FUSION_MILESTONE_PRESETS.length >= 3)
    const first = FUSION_MILESTONE_PRESETS[0]
    assert.strictEqual(first.from, 0)
    assert.strictEqual(first.to, 4)
    assert.strictEqual(resolveFusionMilestoneLabel(0), String(first.label))
    assert.strictEqual(resolveFusionMilestoneLabel(7), '+10 (5 sao xanh đậm)')
    assert.strictEqual(resolveFusionMilestoneLabel(99), '5 sao đỏ')
}

const run = () => {
    testNormalizeFusionLevel()
    testBaseSuccessRateByLevel()
    testFailurePenaltyBrackets()
    testFinalSuccessRateComputation()
    testMilestonesShape()
    testTotalStatBonusByLevel()
    testStrictMaterialRuleByRarity()
    testNormalizeRuntimeConfig()
    console.log('testFusionUtilsFlow passed')
}

run()
