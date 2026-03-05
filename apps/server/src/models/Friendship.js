import mongoose from 'mongoose'

export const FRIENDSHIP_STATUS = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    BLOCKED: 'blocked',
}

export const buildFriendPairKey = (userIdA, userIdB) => {
    const normalizedA = String(userIdA || '').trim()
    const normalizedB = String(userIdB || '').trim()
    if (!normalizedA || !normalizedB) return ''
    return [normalizedA, normalizedB].sort().join(':')
}

const friendshipSchema = new mongoose.Schema(
    {
        requesterId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        addresseeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        pairKey: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(FRIENDSHIP_STATUS),
            default: FRIENDSHIP_STATUS.PENDING,
            index: true,
        },
        acceptedAt: {
            type: Date,
            default: null,
        },
        blockedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
)

friendshipSchema.pre('validate', function (next) {
    if (!this.requesterId || !this.addresseeId) return next()

    if (String(this.requesterId) === String(this.addresseeId)) {
        return next(new Error('Không thể tự kết bạn với chính mình'))
    }

    this.pairKey = buildFriendPairKey(this.requesterId, this.addresseeId)
    next()
})

friendshipSchema.index({ status: 1, requesterId: 1, createdAt: -1 })
friendshipSchema.index({ status: 1, addresseeId: 1, createdAt: -1 })
friendshipSchema.index({ status: 1, updatedAt: -1 })

const Friendship = mongoose.model('Friendship', friendshipSchema)

export default Friendship
