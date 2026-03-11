import mongoose from 'mongoose'

export const PROMO_CODE_REWARD_TYPES = Object.freeze([
    'platinumCoins',
    'moonPoints',
    'item',
    'pokemon',
    'bundle',
])

const promoCodeItemRewardSchema = new mongoose.Schema(
    {
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            required: true,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
            default: 1,
        },
    },
    { _id: false }
)

const promoCodeSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            maxlength: 30,
            unique: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        description: {
            type: String,
            trim: true,
            default: '',
            maxlength: 400,
        },
        rewardType: {
            type: String,
            enum: PROMO_CODE_REWARD_TYPES,
            required: true,
            default: 'platinumCoins',
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
            default: 100,
        },
        platinumCoinsAmount: {
            type: Number,
            min: 0,
            default: 0,
        },
        moonPointsAmount: {
            type: Number,
            min: 0,
            default: 0,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
            default: null,
        },
        itemRewards: {
            type: [promoCodeItemRewardSchema],
            default: [],
        },
        pokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            default: null,
        },
        formId: {
            type: String,
            trim: true,
            default: 'normal',
            maxlength: 50,
        },
        pokemonLevel: {
            type: Number,
            min: 1,
            max: 3000,
            default: 5,
        },
        isShiny: {
            type: Boolean,
            default: false,
        },
        pokemonQuantity: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },
        perUserLimit: {
            type: Number,
            min: 1,
            max: 100,
            default: 1,
        },
        maxTotalClaims: {
            type: Number,
            min: 1,
            default: null,
        },
        claimCount: {
            type: Number,
            min: 0,
            default: 0,
        },
        startsAt: {
            type: Date,
            default: null,
        },
        endsAt: {
            type: Date,
            default: null,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
)

promoCodeSchema.pre('validate', function (next) {
    const isItemReward = this.rewardType === 'item' || this.rewardType === 'bundle'
    const isPokemonReward = this.rewardType === 'pokemon' || this.rewardType === 'bundle'

    if (!isItemReward) {
        this.itemId = null
        this.itemRewards = []
    } else if (!Array.isArray(this.itemRewards)) {
        this.itemRewards = []
    }

    if (!isPokemonReward) {
        this.pokemonId = null
        this.formId = 'normal'
        this.pokemonLevel = 5
        this.isShiny = false
        this.pokemonQuantity = 0
    } else if (!Number.isInteger(this.pokemonQuantity) || this.pokemonQuantity < 0) {
        this.pokemonQuantity = 0
    }

    if (this.startsAt && this.endsAt && this.endsAt < this.startsAt) {
        return next(new Error('Thời gian kết thúc phải sau thời gian bắt đầu'))
    }

    next()
})

promoCodeSchema.index({ code: 1 }, { unique: true })
promoCodeSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 })

export default mongoose.model('PromoCode', promoCodeSchema)
