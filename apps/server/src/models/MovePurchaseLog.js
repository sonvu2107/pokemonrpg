import mongoose from 'mongoose'

const movePurchaseLogSchema = new mongoose.Schema(
    {
        buyerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        moveId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Move',
            required: true,
            index: true,
        },
        moveName: {
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

movePurchaseLogSchema.index({ createdAt: -1, _id: -1 })
movePurchaseLogSchema.index({ moveId: 1, createdAt: -1, _id: -1 })
movePurchaseLogSchema.index({ buyerId: 1, createdAt: -1, _id: -1 })

export default mongoose.model('MovePurchaseLog', movePurchaseLogSchema)
