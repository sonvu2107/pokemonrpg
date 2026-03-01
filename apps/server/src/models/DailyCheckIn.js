import mongoose from 'mongoose'

const DAILY_REWARD_MAX_DAY = 30

const dailyCheckInSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        streak: {
            type: Number,
            default: 0,
            min: 0,
        },
        totalClaims: {
            type: Number,
            default: 0,
            min: 0,
        },
        lastClaimDate: {
            type: String,
            default: '',
        },
        lastRewardDay: {
            type: Number,
            default: 0,
            min: 0,
            max: DAILY_REWARD_MAX_DAY,
        },
    },
    {
        timestamps: true,
    }
)

dailyCheckInSchema.index({ userId: 1 }, { unique: true })

export default mongoose.model('DailyCheckIn', dailyCheckInSchema)
