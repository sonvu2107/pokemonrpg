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

itemSchema.pre('validate', function (next) {
    if (this.isModified('name') || this.isNew) {
        this.nameLower = this.name.toLowerCase()
    }
    next()
})

const Item = mongoose.model('Item', itemSchema)

export default Item
