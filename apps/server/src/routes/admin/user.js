import express from 'express'
import mongoose from 'mongoose'
import User from '../../models/User.js'
import Pokemon from '../../models/Pokemon.js'
import Item from '../../models/Item.js'
import UserPokemon from '../../models/UserPokemon.js'
import UserInventory from '../../models/UserInventory.js'
import UserMoveInventory from '../../models/UserMoveInventory.js'
import PlayerState from '../../models/PlayerState.js'
import MapProgress from '../../models/MapProgress.js'
import Encounter from '../../models/Encounter.js'
import DailyActivity from '../../models/DailyActivity.js'
import DailyCheckIn from '../../models/DailyCheckIn.js'
import PromoCodeClaim from '../../models/PromoCodeClaim.js'
import Friendship from '../../models/Friendship.js'
import BattleSession from '../../models/BattleSession.js'
import Message from '../../models/Message.js'
import MarketListing from '../../models/MarketListing.js'
import ItemPurchaseLog from '../../models/ItemPurchaseLog.js'
import MovePurchaseLog from '../../models/MovePurchaseLog.js'
import IpBan from '../../models/IpBan.js'
import VipPrivilegeTier from '../../models/VipPrivilegeTier.js'
import upload from '../../middleware/upload.js'
import { uploadVipAssetImageToCloudinary } from '../../utils/cloudinary.js'
import { normalizeIpAddress } from '../../utils/ipUtils.js'
import {
    ADMIN_PERMISSIONS,
    ALL_ADMIN_PERMISSIONS,
    getEffectiveAdminPermissions,
    hasAdminPermission,
    normalizeAdminPermissions,
} from '../../constants/adminPermissions.js'
import { addOneMonth, buildVipResetPayload, expireVipUsersIfNeeded } from '../../utils/vipStatus.js'

const router = express.Router()

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toSafeLookupLimit = (value, fallback = 200) => Math.min(1000, Math.max(1, parseInt(value, 10) || fallback))
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const isUserCurrentlyBanned = (user) => {
    if (!user?.isBanned) return false
    if (!user?.bannedUntil) return true
    const banUntilMs = new Date(user.bannedUntil).getTime()
    if (!Number.isFinite(banUntilMs)) return true
    return banUntilMs > Date.now()
}

const parseOptionalFutureDate = (value) => {
    if (value === null || value === undefined || value === '') return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date
}

const resolvePokemonSprite = (pokemonLike) => {
    if (!pokemonLike) return ''
    const forms = Array.isArray(pokemonLike.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike.defaultFormId || 'normal')
    const defaultForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || null
    return defaultForm?.sprites?.normal ||
        defaultForm?.sprites?.icon ||
        defaultForm?.imageUrl ||
        pokemonLike.imageUrl ||
        pokemonLike.sprites?.normal ||
        pokemonLike.sprites?.icon ||
        ''
}

const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    const platinumCoinBonusPercent = Math.max(0, Number(source?.platinumCoinBonusPercent ?? source?.moonPointBonusPercent ?? 0) || 0)
    const ssCatchRateBonusPercent = Math.max(0, Number(source?.ssCatchRateBonusPercent ?? source?.catchRateBonusPercent ?? 0) || 0)
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
        expBonusPercent: Math.max(0, Number(source?.expBonusPercent || 0) || 0),
        platinumCoinBonusPercent,
        moonPointBonusPercent: platinumCoinBonusPercent,
        ssCatchRateBonusPercent,
        catchRateBonusPercent: ssCatchRateBonusPercent,
        itemDropBonusPercent: Math.max(0, Number(source?.itemDropBonusPercent || 0) || 0),
        dailyRewardBonusPercent: Math.max(0, Number(source?.dailyRewardBonusPercent || 0) || 0),
    }
}

const parseNonNegativePercent = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Number(fallback) || 0)
    return Math.min(1000, Math.round(parsed * 100) / 100)
}

const parseNonNegativeInt = (value, fallback = 0, max = 100000) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Number.parseInt(fallback, 10) || 0)
    return Math.min(max, parsed)
}

const normalizeVipTierCode = (value = '') => {
    const raw = String(value || '').trim().toUpperCase()
    if (!raw) return ''
    return raw.replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, '')
}

const normalizeVipTierBenefits = (benefitsLike = {}, fallbackLike = {}) => {
    const source = benefitsLike && typeof benefitsLike === 'object' ? benefitsLike : {}
    const fallback = fallbackLike && typeof fallbackLike === 'object' ? fallbackLike : {}

    const toCustomBenefits = Array.isArray(source.customBenefits)
        ? source.customBenefits
        : (Array.isArray(fallback.customBenefits) ? fallback.customBenefits : [])

    const platinumCoinBonusPercent = parseNonNegativePercent(
        source.platinumCoinBonusPercent ?? source.moonPointBonusPercent ?? fallback.platinumCoinBonusPercent ?? fallback.moonPointBonusPercent ?? 0,
        0
    )
    const ssCatchRateBonusPercent = parseNonNegativePercent(
        source.ssCatchRateBonusPercent ?? source.catchRateBonusPercent ?? fallback.ssCatchRateBonusPercent ?? fallback.catchRateBonusPercent ?? 0,
        0
    )

    return {
        title: String(source.title ?? fallback.title ?? '').trim().slice(0, 80),
        titleImageUrl: String(source.titleImageUrl ?? fallback.titleImageUrl ?? '').trim(),
        avatarFrameUrl: String(source.avatarFrameUrl ?? fallback.avatarFrameUrl ?? '').trim(),
        autoSearchEnabled: source.autoSearchEnabled === undefined
            ? (fallback.autoSearchEnabled !== false)
            : Boolean(source.autoSearchEnabled),
        autoSearchDurationMinutes: parseNonNegativeInt(
            source.autoSearchDurationMinutes ?? fallback.autoSearchDurationMinutes ?? 0,
            0,
            10080
        ),
        autoSearchUsesPerDay: parseNonNegativeInt(
            source.autoSearchUsesPerDay ?? fallback.autoSearchUsesPerDay ?? 0,
            0,
            100000
        ),
        autoBattleTrainerEnabled: source.autoBattleTrainerEnabled === undefined
            ? (fallback.autoBattleTrainerEnabled !== false)
            : Boolean(source.autoBattleTrainerEnabled),
        autoBattleTrainerDurationMinutes: parseNonNegativeInt(
            source.autoBattleTrainerDurationMinutes ?? fallback.autoBattleTrainerDurationMinutes ?? 0,
            0,
            10080
        ),
        autoBattleTrainerUsesPerDay: parseNonNegativeInt(
            source.autoBattleTrainerUsesPerDay ?? fallback.autoBattleTrainerUsesPerDay ?? 0,
            0,
            100000
        ),
        expBonusPercent: parseNonNegativePercent(source.expBonusPercent ?? fallback.expBonusPercent ?? 0, 0),
        platinumCoinBonusPercent,
        moonPointBonusPercent: platinumCoinBonusPercent,
        ssCatchRateBonusPercent,
        catchRateBonusPercent: ssCatchRateBonusPercent,
        itemDropBonusPercent: parseNonNegativePercent(source.itemDropBonusPercent ?? fallback.itemDropBonusPercent ?? 0, 0),
        dailyRewardBonusPercent: parseNonNegativePercent(source.dailyRewardBonusPercent ?? fallback.dailyRewardBonusPercent ?? 0, 0),
        customBenefits: [...new Set(
            toCustomBenefits
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .map((entry) => entry.slice(0, 160))
        )],
    }
}

const resetDailyAutoUsage = (userDoc) => {
    if (!userDoc || typeof userDoc !== 'object') return

    userDoc.autoSearch = {
        ...userDoc.autoSearch,
        dayCount: 0,
        dayRuntimeMs: 0,
        lastRuntimeAt: null,
        startedAt: null,
        enabled: false,
    }

    userDoc.autoTrainer = {
        ...userDoc.autoTrainer,
        dayCount: 0,
        dayRuntimeMs: 0,
        lastRuntimeAt: null,
        startedAt: null,
        enabled: false,
    }
}

const buildVipTierResponse = (tierLike) => {
    const tier = tierLike?.toObject ? tierLike.toObject() : tierLike
    if (!tier) return null

    return {
        _id: tier._id,
        code: normalizeVipTierCode(tier.code),
        name: String(tier.name || '').trim().slice(0, 80),
        level: Math.max(1, Number.parseInt(tier.level, 10) || 1),
        description: String(tier.description || '').trim().slice(0, 500),
        isActive: Boolean(tier.isActive),
        benefits: normalizeVipTierBenefits(tier.benefits || {}),
        createdAt: tier.createdAt,
        updatedAt: tier.updatedAt,
    }
}

const buildUserResponse = (user) => {
    const raw = user?.toObject ? user.toObject() : user
    if (!raw) return null
    const { password, recoveryPinHash, ...safeRaw } = raw
    return {
        ...safeRaw,
        vipTierId: safeRaw?.vipTierId ? String(safeRaw.vipTierId) : null,
        vipTierLevel: Math.max(0, Number.parseInt(safeRaw?.vipTierLevel, 10) || 0),
        vipTierCode: String(safeRaw?.vipTierCode || '').trim().toUpperCase(),
        vipExpiresAt: safeRaw?.vipExpiresAt || null,
        vipBenefits: normalizeVipBenefits(safeRaw?.vipBenefits),
        adminPermissions: getEffectiveAdminPermissions(safeRaw),
    }
}

// GET /api/admin/users - List all users with pagination and search
router.get('/', async (req, res) => {
    try {
        await expireVipUsersIfNeeded(User)

        await User.updateMany(
            {
                isBanned: true,
                bannedUntil: { $ne: null, $lte: new Date() },
            },
            {
                $set: {
                    isBanned: false,
                    banReason: '',
                    bannedAt: null,
                    bannedUntil: null,
                    bannedBy: null,
                },
            }
        )

        const { search, role, page = 1, limit = 20 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
        const normalizedRole = String(role || '').trim().toLowerCase()

        const query = {}

        if (['user', 'vip', 'admin'].includes(normalizedRole)) {
            query.role = normalizedRole
        }

        // Search by email or username
        if (search) {
            const escapedSearch = escapeRegExp(search)
            query.$or = [
                { email: { $regex: escapedSearch, $options: 'i' } },
                { username: { $regex: escapedSearch, $options: 'i' } }
            ]
        }

        const skip = (safePage - 1) * safeLimit

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password -recoveryPinHash')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            User.countDocuments(query),
        ])

        const normalizedUsers = users.map((user) => buildUserResponse(user))

        res.json({
            ok: true,
            users: normalizedUsers,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.ceil(total / safeLimit),
            },
            permissions: ALL_ADMIN_PERMISSIONS,
        })
    } catch (error) {
        console.error('GET /api/admin/users error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/users/lookup/pokemon - Search pokemon for grant modal
router.get('/lookup/pokemon', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const safeLimit = toSafeLookupLimit(req.query.limit, 25)
        const query = {}

        if (search) {
            const escapedSearch = escapeRegExp(search.toLowerCase())
            const numericSearch = parseInt(search, 10)
            if (Number.isFinite(numericSearch)) {
                query.$or = [
                    { pokedexNumber: numericSearch },
                    { nameLower: { $regex: escapedSearch, $options: 'i' } },
                ]
            } else {
                query.nameLower = { $regex: escapedSearch, $options: 'i' }
            }
        }

        const pokemon = await Pokemon.find(query)
            .sort({ pokedexNumber: 1 })
            .limit(safeLimit)
            .select('name pokedexNumber imageUrl sprites defaultFormId forms')
            .lean()

        const rows = pokemon.map((entry) => {
            const defaultFormId = normalizeFormId(entry.defaultFormId || 'normal')
            const rawForms = Array.isArray(entry.forms) && entry.forms.length > 0
                ? entry.forms
                : [{ formId: defaultFormId, formName: defaultFormId }]

            const normalizedForms = rawForms
                .map((form) => ({
                    formId: normalizeFormId(form?.formId || defaultFormId),
                    formName: String(form?.formName || '').trim() || normalizeFormId(form?.formId || defaultFormId),
                }))
                .filter((form, index, arr) => arr.findIndex((entry) => entry.formId === form.formId) === index)
                .sort((a, b) => {
                    if (a.formId === defaultFormId) return -1
                    if (b.formId === defaultFormId) return 1
                    return a.formId.localeCompare(b.formId)
                })

            return {
                _id: entry._id,
                name: entry.name,
                pokedexNumber: entry.pokedexNumber,
                sprite: resolvePokemonSprite(entry),
                defaultFormId,
                forms: normalizedForms,
            }
        })

        res.json({ ok: true, pokemon: rows })
    } catch (error) {
        console.error('GET /api/admin/users/lookup/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/users/lookup/items - Search items for grant modal
router.get('/lookup/items', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const safeLimit = toSafeLookupLimit(req.query.limit, 25)
        const query = {}

        if (search) {
            query.nameLower = { $regex: escapeRegExp(search.toLowerCase()), $options: 'i' }
        }

        const items = await Item.find(query)
            .sort({ createdAt: -1 })
            .limit(safeLimit)
            .select('name type rarity imageUrl')
            .lean()

        res.json({ ok: true, items })
    } catch (error) {
        console.error('GET /api/admin/users/lookup/items error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/users/ip-bans - List active IP bans
router.get('/ip-bans', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim().toLowerCase()
        const safePage = Math.max(1, parseInt(req.query.page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))

        const query = { isActive: true }
        if (search) {
            query.ip = { $regex: escapeRegExp(search), $options: 'i' }
        }

        const skip = (safePage - 1) * safeLimit
        const [rows, total] = await Promise.all([
            IpBan.find(query)
                .sort({ updatedAt: -1, _id: -1 })
                .skip(skip)
                .limit(safeLimit)
                .populate('bannedBy', 'username email')
                .lean(),
            IpBan.countDocuments(query),
        ])

        res.json({
            ok: true,
            ipBans: rows,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/users/ip-bans error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/ip-bans - Ban IP
router.post('/ip-bans', async (req, res) => {
    try {
        const ip = normalizeIpAddress(req.body?.ip)
        const reason = String(req.body?.reason || '').trim()
        const expiresAt = parseOptionalFutureDate(req.body?.expiresAt)

        if (!ip) {
            return res.status(400).json({ ok: false, message: 'IP không hợp lệ' })
        }

        if (expiresAt && expiresAt.getTime() <= Date.now()) {
            return res.status(400).json({ ok: false, message: 'Thời gian hết hạn phải ở tương lai' })
        }

        const banDoc = await IpBan.findOneAndUpdate(
            { ip },
            {
                $set: {
                    ip,
                    reason,
                    isActive: true,
                    bannedBy: req.user.userId,
                    bannedAt: new Date(),
                    expiresAt: expiresAt || null,
                    liftedAt: null,
                    liftedBy: null,
                },
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
            }
        )

        res.json({
            ok: true,
            ipBan: banDoc,
            message: `Đã chặn IP ${ip}`,
        })
    } catch (error) {
        console.error('POST /api/admin/users/ip-bans error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// DELETE /api/admin/users/ip-bans/:banId - Unban IP
router.delete('/ip-bans/:banId', async (req, res) => {
    try {
        const banId = String(req.params.banId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(banId)) {
            return res.status(400).json({ ok: false, message: 'banId không hợp lệ' })
        }

        const updated = await IpBan.findByIdAndUpdate(
            banId,
            {
                $set: {
                    isActive: false,
                    liftedBy: req.user.userId,
                    liftedAt: new Date(),
                },
            },
            { new: true }
        ).lean()

        if (!updated) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản ghi IP ban' })
        }

        res.json({ ok: true, message: `Đã gỡ chặn IP ${updated.ip}` })
    } catch (error) {
        console.error('DELETE /api/admin/users/ip-bans/:banId error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/admin/users/vip-tiers - List VIP privilege tiers
router.post('/vip-tiers/upload-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, message: 'Chưa có tệp ảnh được tải lên' })
        }

        const { imageUrl, publicId } = await uploadVipAssetImageToCloudinary({
            buffer: req.file.buffer,
            mimetype: req.file.mimetype,
            originalname: req.file.originalname,
        })

        res.json({
            ok: true,
            imageUrl,
            publicId,
            message: 'Tải ảnh đặc quyền VIP thành công',
        })
    } catch (error) {
        console.error('POST /api/admin/users/vip-tiers/upload-image error:', error)
        res.status(500).json({ ok: false, message: error.message || 'Tải ảnh thất bại' })
    }
})

// GET /api/admin/users/vip-tiers - List VIP privilege tiers
router.get('/vip-tiers', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim()
        const activeFilterRaw = String(req.query.active || '').trim().toLowerCase()

        const query = {}
        if (search) {
            const escaped = escapeRegExp(search)
            query.$or = [
                { code: { $regex: escaped, $options: 'i' } },
                { name: { $regex: escaped, $options: 'i' } },
                { description: { $regex: escaped, $options: 'i' } },
            ]
        }

        if (activeFilterRaw === 'true' || activeFilterRaw === '1') {
            query.isActive = true
        } else if (activeFilterRaw === 'false' || activeFilterRaw === '0') {
            query.isActive = false
        }

        const tiers = await VipPrivilegeTier.find(query)
            .sort({ level: 1, code: 1, _id: 1 })
            .lean()

        res.json({
            ok: true,
            vipTiers: tiers.map((tier) => buildVipTierResponse(tier)),
        })
    } catch (error) {
        console.error('GET /api/admin/users/vip-tiers error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/vip-tiers - Create VIP privilege tier
router.post('/vip-tiers', async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {}
        const level = clamp(parseInt(payload.level, 10) || 1, 1, 9999)
        const code = normalizeVipTierCode(payload.code || `VIP${level}`)
        const name = String(payload.name || `VIP ${level}`).trim().slice(0, 80)
        const description = String(payload.description || '').trim().slice(0, 500)
        const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive)

        if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
            return res.status(400).json({
                ok: false,
                message: 'Mã VIP không hợp lệ. Chỉ dùng A-Z, 0-9, _ hoặc - (2-32 ký tự).',
            })
        }

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Tên gói VIP là bắt buộc' })
        }

        const tier = await VipPrivilegeTier.create({
            code,
            name,
            level,
            description,
            isActive,
            benefits: normalizeVipTierBenefits(payload.benefits || {}),
            createdBy: req.user.userId,
            updatedBy: req.user.userId,
        })

        res.status(201).json({
            ok: true,
            vipTier: buildVipTierResponse(tier),
            message: `Đã tạo gói đặc quyền ${name}`,
        })
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                ok: false,
                message: 'Cấp độ hoặc mã VIP đã tồn tại. Vui lòng dùng giá trị khác.',
            })
        }
        console.error('POST /api/admin/users/vip-tiers error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/vip-tiers/bulk-range - Create VIP range (VIP1..VIPN)
router.post('/vip-tiers/bulk-range', async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {}
        const fromLevel = clamp(parseInt(payload.fromLevel, 10) || 1, 1, 9999)
        const toLevel = clamp(parseInt(payload.toLevel, 10) || fromLevel, 1, 9999)
        const start = Math.min(fromLevel, toLevel)
        const end = Math.max(fromLevel, toLevel)

        if ((end - start + 1) > 500) {
            return res.status(400).json({
                ok: false,
                message: 'Mỗi lần chỉ được tạo tối đa 500 cấp VIP',
            })
        }

        const existing = await VipPrivilegeTier.find({
            level: { $gte: start, $lte: end },
        })
            .select('level')
            .lean()
        const existingLevelSet = new Set(existing.map((entry) => Number(entry.level)))

        const defaultBenefits = normalizeVipTierBenefits(payload.benefits || {})
        const docs = []
        const skippedLevels = []

        for (let level = start; level <= end; level += 1) {
            if (existingLevelSet.has(level)) {
                skippedLevels.push(level)
                continue
            }
            docs.push({
                code: `VIP${level}`,
                name: `VIP ${level}`,
                level,
                description: '',
                isActive: true,
                benefits: defaultBenefits,
                createdBy: req.user.userId,
                updatedBy: req.user.userId,
            })
        }

        let createdCount = 0
        if (docs.length > 0) {
            await VipPrivilegeTier.insertMany(docs, { ordered: true })
            createdCount = docs.length
        }

        res.json({
            ok: true,
            createdCount,
            skippedCount: skippedLevels.length,
            skippedLevels,
            message: `Đã tạo ${createdCount} cấp VIP mới`,
        })
    } catch (error) {
        console.error('POST /api/admin/users/vip-tiers/bulk-range error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// PUT /api/admin/users/vip-tiers/:tierId - Update VIP privilege tier
router.put('/vip-tiers/:tierId', async (req, res) => {
    try {
        const tierId = String(req.params.tierId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(tierId)) {
            return res.status(400).json({ ok: false, message: 'tierId không hợp lệ' })
        }

        const payload = req.body && typeof req.body === 'object' ? req.body : {}
        const tier = await VipPrivilegeTier.findById(tierId)
        if (!tier) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy gói VIP' })
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'level')) {
            tier.level = clamp(parseInt(payload.level, 10) || 1, 1, 9999)
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'code')) {
            const code = normalizeVipTierCode(payload.code)
            if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
                return res.status(400).json({
                    ok: false,
                    message: 'Mã VIP không hợp lệ. Chỉ dùng A-Z, 0-9, _ hoặc - (2-32 ký tự).',
                })
            }
            tier.code = code
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
            tier.name = String(payload.name || '').trim().slice(0, 80)
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
            tier.description = String(payload.description || '').trim().slice(0, 500)
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
            tier.isActive = Boolean(payload.isActive)
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'benefits')) {
            tier.benefits = normalizeVipTierBenefits(payload.benefits, tier.benefits || {})
        }

        if (!String(tier.name || '').trim()) {
            return res.status(400).json({ ok: false, message: 'Tên gói VIP là bắt buộc' })
        }

        tier.updatedBy = req.user.userId
        await tier.save()

        res.json({
            ok: true,
            vipTier: buildVipTierResponse(tier),
            message: 'Đã cập nhật gói đặc quyền VIP',
        })
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                ok: false,
                message: 'Cấp độ hoặc mã VIP đã tồn tại. Vui lòng dùng giá trị khác.',
            })
        }
        console.error('PUT /api/admin/users/vip-tiers/:tierId error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// DELETE /api/admin/users/vip-tiers/:tierId - Delete VIP privilege tier
router.delete('/vip-tiers/:tierId', async (req, res) => {
    try {
        const tierId = String(req.params.tierId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(tierId)) {
            return res.status(400).json({ ok: false, message: 'tierId không hợp lệ' })
        }

        const deleted = await VipPrivilegeTier.findByIdAndDelete(tierId).lean()
        if (!deleted) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy gói VIP' })
        }

        res.json({
            ok: true,
            message: `Đã xóa gói ${deleted.name || deleted.code}`,
        })
    } catch (error) {
        console.error('DELETE /api/admin/users/vip-tiers/:tierId error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// PUT /api/admin/users/:id/vip-tier - Assign VIP tier to user
router.put('/:id/vip-tier', async (req, res) => {
    try {
        const targetUserId = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'id người dùng không hợp lệ' })
        }

        const payload = req.body && typeof req.body === 'object' ? req.body : {}
        const tierId = String(payload.tierId || '').trim()
        const level = parseInt(payload.level, 10)
        const applyBenefits = payload.applyBenefits !== false
        const expiresAt = parseOptionalFutureDate(payload.expiresAt)

        let tier = null
        if (tierId) {
            if (!mongoose.Types.ObjectId.isValid(tierId)) {
                return res.status(400).json({ ok: false, message: 'tierId không hợp lệ' })
            }
            tier = await VipPrivilegeTier.findById(tierId)
        } else if (Number.isFinite(level) && level > 0) {
            tier = await VipPrivilegeTier.findOne({ level })
        } else {
            return res.status(400).json({ ok: false, message: 'Cần chọn tierId hoặc level VIP hợp lệ' })
        }

        if (!tier) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy cấp VIP phù hợp' })
        }

        if (payload.expiresAt !== undefined && payload.expiresAt !== null && payload.expiresAt !== '' && !expiresAt) {
            return res.status(400).json({ ok: false, message: 'Thời gian hết hạn VIP không hợp lệ' })
        }

        if (expiresAt && expiresAt.getTime() <= Date.now()) {
            return res.status(400).json({ ok: false, message: 'Thời gian hết hạn VIP phải ở tương lai' })
        }

        const user = await User.findById(targetUserId)
        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const previousVipTierLevel = Math.max(0, parseInt(user?.vipTierLevel, 10) || 0)
        const nextVipTierLevel = Math.max(1, parseInt(tier.level, 10) || 1)

        user.role = 'vip'
        user.vipTierId = tier._id
        user.vipTierLevel = nextVipTierLevel
        user.vipTierCode = normalizeVipTierCode(tier.code)
        user.vipExpiresAt = expiresAt || addOneMonth(new Date())

        if (applyBenefits) {
            const tierBenefits = normalizeVipTierBenefits(tier.benefits || {})
            user.vipBenefits = {
                ...normalizeVipBenefits(user.vipBenefits),
                ...tierBenefits,
            }
        }

        if (nextVipTierLevel > previousVipTierLevel) {
            resetDailyAutoUsage(user)
        }

        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            tier: buildVipTierResponse(tier),
            message: `Đã gán ${tier.name || tier.code} cho người dùng đến ${user.vipExpiresAt ? new Date(user.vipExpiresAt).toLocaleString('vi-VN') : 'khi hết hạn'}`,
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/vip-tier error:', error)
        res.status(500).json({ ok: false, message: error?.message || 'Lỗi máy chủ' })
    }
})

// PUT /api/admin/users/:id/ban - Ban/unban account
router.put('/:id/ban', async (req, res) => {
    try {
        const targetUserId = String(req.params.id || '').trim()
        const shouldBan = Boolean(req.body?.isBanned)
        const reason = String(req.body?.reason || '').trim()
        const bannedUntil = parseOptionalFutureDate(req.body?.bannedUntil)

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'id người dùng không hợp lệ' })
        }

        if (shouldBan && String(req.user?.userId || '').trim() === targetUserId) {
            return res.status(400).json({ ok: false, message: 'Không thể tự khóa chính tài khoản của bạn' })
        }

        if (shouldBan && bannedUntil && bannedUntil.getTime() <= Date.now()) {
            return res.status(400).json({ ok: false, message: 'Thời gian hết hạn ban phải ở tương lai' })
        }

        const user = await User.findById(targetUserId)
        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        if (shouldBan && user.role === 'admin') {
            const remainingAdmins = await User.find({
                role: 'admin',
                _id: { $ne: user._id },
            })
                .select('isBanned bannedUntil adminPermissions')
                .lean()

            const activeAdmins = remainingAdmins.filter((entry) => !isUserCurrentlyBanned(entry))
            if (activeAdmins.length === 0) {
                return res.status(400).json({
                    ok: false,
                    message: 'Không thể khóa admin cuối cùng của hệ thống',
                })
            }

            const activeUsersManagers = activeAdmins.filter((entry) =>
                hasAdminPermission(entry, ADMIN_PERMISSIONS.USERS)
            )
            if (activeUsersManagers.length === 0) {
                return res.status(400).json({
                    ok: false,
                    message: 'Không thể khóa toàn bộ admin có quyền quản lý người dùng',
                })
            }
        }

        if (shouldBan) {
            user.isBanned = true
            user.banReason = reason
            user.bannedAt = new Date()
            user.bannedUntil = bannedUntil || null
            user.bannedBy = req.user.userId
            user.isOnline = false
        } else {
            user.isBanned = false
            user.banReason = ''
            user.bannedAt = null
            user.bannedUntil = null
            user.bannedBy = null
        }

        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: shouldBan ? 'Đã khóa tài khoản người dùng' : 'Đã gỡ khóa tài khoản người dùng',
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/ban error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/bulk-delete - Delete multiple user accounts
router.post('/bulk-delete', async (req, res) => {
    try {
        const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : []
        const normalizedIds = [...new Set(
            userIds
                .map((entry) => String(entry || '').trim())
                .filter((entry) => mongoose.Types.ObjectId.isValid(entry))
        )]

        if (normalizedIds.length === 0) {
            return res.status(400).json({ ok: false, message: 'Danh sách user cần xóa không hợp lệ' })
        }

        if (normalizedIds.length > 200) {
            return res.status(400).json({ ok: false, message: 'Mỗi lần chỉ được xóa tối đa 200 user' })
        }

        const requesterUserId = String(req.user?.userId || '').trim()
        if (requesterUserId && normalizedIds.includes(requesterUserId)) {
            return res.status(400).json({ ok: false, message: 'Không thể tự xóa tài khoản đang đăng nhập' })
        }

        const usersToDelete = await User.find({ _id: { $in: normalizedIds } })
            .select('_id role adminPermissions username email')
            .lean()

        if (usersToDelete.length === 0) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản nào để xóa' })
        }

        const deleteObjectIds = usersToDelete.map((entry) => entry._id)
        const deleteIdStrings = deleteObjectIds.map((entry) => String(entry))
        const deletingAdmins = usersToDelete.filter((entry) => entry.role === 'admin')

        if (deletingAdmins.length > 0) {
            const [totalAdminCount, remainingAdminUsers] = await Promise.all([
                User.countDocuments({ role: 'admin' }),
                User.find({
                    role: 'admin',
                    _id: { $nin: deleteObjectIds },
                })
                    .select('role adminPermissions')
                    .lean(),
            ])

            const remainingAdminCount = totalAdminCount - deletingAdmins.length
            if (remainingAdminCount < 1) {
                return res.status(400).json({
                    ok: false,
                    message: 'Không thể xóa admin cuối cùng của hệ thống.',
                })
            }

            const remainingUsersManagers = remainingAdminUsers.filter((admin) =>
                hasAdminPermission(admin, ADMIN_PERMISSIONS.USERS)
            )
            if (remainingUsersManagers.length === 0) {
                return res.status(400).json({
                    ok: false,
                    message: 'Không thể xóa toàn bộ admin có quyền quản lý tài khoản người dùng.',
                })
            }
        }

        await Promise.all([
            User.deleteMany({ _id: { $in: deleteObjectIds } }),
            PlayerState.deleteMany({ userId: { $in: deleteObjectIds } }),
            UserPokemon.deleteMany({ userId: { $in: deleteObjectIds } }),
            UserInventory.deleteMany({ userId: { $in: deleteObjectIds } }),
            UserMoveInventory.deleteMany({ userId: { $in: deleteObjectIds } }),
            MapProgress.deleteMany({ userId: { $in: deleteObjectIds } }),
            Encounter.deleteMany({ userId: { $in: deleteObjectIds } }),
            DailyActivity.deleteMany({ userId: { $in: deleteObjectIds } }),
            DailyCheckIn.deleteMany({ userId: { $in: deleteObjectIds } }),
            PromoCodeClaim.deleteMany({ userId: { $in: deleteObjectIds } }),
            BattleSession.deleteMany({ userId: { $in: deleteObjectIds } }),
            Friendship.deleteMany({
                $or: [
                    { requesterId: { $in: deleteObjectIds } },
                    { addresseeId: { $in: deleteObjectIds } },
                    { blockedBy: { $in: deleteObjectIds } },
                ],
            }),
            Message.deleteMany({ 'sender._id': { $in: deleteObjectIds } }),
            Message.updateMany(
                { deletedBy: { $in: deleteObjectIds } },
                { $set: { deletedBy: null } }
            ),
            MarketListing.deleteMany({ sellerId: { $in: deleteObjectIds } }),
            MarketListing.updateMany(
                { buyerId: { $in: deleteObjectIds } },
                { $set: { buyerId: null } }
            ),
            MarketListing.updateMany(
                { reservedForUserId: { $in: deleteObjectIds } },
                { $set: { reservedForUserId: null } }
            ),
            ItemPurchaseLog.deleteMany({ buyerId: { $in: deleteObjectIds } }),
            MovePurchaseLog.deleteMany({ buyerId: { $in: deleteObjectIds } }),
        ])

        res.json({
            ok: true,
            deletedCount: deleteIdStrings.length,
            deletedUserIds: deleteIdStrings,
            message: `Đã xóa ${deleteIdStrings.length} tài khoản và dữ liệu liên quan`,
        })
    } catch (error) {
        console.error('POST /api/admin/users/bulk-delete error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/:id/grant-pokemon - Grant pokemon to user
router.post('/:id/grant-pokemon', async (req, res) => {
    try {
        const targetUserId = String(req.params.id || '').trim()
        const {
            pokemonId,
            level = 5,
            quantity = 1,
            formId = 'normal',
            isShiny = false,
        } = req.body || {}

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'user id không hợp lệ' })
        }
        if (!mongoose.Types.ObjectId.isValid(String(pokemonId || ''))) {
            return res.status(400).json({ ok: false, message: 'pokemon id không hợp lệ' })
        }

        const [targetUser, pokemon] = await Promise.all([
            User.findById(targetUserId).select('username').lean(),
            Pokemon.findById(pokemonId)
                .select('name defaultFormId forms')
                .lean(),
        ])

        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }
        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const safeLevel = clamp(parseInt(level, 10) || 5, 1, 1500)
        const safeQuantity = clamp(parseInt(quantity, 10) || 1, 1, 100)

        const normalizedRequestedFormId = normalizeFormId(formId)
        const availableForms = new Set(
            (Array.isArray(pokemon.forms) ? pokemon.forms : [])
                .map((entry) => normalizeFormId(entry?.formId || ''))
                .filter(Boolean)
        )
        const defaultFormId = normalizeFormId(pokemon.defaultFormId || 'normal')
        const resolvedFormId = availableForms.has(normalizedRequestedFormId)
            ? normalizedRequestedFormId
            : (availableForms.has(defaultFormId) ? defaultFormId : 'normal')

        const docs = Array.from({ length: safeQuantity }, () => ({
            userId: targetUserId,
            pokemonId,
            level: safeLevel,
            experience: 0,
            formId: resolvedFormId,
            isShiny: Boolean(isShiny),
            location: 'box',
            moves: [],
            movePpState: [],
            originalTrainer: `admin_grant:${req.user.userId}`,
        }))

        await UserPokemon.insertMany(docs)

        res.json({
            ok: true,
            message: `Đã thêm ${safeQuantity} ${pokemon.name} cho ${targetUser.username || 'người chơi'}`,
            granted: {
                quantity: safeQuantity,
                pokemonId,
                pokemonName: pokemon.name,
                level: safeLevel,
                formId: resolvedFormId,
                isShiny: Boolean(isShiny),
            },
        })
    } catch (error) {
        console.error('POST /api/admin/users/:id/grant-pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/users/:id/grant-item - Grant items to user inventory
router.post('/:id/grant-item', async (req, res) => {
    try {
        const targetUserId = String(req.params.id || '').trim()
        const { itemId, quantity = 1 } = req.body || {}

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'user id không hợp lệ' })
        }
        if (!mongoose.Types.ObjectId.isValid(String(itemId || ''))) {
            return res.status(400).json({ ok: false, message: 'item id không hợp lệ' })
        }

        const safeQuantity = clamp(parseInt(quantity, 10) || 0, 0, 99999)
        if (safeQuantity <= 0) {
            return res.status(400).json({ ok: false, message: 'Số lượng phải lớn hơn 0' })
        }

        const [targetUser, item] = await Promise.all([
            User.findById(targetUserId).select('username').lean(),
            Item.findById(itemId).select('name type rarity').lean(),
        ])

        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }
        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        const inventoryEntry = await UserInventory.findOneAndUpdate(
            { userId: targetUserId, itemId },
            {
                $setOnInsert: { userId: targetUserId, itemId },
                $inc: { quantity: safeQuantity },
            },
            { new: true, upsert: true }
        )

        res.json({
            ok: true,
            message: `Đã thêm ${safeQuantity} ${item.name} cho ${targetUser.username || 'người chơi'}`,
            granted: {
                itemId,
                itemName: item.name,
                quantity: safeQuantity,
                totalQuantity: inventoryEntry.quantity,
            },
        })
    } catch (error) {
        console.error('POST /api/admin/users/:id/grant-item error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// PUT /api/admin/users/:id/role - Update user role
router.put('/:id/role', async (req, res) => {
    try {
        const { id } = req.params
        const { role } = req.body

        // Validation
        if (!['user', 'vip', 'admin'].includes(role)) {
            return res.status(400).json({ ok: false, message: 'Vai trò không hợp lệ. Chỉ chấp nhận "user", "vip" hoặc "admin"' })
        }

        const user = await User.findById(id)

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        // Prevent removing the last admin
        if (user.role === 'admin' && role !== 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin' })
            if (adminCount <= 1) {
                return res.status(400).json({
                    ok: false,
                    message: 'Không thể gỡ admin cuối cùng. Vui lòng chỉ định admin khác trước.'
                })
            }
        }

        user.role = role
        if (role === 'admin' && (!Array.isArray(user.adminPermissions) || user.adminPermissions.length === 0)) {
            user.adminPermissions = [...ALL_ADMIN_PERMISSIONS]
        }
        if (role === 'vip') {
            user.vipExpiresAt = addOneMonth(new Date())
        } else {
            Object.assign(user, buildVipResetPayload(), {
                role,
                adminPermissions: role === 'admin'
                    ? (Array.isArray(user.adminPermissions) && user.adminPermissions.length > 0
                        ? user.adminPermissions
                        : [...ALL_ADMIN_PERMISSIONS])
                    : user.adminPermissions,
            })
        }
        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: `Đã cập nhật vai trò người dùng thành ${role}`
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
                message: 'Quyền không hợp lệ. Cần truyền một mảng khóa quyền.',
            })
        }

        const user = await User.findById(id)
        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        if (user.role !== 'admin') {
            return res.status(400).json({
                ok: false,
                message: 'Chỉ tài khoản admin mới có quyền quản trị',
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
                    message: 'Không thể gỡ quyền "users" khỏi admin cuối cùng có thể quản lý người dùng.',
                })
            }
        }

        user.adminPermissions = normalizedPermissions
        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: 'Cập nhật quyền quản trị thành công',
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/permissions error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/users/:id/vip-benefits - Update VIP benefits for a user
router.put('/:id/vip-benefits', async (req, res) => {
    try {
        const { id } = req.params
        const user = await User.findById(id)

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        if (user.role !== 'vip') {
            return res.status(400).json({
                ok: false,
                message: 'Chỉ có thể cập nhật quyền lợi cho tài khoản VIP',
            })
        }

        const currentVipBenefits = normalizeVipBenefits(user.vipBenefits)
        const incoming = req.body && typeof req.body === 'object' ? req.body : {}
        const nextVipBenefits = {
            ...currentVipBenefits,
        }

        if (Object.prototype.hasOwnProperty.call(incoming, 'title')) {
            nextVipBenefits.title = String(incoming.title || '').trim().slice(0, 80)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'titleImageUrl')) {
            nextVipBenefits.titleImageUrl = String(incoming.titleImageUrl || '').trim()
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'avatarFrameUrl')) {
            nextVipBenefits.avatarFrameUrl = String(incoming.avatarFrameUrl || '').trim()
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoSearchEnabled')) {
            nextVipBenefits.autoSearchEnabled = Boolean(incoming.autoSearchEnabled)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoSearchDurationMinutes')) {
            nextVipBenefits.autoSearchDurationMinutes = parseNonNegativeInt(incoming.autoSearchDurationMinutes, 0, 10080)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoSearchUsesPerDay')) {
            nextVipBenefits.autoSearchUsesPerDay = parseNonNegativeInt(incoming.autoSearchUsesPerDay, 0, 100000)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoBattleTrainerEnabled')) {
            nextVipBenefits.autoBattleTrainerEnabled = Boolean(incoming.autoBattleTrainerEnabled)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoBattleTrainerDurationMinutes')) {
            nextVipBenefits.autoBattleTrainerDurationMinutes = parseNonNegativeInt(incoming.autoBattleTrainerDurationMinutes, 0, 10080)
        }
        if (Object.prototype.hasOwnProperty.call(incoming, 'autoBattleTrainerUsesPerDay')) {
            nextVipBenefits.autoBattleTrainerUsesPerDay = parseNonNegativeInt(incoming.autoBattleTrainerUsesPerDay, 0, 100000)
        }

        user.vipBenefits = nextVipBenefits
        await user.save()

        res.json({
            ok: true,
            user: buildUserResponse(user),
            message: 'Đã cập nhật quyền lợi VIP',
        })
    } catch (error) {
        console.error('PUT /api/admin/users/:id/vip-benefits error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

export default router
