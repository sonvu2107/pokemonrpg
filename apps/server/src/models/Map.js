import mongoose from 'mongoose'
import slugify from 'slugify'

const specialPokemonConfigSchema = new mongoose.Schema(
    {
        pokemonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Pokemon',
            required: true,
        },
        formId: {
            type: String,
            default: 'normal',
            trim: true,
        },
        weight: {
            type: Number,
            default: 1,
            min: 0.0001,
        },
    },
    { _id: false }
)

const mapSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
        },
        description: {
            type: String,
            default: '',
        },
        mapImageUrl: {
            type: String,
            default: '',
            trim: true,
        },
        levelMin: {
            type: Number,
            required: true,
            min: 1,
        },
        levelMax: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: function (val) {
                    return val >= this.levelMin
                },
                message: 'levelMax must be >= levelMin'
            },
        },
        isLegendary: {
            type: Boolean,
            default: false,
        },
        iconId: {
            type: Number,
            min: 1,
            max: 1000,
            required: false,
        },
        specialPokemonImages: {
            type: [String],
            default: [],
            validate: {
                validator: function (arr) {
                    return arr.length >= 0 && arr.length <= 5
                },
                message: 'Map can have 0-5 special Pokemon images only'
            }
        },
        specialPokemonIds: {
            type: [{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Pokemon',
            }],
            default: [],
            validate: {
                validator: function (arr) {
                    return arr.length >= 0 && arr.length <= 5
                },
                message: 'Map can have 0-5 special Pokemon references only',
            },
        },
        specialPokemonConfigs: {
            type: [specialPokemonConfigSchema],
            default: [],
            validate: {
                validator: function (arr) {
                    return arr.length >= 0 && arr.length <= 5
                },
                message: 'Map can have 0-5 special Pokemon configs only',
            },
        },
        specialPokemonEncounterRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        requiredSearches: {
            type: Number,
            default: 0,
            min: 0,
        },
        requiredPlayerLevel: {
            type: Number,
            default: 1,
            min: 1,
        },
        encounterRate: {
            type: Number,
            default: 1,
            min: 0,
            max: 1,
        },
        itemDropRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 1,
        },
        orderIndex: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
)

mapSchema.index({ isLegendary: 1, createdAt: 1, _id: 1 })
mapSchema.index({ levelMin: 1, _id: 1 })

// Pre-validate: auto-generate slug from name before validation runs
mapSchema.pre('validate', function (next) {
    if (this.isNew || this.isModified('name')) {
        this.slug = slugify(this.name, { lower: true, strict: true })
    }

    const normalizeObjectId = (value) => String(value || '').trim()
    const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

    if (Array.isArray(this.specialPokemonConfigs) && this.specialPokemonConfigs.length > 0) {
        const seen = new Set()
        this.specialPokemonConfigs = this.specialPokemonConfigs
            .map((entry) => {
                const pokemonId = normalizeObjectId(entry?.pokemonId)
                const formId = normalizeFormId(entry?.formId)
                const weight = Number(entry?.weight)
                const key = `${pokemonId}:${formId}`
                if (!pokemonId || seen.has(key)) return null
                seen.add(key)
                return {
                    pokemonId,
                    formId,
                    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                }
            })
            .filter(Boolean)
            .slice(0, 5)

        this.specialPokemonIds = [...new Set(this.specialPokemonConfigs.map((entry) => entry.pokemonId))]
    } else if (Array.isArray(this.specialPokemonIds) && this.specialPokemonIds.length > 0) {
        const normalizedIds = [...new Set(this.specialPokemonIds.map((entry) => normalizeObjectId(entry)).filter(Boolean))].slice(0, 5)
        this.specialPokemonIds = normalizedIds
        this.specialPokemonConfigs = normalizedIds.map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))
    }

    next()
})

// Cascade delete: remove all DropRates when Map is deleted
mapSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    try {
        const DropRate = mongoose.model('DropRate')
        await DropRate.deleteMany({ mapId: this._id })
        const ItemDropRate = mongoose.model('ItemDropRate')
        await ItemDropRate.deleteMany({ mapId: this._id })
        console.log(`Cascade deleted DropRates for map: ${this.name}`)
        next()
    } catch (err) {
        next(err)
    }
})

const Map = mongoose.model('Map', mapSchema)

export default Map
