import mongoose from 'mongoose'

const DAILY_REWARD_MAX_DAY = 30

export const DAILY_REWARD_TYPES = Object.freeze([
    'platinumCoins',
    'moonPoints',
    'item',
    'pokemon',
])

const dailyRewardSchema = new mongoose.Schema(
    {
        day: {
            type: Number,
            required: true,
            min: 1,
            max: DAILY_REWARD_MAX_DAY,
            unique: true,
        },
        rewardType: {
            type: String,
            enum: DAILY_REWARD_TYPES,
            required: true,
            default: 'platinumCoins',
        },
        amount: {
            type: Number,
            required: true,
            min: 1,
            default: 100,
        },
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
        title: {
            type: String,
            trim: true,
            default: '',
            maxlength: 100,
        },
    },
    {
        timestamps: true,
    }
)

dailyRewardSchema.pre('validate', function (next) {
    if (this.rewardType !== 'item') {
        this.itemId = null
    }

    if (this.rewardType !== 'pokemon') {
        this.pokemonId = null
        this.formId = 'normal'
        this.pokemonLevel = 5
        this.isShiny = false
    }

    next()
})

dailyRewardSchema.index({ day: 1 }, { unique: true })

export default mongoose.model('DailyReward', dailyRewardSchema)
