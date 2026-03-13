import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import BattleTrainer from './models/BattleTrainer.js'
import PlayerState from './models/PlayerState.js'
import User from './models/User.js'
import UserInventory from './models/UserInventory.js'
import UserPokemon from './models/UserPokemon.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)

const shouldApply = argsSet.has('--apply')
const isDryRun = !shouldApply
const includeAdmins = argsSet.has('--include-admins')

const resolveNumericArg = (flag, fallback) => {
    const idx = args.indexOf(flag)
    if (idx < 0) return fallback
    const raw = Number.parseInt(args[idx + 1], 10)
    return Number.isInteger(raw) ? raw : fallback
}

const threshold = Math.max(0, resolveNumericArg('--threshold', 2000))
const previewLimit = Math.max(1, Math.min(200, resolveNumericArg('--preview-limit', 30)))

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

const buildTrainerRewardMeta = (trainer = null) => {
    const trainerId = normalizeId(trainer?._id)
    return {
        trainerId,
        orderIndex: Math.max(0, Number(trainer?.orderIndex) || 0),
        moonPointsReward: Math.max(0, Number(trainer?.moonPointsReward) || 0),
        prizeItemId: normalizeId(trainer?.prizeItemId),
        prizeItemQuantity: Math.max(0, Number(trainer?.prizeItemQuantity) || 0),
    }
}

const summarizeItemMap = (itemMap = new Map()) => {
    return [...itemMap.entries()].map(([itemId, quantity]) => ({
        itemId,
        quantity: Math.max(0, Number(quantity) || 0),
    }))
}

const run = async () => {
    try {
        await connectDB()

        const trainerRows = await BattleTrainer.find({})
            .select('_id orderIndex moonPointsReward prizeItemId prizeItemQuantity')
            .lean()

        const trainerMetaById = new Map(
            trainerRows
                .map((trainer) => buildTrainerRewardMeta(trainer))
                .filter((entry) => Boolean(entry.trainerId))
                .map((entry) => [entry.trainerId, entry])
        )

        const trainerIdsAboveThreshold = new Set(
            [...trainerMetaById.values()]
                .filter((entry) => entry.orderIndex > threshold)
                .map((entry) => entry.trainerId)
        )

        console.log('=== Reset Battle Trainer Progress ===')
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Threshold orderIndex: ${threshold}`)
        console.log(`Trainers above threshold: ${trainerIdsAboveThreshold.size}`)

        if (trainerIdsAboveThreshold.size === 0) {
            console.log('No trainer found above threshold. Nothing to do.')
            return
        }

        const userFilter = {
            completedBattleTrainers: { $in: [...trainerIdsAboveThreshold] },
        }
        if (!includeAdmins) {
            userFilter.role = { $ne: 'admin' }
        }

        const affectedUsers = await User.find(userFilter)
            .select('_id email username role completedBattleTrainers completedBattleTrainerReachedAt autoTrainer')
            .lean()

        console.log(`Affected users: ${affectedUsers.length}`)
        if (affectedUsers.length === 0) {
            console.log('No users need reset.')
            return
        }

        let usersUpdated = 0
        let usersWithAutoTrainerReset = 0
        let totalRemovedTrainerLinks = 0
        let totalMoonPointsPlanned = 0
        let totalMoonPointsDeducted = 0
        let totalRewardPokemonDeleted = 0
        let totalInventoryItemsDeducted = 0
        const userPreview = []

        for (const user of affectedUsers) {
            const userId = user._id
            const normalizedCompleted = (Array.isArray(user.completedBattleTrainers) ? user.completedBattleTrainers : [])
                .map((id) => normalizeId(id))
                .filter(Boolean)

            const removedTrainerIds = normalizedCompleted.filter((id) => trainerIdsAboveThreshold.has(id))
            if (removedTrainerIds.length === 0) {
                continue
            }

            const keptTrainerIds = normalizedCompleted.filter((id) => !trainerIdsAboveThreshold.has(id))
            const reachedAtRaw = toReachedAtObject(user.completedBattleTrainerReachedAt)
            const nextReachedAt = Object.fromEntries(
                Object.entries(reachedAtRaw).filter(([trainerId]) => !trainerIdsAboveThreshold.has(normalizeId(trainerId)))
            )

            const moonPointsPlanned = removedTrainerIds.reduce((sum, trainerId) => {
                const trainerMeta = trainerMetaById.get(trainerId)
                return sum + Math.max(0, Number(trainerMeta?.moonPointsReward || 0))
            }, 0)

            const itemDeductionMap = new Map()
            for (const trainerId of removedTrainerIds) {
                const trainerMeta = trainerMetaById.get(trainerId)
                const itemId = normalizeId(trainerMeta?.prizeItemId)
                const quantity = Math.max(0, Number(trainerMeta?.prizeItemQuantity) || 0)
                if (!itemId || quantity <= 0) continue
                itemDeductionMap.set(itemId, (itemDeductionMap.get(itemId) || 0) + quantity)
            }

            const rewardMarkers = removedTrainerIds.map((trainerId) => `battle_trainer_reward:${trainerId}`)
            const rewardPokemonToDelete = await UserPokemon.countDocuments({
                userId,
                originalTrainer: { $in: rewardMarkers },
            })

            let inventoryDeductedForUser = 0
            if (itemDeductionMap.size > 0) {
                const itemIds = [...itemDeductionMap.keys()]
                const inventoryRows = await UserInventory.find({ userId, itemId: { $in: itemIds } })
                    .select('_id itemId quantity')

                for (const row of inventoryRows) {
                    const itemId = normalizeId(row.itemId)
                    const plannedDeduct = Math.max(0, Number(itemDeductionMap.get(itemId) || 0))
                    const currentQty = Math.max(0, Number(row.quantity) || 0)
                    const deductedNow = Math.min(currentQty, plannedDeduct)
                    const nextQty = currentQty - deductedNow
                    if (deductedNow <= 0) continue

                    inventoryDeductedForUser += deductedNow

                    if (shouldApply) {
                        if (nextQty <= 0) {
                            await UserInventory.deleteOne({ _id: row._id })
                        } else {
                            row.quantity = nextQty
                            await row.save()
                        }
                    }
                }
            }

            let moonPointsDeductedForUser = 0
            if (moonPointsPlanned > 0) {
                const playerState = await PlayerState.findOne({ userId }).select('_id moonPoints')
                if (playerState) {
                    const currentMoonPoints = Math.max(0, Number(playerState.moonPoints) || 0)
                    moonPointsDeductedForUser = Math.min(currentMoonPoints, moonPointsPlanned)
                    if (shouldApply && moonPointsDeductedForUser > 0) {
                        playerState.moonPoints = currentMoonPoints - moonPointsDeductedForUser
                        await playerState.save()
                    }
                }
            }

            const currentAutoTrainerId = normalizeId(user?.autoTrainer?.trainerId)
            const shouldResetAutoTrainer = currentAutoTrainerId && trainerIdsAboveThreshold.has(currentAutoTrainerId)

            if (shouldApply) {
                const setPayload = {
                    completedBattleTrainers: keptTrainerIds,
                    completedBattleTrainerReachedAt: nextReachedAt,
                }
                if (shouldResetAutoTrainer) {
                    setPayload['autoTrainer.enabled'] = false
                    setPayload['autoTrainer.trainerId'] = ''
                    setPayload['autoTrainer.startedAt'] = null
                }

                await User.updateOne(
                    { _id: userId },
                    {
                        $set: setPayload,
                    }
                )

                if (rewardMarkers.length > 0) {
                    const deleteRewardPokemonResult = await UserPokemon.deleteMany({
                        userId,
                        originalTrainer: { $in: rewardMarkers },
                    })
                    totalRewardPokemonDeleted += Number(deleteRewardPokemonResult.deletedCount || 0)
                }
            } else {
                totalRewardPokemonDeleted += rewardPokemonToDelete
            }

            usersUpdated += 1
            if (shouldResetAutoTrainer) {
                usersWithAutoTrainerReset += 1
            }
            totalRemovedTrainerLinks += removedTrainerIds.length
            totalMoonPointsPlanned += moonPointsPlanned
            totalMoonPointsDeducted += moonPointsDeductedForUser
            totalInventoryItemsDeducted += inventoryDeductedForUser

            if (userPreview.length < previewLimit) {
                userPreview.push({
                    userId: normalizeId(userId),
                    email: String(user.email || '').trim(),
                    username: String(user.username || '').trim(),
                    role: String(user.role || '').trim(),
                    removedTrainerCount: removedTrainerIds.length,
                    removedTrainerSample: removedTrainerIds.slice(0, 5),
                    moonPointsPlanned,
                    moonPointsDeducted: moonPointsDeductedForUser,
                    rewardPokemonToDelete,
                    inventoryDeductionPlan: summarizeItemMap(itemDeductionMap),
                    inventoryItemsDeducted: inventoryDeductedForUser,
                    autoTrainerReset: shouldResetAutoTrainer,
                })
            }
        }

        console.log(`Users matched for reset: ${usersUpdated}`)
        console.log(`Total removed trainer links (> ${threshold}): ${totalRemovedTrainerLinks}`)
        console.log(`Total moon points planned to revoke: ${totalMoonPointsPlanned}`)
        console.log(`Total moon points revoked (clamped): ${totalMoonPointsDeducted}`)
        console.log(`Total reward Pokemon deleted: ${totalRewardPokemonDeleted}`)
        console.log(`Total inventory quantity deducted: ${totalInventoryItemsDeducted}`)
        console.log(`Users with auto-trainer target reset: ${usersWithAutoTrainerReset}`)
        console.log(`Preview sample size: ${userPreview.length}`)
        if (userPreview.length > 0) {
            console.log(JSON.stringify(userPreview, null, 2))
        }

        if (isDryRun) {
            console.log('Dry run complete. No data was modified.')
            console.log('Use --apply to execute reset and reward rollback.')
        } else {
            console.log('Reset and rollback complete.')
        }
    } catch (error) {
        console.error('Reset failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
