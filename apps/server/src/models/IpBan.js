import mongoose from 'mongoose'

const ipBanSchema = new mongoose.Schema(
    {
        ip: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            unique: true,
            index: true,
        },
        reason: {
            type: String,
            default: '',
            trim: true,
            maxlength: 500,
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        bannedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        bannedAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: {
            type: Date,
            default: null,
        },
        liftedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        liftedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
)

ipBanSchema.index({ isActive: 1, expiresAt: 1, ip: 1 })

export default mongoose.model('IpBan', ipBanSchema)
