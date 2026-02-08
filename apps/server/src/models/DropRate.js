import mongoose from 'mongoose'

const dropRateSchema = new mongoose.Schema(
    {
        mapId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Map',
            required: true,
        },
        pokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            required: true,
        },
        formId: {
            type: String,
            required: true,
            trim: true,
            default: 'normal',
        },
        weight: {
            type: Number,
            required: true,
            min: 0,
            max: 100000,
            default: 1,
        },
    },
    {
        timestamps: true,
    }
)

// Indexes
dropRateSchema.index({ mapId: 1, pokemonId: 1, formId: 1 }, { unique: true }) // Compound unique
dropRateSchema.index({ mapId: 1, weight: -1 }) // For sorting by weight
dropRateSchema.index({ pokemonId: 1 }) // For querying maps by pokemon

const DropRate = mongoose.model('DropRate', dropRateSchema)

export default DropRate
