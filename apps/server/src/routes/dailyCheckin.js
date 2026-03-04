import express from 'express'
import DailyReward from '../models/DailyReward.js'
import DailyCheckIn from '../models/DailyCheckIn.js'
import PlayerState from '../models/PlayerState.js'
import UserInventory from '../models/UserInventory.js'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { emitPlayerState } from '../socket/index.js'
import {
    DAILY_REWARD_CYCLE_DAYS,
    ensureDailyRewardsSeeded,
    getYesterdayDateKey,
    serializeDailyReward,
    toDailyDateKey,
} from '../utils/dailyCheckInUtils.js'
import { buildMoveLookupByName, buildMovePpStateFromMoves, buildMovesForLevel } from '../utils/movePpUtils.js'

const router = express.Router()

router.use(authMiddleware)

const calcRewardDayByStreak = (streak) => {
    const safeStreak = Math.max(1, Number.parseInt(streak, 10) || 1)
    return ((safeStreak - 1) % DAILY_REWARD_CYCLE_DAYS) + 1
}

const serializeWallet = (playerState) => {
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerState?.moonPoints || 0),
    }
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const buildCheckInStatus = (checkInDoc, now = new Date()) => {
    const todayKey = toDailyDateKey(now)
    const yesterdayKey = getYesterdayDateKey(now)

    const lastClaimDate = String(checkInDoc?.lastClaimDate || '').trim()
    const streak = Math.max(0, Number.parseInt(checkInDoc?.streak, 10) || 0)
    const totalClaims = Math.max(0, Number.parseInt(checkInDoc?.totalClaims, 10) || 0)

    const claimedToday = lastClaimDate === todayKey
    const claimedYesterday = lastClaimDate === yesterdayKey
    const streakActive = claimedToday || claimedYesterday
    const effectiveStreak = streakActive ? streak : 0

    const nextStreak = claimedToday
        ? (effectiveStreak + 1)
        : (claimedYesterday ? (effectiveStreak + 1) : 1)

    const nextRewardDay = calcRewardDayByStreak(nextStreak)
    const currentRewardDay = claimedToday && effectiveStreak > 0
        ? calcRewardDayByStreak(effectiveStreak)
        : 0

    return {
        serverDate: todayKey,
        claimedToday,
        canClaim: !claimedToday,
        streak,
        effectiveStreak,
        streakActive,
        nextStreak,
        currentRewardDay,
        nextRewardDay,
        totalClaims,
        lastClaimDate,
        missed: !claimedToday && !claimedYesterday && Boolean(lastClaimDate),
    }
}

const loadDailyRewards = async () => {
    await ensureDailyRewardsSeeded()

    const rows = await DailyReward.find({
        day: {
            $gte: 1,
            $lte: DAILY_REWARD_CYCLE_DAYS,
        },
    })
        .populate('itemId', 'name imageUrl type rarity')
        .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
        .sort({ day: 1 })
        .lean()

    return rows.map((entry) => serializeDailyReward(entry))
}

// GET /api/daily-checkin - Get current check-in status and reward schedule
router.get('/', async (req, res) => {
    try {
        const userId = req.user.userId

        const [checkInDoc, rewards] = await Promise.all([
            DailyCheckIn.findOne({ userId }).lean(),
            loadDailyRewards(),
        ])

        const status = buildCheckInStatus(checkInDoc)

        res.json({
            ok: true,
            serverDate: status.serverDate,
            cycleDays: DAILY_REWARD_CYCLE_DAYS,
            checkIn: {
                claimedToday: status.claimedToday,
                canClaim: status.canClaim,
                streak: status.streak,
                effectiveStreak: status.effectiveStreak,
                streakActive: status.streakActive,
                nextStreak: status.nextStreak,
                currentRewardDay: status.currentRewardDay,
                nextRewardDay: status.nextRewardDay,
                totalClaims: status.totalClaims,
                lastClaimDate: status.lastClaimDate,
                missed: status.missed,
            },
            rewards,
        })
    } catch (error) {
        console.error('GET /api/daily-checkin error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu điểm danh' })
    }
})

// POST /api/daily-checkin/claim - Claim today's reward
router.post('/claim', async (req, res) => {
    try {
        const userId = req.user.userId

        const [checkInDoc, rewards] = await Promise.all([
            DailyCheckIn.findOne({ userId }),
            loadDailyRewards(),
        ])

        const statusBeforeClaim = buildCheckInStatus(checkInDoc)
        if (statusBeforeClaim.claimedToday) {
            return res.status(409).json({
                ok: false,
                message: 'Bạn đã điểm danh hôm nay rồi',
                checkIn: {
                    claimedToday: true,
                    streak: statusBeforeClaim.streak,
                    currentRewardDay: statusBeforeClaim.currentRewardDay,
                    nextRewardDay: statusBeforeClaim.nextRewardDay,
                },
            })
        }

        const rewardDay = statusBeforeClaim.nextRewardDay
        const reward = rewards.find((entry) => entry.day === rewardDay)

        if (!reward) {
            return res.status(400).json({
                ok: false,
                message: 'Không tìm thấy quà cho ngày hiện tại. Vui lòng cấu hình ở Admin.',
            })
        }

        const amount = Math.max(1, Number.parseInt(reward.amount, 10) || 1)
        const rewardType = reward.rewardType
        let claimResult = null
        let rewardedAmount = amount

        if (rewardType === 'platinumCoins' || rewardType === 'moonPoints') {
            const walletField = rewardType === 'moonPoints' ? 'moonPoints' : 'gold'
            const playerState = await PlayerState.findOneAndUpdate(
                { userId },
                {
                    $setOnInsert: { userId },
                    $inc: { [walletField]: amount },
                },
                { new: true, upsert: true }
            )

            emitPlayerState(String(userId), playerState)

            claimResult = {
                rewardType,
                amount,
                wallet: serializeWallet(playerState),
            }
        } else if (rewardType === 'item') {
            const itemId = reward?.item?._id

            if (!itemId) {
                return res.status(400).json({
                    ok: false,
                    message: 'Quà vật phẩm chưa được cấu hình hợp lệ',
                })
            }

            const inventoryEntry = await UserInventory.findOneAndUpdate(
                { userId, itemId },
                {
                    $setOnInsert: { userId, itemId },
                    $inc: { quantity: amount },
                },
                { new: true, upsert: true }
            )

            claimResult = {
                rewardType,
                amount,
                item: reward.item,
                totalItemQuantity: Number(inventoryEntry?.quantity || amount),
            }
        } else if (rewardType === 'pokemon') {
            const pokemonId = reward?.pokemon?._id

            if (!pokemonId) {
                return res.status(400).json({
                    ok: false,
                    message: 'Quà Pokemon chưa được cấu hình hợp lệ',
                })
            }

            const pokemonDoc = await Pokemon.findById(pokemonId)
                .select('name defaultFormId forms levelUpMoves')
                .lean()

            if (!pokemonDoc) {
                return res.status(404).json({
                    ok: false,
                    message: 'Pokemon cấu hình cho quà không còn tồn tại',
                })
            }

            const safeQuantity = clamp(amount, 1, 100)
            const safeLevel = clamp(Number.parseInt(reward?.pokemonConfig?.level, 10) || 5, 1, 100)
            const requestedFormId = normalizeFormId(reward?.pokemonConfig?.formId || pokemonDoc.defaultFormId || 'normal')
            const availableForms = new Set(
                (Array.isArray(pokemonDoc.forms) ? pokemonDoc.forms : [])
                    .map((entry) => normalizeFormId(entry?.formId || ''))
                    .filter(Boolean)
            )
            const defaultFormId = normalizeFormId(pokemonDoc.defaultFormId || 'normal')
            const resolvedFormId = availableForms.has(requestedFormId)
                ? requestedFormId
                : (availableForms.has(defaultFormId) ? defaultFormId : 'normal')

            const moves = buildMovesForLevel(pokemonDoc, safeLevel)
            const moveLookupMap = await buildMoveLookupByName(moves)
            const movePpState = buildMovePpStateFromMoves({
                moveNames: moves,
                movePpState: [],
                moveLookupMap,
            })
            const docs = Array.from({ length: safeQuantity }, () => ({
                userId,
                pokemonId,
                level: safeLevel,
                experience: 0,
                formId: resolvedFormId,
                isShiny: Boolean(reward?.pokemonConfig?.isShiny),
                location: 'box',
                moves,
                movePpState,
                originalTrainer: `daily_checkin:${rewardDay}`,
            }))

            await UserPokemon.insertMany(docs)
            rewardedAmount = safeQuantity

            claimResult = {
                rewardType,
                amount: safeQuantity,
                pokemon: {
                    _id: pokemonId,
                    name: pokemonDoc.name,
                    formId: resolvedFormId,
                    level: safeLevel,
                    isShiny: Boolean(reward?.pokemonConfig?.isShiny),
                },
            }
        } else {
            return res.status(400).json({ ok: false, message: 'Loại quà không hợp lệ' })
        }

        const updatedCheckInDoc = await DailyCheckIn.findOneAndUpdate(
            { userId },
            {
                $setOnInsert: { userId },
                $set: {
                    lastClaimDate: statusBeforeClaim.serverDate,
                    streak: statusBeforeClaim.nextStreak,
                    lastRewardDay: rewardDay,
                },
                $inc: { totalClaims: 1 },
            },
            { new: true, upsert: true }
        ).lean()

        const nextStatus = buildCheckInStatus(updatedCheckInDoc)

        res.json({
            ok: true,
            message: 'Điểm danh thành công',
            serverDate: statusBeforeClaim.serverDate,
            cycleDays: DAILY_REWARD_CYCLE_DAYS,
            claimedRewardDay: rewardDay,
            reward: {
                ...reward,
                amount: rewardedAmount,
            },
            claimResult,
            checkIn: {
                claimedToday: nextStatus.claimedToday,
                canClaim: nextStatus.canClaim,
                streak: nextStatus.streak,
                effectiveStreak: nextStatus.effectiveStreak,
                streakActive: nextStatus.streakActive,
                nextStreak: nextStatus.nextStreak,
                currentRewardDay: nextStatus.currentRewardDay,
                nextRewardDay: nextStatus.nextRewardDay,
                totalClaims: nextStatus.totalClaims,
                lastClaimDate: nextStatus.lastClaimDate,
                missed: nextStatus.missed,
            },
            rewards,
        })
    } catch (error) {
        console.error('POST /api/daily-checkin/claim error:', error)
        res.status(500).json({ ok: false, message: 'Điểm danh thất bại' })
    }
})

export default router
