import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const userSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        username: {
            type: String,
        },
        password: {
            type: String,
            required: true,
            minlength: 6,
        },
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user',
        },
        isOnline: {
            type: Boolean,
            default: false,
        },
        lastActive: {
            type: Date,
            default: Date.now,
        },
        avatar: {
            type: String,
            default: '',
        },
        signature: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
)

// Auto-generate username from email if not provided
userSchema.pre('save', async function (next) {
    if (this.isNew && !this.username) {
        this.username = this.email.split('@')[0]
    }
    next()
})

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next()

    try {
        const salt = await bcrypt.genSalt(10)
        this.password = await bcrypt.hash(this.password, salt)
        next()
    } catch (error) {
        next(error)
    }
})

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password)
}

export default mongoose.model('User', userSchema)
