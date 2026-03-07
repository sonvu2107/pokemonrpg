import mongoose from 'mongoose'

const { Schema } = mongoose

const ValleyPokemonSchema = new Schema(
    {
        // ── Snapshot ────────────────────────────────────────────────────────────
        pokemonId:   { type: Schema.Types.ObjectId, ref: 'Pokemon', required: true, index: true },
        formId:      { type: String, default: 'normal', trim: true },
        isShiny:     { type: Boolean, default: false },
        level:       { type: Number, required: true, min: 1 },
        nickname:    { type: String, default: null, trim: true, maxlength: 20 },

        ivs: {
            hp:    { type: Number, default: 0 },
            atk:   { type: Number, default: 0 },
            def:   { type: Number, default: 0 },
            spatk: { type: Number, default: 0 },
            spdef: { type: Number, default: 0 },
            spd:   { type: Number, default: 0 },
        },
        evs: {
            hp:    { type: Number, default: 0 },
            atk:   { type: Number, default: 0 },
            def:   { type: Number, default: 0 },
            spatk: { type: Number, default: 0 },
            spdef: { type: Number, default: 0 },
            spd:   { type: Number, default: 0 },
        },

        nature:   { type: String, default: null },
        gender:   { type: String, default: null },
        ability:  { type: String, default: null },
        // heldItem always null when entering Valley (returned to inventory on release)
        heldItem: { type: String, default: null },
        moves:    [{ type: String }],
        movePpState: { type: Schema.Types.Mixed, default: [] },

        // statsSnapshot: source of truth when recreating UserPokemon on catch
        statsSnapshot: { type: Schema.Types.Mixed, default: null },

        // Cached from species — for filtering / display without populate
        rarity:    { type: String, default: 'd', index: true },
        catchRate: { type: Number, default: 45 },

        // Lower-cased names for prefix search
        pokemonNameLower: { type: String, default: '', index: true },
        nicknameLower:    { type: String, default: null },

        // ── Ownership ───────────────────────────────────────────────────────────
        releasedByUserId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        releasedByUsername:   { type: String, default: '' },
        originalUserPokemonId: { type: Schema.Types.ObjectId, ref: 'UserPokemon', default: null },

        // ── Status ──────────────────────────────────────────────────────────────
        status: {
            type: String,
            enum: ['available', 'reserved', 'caught', 'expired'],
            default: 'available',
            index: true,
        },

        reservedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        reservedAt:       { type: Date, default: null },

        caughtByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        caughtAt:       { type: Date, default: null },

        // ── Timing ──────────────────────────────────────────────────────────────
        // TTL: MongoDB auto-deletes document when expiresAt is past
        expiresAt: { type: Date, required: true, index: true },
    },
    {
        timestamps: true,
    }
)

// ── Compound indexes ──────────────────────────────────────────────────────────
ValleyPokemonSchema.index({ status: 1, expiresAt: 1 })
ValleyPokemonSchema.index({ releasedByUserId: 1, createdAt: -1 })
ValleyPokemonSchema.index({ pokemonId: 1 })
// TTL index — MongoDB removes expired documents automatically
ValleyPokemonSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const ValleyPokemon = mongoose.model('ValleyPokemon', ValleyPokemonSchema)

export default ValleyPokemon
