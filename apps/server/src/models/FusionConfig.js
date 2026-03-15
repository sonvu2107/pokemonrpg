import mongoose from 'mongoose'
import {
    DEFAULT_FUSION_RUNTIME_CONFIG,
    normalizeFusionRuntimeConfig,
} from '../utils/fusionUtils.js'

const fusionMilestoneSchema = new mongoose.Schema(
    {
        from: {
            type: Number,
            required: true,
            min: 0,
            max: 9999,
        },
        to: {
            type: Number,
            default: null,
            min: 0,
            max: 9999,
        },
        label: {
            type: String,
            trim: true,
            required: true,
            maxlength: 80,
        },
    },
    {
        _id: false,
    }
)

const fusionStrictMaterialRuleSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, required: true, default: true },
        fromFusionLevel: { type: Number, required: true, min: 0, max: 999, default: 0 },
        toFusionLevel: { type: Number, required: true, min: 0, max: 999, default: 4 },
        requireSameSpecies: { type: Boolean, required: true, default: true },
        requireSameForm: { type: Boolean, required: true, default: true },
        requireSameLevel: { type: Boolean, required: true, default: true },
    },
    {
        _id: false,
    }
)

const fusionStrictMaterialRulesByRaritySchema = new mongoose.Schema(
    {
        d: { type: fusionStrictMaterialRuleSchema, default: null },
        c: { type: fusionStrictMaterialRuleSchema, default: null },
        b: { type: fusionStrictMaterialRuleSchema, default: null },
        a: { type: fusionStrictMaterialRuleSchema, default: null },
        s: { type: fusionStrictMaterialRuleSchema, default: null },
        ss: { type: fusionStrictMaterialRuleSchema, default: null },
        sss: { type: fusionStrictMaterialRuleSchema, default: null },
        'sss+': { type: fusionStrictMaterialRuleSchema, default: null },
    },
    {
        _id: false,
    }
)

const fusionConfigSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            default: 'global',
            trim: true,
            maxlength: 30,
        },
        strictMaterialUntilFusionLevel: {
            type: Number,
            required: true,
            min: 0,
            max: 999,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.strictMaterialUntilFusionLevel,
        },
        strictMaterialRulesByRarity: {
            type: fusionStrictMaterialRulesByRaritySchema,
            required: true,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.strictMaterialRulesByRarity,
        },
        superFusionStoneBonusPercent: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.superFusionStoneBonusPercent,
        },
        finalSuccessRateCapPercent: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.finalSuccessRateCapPercent,
        },
        baseSuccessRateByFusionLevel: {
            type: [Number],
            required: true,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.baseSuccessRateByFusionLevel,
        },
        totalStatBonusPercentByFusionLevel: {
            type: [Number],
            required: true,
            default: DEFAULT_FUSION_RUNTIME_CONFIG.totalStatBonusPercentByFusionLevel,
        },
        failurePenaltyByLevelBracket: {
            fromLevel5: {
                type: Number,
                required: true,
                min: 0,
                max: 99,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failurePenaltyByLevelBracket.fromLevel5,
            },
            fromLevel10: {
                type: Number,
                required: true,
                min: 0,
                max: 99,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failurePenaltyByLevelBracket.fromLevel10,
            },
            fromLevel15: {
                type: Number,
                required: true,
                min: 0,
                max: 99,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failurePenaltyByLevelBracket.fromLevel15,
            },
        },
        failureLevelThresholdByBracket: {
            fromLevel5: {
                type: Number,
                required: true,
                min: 0,
                max: 9999,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failureLevelThresholdByBracket.fromLevel5,
            },
            fromLevel10: {
                type: Number,
                required: true,
                min: 0,
                max: 9999,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failureLevelThresholdByBracket.fromLevel10,
            },
            fromLevel15: {
                type: Number,
                required: true,
                min: 0,
                max: 9999,
                default: DEFAULT_FUSION_RUNTIME_CONFIG.failureLevelThresholdByBracket.fromLevel15,
            },
        },
        milestones: {
            type: [fusionMilestoneSchema],
            default: DEFAULT_FUSION_RUNTIME_CONFIG.milestones,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
)

fusionConfigSchema.pre('validate', function (next) {
    const normalized = normalizeFusionRuntimeConfig({
        strictMaterialUntilFusionLevel: this.strictMaterialUntilFusionLevel,
        strictMaterialRulesByRarity: this.strictMaterialRulesByRarity,
        superFusionStoneBonusPercent: this.superFusionStoneBonusPercent,
        finalSuccessRateCapPercent: this.finalSuccessRateCapPercent,
        baseSuccessRateByFusionLevel: this.baseSuccessRateByFusionLevel,
        totalStatBonusPercentByFusionLevel: this.totalStatBonusPercentByFusionLevel,
        failurePenaltyByLevelBracket: this.failurePenaltyByLevelBracket,
        failureLevelThresholdByBracket: this.failureLevelThresholdByBracket,
        milestones: this.milestones,
    })

    this.strictMaterialUntilFusionLevel = normalized.strictMaterialUntilFusionLevel
    this.strictMaterialRulesByRarity = normalized.strictMaterialRulesByRarity
    this.superFusionStoneBonusPercent = normalized.superFusionStoneBonusPercent
    this.finalSuccessRateCapPercent = normalized.finalSuccessRateCapPercent
    this.baseSuccessRateByFusionLevel = normalized.baseSuccessRateByFusionLevel
    this.totalStatBonusPercentByFusionLevel = normalized.totalStatBonusPercentByFusionLevel
    this.failurePenaltyByLevelBracket = normalized.failurePenaltyByLevelBracket
    this.failureLevelThresholdByBracket = normalized.failureLevelThresholdByBracket
    this.milestones = normalized.milestones
    this.key = String(this.key || 'global').trim() || 'global'
    next()
})

export default mongoose.model('FusionConfig', fusionConfigSchema)
