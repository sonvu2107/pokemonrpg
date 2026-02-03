/**
 * Script to fix missing usernames for existing users
 * Usage: node scripts/fixUsernames.js
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '..', '.env') })

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI)
        console.log('✅ MongoDB connected\n')
    } catch (error) {
        console.error('❌ MongoDB connection error:', error)
        process.exit(1)
    }
}

const userSchema = new mongoose.Schema({
    email: String,
    username: String,
    role: String,
})

const User = mongoose.model('User', userSchema)

const fixUsernames = async () => {
    try {
        await connectDB()

        const usersWithoutUsername = await User.find({
            $or: [
                { username: { $exists: false } },
                { username: null },
                { username: '' }
            ]
        })

        if (usersWithoutUsername.length === 0) {
            console.log('✅ All users already have usernames!')
            process.exit(0)
        }

        console.log(`Found ${usersWithoutUsername.length} users without username:\n`)

        for (const user of usersWithoutUsername) {
            const generatedUsername = user.email.split('@')[0]
            user.username = generatedUsername
            await user.save()

            console.log(`✅ ${user.email} → username: ${generatedUsername}`)
        }

        console.log(`\n🎉 Fixed ${usersWithoutUsername.length} users!`)

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    } finally {
        await mongoose.connection.close()
        process.exit(0)
    }
}

fixUsernames()
