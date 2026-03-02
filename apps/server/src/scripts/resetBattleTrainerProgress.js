import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'
import BattleSession from '../models/BattleSession.js'

dotenv.config()

const args = new Set(process.argv.slice(2))
const isDryRun = args.has('--dry-run')
const keepSessions = args.has('--keep-sessions')

const run = async () => {
    try {
        await connectDB()

        const [totalUsers, usersWithCompleted, activeSessions] = await Promise.all([
            User.countDocuments({}),
            User.countDocuments({ completedBattleTrainers: { $exists: true, $ne: [] } }),
            BattleSession.countDocuments({}),
        ])

        console.log('=== Battle Trainer Progress Reset ===')
        console.log(`Total users: ${totalUsers}`)
        console.log(`Users with completed trainers: ${usersWithCompleted}`)
        console.log(`Active battle sessions: ${activeSessions}`)
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Keep sessions: ${keepSessions ? 'yes' : 'no'}`)

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            return
        }

        const resetUsersResult = await User.updateMany(
            {},
            { $set: { completedBattleTrainers: [] } }
        )

        let deletedSessions = 0
        if (!keepSessions) {
            const deleteSessionResult = await BattleSession.deleteMany({})
            deletedSessions = Number(deleteSessionResult.deletedCount || 0)
        }

        console.log('Reset complete.')
        console.log(`Users matched: ${resetUsersResult.matchedCount}`)
        console.log(`Users modified: ${resetUsersResult.modifiedCount}`)
        console.log(`Sessions deleted: ${deletedSessions}`)
    } catch (error) {
        console.error('Reset failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
