import mongoose from 'mongoose'

const { Schema } = mongoose
const USER_POKEMON_MAX_LEVEL = 2000

const MovePpStateSchema = new Schema(
    {
        moveName: { type: String, required: true, trim: true },
        currentPp: { type: Number, default: 10, min: 0 },
        maxPp: { type: Number, default: 10, min: 1 },
    },
    { _id: false }
)

const UserPokemonSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        pokemonId: { type: Schema.Types.ObjectId, ref: 'Pokemon', required: true },

        // Custom name
        nickname: { type: String, default: null, trim: true, maxlength: 20 },

        // Progression
        level: { type: Number, default: 5, min: 1, max: USER_POKEMON_MAX_LEVEL },
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
        location: { type: String, enum: ['box', 'party', 'auction'], default: 'box', index: true },
        boxNumber: { type: Number, default: 1 },
        partyIndex: { type: Number, default: null }, // 0-5 for party slots

        // Moves (Array of Move IDs or strings for now if Move model not fully linked)
        moves: [{ type: String }],

        // PP state per move
        movePpState: {
            type: [MovePpStateSchema],
            default: [],
        },

        // Status
        friendship: { type: Number, default: 70, min: 0, max: 255 },
        originalTrainer: { type: String, default: '' },
        obtainedMapName: { type: String, default: '', trim: true },
        obtainedAt: { type: Date, default: Date.now },

        // Item held
        heldItem: { type: String, default: null },

        // Lifecycle status — 'released' means soft-deleted into ValleyPokemon
        status: {
            type: String,
            enum: ['active', 'released'],
            default: 'active',
            index: true,
        },
    },
    {
        timestamps: true,
    }
)

UserPokemonSchema.index({ userId: 1, location: 1, partyIndex: 1 })
UserPokemonSchema.index({ userId: 1, location: 1, updatedAt: -1, _id: -1 })
UserPokemonSchema.index({ userId: 1, originalTrainer: 1, pokemonId: 1 })
UserPokemonSchema.index({ userId: 1, pokemonId: 1 })
UserPokemonSchema.index({ level: -1, experience: -1, _id: -1 })
UserPokemonSchema.index({ experience: -1, level: -1, _id: -1 })
UserPokemonSchema.index({ obtainedAt: -1, _id: -1 })

UserPokemonSchema.pre('validate', function (next) {
    const level = Number.parseInt(this.level, 10)
    if (!Number.isFinite(level) || level < 1) {
        this.level = 1
    } else if (level > USER_POKEMON_MAX_LEVEL) {
        this.level = USER_POKEMON_MAX_LEVEL
    }

    const experience = Number.parseInt(this.experience, 10)
    this.experience = Number.isFinite(experience) && experience > 0 ? experience : 0

    if (this.level >= USER_POKEMON_MAX_LEVEL) {
        this.experience = 0
    }

    next()
})

const UserPokemon = mongoose.model('UserPokemon', UserPokemonSchema)

export default UserPokemon
