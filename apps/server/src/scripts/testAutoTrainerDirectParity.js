import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import BattleTrainer from '../models/BattleTrainer.js'
import BattleSession from '../models/BattleSession.js'
import '../models/Pokemon.js'
import '../models/Item.js'
import { createCompletedTrainerBattleSession } from '../services/trainerBattleSessionService.js'
import { resolveTrainerBattleForUserDirect } from '../services/trainerBattleResolveDirectService.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

dotenv.config({ path: '.env' })

const API_BASE = String(process.env.PARITY_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '')
const PARITY_USER_ID = String(process.env.PARITY_USER_ID || '').trim()
const PARITY_TRAINER_ID = String(process.env.PARITY_TRAINER_ID || '').trim()
const PARITY_TOKEN = String(process.env.PARITY_TOKEN || '').trim()

const createInternalToken = (userId = '') => {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    const normalizedUserId = String(userId || '').trim()
    if (!jwtSecret || !normalizedUserId) return ''
    return jwt.sign(
        {
            userId: normalizedUserId,
            tokenType: 'internal',
        },
        jwtSecret,
        { expiresIn: '30m' }
    )
}

const keyDiff = (left = {}, right = {}) => {
    const leftKeys = new Set(Object.keys(left || {}))
    const rightKeys = new Set(Object.keys(right || {}))
    return {
        missingInRight: [...leftKeys].filter((key) => !rightKeys.has(key)).sort(),
        extraInRight: [...rightKeys].filter((key) => !leftKeys.has(key)).sort(),
    }
}

const toNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

const loadTrainerParityContext = async ({ userId, trainerId }) => {
    const trainer = await BattleTrainer.findById(trainerId)
        .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types')
        .populate('prizeItemId', '_id name')
        .lean()

    if (!trainer || !Array.isArray(trainer.team) || trainer.team.length === 0) {
        throw new Error('Trainer không hợp lệ hoặc không có team')
    }

    const activePartyPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ userId, location: 'party' }))
        .sort({ partyIndex: 1, _id: 1 })
        .select('_id')
        .lean()

    if (!activePartyPokemon?._id) {
        throw new Error('User chưa có Pokemon party để test autoTrainer parity')
    }

    return {
        trainer,
        activePokemonId: String(activePartyPokemon._id),
        rewardMarker: `battle_trainer_reward:${String(trainer._id)}`,
        prizeItemId: trainer?.prizeItemId?._id ? String(trainer.prizeItemId._id) : '',
    }
}

const collectStateSnapshot = async ({ userId, trainerId, rewardMarker, prizeItemId }) => {
    const [
        user,
        playerState,
        activeSession,
        rewardPokemonCount,
        prizeItemEntry,
    ] = await Promise.all([
        User.findById(userId).select('completedBattleTrainers').lean(),
        PlayerState.findOne({ userId }).lean(),
        BattleSession.findOne({ userId, trainerId }).select('_id').lean(),
        UserPokemon.countDocuments({ userId, originalTrainer: rewardMarker }),
        prizeItemId
            ? UserInventory.findOne({ userId, itemId: prizeItemId }).select('quantity').lean()
            : Promise.resolve(null),
    ])

    return {
        hasSession: Boolean(activeSession?._id),
        completedTrainerTracked: Array.isArray(user?.completedBattleTrainers)
            ? user.completedBattleTrainers.map((entry) => String(entry || '').trim()).includes(String(trainerId))
            : false,
        wallet: {
            gold: toNumber(playerState?.gold),
            experience: toNumber(playerState?.experience),
            moonPoints: toNumber(playerState?.moonPoints),
            wins: toNumber(playerState?.wins),
        },
        rewardPokemonCount: toNumber(rewardPokemonCount),
        rewardItemQuantity: toNumber(prizeItemEntry?.quantity),
    }
}

const buildDelta = ({ before, after }) => ({
    hasSessionBefore: Boolean(before?.hasSession),
    hasSessionAfter: Boolean(after?.hasSession),
    wallet: {
        gold: toNumber(after?.wallet?.gold) - toNumber(before?.wallet?.gold),
        experience: toNumber(after?.wallet?.experience) - toNumber(before?.wallet?.experience),
        moonPoints: toNumber(after?.wallet?.moonPoints) - toNumber(before?.wallet?.moonPoints),
        wins: toNumber(after?.wallet?.wins) - toNumber(before?.wallet?.wins),
    },
    rewardPokemonCount: toNumber(after?.rewardPokemonCount) - toNumber(before?.rewardPokemonCount),
    rewardItemQuantity: toNumber(after?.rewardItemQuantity) - toNumber(before?.rewardItemQuantity),
    completedTrainerTrackedBefore: Boolean(before?.completedTrainerTracked),
    completedTrainerTrackedAfter: Boolean(after?.completedTrainerTracked),
})

const runDirectResolve = async ({ userId, trainerId }) => {
    return resolveTrainerBattleForUserDirect({ userId, trainerId })
}

const runHttpResolve = async ({ token, trainerId }) => {
    const response = await fetch(`${API_BASE}/game/battle/resolve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trainerId }),
    })

    let payload = null
    try {
        payload = await response.json()
    } catch {
        payload = null
    }

    if (!response.ok) {
        throw new Error(`HTTP resolve failed: status=${response.status} message=${payload?.message || ''}`)
    }

    return payload
}

const runMode = async ({ mode, userId, trainerId, token, trainerContext }) => {
    await User.updateOne(
        { _id: userId },
        { $addToSet: { completedBattleTrainers: trainerId } }
    )

    await createCompletedTrainerBattleSession({
        userId,
        trainer: trainerContext.trainer,
        activePokemonId: trainerContext.activePokemonId,
    })

    const before = await collectStateSnapshot({
        userId,
        trainerId,
        rewardMarker: trainerContext.rewardMarker,
        prizeItemId: trainerContext.prizeItemId,
    })

    const payload = mode === 'direct'
        ? await runDirectResolve({ userId, trainerId })
        : await runHttpResolve({ token, trainerId })

    const after = await collectStateSnapshot({
        userId,
        trainerId,
        rewardMarker: trainerContext.rewardMarker,
        prizeItemId: trainerContext.prizeItemId,
    })

    const delta = buildDelta({ before, after })

    return {
        mode,
        payload,
        before,
        after,
        delta,
    }
}

async function main() {
    if (!PARITY_USER_ID) {
        throw new Error('Missing PARITY_USER_ID')
    }
    if (!PARITY_TRAINER_ID) {
        throw new Error('Missing PARITY_TRAINER_ID')
    }

    const token = PARITY_TOKEN || createInternalToken(PARITY_USER_ID)
    if (!token) {
        throw new Error('Missing PARITY_TOKEN and cannot generate internal token from JWT_SECRET')
    }

    const mongoUri = String(process.env.MONGO_URI || '').trim()
    if (!mongoUri) {
        throw new Error('Missing MONGO_URI')
    }

    await mongoose.connect(mongoUri)

    try {
        const trainerContext = await loadTrainerParityContext({
            userId: PARITY_USER_ID,
            trainerId: PARITY_TRAINER_ID,
        })

        const directRun = await runMode({
            mode: 'direct',
            userId: PARITY_USER_ID,
            trainerId: PARITY_TRAINER_ID,
            token,
            trainerContext,
        })
        const httpRun = await runMode({
            mode: 'http',
            userId: PARITY_USER_ID,
            trainerId: PARITY_TRAINER_ID,
            token,
            trainerContext,
        })

        const payloadShapeDiff = keyDiff(httpRun.payload || {}, directRun.payload || {})
        const rewardsDirect = directRun.payload?.results?.rewards || {}
        const rewardsHttp = httpRun.payload?.results?.rewards || {}

        const checks = {
            payloadShape: payloadShapeDiff,
            rewardValueMatch: {
                coins: toNumber(rewardsDirect.coins) === toNumber(rewardsHttp.coins),
                trainerExp: toNumber(rewardsDirect.trainerExp) === toNumber(rewardsHttp.trainerExp),
                moonPoints: toNumber(rewardsDirect.moonPoints) === toNumber(rewardsHttp.moonPoints),
            },
            sideEffects: {
                sessionConsumed: !directRun.after.hasSession && !httpRun.after.hasSession,
                walletDeltaMatch: JSON.stringify(directRun.delta.wallet) === JSON.stringify(httpRun.delta.wallet),
                completionTracked: directRun.after.completedTrainerTracked && httpRun.after.completedTrainerTracked,
                noDoubleClaim: directRun.delta.rewardPokemonCount === 0
                    && httpRun.delta.rewardPokemonCount === 0
                    && directRun.delta.rewardItemQuantity === 0
                    && httpRun.delta.rewardItemQuantity === 0,
            },
        }

        const ok = payloadShapeDiff.missingInRight.length === 0
            && checks.rewardValueMatch.coins
            && checks.rewardValueMatch.trainerExp
            && checks.rewardValueMatch.moonPoints
            && checks.sideEffects.sessionConsumed
            && checks.sideEffects.walletDeltaMatch
            && checks.sideEffects.completionTracked
            && checks.sideEffects.noDoubleClaim

        console.log(JSON.stringify({
            ok,
            config: {
                apiBase: API_BASE,
                userId: PARITY_USER_ID,
                trainerId: PARITY_TRAINER_ID,
            },
            checks,
            direct: {
                rewards: rewardsDirect,
                delta: directRun.delta,
            },
            http: {
                rewards: rewardsHttp,
                delta: httpRun.delta,
            },
        }, null, 2))

        if (!ok) {
            process.exitCode = 1
        }
    } finally {
        await mongoose.disconnect()
    }
}

main().catch((error) => {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exitCode = 1
})
