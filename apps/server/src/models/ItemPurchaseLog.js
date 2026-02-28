import mongoose from 'mongoose'

const itemPurchaseLogSchema = new mongoose.Schema(
    {
        buyerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true,
            index: true,
        },
        itemName: {
            type: String,
            default: '',
            trim: true,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
        },
        unitPrice: {
            type: Number,
            required: true,
            min: 0,
        },
        totalCost: {
            type: Number,
            required: true,
            min: 0,
        },
        walletGoldBefore: {
            type: Number,
            default: 0,
            min: 0,
        },
        walletGoldAfter: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
)

itemPurchaseLogSchema.index({ createdAt: -1, _id: -1 })
itemPurchaseLogSchema.index({ itemId: 1, createdAt: -1, _id: -1 })
itemPurchaseLogSchema.index({ buyerId: 1, createdAt: -1, _id: -1 })

export default mongoose.model('ItemPurchaseLog', itemPurchaseLogSchema)
