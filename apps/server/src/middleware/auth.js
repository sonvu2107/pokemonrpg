import jwt from 'jsonwebtoken'

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
    // req.user should contain { userId, role } from decoded JWT
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            ok: false,
            errorCode: 'FORBIDDEN',
            message: 'Admin access required'
        })
    }
    next()
}
