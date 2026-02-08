import mongoose from 'mongoose'

const userInventorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        itemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Item',
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

userInventorySchema.index({ userId: 1, itemId: 1 }, { unique: true })

const UserInventory = mongoose.model('UserInventory', userInventorySchema)

export default UserInventory
