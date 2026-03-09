import mongoose from 'mongoose'

const auctionSettlementLogSchema = new mongoose.Schema(
    {
        auctionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Auction',
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['started', 'success', 'failed'],
            required: true,
            index: true,
        },
        winnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        finalBid: {
            type: Number,
            default: 0,
            min: 0,
        },
        errorCode: {
            type: String,
            default: '',
            trim: true,
            maxlength: 100,
        },
        errorMessage: {
            type: String,
            default: '',
            trim: true,
            maxlength: 1000,
        },
        payloadSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
    },
    { timestamps: true }
)

auctionSettlementLogSchema.index({ auctionId: 1, createdAt: -1 })

export default mongoose.model('AuctionSettlementLog', auctionSettlementLogSchema)
