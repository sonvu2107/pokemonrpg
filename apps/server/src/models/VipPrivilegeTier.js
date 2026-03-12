import mongoose from 'mongoose'

const vipPrivilegeTierSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
            maxlength: 32,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        level: {
            type: Number,
            required: true,
            unique: true,
            min: 1,
            max: 9999,
        },
        description: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        benefits: {
            title: {
                type: String,
                default: '',
                trim: true,
                maxlength: 80,
            },
            titleImageUrl: {
                type: String,
                default: '',
                trim: true,
            },
            avatarFrameUrl: {
                type: String,
                default: '',
                trim: true,
            },
            usernameColor: {
                type: String,
                default: '',
                trim: true,
            },
            usernameGradientColor: {
                type: String,
                default: '',
                trim: true,
            },
            usernameEffect: {
                type: String,
                enum: ['none', 'animated'],
                default: 'none',
            },
            autoSearchEnabled: {
                type: Boolean,
                default: true,
            },
            autoSearchDurationMinutes: {
                type: Number,
                default: 0,
                min: 0,
                max: 10080,
            },
            autoSearchUsesPerDay: {
                type: Number,
                default: 0,
                min: 0,
                max: 100000,
            },
            autoBattleTrainerEnabled: {
                type: Boolean,
                default: true,
            },
            autoBattleTrainerDurationMinutes: {
                type: Number,
                default: 0,
                min: 0,
                max: 10080,
            },
            autoBattleTrainerUsesPerDay: {
                type: Number,
                default: 0,
                min: 0,
                max: 100000,
            },
            expBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            platinumCoinBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            moonPointBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            ssCatchRateBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            catchRateBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            itemDropBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            dailyRewardBonusPercent: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000,
            },
            customBenefits: {
                type: [
                    {
                        type: String,
                        trim: true,
                        maxlength: 160,
                    },
                ],
                default: [],
            },
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

vipPrivilegeTierSchema.index({ level: 1 })
vipPrivilegeTierSchema.index({ code: 1 })

export default mongoose.model('VipPrivilegeTier', vipPrivilegeTierSchema)
