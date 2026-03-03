import mongoose from 'mongoose'

const userMoveInventorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        moveId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Move',
            required: true,
        },
        quantity: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
)

userMoveInventorySchema.index({ userId: 1, moveId: 1 }, { unique: true })

const UserMoveInventory = mongoose.model('UserMoveInventory', userMoveInventorySchema)

export default UserMoveInventory
