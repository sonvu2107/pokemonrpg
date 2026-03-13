import dotenv from 'dotenv'
import mongoose from 'mongoose'
import path from 'path'
import { writeFile } from 'fs/promises'
import { connectDB } from './config/db.js'
import BattleTrainer from './models/BattleTrainer.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'
import DailyActivity from './models/DailyActivity.js'

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

const shouldApply = argsSet.has('--apply')
const isDryRun = !shouldApply
const syncDailyOnly = argsSet.has('--sync-daily-only')
const includeAdmins = argsSet.has('--include-admins')
const threshold = Math.max(0, parseIntArg('--threshold', 2000))
const maxThresholdRaw = parseIntArg('--max-threshold', -1)
const maxThreshold = maxThresholdRaw >= 0 ? Math.max(0, maxThresholdRaw) : null
const previewLimit = Math.max(1, Math.min(500, parseIntArg('--preview-limit', 30)))
const onlyUserIdRaw = getArgValue('--user-id', '')
const outputPathRaw = getArgValue('--output', '')
const estimationModeRaw = getArgValue('--mode', 'configured-only').toLowerCase()
const estimationMode = estimationModeRaw === 'configured-only'
    ? 'configured-only'
    : 'legacy-default-zero'

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

const toDateKeyFromValue = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const estimateDefaultMoonPointsFromTrainer = (trainer = {}) => {
    const team = Array.isArray(trainer?.team) ? trainer.team : []
    if (team.length === 0) return 10
    const totalLevel = team.reduce((sum, entry) => sum + (Number(entry?.level) || 1), 0)
    const averageLevel = Math.max(1, Math.round(totalLevel / Math.max(1, team.length)))
    return Math.max(10, averageLevel * 10)
}

const resolveTrainerMoonPointsByMode = (trainer = {}, mode = 'legacy-default-zero') => {
    const configuredReward = Math.max(0, Number(trainer?.moonPointsReward) || 0)
    if (configuredReward > 0) return configuredReward
    if (mode === 'configured-only') return 0
    return estimateDefaultMoonPointsFromTrainer(trainer)
}

const run = async () => {
    try {
        if (onlyUserIdRaw && !mongoose.Types.ObjectId.isValid(onlyUserIdRaw)) {
            throw new Error(`--user-id không hợp lệ: ${onlyUserIdRaw}`)
        }

        await connectDB()

        if (maxThreshold !== null && maxThreshold < threshold) {
            throw new Error(`--max-threshold (${maxThreshold}) phải >= --threshold (${threshold})`)
        }

        const trainerMilestoneFilter = { $gte: threshold }
        if (maxThreshold !== null) {
            trainerMilestoneFilter.$lte = maxThreshold
        }

        const trainerRows = await BattleTrainer.find({
            milestoneLevel: trainerMilestoneFilter,
        })
            .select('_id name milestoneLevel orderIndex moonPointsReward team.level')
            .sort({ milestoneLevel: 1, orderIndex: 1, createdAt: 1 })
            .lean()

        const trainerMetaById = new Map(
            trainerRows
                .map((trainer) => ({
                    trainerId: normalizeId(trainer?._id),
                    trainerName: String(trainer?.name || '').trim() || 'Trainer',
                    milestoneLevel: Math.max(0, Number(trainer?.milestoneLevel) || 0),
                    orderIndex: Math.max(0, Number(trainer?.orderIndex) || 0),
                    configuredMoonPointsReward: Math.max(0, Number(trainer?.moonPointsReward) || 0),
                    estimatedMoonPointsReward: resolveTrainerMoonPointsByMode(trainer, estimationMode),
                }))
                .filter((entry) => Boolean(entry.trainerId) && entry.estimatedMoonPointsReward > 0)
                .map((entry) => [entry.trainerId, entry])
        )

        const targetTrainerIds = [...trainerMetaById.keys()]

        console.log('=== Revoke Battle Trainer Moon Points ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Sync daily only: ${syncDailyOnly ? 'yes' : 'no'}`)
        console.log(`Threshold milestone level: ${threshold}`)
        console.log(`Max milestone level: ${maxThreshold !== null ? maxThreshold : 'none'}`)
        console.log(`Estimation mode: ${estimationMode}`)
        console.log(`Target trainers to revoke: ${targetTrainerIds.length}`)

        if (targetTrainerIds.length === 0) {
            console.log('Không có trainer mốc phù hợp để thu hồi.')
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

        let matchedUsers = 0
        let usersWithDeduction = 0
        let totalQualifiedClaims = 0
        let totalMoonPointsPlanned = 0
        let totalMoonPointsDeducted = 0
        let totalDailyMoonPointsPlanned = 0
        let totalDailyMoonPointsDeducted = 0
        let totalDailyBattleMoonPointsDeducted = 0
        let usersWithDailyActivityUpdated = 0
        let totalClaimsWithoutReachedAt = 0
        const levelStats = new Map()
        const userPreview = []

        for (const user of userRows) {
            const reachedAtByTrainerId = toReachedAtObject(user?.completedBattleTrainerReachedAt)
            const completedTrainerIds = (Array.isArray(user?.completedBattleTrainers) ? user.completedBattleTrainers : [])
                .map((value) => normalizeId(value))
                .filter((value) => trainerMetaById.has(value))

            if (completedTrainerIds.length === 0) {
                continue
            }

            const rewardClaims = completedTrainerIds
                .map((trainerId) => {
                    const trainerMeta = trainerMetaById.get(trainerId)
                    if (!trainerMeta) return null
                    const reachedAtRaw = reachedAtByTrainerId?.[trainerId]
                    const reachedAtDateKey = toDateKeyFromValue(reachedAtRaw)
                    const reachedAtDate = reachedAtRaw ? new Date(reachedAtRaw) : null
                    const reachedAtIso = reachedAtDate && !Number.isNaN(reachedAtDate.getTime())
                        ? reachedAtDate.toISOString()
                        : null
                    return {
                        trainerId,
                        trainerName: trainerMeta.trainerName,
                        milestoneLevel: trainerMeta.milestoneLevel,
                        orderIndex: trainerMeta.orderIndex,
                        configuredMoonPointsReward: trainerMeta.configuredMoonPointsReward,
                        estimatedMoonPointsReward: trainerMeta.estimatedMoonPointsReward,
                        reachedAt: reachedAtIso,
                        reachedAtDateKey,
                    }
                })
                .filter(Boolean)
                .sort((a, b) => a.milestoneLevel - b.milestoneLevel || a.orderIndex - b.orderIndex)

            if (rewardClaims.length === 0) {
                continue
            }

            const plannedDeduct = rewardClaims.reduce((sum, entry) => sum + entry.estimatedMoonPointsReward, 0)
            const playerState = await PlayerState.findOne({ userId: user._id }).select('_id moonPoints')
            const currentMoonPoints = Math.max(0, Number(playerState?.moonPoints) || 0)
            const deductedNow = syncDailyOnly
                ? 0
                : Math.min(currentMoonPoints, plannedDeduct)

            const plannedByDate = new Map()
            rewardClaims.forEach((entry) => {
                if (!entry.reachedAtDateKey) {
                    totalClaimsWithoutReachedAt += 1
                    return
                }
                plannedByDate.set(
                    entry.reachedAtDateKey,
                    (plannedByDate.get(entry.reachedAtDateKey) || 0) + entry.estimatedMoonPointsReward
                )
            })

            const dailyPlanTotal = [...plannedByDate.values()].reduce((sum, value) => sum + value, 0)
            let dailyMoonPointsDeductedForUser = 0
            let dailyBattleMoonPointsDeductedForUser = 0

            if (plannedByDate.size > 0) {
                const dailyRows = await DailyActivity.find({
                    userId: user._id,
                    date: { $in: [...plannedByDate.keys()] },
                })
                    .select('_id date moonPoints battleMoonPoints')

                for (const dailyRow of dailyRows) {
                    const dateKey = String(dailyRow?.date || '').trim()
                    if (!dateKey || !plannedByDate.has(dateKey)) continue

                    const plannedForDate = Math.max(0, Number(plannedByDate.get(dateKey) || 0))
                    if (plannedForDate <= 0) continue

                    const currentDailyMoonPoints = Math.max(0, Number(dailyRow?.moonPoints || 0))
                    const currentDailyBattleMoonPoints = Math.max(0, Number(dailyRow?.battleMoonPoints || 0))

                    const moonDeduct = Math.min(currentDailyMoonPoints, plannedForDate)
                    const battleMoonDeduct = Math.min(currentDailyBattleMoonPoints, plannedForDate)

                    if (moonDeduct <= 0 && battleMoonDeduct <= 0) {
                        continue
                    }

                    dailyMoonPointsDeductedForUser += moonDeduct
                    dailyBattleMoonPointsDeductedForUser += battleMoonDeduct

                    if (shouldApply) {
                        dailyRow.moonPoints = currentDailyMoonPoints - moonDeduct
                        dailyRow.battleMoonPoints = currentDailyBattleMoonPoints - battleMoonDeduct
                        await dailyRow.save()
                    }
                }
            }

            matchedUsers += 1
            totalQualifiedClaims += rewardClaims.length
            totalMoonPointsPlanned += plannedDeduct
            totalMoonPointsDeducted += deductedNow
            totalDailyMoonPointsPlanned += dailyPlanTotal
            totalDailyMoonPointsDeducted += dailyMoonPointsDeductedForUser
            totalDailyBattleMoonPointsDeducted += dailyBattleMoonPointsDeductedForUser
            if (deductedNow > 0) {
                usersWithDeduction += 1
            }
            if (dailyMoonPointsDeductedForUser > 0 || dailyBattleMoonPointsDeductedForUser > 0) {
                usersWithDailyActivityUpdated += 1
            }

            rewardClaims.forEach((entry) => {
                const levelKey = String(entry.milestoneLevel)
                if (!levelStats.has(levelKey)) {
                    levelStats.set(levelKey, {
                        milestoneLevel: entry.milestoneLevel,
                        claimCount: 0,
                        totalPlannedMoonPoints: 0,
                    })
                }
                const levelEntry = levelStats.get(levelKey)
                levelEntry.claimCount += 1
                levelEntry.totalPlannedMoonPoints += entry.estimatedMoonPointsReward
            })

            if (!syncDailyOnly && shouldApply && deductedNow > 0 && playerState?._id) {
                playerState.moonPoints = currentMoonPoints - deductedNow
                await playerState.save()
            }

            if (userPreview.length < previewLimit) {
                userPreview.push({
                    userId: normalizeId(user?._id),
                    email: String(user?.email || '').trim(),
                    username: String(user?.username || '').trim(),
                    role: String(user?.role || '').trim(),
                    currentMoonPoints,
                    plannedDeduct,
                    deductedNow,
                    dailyPlanTotal,
                    dailyMoonPointsDeductedForUser,
                    dailyBattleMoonPointsDeductedForUser,
                    rewardClaimCount: rewardClaims.length,
                    milestoneLevels: [...new Set(rewardClaims.map((entry) => entry.milestoneLevel))],
                    rewardClaims,
                })
            }
        }

        const levelSummary = [...levelStats.values()].sort((a, b) => a.milestoneLevel - b.milestoneLevel)

        console.log(`Matched users: ${matchedUsers}`)
        console.log(`Users with deducted points: ${usersWithDeduction}`)
        console.log(`Total qualified claims: ${totalQualifiedClaims}`)
        console.log(`Total moon points planned: ${totalMoonPointsPlanned}`)
        console.log(`Total moon points deducted (clamped): ${totalMoonPointsDeducted}`)
        console.log(`Daily moon points planned by reachedAt date: ${totalDailyMoonPointsPlanned}`)
        console.log(`Daily moon points deducted: ${totalDailyMoonPointsDeducted}`)
        console.log(`Daily battleMoonPoints deducted: ${totalDailyBattleMoonPointsDeducted}`)
        console.log(`Users with daily activity updated: ${usersWithDailyActivityUpdated}`)
        console.log(`Claims without reachedAt date: ${totalClaimsWithoutReachedAt}`)
        console.log(`Preview users (${userPreview.length}/${matchedUsers}):`)
        if (userPreview.length > 0) {
            console.log(JSON.stringify(userPreview, null, 2))
        }
        console.log('Level summary:')
        console.log(JSON.stringify(levelSummary, null, 2))

        if (outputPathRaw) {
            const resolvedOutputPath = path.isAbsolute(outputPathRaw)
                ? outputPathRaw
                : path.resolve(process.cwd(), outputPathRaw)
            const outputPayload = {
                generatedAt: new Date().toISOString(),
                dryRun: isDryRun,
                threshold,
                maxThreshold,
                includeAdmins,
                syncDailyOnly,
                estimationMode,
                matchedUsers,
                usersWithDeduction,
                totalQualifiedClaims,
                totalMoonPointsPlanned,
                totalMoonPointsDeducted,
                totalDailyMoonPointsPlanned,
                totalDailyMoonPointsDeducted,
                totalDailyBattleMoonPointsDeducted,
                usersWithDailyActivityUpdated,
                totalClaimsWithoutReachedAt,
                levelSummary,
                previewUsers: userPreview,
            }
            await writeFile(resolvedOutputPath, JSON.stringify(outputPayload, null, 2), 'utf8')
            console.log(`Saved report to: ${resolvedOutputPath}`)
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to execute revocation.')
        } else {
            console.log('Revocation complete.')
        }
    } catch (error) {
        console.error('Revoke failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
