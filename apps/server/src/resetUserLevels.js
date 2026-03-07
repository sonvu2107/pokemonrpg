import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)
const shouldApply = argsSet.has('--apply')
const isDryRun = !shouldApply

const previewLimitArgIndex = args.indexOf('--preview-limit')
const previewLimitRaw = previewLimitArgIndex >= 0
    ? Number.parseInt(args[previewLimitArgIndex + 1], 10)
    : 20
const previewLimit = Number.isInteger(previewLimitRaw) && previewLimitRaw > 0
    ? Math.min(previewLimitRaw, 100)
    : 20

const run = async () => {
    try {
        await connectDB()

        const adminUsers = await User.find({ role: 'admin' })
            .select('_id email username')
            .lean()
        const adminIds = adminUsers.map((user) => user._id)

        const baseFilter = adminIds.length > 0
            ? { userId: { $nin: adminIds } }
            : {}
        const targetFilter = {
            ...baseFilter,
            $or: [
                { level: { $ne: 1 } },
                { experience: { $ne: 0 } },
            ],
        }

        const [
            totalNonAdminUsers,
            totalNonAdminStates,
            statesToReset,
            summary,
            preview,
        ] = await Promise.all([
            User.countDocuments({ role: { $ne: 'admin' } }),
            PlayerState.countDocuments(baseFilter),
            PlayerState.countDocuments(targetFilter),
            PlayerState.aggregate([
                { $match: targetFilter },
                {
                    $group: {
                        _id: null,
                        totalLevel: { $sum: '$level' },
                        averageLevel: { $avg: '$level' },
                        maxLevel: { $max: '$level' },
                        totalExperience: { $sum: '$experience' },
                    },
                },
            ]),
            PlayerState.find(targetFilter)
                .select('_id userId level experience wins losses moonPoints')
                .sort({ level: -1, experience: -1, _id: 1 })
                .limit(previewLimit)
                .lean(),
        ])

        const stats = summary[0] || {
            totalLevel: 0,
            averageLevel: 0,
            maxLevel: 0,
            totalExperience: 0,
        }

        console.log('=== User Level Reset ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log('Target: non-admin users only')
        console.log(`Admin users excluded: ${adminUsers.length}`)
        console.log(`Non-admin users: ${totalNonAdminUsers}`)
        console.log(`Non-admin player states: ${totalNonAdminStates}`)
        console.log(`Player states to reset: ${statesToReset}`)
        console.log(`Total level to remove: ${Math.round(Number(stats.totalLevel || 0))}`)
        console.log(`Average level before reset: ${Number(stats.averageLevel || 0).toFixed(2)}`)
        console.log(`Max level before reset: ${Number(stats.maxLevel || 0)}`)
        console.log(`Total experience to remove: ${Math.round(Number(stats.totalExperience || 0))}`)
        console.log(`Preview sample size: ${preview.length}`)
        if (preview.length > 0) {
            console.log(JSON.stringify(preview, null, 2))
        }

        if (statesToReset === 0) {
            console.log('No player states need updates.')
            return
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to set level = 1 and experience = 0.')
            return
        }

        const result = await PlayerState.updateMany(
            targetFilter,
            {
                $set: {
                    level: 1,
                    experience: 0,
                },
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
