import express from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcrypt'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import WeeklyLeaderboardReward from '../models/WeeklyLeaderboardReward.js'
import { authMiddleware } from '../middleware/auth.js'
import { expireVipUsersIfNeeded, resetExpiredVipUser } from '../utils/vipStatus.js'
import { getEffectiveAdminPermissions } from '../constants/adminPermissions.js'
import { BADGE_MAX_EQUIPPED, buildBadgeOverviewForUser, invalidateCachedActiveBadgeBonuses } from '../utils/badgeUtils.js'
import { extractClientIp } from '../utils/ipUtils.js'
import { closeOnlineSession, getTotalOnlineHours, startOnlineSession } from '../utils/onlineTime.js'
import { disconnectUserSockets } from '../socket/index.js'

const router = express.Router()
const RECOVERY_PIN_REGEX = /^\d{6}$/
const REGISTRATION_IP_WINDOW_MS = 24 * 60 * 60 * 1000
const COSMETIC_REWARD_TYPES = Object.freeze(['titleImage', 'avatarFrame'])
const WEEKLY_COSMETIC_DURATION_MS = 7 * 24 * 60 * 60 * 1000

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

const VIP_HEX_COLOR_REGEX = /^#([0-9a-f]{6})$/i

const normalizeVipHexColor = (value = '') => {
    const raw = String(value || '').trim().toUpperCase()
    return VIP_HEX_COLOR_REGEX.test(raw) ? raw : ''
}

const normalizeVipColorList = (value = []) => {
    const list = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,|]+/)

    return [...new Set(list
        .map((entry) => normalizeVipHexColor(entry))
        .filter(Boolean))].slice(0, 8)
}

const normalizeVipUsernameEffect = (value = 'none') => {
    return String(value || '').trim().toLowerCase() === 'animated' ? 'animated' : 'none'
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
        usernameColor: normalizeVipHexColor(source?.usernameColor),
        usernameGradientColor: normalizeVipHexColor(source?.usernameGradientColor),
        usernameEffectColors: normalizeVipColorList(source?.usernameEffectColors),
        usernameEffect: normalizeVipUsernameEffect(source?.usernameEffect),
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)

    return {
        ...current,
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
        usernameColor: current.usernameColor || tier.usernameColor,
        usernameGradientColor: current.usernameGradientColor || tier.usernameGradientColor,
        usernameEffectColors: current.usernameEffectColors.length > 0 ? current.usernameEffectColors : tier.usernameEffectColors,
        usernameEffect: current.usernameEffect !== 'none' ? current.usernameEffect : tier.usernameEffect,
    }
}

const createSessionId = () => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return crypto.randomBytes(16).toString('hex')
}

const rotateUserSession = (userLike) => {
    const sessionId = createSessionId()
    if (userLike && typeof userLike === 'object') {
        userLike.activeSessionId = sessionId
        userLike.activeSessionIssuedAt = new Date()
    }
    return sessionId
}

const signAuthToken = (userLike, sessionId) => jwt.sign(
    {
        userId: userLike._id,
        email: userLike.email,
        role: userLike.role,
        adminPermissions: getEffectiveAdminPermissions(userLike),
        sid: String(sessionId || '').trim(),
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
)

const getRewardGrantedAt = (rewardLike = {}) => {
    const rewardedAt = new Date(rewardLike?.rewardedAt || rewardLike?.createdAt || 0)
    if (Number.isNaN(rewardedAt.getTime())) {
        return null
    }
    return rewardedAt
}

const getRewardExpiresAt = (rewardLike = {}) => {
    const grantedAt = getRewardGrantedAt(rewardLike)
    if (!grantedAt) return null
    return new Date(grantedAt.getTime() + WEEKLY_COSMETIC_DURATION_MS)
}

const isWeeklyCosmeticRewardActive = (rewardLike = {}, nowMs = Date.now()) => {
    const expiresAt = getRewardExpiresAt(rewardLike)
    if (!expiresAt) return false
    return expiresAt.getTime() > nowMs
}

const hasSameVipVisualBenefits = (leftLike = {}, rightLike = {}) => {
    const left = normalizeVipBenefits(leftLike)
    const right = normalizeVipBenefits(rightLike)
    return left.title === right.title
        && left.titleImageUrl === right.titleImageUrl
        && left.avatarFrameUrl === right.avatarFrameUrl
        && left.usernameColor === right.usernameColor
        && left.usernameGradientColor === right.usernameGradientColor
        && JSON.stringify(left.usernameEffectColors) === JSON.stringify(right.usernameEffectColors)
        && left.usernameEffect === right.usernameEffect
        && left.autoSearchEnabled === right.autoSearchEnabled
        && left.autoSearchDurationMinutes === right.autoSearchDurationMinutes
        && left.autoSearchUsesPerDay === right.autoSearchUsesPerDay
        && left.autoBattleTrainerEnabled === right.autoBattleTrainerEnabled
        && left.autoBattleTrainerDurationMinutes === right.autoBattleTrainerDurationMinutes
        && left.autoBattleTrainerUsesPerDay === right.autoBattleTrainerUsesPerDay
}

const sanitizeEquippedProfileCosmetics = (currentBenefitsLike = {}, tierBenefitsLike = {}, activeRewardRows = []) => {
    const currentBenefits = normalizeVipBenefits(currentBenefitsLike)
    const tierBenefits = normalizeVipBenefits(tierBenefitsLike)
    const nextBenefits = {
        ...currentBenefits,
    }

    const activeTitleSet = new Set(
        activeRewardRows
            .filter((row) => String(row?.rewardType || '').trim() === 'titleImage')
            .map((row) => String(row?.rewardTitleImageUrl || '').trim())
            .filter(Boolean)
    )
    const activeFrameSet = new Set(
        activeRewardRows
            .filter((row) => String(row?.rewardType || '').trim() === 'avatarFrame')
            .map((row) => String(row?.rewardAvatarFrameUrl || '').trim())
            .filter(Boolean)
    )

    if (nextBenefits.titleImageUrl && nextBenefits.titleImageUrl !== tierBenefits.titleImageUrl && !activeTitleSet.has(nextBenefits.titleImageUrl)) {
        nextBenefits.titleImageUrl = ''
    }

    if (nextBenefits.avatarFrameUrl && nextBenefits.avatarFrameUrl !== tierBenefits.avatarFrameUrl && !activeFrameSet.has(nextBenefits.avatarFrameUrl)) {
        nextBenefits.avatarFrameUrl = ''
    }

    return nextBenefits
}

const buildOwnedProfileCosmetics = (rewardRows = [], currentBenefitsLike = {}) => {
    const currentBenefits = normalizeVipBenefits(currentBenefitsLike)
    const titleMap = new Map()
    const frameMap = new Map()

    const addCosmetic = ({ type, imageUrl, rewardId, weekStart, mode, rank, rewardedAt }) => {
        const normalizedType = String(type || '').trim()
        const normalizedImageUrl = String(imageUrl || '').trim()
        if (!normalizedImageUrl) return
        const targetMap = normalizedType === 'titleImage' ? titleMap : frameMap
        if (!targetMap.has(normalizedImageUrl)) {
            const expiresAt = rewardedAt ? new Date(new Date(rewardedAt).getTime() + WEEKLY_COSMETIC_DURATION_MS) : null
            targetMap.set(normalizedImageUrl, {
                imageUrl: normalizedImageUrl,
                rewardId: String(rewardId || '').trim(),
                weekStart: String(weekStart || '').trim(),
                mode: String(mode || '').trim(),
                rank: Math.max(0, Number(rank || 0)),
                rewardedAt: rewardedAt || null,
                expiresAt,
            })
        }
    }

    for (const row of (Array.isArray(rewardRows) ? rewardRows : [])) {
        const rewardType = String(row?.rewardType || '').trim()
        if (rewardType === 'titleImage') {
            addCosmetic({
                type: rewardType,
                imageUrl: row?.rewardTitleImageUrl,
                rewardId: row?._id,
                weekStart: row?.weekStart,
                mode: row?.mode,
                rank: row?.rank,
                rewardedAt: row?.rewardedAt || row?.createdAt,
            })
            continue
        }
        if (rewardType === 'avatarFrame') {
            addCosmetic({
                type: rewardType,
                imageUrl: row?.rewardAvatarFrameUrl,
                rewardId: row?._id,
                weekStart: row?.weekStart,
                mode: row?.mode,
                rank: row?.rank,
                rewardedAt: row?.rewardedAt || row?.createdAt,
            })
        }
    }

    addCosmetic({ type: 'titleImage', imageUrl: currentBenefits.titleImageUrl })
    addCosmetic({ type: 'avatarFrame', imageUrl: currentBenefits.avatarFrameUrl })

    const sortByRecent = (a, b) => {
        const aTime = new Date(a?.rewardedAt || 0).getTime()
        const bTime = new Date(b?.rewardedAt || 0).getTime()
        if (aTime !== bTime) return bTime - aTime
        return String(b?.rewardId || '').localeCompare(String(a?.rewardId || ''))
    }

    return {
        titleImages: [...titleMap.values()].sort(sortByRecent),
        avatarFrames: [...frameMap.values()].sort(sortByRecent),
    }
}

const serializeAuthUser = (userLike, vipBenefitsLike = null) => {
    if (!userLike) return null
    const adminPermissions = getEffectiveAdminPermissions(userLike)

    return {
        id: userLike._id,
        email: userLike.email,
        username: userLike.username,
        lastLoginIp: userLike.lastLoginIp || '',
        avatar: userLike.avatar,
        signature: userLike.signature,
        showPartyInProfile: userLike?.showPartyInProfile !== false,
        isOnline: userLike.isOnline,
        lastActive: userLike.lastActive,
        totalOnlineHours: getTotalOnlineHours(userLike),
        role: userLike.role,
        vipTierId: userLike?.vipTierId ? String(userLike.vipTierId) : null,
        vipTierLevel: Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0),
        vipTierCode: String(userLike?.vipTierCode || '').trim().toUpperCase(),
        vipExpiresAt: userLike?.vipExpiresAt || null,
        vipBenefits: normalizeVipBenefits(vipBenefitsLike || userLike.vipBenefits),
        hasRecoveryPin: Boolean(userLike.recoveryPinHash || userLike.recoveryPinUpdatedAt),
        recoveryPinUpdatedAt: userLike.recoveryPinUpdatedAt || null,
        adminPermissions,
        completedBattleTrainers: userLike.completedBattleTrainers || [],
        equippedBadgeIds: Array.isArray(userLike?.equippedBadgeIds)
            ? userLike.equippedBadgeIds.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, BADGE_MAX_EQUIPPED)
            : [],
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
        const sessionId = createSessionId()

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
            activeSessionId: sessionId,
            activeSessionIssuedAt: new Date(),
        })

        // Create initial player state
        await PlayerState.create({ userId: user._id })

        // Generate JWT with role
        const token = signAuthToken(user, sessionId)

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
        await expireVipUsersIfNeeded(User)

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

        await resetExpiredVipUser(user)

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

        // Set user as online and roll playtime session
        startOnlineSession(user, new Date())
        user.lastLoginIp = loginIp
        const sessionId = rotateUserSession(user)
        await user.save()
        disconnectUserSockets(user._id, 'session-replaced')

        // Generate JWT with role
        const token = signAuthToken(user, sessionId)

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

        closeOnlineSession(user, new Date())
        user.activeSessionId = ''
        user.activeSessionIssuedAt = null
        await user.save()
        disconnectUserSockets(user._id, 'logout')

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
        const isLightResponse = String(req.query?.light || '').trim() === '1'
        const user = await User.findById(req.user.userId).select('-password -recoveryPinHash')
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const now = new Date()
        let shouldSaveUser = false
        if (!user.isOnline) {
            startOnlineSession(user, now)
            shouldSaveUser = true
        } else {
            if (!user.onlineSessionStartedAt) {
                user.onlineSessionStartedAt = now
                shouldSaveUser = true
            }

            const lastActiveMs = new Date(user.lastActive || 0).getTime()
            if (!Number.isFinite(lastActiveMs) || (now.getTime() - lastActiveMs) >= 60000) {
                user.lastActive = now
                shouldSaveUser = true
            }
        }

        const playerState = await PlayerState.findOne({ userId: user._id })

        let effectiveVipBenefits = null
        if (!isLightResponse) {
            const [vipTier, rewardRows] = await Promise.all([
                (() => {
                    if (user?.vipTierId) {
                        return VipPrivilegeTier.findById(user.vipTierId).select('benefits').lean()
                    }
                    const vipTierLevel = Math.max(0, Number.parseInt(user?.vipTierLevel, 10) || 0)
                    if (vipTierLevel > 0) {
                        return VipPrivilegeTier.findOne({ level: vipTierLevel }).select('benefits').lean()
                    }
                    return Promise.resolve(null)
                })(),
                WeeklyLeaderboardReward.find({
                    userId: user._id,
                    rewardType: { $in: COSMETIC_REWARD_TYPES },
                })
                    .select('rewardType rewardTitleImageUrl rewardAvatarFrameUrl rewardedAt createdAt')
                    .sort({ rewardedAt: -1, _id: -1 })
                    .lean(),
            ])

            const activeRewardRows = rewardRows.filter((row) => isWeeklyCosmeticRewardActive(row))
            const sanitizedVipBenefits = sanitizeEquippedProfileCosmetics(user?.vipBenefits, vipTier?.benefits, activeRewardRows)

            if (!hasSameVipVisualBenefits(user?.vipBenefits, sanitizedVipBenefits)) {
                user.vipBenefits = {
                    ...user.vipBenefits,
                    ...sanitizedVipBenefits,
                }
                shouldSaveUser = true
            }

            effectiveVipBenefits = mergeVipVisualBenefits(sanitizedVipBenefits, vipTier?.benefits)
        }

        if (shouldSaveUser) {
            await user.save()
        }

        const serializedUser = serializeAuthUser(user, effectiveVipBenefits)
        if (isLightResponse) {
            return res.json({
                ok: true,
                user: serializedUser,
                playerState: serializePlayerState(playerState),
                badges: {
                    equippedBadgeIds: serializedUser?.equippedBadgeIds || [],
                    equippedBadges: [],
                    activeBonuses: {},
                    maxEquipped: BADGE_MAX_EQUIPPED,
                    light: true,
                },
            })
        }

        const badgeOverview = await buildBadgeOverviewForUser(user._id, { userDoc: user.toObject() })

        res.json({
            ok: true,
            user: serializedUser,
            playerState: serializePlayerState(playerState),
            badges: {
                equippedBadgeIds: badgeOverview.equippedBadgeIds,
                equippedBadges: badgeOverview.equippedBadges,
                activeBonuses: badgeOverview.activeBonuses,
                maxEquipped: BADGE_MAX_EQUIPPED,
            },
        })
    } catch (error) {
        next(error)
    }
})

// GET /api/auth/profile-cosmetics (protected)
router.get('/profile-cosmetics', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('vipBenefits vipTierId vipTierLevel')
            .lean()

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const [vipTier, rewardRows] = await Promise.all([
            (() => {
                if (user?.vipTierId) {
                    return VipPrivilegeTier.findById(user.vipTierId).select('benefits').lean()
                }
                const vipTierLevel = Math.max(0, Number.parseInt(user?.vipTierLevel, 10) || 0)
                if (vipTierLevel > 0) {
                    return VipPrivilegeTier.findOne({ level: vipTierLevel }).select('benefits').lean()
                }
                return Promise.resolve(null)
            })(),
            WeeklyLeaderboardReward.find({
                userId: req.user.userId,
                rewardType: { $in: COSMETIC_REWARD_TYPES },
            })
                .select('rewardType rewardTitleImageUrl rewardAvatarFrameUrl weekStart mode rank rewardedAt createdAt')
                .sort({ rewardedAt: -1, _id: -1 })
                .lean(),
        ])

        const activeRewardRows = rewardRows.filter((row) => isWeeklyCosmeticRewardActive(row))
        const sanitizedVipBenefits = sanitizeEquippedProfileCosmetics(user?.vipBenefits, vipTier?.benefits, activeRewardRows)
        const owned = buildOwnedProfileCosmetics(activeRewardRows, mergeVipVisualBenefits(sanitizedVipBenefits, vipTier?.benefits))
        const currentVipBenefits = mergeVipVisualBenefits(sanitizedVipBenefits, vipTier?.benefits)

        res.json({
            ok: true,
            equipped: {
                titleImageUrl: currentVipBenefits.titleImageUrl,
                avatarFrameUrl: currentVipBenefits.avatarFrameUrl,
            },
            owned,
        })
    } catch (error) {
        next(error)
    }
})

// PUT /api/auth/profile-cosmetics (protected)
router.put('/profile-cosmetics', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const incoming = req.body && typeof req.body === 'object' ? req.body : {}
        const canSetTitle = Object.prototype.hasOwnProperty.call(incoming, 'titleImageUrl')
        const canSetFrame = Object.prototype.hasOwnProperty.call(incoming, 'avatarFrameUrl')
        if (!canSetTitle && !canSetFrame) {
            return res.status(400).json({
                ok: false,
                message: 'Không có thay đổi danh hiệu hoặc khung avatar',
            })
        }

        const [vipTier, rewardRows] = await Promise.all([
            (() => {
                if (user?.vipTierId) {
                    return VipPrivilegeTier.findById(user.vipTierId).select('benefits').lean()
                }
                const vipTierLevel = Math.max(0, Number.parseInt(user?.vipTierLevel, 10) || 0)
                if (vipTierLevel > 0) {
                    return VipPrivilegeTier.findOne({ level: vipTierLevel }).select('benefits').lean()
                }
                return Promise.resolve(null)
            })(),
            WeeklyLeaderboardReward.find({
                userId: req.user.userId,
                rewardType: { $in: COSMETIC_REWARD_TYPES },
            })
                .select('rewardType rewardTitleImageUrl rewardAvatarFrameUrl weekStart mode rank rewardedAt createdAt')
                .sort({ rewardedAt: -1, _id: -1 })
                .lean(),
        ])

        const activeRewardRows = rewardRows.filter((row) => isWeeklyCosmeticRewardActive(row))
        const sanitizedVipBenefits = sanitizeEquippedProfileCosmetics(user?.vipBenefits, vipTier?.benefits, activeRewardRows)
        const owned = buildOwnedProfileCosmetics(activeRewardRows, mergeVipVisualBenefits(sanitizedVipBenefits, vipTier?.benefits))
        const ownedTitleSet = new Set(owned.titleImages.map((entry) => String(entry?.imageUrl || '').trim()).filter(Boolean))
        const ownedFrameSet = new Set(owned.avatarFrames.map((entry) => String(entry?.imageUrl || '').trim()).filter(Boolean))

        const currentBenefits = normalizeVipBenefits(sanitizedVipBenefits)
        const nextBenefits = {
            ...currentBenefits,
        }

        if (canSetTitle) {
            const nextTitle = String(incoming.titleImageUrl || '').trim()
            if (nextTitle && !ownedTitleSet.has(nextTitle)) {
                return res.status(400).json({ ok: false, message: 'Bạn chưa sở hữu ảnh danh hiệu này' })
            }
            nextBenefits.titleImageUrl = nextTitle
        }

        if (canSetFrame) {
            const nextFrame = String(incoming.avatarFrameUrl || '').trim()
            if (nextFrame && !ownedFrameSet.has(nextFrame)) {
                return res.status(400).json({ ok: false, message: 'Bạn chưa sở hữu ảnh khung avatar này' })
            }
            nextBenefits.avatarFrameUrl = nextFrame
        }

        user.vipBenefits = {
            ...user.vipBenefits,
            ...nextBenefits,
        }
        await user.save()

        res.json({
            ok: true,
            message: 'Đã cập nhật danh hiệu/khung avatar hồ sơ',
            user: serializeAuthUser(user),
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

        const user = await User.findById(req.user.userId)
            .select('_id completedBattleTrainers completedBattleTrainerReachedAt')

        if (!user) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy người dùng',
            })
        }

        const completedTrainerIds = Array.isArray(user.completedBattleTrainers)
            ? user.completedBattleTrainers.map((value) => String(value || '').trim()).filter(Boolean)
            : []
        const completionMapRaw = user.completedBattleTrainerReachedAt instanceof Map
            ? Object.fromEntries(user.completedBattleTrainerReachedAt.entries())
            : (user.completedBattleTrainerReachedAt && typeof user.completedBattleTrainerReachedAt === 'object'
                ? user.completedBattleTrainerReachedAt
                : {})

        let shouldSave = false
        const alreadyCompleted = completedTrainerIds.includes(trainerId)
        if (!alreadyCompleted) {
            return res.status(403).json({
                ok: false,
                message: 'Tiến trình trainer chỉ được cập nhật khi nhận kết quả battle.',
            })
        }

        const completionAt = completionMapRaw?.[trainerId]
        const hasCompletionAt = completionAt && Number.isFinite(new Date(completionAt).getTime())
        if (!hasCompletionAt) {
            user.set(`completedBattleTrainerReachedAt.${trainerId}`, new Date())
            shouldSave = true
        }

        if (shouldSave) {
            await user.save()
            invalidateCachedActiveBadgeBonuses(req.user.userId)
        }

        res.json({
            ok: true,
            completedBattleTrainers: completedTrainerIds,
        })
    } catch (error) {
        next(error)
    }
})

// PUT /api/auth/profile (protected)
router.put('/profile', authMiddleware, async (req, res, next) => {
    try {
        const { username, avatar, signature, showPartyInProfile } = req.body

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
        if (showPartyInProfile !== undefined) user.showPartyInProfile = showPartyInProfile !== false

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
