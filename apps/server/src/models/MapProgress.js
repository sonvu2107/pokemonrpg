import mongoose from 'mongoose'

const mapProgressSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        mapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Map', required: true, index: true },
        level: { type: Number, default: 1, min: 1 },
        exp: { type: Number, default: 0, min: 0 },
        totalSearches: { type: Number, default: 0, min: 0 },
        lastSearchedAt: { type: Date, default: null },
    },
    { timestamps: true }
)

mapProgressSchema.index({ userId: 1, mapId: 1 }, { unique: true })

export default mongoose.model('MapProgress', mapProgressSchema)
