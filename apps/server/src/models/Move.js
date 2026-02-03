import mongoose from 'mongoose'

const { Schema } = mongoose

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
            enum: [
                'normal', 'fire', 'water', 'grass', 'electric', 'ice',
                'fighting', 'poison', 'ground', 'flying', 'psychic',
                'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
            ],
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

        // Priority (-6 to +6, 0 is normal)
        priority: {
            type: Number,
            default: 0,
            min: -6,
            max: 6,
        },

        // Description
        description: {
            type: String,
            default: '',
        },

        // Additional Effects (optional, for future use)
        effects: {
            type: Object,
            default: () => ({}),
            // Can store: { statusEffect: 'burn', chance: 10, statChanges: [...] }
        },
    },
    {
        timestamps: true,
    }
)

// Indexes
moveSchema.index({ type: 1 })
moveSchema.index({ category: 1 })

// Pre-validate: auto-generate nameLower
moveSchema.pre('validate', function (next) {
    if (this.isModified('name') || this.isNew) {
        this.nameLower = this.name.toLowerCase()
    }
    next()
})

const Move = mongoose.model('Move', moveSchema)

export default Move
