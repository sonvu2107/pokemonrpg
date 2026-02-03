/**
 * Script to list all users
 * Usage: node scripts/listUsers.js
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
    createdAt: Date,
})

const User = mongoose.model('User', userSchema)

const listUsers = async () => {
    try {
        await connectDB()

        const users = await User.find({}).sort({ createdAt: -1 })

        if (users.length === 0) {
            console.log('No users found')
            process.exit(0)
        }

        console.log(`📋 Total users: ${users.length}\n`)
        console.log('Email                        | Username       | Role  | Created')
        console.log('─'.repeat(80))

        users.forEach(user => {
            const email = user.email.padEnd(28)
            const username = (user.username || 'N/A').padEnd(14)
            const role = (user.role || 'user').padEnd(5)
            const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'

            console.log(`${email} | ${username} | ${role} | ${created}`)
        })

        console.log('\n💡 To set admin: node scripts/setAdmin.js <email>')

    } catch (error) {
        console.error('❌ Error:', error.message)
        process.exit(1)
    } finally {
        await mongoose.connection.close()
        process.exit(0)
    }
}

listUsers()
