import mongoose from 'mongoose'

const itemMarketListingSchema = new mongoose.Schema(
    {
        sellerId: {
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
            maxlength: 120,
        },
        itemType: {
            type: String,
            default: 'misc',
            trim: true,
            index: true,
        },
        itemRarity: {
            type: String,
            default: 'common',
            trim: true,
        },
        itemImageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        effectType: {
            type: String,
            default: 'none',
            trim: true,
            index: true,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
        },
        price: {
            type: Number,
            required: true,
            min: 1,
            index: true,
        },
        otName: {
            type: String,
            default: '',
            trim: true,
        },
        buyerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'sold', 'cancelled'],
            default: 'active',
            index: true,
        },
        listedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        soldAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
)

itemMarketListingSchema.index({ status: 1, listedAt: -1 })
itemMarketListingSchema.index({ status: 1, price: -1, _id: -1 })
itemMarketListingSchema.index({ sellerId: 1, status: 1, listedAt: -1 })
itemMarketListingSchema.index({ sellerId: 1, status: 1, soldAt: -1, _id: -1 })

export default mongoose.model('ItemMarketListing', itemMarketListingSchema)
