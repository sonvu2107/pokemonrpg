import mongoose from 'mongoose'

const { Schema } = mongoose

const UserPokemonSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        pokemonId: { type: Schema.Types.ObjectId, ref: 'Pokemon', required: true },

        // Custom name
        nickname: { type: String, default: null, trim: true, maxlength: 20 },

        // Progression
        level: { type: Number, default: 5, min: 1 },
        experience: { type: Number, default: 0, min: 0 },

        // Genetics / Stats
        // IVs (Individual Values) 0-31
        ivs: {
            hp: { type: Number, default: 0 },
            atk: { type: Number, default: 0 },
            def: { type: Number, default: 0 },
            spatk: { type: Number, default: 0 },
            spdef: { type: Number, default: 0 },
            spd: { type: Number, default: 0 },
        },
        // EVs (Effort Values) 0-252
        evs: {
            hp: { type: Number, default: 0 },
            atk: { type: Number, default: 0 },
            def: { type: Number, default: 0 },
            spatk: { type: Number, default: 0 },
            spdef: { type: Number, default: 0 },
            spd: { type: Number, default: 0 },
        },

        // Form & Variant
        formId: { type: String, default: 'normal' }, // normal, shiny, etc.
        isShiny: { type: Boolean, default: false },

        // Location
        location: { type: String, enum: ['box', 'party'], default: 'box', index: true },
        boxNumber: { type: Number, default: 1 },
        partyIndex: { type: Number, default: null }, // 0-5 for party slots

        // Moves (Array of Move IDs or strings for now if Move model not fully linked)
        moves: [{ type: String }],

        // Status
        friendship: { type: Number, default: 70, min: 0, max: 255 },
        originalTrainer: { type: String, default: '' },
        obtainedAt: { type: Date, default: Date.now },

        // Item held
        heldItem: { type: String, default: null },
    },
    {
        timestamps: true,
    }
)

const UserPokemon = mongoose.model('UserPokemon', UserPokemonSchema)

export default UserPokemon
