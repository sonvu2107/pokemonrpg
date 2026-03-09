import mongoose from 'mongoose'

const auctionBidSchema = new mongoose.Schema(
    {
        auctionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Auction',
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
        },
        previousHighestBid: {
            type: Number,
            default: 0,
            min: 0,
        },
        previousHighestBidderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        isWinningBid: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
)

auctionBidSchema.index({ auctionId: 1, createdAt: -1 })
auctionBidSchema.index({ auctionId: 1, amount: -1 })
auctionBidSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.model('AuctionBid', auctionBidSchema)
