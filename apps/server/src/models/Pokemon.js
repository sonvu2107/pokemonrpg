import mongoose from 'mongoose'

const { Schema } = mongoose

const FormSpritesSchema = new Schema(
    {
        normal: { type: String, default: '' },
        shiny: { type: String, default: '' },
        icon: { type: String, default: '' },
    },
    { _id: false }
)

const FormStatsSchema = new Schema(
    {
        hp: { type: Number, default: 0, min: 0, max: 255 },
        atk: { type: Number, default: 0, min: 0, max: 255 },
        def: { type: Number, default: 0, min: 0, max: 255 },
        spatk: { type: Number, default: 0, min: 0, max: 255 },
        spdef: { type: Number, default: 0, min: 0, max: 255 },
        spd: { type: Number, default: 0, min: 0, max: 255 },
    },
    { _id: false }
)

// Evolution Data
const EvolutionSchema = new Schema(
    {
        evolvesTo: { type: Schema.Types.ObjectId, ref: 'Pokemon', default: null },
        minLevel: { type: Number, default: null, min: 1 },
        // Future extensibility (optional)
        // method: { type: String, enum: ['level', 'item', 'trade', 'friendship'], default: 'level' },
        // itemId: { type: Schema.Types.ObjectId, ref: 'Item', default: null },
    },
    { _id: false }
)

const FormSchema = new Schema(
    {
        formId: { type: String, required: true, trim: true },
        formName: { type: String, default: '', trim: true },
        imageUrl: { type: String, default: '' },
        sprites: { type: FormSpritesSchema, default: () => ({}) },
        stats: { type: FormStatsSchema, default: () => ({}) },
        evolution: { type: EvolutionSchema, default: null },
    },
    { _id: false }
)

// Level-up Move Entry
const LevelMoveSchema = new Schema(
    {
        level: { type: Number, required: true, min: 1 },
        moveId: { type: Schema.Types.ObjectId, ref: 'Move', default: null },
        // Fallback for transition period (before Move model is fully populated)
        moveName: { type: String, default: '' },
    },
    { _id: false }
)



const pokemonSchema = new Schema(
    {
        pokedexNumber: {
            type: Number,
            required: true,
            unique: true,
            min: 1,
            max: 9999,
        },
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

        // Base Stats
        baseStats: {
            hp: { type: Number, required: true, min: 1, max: 255 },
            atk: { type: Number, required: true, min: 1, max: 255 },
            def: { type: Number, required: true, min: 1, max: 255 },
            spatk: { type: Number, required: true, min: 1, max: 255 },
            spldef: { type: Number, required: true, min: 1, max: 255 },
            spd: { type: Number, required: true, min: 1, max: 255 },
        },

        // Types (lowercase, max 2, unique values)
        types: {
            type: [String],
            required: true,
            validate: {
                validator: function (arr) {
                    if (arr.length < 1 || arr.length > 2) return false
                    return new Set(arr).size === arr.length
                },
                message: 'Must have 1-2 unique types',
            },
            enum: [
                'normal', 'fire', 'water', 'grass', 'electric', 'ice',
                'fighting', 'poison', 'ground', 'flying', 'psychic',
                'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
            ],
        },

        // Initial Moves (Deprecated - use levelUpMoves instead)
        // Keeping for backwards compatibility
        initialMoves: {
            type: [String],
            default: [],
        },

        // ==== GAME MECHANICS FIELDS ====

        // Evolution Chain
        evolution: {
            type: EvolutionSchema,
            default: () => ({}),
        },

        // Level-up Move Pool
        levelUpMoves: {
            type: [LevelMoveSchema],
            default: [],
        },

        // Base Experience (earned when defeated)
        baseExperience: {
            type: Number,
            default: 50,
            min: 0,
            max: 1000,
        },

        // Catch Rate (1-255, higher = easier to catch)
        catchRate: {
            type: Number,
            default: 45,
            min: 1,
            max: 255,
        },

        // Growth Rate (determines EXP curve)
        growthRate: {
            type: String,
            enum: ['fast', 'medium_fast', 'medium_slow', 'slow', 'erratic', 'fluctuating'],
            default: 'medium_fast',
        },

        // ==== VISUAL ASSETS ====

        // Sprites (URL strings)
        sprites: {
            normal: { type: String, default: '' },
            shiny: { type: String, default: '' },
            icon: { type: String, default: '' },
        },

        // Main image URL (Cloudinary)
        imageUrl: {
            type: String,
            default: '',
        },

        // ==== FORMS ====

        defaultFormId: {
            type: String,
            default: 'normal',
        },

        forms: {
            type: [FormSchema],
            default: [],
        },

        // ==== METADATA ====

        description: {
            type: String,
            default: '',
        },

        rarity: {
            type: String,
            required: true,
            enum: ['sss', 'ss', 's', 'a', 'b', 'c', 'd'],
            default: 'd',
        },

        rarityWeight: {
            type: Number,
            default: function () {
                const weights = {
                    d: 100,
                    c: 50,
                    b: 20,
                    a: 5,
                    s: 1,
                    ss: 0.2,
                    sss: 0.05,
                }
                return weights[this.rarity] || 100
            },
        },
    },
    {
        timestamps: true,
    }
)

// Indexes
pokemonSchema.index({ types: 1 })
pokemonSchema.index({ rarity: 1 })
pokemonSchema.index({ 'evolution.evolvesTo': 1 })

// Pre-validate: auto-generate nameLower
pokemonSchema.pre('validate', function (next) {
    if (this.isModified('name') || this.isNew) {
        this.nameLower = this.name.toLowerCase()
    }
    next()
})

// Pre-save: clean and sort levelUpMoves
pokemonSchema.pre('save', function (next) {
    // Ensure formId uniqueness and defaultFormId consistency
    if (Array.isArray(this.forms) && this.forms.length > 0) {
        const ids = this.forms
            .map(f => (f?.formId || '').trim())
            .filter(Boolean)

        const unique = new Set(ids)
        if (unique.size !== ids.length) {
            return next(new Error('Duplicate formId in forms[]'))
        }

        if (!ids.includes(this.defaultFormId)) {
            this.defaultFormId = ids[0] || 'normal'
        }
    }

    // Sort and deduplicate levelUpMoves
    if (Array.isArray(this.levelUpMoves) && this.levelUpMoves.length) {
        // Filter out invalid entries
        this.levelUpMoves = this.levelUpMoves
            .filter(m => m && Number.isFinite(m.level))
            .sort((a, b) => a.level - b.level)

        // Remove duplicates based on (level, moveId/moveName)
        const seen = new Set()
        this.levelUpMoves = this.levelUpMoves.filter(m => {
            const key = `${m.level}:${String(m.moveId || m.moveName || '')}`
            if (!key.endsWith(':') && !seen.has(key)) {
                seen.add(key)
                return true
            }
            return false
        })
    }

    // Validate evolution consistency
    if (this.evolution?.minLevel != null && this.evolution?.evolvesTo == null) {
        return next(new Error('evolution.minLevel is set but evolution.evolvesTo is null'))
    }

    next()
})

const Pokemon = mongoose.model('Pokemon', pokemonSchema)

export default Pokemon
