import mongoose from 'mongoose'

const marketListingSchema = new mongoose.Schema(
    {
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        userPokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'UserPokemon',
            required: true,
        },
        pokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            required: true,
            index: true,
        },
        nickname: {
            type: String,
            default: '',
            trim: true,
            maxlength: 40,
        },
        formId: {
            type: String,
            default: 'normal',
            trim: true,
        },
        level: {
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
        reservedForUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
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
    {
        timestamps: true,
    }
)

marketListingSchema.index({ status: 1, listedAt: -1 })
marketListingSchema.index({ status: 1, price: -1, _id: -1 })
marketListingSchema.index({ status: 1, level: -1, _id: -1 })
marketListingSchema.index({ sellerId: 1, status: 1, listedAt: -1 })
marketListingSchema.index({ sellerId: 1, status: 1, soldAt: -1, _id: -1 })
marketListingSchema.index(
    { userPokemonId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
)

export default mongoose.model('MarketListing', marketListingSchema)
