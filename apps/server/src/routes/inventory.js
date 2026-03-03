import express from 'express'
import UserInventory from '../models/UserInventory.js'
import PlayerState from '../models/PlayerState.js'
import Encounter from '../models/Encounter.js'
import UserPokemon from '../models/UserPokemon.js'
import BattleSession from '../models/BattleSession.js'
import { authMiddleware } from '../middleware/auth.js'
import { buildMovesForLevel, syncUserPokemonMovesAndPp, normalizeMoveName } from '../utils/movePpUtils.js'

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
        const ppAmount = Number.isFinite(item.effectValueMp) ? item.effectValueMp : 0
        return { hpAmount, ppAmount }
    }
    return { hpAmount: 0, ppAmount: 0 }
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
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/inventory/use - Use an item (placeholder effect)
router.post('/use', async (req, res) => {
    try {
        const { itemId, quantity = 1, encounterId, activePokemonId = null, moveName = '' } = req.body
        const qty = Number(quantity)
        const userId = req.user.userId

        if (!itemId || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ ok: false, message: 'Vật phẩm hoặc số lượng không hợp lệ' })
        }

        const Item = (await import('../models/Item.js')).default
        const item = await Item.findById(itemId).lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        if (item.type === 'pokeball') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Pokeball chỉ được dùng từng quả một' })
            }

            if (!encounterId) {
                return res.status(400).json({ ok: false, message: 'Cần trong trận chiến để dùng pokeball' })
            }

            const encounter = await Encounter.findOne({ _id: encounterId, userId, isActive: true })
                .select('pokemonId level hp maxHp isShiny formId')
                .lean()
            if (!encounter) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy trận chiến hoặc đã kết thúc. Vui lòng tải lại.' })
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
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
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
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
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
                    return res.status(409).json({ ok: false, message: 'Trận chiến đã kết thúc. Vui lòng tải lại.' })
                }

                const moves = buildMovesForLevel(pokemon, encounter.level)
                const caughtPokemon = await UserPokemon.create({
                    userId,
                    pokemonId: encounter.pokemonId,
                    level: encounter.level,
                    experience: 0,
                    moves,
                    movePpState: [],
                    formId: encounter.formId || 'normal',
                    isShiny: encounter.isShiny,
                    location: 'box',
                })
                await syncUserPokemonMovesAndPp(caughtPokemon, {
                    pokemonSpecies: pokemon,
                    level: encounter.level,
                })
                await caughtPokemon.save()

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
                return res.status(409).json({ ok: false, message: 'Trận chiến đã kết thúc. Vui lòng tải lại.' })
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
            return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
        }

        if (item.type === 'healing') {
            const playerState = await PlayerState.findOne({ userId })
            if (!playerState) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy trạng thái người chơi' })
            }

            const { hpAmount, ppAmount } = getHealAmounts(item)
            const totalHpHeal = hpAmount * qty
            const totalPpHeal = Math.max(0, Math.floor(ppAmount * qty))

            let hpContext = 'player'
            let beforeHp = Math.max(0, Number(playerState.hp || 0))
            let maxHp = Math.max(1, Number(playerState.maxHp || 1))
            let nextHp = Math.min(maxHp, beforeHp + totalHpHeal)

            let activeBattleSession = null
            if (!encounterId && targetPokemon) {
                activeBattleSession = await BattleSession.findOne({
                    userId,
                    playerPokemonId: targetPokemon._id,
                    expiresAt: { $gt: new Date() },
                })
            }

            if (activeBattleSession) {
                hpContext = 'battle'
                beforeHp = Math.max(0, Number(activeBattleSession.playerCurrentHp || 0))
                maxHp = Math.max(1, Number(activeBattleSession.playerMaxHp || 1))
                nextHp = Math.min(maxHp, beforeHp + totalHpHeal)
            }

            const healedHp = Math.max(0, nextHp - beforeHp)

            let targetPokemon = null
            if (activePokemonId) {
                targetPokemon = await UserPokemon.findOne({
                    _id: activePokemonId,
                    userId,
                }).populate('pokemonId', 'levelUpMoves')
            }

            if (!targetPokemon) {
                targetPokemon = await UserPokemon.findOne({ userId, location: 'party' })
                    .sort({ partyIndex: 1 })
                    .populate('pokemonId', 'levelUpMoves')
            }

            let healedPp = 0
            let restoredPpMoves = []

            if (targetPokemon && totalPpHeal > 0) {
                await syncUserPokemonMovesAndPp(targetPokemon, {
                    pokemonSpecies: targetPokemon.pokemonId,
                    level: targetPokemon.level,
                })

                const normalizedTargetMove = normalizeMoveName(moveName)
                const nextMovePpState = (Array.isArray(targetPokemon.movePpState) ? targetPokemon.movePpState : [])
                    .map((entry) => {
                        const currentPp = Math.max(0, Math.floor(Number(entry?.currentPp) || 0))
                        const maxPp = Math.max(1, Math.floor(Number(entry?.maxPp) || 1))
                        const moveLabel = String(entry?.moveName || '').trim()
                        const moveKey = normalizeMoveName(moveLabel)

                        if (!moveKey) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        if (normalizedTargetMove && moveKey !== normalizedTargetMove) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        if (currentPp >= maxPp) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        const nextCurrentPp = Math.min(maxPp, currentPp + totalPpHeal)
                        const diff = Math.max(0, nextCurrentPp - currentPp)
                        if (diff > 0) {
                            healedPp += diff
                            restoredPpMoves.push({
                                moveName: moveLabel,
                                restored: diff,
                                currentPp: nextCurrentPp,
                                maxPp,
                            })
                        }

                        return {
                            moveName: moveLabel,
                            currentPp: nextCurrentPp,
                            maxPp,
                        }
                    })

                targetPokemon.movePpState = nextMovePpState
            }

            if (healedHp === 0 && healedPp === 0) {
                return res.status(400).json({ ok: false, message: 'HP/PP đã đầy' })
            }

            if (hpAmount <= 0 && ppAmount <= 0) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm này không có hiệu ứng hồi phục' })
            }

            if (hpContext === 'battle' && activeBattleSession) {
                activeBattleSession.playerCurrentHp = nextHp
                await activeBattleSession.save()
            } else {
                playerState.hp = nextHp
                await playerState.save()
            }

            if (targetPokemon) {
                await targetPokemon.save()
            }

            entry.quantity -= qty
            if (entry.quantity <= 0) {
                await entry.deleteOne()
            } else {
                await entry.save()
            }

            return res.json({
                ok: true,
                message: `Đã hồi ${healedHp} HP, ${healedPp} PP`,
                itemId,
                quantity: qty,
                effect: {
                    type: 'healing',
                    healedHp,
                    healedPp,
                    hp: nextHp,
                    maxHp,
                    hpContext,
                    targetPokemonId: targetPokemon?._id || null,
                    restoredMoves: restoredPpMoves,
                },
            })
        }

        return res.status(400).json({ ok: false, message: 'Vật phẩm này không thể dùng lúc này' })
    } catch (error) {
        console.error('POST /api/inventory/use error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
