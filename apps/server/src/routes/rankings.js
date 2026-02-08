import express from 'express'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'

const router = express.Router()

// GET /api/rankings/overall - Get overall rankings by EXP/Level
router.get('/overall', async (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 35))
        const skip = (page - 1) * limit

        // Get total count for pagination
        const totalUsers = await PlayerState.countDocuments()

        // Fetch rankings sorted by experience DESC
        const playerStates = await PlayerState.find()
            .sort({ experience: -1, level: -1, _id: 1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'username')
            .lean()

        // Build rankings with rank numbers
        const rankings = playerStates.map((state, index) => ({
            rank: skip + index + 1,
            userId: state.userId?._id,
            username: state.userId?.username || 'Unknown',
            experience: state.experience || 0,
            level: state.level || 1,
        }))

        const totalPages = Math.ceil(totalUsers / limit)

        res.json({
            ok: true,
            rankings,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers,
                limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        })
    } catch (error) {
        console.error('GET /api/rankings/overall error:', error)
        next(error)
    }
})

export default router
