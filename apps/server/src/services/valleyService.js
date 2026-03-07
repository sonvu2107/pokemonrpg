/**
 * valleyService.js
 *
 * Business logic for Pokémon Valley:
 *   - releasePokemon  : move a UserPokemon into the Valley (compensation pattern, no transaction)
 *   - catchPokemon    : atomic reserve → consume ball → roll catch
 */

import ValleyPokemon from '../models/ValleyPokemon.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import Item from '../models/Item.js'
import User from '../models/User.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import { calcCatchChance, rollCatch } from './catchChanceService.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const VALLEY_EXPIRE_DAYS = 30
const RESERVE_TIMEOUT_MS = 10_000 // 10 s stale-reserve window

// ─── Helpers ──────────────────────────────────────────────────────────────────

const levelBand = (level) => {
    if (level >= 100) return '100+'
    if (level >= 50) return '50-99'
    if (level >= 20) return '20-49'
    return '1-19'
}

const resolveVipSsCatchBonus = async (userLike) => {
    if (!userLike) return 0

    const fromUser = Math.max(
        0,
        Number(userLike?.vipBenefits?.ssCatchRateBonusPercent ?? userLike?.vipBenefits?.catchRateBonusPercent ?? 0) || 0
    )
    if (fromUser > 0) return fromUser

    if (userLike?.vipTierId) {
        const tier = await VipPrivilegeTier.findById(userLike.vipTierId).select('benefits').lean()
        return Math.max(0, Number(tier?.benefits?.ssCatchRateBonusPercent ?? 0) || 0)
    }

    const tierLevel = Math.max(0, Number.parseInt(userLike?.vipTierLevel, 10) || 0)
    if (tierLevel > 0) {
        const tier = await VipPrivilegeTier.findOne({ level: tierLevel }).select('benefits').lean()
        return Math.max(0, Number(tier?.benefits?.ssCatchRateBonusPercent ?? 0) || 0)
    }

    return 0
}

// ─── Release ──────────────────────────────────────────────────────────────────

/**
 * Release a UserPokemon into the Valley.
 *
 * @param {{ userId: string, userPokemonId: string, username: string }} opts
 * @returns {{ ok: boolean, message: string, valleyPokemonId?: string }}
 */
export const releasePokemon = async ({ userId, userPokemonId, username }) => {
    // 1. Load pokemon + validate owner
    const userPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({
        _id: userPokemonId,
        userId,
    })).populate('pokemonId', 'name nameLower rarity catchRate')

    if (!userPokemon) {
        return { ok: false, code: 'NOT_FOUND', message: 'Không tìm thấy Pokémon của bạn' }
    }

    // 2. Must not be the last active Pokémon in party
    const activePartyCount = await UserPokemon.countDocuments(withActiveUserPokemonFilter({
        userId,
        location: 'party',
    }))
    if (userPokemon.location === 'party' && activePartyCount <= 1) {
        return { ok: false, code: 'LAST_PARTY', message: 'Không thể thả Pokémon cuối cùng trong đội' }
    }

    const species = userPokemon.pokemonId

    // 3. Return heldItem to inventory if present
    if (userPokemon.heldItem) {
        const heldItemName = userPokemon.heldItem
        const heldItemDoc = await Item.findOne({ name: heldItemName }).select('_id').lean()
        if (heldItemDoc) {
            await UserInventory.updateOne(
                { userId, itemId: heldItemDoc._id },
                { $inc: { quantity: 1 } },
                { upsert: true }
            )
        }
        userPokemon.heldItem = null
        await userPokemon.save()
    }

    // 4. Build snapshot + insert ValleyPokemon
    const expiresAt = new Date(Date.now() + VALLEY_EXPIRE_DAYS * 24 * 60 * 60 * 1000)

    let valleyDoc
    try {
        valleyDoc = await ValleyPokemon.create({
            pokemonId: species._id,
            formId: userPokemon.formId,
            isShiny: userPokemon.isShiny,
            level: userPokemon.level,
            nickname: userPokemon.nickname,
            ivs: userPokemon.ivs,
            evs: userPokemon.evs,
            nature: userPokemon.nature ?? null,
            gender: userPokemon.gender ?? null,
            ability: userPokemon.ability ?? null,
            heldItem: null,
            moves: userPokemon.moves,
            movePpState: userPokemon.movePpState,
            statsSnapshot: {
                ivs: userPokemon.ivs,
                evs: userPokemon.evs,
                nature: userPokemon.nature ?? null,
                gender: userPokemon.gender ?? null,
                ability: userPokemon.ability ?? null,
                moves: userPokemon.moves,
                movePpState: userPokemon.movePpState,
                friendship: userPokemon.friendship,
                originalTrainer: userPokemon.originalTrainer,
                obtainedMapName: userPokemon.obtainedMapName,
            },
            rarity: species.rarity ?? 'd',
            catchRate: species.catchRate ?? 45,
            pokemonNameLower: String(species.nameLower || species.name || '').toLowerCase(),
            nicknameLower: userPokemon.nickname
                ? String(userPokemon.nickname).toLowerCase()
                : null,
            releasedByUserId: userId,
            releasedByUsername: username,
            originalUserPokemonId: userPokemon._id,
            expiresAt,
        })
    } catch (err) {
        // Abort — heldItem already returned above, but UserPokemon still active → consistent
        throw err
    }

    // 5. Mark UserPokemon as released (compensation: if this fails, delete valleyDoc)
    try {
        userPokemon.status = 'released'
        if (userPokemon.location === 'party') {
            userPokemon.location = 'box'
            userPokemon.partyIndex = null
        }
        await userPokemon.save()
    } catch (err) {
        // Compensation: remove the ValleyPokemon we just created
        try {
            await ValleyPokemon.deleteOne({ _id: valleyDoc._id })
        } catch (compErr) {
            console.error('[valleyService] compensation delete failed:', compErr)
        }
        throw err
    }

    return {
        ok: true,
        message: `Đã thả ${userPokemon.nickname || species.name} vào Thung Lũng`,
        valleyPokemonId: String(valleyDoc._id),
    }
}

// ─── Catch ────────────────────────────────────────────────────────────────────

/**
 * Attempt to catch a ValleyPokemon.
 *
 * @param {{ userId: string, valleyPokemonId: string, ballItemId: string, user: object }} opts
 * @returns {{ ok: boolean, caught: boolean, code?: string, message: string, pokemon?: object }}
 */
export const catchValleyPokemon = async ({ userId, valleyPokemonId, ballItemId, user }) => {
    // 1. Atomic reserve
    const staleThreshold = new Date(Date.now() - RESERVE_TIMEOUT_MS)
    const valley = await ValleyPokemon.findOneAndUpdate(
        {
            _id: valleyPokemonId,
            expiresAt: { $gt: new Date() },
            $or: [
                { status: 'available' },
                { status: 'reserved', reservedAt: { $lt: staleThreshold } },
            ],
        },
        {
            $set: {
                status: 'reserved',
                reservedByUserId: userId,
                reservedAt: new Date(),
            },
        },
        { new: true }
    )

    if (!valley) {
        // Could be expired, already caught, or lost race
        const exists = await ValleyPokemon.findById(valleyPokemonId).select('status expiresAt').lean()
        if (!exists || exists.expiresAt <= new Date()) {
            return { ok: false, caught: false, code: 'EXPIRED', message: 'Pokémon này đã rời khỏi Thung Lũng' }
        }
        return { ok: false, caught: false, code: 'RACE_LOST', message: 'Có người khác đang thử bắt Pokémon này, hãy thử lại' }
    }

    // 2. Verify + consume ball
    const ballEntry = await UserInventory.findOneAndUpdate(
        { userId, itemId: ballItemId, quantity: { $gte: 1 } },
        { $inc: { quantity: -1 } },
        { new: true }
    )
    if (!ballEntry) {
        // Release reservation
        await ValleyPokemon.updateOne(
            { _id: valley._id, status: 'reserved', reservedByUserId: userId },
            { $set: { status: 'available', reservedByUserId: null, reservedAt: null } }
        )
        return { ok: false, caught: false, code: 'NO_BALL', message: 'Bạn không có bóng này trong túi' }
    }

    // 3. Load ball item for catch modifier
    const ballItem = await Item.findById(ballItemId)
        .select('name effectType effectValue')
        .lean()

    // 4. Resolve VIP SS bonus
    const vipSsBonusPct = await resolveVipSsCatchBonus(user)

    // 5. Roll catch
    const { chance } = calcCatchChance({
        catchRate: valley.catchRate ?? 45,
        rarity: valley.rarity ?? 'd',
        ballItem,
        vipSsBonusPct,
        mode: 'valley',
    })

    const caught = rollCatch(chance)

    // 6a. Success — create new UserPokemon from snapshot
    if (caught) {
        const snap = valley.statsSnapshot || {}
        const newPokemon = await UserPokemon.create({
            userId,
            pokemonId: valley.pokemonId,
            formId: valley.formId,
            isShiny: valley.isShiny,
            level: valley.level,
            experience: 0,
            nickname: valley.nickname,
            ivs: snap.ivs ?? valley.ivs,
            evs: snap.evs ?? valley.evs,
            nature: snap.nature ?? valley.nature,
            gender: snap.gender ?? valley.gender,
            ability: snap.ability ?? valley.ability,
            heldItem: null,
            moves: snap.moves ?? valley.moves,
            movePpState: snap.movePpState ?? valley.movePpState,
            friendship: snap.friendship ?? 70,
            originalTrainer: snap.originalTrainer ?? '',
            obtainedMapName: snap.obtainedMapName ?? '',
            location: 'box',
            status: 'active',
            obtainedAt: new Date(),
        })

        await ValleyPokemon.updateOne(
            { _id: valley._id },
            { $set: { status: 'caught', caughtByUserId: userId, caughtAt: new Date() } }
        )

        return {
            ok: true,
            caught: true,
            message: 'Bắt thành công!',
            pokemon: newPokemon,
            ballRemaining: Math.max(0, Number(ballEntry.quantity)),
        }
    }

    // 6b. Fail — reset reservation, ball already consumed (not refunded)
    await ValleyPokemon.updateOne(
        { _id: valley._id, status: 'reserved', reservedByUserId: userId },
        { $set: { status: 'available', reservedByUserId: null, reservedAt: null } }
    )

    return {
        ok: true,
        caught: false,
        message: 'Bắt thất bại! Pokémon đã thoát ra.',
        ballRemaining: Math.max(0, Number(ballEntry.quantity)),
    }
}

// ─── List (browse Valley) ─────────────────────────────────────────────────────

/**
 * Paginated list of available ValleyPokemon (for Valley browser tab).
 * Populates species name + sprites for display.
 *
 * @param {{ page: number, limit: number, rarity?: string, search?: string }} opts
 */
export const listAvailable = async ({ page = 1, limit = 20, rarity, search } = {}) => {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
    const safePage = Math.max(1, Number(page) || 1)
    const skip = (safePage - 1) * safeLimit

    const filter = {
        status: 'available',
        expiresAt: { $gt: new Date() },
    }
    if (rarity) filter.rarity = String(rarity).toLowerCase()
    if (search) {
        const regex = new RegExp('^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        filter.$or = [
            { pokemonNameLower: regex },
            { nicknameLower: regex },
        ]
    }

    const [items, total] = await Promise.all([
        ValleyPokemon.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .populate('pokemonId', 'name imageUrl sprites forms defaultFormId')
            .lean(),
        ValleyPokemon.countDocuments(filter),
    ])

    return {
        items,
        total,
        page: safePage,
        totalPages: Math.ceil(total / safeLimit),
    }
}

/**
 * Get catch-chance label for a specific Valley pokemon + ball (for UI preview).
 */
export const getChanceLabel = async ({ valleyPokemonId, ballItemId, user }) => {
    const [valley, ballItem, vipSsBonusPct] = await Promise.all([
        ValleyPokemon.findById(valleyPokemonId).select('catchRate rarity status expiresAt').lean(),
        Item.findById(ballItemId).select('name effectType effectValue').lean(),
        resolveVipSsCatchBonus(user),
    ])

    if (!valley || valley.status === 'caught' || valley.status === 'expired' || valley.expiresAt <= new Date()) {
        return null
    }

    const { chance } = calcCatchChance({
        catchRate: valley.catchRate ?? 45,
        rarity: valley.rarity ?? 'd',
        ballItem,
        vipSsBonusPct,
        mode: 'valley',
    })

    return chance
}
