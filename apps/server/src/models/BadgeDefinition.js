import mongoose from 'mongoose'

export const BADGE_MISSION_TYPES = Object.freeze([
    'collect_type_count',
    'collect_total_count',
    'complete_trainer_count',
])

export const BADGE_EFFECT_TYPES = Object.freeze([
    'party_damage_percent',
    'party_speed_percent',
    'party_hp_percent',
    'party_type_damage_percent',
])

export const BADGE_RANKS = Object.freeze(['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'])

const badgeEffectSchema = new mongoose.Schema(
    {
        effectType: {
            type: String,
            enum: BADGE_EFFECT_TYPES,
            required: true,
            trim: true,
        },
        percent: {
            type: Number,
            default: 0,
            min: 0,
            max: 1000,
        },
        pokemonType: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
            maxlength: 32,
        },
    },
    { _id: false }
)

const badgeDefinitionSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
            maxlength: 48,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            maxlength: 80,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        description: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        rank: {
            type: String,
            enum: BADGE_RANKS,
            default: 'D',
            trim: true,
            uppercase: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        orderIndex: {
            type: Number,
            default: 0,
            min: 0,
            max: 999999,
        },
        missionType: {
            type: String,
            enum: BADGE_MISSION_TYPES,
            required: true,
            trim: true,
        },
        missionConfig: {
            pokemonType: {
                type: String,
                default: '',
                trim: true,
                lowercase: true,
                maxlength: 32,
            },
            requiredCount: {
                type: Number,
                default: 1,
                min: 1,
                max: 1000000,
            },
        },
        rewardEffects: {
            type: [badgeEffectSchema],
            default: [],
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
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

badgeDefinitionSchema.index({ isActive: 1, orderIndex: 1, createdAt: -1 })

export default mongoose.model('BadgeDefinition', badgeDefinitionSchema)
