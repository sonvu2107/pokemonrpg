import mongoose from 'mongoose'

const playerStateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },
        hp: {
            type: Number,
            default: 100,
        },
        maxHp: {
            type: Number,
            default: 100,
        },
        mp: {
            type: Number,
            default: 50,
        },
        maxMp: {
            type: Number,
            default: 50,
        },
        gold: {
            type: Number,
            default: 0,
        },
        clicks: {
            type: Number,
            default: 0,
        },
        level: { type: Number, default: 1 },
        experience: { type: Number, default: 0 },
        stamina: { type: Number, default: 100 },
        maxStamina: { type: Number, default: 100 },
        moonPoints: { type: Number, default: 0 },
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    }
)

// Index for faster queries
playerStateSchema.index({ userId: 1 })

export default mongoose.model('PlayerState', playerStateSchema)
