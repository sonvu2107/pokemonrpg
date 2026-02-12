import express from 'express'
import User from '../../models/User.js'
import {
    ADMIN_PERMISSIONS,
    ALL_ADMIN_PERMISSIONS,
    getEffectiveAdminPermissions,
    hasAdminPermission,
    normalizeAdminPermissions,
} from '../../constants/adminPermissions.js'

const router = express.Router()

const buildUserResponse = (user) => {
    const raw = user?.toObject ? user.toObject() : user
    return {
        ...raw,
        adminPermissions: getEffectiveAdminPermissions(raw),
    }
}

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

        const normalizedUsers = users.map((user) => buildUserResponse(user))

        res.json({
            ok: true,
            users: normalizedUsers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
            permissions: ALL_ADMIN_PERMISSIONS,
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
        if (role === 'admin' && (!Array.isArray(user.adminPermissions) || user.adminPermissions.length === 0)) {
            user.adminPermissions = [...ALL_ADMIN_PERMISSIONS]
        }
        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: `User role updated to ${role}`
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/role error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/users/:id/permissions - Update admin module permissions
router.put('/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params
        const { permissions } = req.body

        const normalizedPermissions = normalizeAdminPermissions(permissions)
        if (normalizedPermissions === null) {
            return res.status(400).json({
                ok: false,
                message: 'Invalid permissions. Expected an array of permission keys.',
            })
        }

        const user = await User.findById(id)
        if (!user) {
            return res.status(404).json({ ok: false, message: 'User not found' })
        }

        if (user.role !== 'admin') {
            return res.status(400).json({
                ok: false,
                message: 'Only admin users can have admin permissions',
            })
        }

        const currentlyHasUsersPermission = hasAdminPermission(user, ADMIN_PERMISSIONS.USERS)
        const willHaveUsersPermission = normalizedPermissions.includes(ADMIN_PERMISSIONS.USERS)

        if (currentlyHasUsersPermission && !willHaveUsersPermission) {
            const otherAdmins = await User.find({
                role: 'admin',
                _id: { $ne: user._id },
            })
                .select('role adminPermissions')
                .lean()

            const hasOtherUserManager = otherAdmins.some((admin) =>
                hasAdminPermission(admin, ADMIN_PERMISSIONS.USERS)
            )

            if (!hasOtherUserManager) {
                return res.status(400).json({
                    ok: false,
                    message: 'Cannot remove "users" permission from the last admin who can manage users.',
                })
            }
        }

        user.adminPermissions = normalizedPermissions
        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: 'Admin permissions updated successfully',
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/permissions error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

export default router
