export const FUSION_ITEM_EFFECT_TYPES = ['fusionStone', 'fusionLuckyStone', 'fusionProtectionStone', 'superFusionStone']

export const FUSION_ITEM_FIELD_BY_EFFECT_TYPE = Object.freeze({
    fusionStone: 'fusionStoneItemId',
    fusionLuckyStone: 'fusionLuckyStoneItemId',
    fusionProtectionStone: 'fusionProtectionStoneItemId',
    superFusionStone: 'superFusionStoneItemId',
})

export const FUSION_ITEM_SLOT_META = Object.freeze({
    fusionStone: {
        label: 'Đá ghép',
        required: true,
        description: 'Vật phẩm bắt buộc để thực hiện 1 lượt ghép Pokemon.',
    },
    fusionLuckyStone: {
        label: 'Đá may mắn',
        required: false,
        description: 'Cộng thêm phần trăm tỉ lệ ghép thành công theo chỉ số hiệu lực của vật phẩm.',
    },
    fusionProtectionStone: {
        label: 'Đá bảo hộ',
        required: false,
        description: 'Giữ nguyên mốc ghép khi ghép thất bại.',
    },
    superFusionStone: {
        label: 'Super Fusion Stone',
        required: false,
        description: 'Đá đặc biệt giúp tăng thêm tỉ lệ thành công cố định.',
    },
})

export const FUSION_BASE_SUCCESS_RATE_BY_LEVEL = Object.freeze([90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15])
export const FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7.5, 9, 11, 13, 15, 18, 21, 24, 28, 32, 37, 42, 48, 55])
export const FUSION_SUPER_STONE_BONUS_PERCENT = 10
export const FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT = 99
export const FUSION_STRICT_MATERIAL_UNTIL_LEVEL = 5
export const FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET = Object.freeze({
    fromLevel5: 1,
    fromLevel10: 2,
    fromLevel15: 3,
})
export const FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET = Object.freeze({
    fromLevel5: 5,
    fromLevel10: 10,
    fromLevel15: 15,
})

export const FUSION_MILESTONE_PRESETS = Object.freeze([
    { from: 0, to: 4, label: '1-5 sao vàng' },
    { from: 5, to: 9, label: '+10 (5 sao xanh đậm)' },
    { from: 10, to: 14, label: '+15 (5 sao tím)' },
    { from: 15, to: null, label: '5 sao đỏ' },
])

export const DEFAULT_FUSION_RUNTIME_CONFIG = Object.freeze({
    strictMaterialUntilFusionLevel: FUSION_STRICT_MATERIAL_UNTIL_LEVEL,
    superFusionStoneBonusPercent: FUSION_SUPER_STONE_BONUS_PERCENT,
    finalSuccessRateCapPercent: FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT,
    baseSuccessRateByFusionLevel: [...FUSION_BASE_SUCCESS_RATE_BY_LEVEL],
    totalStatBonusPercentByFusionLevel: [...FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL],
    failurePenaltyByLevelBracket: {
        ...FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET,
    },
    failureLevelThresholdByBracket: {
        ...FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET,
    },
    milestones: FUSION_MILESTONE_PRESETS.map((entry) => ({ ...entry })),
})

const clampNumber = (value, min, max, fallback = min) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

const toSafeInteger = (value, fallback = 0, min = 0, max = 999999) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

const normalizeFailurePenaltyByLevelBracket = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return {
        fromLevel5: toSafeInteger(source.fromLevel5, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel5, 0, 99),
        fromLevel10: toSafeInteger(source.fromLevel10, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel10, 0, 99),
        fromLevel15: toSafeInteger(source.fromLevel15, FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET.fromLevel15, 0, 99),
    }
}

const normalizeFailureLevelThresholdByBracket = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return {
        fromLevel5: toSafeInteger(source.fromLevel5, FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET.fromLevel5, 0, 9999),
        fromLevel10: toSafeInteger(source.fromLevel10, FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET.fromLevel10, 0, 9999),
        fromLevel15: toSafeInteger(source.fromLevel15, FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET.fromLevel15, 0, 9999),
    }
}

const normalizeBaseSuccessRateByFusionLevel = (value = []) => {
    const source = Array.isArray(value) ? value : []
    const normalized = source
        .map((entry) => clampNumber(entry, 0, 100))
        .filter((entry) => Number.isFinite(entry))

    if (normalized.length <= 0) {
        return [...FUSION_BASE_SUCCESS_RATE_BY_LEVEL]
    }

    return normalized
}

const normalizeTotalStatBonusPercentByFusionLevel = (value = []) => {
    const source = Array.isArray(value) ? value : []
    const normalized = source
        .map((entry) => clampNumber(entry, 0, 500))
        .filter((entry) => Number.isFinite(entry))

    if (normalized.length <= 0) {
        return [...FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL]
    }

    return normalized
}

const normalizeMilestones = (value = []) => {
    const source = Array.isArray(value) ? value : []
    const normalized = source
        .map((entry) => {
            const from = Number.parseInt(entry?.from, 10)
            const rawTo = entry?.to
            const to = rawTo === null || rawTo === undefined || rawTo === '' ? null : Number.parseInt(rawTo, 10)
            const label = String(entry?.label || '').trim().slice(0, 80)
            if (!Number.isFinite(from) || from < 0) return null
            if (to !== null && (!Number.isFinite(to) || to < from)) return null
            return {
                from,
                to,
                label: label || `Mốc +${from}`,
            }
        })
        .filter(Boolean)
        .sort((left, right) => left.from - right.from)

    if (normalized.length <= 0) {
        return FUSION_MILESTONE_PRESETS.map((entry) => ({ ...entry }))
    }

    return normalized
}

export const normalizeFusionRuntimeConfig = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return {
        strictMaterialUntilFusionLevel: toSafeInteger(
            source.strictMaterialUntilFusionLevel,
            FUSION_STRICT_MATERIAL_UNTIL_LEVEL,
            0,
            999
        ),
        superFusionStoneBonusPercent: clampNumber(
            source.superFusionStoneBonusPercent,
            0,
            100
        ),
        finalSuccessRateCapPercent: clampNumber(
            source.finalSuccessRateCapPercent,
            0,
            100,
            FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT
        ),
        baseSuccessRateByFusionLevel: normalizeBaseSuccessRateByFusionLevel(source.baseSuccessRateByFusionLevel),
        totalStatBonusPercentByFusionLevel: normalizeTotalStatBonusPercentByFusionLevel(source.totalStatBonusPercentByFusionLevel),
        failurePenaltyByLevelBracket: normalizeFailurePenaltyByLevelBracket(source.failurePenaltyByLevelBracket),
        failureLevelThresholdByBracket: normalizeFailureLevelThresholdByBracket(source.failureLevelThresholdByBracket),
        milestones: normalizeMilestones(source.milestones),
    }
}

export const normalizeFusionLevel = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
}

export const getFusionBaseSuccessRate = (fusionLevel = 0, baseSuccessRateByFusionLevel = FUSION_BASE_SUCCESS_RATE_BY_LEVEL) => {
    const rates = normalizeBaseSuccessRateByFusionLevel(baseSuccessRateByFusionLevel)
    const normalizedLevel = normalizeFusionLevel(fusionLevel)
    if (normalizedLevel >= rates.length) {
        return rates[rates.length - 1]
    }
    return rates[normalizedLevel]
}

export const getFusionFailurePenalty = (
    fusionLevel = 0,
    failurePenaltyByLevelBracket = FUSION_FAILURE_PENALTY_BY_LEVEL_BRACKET,
    failureLevelThresholdByBracket = FUSION_FAILURE_LEVEL_THRESHOLD_BY_BRACKET
) => {
    const penalties = normalizeFailurePenaltyByLevelBracket(failurePenaltyByLevelBracket)
    const thresholds = normalizeFailureLevelThresholdByBracket(failureLevelThresholdByBracket)
    const normalizedLevel = normalizeFusionLevel(fusionLevel)

    const bracketRows = [
        {
            threshold: Number(thresholds.fromLevel15 || 0),
            penalty: Number(penalties.fromLevel15 || 0),
        },
        {
            threshold: Number(thresholds.fromLevel10 || 0),
            penalty: Number(penalties.fromLevel10 || 0),
        },
        {
            threshold: Number(thresholds.fromLevel5 || 0),
            penalty: Number(penalties.fromLevel5 || 0),
        },
    ].sort((left, right) => right.threshold - left.threshold)

    for (const row of bracketRows) {
        if (normalizedLevel >= row.threshold) {
            return Math.max(0, Number(row.penalty || 0))
        }
    }

    return 0
}

export const resolveFusionMilestoneLabel = (fusionLevel = 0, milestones = FUSION_MILESTONE_PRESETS) => {
    const normalizedLevel = normalizeFusionLevel(fusionLevel)
    const rows = Array.isArray(milestones) ? milestones : []
    const matched = rows.find((entry) => {
        const from = Number.parseInt(entry?.from, 10)
        const to = entry?.to === null || entry?.to === undefined ? null : Number.parseInt(entry?.to, 10)
        if (!Number.isFinite(from)) return false
        if (to === null) return normalizedLevel >= from
        if (!Number.isFinite(to)) return false
        return normalizedLevel >= from && normalizedLevel <= to
    })
    return String(matched?.label || '').trim()
}

export const getFusionTotalStatBonusPercent = (
    fusionLevel = 0,
    totalStatBonusPercentByFusionLevel = FUSION_TOTAL_STAT_BONUS_PERCENT_BY_LEVEL
) => {
    const rows = normalizeTotalStatBonusPercentByFusionLevel(totalStatBonusPercentByFusionLevel)
    const normalizedLevel = normalizeFusionLevel(fusionLevel)
    if (normalizedLevel >= rows.length) {
        return Number(rows[rows.length - 1] || 0)
    }
    return Number(rows[normalizedLevel] || 0)
}

export const computeFusionFinalSuccessRate = ({
    fusionLevel = 0,
    luckyBonusPercent = 0,
    hasSuperFusionStone = false,
    baseSuccessRateByFusionLevel = FUSION_BASE_SUCCESS_RATE_BY_LEVEL,
    superFusionStoneBonusPercent = FUSION_SUPER_STONE_BONUS_PERCENT,
    finalSuccessRateCapPercent = FUSION_FINAL_SUCCESS_RATE_CAP_PERCENT,
} = {}) => {
    const baseSuccessRate = getFusionBaseSuccessRate(fusionLevel, baseSuccessRateByFusionLevel)
    const luckyBonus = Math.min(100, Math.max(0, Number(luckyBonusPercent || 0)))
    const superBonus = hasSuperFusionStone
        ? clampNumber(superFusionStoneBonusPercent, 0, 100)
        : 0
    const maxFinalRate = clampNumber(finalSuccessRateCapPercent, 0, 100)
    const finalSuccessRate = Math.min(maxFinalRate, Math.max(0, baseSuccessRate + luckyBonus + superBonus))

    return {
        baseSuccessRate,
        luckyBonusPercent: luckyBonus,
        superBonusPercent: superBonus,
        finalSuccessRate,
    }
}
