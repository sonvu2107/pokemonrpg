import express from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import { authMiddleware } from '../middleware/auth.js'
import { getEffectiveAdminPermissions } from '../constants/adminPermissions.js'

const router = express.Router()

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
    try {
        const { email, username, password } = req.body

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                message: 'Email and password are required',
            })
        }

        if (password.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'Password must be at least 6 characters',
            })
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email })
        if (existingUser) {
            return res.status(409).json({
                ok: false,
                message: 'User already exists',
            })
        }

        // Create user with username (password will be hashed by pre-save hook)
        const user = await User.create({
            email,
            username: username || email.split('@')[0], // fallback to email prefix
            password
        })

        // Create initial player state
        await PlayerState.create({ userId: user._id })

        // Generate JWT with role
        const adminPermissions = getEffectiveAdminPermissions(user)
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role, adminPermissions },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        )

        res.status(201).json({
            ok: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                role: user.role,
                adminPermissions,
            },
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                ok: false,
                message: 'Email and password are required',
            })
        }

        // Find user
        const user = await User.findOne({ email })
        if (!user) {
            return res.status(401).json({
                ok: false,
                message: 'Invalid credentials',
            })
        }

        // Compare password
        const isMatch = await user.comparePassword(password)
        if (!isMatch) {
            return res.status(401).json({
                ok: false,
                message: 'Invalid credentials',
            })
        }

        // Set user as online
        user.isOnline = true
        user.lastActive = new Date()
        await user.save()

        // Generate JWT with role
        const adminPermissions = getEffectiveAdminPermissions(user)
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role, adminPermissions },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        )

        res.json({
            ok: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                role: user.role,
                adminPermissions,
            },
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/auth/logout (protected)
router.post('/logout', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'User not found',
            })
        }

        user.isOnline = false
        user.lastActive = new Date()
        await user.save()

        res.json({
            ok: true,
            message: 'Logout successful',
        })
    } catch (error) {
        next(error)
    }
})

// GET /api/auth/me (protected)
router.get('/me', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId).select('-password')
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'User not found',
            })
        }

        const playerState = await PlayerState.findOne({ userId: user._id })

        res.json({
            ok: true,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                avatar: user.avatar,
                signature: user.signature,
                role: user.role,
                adminPermissions: getEffectiveAdminPermissions(user),
                createdAt: user.createdAt,
            },
            playerState: playerState || {
                hp: 100, maxHp: 100, gold: 0, clicks: 0,
                level: 1, experience: 0, stamina: 100, maxStamina: 100,
                moonPoints: 0, wins: 0, losses: 0
            },
        })
    } catch (error) {
        next(error)
    }
})

// PUT /api/auth/profile (protected)
router.put('/profile', authMiddleware, async (req, res, next) => {
    try {
        const { username, avatar, signature } = req.body

        // Validate username if provided
        if (username && username.trim().length === 0) {
            return res.status(400).json({
                ok: false,
                message: 'Username cannot be empty',
            })
        }

        // Find user
        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'User not found',
            })
        }

        // Update fields
        if (username !== undefined) user.username = username
        if (avatar !== undefined) user.avatar = avatar
        if (signature !== undefined) user.signature = signature

        await user.save()

        res.json({
            ok: true,
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                avatar: user.avatar,
                signature: user.signature,
                role: user.role,
                adminPermissions: getEffectiveAdminPermissions(user),
                createdAt: user.createdAt,
            },
        })
    } catch (error) {
        next(error)
    }
})

export default router
