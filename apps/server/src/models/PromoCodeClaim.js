import mongoose from 'mongoose'

const promoCodeClaimSchema = new mongoose.Schema(
    {
        promoCodeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PromoCode',
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        claimCount: {
            type: Number,
            min: 0,
            default: 0,
        },
        lastClaimAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
)

promoCodeClaimSchema.index({ promoCodeId: 1, userId: 1 }, { unique: true })

export default mongoose.model('PromoCodeClaim', promoCodeClaimSchema)
