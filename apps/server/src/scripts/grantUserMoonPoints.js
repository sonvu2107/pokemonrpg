import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)

const getArgValue = (flag, fallback = '') => {
    const index = args.indexOf(flag)
    if (index < 0) return fallback
    return args[index + 1] || fallback
}

const email = getArgValue('--email', 'vanthanh.pt20@gmail.com').trim().toLowerCase()
const amountRaw = getArgValue('--amount', '20000')
const amount = Number.parseInt(amountRaw, 10)
const shouldApply = argsSet.has('--apply')
const isDryRun = !shouldApply || argsSet.has('--dry-run')

const run = async () => {
    try {
        if (!email) {
            throw new Error('Missing required --email value.')
        }

        if (!Number.isInteger(amount) || amount <= 0) {
            throw new Error('Amount must be a positive integer.')
        }

        await connectDB()

        const user = await User.findOne({ email })
            .select('_id email username role')
            .lean()

        if (!user) {
            throw new Error(`User not found for email: ${email}`)
        }

        const currentPlayerState = await PlayerState.findOne({ userId: user._id })
            .select('_id moonPoints')
            .lean()

        const currentMoonPoints = Number(currentPlayerState?.moonPoints || 0)
        const nextMoonPoints = currentMoonPoints + amount

        console.log('=== Grant User Moon Points ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`User: ${user.username || '(no username)'} <${user.email}>`)
        console.log(`Role: ${user.role}`)
        console.log(`Current moon points: ${currentMoonPoints}`)
        console.log(`Moon points to add: ${amount}`)
        console.log(`Moon points after update: ${nextMoonPoints}`)

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to grant the moon points.')
            return
        }

        const updatedPlayerState = await PlayerState.findOneAndUpdate(
            { userId: user._id },
            {
                $setOnInsert: { userId: user._id },
                $inc: { moonPoints: amount },
            },
            {
                new: true,
                upsert: true,
            }
        )

        console.log('Grant complete.')
        console.log(`Updated moon points: ${Number(updatedPlayerState?.moonPoints || 0)}`)
    } catch (error) {
        console.error('Grant failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
