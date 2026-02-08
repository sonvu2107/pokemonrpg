import mongoose from 'mongoose'

const itemDropRateSchema = new mongoose.Schema(
    {
        mapId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Map',
            required: true,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true,
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

itemDropRateSchema.index({ mapId: 1, itemId: 1 }, { unique: true })
itemDropRateSchema.index({ mapId: 1, weight: -1 })
itemDropRateSchema.index({ itemId: 1 })

const ItemDropRate = mongoose.model('ItemDropRate', itemDropRateSchema)

export default ItemDropRate
