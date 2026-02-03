import mongoose from 'mongoose'
import slugify from 'slugify'

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
        levelMin: {
            type: Number,
            required: true,
            min: 1,
            max: 100,
        },
        levelMax: {
            type: Number,
            required: true,
            min: 1,
            max: 100,
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
    },
    {
        timestamps: true,
    }
)

// Pre-validate: auto-generate slug from name before validation runs
mapSchema.pre('validate', function (next) {
    if (this.isNew || this.isModified('name')) {
        this.slug = slugify(this.name, { lower: true, strict: true })
    }
    next()
})

// Cascade delete: remove all DropRates when Map is deleted
mapSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    try {
        const DropRate = mongoose.model('DropRate')
        await DropRate.deleteMany({ mapId: this._id })
        console.log(`Cascade deleted DropRates for map: ${this.name}`)
        next()
    } catch (err) {
        next(err)
    }
})

const Map = mongoose.model('Map', mapSchema)

export default Map
