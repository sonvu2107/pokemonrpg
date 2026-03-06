import express from 'express'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcrypt'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import { authMiddleware } from '../middleware/auth.js'
import { getEffectiveAdminPermissions } from '../constants/adminPermissions.js'
import { extractClientIp } from '../utils/ipUtils.js'

const router = express.Router()
const RECOVERY_PIN_REGEX = /^\d{6}$/
const REGISTRATION_IP_WINDOW_MS = 24 * 60 * 60 * 1000

const createRateLimitHandler = (code, fallbackMessage, fallbackWindowMs) => (req, res) => {
    const resetTimeMs = req.rateLimit?.resetTime
        ? new Date(req.rateLimit.resetTime).getTime()
        : (Date.now() + fallbackWindowMs)
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000))

    res.setHeader('Retry-After', String(retryAfterSeconds))
    res.status(429).json({
        ok: false,
        code,
        retryAfterSeconds,
        message: fallbackMessage,
    })
}

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler('REGISTER_RATE_LIMIT', 'Bạn đăng ký quá nhanh. Vui lòng thử lại sau ít phút.', 15 * 60 * 1000),
})

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler('FORGOT_PASSWORD_RATE_LIMIT', 'Bạn yêu cầu khôi phục mật khẩu quá nhanh. Vui lòng thử lại sau ít phút.', 15 * 60 * 1000),
})

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler('RESET_PASSWORD_RATE_LIMIT', 'Bạn thử đặt lại mật khẩu quá nhiều lần. Vui lòng thử lại sau ít phút.', 15 * 60 * 1000),
})

const normalizeRecoveryPin = (value) => String(value || '').trim()

const isValidRecoveryPin = (pin) => RECOVERY_PIN_REGEX.test(pin)

const hashRecoveryPin = async (pin) => bcrypt.hash(pin, 10)

const compareRecoveryPin = async (pin, pinHash) => {
    const normalizedHash = String(pinHash || '')
    if (!normalizedHash) return false
    return bcrypt.compare(pin, normalizedHash)
}

const serializePlayerState = (playerStateLike = null) => {
    const playerState = playerStateLike?.toObject ? playerStateLike.toObject() : (playerStateLike || {})
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        hp: Number(playerState?.hp || 100),
        maxHp: Number(playerState?.maxHp || 100),
        platinumCoins,
        clicks: Number(playerState?.clicks || 0),
        level: Math.max(1, Number(playerState?.level) || 1),
        experience: Number(playerState?.experience || 0),
        stamina: Number(playerState?.stamina || 100),
        maxStamina: Number(playerState?.maxStamina || 100),
        moonPoints: Number(playerState?.moonPoints || 0),
        wins: Number(playerState?.wins || 0),
        losses: Number(playerState?.losses || 0),
    }
}

const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(source?.avatarFrameUrl || '').trim(),
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

const serializeAuthUser = (userLike) => {
    if (!userLike) return null
    const adminPermissions = getEffectiveAdminPermissions(userLike)

    return {
        id: userLike._id,
        email: userLike.email,
        username: userLike.username,
        lastLoginIp: userLike.lastLoginIp || '',
        avatar: userLike.avatar,
        signature: userLike.signature,
        isOnline: userLike.isOnline,
        lastActive: userLike.lastActive,
        role: userLike.role,
        vipTierId: userLike?.vipTierId ? String(userLike.vipTierId) : null,
        vipTierLevel: Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0),
        vipTierCode: String(userLike?.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: normalizeVipBenefits(userLike.vipBenefits),
        hasRecoveryPin: Boolean(userLike.recoveryPinHash || userLike.recoveryPinUpdatedAt),
        recoveryPinUpdatedAt: userLike.recoveryPinUpdatedAt || null,
        adminPermissions,
        completedBattleTrainers: userLike.completedBattleTrainers || [],
        isBanned: Boolean(userLike.isBanned),
        banReason: userLike.banReason || '',
        bannedUntil: userLike.bannedUntil || null,
        createdAt: userLike.createdAt,
    }
}

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res, next) => {
    try {
        const { email, username, password, recoveryPin } = req.body
        const normalizedEmail = String(email || '').trim().toLowerCase()
        const normalizedUsername = String(username || '').trim()
        const normalizedRecoveryPin = normalizeRecoveryPin(recoveryPin)
        const loginIp = extractClientIp(req)

        // Validate input
        if (!normalizedEmail || !password || !normalizedRecoveryPin) {
            return res.status(400).json({
                ok: false,
                message: 'Email, mật khẩu và mã PIN khôi phục là bắt buộc',
            })
        }

        if (password.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu phải có ít nhất 6 ký tự',
            })
        }

        if (!isValidRecoveryPin(normalizedRecoveryPin)) {
            return res.status(400).json({
                ok: false,
                message: 'Mã PIN khôi phục phải gồm đúng 6 chữ số',
            })
        }

        const recoveryPinHash = await hashRecoveryPin(normalizedRecoveryPin)

        // Check if user already exists
        const existingUser = await User.findOne({ email: normalizedEmail })
        if (existingUser) {
            return res.status(409).json({
                ok: false,
                message: 'Người dùng đã tồn tại',
            })
        }

        if (loginIp) {
            const nowMs = Date.now()
            const windowStart = new Date(nowMs - REGISTRATION_IP_WINDOW_MS)
            const recentRegistration = await User.findOne({
                registrationIp: loginIp,
                createdAt: { $gte: windowStart },
            })
                .select('createdAt')
                .sort({ createdAt: -1 })
                .lean()

            if (recentRegistration?.createdAt) {
                const nextAllowedAtMs = new Date(recentRegistration.createdAt).getTime() + REGISTRATION_IP_WINDOW_MS
                const retryAfterSeconds = Math.max(1, Math.ceil((nextAllowedAtMs - nowMs) / 1000))
                res.setHeader('Retry-After', String(retryAfterSeconds))
                return res.status(429).json({
                    ok: false,
                    code: 'REGISTER_DAILY_IP_LIMIT',
                    retryAfterSeconds,
                    message: 'Mỗi địa chỉ IP chỉ được tạo tối đa 1 tài khoản trong 24 giờ.',
                })
            }
        }

        // Create user with username (password will be hashed by pre-save hook)
        const user = await User.create({
            email: normalizedEmail,
            username: normalizedUsername || normalizedEmail.split('@')[0], // fallback to email prefix
            password,
            recoveryPinHash,
            recoveryPinUpdatedAt: new Date(),
            lastLoginIp: loginIp,
            registrationIp: loginIp,
        })

        // Create initial player state
        await PlayerState.create({ userId: user._id })

        // Generate JWT with role
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role, adminPermissions: getEffectiveAdminPermissions(user) },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        )

        res.status(201).json({
            ok: true,
            token,
            user: serializeAuthUser(user),
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body
        const normalizedEmail = String(email || '').trim().toLowerCase()
        const loginIp = extractClientIp(req)

        // Validate input
        if (!normalizedEmail || !password) {
            return res.status(400).json({
                ok: false,
                message: 'Email và mật khẩu là bắt buộc',
            })
        }

        // Find user
        const user = await User.findOne({ email: normalizedEmail })
        if (!user) {
            return res.status(401).json({
                ok: false,
                message: 'Thông tin đăng nhập không hợp lệ',
            })
        }

        const now = Date.now()
        const banUntilMs = user.bannedUntil ? new Date(user.bannedUntil).getTime() : null
        const isBanExpired = Boolean(banUntilMs) && banUntilMs <= now
        if (user.isBanned && isBanExpired) {
            user.isBanned = false
            user.banReason = ''
            user.bannedAt = null
            user.bannedUntil = null
            user.bannedBy = null
            await user.save()
        }

        if (user.isBanned) {
            return res.status(403).json({
                ok: false,
                code: 'ACCOUNT_BANNED',
                message: user.banReason || 'Tài khoản của bạn đã bị khóa.',
                bannedUntil: user.bannedUntil,
            })
        }

        // Compare password
        const isMatch = await user.comparePassword(password)
        if (!isMatch) {
            return res.status(401).json({
                ok: false,
                message: 'Thông tin đăng nhập không hợp lệ',
            })
        }

        // Set user as online
        user.isOnline = true
        user.lastActive = new Date()
        user.lastLoginIp = loginIp
        await user.save()

        // Generate JWT with role
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role, adminPermissions: getEffectiveAdminPermissions(user) },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        )

        res.json({
            ok: true,
            token,
            user: serializeAuthUser(user),
        })
    } catch (error) {
        next(error)
    }
})

// PUT /api/auth/change-password (protected)
router.put('/change-password', authMiddleware, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body || {}
        const normalizedCurrentPassword = String(currentPassword || '')
        const normalizedNewPassword = String(newPassword || '')

        if (!normalizedCurrentPassword || !normalizedNewPassword) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu hiện tại và mật khẩu mới là bắt buộc',
            })
        }

        if (normalizedNewPassword.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu mới phải có ít nhất 6 ký tự',
            })
        }

        if (normalizedCurrentPassword === normalizedNewPassword) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
            })
        }

        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const isMatch = await user.comparePassword(normalizedCurrentPassword)
        if (!isMatch) {
            return res.status(401).json({
                ok: false,
                message: 'Mật khẩu hiện tại không chính xác',
            })
        }

        user.password = normalizedNewPassword
        user.passwordChangedAt = new Date()
        await user.save()

        res.json({
            ok: true,
            message: 'Đổi mật khẩu thành công',
        })
    } catch (error) {
        next(error)
    }
})

// PUT /api/auth/recovery-pin (protected)
router.put('/recovery-pin', authMiddleware, async (req, res, next) => {
    try {
        const currentPassword = String(req.body?.currentPassword || '')
        const recoveryPin = normalizeRecoveryPin(req.body?.recoveryPin)

        if (!currentPassword || !recoveryPin) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu hiện tại và mã PIN khôi phục là bắt buộc',
            })
        }

        if (!isValidRecoveryPin(recoveryPin)) {
            return res.status(400).json({
                ok: false,
                message: 'Mã PIN khôi phục phải gồm đúng 6 chữ số',
            })
        }

        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const isPasswordValid = await user.comparePassword(currentPassword)
        if (!isPasswordValid) {
            return res.status(401).json({
                ok: false,
                message: 'Mật khẩu hiện tại không chính xác',
            })
        }

        user.recoveryPinHash = await hashRecoveryPin(recoveryPin)
        user.recoveryPinUpdatedAt = new Date()
        await user.save()

        res.json({
            ok: true,
            message: 'Cập nhật mã PIN khôi phục thành công',
        })
    } catch (error) {
        next(error)
    }
})

const resetPasswordWithRecoveryPin = async (req, res, next) => {
    try {
        const normalizedEmail = String(req.body?.email || '').trim().toLowerCase()
        const recoveryPin = normalizeRecoveryPin(req.body?.recoveryPin)
        const newPassword = String(req.body?.newPassword || '')

        if (!normalizedEmail || !recoveryPin || !newPassword) {
            return res.status(400).json({
                ok: false,
                message: 'Email, mã PIN khôi phục và mật khẩu mới là bắt buộc',
            })
        }

        if (!isValidRecoveryPin(recoveryPin)) {
            return res.status(400).json({
                ok: false,
                message: 'Mã PIN khôi phục phải gồm đúng 6 chữ số',
            })
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                ok: false,
                message: 'Mật khẩu mới phải có ít nhất 6 ký tự',
            })
        }

        const user = await User.findOne({ email: normalizedEmail })
        if (!user) {
            return res.status(400).json({
                ok: false,
                message: 'Thông tin khôi phục không hợp lệ',
            })
        }

        const isPinValid = await compareRecoveryPin(recoveryPin, user.recoveryPinHash)
        if (!isPinValid) {
            return res.status(400).json({
                ok: false,
                message: 'Thông tin khôi phục không hợp lệ',
            })
        }

        user.password = newPassword
        user.passwordChangedAt = new Date()
        await user.save()

        res.json({
            ok: true,
            message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập lại.',
        })
    } catch (error) {
        next(error)
    }
}

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, resetPasswordWithRecoveryPin)

// POST /api/auth/reset-password
router.post('/reset-password', resetPasswordLimiter, resetPasswordWithRecoveryPin)

// POST /api/auth/logout (protected)
router.post('/logout', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        user.isOnline = false
        user.lastActive = new Date()
        await user.save()

        res.json({
            ok: true,
            message: 'Đăng xuất thành công',
        })
    } catch (error) {
        next(error)
    }
})

// GET /api/auth/me (protected)
router.get('/me', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId).select('-password -recoveryPinHash')
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const playerState = await PlayerState.findOne({ userId: user._id })

        res.json({
            ok: true,
            user: serializeAuthUser(user),
            playerState: serializePlayerState(playerState),
        })
    } catch (error) {
        next(error)
    }
})

// POST /api/auth/complete-trainer (protected)
router.post('/complete-trainer', authMiddleware, async (req, res, next) => {
    try {
        const trainerId = String(req.body?.trainerId || '').trim()
        if (!trainerId) {
            return res.status(400).json({
                ok: false,
                message: 'trainerId là bắt buộc',
            })
        }

        const user = await User.findByIdAndUpdate(
            req.user.userId,
            { $addToSet: { completedBattleTrainers: trainerId } },
            { new: true }
        ).select('_id completedBattleTrainers')

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        res.json({
            ok: true,
            completedBattleTrainers: user.completedBattleTrainers || [],
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
                message: 'Tên người dùng không được để trống',
            })
        }

        // Find user
        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        // Update fields
        if (username !== undefined) user.username = username
        if (avatar !== undefined) user.avatar = avatar
        if (signature !== undefined) user.signature = signature

        await user.save()

        res.json({
            ok: true,
            message: 'Cập nhật hồ sơ thành công',
            user: serializeAuthUser(user),
        })
    } catch (error) {
        next(error)
    }
})

export default router
