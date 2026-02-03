import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.js'
import gameRoutes from './routes/game.js'
import mapsRoutes from './routes/maps.js'
import newsRoutes from './routes/news.js'
import pokemonAdminRoutes from './routes/admin/pokemon.js'
import mapsAdminRoutes from './routes/admin/maps.js'
import dropRatesAdminRoutes from './routes/admin/dropRates.js'
import userAdminRoutes from './routes/admin/user.js'
import { authMiddleware, requireAdmin } from './middleware/auth.js'
import { errorHandler, notFound } from './utils/errorHandler.js'
import boxRoutes from './routes/box.js'

const app = express()

// Security middleware
app.use(helmet())

// CORS configuration
app.use(
    cors({
        origin: process.env.CLIENT_URL || 'http://localhost:5173',
        credentials: true,
    })
)

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
})
app.use('/api/', limiter)

// Admin rate limiting (stricter)
const adminLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per admin
    message: 'Too many admin requests, please slow down.',
})

// Body parsing middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ ok: true, message: 'Server is running' })
})

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/game', gameRoutes)
app.use('/api/maps', mapsRoutes)
app.use('/api/news', newsRoutes)
app.use('/api/box', boxRoutes)

// Admin routes (protected with auth + requireAdmin + stricter rate limit)
app.use('/api/admin/pokemon', adminLimiter, authMiddleware, requireAdmin, pokemonAdminRoutes)
app.use('/api/admin/maps', adminLimiter, authMiddleware, requireAdmin, mapsAdminRoutes)
app.use('/api/admin/drop-rates', adminLimiter, authMiddleware, requireAdmin, dropRatesAdminRoutes)
app.use('/api/admin/users', adminLimiter, authMiddleware, requireAdmin, userAdminRoutes)

// Error handlers
app.use(notFound)
app.use(errorHandler)

export default app
