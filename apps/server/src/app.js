import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.js'
import gameRoutes from './routes/game.js'
import mapsRoutes from './routes/maps.js'
import newsRoutes from './routes/news.js'
import statsRoutes from './routes/stats.js'
import rankingsRoutes from './routes/rankings.js'
import pokemonAdminRoutes from './routes/admin/pokemon.js'
import mapsAdminRoutes from './routes/admin/maps.js'
import dropRatesAdminRoutes from './routes/admin/dropRates.js'
import itemAdminRoutes from './routes/admin/items.js'
import moveAdminRoutes from './routes/admin/moves.js'
import itemDropRatesAdminRoutes from './routes/admin/itemDropRates.js'
import userAdminRoutes from './routes/admin/user.js'
import battleTrainersAdminRoutes from './routes/admin/battleTrainers.js'
import battleTrainersRoutes from './routes/battleTrainers.js'
import dailyCheckinRoutes from './routes/dailyCheckin.js'
import dailyRewardsAdminRoutes from './routes/admin/dailyRewards.js'
import promoCodesAdminRoutes from './routes/admin/promoCodes.js'
import leaderboardRewardsAdminRoutes from './routes/admin/leaderboardRewards.js'
import auctionsAdminRoutes from './routes/admin/auctions.js'
import messagesRoutes from './routes/messages.js'
import promoCodeRoutes from './routes/promoCodes.js'
import friendsRoutes from './routes/friends.js'
import valleyRoutes from './routes/valley.js'
import { authMiddleware, requireAdmin, requireAdminPermission } from './middleware/auth.js'
import { apiLogger } from './middleware/apiLogger.js'
import { ADMIN_PERMISSIONS } from './constants/adminPermissions.js'
import { errorHandler, notFound } from './utils/errorHandler.js'
import boxRoutes from './routes/box.js'
import pokemonRoutes from './routes/pokemon.js'
import partyRoutes from './routes/party.js'
import inventoryRoutes from './routes/inventory.js'
import shopRoutes from './routes/shop.js'
import auctionsRoutes from './routes/auctions.js'
import IpBan from './models/IpBan.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractClientIp } from './utils/ipUtils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Trust proxy headers only when explicitly enabled (e.g. behind Cloudflare/Nginx)
app.set('trust proxy', String(process.env.TRUST_PROXY || '').trim().toLowerCase() === 'true')

// Security middleware
app.use(helmet())
app.use(compression())

// CORS configuration — supports multiple origins via comma-separated CLIENT_URL
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

app.use(
    cors({
        origin: function (origin, callback) {
            // Allow requests with no origin (mobile apps, curl, server-to-server)
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true)
            } else {
                callback(new Error('Not allowed by CORS'))
            }
        },
        credentials: true,
    })
)

// Rate limiting
app.use('/api/', async (req, res, next) => {
    try {
        const clientIp = extractClientIp(req)
        if (!clientIp) return next()

        const ipBan = await IpBan.findOne({ ip: clientIp, isActive: true })
            .select('reason expiresAt')
            .lean()

        if (!ipBan) return next()

        const expiresAt = ipBan.expiresAt ? new Date(ipBan.expiresAt) : null
        if (expiresAt && expiresAt.getTime() <= Date.now()) {
            await IpBan.updateOne(
                { ip: clientIp, isActive: true },
                {
                    $set: {
                        isActive: false,
                        liftedAt: new Date(),
                        liftedBy: null,
                    },
                }
            )
            return next()
        }

        return res.status(403).json({
            ok: false,
            code: 'IP_BANNED',
            message: ipBan.reason || 'IP của bạn đã bị chặn truy cập hệ thống.',
        })
    } catch (error) {
        console.error('IP ban middleware error:', error)
        return next()
    }
})

// Rate limiting
const limiter = rateLimit({
    windowMs: 30 * 1000, // 30 seconds
    max: 1000, // limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    // Return JSON instead of plain text
    handler: (req, res) => {
        const resetTimeMs = req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() : (Date.now() + 30 * 1000)
        const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000))
        res.setHeader('Retry-After', String(retryAfterSeconds))
        res.status(429).json({
            ok: false,
            code: 'GLOBAL_RATE_LIMIT',
            retryAfterSeconds,
            message: 'Giáo sư Oak: Bạn thao tác hơi nhanh. Hãy nghỉ một chút rồi tiếp tục hành trình.',
        })
    },
    // Skip rate limiting for certain public endpoints
    skip: (req) => {
        const internalWorkerHeader = String(req.headers['x-internal-worker'] || '').trim().toLowerCase()
        if (internalWorkerHeader.startsWith('auto-')) {
            return true
        }
        const path = req.path
        return path === '/stats' || path === '/stats/' ||
            path === '/game/maps' || path === '/game/maps/'
    },
})
app.use('/api/', limiter)

// Admin rate limiting (stricter)
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute per admin
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            ok: false,
            message: 'Too many admin requests, please slow down.',
        })
    },
})

// Body parsing middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// API request logging middleware
app.use(apiLogger)

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')))

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ ok: true, message: 'Server is running' })
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/game', gameRoutes)
app.use('/api/maps', mapsRoutes)
app.use('/api/news', newsRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/rankings', rankingsRoutes)
app.use('/api/box', boxRoutes)
app.use('/api/pokemon', pokemonRoutes)
app.use('/api/party', partyRoutes)
app.use('/api/battle-trainers', battleTrainersRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/shop', shopRoutes)
app.use('/api/auctions', auctionsRoutes)
app.use('/api/daily-checkin', dailyCheckinRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/promo-codes', promoCodeRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/valley', valleyRoutes)

// Admin routes (protected with auth + requireAdmin + stricter rate limit)
app.use('/api/admin/pokemon', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.POKEMON), pokemonAdminRoutes)
app.use('/api/admin/maps', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.MAPS), mapsAdminRoutes)
app.use('/api/admin/drop-rates', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.MAPS), dropRatesAdminRoutes)
app.use('/api/admin/items', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.ITEMS), itemAdminRoutes)
app.use('/api/admin/moves', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.MOVES), moveAdminRoutes)
app.use('/api/admin/item-drop-rates', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.MAPS), itemDropRatesAdminRoutes)
app.use('/api/admin/users', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.USERS), userAdminRoutes)
app.use('/api/admin/battle-trainers', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.BATTLE), battleTrainersAdminRoutes)
app.use('/api/admin/daily-rewards', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.REWARDS), dailyRewardsAdminRoutes)
app.use('/api/admin/promo-codes', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.CODES), promoCodesAdminRoutes)
app.use('/api/admin/leaderboard-rewards', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.REWARDS), leaderboardRewardsAdminRoutes)
app.use('/api/admin/auctions', adminLimiter, authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.AUCTIONS), auctionsAdminRoutes)

// Error handlers
app.use(notFound)
app.use(errorHandler)

export default app
