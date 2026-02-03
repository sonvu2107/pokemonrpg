import express from 'express'
import User from '../../models/User.js'

const router = express.Router()

// GET /api/admin/users - List all users with pagination and search
router.get('/', async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query

        const query = {}

        // Search by email or username
        if (search) {
            query.$or = [
                { email: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ]
        }

        const skip = (parseInt(page) - 1) * parseInt(limit)

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password') // Exclude password field
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            User.countDocuments(query),
        ])

        res.json({
            ok: true,
            users,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/users error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// PUT /api/admin/users/:id/role - Update user role
router.put('/:id/role', async (req, res) => {
    try {
        const { id } = req.params
        const { role } = req.body

        // Validation
        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ ok: false, message: 'Invalid role. Must be "user" or "admin"' })
        }

        const user = await User.findById(id)

        if (!user) {
            return res.status(404).json({ ok: false, message: 'User not found' })
        }

        // Prevent removing the last admin
        if (user.role === 'admin' && role === 'user') {
            const adminCount = await User.countDocuments({ role: 'admin' })
            if (adminCount <= 1) {
                return res.status(400).json({
                    ok: false,
                    message: 'Cannot remove the last admin. Please assign another admin first.'
                })
            }
        }

        user.role = role
        await user.save()

        res.json({
            ok: true,
            user: {
                _id: user._id,
                email: user.email,
                username: user.username,
                role: user.role
            },
            message: `User role updated to ${role}`
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/role error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

export default router
