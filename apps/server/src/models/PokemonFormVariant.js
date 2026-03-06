import mongoose from 'mongoose'

const pokemonFormVariantSchema = new mongoose.Schema(
    {
        formId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        formName: {
            type: String,
            required: true,
            trim: true,
        },
        formNameLower: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
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

pokemonFormVariantSchema.pre('validate', function (next) {
    this.formId = String(this.formId || '').trim().toLowerCase()
    this.formName = String(this.formName || '').trim()
    this.formNameLower = this.formName.toLowerCase()
    next()
})

pokemonFormVariantSchema.index({ isActive: 1, formId: 1 })

export default mongoose.model('PokemonFormVariant', pokemonFormVariantSchema)
