import mongoose from 'mongoose'

const weeklyLeaderboardRewardSchema = new mongoose.Schema(
    {
        weekStart: {
            type: String,
            required: true,
            index: true,
        },
        weekEnd: {
            type: String,
            default: '',
            trim: true,
        },
        mode: {
            type: String,
            required: true,
            enum: ['wealth', 'trainerBattle', 'lc'],
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        usernameSnapshot: {
            type: String,
            default: '',
            trim: true,
            maxlength: 80,
        },
        rank: {
            type: Number,
            default: 0,
            min: 0,
        },
        scoreValue: {
            type: Number,
            default: 0,
            min: 0,
        },
        rewardType: {
            type: String,
            default: 'platinumCoins',
            enum: ['platinumCoins', 'moonPoints', 'item', 'pokemon'],
        },
        rewardAmount: {
            type: Number,
            required: true,
            min: 1,
        },
        rewardItemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            default: null,
        },
        rewardItemNameSnapshot: {
            type: String,
            default: '',
            trim: true,
            maxlength: 120,
        },
        rewardPokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            default: null,
        },
        rewardPokemonNameSnapshot: {
            type: String,
            default: '',
            trim: true,
            maxlength: 120,
        },
        rewardPokemonFormId: {
            type: String,
            default: 'normal',
            trim: true,
            maxlength: 60,
        },
        rewardPokemonLevel: {
            type: Number,
            default: 5,
            min: 1,
            max: 1000,
        },
        rewardPokemonIsShiny: {
            type: Boolean,
            default: false,
        },
        note: {
            type: String,
            default: '',
            trim: true,
            maxlength: 300,
        },
        rewardedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        rewardedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
)

weeklyLeaderboardRewardSchema.index({ weekStart: 1, mode: 1, userId: 1, rewardType: 1 }, { unique: true })
weeklyLeaderboardRewardSchema.index({ weekStart: 1, mode: 1, rank: 1 })

export default mongoose.model('WeeklyLeaderboardReward', weeklyLeaderboardRewardSchema)
