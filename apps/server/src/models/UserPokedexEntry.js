import mongoose from 'mongoose'

const { Schema } = mongoose

const UserPokedexEntrySchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        pokemonId: { type: Schema.Types.ObjectId, ref: 'Pokemon', required: true, index: true },
        formId: { type: String, required: true, default: 'normal', trim: true, lowercase: true },
        firstObtainedAt: { type: Date, default: Date.now },
        lastObtainedAt: { type: Date, default: Date.now },
    },
    {
        timestamps: true,
    }
)

UserPokedexEntrySchema.index({ userId: 1, pokemonId: 1, formId: 1 }, { unique: true })

const UserPokedexEntry = mongoose.model('UserPokedexEntry', UserPokedexEntrySchema)

export default UserPokedexEntry
