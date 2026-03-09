import mongoose from 'mongoose'

const auctionRewardSnapshotSchema = new mongoose.Schema(
    {
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            default: null,
        },
        pokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            default: null,
        },
        formId: {
            type: String,
            default: 'normal',
            trim: true,
            maxlength: 80,
        },
        level: {
            type: Number,
            default: 5,
            min: 1,
            max: 1000,
        },
        isShiny: {
            type: Boolean,
            default: false,
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        imageUrl: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        rarity: {
            type: String,
            default: 'common',
            trim: true,
            maxlength: 40,
        },
        type: {
            type: String,
            default: 'misc',
            trim: true,
            maxlength: 40,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
            default: 1,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
    },
    { _id: false }
)

const auctionSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 40,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 160,
            index: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
            maxlength: 2000,
        },
        rewardType: {
            type: String,
            enum: ['item', 'pokemon'],
            default: 'item',
            required: true,
        },
        rewardSnapshot: {
            type: auctionRewardSnapshotSchema,
            required: true,
        },
        currency: {
            type: String,
            enum: ['white_platinum'],
            default: 'white_platinum',
            required: true,
        },
        startingBid: {
            type: Number,
            required: true,
            min: 1,
        },
        minIncrement: {
            type: Number,
            required: true,
            min: 1,
        },
        startsAt: {
            type: Date,
            required: true,
            index: true,
        },
        endsAt: {
            type: Date,
            required: true,
            index: true,
        },
        antiSnipingEnabled: {
            type: Boolean,
            default: true,
        },
        antiSnipingWindowSeconds: {
            type: Number,
            default: 300,
            min: 0,
        },
        antiSnipingExtendSeconds: {
            type: Number,
            default: 300,
            min: 0,
        },
        antiSnipingMaxExtensions: {
            type: Number,
            default: 12,
            min: 0,
        },
        extensionCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        status: {
            type: String,
            enum: ['draft', 'scheduled', 'active', 'completed', 'cancelled', 'settlement_failed'],
            default: 'draft',
            index: true,
        },
        highestBid: {
            type: Number,
            default: 0,
            min: 0,
        },
        highestBidderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        highestBidAt: {
            type: Date,
            default: null,
        },
        bidCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        winnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        settlementStatus: {
            type: String,
            enum: ['pending', 'processing', 'success', 'failed'],
            default: 'pending',
            index: true,
        },
        settledAt: {
            type: Date,
            default: null,
        },
        settlementError: {
            type: String,
            default: '',
            trim: true,
            maxlength: 1000,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        cancelledBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        cancelReason: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        version: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { timestamps: true }
)

auctionSchema.index({ status: 1, endsAt: 1 })
auctionSchema.index({ status: 1, startsAt: 1 })
auctionSchema.index({ highestBidderId: 1, status: 1 })
auctionSchema.index({ createdAt: -1 })

export default mongoose.model('Auction', auctionSchema)
