import mongoose from 'mongoose'

const battleSessionOpponentSchema = new mongoose.Schema(
    {
        slot: { type: Number, required: true, min: 0 },
        pokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pokemon', required: true },
        name: { type: String, required: true, trim: true },
        level: { type: Number, required: true, min: 1 },
        formId: { type: String, default: 'normal', trim: true },
        baseStats: {
            hp: { type: Number, default: 1 },
            atk: { type: Number, default: 1 },
            def: { type: Number, default: 1 },
            spatk: { type: Number, default: 1 },
            spdef: { type: Number, default: 1 },
            spd: { type: Number, default: 1 },
        },
        currentHp: { type: Number, required: true, min: 0 },
        maxHp: { type: Number, required: true, min: 1 },
    },
    { _id: false }
)

const battleSessionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'BattleTrainer', required: true },
        team: { type: [battleSessionOpponentSchema], default: [] },
        currentIndex: { type: Number, default: 0, min: 0 },
        playerPokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPokemon', default: null },
        playerCurrentHp: { type: Number, default: 0, min: 0 },
        playerMaxHp: { type: Number, default: 1, min: 1 },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
)

battleSessionSchema.index({ userId: 1, trainerId: 1 }, { unique: true })
battleSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('BattleSession', battleSessionSchema)
