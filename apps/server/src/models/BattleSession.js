import mongoose from 'mongoose'

const battleSessionOpponentSchema = new mongoose.Schema(
    {
        slot: { type: Number, required: true, min: 0 },
        pokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pokemon', required: true },
        name: { type: String, required: true, trim: true },
        level: { type: Number, required: true, min: 1 },
        types: { type: [String], default: [] },
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
        status: { type: String, default: '', trim: true },
        statusTurns: { type: Number, default: 0, min: 0 },
        statStages: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        damageGuards: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        wasDamagedLastTurn: { type: Boolean, default: false },
        volatileState: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        counterMoves: { type: [mongoose.Schema.Types.Mixed], default: [] },
        counterMoveCursor: { type: Number, default: 0, min: 0 },
        counterMoveMode: { type: String, default: 'smart-random', trim: true },
    },
    { _id: false }
)

const battleSessionKnockoutSchema = new mongoose.Schema(
    {
        userPokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPokemon', required: true },
        defeatedCount: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
)

const battleSessionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'BattleTrainer', required: true },
        team: { type: [battleSessionOpponentSchema], default: [] },
        knockoutCounts: { type: [battleSessionKnockoutSchema], default: [] },
        currentIndex: { type: Number, default: 0, min: 0 },
        playerPokemonId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserPokemon', default: null },
        playerCurrentHp: { type: Number, default: 0, min: 0 },
        playerMaxHp: { type: Number, default: 1, min: 1 },
        playerStatus: { type: String, default: '', trim: true },
        playerStatusTurns: { type: Number, default: 0, min: 0 },
        playerStatStages: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        playerDamageGuards: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        playerWasDamagedLastTurn: { type: Boolean, default: false },
        playerVolatileState: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        fieldState: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true }
)

battleSessionSchema.index({ userId: 1, trainerId: 1 }, { unique: true })
battleSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('BattleSession', battleSessionSchema)
