import dotenv from 'dotenv'
import mongoose from 'mongoose'
import path from 'path'
import { writeFile } from 'fs/promises'
import { connectDB } from './config/db.js'
import BattleTrainer from './models/BattleTrainer.js'
import User from './models/User.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)

const getArgValue = (flag, fallback = '') => {
    const idx = args.indexOf(flag)
    if (idx < 0) return fallback
    return String(args[idx + 1] || '').trim() || fallback
}

const parseIntArg = (flag, fallback) => {
    const raw = Number.parseInt(getArgValue(flag, ''), 10)
    return Number.isFinite(raw) ? raw : fallback
}

const threshold = Math.max(0, parseIntArg('--threshold', 2000))
const previewLimit = Math.max(1, Math.min(500, parseIntArg('--preview-limit', 30)))
const includeAdmins = argsSet.has('--include-admins')
const onlyUserIdRaw = getArgValue('--user-id', '')
const outputPathRaw = getArgValue('--output', '')

const normalizeId = (value) => String(value || '').trim()

const toReachedAtObject = (value) => {
    if (value instanceof Map) {
        return Object.fromEntries(value.entries())
    }
    if (value && typeof value === 'object') {
        return value
    }
    return {}
}

const run = async () => {
    try {
        if (onlyUserIdRaw && !mongoose.Types.ObjectId.isValid(onlyUserIdRaw)) {
            throw new Error(`--user-id không hợp lệ: ${onlyUserIdRaw}`)
        }

        await connectDB()

        const trainerRows = await BattleTrainer.find({
            milestoneLevel: { $gte: threshold },
            moonPointsReward: { $gt: 0 },
        })
            .select('_id name milestoneLevel orderIndex moonPointsReward')
            .sort({ milestoneLevel: 1, orderIndex: 1, createdAt: 1 })
            .lean()

        const trainerMetaById = new Map(
            trainerRows
                .map((trainer) => ({
                    trainerId: normalizeId(trainer?._id),
                    trainerName: String(trainer?.name || '').trim() || 'Trainer',
                    milestoneLevel: Math.max(0, Number(trainer?.milestoneLevel) || 0),
                    orderIndex: Math.max(0, Number(trainer?.orderIndex) || 0),
                    moonPointsReward: Math.max(0, Number(trainer?.moonPointsReward) || 0),
                }))
                .filter((entry) => Boolean(entry.trainerId))
                .map((entry) => [entry.trainerId, entry])
        )

        const targetTrainerIds = [...trainerMetaById.keys()]

        console.log('=== Battle Trainer Moon Points Recipient Report ===')
        console.log(`Threshold milestone level: ${threshold}`)
        console.log(`Target trainers (moonPointsReward > 0): ${targetTrainerIds.length}`)

        if (targetTrainerIds.length === 0) {
            console.log('Không có trainer mốc phù hợp để thống kê.')
            return
        }

        const userFilter = {
            completedBattleTrainers: { $in: targetTrainerIds },
        }
        if (!includeAdmins) {
            userFilter.role = { $ne: 'admin' }
        }
        if (onlyUserIdRaw) {
            userFilter._id = new mongoose.Types.ObjectId(onlyUserIdRaw)
        }

        const userRows = await User.find(userFilter)
            .select('_id email username role completedBattleTrainers completedBattleTrainerReachedAt')
            .lean()

        const levelStats = new Map()
        let totalEstimatedMoonPoints = 0
        let totalQualifiedClaims = 0

        const userReports = userRows
            .map((user) => {
                const completedTrainerIds = (Array.isArray(user?.completedBattleTrainers) ? user.completedBattleTrainers : [])
                    .map((value) => normalizeId(value))
                    .filter((value) => trainerMetaById.has(value))

                if (completedTrainerIds.length === 0) {
                    return null
                }

                const reachedAtMap = toReachedAtObject(user?.completedBattleTrainerReachedAt)
                const rewards = completedTrainerIds
                    .map((trainerId) => {
                        const trainerMeta = trainerMetaById.get(trainerId)
                        if (!trainerMeta) return null

                        const reachedAtRaw = reachedAtMap?.[trainerId]
                        const reachedAt = reachedAtRaw ? new Date(reachedAtRaw) : null

                        return {
                            trainerId,
                            trainerName: trainerMeta.trainerName,
                            milestoneLevel: trainerMeta.milestoneLevel,
                            orderIndex: trainerMeta.orderIndex,
                            moonPointsReward: trainerMeta.moonPointsReward,
                            reachedAt: reachedAt instanceof Date && !Number.isNaN(reachedAt.getTime())
                                ? reachedAt.toISOString()
                                : null,
                        }
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.milestoneLevel - b.milestoneLevel || a.orderIndex - b.orderIndex)

                if (rewards.length === 0) {
                    return null
                }

                const totalMoonPoints = rewards.reduce((sum, entry) => sum + entry.moonPointsReward, 0)
                const uniqueMilestoneLevels = [...new Set(rewards.map((entry) => entry.milestoneLevel))]

                rewards.forEach((entry) => {
                    const levelKey = String(entry.milestoneLevel)
                    if (!levelStats.has(levelKey)) {
                        levelStats.set(levelKey, {
                            milestoneLevel: entry.milestoneLevel,
                            recipientCount: 0,
                            totalMoonPoints: 0,
                        })
                    }
                    const levelEntry = levelStats.get(levelKey)
                    levelEntry.recipientCount += 1
                    levelEntry.totalMoonPoints += entry.moonPointsReward
                })

                totalEstimatedMoonPoints += totalMoonPoints
                totalQualifiedClaims += rewards.length

                return {
                    userId: normalizeId(user?._id),
                    email: String(user?.email || '').trim(),
                    username: String(user?.username || '').trim(),
                    role: String(user?.role || '').trim(),
                    totalMoonPoints,
                    rewardCount: rewards.length,
                    milestoneLevels: uniqueMilestoneLevels,
                    rewards,
                }
            })
            .filter(Boolean)
            .sort((a, b) => b.totalMoonPoints - a.totalMoonPoints || b.rewardCount - a.rewardCount)

        const levelSummary = [...levelStats.values()]
            .sort((a, b) => a.milestoneLevel - b.milestoneLevel)

        console.log(`Matched users: ${userReports.length}`)
        console.log(`Total qualified claims (>= lv ${threshold}): ${totalQualifiedClaims}`)
        console.log(`Total estimated moon points from claims: ${totalEstimatedMoonPoints}`)

        const previewRows = userReports.slice(0, previewLimit).map((entry) => ({
            userId: entry.userId,
            email: entry.email,
            username: entry.username,
            role: entry.role,
            totalMoonPoints: entry.totalMoonPoints,
            rewardCount: entry.rewardCount,
            milestoneLevels: entry.milestoneLevels,
        }))

        console.log(`Preview users (${previewRows.length}/${userReports.length}):`)
        if (previewRows.length > 0) {
            console.log(JSON.stringify(previewRows, null, 2))
        }

        console.log('Level summary:')
        console.log(JSON.stringify(levelSummary, null, 2))

        if (outputPathRaw) {
            const resolvedOutputPath = path.isAbsolute(outputPathRaw)
                ? outputPathRaw
                : path.resolve(process.cwd(), outputPathRaw)
            const outputPayload = {
                generatedAt: new Date().toISOString(),
                threshold,
                includeAdmins,
                totalTargetTrainers: targetTrainerIds.length,
                matchedUsers: userReports.length,
                totalQualifiedClaims,
                totalEstimatedMoonPoints,
                levelSummary,
                users: userReports,
            }
            await writeFile(resolvedOutputPath, JSON.stringify(outputPayload, null, 2), 'utf8')
            console.log(`Saved full report to: ${resolvedOutputPath}`)
        }
    } catch (error) {
        console.error('Report failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
