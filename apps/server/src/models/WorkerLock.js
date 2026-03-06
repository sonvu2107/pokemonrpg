import mongoose from 'mongoose'

const workerLockSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        ownerId: {
            type: String,
            required: true,
            trim: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        touchedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
)

workerLockSchema.index({ key: 1 }, { unique: true })
workerLockSchema.index({ expiresAt: 1 })

export default mongoose.model('WorkerLock', workerLockSchema)
