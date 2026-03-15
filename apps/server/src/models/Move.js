import mongoose from 'mongoose'

const { Schema } = mongoose

const effectSpecSchema = new Schema(
    {
        op: {
            type: String,
            required: true,
            trim: true,
        },
        trigger: {
            type: String,
            default: 'on_hit',
            trim: true,
        },
        target: {
            type: String,
            default: 'opponent',
            trim: true,
        },
        chance: {
            type: Number,
            default: 1,
            min: 0,
            max: 1,
        },
        params: {
            type: Schema.Types.Mixed,
            default: () => ({}),
        },
        sourceText: {
            type: String,
            default: '',
            trim: true,
        },
        parserConfidence: {
            type: Number,
            default: 1,
            min: 0,
            max: 1,
        },
    },
    { _id: false }
)

export const MOVE_RARITIES = [
    'common',
    'uncommon',
    'rare',
    'epic',
    'legendary',
]

export const POKEMON_TYPES = [
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]

export const POKEMON_RARITIES = ['sss+', 'sss', 'ss', 's', 'a', 'b', 'c', 'd']

export const MOVE_LEARN_SCOPES = [
    'all',
    'move_type',
    'type',
    'species',
    'rarity',
]

const moveSchema = new Schema(
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

        // Move Type
        type: {
            type: String,
            required: true,
            enum: POKEMON_TYPES,
        },

        // Move Category
        category: {
            type: String,
            required: true,
            enum: ['physical', 'special', 'status'],
            default: 'physical',
        },

        // Power (null for status moves)
        power: {
            type: Number,
            default: null,
            min: 0,
            max: 250,
        },

        // Accuracy (1-100, null for moves that never miss)
        accuracy: {
            type: Number,
            default: 100,
            min: 0,
            max: 100,
        },

        // PP (Power Points)
        pp: {
            type: Number,
            required: true,
            default: 10,
            min: 1,
            max: 40,
        },

        // Priority (-7 to +7, 0 is normal)
        priority: {
            type: Number,
            default: 0,
            min: -7,
            max: 7,
        },

        // Description
        description: {
            type: String,
            default: '',
        },

        imageUrl: {
            type: String,
            default: '',
            trim: true,
        },

        rarity: {
            type: String,
            enum: MOVE_RARITIES,
            default: 'common',
        },

        shopPrice: {
            type: Number,
            default: 0,
            min: 0,
        },

        isShopEnabled: {
            type: Boolean,
            default: false,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        learnScope: {
            type: String,
            enum: MOVE_LEARN_SCOPES,
            default: 'all',
        },

        allowedTypes: {
            type: [String],
            default: [],
            enum: POKEMON_TYPES,
        },

        allowedPokemonIds: {
            type: [Schema.Types.ObjectId],
            ref: 'Pokemon',
            default: [],
        },

        allowedRarities: {
            type: [String],
            default: [],
            enum: POKEMON_RARITIES,
        },

        // Additional Effects (optional, for future use)
        effects: {
            type: Object,
            default: () => ({}),
            // Can store: { statusEffect: 'burn', chance: 10, statChanges: [...] }
        },

        effectSpecs: {
            type: [effectSpecSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
)

// Indexes
moveSchema.index({ type: 1 })
moveSchema.index({ category: 1 })
moveSchema.index({ rarity: 1 })
moveSchema.index({ isShopEnabled: 1, shopPrice: 1 })
moveSchema.index({ learnScope: 1 })

// Pre-validate: auto-generate nameLower
moveSchema.pre('validate', function (next) {
    if (this.isModified('name') || this.isNew) {
        this.nameLower = this.name.toLowerCase()
    }
    next()
})

const Move = mongoose.model('Move', moveSchema)

export default Move
