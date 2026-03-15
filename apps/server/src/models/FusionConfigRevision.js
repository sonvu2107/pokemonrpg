import mongoose from 'mongoose'

const fusionConfigMilestoneRevisionSchema = new mongoose.Schema(
    {
        from: { type: Number, required: true, min: 0, max: 9999 },
        to: { type: Number, default: null, min: 0, max: 9999 },
        label: { type: String, required: true, trim: true, maxlength: 80 },
    },
    { _id: false }
)

const fusionStrictMaterialRuleRevisionSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, required: true, default: true },
        fromFusionLevel: { type: Number, required: true, min: 0, max: 999, default: 0 },
        toFusionLevel: { type: Number, required: true, min: 0, max: 999, default: 4 },
        requireSameSpecies: { type: Boolean, required: true, default: true },
        requireSameForm: { type: Boolean, required: true, default: true },
        requireSameLevel: { type: Boolean, required: true, default: true },
    },
    { _id: false }
)

const fusionStrictMaterialRulesByRarityRevisionSchema = new mongoose.Schema(
    {
        d: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        c: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        b: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        a: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        s: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        ss: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        sss: { type: fusionStrictMaterialRuleRevisionSchema, default: null },
        'sss+': { type: fusionStrictMaterialRuleRevisionSchema, default: null },
    },
    { _id: false }
)

const fusionConfigRevisionSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            default: 'global',
            trim: true,
            maxlength: 30,
            index: true,
        },
        action: {
            type: String,
            required: true,
            enum: ['update', 'rollback'],
            default: 'update',
        },
        changeNote: {
            type: String,
            trim: true,
            default: '',
            maxlength: 300,
        },
        rollbackFromRevisionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FusionConfigRevision',
            default: null,
        },
        strictMaterialUntilFusionLevel: { type: Number, required: true, min: 0, max: 999 },
        strictMaterialRulesByRarity: {
            type: fusionStrictMaterialRulesByRarityRevisionSchema,
            required: true,
        },
        superFusionStoneBonusPercent: { type: Number, required: true, min: 0, max: 100 },
        finalSuccessRateCapPercent: { type: Number, required: true, min: 0, max: 100 },
        baseSuccessRateByFusionLevel: { type: [Number], required: true, default: [] },
        totalStatBonusPercentByFusionLevel: { type: [Number], required: true, default: [] },
        failurePenaltyByLevelBracket: {
            fromLevel5: { type: Number, required: true, min: 0, max: 99 },
            fromLevel10: { type: Number, required: true, min: 0, max: 99 },
            fromLevel15: { type: Number, required: true, min: 0, max: 99 },
        },
        failureLevelThresholdByBracket: {
            fromLevel5: { type: Number, required: true, min: 0, max: 9999 },
            fromLevel10: { type: Number, required: true, min: 0, max: 9999 },
            fromLevel15: { type: Number, required: true, min: 0, max: 9999 },
        },
        milestones: {
            type: [fusionConfigMilestoneRevisionSchema],
            default: [],
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
)

fusionConfigRevisionSchema.index({ key: 1, createdAt: -1 })

export default mongoose.model('FusionConfigRevision', fusionConfigRevisionSchema)
