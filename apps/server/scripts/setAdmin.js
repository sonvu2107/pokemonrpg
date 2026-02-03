/**
 * Script to set user as admin
 * Usage: node scripts/setAdmin.js <email>
 * Example: node scripts/setAdmin.js admin@example.com
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from parent directory
dotenv.config({ path: join(__dirname, '..', '.env') })

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI)
        console.log('✅ MongoDB connected')
    } catch (error) {
        console.error('❌ MongoDB connection error:', error)
        process.exit(1)
    }
}

// User schema (minimal, just for this script)
const userSchema = new mongoose.Schema({
    email: String,
    username: String,
    role: String,
})

const User = mongoose.model('User', userSchema)

const setAdmin = async (email) => {
    if (!email) {
        console.error('❌ Email is required')
        console.log('Usage: node scripts/setAdmin.js <email>')
        process.exit(1)
    }

    try {
        await connectDB()

        const user = await User.findOne({ email: email.toLowerCase() })

        if (!user) {
            console.error(`❌ User not found with email: ${email}`)
            process.exit(1)
        }

        if (user.role === 'admin') {
            console.log(`ℹ️  User ${user.email} is already an admin`)
            process.exit(0)
        }

        user.role = 'admin'
        await user.save()

        console.log(`✅ User ${user.email} (${user.username}) is now an admin!`)
        console.log(`   Role: ${user.role}`)

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    } finally {
        await mongoose.connection.close()
        console.log('👋 Disconnected from MongoDB')
        process.exit(0)
    }
}

// Get email from command line argument
const email = process.argv[2]
setAdmin(email)
