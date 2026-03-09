import mongoose from 'mongoose'

const leaderboardCosmeticConfigSchema = new mongoose.Schema(
    {
        mode: {
            type: String,
            required: true,
            enum: ['wealth', 'trainerBattle', 'lc'],
            index: true,
        },
        rank: {
            type: Number,
            required: true,
            min: 1,
            max: 3,
        },
        titleImageUrl: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        avatarFrameUrl: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
    },
    { timestamps: true }
)

leaderboardCosmeticConfigSchema.index({ mode: 1, rank: 1 }, { unique: true })

export default mongoose.model('LeaderboardCosmeticConfig', leaderboardCosmeticConfigSchema)
