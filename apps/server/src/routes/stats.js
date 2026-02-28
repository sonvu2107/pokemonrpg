import express from 'express'
import User from '../models/User.js'
import DailyActivity from '../models/DailyActivity.js'
import PlayerState from '../models/PlayerState.js'
import { authMiddleware } from '../middleware/auth.js'

const router = express.Router()

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const parseDateKey = (value = '') => {
    const raw = String(value || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
    const [y, m, d] = raw.split('-').map(Number)
    const parsed = new Date(y, m - 1, d)
    parsed.setHours(0, 0, 0, 0)
    if (Number.isNaN(parsed.getTime())) return null
    if (toDailyDateKey(parsed) !== raw) return null
    return parsed
}

const buildDateKeys = ({ days = 31, endDate = new Date() }) => {
    const safeDays = Math.min(60, Math.max(1, Number.parseInt(days, 10) || 31))
    const end = new Date(endDate)
    end.setHours(0, 0, 0, 0)

    return Array.from({ length: safeDays }, (_, index) => {
        const date = new Date(end)
        date.setDate(end.getDate() - index)
        return toDailyDateKey(date)
    })
}

const toSafePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 35))

const formatPlayTime = (createdAt, nowDate = new Date()) => {
    const created = new Date(createdAt)
    const now = new Date(nowDate)
    if (Number.isNaN(created.getTime()) || Number.isNaN(now.getTime())) {
        return '0 ngày 0 giờ'
    }

    const diffMs = Math.max(0, now.getTime() - created.getTime())
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24
    return `${days} ngày ${hours} giờ`
}

// GET /api/stats - Public endpoint for server statistics
router.get('/', async (req, res) => {
    try {
        // Count total users in database
        const totalUsers = await User.countDocuments()

        // Count users currently online
        const onlineUsers = await User.countDocuments({ isOnline: true })

        res.json({
            ok: true,
            totalUsers,
            onlineUsers,
        })
    } catch (error) {
        console.error('GET /api/stats error:', error)
        res.status(500).json({
            ok: false,
            message: 'Failed to fetch server statistics'
        })
    }
})

// GET /api/stats/daily - Authenticated daily stats for current user
router.get('/daily', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const days = req.query.days
        const endDate = parseDateKey(req.query.endDate) || new Date()
        const dateKeys = buildDateKeys({ days, endDate })

        const [user, playerState, activities] = await Promise.all([
            User.findById(userId).select('username').lean(),
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            DailyActivity.find({
                userId,
                date: { $in: dateKeys },
            })
                .select('date searches mapExp moonPoints battles levels battleMoonPoints platinumCoins mines shards diamondCoins trainerExp mapStats')
                .lean(),
        ])

        const activityMap = new Map(
            (activities || []).map((entry) => [
                String(entry.date),
                {
                    searches: Number(entry.searches || 0),
                    mapExp: Number(entry.mapExp || 0),
                    moonPoints: Number(entry.moonPoints || 0),
                    battles: Number(entry.battles || 0),
                    levels: Number(entry.levels || 0),
                    battleMoonPoints: Number(entry.battleMoonPoints || 0),
                    platinumCoins: Number(entry.platinumCoins || 0),
                    mines: Number(entry.mines || 0),
                    shards: Number(entry.shards || 0),
                    diamondCoins: Number(entry.diamondCoins || 0),
                    trainerExp: Number(entry.trainerExp || 0),
                    mapStats: Array.isArray(entry.mapStats) ? entry.mapStats : [],
                },
            ])
        )

        const stats = dateKeys.map((date) => {
            const daily = activityMap.get(date) || {
                searches: 0,
                mapExp: 0,
                moonPoints: 0,
                battles: 0,
                levels: 0,
                battleMoonPoints: 0,
                platinumCoins: 0,
                mines: 0,
                shards: 0,
                diamondCoins: 0,
                trainerExp: 0,
                mapStats: [],
            }

            const mapStats = Array.isArray(daily.mapStats) ? daily.mapStats : []
            const sortedMapStats = [...mapStats].sort((a, b) => {
                const aScore = Number(a?.searches || 0) * 1000000 + Number(a?.mapExp || 0)
                const bScore = Number(b?.searches || 0) * 1000000 + Number(b?.mapExp || 0)
                return bScore - aScore
            })
            const mapSummary = mapStats.reduce((acc, row) => {
                acc.searches += Number(row?.searches || 0)
                acc.mapExp += Number(row?.mapExp || 0)
                acc.moonPoints += Number(row?.moonPoints || 0)
                return acc
            }, { searches: 0, mapExp: 0, moonPoints: 0 })

            if (mapStats.length === 0) {
                mapSummary.searches = Number(daily.searches || 0)
                mapSummary.mapExp = Number(daily.mapExp || 0)
                mapSummary.moonPoints = Number(daily.moonPoints || 0)
            }

            const mapName = sortedMapStats.length === 0
                ? '-'
                : sortedMapStats.length === 1
                    ? (String(sortedMapStats[0]?.mapName || '').trim() || '-')
                    : `${String(sortedMapStats[0]?.mapName || '').trim() || 'Nhiều bản đồ'} (+${sortedMapStats.length - 1})`

            const hasData = (
                mapSummary.searches > 0 ||
                mapSummary.mapExp > 0 ||
                mapSummary.moonPoints > 0 ||
                daily.battles > 0 ||
                daily.levels > 0 ||
                daily.battleMoonPoints > 0 ||
                daily.platinumCoins > 0 ||
                daily.mines > 0 ||
                daily.shards > 0 ||
                daily.diamondCoins > 0 ||
                daily.trainerExp > 0
            )

            return {
                date,
                hasData,
                mapName,
                searches: mapSummary.searches,
                mapMoonPoints: mapSummary.moonPoints,
                mapExp: mapSummary.mapExp,
                battles: daily.battles,
                levels: daily.levels,
                battleMoonPoints: daily.battleMoonPoints,
                platinumCoins: daily.platinumCoins,
                mines: daily.mines,
                shards: daily.shards,
                diamondCoins: daily.diamondCoins,
                trainerExp: daily.trainerExp,
            }
        })

        res.json({
            ok: true,
            user: {
                id: user?._id || userId,
                username: user?.username || 'Huấn Luyện Viên',
            },
            wallet: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
            stats,
        })
    } catch (error) {
        console.error('GET /api/stats/daily error:', error)
        res.status(500).json({
            ok: false,
            message: 'Failed to fetch daily stats'
        })
    }
})

// GET /api/stats/online - Online trainers list
router.get('/online', authMiddleware, async (req, res) => {
    try {
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const [totalOnline, users] = await Promise.all([
            User.countDocuments({ isOnline: true }),
            User.find({ isOnline: true })
                .select('username createdAt')
                .sort({ createdAt: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ])

        const now = new Date()
        const onlineTrainers = users.map((entry, index) => ({
            rank: skip + index + 1,
            userIdLabel: `#${skip + index + 1}`,
            username: String(entry?.username || '').trim() || 'Huấn Luyện Viên',
            playTime: formatPlayTime(entry?.createdAt, now),
        }))

        res.json({
            ok: true,
            onlineCount: totalOnline,
            onlineTrainers,
            pagination: {
                page,
                limit,
                total: totalOnline,
                totalPages: Math.max(1, Math.ceil(totalOnline / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/stats/online error:', error)
        res.status(500).json({
            ok: false,
            message: 'Failed to fetch online trainers'
        })
    }
})

export default router
