import mongoose from 'mongoose'

const encounterSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        mapId: { type: mongoose.Schema.Types.ObjectId, ref: 'Map', required: true, index: true },
        pokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pokemon', required: true },
        level: { type: Number, required: true, min: 1 },
        hp: { type: Number, required: true, min: 0 },
        maxHp: { type: Number, required: true, min: 1 },
        isShiny: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true, index: true },
        endedAt: { type: Date, default: null },
    },
    { timestamps: true }
)

encounterSchema.index({ userId: 1, isActive: 1 })

export default mongoose.model('Encounter', encounterSchema)
