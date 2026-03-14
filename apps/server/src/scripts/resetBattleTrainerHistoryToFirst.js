import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'
import BattleSession from '../models/BattleSession.js'
import BattleTrainer from '../models/BattleTrainer.js'

dotenv.config()

const args = new Set(process.argv.slice(2))
const shouldApply = args.has('--apply')
const isDryRun = !shouldApply
const keepSessions = args.has('--keep-sessions')

const activeBattleTrainerFilter = {
    $or: [
        { isActive: true },
        { isActive: { $exists: false } },
        { isActive: null },
    ],
}

const run = async () => {
    try {
        await connectDB()

        const [
            firstTrainer,
            totalUsers,
            usersWithHistory,
            activeSessions,
        ] = await Promise.all([
            BattleTrainer.findOne(activeBattleTrainerFilter)
                .sort({ orderIndex: 1, createdAt: 1 })
                .select('_id name orderIndex')
                .lean(),
            User.countDocuments({}),
            User.countDocuments({ completedBattleTrainers: { $exists: true, $ne: [] } }),
            BattleSession.countDocuments({}),
        ])

        console.log('=== Battle Trainer History Reset To 1 ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Keep sessions: ${keepSessions ? 'yes' : 'no'}`)
        console.log(`Total users: ${totalUsers}`)
        console.log(`Users with trainer history: ${usersWithHistory}`)
        console.log(`Active battle sessions: ${activeSessions}`)

        if (firstTrainer?._id) {
            console.log(
                `First trainer in order: ${String(firstTrainer._id)} (${String(firstTrainer.name || 'Unknown')}, order ${Number(firstTrainer.orderIndex) || 0})`
            )
        } else {
            console.log('First trainer in order: not found')
        }

        console.log('Progress target: trainer #1 (completedBattleTrainers will be cleared).')

        if (usersWithHistory === 0 && (keepSessions || activeSessions === 0)) {
            console.log('No user history/session needs updates.')
            return
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to execute reset to trainer #1.')
            return
        }

        const resetUsersResult = await User.updateMany(
            { completedBattleTrainers: { $exists: true, $ne: [] } },
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
