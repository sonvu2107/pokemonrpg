import express from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import { authMiddleware } from '../middleware/auth.js'
import Auction from '../models/Auction.js'
import AuctionBid from '../models/AuctionBid.js'
import PlayerState from '../models/PlayerState.js'
import Pokemon from '../models/Pokemon.js'
import UserPokemon from '../models/UserPokemon.js'
import {
    activateDueAuctions,
    AUCTION_REWARD_TYPE_POKEMON,
    AUCTION_SETTLEMENT_STATUS,
    AUCTION_STATUS,
    buildAuctionCode,
    buildUserPokemonRewardSnapshot,
    computeAuctionMinNextBid,
    isUserPokemonEscrowRewardSnapshot,
    placeAuctionBid,
    releaseCompletedNoBidEscrowAuctionsForUser,
    restoreEscrowedAuctionPokemon,
    serializeAuction,
    serializeAuctionBid,
} from '../services/auctionService.js'
import { attachSession, getSessionOptions, runWithOptionalTransaction } from '../utils/mongoTransactions.js'

const router = express.Router()

const toSafePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(50, Math.max(1, Number.parseInt(value, 10) || 20))
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const USER_AUCTION_MIN_VIP_LEVEL = 4

const parseRequiredDate = (value, label) => {
    const nextDate = new Date(value)
    if (Number.isNaN(nextDate.getTime())) {
        throw new Error(`${label} không hợp lệ`)
    }
    return nextDate
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonSprite = (pokemonLike = {}, preferredFormId = 'normal', isShiny = false) => {
    const forms = Array.isArray(pokemonLike?.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    const targetFormId = normalizeFormId(preferredFormId || defaultFormId)
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === targetFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null

    if (isShiny) {
        return String(resolvedForm?.shinyImageUrl || pokemonLike?.shinyImageUrl || resolvedForm?.imageUrl || pokemonLike?.sprite || pokemonLike?.imageUrl || '').trim()
    }
    return String(resolvedForm?.imageUrl || pokemonLike?.sprite || pokemonLike?.imageUrl || '').trim()
}

const ensureVipAuctionCreator = (req, res) => {
    const vipTierLevel = Math.max(0, Number.parseInt(req.user?.vipTierLevel, 10) || 0)
    if (vipTierLevel < USER_AUCTION_MIN_VIP_LEVEL) {
        res.status(403).json({ ok: false, message: `Tính năng này yêu cầu VIP ${USER_AUCTION_MIN_VIP_LEVEL} trở lên` })
        return false
    }
    return true
}

const buildManagedAuctionQuery = (userId, reqQuery = {}) => {
    const status = String(reqQuery.status || 'all').trim().toLowerCase()
    const search = String(reqQuery.search || '').trim()
    const query = { createdBy: userId, rewardType: AUCTION_REWARD_TYPE_POKEMON }

    if ([AUCTION_STATUS.DRAFT, AUCTION_STATUS.SCHEDULED, AUCTION_STATUS.ACTIVE, AUCTION_STATUS.COMPLETED, AUCTION_STATUS.CANCELLED, AUCTION_STATUS.SETTLEMENT_FAILED].includes(status)) {
        query.status = status
    }
    if (search) {
        query.$or = [
            { title: { $regex: escapeRegExp(search), $options: 'i' } },
            { code: { $regex: escapeRegExp(search), $options: 'i' } },
        ]
    }

    return query
}

const serializeOwnedPokemonLookupRow = (entry = {}) => {
    const pokemon = entry?.pokemonId && typeof entry.pokemonId === 'object' ? entry.pokemonId : null
    const formId = normalizeFormId(entry?.formId || pokemon?.defaultFormId || 'normal')
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const forms = Array.isArray(pokemon?.forms) && pokemon.forms.length > 0
        ? pokemon.forms.map((form) => ({
            formId: normalizeFormId(form?.formId || defaultFormId),
            formName: String(form?.formName || '').trim() || normalizeFormId(form?.formId || defaultFormId),
        }))
        : [{ formId: defaultFormId, formName: defaultFormId }]

    return {
        _id: String(entry?._id || '').trim(),
        pokemonId: String(pokemon?._id || '').trim(),
        name: String(pokemon?.name || 'Pokemon').trim() || 'Pokemon',
        nickname: String(entry?.nickname || '').trim(),
        pokedexNumber: Number(pokemon?.pokedexNumber || 0),
        level: Math.max(1, Number.parseInt(entry?.level, 10) || 1),
        formId,
        defaultFormId,
        isShiny: Boolean(entry?.isShiny),
        location: String(entry?.location || 'box').trim() || 'box',
        sprite: resolvePokemonSprite(pokemon, formId, Boolean(entry?.isShiny)),
        forms,
    }
}

const loadManagedAuction = (auctionId, userId) => Auction.findOne({
    _id: auctionId,
    createdBy: userId,
    rewardType: AUCTION_REWARD_TYPE_POKEMON,
})
    .populate('highestBidderId', 'username')
    .populate('winnerId', 'username')

const loadParticipantCountMap = async (auctionIds = []) => {
    if (auctionIds.length === 0) return new Map()
    const participants = await AuctionBid.aggregate([
        { $match: { auctionId: { $in: auctionIds } } },
        { $group: { _id: '$auctionId', participantIds: { $addToSet: '$userId' } } },
    ])
    return new Map(participants.map((entry) => [String(entry?._id || '').trim(), Array.isArray(entry?.participantIds) ? entry.participantIds.length : 0]))
}

const reserveUserPokemonForAuction = async ({ userPokemonId, userId, session, allowAuctionLocation = false }) => {
    const locationMatch = allowAuctionLocation ? ['box', 'party', 'auction'] : ['box', 'party']
    const userPokemon = await attachSession(UserPokemon.findOne({
        _id: userPokemonId,
        userId,
        status: 'active',
        location: { $in: locationMatch },
    })
        .populate('pokemonId', 'name pokedexNumber imageUrl sprite sprites shinyImageUrl defaultFormId forms'), session)

    if (!userPokemon || !userPokemon.pokemonId) {
        throw new Error('Không tìm thấy Pokémon thuộc sở hữu của bạn để đấu giá')
    }

    const rewardSnapshot = buildUserPokemonRewardSnapshot(userPokemon.toObject(), userPokemon.pokemonId)

    if (userPokemon.location !== 'auction') {
        userPokemon.location = 'auction'
        userPokemon.boxNumber = Math.max(1, Number.parseInt(userPokemon.boxNumber, 10) || 1)
        userPokemon.partyIndex = null
        await userPokemon.save(getSessionOptions(session))
    }

    return rewardSnapshot
}

const bidLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            ok: false,
            message: 'Bạn trả giá quá nhanh. Hãy chờ vài giây rồi thử lại.',
        })
    },
})

const buildStatusMatch = (status = 'all') => {
    const normalized = String(status || 'all').trim().toLowerCase()
    if (normalized === 'active') return { status: AUCTION_STATUS.ACTIVE }
    if (normalized === 'scheduled') return { status: AUCTION_STATUS.SCHEDULED }
    if (normalized === 'completed') return { status: { $in: [AUCTION_STATUS.COMPLETED, AUCTION_STATUS.SETTLEMENT_FAILED, AUCTION_STATUS.CANCELLED] } }
    return {}
}

const serializeAuctionWithUsers = (auctionLike = {}, options = {}) => {
    const base = serializeAuction(auctionLike, options)
    const highestBidder = auctionLike?.highestBidderId && typeof auctionLike.highestBidderId === 'object'
        ? {
            id: String(auctionLike.highestBidderId?._id || '').trim(),
            username: String(auctionLike.highestBidderId?.username || 'Người chơi').trim() || 'Người chơi',
        }
        : null
    const winner = auctionLike?.winnerId && typeof auctionLike.winnerId === 'object'
        ? {
            id: String(auctionLike.winnerId?._id || '').trim(),
            username: String(auctionLike.winnerId?.username || 'Người chơi').trim() || 'Người chơi',
        }
        : null

    return {
        ...base,
        highestBidder,
        winner,
    }
}

router.use(authMiddleware)

// GET /api/auctions/me/escrowed-pokemon
router.get('/me/escrowed-pokemon', async (req, res) => {
    try {
        await releaseCompletedNoBidEscrowAuctionsForUser(req.user.userId)

        const rows = await UserPokemon.find({
            userId: req.user.userId,
            status: 'active',
            location: 'auction',
        })
            .populate('pokemonId', 'name pokedexNumber imageUrl sprite sprites shinyImageUrl defaultFormId forms')
            .sort({ updatedAt: -1, _id: -1 })
            .lean()

        return res.json({
            ok: true,
            pokemon: rows.map((entry) => serializeOwnedPokemonLookupRow(entry)),
        })
    } catch (error) {
        console.error('GET /api/auctions/me/escrowed-pokemon error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách Pokémon đang được giữ cho đấu giá' })
    }
})

// GET /api/auctions/manage/lookup/pokemon
router.get('/manage/lookup/pokemon', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = Math.min(48, toSafeLimit(req.query.limit))
        const skip = (page - 1) * limit
        const search = String(req.query.search || '').trim()
        const query = {
            userId,
            status: 'active',
            location: { $in: ['box', 'party'] },
        }

        if (search) {
            const regex = new RegExp(escapeRegExp(search), 'i')
            const speciesRows = await Pokemon.find({ nameLower: { $regex: escapeRegExp(search.toLowerCase()), $options: 'i' } })
                .select('_id')
                .limit(200)
                .lean()
            const speciesIds = speciesRows.map((entry) => entry._id)
            query.$or = [
                { nickname: { $regex: regex } },
                ...(speciesIds.length > 0 ? [{ pokemonId: { $in: speciesIds } }] : []),
            ]
        }

        const [rows, total] = await Promise.all([
            UserPokemon.find(query)
                .populate('pokemonId', 'name pokedexNumber imageUrl sprite sprites shinyImageUrl defaultFormId forms')
                .sort({ updatedAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            UserPokemon.countDocuments(query),
        ])

        return res.json({
            ok: true,
            pokemon: rows.map((entry) => serializeOwnedPokemonLookupRow(entry)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/manage/lookup/pokemon error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải Pokémon của bạn để tạo đấu giá' })
    }
})

// GET /api/auctions/manage
router.get('/manage', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return
        await activateDueAuctions()
        await releaseCompletedNoBidEscrowAuctionsForUser(req.user.userId)

        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const query = buildManagedAuctionQuery(req.user.userId, req.query)

        const [rows, total] = await Promise.all([
            Auction.find(query)
                .populate('highestBidderId', 'username')
                .populate('winnerId', 'username')
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Auction.countDocuments(query),
        ])

        const participantCountMap = await loadParticipantCountMap(rows.map((entry) => entry?._id).filter(Boolean))

        return res.json({
            ok: true,
            auctions: rows.map((entry) => ({
                ...serializeAuctionWithUsers(entry, { currentUserId: req.user.userId }),
                participantCount: Math.max(0, Number(participantCountMap.get(String(entry?._id || '').trim()) || 0)),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/manage error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách đấu giá của bạn' })
    }
})

// GET /api/auctions/manage/:id
router.get('/manage/:id', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const [auction, participantAgg] = await Promise.all([
            loadManagedAuction(auctionId, req.user.userId).lean(),
            AuctionBid.aggregate([
                { $match: { auctionId: new mongoose.Types.ObjectId(auctionId) } },
                { $group: { _id: '$auctionId', participantIds: { $addToSet: '$userId' } } },
            ]),
        ])

        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá của bạn' })
        }

        return res.json({
            ok: true,
            auction: {
                ...serializeAuctionWithUsers(auction, { currentUserId: req.user.userId }),
                participantCount: Array.isArray(participantAgg?.[0]?.participantIds) ? participantAgg[0].participantIds.length : 0,
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/manage/:id error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải chi tiết đấu giá của bạn' })
    }
})

// POST /api/auctions/manage
router.post('/manage', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const title = String(req.body?.title || '').trim()
        const description = String(req.body?.description || '').trim()
        const rewardUserPokemonId = String(req.body?.rewardUserPokemonId || '').trim()
        const startingBid = Math.max(1, Number.parseInt(req.body?.startingBid, 10) || 0)
        const minIncrement = Math.max(1, Number.parseInt(req.body?.minIncrement, 10) || 0)
        const startsAt = parseRequiredDate(req.body?.startsAt, 'startsAt')
        const endsAt = parseRequiredDate(req.body?.endsAt, 'endsAt')
        const antiSnipingEnabled = req.body?.antiSnipingEnabled !== false
        const antiSnipingWindowSeconds = Math.max(0, Number.parseInt(req.body?.antiSnipingWindowSeconds, 10) || 300)
        const antiSnipingExtendSeconds = Math.max(0, Number.parseInt(req.body?.antiSnipingExtendSeconds, 10) || 300)
        const antiSnipingMaxExtensions = Math.max(0, Number.parseInt(req.body?.antiSnipingMaxExtensions, 10) || 12)

        if (!title) {
            return res.status(400).json({ ok: false, message: 'Vui lòng nhập tiêu đề đấu giá' })
        }
        if (!mongoose.Types.ObjectId.isValid(rewardUserPokemonId)) {
            return res.status(400).json({ ok: false, message: 'rewardUserPokemonId không hợp lệ' })
        }
        if (endsAt.getTime() <= startsAt.getTime()) {
            return res.status(400).json({ ok: false, message: 'Thoi gian ket thuc phai sau thoi gian bat dau' })
        }

        let auctionId = null
        await runWithOptionalTransaction(async (session) => {
            const rewardSnapshot = await reserveUserPokemonForAuction({
                userPokemonId: rewardUserPokemonId,
                userId: req.user.userId,
                session,
            })

            const auction = await Auction.create([{
                code: buildAuctionCode(),
                title,
                description,
                rewardType: AUCTION_REWARD_TYPE_POKEMON,
                rewardSnapshot,
                currency: 'white_platinum',
                startingBid,
                minIncrement,
                startsAt,
                endsAt,
                antiSnipingEnabled,
                antiSnipingWindowSeconds,
                antiSnipingExtendSeconds,
                antiSnipingMaxExtensions,
                status: AUCTION_STATUS.DRAFT,
                settlementStatus: AUCTION_SETTLEMENT_STATUS.PENDING,
                createdBy: req.user.userId,
                updatedBy: req.user.userId,
            }], getSessionOptions(session))

            auctionId = auction[0]?._id
        })

        const auction = await loadManagedAuction(auctionId, req.user.userId).lean()
        return res.status(201).json({
            ok: true,
            message: 'Tạo phiên đấu giá thành công',
            auction: serializeAuctionWithUsers(auction, { currentUserId: req.user.userId }),
        })
    } catch (error) {
        console.error('POST /api/auctions/manage error:', error)
        return res.status(500).json({ ok: false, message: error?.message || 'Tạo phiên đấu giá thất bại' })
    }
})

// PUT /api/auctions/manage/:id
router.put('/manage/:id', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const title = String(req.body?.title || '').trim()
        const description = String(req.body?.description || '').trim()
        const startingBid = Math.max(1, Number.parseInt(req.body?.startingBid, 10) || 1)
        const minIncrement = Math.max(1, Number.parseInt(req.body?.minIncrement, 10) || 1)
        const startsAt = parseRequiredDate(req.body?.startsAt, 'startsAt')
        const endsAt = parseRequiredDate(req.body?.endsAt, 'endsAt')
        const antiSnipingEnabled = req.body?.antiSnipingEnabled !== false
        const antiSnipingWindowSeconds = Math.max(0, Number.parseInt(req.body?.antiSnipingWindowSeconds, 10) || 300)
        const antiSnipingExtendSeconds = Math.max(0, Number.parseInt(req.body?.antiSnipingExtendSeconds, 10) || 300)
        const antiSnipingMaxExtensions = Math.max(0, Number.parseInt(req.body?.antiSnipingMaxExtensions, 10) || 12)
        const rewardUserPokemonId = String(req.body?.rewardUserPokemonId || '').trim()

        if (!title) {
            return res.status(400).json({ ok: false, message: 'Vui lòng nhập tiêu đề đấu giá' })
        }
        if (!mongoose.Types.ObjectId.isValid(rewardUserPokemonId)) {
            return res.status(400).json({ ok: false, message: 'rewardUserPokemonId không hợp lệ' })
        }
        if (endsAt.getTime() <= startsAt.getTime()) {
            return res.status(400).json({ ok: false, message: 'Thoi gian ket thuc phai sau thoi gian bat dau' })
        }

        await runWithOptionalTransaction(async (session) => {
            const auction = await attachSession(loadManagedAuction(auctionId, req.user.userId), session)
            if (!auction) {
                throw new Error('Không tìm thấy phiên đấu giá của bạn')
            }
            if (auction.status !== AUCTION_STATUS.DRAFT) {
                throw new Error('Chỉ được chỉnh sửa phiên đấu giá ở trạng thái nháp')
            }

            const currentEscrowUserPokemonId = String(auction?.rewardSnapshot?.metadata?.sourceUserPokemonId || '').trim()
            if (currentEscrowUserPokemonId && currentEscrowUserPokemonId !== rewardUserPokemonId && isUserPokemonEscrowRewardSnapshot(auction.rewardSnapshot)) {
                await restoreEscrowedAuctionPokemon(auction, { session })
            }

            const rewardSnapshot = await reserveUserPokemonForAuction({
                userPokemonId: rewardUserPokemonId,
                userId: req.user.userId,
                session,
                allowAuctionLocation: rewardUserPokemonId === currentEscrowUserPokemonId,
            })

            auction.title = title
            auction.description = description
            auction.rewardType = AUCTION_REWARD_TYPE_POKEMON
            auction.rewardSnapshot = rewardSnapshot
            auction.startingBid = startingBid
            auction.minIncrement = minIncrement
            auction.startsAt = startsAt
            auction.endsAt = endsAt
            auction.antiSnipingEnabled = antiSnipingEnabled
            auction.antiSnipingWindowSeconds = antiSnipingWindowSeconds
            auction.antiSnipingExtendSeconds = antiSnipingExtendSeconds
            auction.antiSnipingMaxExtensions = antiSnipingMaxExtensions
            auction.updatedBy = req.user.userId
            await auction.save(getSessionOptions(session))
        })

        const auction = await loadManagedAuction(auctionId, req.user.userId).lean()
        return res.json({ ok: true, message: 'Cập nhật phiên đấu giá thành công', auction: serializeAuctionWithUsers(auction, { currentUserId: req.user.userId }) })
    } catch (error) {
        console.error('PUT /api/auctions/manage/:id error:', error)
        return res.status(500).json({ ok: false, message: error?.message || 'Cập nhật phiên đấu giá thất bại' })
    }
})

// POST /api/auctions/manage/:id/publish
router.post('/manage/:id/publish', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const auctionId = String(req.params.id || '').trim()
        const auction = await loadManagedAuction(auctionId, req.user.userId)
        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá của bạn' })
        }
        if (auction.status !== AUCTION_STATUS.DRAFT) {
            return res.status(400).json({ ok: false, message: 'Chỉ có thể xuất bản phiên đấu giá nháp' })
        }

        const now = Date.now()
        auction.status = new Date(auction.startsAt).getTime() <= now && new Date(auction.endsAt).getTime() > now
            ? AUCTION_STATUS.ACTIVE
            : AUCTION_STATUS.SCHEDULED
        auction.updatedBy = req.user.userId
        auction.settlementStatus = AUCTION_SETTLEMENT_STATUS.PENDING
        await auction.save()

        return res.json({ ok: true, message: 'Đã xuất bản phiên đấu giá', auction: serializeAuctionWithUsers(auction.toObject(), { currentUserId: req.user.userId }) })
    } catch (error) {
        console.error('POST /api/auctions/manage/:id/publish error:', error)
        return res.status(500).json({ ok: false, message: 'Xuất bản phiên đấu giá thất bại' })
    }
})

// POST /api/auctions/manage/:id/cancel
router.post('/manage/:id/cancel', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const auctionId = String(req.params.id || '').trim()
        const cancelReason = String(req.body?.cancelReason || '').trim().slice(0, 500)

        await runWithOptionalTransaction(async (session) => {
            const auction = await attachSession(loadManagedAuction(auctionId, req.user.userId), session)
            if (!auction) {
                throw new Error('Không tìm thấy phiên đấu giá của bạn')
            }
            if ([AUCTION_STATUS.COMPLETED, AUCTION_STATUS.CANCELLED].includes(auction.status)) {
                throw new Error('Không thể hủy phiên đấu giá đã hoàn tất hoặc đã hủy')
            }

            await restoreEscrowedAuctionPokemon(auction, { session })

            auction.status = AUCTION_STATUS.CANCELLED
            auction.cancelledBy = req.user.userId
            auction.cancelReason = cancelReason
            auction.updatedBy = req.user.userId
            auction.settlementStatus = auction.settlementStatus === AUCTION_SETTLEMENT_STATUS.PROCESSING
                ? AUCTION_SETTLEMENT_STATUS.FAILED
                : auction.settlementStatus
            await auction.save(getSessionOptions(session))
        })

        const auction = await loadManagedAuction(auctionId, req.user.userId).lean()
        return res.json({ ok: true, message: 'Đã hủy phiên đấu giá', auction: serializeAuctionWithUsers(auction, { currentUserId: req.user.userId }) })
    } catch (error) {
        console.error('POST /api/auctions/manage/:id/cancel error:', error)
        return res.status(500).json({ ok: false, message: error?.message || 'Hủy phiên đấu giá thất bại' })
    }
})

// GET /api/auctions/manage/:id/bids
router.get('/manage/:id/bids', async (req, res) => {
    try {
        if (!ensureVipAuctionCreator(req, res)) return

        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const ownedAuction = await Auction.findOne({ _id: auctionId, createdBy: req.user.userId }).select('_id').lean()
        if (!ownedAuction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá của bạn' })
        }

        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const [rows, total] = await Promise.all([
            AuctionBid.find({ auctionId })
                .populate('userId', 'username')
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuctionBid.countDocuments({ auctionId }),
        ])

        return res.json({
            ok: true,
            bids: rows.map((entry) => serializeAuctionBid(entry)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/manage/:id/bids error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải lịch sử đấu giá của bạn' })
    }
})

// GET /api/auctions
router.get('/', async (req, res) => {
    try {
        await activateDueAuctions()

        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const status = String(req.query.status || 'all').trim().toLowerCase()
        const search = String(req.query.search || '').trim()
        const playerState = await PlayerState.findOne({ userId }).select('gold').lean()

        if (status === 'participated') {
            const aggregateRows = await AuctionBid.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                { $sort: { createdAt: -1, _id: -1 } },
                { $group: { _id: '$auctionId', lastBidAt: { $first: '$createdAt' } } },
                {
                    $lookup: {
                        from: 'auctions',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'auction',
                    },
                },
                { $unwind: '$auction' },
                ...(search ? [{
                    $match: {
                        $or: [
                            { 'auction.title': { $regex: escapeRegExp(search), $options: 'i' } },
                            { 'auction.code': { $regex: escapeRegExp(search), $options: 'i' } },
                        ],
                    },
                }] : []),
                {
                    $facet: {
                        rows: [
                            { $sort: { lastBidAt: -1, _id: -1 } },
                            { $skip: skip },
                            { $limit: limit },
                        ],
                        total: [{ $count: 'count' }],
                    },
                },
            ])

            const result = aggregateRows?.[0] || {}
            const auctionIds = (result.rows || []).map((entry) => entry?.auction?._id).filter(Boolean)
            const auctions = auctionIds.length > 0
                ? await Auction.find({ _id: { $in: auctionIds } })
                    .populate('highestBidderId', 'username')
                    .populate('winnerId', 'username')
                    .lean()
                : []
            const auctionMap = new Map(auctions.map((entry) => [String(entry?._id || '').trim(), entry]))

            return res.json({
                ok: true,
                wallet: {
                    platinumCoins: Math.max(0, Number(playerState?.gold || 0)),
                },
                auctions: auctionIds
                    .map((auctionId) => auctionMap.get(String(auctionId || '').trim()))
                    .filter(Boolean)
                    .map((entry) => serializeAuctionWithUsers(entry, { currentUserId: userId })),
                pagination: {
                    page,
                    limit,
                    total: result?.total?.[0]?.count || 0,
                    totalPages: Math.max(1, Math.ceil((result?.total?.[0]?.count || 0) / limit)),
                },
            })
        }

        const query = {
            ...buildStatusMatch(status),
        }
        if (search) {
            query.$or = [
                { title: { $regex: escapeRegExp(search), $options: 'i' } },
                { code: { $regex: escapeRegExp(search), $options: 'i' } },
            ]
        }

        const [rows, total] = await Promise.all([
            Auction.find(query)
                .populate('highestBidderId', 'username')
                .populate('winnerId', 'username')
                .sort(status === 'completed' ? { settledAt: -1, _id: -1 } : { endsAt: 1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Auction.countDocuments(query),
        ])

        const auctionIds = rows.map((entry) => entry?._id).filter(Boolean)
        const participants = auctionIds.length > 0
            ? await AuctionBid.aggregate([
                { $match: { auctionId: { $in: auctionIds } } },
                { $group: { _id: '$auctionId', participantIds: { $addToSet: '$userId' } } },
            ])
            : []
        const participantCountMap = new Map(
            participants.map((entry) => [String(entry?._id || '').trim(), Array.isArray(entry?.participantIds) ? entry.participantIds.length : 0])
        )

        return res.json({
            ok: true,
            wallet: {
                platinumCoins: Math.max(0, Number(playerState?.gold || 0)),
            },
            auctions: rows.map((entry) => ({
                ...serializeAuctionWithUsers(entry, { currentUserId: userId }),
                participantCount: Math.max(0, Number(participantCountMap.get(String(entry?._id || '').trim()) || 0)),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách đấu giá' })
    }
})

// GET /api/auctions/me/participated
router.get('/me/participated', async (req, res) => {
    try {
        await activateDueAuctions()

        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const search = String(req.query.search || '').trim()

        const aggregateRows = await AuctionBid.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            { $sort: { createdAt: -1, _id: -1 } },
            { $group: { _id: '$auctionId', lastBidAt: { $first: '$createdAt' } } },
            {
                $lookup: {
                    from: 'auctions',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'auction',
                },
            },
            { $unwind: '$auction' },
            ...(search ? [{
                $match: {
                    $or: [
                        { 'auction.title': { $regex: escapeRegExp(search), $options: 'i' } },
                        { 'auction.code': { $regex: escapeRegExp(search), $options: 'i' } },
                    ],
                },
            }] : []),
            {
                $facet: {
                    rows: [
                        { $sort: { lastBidAt: -1, _id: -1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ],
                    total: [{ $count: 'count' }],
                },
            },
        ])

        const result = aggregateRows?.[0] || {}
        const auctionIds = (result.rows || []).map((entry) => entry?.auction?._id).filter(Boolean)
        const auctions = auctionIds.length > 0
            ? await Auction.find({ _id: { $in: auctionIds } })
                .populate('highestBidderId', 'username')
                .populate('winnerId', 'username')
                .lean()
            : []
        const auctionMap = new Map(auctions.map((entry) => [String(entry?._id || '').trim(), entry]))

        return res.json({
            ok: true,
            auctions: auctionIds
                .map((auctionId) => auctionMap.get(String(auctionId || '').trim()))
                .filter(Boolean)
                .map((entry) => serializeAuctionWithUsers(entry, { currentUserId: userId })),
            pagination: {
                page,
                limit,
                total: result?.total?.[0]?.count || 0,
                totalPages: Math.max(1, Math.ceil((result?.total?.[0]?.count || 0) / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/me/participated error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách phiên bạn đã tham gia' })
    }
})

// GET /api/auctions/:id/bids
router.get('/:id/bids', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const [rows, total] = await Promise.all([
            AuctionBid.find({ auctionId })
                .populate('userId', 'username')
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuctionBid.countDocuments({ auctionId }),
        ])

        return res.json({
            ok: true,
            bids: rows.map((entry) => serializeAuctionBid(entry)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/auctions/:id/bids error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải lịch sử đấu giá' })
    }
})

// GET /api/auctions/:id
router.get('/:id', async (req, res) => {
    try {
        await activateDueAuctions()

        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const userId = req.user.userId
        const [auction, myBidAgg, myLatestBid, bidRows] = await Promise.all([
            Auction.findById(auctionId)
                .populate('highestBidderId', 'username')
                .populate('winnerId', 'username')
                .lean(),
            AuctionBid.aggregate([
                { $match: { auctionId: new mongoose.Types.ObjectId(auctionId), userId: new mongoose.Types.ObjectId(userId) } },
                { $group: { _id: '$auctionId', highestAmount: { $max: '$amount' } } },
            ]),
            AuctionBid.findOne({ auctionId, userId })
                .sort({ createdAt: -1, _id: -1 })
                .lean(),
            AuctionBid.find({ auctionId })
                .populate('userId', 'username')
                .sort({ createdAt: -1, _id: -1 })
                .limit(20)
                .lean(),
        ])

        const participantAgg = await AuctionBid.aggregate([
            { $match: { auctionId: new mongoose.Types.ObjectId(auctionId) } },
            { $group: { _id: '$auctionId', participantIds: { $addToSet: '$userId' } } },
        ])

        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá' })
        }

        const serialized = serializeAuctionWithUsers(auction, { currentUserId: userId })
        const myHighestBid = Math.max(0, Number(myBidAgg?.[0]?.highestAmount || 0))
        const canBid = serialized.status === AUCTION_STATUS.ACTIVE && new Date(serialized.endsAt || 0).getTime() > Date.now()

        return res.json({
            ok: true,
            auction: {
                ...serialized,
                participantCount: Array.isArray(participantAgg?.[0]?.participantIds) ? participantAgg[0].participantIds.length : 0,
            },
            minNextBid: computeAuctionMinNextBid(auction),
            myHighestBid,
            myLatestBid: myLatestBid ? Math.max(0, Number(myLatestBid.amount || 0)) : 0,
            isLeading: String(auction?.highestBidderId?._id || auction?.highestBidderId || '').trim() === String(userId || '').trim(),
            canBid,
            serverTime: new Date(),
            bidHistoryPreview: bidRows.map((entry) => serializeAuctionBid(entry)),
        })
    } catch (error) {
        console.error('GET /api/auctions/:id error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải chi tiết đấu giá' })
    }
})

// POST /api/auctions/:id/bid
router.post('/:id/bid', bidLimiter, async (req, res) => {
    try {
        await activateDueAuctions()

        const auctionId = String(req.params.id || '').trim()
        const amount = Math.max(1, Number.parseInt(req.body?.amount, 10) || 0)

        const result = await placeAuctionBid({
            auctionId,
            userId: req.user.userId,
            amount,
        })

        return res.json({
            ok: true,
            message: 'Đặt giá thành công',
            auction: serializeAuction(result.auction, { currentUserId: req.user.userId }),
            bid: serializeAuctionBid(result.bid),
            antiSnipingExtended: Boolean(result?.antiSnipingExtended),
        })
    } catch (error) {
        return res.status(400).json({
            ok: false,
            message: String(error?.message || 'Đặt giá thất bại'),
        })
    }
})

export default router
