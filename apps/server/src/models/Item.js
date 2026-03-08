import mongoose from 'mongoose'

const { Schema } = mongoose

export const ITEM_TYPES = [
    'healing',
    'pokeball',
    'evolution',
    'battle',
    'key',
    'misc',
]

export const ITEM_RARITIES = [
    'common',
    'uncommon',
    'rare',
    'epic',
    'legendary',
]

export const POKEMON_RARITY_TIERS = ['d', 'c', 'b', 'a', 's', 'ss', 'sss']

const itemSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        nameLower: {
            type: String,
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ITEM_TYPES,
            default: 'misc',
        },
        rarity: {
            type: String,
            enum: ITEM_RARITIES,
            default: 'common',
        },
        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        description: {
            type: String,
            default: '',
        },
        shopPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        moonShopPrice: {
            type: Number,
            default: 0,
            min: 0,
        },
        isShopEnabled: {
            type: Boolean,
            default: false,
        },
        isMoonShopEnabled: {
            type: Boolean,
            default: false,
        },
        purchaseLimit: {
            type: Number,
            default: 0,
            min: 0,
        },
        vipPurchaseLimitBonusPerLevel: {
            type: Number,
            default: 0,
            min: 0,
        },
        isEvolutionMaterial: {
            type: Boolean,
            default: false,
        },
        evolutionRarityFrom: {
            type: String,
            enum: POKEMON_RARITY_TIERS,
            default: 'd',
        },
        evolutionRarityTo: {
            type: String,
            enum: POKEMON_RARITY_TIERS,
            default: 'sss',
        },
        effectType: {
            type: String,
            enum: ['none', 'catchMultiplier', 'heal', 'healAmount'],
            default: 'none',
        },
        effectValue: {
            type: Number,
            default: 0,
            min: 0,
        },
        effectValueMp: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
)

itemSchema.index({ type: 1 })
itemSchema.index({ rarity: 1 })
itemSchema.index({ isShopEnabled: 1, shopPrice: 1 })
itemSchema.index({ isMoonShopEnabled: 1, moonShopPrice: 1 })
itemSchema.index({ isEvolutionMaterial: 1 })

itemSchema.pre('validate', function (next) {
    if (this.isModified('name') || this.isNew) {
        this.nameLower = this.name.toLowerCase()
    }

    if (this.isEvolutionMaterial) {
        const fromIndex = POKEMON_RARITY_TIERS.indexOf(String(this.evolutionRarityFrom || '').trim().toLowerCase())
        const toIndex = POKEMON_RARITY_TIERS.indexOf(String(this.evolutionRarityTo || '').trim().toLowerCase())
        if (fromIndex < 0 || toIndex < 0) {
            return next(new Error('evolutionRarityFrom hoặc evolutionRarityTo không hợp lệ'))
        }
        if (fromIndex > toIndex) {
            return next(new Error('evolutionRarityFrom không thể cao hơn evolutionRarityTo'))
        }
    }

    next()
})

const Item = mongoose.model('Item', itemSchema)

export default Item
