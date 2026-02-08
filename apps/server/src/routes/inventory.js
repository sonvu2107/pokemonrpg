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
        const items = await UserInventory.find({ userId: req.user.userId })
            .populate('itemId')
            .lean()

        const inventory = items.map((entry) => ({
            _id: entry._id,
            item: entry.itemId,
            quantity: entry.quantity,
        }))

        res.json({ ok: true, inventory })
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

        if (!itemId || !Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ ok: false, message: 'Invalid item or quantity' })
        }

        const Item = (await import('../models/Item.js')).default
        const item = await Item.findById(itemId).lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Item not found' })
        }

        const entry = await UserInventory.findOne({ userId: req.user.userId, itemId })

        if (!entry || entry.quantity < qty) {
            return res.status(400).json({ ok: false, message: 'Not enough items' })
        }

        if (item.type === 'healing') {
            const playerState = await PlayerState.findOne({ userId: req.user.userId })
            if (!playerState) {
                return res.status(404).json({ ok: false, message: 'Player state not found' })
            }

            const { hpAmount, mpAmount } = getHealAmounts(item)
            const beforeHp = playerState.hp
            const beforeMp = playerState.mp
            const nextHp = Math.min(playerState.maxHp, beforeHp + hpAmount)
            const nextMp = Math.min(playerState.maxMp, beforeMp + mpAmount)

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

        if (item.type === 'pokeball') {
            if (!encounterId) {
                return res.status(400).json({ ok: false, message: 'Encounter is required to use a Pokeball' })
            }

            const encounter = await Encounter.findOne({ _id: encounterId, userId: req.user.userId, isActive: true })
            if (!encounter) {
                return res.status(404).json({ ok: false, message: 'Encounter not found or already ended' })
            }

            const Pokemon = (await import('../models/Pokemon.js')).default
            const pokemon = await Pokemon.findById(encounter.pokemonId)
                .select('name pokedexNumber baseStats catchRate levelUpMoves')
                .lean()

            if (!pokemon) {
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

            entry.quantity -= qty
            if (entry.quantity <= 0) {
                await entry.deleteOne()
            } else {
                await entry.save()
            }

            if (caught) {
                const moves = buildMovesForLevel(pokemon, encounter.level)
                await UserPokemon.create({
                    userId: req.user.userId,
                    pokemonId: encounter.pokemonId,
                    level: encounter.level,
                    experience: 0,
                    moves,
                    formId: encounter.formId || 'normal',
                    isShiny: encounter.isShiny,
                    location: 'box',
                })

                encounter.isActive = false
                encounter.endedAt = new Date()
                await encounter.save()
            }

            return res.json({
                ok: true,
                caught,
                encounterId: encounter._id,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                message: caught ? `Đã bắt được ${pokemon.name}!` : 'Pokemon đã thoát khỏi bóng!',
            })
        }

        return res.status(400).json({ ok: false, message: 'Item cannot be used now' })
    } catch (error) {
        console.error('POST /api/inventory/use error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
