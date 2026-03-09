import express from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import { authMiddleware } from '../middleware/auth.js'
import Auction from '../models/Auction.js'
import AuctionBid from '../models/AuctionBid.js'
import PlayerState from '../models/PlayerState.js'
import { activateDueAuctions, AUCTION_STATUS, computeAuctionMinNextBid, placeAuctionBid, serializeAuction, serializeAuctionBid } from '../services/auctionService.js'

const router = express.Router()

const toSafePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(50, Math.max(1, Number.parseInt(value, 10) || 20))
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
