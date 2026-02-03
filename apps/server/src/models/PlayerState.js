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
        gold: {
            type: Number,
            default: 0,
        },
        clicks: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
)

// Index for faster queries
playerStateSchema.index({ userId: 1 })

export default mongoose.model('PlayerState', playerStateSchema)
