import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'

dotenv.config()

const args = new Set(process.argv.slice(2))
const shouldApply = args.has('--apply')
const isDryRun = !shouldApply

const run = async () => {
    try {
        await connectDB()

        const adminUsers = await User.find({ role: 'admin' })
            .select('_id email username')
            .lean()

        const adminIds = adminUsers.map((user) => user._id)
        const nonAdminUsers = await User.countDocuments({ role: { $ne: 'admin' } })

        const baseFilter = adminIds.length > 0
            ? { userId: { $nin: adminIds } }
            : {}

        const targetFilter = {
            ...baseFilter,
            moonPoints: { $ne: 0 },
        }

        const [statesToReset, moonPointTotals] = await Promise.all([
            PlayerState.countDocuments(targetFilter),
            PlayerState.aggregate([
                { $match: targetFilter },
                {
                    $group: {
                        _id: null,
                        totalMoonPoints: { $sum: '$moonPoints' },
                    },
                },
            ]),
        ])

        const totalMoonPoints = Number(moonPointTotals[0]?.totalMoonPoints || 0)

        console.log('=== User Moon Points Reset ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Admin users excluded: ${adminUsers.length}`)
        console.log(`Non-admin users: ${nonAdminUsers}`)
        console.log(`Player states to reset: ${statesToReset}`)
        console.log(`Total moon points to remove: ${totalMoonPoints}`)

        if (statesToReset === 0) {
            console.log('No player state documents need updates.')
            return
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to execute the reset.')
            return
        }

        const result = await PlayerState.updateMany(
            targetFilter,
            {
                $set: { moonPoints: 0 },
            }
        )

        console.log('Reset complete.')
        console.log(`Matched: ${result.matchedCount}`)
        console.log(`Modified: ${result.modifiedCount}`)
    } catch (error) {
        console.error('Reset failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
