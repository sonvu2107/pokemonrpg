import express from 'express'
import UserInventory from '../models/UserInventory.js'
import PlayerState from '../models/PlayerState.js'
import Encounter from '../models/Encounter.js'
import UserPokemon from '../models/UserPokemon.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

const clampChance = (value, min, max) => Math.min(max, Math.max(min, value))

const calcCatchChance = ({ catchRate, hp, maxHp }) => {
    const rate = Math.min(255, Math.max(1, catchRate || 45))
    const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
    const raw = (rate / 255) * hpFactor
    return clampChance(raw, 0.02, 0.95)
}

const getBallMultiplier = (item) => {
    if (item?.effectType === 'catchMultiplier' && Number.isFinite(item.effectValue)) {
        return item.effectValue || 1
    }
    return 1
}

const getHealAmounts = (item) => {
    if (item?.effectType === 'heal' || item?.effectType === 'healAmount') {
        const hpAmount = Number.isFinite(item.effectValue) ? item.effectValue : 0
        const mpAmount = Number.isFinite(item.effectValueMp) ? item.effectValueMp : 0
        return { hpAmount, mpAmount }
    }
    return { hpAmount: 0, mpAmount: 0 }
}

const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter(m => Number.isFinite(m.level) && m.level <= level)
        .sort((a, b) => a.level - b.level)
        .map(m => m.moveName || '')
        .filter(Boolean)
    return learned.slice(-4)
}

// All routes require authentication
router.use(authMiddleware)

// GET /api/inventory - List user's items
router.get('/', async (req, res) => {
    try {
        const userId = req.user.userId
        const [items, playerState] = await Promise.all([
            UserInventory.find({ userId })
                .populate('itemId')
                .lean(),
            PlayerState.findOne({ userId })
                .select('gold moonPoints')
                .lean(),
        ])

        const inventory = items.map((entry) => ({
            _id: entry._id,
            item: entry.itemId,
            quantity: entry.quantity,
        }))

        res.json({
            ok: true,
            inventory,
            playerState: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
        })
    } catch (error) {
        console.error('GET /api/inventory error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/inventory/use - Use an item (placeholder effect)
router.post('/use', async (req, res) => {
    try {
        const { itemId, quantity = 1, encounterId } = req.body
        const qty = Number(quantity)
        const userId = req.user.userId

        if (!itemId || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ ok: false, message: 'Invalid item or quantity' })
        }

        const Item = (await import('../models/Item.js')).default
        const item = await Item.findById(itemId).lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Item not found' })
        }

        if (item.type === 'pokeball') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Pokeball can only be used one at a time' })
            }

            if (!encounterId) {
                return res.status(400).json({ ok: false, message: 'Encounter is required to use a Pokeball' })
            }

            const encounter = await Encounter.findOne({ _id: encounterId, userId, isActive: true })
                .select('pokemonId level hp maxHp isShiny formId')
                .lean()
            if (!encounter) {
                return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
            }

            const consumedEntry = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedEntry) {
                return res.status(400).json({ ok: false, message: 'Not enough items' })
            }

            if (consumedEntry.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
            }

            const Pokemon = (await import('../models/Pokemon.js')).default
            const pokemon = await Pokemon.findById(encounter.pokemonId)
                .select('name pokedexNumber baseStats catchRate levelUpMoves')
                .lean()

            if (!pokemon) {
                await UserInventory.updateOne(
                    { userId, itemId },
                    { $inc: { quantity: qty } },
                    { upsert: true }
                )
                return res.status(404).json({ ok: false, message: 'Pokemon not found' })
            }

            const baseChance = calcCatchChance({
                catchRate: pokemon.catchRate,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
            })
            const multiplier = getBallMultiplier(item)
            const chance = clampChance(baseChance * multiplier, 0.02, 0.99)
            const caught = Math.random() < chance

            if (caught) {
                const resolvedEncounter = await Encounter.findOneAndUpdate(
                    { _id: encounterId, userId, isActive: true },
                    { $set: { isActive: false, endedAt: new Date() } },
                    { new: true }
                )

                if (!resolvedEncounter) {
                    await UserInventory.updateOne(
                        { userId, itemId },
                        { $inc: { quantity: qty } },
                        { upsert: true }
                    )
                    return res.status(409).json({ ok: false, message: 'Encounter already resolved. Please refresh.' })
                }

                const moves = buildMovesForLevel(pokemon, encounter.level)
                await UserPokemon.create({
                    userId,
                    pokemonId: encounter.pokemonId,
                    level: encounter.level,
                    experience: 0,
                    moves,
                    formId: encounter.formId || 'normal',
                    isShiny: encounter.isShiny,
                    location: 'box',
                })

                return res.json({
                    ok: true,
                    caught: true,
                    encounterId: resolvedEncounter._id,
                    hp: resolvedEncounter.hp,
                    maxHp: resolvedEncounter.maxHp,
                    message: `Đã bắt được ${pokemon.name}!`,
                })
            }

            const isStillActive = await Encounter.exists({ _id: encounterId, userId, isActive: true })
            if (!isStillActive) {
                await UserInventory.updateOne(
                    { userId, itemId },
                    { $inc: { quantity: qty } },
                    { upsert: true }
                )
                return res.status(409).json({ ok: false, message: 'Encounter already resolved. Please refresh.' })
            }

            return res.json({
                ok: true,
                caught: false,
                encounterId,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                message: 'Pokemon đã thoát khỏi bóng!',
            })
        }

        const entry = await UserInventory.findOne({ userId, itemId })

        if (!entry || entry.quantity < qty) {
            return res.status(400).json({ ok: false, message: 'Not enough items' })
        }

        if (item.type === 'healing') {
            const playerState = await PlayerState.findOne({ userId })
            if (!playerState) {
                return res.status(404).json({ ok: false, message: 'Player state not found' })
            }

            const { hpAmount, mpAmount } = getHealAmounts(item)
            const beforeHp = playerState.hp
            const beforeMp = playerState.mp
            const totalHpHeal = hpAmount * qty
            const totalMpHeal = mpAmount * qty
            const nextHp = Math.min(playerState.maxHp, beforeHp + totalHpHeal)
            const nextMp = Math.min(playerState.maxMp, beforeMp + totalMpHeal)

            if (nextHp === beforeHp && nextMp === beforeMp) {
                return res.status(400).json({ ok: false, message: 'HP/MP is already full' })
            }

            if (hpAmount <= 0 && mpAmount <= 0) {
                return res.status(400).json({ ok: false, message: 'Item has no healing effect' })
            }

            playerState.hp = nextHp
            playerState.mp = nextMp
            await playerState.save()

            entry.quantity -= qty
            if (entry.quantity <= 0) {
                await entry.deleteOne()
            } else {
                await entry.save()
            }

            return res.json({
                ok: true,
                message: `Đã hồi ${nextHp - beforeHp} HP, ${nextMp - beforeMp} MP`,
                itemId,
                quantity: qty,
                effect: {
                    type: 'healing',
                    healedHp: nextHp - beforeHp,
                    healedMp: nextMp - beforeMp,
                    hp: nextHp,
                    maxHp: playerState.maxHp,
                    mp: nextMp,
                    maxMp: playerState.maxMp,
                },
            })
        }

        return res.status(400).json({ ok: false, message: 'Item cannot be used now' })
    } catch (error) {
        console.error('POST /api/inventory/use error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
