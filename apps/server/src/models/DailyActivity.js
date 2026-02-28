import mongoose from 'mongoose'

const dailyActivitySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        date: {
            type: String,
            required: true,
            index: true,
        },
        searches: {
            type: Number,
            default: 0,
            min: 0,
        },
        mapExp: {
            type: Number,
            default: 0,
            min: 0,
        },
        moonPoints: {
            type: Number,
            default: 0,
            min: 0,
        },
        battles: {
            type: Number,
            default: 0,
            min: 0,
        },
        levels: {
            type: Number,
            default: 0,
            min: 0,
        },
        battleMoonPoints: {
            type: Number,
            default: 0,
            min: 0,
        },
        platinumCoins: {
            type: Number,
            default: 0,
            min: 0,
        },
        mines: {
            type: Number,
            default: 0,
            min: 0,
        },
        shards: {
            type: Number,
            default: 0,
            min: 0,
        },
        diamondCoins: {
            type: Number,
            default: 0,
            min: 0,
        },
        trainerExp: {
            type: Number,
            default: 0,
            min: 0,
        },
        mapStats: {
            type: [
                {
                    mapSlug: {
                        type: String,
                        default: '',
                        trim: true,
                    },
                    mapName: {
                        type: String,
                        default: '',
                        trim: true,
                    },
                    searches: {
                        type: Number,
                        default: 0,
                        min: 0,
                    },
                    mapExp: {
                        type: Number,
                        default: 0,
                        min: 0,
                    },
                    moonPoints: {
                        type: Number,
                        default: 0,
                        min: 0,
                    },
                }
            ],
            default: [],
        },
    },
    { timestamps: true }
)

dailyActivitySchema.index({ userId: 1, date: 1 }, { unique: true })
dailyActivitySchema.index({ date: 1, searches: -1, mapExp: -1, moonPoints: -1, userId: 1 })

export default mongoose.model('DailyActivity', dailyActivitySchema)
