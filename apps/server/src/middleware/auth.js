import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { hasAdminPermission } from '../constants/adminPermissions.js'

export const authMiddleware = async (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                ok: false,
                message: 'No token provided',
            })
        }

        const token = authHeader.split(' ')[1]

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET)

        // Attach user info to request
        req.user = decoded
        next()
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                ok: false,
                message: 'Invalid token',
            })
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                ok: false,
                message: 'Token expired',
            })
        }
        return res.status(500).json({
            ok: false,
            message: 'Authentication error',
        })
    }
}

export const requireAdmin = (req, res, next) => {
    return requireAdminFromDb(req, res, next)
}

const requireAdminFromDb = async (req, res, next) => {
    try {
        if (!req.user?.userId) {
            return res.status(403).json({
                ok: false,
                errorCode: 'FORBIDDEN',
                message: 'Admin access required',
            })
        }

        const dbUser = await User.findById(req.user.userId)
            .select('role adminPermissions')
            .lean()

        if (!dbUser || dbUser.role !== 'admin') {
            return res.status(403).json({
                ok: false,
                errorCode: 'FORBIDDEN',
                message: 'Admin access required',
            })
        }

        req.user.role = dbUser.role
        req.user.adminPermissions = dbUser.adminPermissions
        req.adminUser = dbUser
        next()
    } catch (error) {
        return res.status(500).json({
            ok: false,
            message: 'Failed to verify admin access',
        })
    }
}

export const requireAdminPermission = (permission) => async (req, res, next) => {
    try {
        if (!req.adminUser) {
            return requireAdminFromDb(req, res, async () => {
                if (!hasAdminPermission(req.adminUser, permission)) {
                    return res.status(403).json({
                        ok: false,
                        errorCode: 'ADMIN_PERMISSION_DENIED',
                        message: 'You do not have permission to access this admin module',
                        requiredPermission: permission,
                    })
                }
                next()
            })
        }

        if (!hasAdminPermission(req.adminUser, permission)) {
            return res.status(403).json({
                ok: false,
                errorCode: 'ADMIN_PERMISSION_DENIED',
                message: 'You do not have permission to access this admin module',
                requiredPermission: permission,
            })
        }

        next()
    } catch (error) {
        return res.status(500).json({
            ok: false,
            message: 'Failed to verify admin permission',
        })
    }
}
