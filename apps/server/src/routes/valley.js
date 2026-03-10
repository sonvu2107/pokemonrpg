import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { createActionGuard } from '../middleware/actionGuard.js'
import UserPokemon from '../models/UserPokemon.js'
import UserInventory from '../models/UserInventory.js'
import Item from '../models/Item.js'
import {
    releasePokemon,
    catchValleyPokemon,
    listAvailable,
    getChanceLabel,
} from '../services/valleyService.js'
import { catchChanceLabel } from '../services/catchChanceService.js'
import User from '../models/User.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'

const router = express.Router()

const releaseActionGuard = createActionGuard({
    actionKey: 'valley:release',
    cooldownMs: 3_000,
    message: 'Bạn thả Pokémon quá nhanh. Vui lòng đợi một chút.',
})

const catchActionGuard = createActionGuard({
    actionKey: 'valley:catch',
    cooldownMs: 1_500,
    message: 'Bạn bắt Pokémon quá nhanh. Vui lòng đợi một chút.',
})

const isValidId = (v) => /^[a-f\d]{24}$/i.test(String(v || '').trim())

router.get('/', authMiddleware, async (req, res) => {
    try {
        const { page, limit, rarity, search } = req.query
        const result = await listAvailable({ page, limit, rarity, search })
        const sanitized = result.items.map((item) => ({
            _id: item._id,
            pokemonId: item.pokemonId,
            formId: item.formId,
            isShiny: item.isShiny,
            level: item.level,
            nickname: item.nickname,
            rarity: item.rarity,
            releasedByUsername: item.releasedByUsername,
            expiresAt: item.expiresAt,
            createdAt: item.createdAt,
        }))

        res.json({ ok: true, ...result, items: sanitized })
    } catch (err) {
        console.error('GET /api/valley error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.get('/my-releases', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
        const safePage = Math.max(1, Number(page) || 1)
        const skip = (safePage - 1) * safeLimit
        const userId = req.user.userId

        const { default: ValleyPokemon } = await import('../models/ValleyPokemon.js')
        const [items, total] = await Promise.all([
            ValleyPokemon.find({ releasedByUserId: userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .populate('pokemonId', 'name imageUrl sprites forms defaultFormId')
                .lean(),
            ValleyPokemon.countDocuments({ releasedByUserId: userId }),
        ])

        res.json({
            ok: true,
            items,
            total,
            page: safePage,
            totalPages: Math.ceil(total / safeLimit),
        })
    } catch (err) {
        console.error('GET /api/valley/my-releases error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.get('/my-box', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '' } = req.query
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20))
        const safePage = Math.max(1, Number(page) || 1)
        const skip = (safePage - 1) * safeLimit
        const userId = req.user.userId

        const query = withActiveUserPokemonFilter({ userId, location: 'box' })

        if (search) {
            const { default: Pokemon } = await import('../models/Pokemon.js')
            const regex = new RegExp('^' + String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
            const speciesMatches = await Pokemon.find({ name: regex }).select('_id').lean()
            const speciesIds = speciesMatches.map((s) => s._id)
            query.$or = [
                { nickname: regex },
                { pokemonId: { $in: speciesIds } },
            ]
        }

        const [items, total] = await Promise.all([
            UserPokemon.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .populate('pokemonId', 'name imageUrl sprites forms defaultFormId rarity')
                .lean(),
            UserPokemon.countDocuments(query),
        ])

        res.json({
            ok: true,
            items,
            total,
            page: safePage,
            totalPages: Math.ceil(total / safeLimit),
        })
    } catch (err) {
        console.error('GET /api/valley/my-box error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.get('/:id/chance', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params
        const { ballItemId } = req.query

        if (!isValidId(id) || !isValidId(ballItemId)) {
            return res.status(400).json({ ok: false, message: 'Tham số không hợp lệ' })
        }

        const user = await User.findById(req.user.userId).select('vipBenefits vipTierId vipTierLevel').lean()
        const chance = await getChanceLabel({ valleyPokemonId: id, ballItemId, user })

        if (chance === null) {
            return res.status(404).json({ ok: false, message: 'Pokémon không còn trong Thung Lũng' })
        }

        res.json({ ok: true, label: catchChanceLabel(chance) })
    } catch (err) {
        console.error('GET /api/valley/:id/chance error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.post('/release', authMiddleware, releaseActionGuard, async (req, res) => {
    try {
        const userId = req.user.userId
        const { userPokemonId } = req.body

        if (!isValidId(userPokemonId)) {
            return res.status(400).json({ ok: false, message: 'Tham số không hợp lệ' })
        }

        const user = await User.findById(userId).select('username').lean()
        const username = user?.username || 'Trainer'

        const result = await releasePokemon({ userId, userPokemonId, username })

        if (!result.ok) {
            const statusMap = { NOT_FOUND: 404, LAST_PARTY: 400 }
            const status = statusMap[result.code] || 400
            return res.status(status).json(result)
        }

        res.json(result)
    } catch (err) {
        console.error('POST /api/valley/release error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.post('/:id/catch', authMiddleware, catchActionGuard, async (req, res) => {
    try {
        const userId = req.user.userId
        const { id } = req.params
        const { ballItemId } = req.body

        if (!isValidId(id) || !isValidId(ballItemId)) {
            return res.status(400).json({ ok: false, message: 'Tham số không hợp lệ' })
        }

        const user = await User.findById(userId).select('vipBenefits vipTierId vipTierLevel').lean()

        const result = await catchValleyPokemon({
            userId,
            valleyPokemonId: id,
            ballItemId,
            user,
        })

        if (!result.ok) {
            const statusMap = { EXPIRED: 410, RACE_LOST: 409, NO_BALL: 400 }
            const status = statusMap[result.code] || 400
            return res.status(status).json(result)
        }

        res.json(result)
    } catch (err) {
        console.error('POST /api/valley/:id/catch error:', err)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
