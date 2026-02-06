import express from 'express'
import User from '../models/User.js'

const router = express.Router()

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

export default router
