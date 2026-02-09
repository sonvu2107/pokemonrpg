import mongoose from 'mongoose'

const battleTrainerSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        quote: {
            type: String,
            default: '',
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        orderIndex: {
            type: Number,
            default: 0,
            min: 0,
        },
        team: {
            type: [
                {
                    pokemonId: {
                        type: mongoose.Schema.Types.ObjectId,
                        ref: 'Pokemon',
                        required: true,
                    },
                    level: {
                        type: Number,
                        default: 5,
                        min: 1,
                        max: 100,
                    },
                    formId: {
                        type: String,
                        default: 'normal',
                        trim: true,
                    },
                },
            ],
            default: [],
        },
        prizePokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            default: null,
        },
        platinumCoinsReward: {
            type: Number,
            default: 0,
            min: 0,
        },
        expReward: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
)

battleTrainerSchema.index({ isActive: 1, orderIndex: 1 })

const BattleTrainer = mongoose.model('BattleTrainer', battleTrainerSchema)

export default BattleTrainer
