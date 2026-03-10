import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import { ALL_ADMIN_PERMISSIONS } from '../constants/adminPermissions.js'

const userSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        username: {
            type: String,
        },
        password: {
            type: String,
            required: true,
            minlength: 6,
        },
        recoveryPinHash: {
            type: String,
            default: '',
        },
        recoveryPinUpdatedAt: {
            type: Date,
            default: null,
        },
        passwordChangedAt: {
            type: Date,
            default: null,
        },
        role: {
            type: String,
            enum: ['user', 'vip', 'admin'],
            default: 'user',
        },
        vipBenefits: {
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
        },
        vipTierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'VipPrivilegeTier',
            default: null,
        },
        vipTierLevel: {
            type: Number,
            default: 0,
            min: 0,
            max: 9999,
        },
        vipTierCode: {
            type: String,
            default: '',
            trim: true,
            uppercase: true,
            maxlength: 32,
        },
        vipExpiresAt: {
            type: Date,
            default: null,
            index: true,
        },
        adminPermissions: {
            type: [
                {
                    type: String,
                    enum: ALL_ADMIN_PERMISSIONS,
                }
            ],
            default: [],
        },
        isOnline: {
            type: Boolean,
            default: false,
        },
        totalOnlineSeconds: {
            type: Number,
            default: 0,
            min: 0,
        },
        onlineSessionStartedAt: {
            type: Date,
            default: null,
        },
        lastActive: {
            type: Date,
            default: Date.now,
        },
        avatar: {
            type: String,
            default: '',
        },
        signature: {
            type: String,
            default: '',
        },
        showPartyInProfile: {
            type: Boolean,
            default: true,
        },
        lastLoginIp: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
        },
        registrationIp: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
        },
        isBanned: {
            type: Boolean,
            default: false,
            index: true,
        },
        banReason: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        bannedAt: {
            type: Date,
            default: null,
        },
        bannedUntil: {
            type: Date,
            default: null,
        },
        bannedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        completedBattleTrainers: {
            type: [String],
            default: [],
        },
        equippedBadgeIds: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'BadgeDefinition',
                }
            ],
            default: [],
        },
        completedBattleTrainerReachedAt: {
            type: Map,
            of: Date,
            default: {},
        },
        autoSearch: {
            enabled: {
                type: Boolean,
                default: false,
            },
            mapSlug: {
                type: String,
                default: '',
                trim: true,
                lowercase: true,
            },
            searchIntervalMs: {
                type: Number,
                default: 600,
                min: 400,
                max: 10000,
            },
            actionByRarity: {
                sss: { type: String, default: 'catch', trim: true, lowercase: true },
                ss: { type: String, default: 'catch', trim: true, lowercase: true },
                s: { type: String, default: 'catch', trim: true, lowercase: true },
                a: { type: String, default: 'battle', trim: true, lowercase: true },
                b: { type: String, default: 'battle', trim: true, lowercase: true },
                c: { type: String, default: 'battle', trim: true, lowercase: true },
                d: { type: String, default: 'battle', trim: true, lowercase: true },
            },
            catchFormMode: {
                type: String,
                default: 'all',
                trim: true,
                lowercase: true,
            },
            catchBallItemId: {
                type: String,
                default: '',
                trim: true,
            },
            startedAt: {
                type: Date,
                default: null,
            },
            dayKey: {
                type: String,
                default: '',
                trim: true,
            },
            dayCount: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000000,
            },
            dayLimit: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000000,
            },
            dayRuntimeMs: {
                type: Number,
                default: 0,
                min: 0,
                max: 86400000,
            },
            lastRuntimeAt: {
                type: Date,
                default: null,
            },
            history: {
                foundPokemonCount: { type: Number, default: 0, min: 0, max: 100000000 },
                itemDropCount: { type: Number, default: 0, min: 0, max: 100000000 },
                itemDropQuantity: { type: Number, default: 0, min: 0, max: 100000000 },
                runCount: { type: Number, default: 0, min: 0, max: 100000000 },
                battleCount: { type: Number, default: 0, min: 0, max: 100000000 },
                catchAttemptCount: { type: Number, default: 0, min: 0, max: 100000000 },
                catchSuccessCount: { type: Number, default: 0, min: 0, max: 100000000 },
            },
            lastAction: {
                action: {
                    type: String,
                    default: '',
                    trim: true,
                },
                result: {
                    type: String,
                    default: '',
                    trim: true,
                },
                reason: {
                    type: String,
                    default: '',
                    trim: true,
                },
                targetId: {
                    type: String,
                    default: '',
                    trim: true,
                },
                at: {
                    type: Date,
                    default: null,
                },
            },
            logs: {
                type: [
                    {
                        message: {
                            type: String,
                            default: '',
                            trim: true,
                            maxlength: 300,
                        },
                        type: {
                            type: String,
                            default: 'info',
                            trim: true,
                        },
                        at: {
                            type: Date,
                            default: Date.now,
                        },
                    },
                ],
                default: [],
            },
        },
        autoTrainer: {
            enabled: {
                type: Boolean,
                default: false,
            },
            trainerId: {
                type: String,
                default: '',
                trim: true,
            },
            attackIntervalMs: {
                type: Number,
                default: 200,
                min: 100,
                max: 10000,
            },
            startedAt: {
                type: Date,
                default: null,
            },
            dayKey: {
                type: String,
                default: '',
                trim: true,
            },
            dayCount: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000000,
            },
            dayLimit: {
                type: Number,
                default: 0,
                min: 0,
                max: 1000000,
            },
            dayRuntimeMs: {
                type: Number,
                default: 0,
                min: 0,
                max: 86400000,
            },
            lastRuntimeAt: {
                type: Date,
                default: null,
            },
            lastAction: {
                action: {
                    type: String,
                    default: '',
                    trim: true,
                },
                result: {
                    type: String,
                    default: '',
                    trim: true,
                },
                reason: {
                    type: String,
                    default: '',
                    trim: true,
                },
                targetId: {
                    type: String,
                    default: '',
                    trim: true,
                },
                at: {
                    type: Date,
                    default: null,
                },
            },
            logs: {
                type: [
                    {
                        message: {
                            type: String,
                            default: '',
                            trim: true,
                            maxlength: 300,
                        },
                        type: {
                            type: String,
                            default: 'info',
                            trim: true,
                        },
                        at: {
                            type: Date,
                            default: Date.now,
                        },
                    },
                ],
                default: [],
            },
        },
    },
    {
        timestamps: true,
    }
)

// Auto-generate username from email if not provided
userSchema.pre('save', async function (next) {
    if (this.isNew && !this.username) {
        this.username = this.email.split('@')[0]
    }
    next()
})

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next()

    try {
        const salt = await bcrypt.genSalt(10)
        this.password = await bcrypt.hash(this.password, salt)
        next()
    } catch (error) {
        next(error)
    }
})

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password)
}

userSchema.index({ isOnline: 1, createdAt: 1, _id: 1 })
userSchema.index({ isOnline: 1, lastActive: -1, _id: 1 })
userSchema.index({ registrationIp: 1, createdAt: -1 })
userSchema.index({ 'autoSearch.enabled': 1, isBanned: 1, _id: 1 })
userSchema.index({ 'autoTrainer.enabled': 1, isBanned: 1, _id: 1 })

export default mongoose.model('User', userSchema)
