import express from 'express'
import mongoose from 'mongoose'
import Auction from '../../models/Auction.js'
import AuctionBid from '../../models/AuctionBid.js'
import Item from '../../models/Item.js'
import Pokemon from '../../models/Pokemon.js'
import { activateDueAuctions, AUCTION_REWARD_TYPE_POKEMON, AUCTION_SETTLEMENT_STATUS, AUCTION_STATUS, buildAuctionCode, buildItemRewardSnapshot, buildPokemonRewardSnapshot, serializeAuction, serializeAuctionBid, settleAuctionById } from '../../services/auctionService.js'

const router = express.Router()

const toSafePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 20))
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseRequiredDate = (value, label) => {
    const nextDate = new Date(value)
    if (Number.isNaN(nextDate.getTime())) {
        throw new Error(`${label} không hợp lệ`)
    }
    return nextDate
}

const serializeAdminAuction = (auctionLike = {}) => {
    const base = serializeAuction(auctionLike)
    return {
        ...base,
        highestBidder: auctionLike?.highestBidderId && typeof auctionLike.highestBidderId === 'object'
            ? {
                id: String(auctionLike.highestBidderId?._id || '').trim(),
                username: String(auctionLike.highestBidderId?.username || 'Người chơi').trim() || 'Người chơi',
            }
            : null,
        winner: auctionLike?.winnerId && typeof auctionLike.winnerId === 'object'
            ? {
                id: String(auctionLike.winnerId?._id || '').trim(),
                username: String(auctionLike.winnerId?.username || 'Người chơi').trim() || 'Người chơi',
            }
            : null,
    }
}

// GET /api/admin/auctions
router.get('/', async (req, res) => {
    try {
        await activateDueAuctions()

        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const status = String(req.query.status || 'all').trim().toLowerCase()
        const search = String(req.query.search || '').trim()

        const query = {}
        if ([AUCTION_STATUS.DRAFT, AUCTION_STATUS.SCHEDULED, AUCTION_STATUS.ACTIVE, AUCTION_STATUS.COMPLETED, AUCTION_STATUS.CANCELLED, AUCTION_STATUS.SETTLEMENT_FAILED].includes(status)) {
            query.status = status
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
                .sort({ createdAt: -1, _id: -1 })
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
            auctions: rows.map((entry) => ({
                ...serializeAdminAuction(entry),
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
        console.error('GET /api/admin/auctions error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải danh sách đấu giá admin' })
    }
})

// GET /api/admin/auctions/:id
router.get('/:id', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const [auction, participantAgg] = await Promise.all([
            Auction.findById(auctionId)
                .populate('highestBidderId', 'username')
                .populate('winnerId', 'username')
                .lean(),
            AuctionBid.aggregate([
                { $match: { auctionId: new mongoose.Types.ObjectId(auctionId) } },
                { $group: { _id: '$auctionId', participantIds: { $addToSet: '$userId' } } },
            ]),
        ])

        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá' })
        }

        return res.json({
            ok: true,
            auction: {
                ...serializeAdminAuction(auction),
                participantCount: Array.isArray(participantAgg?.[0]?.participantIds) ? participantAgg[0].participantIds.length : 0,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/auctions/:id error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải chi tiết đấu giá' })
    }
})

// POST /api/admin/auctions
router.post('/', async (req, res) => {
    try {
        const title = String(req.body?.title || '').trim()
        const description = String(req.body?.description || '').trim()
        const rewardType = String(req.body?.rewardType || 'item').trim().toLowerCase() === AUCTION_REWARD_TYPE_POKEMON ? AUCTION_REWARD_TYPE_POKEMON : 'item'
        const rewardItemId = String(req.body?.rewardItemId || '').trim()
        const rewardPokemonId = String(req.body?.rewardPokemonId || '').trim()
        const rewardPokemonFormId = String(req.body?.rewardPokemonFormId || 'normal').trim().toLowerCase() || 'normal'
        const rewardPokemonLevel = Math.max(1, Number.parseInt(req.body?.rewardPokemonLevel, 10) || 5)
        const rewardPokemonIsShiny = Boolean(req.body?.rewardPokemonIsShiny)
        const rewardPokemonImageUrl = String(req.body?.rewardPokemonImageUrl || '').trim()
        const rewardPokemonName = String(req.body?.rewardPokemonName || '').trim()
        const rewardQuantity = Math.max(1, Number.parseInt(req.body?.rewardQuantity, 10) || 1)
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
        if (rewardType === 'item' && !mongoose.Types.ObjectId.isValid(rewardItemId)) {
            return res.status(400).json({ ok: false, message: 'rewardItemId không hợp lệ' })
        }
        if (rewardType === AUCTION_REWARD_TYPE_POKEMON && !mongoose.Types.ObjectId.isValid(rewardPokemonId)) {
            return res.status(400).json({ ok: false, message: 'rewardPokemonId không hợp lệ' })
        }
        if (endsAt.getTime() <= startsAt.getTime()) {
            return res.status(400).json({ ok: false, message: 'Thời gian kết thúc phải sau thời gian bắt đầu' })
        }

        let rewardSnapshot = null
        if (rewardType === 'item') {
            const item = await Item.findById(rewardItemId)
                .select('name imageUrl rarity type effectType')
                .lean()
            if (!item) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm phần thưởng' })
            }
            rewardSnapshot = buildItemRewardSnapshot(item, rewardQuantity)
        } else {
            const pokemon = await Pokemon.findById(rewardPokemonId)
                .select('name imageUrl sprites defaultFormId forms')
                .lean()
            if (!pokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon phần thưởng' })
            }
            rewardSnapshot = buildPokemonRewardSnapshot(pokemon, {
                quantity: rewardQuantity,
                formId: rewardPokemonFormId,
                level: rewardPokemonLevel,
                isShiny: rewardPokemonIsShiny,
                imageUrl: rewardPokemonImageUrl,
                name: rewardPokemonName,
                formName: rewardPokemonFormId,
            })
        }

        const auction = await Auction.create({
            code: buildAuctionCode(),
            title,
            description,
            rewardType,
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
        })

        return res.status(201).json({
            ok: true,
            message: 'Tạo phiên đấu giá thành công',
            auction: serializeAdminAuction(await Auction.findById(auction._id).lean()),
        })
    } catch (error) {
        console.error('POST /api/admin/auctions error:', error)
        return res.status(500).json({ ok: false, message: error?.message || 'Tạo phiên đấu giá thất bại' })
    }
})

// PUT /api/admin/auctions/:id
router.put('/:id', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const auction = await Auction.findById(auctionId)
        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá' })
        }
        if (auction.status !== AUCTION_STATUS.DRAFT) {
            return res.status(400).json({ ok: false, message: 'Chỉ được chỉnh sửa phiên đấu giá ở trạng thái nháp' })
        }

        const title = String(req.body?.title || auction.title).trim()
        const description = String(req.body?.description || auction.description).trim()
        const rewardType = String(req.body?.rewardType || auction.rewardType || 'item').trim().toLowerCase() === AUCTION_REWARD_TYPE_POKEMON ? AUCTION_REWARD_TYPE_POKEMON : 'item'
        const rewardItemId = String(req.body?.rewardItemId || auction.rewardSnapshot?.itemId || '').trim()
        const rewardPokemonId = String(req.body?.rewardPokemonId || auction.rewardSnapshot?.pokemonId || '').trim()
        const rewardPokemonFormId = String(req.body?.rewardPokemonFormId || auction.rewardSnapshot?.formId || 'normal').trim().toLowerCase() || 'normal'
        const rewardPokemonLevel = Math.max(1, Number.parseInt(req.body?.rewardPokemonLevel, 10) || auction.rewardSnapshot?.level || 5)
        const rewardPokemonIsShiny = req.body?.rewardPokemonIsShiny !== undefined ? Boolean(req.body?.rewardPokemonIsShiny) : Boolean(auction.rewardSnapshot?.isShiny)
        const rewardPokemonImageUrl = String(req.body?.rewardPokemonImageUrl || auction.rewardSnapshot?.imageUrl || '').trim()
        const rewardPokemonName = String(req.body?.rewardPokemonName || auction.rewardSnapshot?.name || '').trim()
        const rewardQuantity = Math.max(1, Number.parseInt(req.body?.rewardQuantity, 10) || auction.rewardSnapshot?.quantity || 1)
        const startingBid = Math.max(1, Number.parseInt(req.body?.startingBid, 10) || auction.startingBid || 1)
        const minIncrement = Math.max(1, Number.parseInt(req.body?.minIncrement, 10) || auction.minIncrement || 1)
        const startsAt = req.body?.startsAt ? parseRequiredDate(req.body?.startsAt, 'startsAt') : new Date(auction.startsAt)
        const endsAt = req.body?.endsAt ? parseRequiredDate(req.body?.endsAt, 'endsAt') : new Date(auction.endsAt)

        if (endsAt.getTime() <= startsAt.getTime()) {
            return res.status(400).json({ ok: false, message: 'Thời gian kết thúc phải sau thời gian bắt đầu' })
        }

        let rewardSnapshot = null
        if (rewardType === 'item') {
            const item = await Item.findById(rewardItemId)
                .select('name imageUrl rarity type effectType')
                .lean()
            if (!item) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm phần thưởng' })
            }
            rewardSnapshot = buildItemRewardSnapshot(item, rewardQuantity)
        } else {
            const pokemon = await Pokemon.findById(rewardPokemonId)
                .select('name imageUrl sprites defaultFormId forms')
                .lean()
            if (!pokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon phần thưởng' })
            }
            rewardSnapshot = buildPokemonRewardSnapshot(pokemon, {
                quantity: rewardQuantity,
                formId: rewardPokemonFormId,
                level: rewardPokemonLevel,
                isShiny: rewardPokemonIsShiny,
                imageUrl: rewardPokemonImageUrl,
                name: rewardPokemonName,
                formName: rewardPokemonFormId,
            })
        }

        auction.title = title
        auction.description = description
        auction.rewardType = rewardType
        auction.rewardSnapshot = rewardSnapshot
        auction.startingBid = startingBid
        auction.minIncrement = minIncrement
        auction.startsAt = startsAt
        auction.endsAt = endsAt
        auction.antiSnipingEnabled = req.body?.antiSnipingEnabled !== undefined ? Boolean(req.body?.antiSnipingEnabled) : auction.antiSnipingEnabled
        auction.antiSnipingWindowSeconds = req.body?.antiSnipingWindowSeconds !== undefined ? Math.max(0, Number.parseInt(req.body?.antiSnipingWindowSeconds, 10) || 0) : auction.antiSnipingWindowSeconds
        auction.antiSnipingExtendSeconds = req.body?.antiSnipingExtendSeconds !== undefined ? Math.max(0, Number.parseInt(req.body?.antiSnipingExtendSeconds, 10) || 0) : auction.antiSnipingExtendSeconds
        auction.antiSnipingMaxExtensions = req.body?.antiSnipingMaxExtensions !== undefined ? Math.max(0, Number.parseInt(req.body?.antiSnipingMaxExtensions, 10) || 0) : auction.antiSnipingMaxExtensions
        auction.updatedBy = req.user.userId
        await auction.save()

        return res.json({ ok: true, message: 'Cập nhật phiên đấu giá thành công', auction: serializeAdminAuction(auction.toObject()) })
    } catch (error) {
        console.error('PUT /api/admin/auctions/:id error:', error)
        return res.status(500).json({ ok: false, message: error?.message || 'Cập nhật phiên đấu giá thất bại' })
    }
})

// POST /api/admin/auctions/:id/publish
router.post('/:id/publish', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        const auction = await Auction.findById(auctionId)
        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá' })
        }
        if (auction.status !== AUCTION_STATUS.DRAFT) {
            return res.status(400).json({ ok: false, message: 'Chỉ có thể publish phiên đấu giá nháp' })
        }

        const now = Date.now()
        auction.status = new Date(auction.startsAt).getTime() <= now && new Date(auction.endsAt).getTime() > now
            ? AUCTION_STATUS.ACTIVE
            : AUCTION_STATUS.SCHEDULED
        auction.updatedBy = req.user.userId
        auction.settlementStatus = AUCTION_SETTLEMENT_STATUS.PENDING
        await auction.save()

        return res.json({ ok: true, message: 'Đã publish phiên đấu giá', auction: serializeAdminAuction(auction.toObject()) })
    } catch (error) {
        console.error('POST /api/admin/auctions/:id/publish error:', error)
        return res.status(500).json({ ok: false, message: 'Publish phiên đấu giá thất bại' })
    }
})

// POST /api/admin/auctions/:id/cancel
router.post('/:id/cancel', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        const cancelReason = String(req.body?.cancelReason || '').trim().slice(0, 500)
        const auction = await Auction.findById(auctionId)
        if (!auction) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên đấu giá' })
        }
        if ([AUCTION_STATUS.COMPLETED, AUCTION_STATUS.CANCELLED].includes(auction.status)) {
            return res.status(400).json({ ok: false, message: 'Không thể hủy phiên đấu giá đã hoàn tất hoặc đã hủy' })
        }

        auction.status = AUCTION_STATUS.CANCELLED
        auction.cancelledBy = req.user.userId
        auction.cancelReason = cancelReason
        auction.updatedBy = req.user.userId
        auction.settlementStatus = auction.settlementStatus === AUCTION_SETTLEMENT_STATUS.PROCESSING
            ? AUCTION_SETTLEMENT_STATUS.FAILED
            : auction.settlementStatus
        await auction.save()

        return res.json({ ok: true, message: 'Đã hủy phiên đấu giá', auction: serializeAdminAuction(auction.toObject()) })
    } catch (error) {
        console.error('POST /api/admin/auctions/:id/cancel error:', error)
        return res.status(500).json({ ok: false, message: 'Hủy phiên đấu giá thất bại' })
    }
})

// POST /api/admin/auctions/:id/settle
router.post('/:id/settle', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const result = await settleAuctionById(auctionId, { source: 'admin_manual' })
        if (result?.skipped) {
            return res.status(400).json({ ok: false, message: 'Phiên đấu giá này chưa sẵn sàng để chốt hoặc đã được xử lý' })
        }

        const auction = await Auction.findById(auctionId)
            .populate('highestBidderId', 'username')
            .populate('winnerId', 'username')
            .lean()

        return res.json({
            ok: true,
            message: result?.status === AUCTION_STATUS.COMPLETED ? 'Đã chốt đấu giá thành công' : 'Đấu giá được đánh dấu settlement_failed',
            auction: serializeAdminAuction(auction),
        })
    } catch (error) {
        console.error('POST /api/admin/auctions/:id/settle error:', error)
        return res.status(500).json({ ok: false, message: 'Chốt phiên đấu giá thất bại' })
    }
})

// GET /api/admin/auctions/:id/bids
router.get('/:id/bids', async (req, res) => {
    try {
        const auctionId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(auctionId)) {
            return res.status(400).json({ ok: false, message: 'auctionId không hợp lệ' })
        }

        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const [bids, total] = await Promise.all([
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
            bids: bids.map((entry) => serializeAuctionBid(entry)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/auctions/:id/bids error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải lịch sử giá đấu admin' })
    }
})

export default router
