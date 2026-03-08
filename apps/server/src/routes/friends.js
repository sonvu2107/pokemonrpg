import express from 'express'
import mongoose from 'mongoose'
import { authMiddleware } from '../middleware/auth.js'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import Friendship, { FRIENDSHIP_STATUS, buildFriendPairKey } from '../models/Friendship.js'
import { emitToUser } from '../socket/index.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'

const router = express.Router()
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const USER_SELECT_FIELDS = 'username avatar role vipTierId vipTierLevel vipTierCode vipBenefits isOnline createdAt lastActive signature showPartyInProfile'
const PARTY_SLOT_TOTAL = 6

const toSafeIsoDate = (value) => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const formatPlayTime = (createdAt, nowDate = new Date()) => {
    const created = new Date(createdAt)
    const now = new Date(nowDate)
    if (Number.isNaN(created.getTime()) || Number.isNaN(now.getTime())) {
        return '0 ngày 0 giờ'
    }

    const diffMs = Math.max(0, now.getTime() - created.getTime())
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24
    return `${days} ngày ${hours} giờ`
}

const createEmptyPartySlots = () => Array.from({ length: PARTY_SLOT_TOTAL }, () => null)

const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'

const resolveSpeciesForm = (species = {}, formId = 'normal') => {
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const normalizedFormId = normalizeFormId(formId)
    const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
    return forms.find((entry) => normalizeFormId(entry?.formId) === normalizedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
}

const resolveSpeciesBaseStats = (species = {}, formId = 'normal') => {
    const form = resolveSpeciesForm(species, formId)
    return form?.stats || species?.baseStats || {}
}

const toStatNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toSafePositiveInt = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1)
    return Math.max(1, Math.floor(parsed))
}

const calcPartyCombatPower = (entry, species) => {
    const level = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
    const baseStats = resolveSpeciesBaseStats(species, entry?.formId)
    const scaledStats = calcStatsForLevel(baseStats, level, species?.rarity || 'd')
    const ivs = entry?.ivs && typeof entry.ivs === 'object' ? entry.ivs : {}
    const evs = entry?.evs && typeof entry.evs === 'object' ? entry.evs : {}

    const resolveStat = (key, aliases = []) => {
        const iv = toStatNumber(ivs[key] ?? aliases.map((alias) => ivs[alias]).find((value) => value != null))
        const ev = toStatNumber(evs[key] ?? aliases.map((alias) => evs[alias]).find((value) => value != null))
        const base = toStatNumber(scaledStats[key] ?? aliases.map((alias) => scaledStats[alias]).find((value) => value != null))
        return Math.max(1, Math.floor(base + iv + (ev / 8)))
    }

    const hp = resolveStat('hp')
    const atk = resolveStat('atk')
    const def = resolveStat('def')
    const spatk = resolveStat('spatk')
    const spdef = resolveStat('spdef', ['spldef'])
    const spd = resolveStat('spd')

    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (level * 2)
    const shinyBonus = entry?.isShiny ? 1.03 : 1
    return toSafePositiveInt(rawPower * shinyBonus, Math.max(1, level * 10))
}

const serializePartyPokemon = (entry) => {
    if (!entry?._id || !entry?.pokemonId) return null
    const species = entry.pokemonId
    const combatPower = calcPartyCombatPower(entry, species)
    return {
        _id: String(entry._id),
        nickname: String(entry?.nickname || '').trim(),
        level: Math.max(1, Number(entry?.level || 1)),
        formId: String(entry?.formId || 'normal').trim() || 'normal',
        isShiny: Boolean(entry?.isShiny),
        combatPower,
        power: combatPower,
        partyIndex: Number.isFinite(Number(entry?.partyIndex)) ? Number(entry.partyIndex) : null,
        pokemonId: {
            _id: String(species?._id || ''),
            name: String(species?.name || '').trim(),
            types: Array.isArray(species?.types) ? species.types : [],
            rarity: String(species?.rarity || 'd').trim() || 'd',
            baseStats: species?.baseStats && typeof species.baseStats === 'object' ? species.baseStats : {},
            imageUrl: String(species?.imageUrl || '').trim(),
            sprites: species?.sprites && typeof species.sprites === 'object' ? species.sprites : {},
            defaultFormId: String(species?.defaultFormId || 'normal').trim() || 'normal',
            forms: Array.isArray(species?.forms) ? species.forms : [],
        },
    }
}

const getRefUserId = (value) => {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'object' && value._id) return String(value._id)
    return String(value)
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

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)
    return {
        ...current,
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
    }
}

const buildVipTierLookup = async (users = []) => {
    const tierIdSet = new Set()
    const tierLevelSet = new Set()

    for (const entry of users) {
        const vipTierId = String(entry?.vipTierId || '').trim()
        if (vipTierId) {
            tierIdSet.add(vipTierId)
            continue
        }
        const vipTierLevel = Math.max(0, parseInt(entry?.vipTierLevel, 10) || 0)
        if (vipTierLevel > 0) {
            tierLevelSet.add(vipTierLevel)
        }
    }

    const conditions = []
    if (tierIdSet.size > 0) {
        conditions.push({ _id: { $in: Array.from(tierIdSet) } })
    }
    if (tierLevelSet.size > 0) {
        conditions.push({ level: { $in: Array.from(tierLevelSet) } })
    }

    if (conditions.length === 0) {
        return {
            tierById: new Map(),
            tierByLevel: new Map(),
        }
    }

    const tiers = await VipPrivilegeTier.find({ $or: conditions }).select('_id level benefits').lean()
    const tierById = new Map()
    const tierByLevel = new Map()

    for (const tier of tiers) {
        const idKey = String(tier?._id || '').trim()
        if (idKey) {
            tierById.set(idKey, tier)
        }
        const levelKey = Math.max(0, parseInt(tier?.level, 10) || 0)
        if (levelKey > 0) {
            tierByLevel.set(levelKey, tier)
        }
    }

    return { tierById, tierByLevel }
}

const resolveTierBenefitsForUser = (userLike, tierById, tierByLevel) => {
    const vipTierId = String(userLike?.vipTierId || '').trim()
    if (vipTierId && tierById.has(vipTierId)) {
        return normalizeVipBenefits(tierById.get(vipTierId)?.benefits)
    }

    const vipTierLevel = Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0)
    if (vipTierLevel > 0 && tierByLevel.has(vipTierLevel)) {
        return normalizeVipBenefits(tierByLevel.get(vipTierLevel)?.benefits)
    }

    return normalizeVipBenefits({})
}

const buildEffectiveVipBenefitsByUserId = async (users = []) => {
    const normalizedUsers = Array.isArray(users) ? users.filter(Boolean) : []
    if (normalizedUsers.length === 0) return new Map()

    const { tierById, tierByLevel } = await buildVipTierLookup(normalizedUsers)
    const benefitsByUserId = new Map()

    for (const entry of normalizedUsers) {
        const userId = getRefUserId(entry)
        if (!userId) continue
        benefitsByUserId.set(
            userId,
            mergeVipVisualBenefits(
                entry?.vipBenefits,
                resolveTierBenefitsForUser(entry, tierById, tierByLevel)
            )
        )
    }

    return benefitsByUserId
}

const serializeUser = (userLike, benefitsByUserId = null) => {
    const userId = getRefUserId(userLike)
    const effectiveVipBenefits = benefitsByUserId instanceof Map
        ? (benefitsByUserId.get(userId) || userLike?.vipBenefits)
        : userLike?.vipBenefits

    return {
    userId,
    username: String(userLike?.username || '').trim() || 'Huấn Luyện Viên',
    avatar: normalizeAvatarUrl(userLike?.avatar),
    role: String(userLike?.role || 'user'),
    vipTierLevel: Math.max(0, parseInt(userLike?.vipTierLevel, 10) || 0),
    vipTierCode: String(userLike?.vipTierCode || '').trim().toUpperCase(),
    isOnline: Boolean(userLike?.isOnline),
    createdAt: toSafeIsoDate(userLike?.createdAt),
    lastActive: toSafeIsoDate(userLike?.lastActive),
    playTime: formatPlayTime(userLike?.createdAt),
    signature: String(userLike?.signature || '').trim(),
    showPartyInProfile: userLike?.showPartyInProfile !== false,
    vipBenefits: normalizeVipBenefits(effectiveVipBenefits),
}
}

const buildTrainerDetail = async (targetUserId, viewerUserId = '') => {
    const [user, playerState, partyRows] = await Promise.all([
        User.findById(targetUserId)
            .select(USER_SELECT_FIELDS)
            .lean(),
        PlayerState.findOne({ userId: targetUserId })
            .select('level experience moonPoints wins losses gold hp maxHp stamina maxStamina')
            .lean(),
        UserPokemon.find({
            userId: targetUserId,
            location: 'party',
        })
            .select('_id userId pokemonId nickname level formId isShiny partyIndex ivs evs')
            .populate({
                path: 'pokemonId',
                select: 'name types rarity baseStats imageUrl sprites defaultFormId forms',
            })
            .sort({ partyIndex: 1, _id: 1 })
            .lean(),
    ])

    if (!user) return null

    const vipTier = (() => {
        if (user?.vipTierId) {
            return VipPrivilegeTier.findById(user.vipTierId).select('benefits').lean()
        }
        const vipTierLevel = Math.max(0, Number.parseInt(user?.vipTierLevel, 10) || 0)
        if (vipTierLevel > 0) {
            return VipPrivilegeTier.findOne({ level: vipTierLevel }).select('benefits').lean()
        }
        return Promise.resolve(null)
    })()

    const effectiveVipBenefits = mergeVipVisualBenefits(user?.vipBenefits, (await vipTier)?.benefits)

    const slots = createEmptyPartySlots()
    for (const entry of partyRows) {
        const snapshot = serializePartyPokemon(entry)
        if (!snapshot) continue

        const slotIndex = Number(entry?.partyIndex)
        if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < slots.length && !slots[slotIndex]) {
            slots[slotIndex] = snapshot
            continue
        }

        const firstEmpty = slots.findIndex((slot) => slot === null)
        if (firstEmpty !== -1) {
            slots[firstEmpty] = snapshot
        }
    }

    const profile = {
        level: Math.max(1, Number(playerState?.level || 1)),
        experience: Number(playerState?.experience || 0),
        moonPoints: Number(playerState?.moonPoints || 0),
        wins: Number(playerState?.wins || 0),
        losses: Number(playerState?.losses || 0),
        platinumCoins: Number(playerState?.gold || 0),
        hp: Number(playerState?.hp || 100),
        maxHp: Number(playerState?.maxHp || 100),
        stamina: Number(playerState?.stamina || 100),
        maxStamina: Number(playerState?.maxStamina || 100),
    }

    const now = new Date()
    const normalizedViewerUserId = String(viewerUserId || '').trim()
    const isSelfViewer = Boolean(normalizedViewerUserId) && normalizedViewerUserId === String(user?._id || '')
    const showPartyInProfile = user?.showPartyInProfile !== false
    const canViewParty = isSelfViewer || showPartyInProfile

    return {
        userId: String(user?._id || ''),
        userIdLabel: `#${String(user?._id || '').slice(-7).toUpperCase()}`,
        username: String(user?.username || '').trim() || 'Huấn Luyện Viên',
        avatar: normalizeAvatarUrl(user?.avatar),
        signature: String(user?.signature || '').trim(),
        createdAt: toSafeIsoDate(user?.createdAt),
        lastActive: toSafeIsoDate(user?.lastActive),
        role: String(user?.role || 'user'),
        vipTierLevel: Math.max(0, parseInt(user?.vipTierLevel, 10) || 0),
        vipTierCode: String(user?.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: effectiveVipBenefits,
        isOnline: Boolean(user?.isOnline),
        showPartyInProfile,
        canViewParty,
        playTime: formatPlayTime(user?.createdAt, now),
        profile,
        party: canViewParty ? slots : createEmptyPartySlots(),
    }
}

const serializeFriendEntry = (entry, currentUserId, benefitsByUserId = null) => {
    const requesterId = getRefUserId(entry?.requesterId)
    const isRequester = requesterId === currentUserId
    const friend = isRequester ? entry?.addresseeId : entry?.requesterId

    return {
        friendshipId: String(entry?._id || ''),
        status: String(entry?.status || FRIENDSHIP_STATUS.PENDING),
        createdAt: toSafeIsoDate(entry?.createdAt),
        updatedAt: toSafeIsoDate(entry?.updatedAt),
        acceptedAt: toSafeIsoDate(entry?.acceptedAt),
        user: serializeUser(friend, benefitsByUserId),
    }
}

const serializeRequestEntry = (entry, currentUserId, benefitsByUserId = null) => {
    const requesterId = getRefUserId(entry?.requesterId)
    const direction = requesterId === currentUserId ? 'outgoing' : 'incoming'
    const counterpart = direction === 'outgoing' ? entry?.addresseeId : entry?.requesterId

    return {
        requestId: String(entry?._id || ''),
        status: String(entry?.status || FRIENDSHIP_STATUS.PENDING),
        direction,
        createdAt: toSafeIsoDate(entry?.createdAt),
        updatedAt: toSafeIsoDate(entry?.updatedAt),
        user: serializeUser(counterpart, benefitsByUserId),
    }
}

const populateFriendUsers = [
    { path: 'requesterId', select: USER_SELECT_FIELDS },
    { path: 'addresseeId', select: USER_SELECT_FIELDS },
]

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// GET /api/friends/suggestions - Gợi ý người chơi để kết bạn
router.get('/suggestions', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const limit = Math.min(20, Math.max(3, Number.parseInt(req.query.limit, 10) || 8))

        const relations = await Friendship.find({
            $or: [{ requesterId: currentUserId }, { addresseeId: currentUserId }],
        })
            .select('requesterId addresseeId')
            .lean()

        const excludedUserIds = new Set([currentUserId])
        for (const relation of relations) {
            excludedUserIds.add(String(relation?.requesterId || ''))
            excludedUserIds.add(String(relation?.addresseeId || ''))
        }

        const suggestedUsers = await User.find({
            _id: { $nin: Array.from(excludedUserIds) },
        })
            .select(USER_SELECT_FIELDS)
            .sort({ isOnline: -1, lastActive: -1, createdAt: 1, _id: 1 })
            .limit(limit)
            .lean()

        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(suggestedUsers)

        return res.json({
            ok: true,
            users: suggestedUsers.map((entry) => serializeUser(entry, benefitsByUserId)),
        })
    } catch (error) {
        console.error('GET /api/friends/suggestions error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể tải đề xuất người chơi',
        })
    }
})

// GET /api/friends/profile/:userId - Hồ sơ chi tiết người chơi
router.get('/profile/:userId', authMiddleware, async (req, res) => {
    try {
        const targetUserId = String(req.params.userId || '').trim()

        if (!mongoose.isValidObjectId(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'userId không hợp lệ' })
        }

        const trainer = await buildTrainerDetail(targetUserId, req.user.userId)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người chơi' })
        }

        return res.json({
            ok: true,
            trainer,
        })
    } catch (error) {
        console.error('GET /api/friends/profile/:userId error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể tải hồ sơ người chơi',
        })
    }
})

// GET /api/friends - Danh sách bạn bè đã chấp nhận
router.get('/', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()

        const rows = await Friendship.find({
            status: FRIENDSHIP_STATUS.ACCEPTED,
            $or: [{ requesterId: currentUserId }, { addresseeId: currentUserId }],
        })
            .populate(populateFriendUsers)
            .sort({ updatedAt: -1, _id: -1 })
            .lean()

        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(
            rows.flatMap((entry) => [entry?.requesterId, entry?.addresseeId])
        )

        const friends = rows
            .map((entry) => serializeFriendEntry(entry, currentUserId, benefitsByUserId))
            .sort((a, b) => {
                const onlineDiff = Number(b?.user?.isOnline) - Number(a?.user?.isOnline)
                if (onlineDiff !== 0) return onlineDiff
                return String(a?.user?.username || '').localeCompare(String(b?.user?.username || ''), 'vi')
            })

        return res.json({
            ok: true,
            friends,
            totalFriends: friends.length,
        })
    } catch (error) {
        console.error('GET /api/friends error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể tải danh sách bạn bè',
        })
    }
})

// GET /api/friends/requests - Danh sách lời mời kết bạn
router.get('/requests', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()

        const rows = await Friendship.find({
            status: FRIENDSHIP_STATUS.PENDING,
            $or: [{ requesterId: currentUserId }, { addresseeId: currentUserId }],
        })
            .populate(populateFriendUsers)
            .sort({ createdAt: -1, _id: -1 })
            .lean()

        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(
            rows.flatMap((entry) => [entry?.requesterId, entry?.addresseeId])
        )

        const requests = rows.map((entry) => serializeRequestEntry(entry, currentUserId, benefitsByUserId))
        const incoming = requests.filter((entry) => entry.direction === 'incoming')
        const outgoing = requests.filter((entry) => entry.direction === 'outgoing')

        return res.json({
            ok: true,
            incoming,
            outgoing,
            incomingCount: incoming.length,
            outgoingCount: outgoing.length,
        })
    } catch (error) {
        console.error('GET /api/friends/requests error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể tải danh sách lời mời kết bạn',
        })
    }
})

// POST /api/friends/requests - Gửi lời mời kết bạn
router.post('/requests', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const targetUserId = String(req.body?.userId || '').trim()

        if (!mongoose.isValidObjectId(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'userId không hợp lệ' })
        }

        if (targetUserId === currentUserId) {
            return res.status(400).json({ ok: false, message: 'Bạn không thể tự kết bạn với chính mình' })
        }

        const targetUser = await User.findById(targetUserId).select(USER_SELECT_FIELDS).lean()
        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người chơi' })
        }

        const pairKey = buildFriendPairKey(currentUserId, targetUserId)
        const existing = await Friendship.findOne({ pairKey })
            .populate(populateFriendUsers)

        if (existing) {
            if (existing.status === FRIENDSHIP_STATUS.ACCEPTED) {
                return res.status(409).json({ ok: false, message: 'Hai người đã là bạn bè' })
            }

            if (existing.status === FRIENDSHIP_STATUS.BLOCKED) {
                return res.status(403).json({ ok: false, message: 'Không thể kết bạn với người chơi này' })
            }

            const existingRequesterId = getRefUserId(existing.requesterId)
            const existingAddresseeId = getRefUserId(existing.addresseeId)

            if (existingRequesterId === currentUserId) {
                return res.status(409).json({ ok: false, message: 'Bạn đã gửi lời mời kết bạn trước đó' })
            }

            if (existingAddresseeId === currentUserId) {
                existing.status = FRIENDSHIP_STATUS.ACCEPTED
                existing.acceptedAt = new Date()
                await existing.save()
                await existing.populate(populateFriendUsers)

                const normalizedExisting = existing.toObject()
                const benefitsByUserId = await buildEffectiveVipBenefitsByUserId([
                    normalizedExisting?.requesterId,
                    normalizedExisting?.addresseeId,
                ])
                const friendshipForCurrent = serializeFriendEntry(normalizedExisting, currentUserId, benefitsByUserId)
                const friendshipForTarget = serializeFriendEntry(normalizedExisting, targetUserId, benefitsByUserId)

                emitToUser(targetUserId, 'friends:request_accepted', { friendship: friendshipForTarget })
                emitToUser(currentUserId, 'friends:request_accepted', { friendship: friendshipForCurrent })

                return res.json({
                    ok: true,
                    autoAccepted: true,
                    message: 'Đã tự động chấp nhận lời mời kết bạn từ người chơi này',
                    friendship: friendshipForCurrent,
                })
            }
        }

        const created = await Friendship.create({
            requesterId: currentUserId,
            addresseeId: targetUserId,
            status: FRIENDSHIP_STATUS.PENDING,
        })

        await created.populate(populateFriendUsers)
        const normalized = created.toObject()
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId([
            normalized?.requesterId,
            normalized?.addresseeId,
        ])
        const requestForCurrent = serializeRequestEntry(normalized, currentUserId, benefitsByUserId)
        const requestForTarget = serializeRequestEntry(normalized, targetUserId, benefitsByUserId)

        emitToUser(targetUserId, 'friends:request_received', { request: requestForTarget })

        return res.status(201).json({
            ok: true,
            message: 'Đã gửi lời mời kết bạn',
            request: requestForCurrent,
        })
    } catch (error) {
        console.error('POST /api/friends/requests error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể gửi lời mời kết bạn',
        })
    }
})

// POST /api/friends/requests/:id/accept - Chấp nhận lời mời
router.post('/requests/:id/accept', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const requestId = String(req.params.id || '').trim()

        if (!mongoose.isValidObjectId(requestId)) {
            return res.status(400).json({ ok: false, message: 'requestId không hợp lệ' })
        }

        const requestDoc = await Friendship.findOne({
            _id: requestId,
            status: FRIENDSHIP_STATUS.PENDING,
            addresseeId: currentUserId,
        }).populate(populateFriendUsers)

        if (!requestDoc) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy lời mời kết bạn' })
        }

        requestDoc.status = FRIENDSHIP_STATUS.ACCEPTED
        requestDoc.acceptedAt = new Date()
        await requestDoc.save()
        await requestDoc.populate(populateFriendUsers)

        const normalized = requestDoc.toObject()
        const requesterId = getRefUserId(normalized.requesterId)
        const addresseeId = getRefUserId(normalized.addresseeId)
        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId([
            normalized?.requesterId,
            normalized?.addresseeId,
        ])
        const friendshipForCurrent = serializeFriendEntry(normalized, currentUserId, benefitsByUserId)
        const friendshipForRequester = serializeFriendEntry(normalized, requesterId, benefitsByUserId)

        emitToUser(requesterId, 'friends:request_accepted', { friendship: friendshipForRequester })
        emitToUser(addresseeId, 'friends:request_accepted', { friendship: friendshipForCurrent })

        return res.json({
            ok: true,
            message: 'Đã chấp nhận lời mời kết bạn',
            friendship: friendshipForCurrent,
        })
    } catch (error) {
        console.error('POST /api/friends/requests/:id/accept error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể chấp nhận lời mời kết bạn',
        })
    }
})

// POST /api/friends/requests/:id/reject - Từ chối lời mời
router.post('/requests/:id/reject', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const requestId = String(req.params.id || '').trim()

        if (!mongoose.isValidObjectId(requestId)) {
            return res.status(400).json({ ok: false, message: 'requestId không hợp lệ' })
        }

        const requestDoc = await Friendship.findOne({
            _id: requestId,
            status: FRIENDSHIP_STATUS.PENDING,
            addresseeId: currentUserId,
        })

        if (!requestDoc) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy lời mời kết bạn' })
        }

        const requesterId = String(requestDoc.requesterId || '')
        await requestDoc.deleteOne()

        emitToUser(requesterId, 'friends:request_rejected', { requestId })

        return res.json({
            ok: true,
            message: 'Đã từ chối lời mời kết bạn',
        })
    } catch (error) {
        console.error('POST /api/friends/requests/:id/reject error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể từ chối lời mời kết bạn',
        })
    }
})

// DELETE /api/friends/requests/:id - Hủy lời mời đã gửi
router.delete('/requests/:id', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const requestId = String(req.params.id || '').trim()

        if (!mongoose.isValidObjectId(requestId)) {
            return res.status(400).json({ ok: false, message: 'requestId không hợp lệ' })
        }

        const requestDoc = await Friendship.findOne({
            _id: requestId,
            status: FRIENDSHIP_STATUS.PENDING,
            requesterId: currentUserId,
        })

        if (!requestDoc) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy lời mời để hủy' })
        }

        const addresseeId = String(requestDoc.addresseeId || '')
        await requestDoc.deleteOne()

        emitToUser(addresseeId, 'friends:request_cancelled', { requestId })

        return res.json({
            ok: true,
            message: 'Đã hủy lời mời kết bạn',
        })
    } catch (error) {
        console.error('DELETE /api/friends/requests/:id error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể hủy lời mời kết bạn',
        })
    }
})

// DELETE /api/friends/:friendUserId - Hủy kết bạn
router.delete('/:friendUserId', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const friendUserId = String(req.params.friendUserId || '').trim()

        if (!mongoose.isValidObjectId(friendUserId)) {
            return res.status(400).json({ ok: false, message: 'friendUserId không hợp lệ' })
        }

        if (friendUserId === currentUserId) {
            return res.status(400).json({ ok: false, message: 'Yêu cầu không hợp lệ' })
        }

        const pairKey = buildFriendPairKey(currentUserId, friendUserId)
        const friendship = await Friendship.findOne({
            pairKey,
            status: FRIENDSHIP_STATUS.ACCEPTED,
            $or: [{ requesterId: currentUserId }, { addresseeId: currentUserId }],
        })

        if (!friendship) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy mối quan hệ bạn bè' })
        }

        await friendship.deleteOne()

        emitToUser(friendUserId, 'friends:removed', { userId: currentUserId })
        emitToUser(currentUserId, 'friends:removed', { userId: friendUserId })

        return res.json({
            ok: true,
            message: 'Đã xóa bạn bè thành công',
        })
    } catch (error) {
        console.error('DELETE /api/friends/:friendUserId error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể xóa bạn bè',
        })
    }
})

// GET /api/friends/search?q=abc - Tìm người chơi để kết bạn
router.get('/search', authMiddleware, async (req, res) => {
    try {
        const currentUserId = String(req.user.userId || '').trim()
        const query = String(req.query.q || '').trim()
        const limit = Math.min(30, Math.max(1, Number.parseInt(req.query.limit, 10) || 15))

        if (query.length < 2) {
            return res.json({
                ok: true,
                users: [],
            })
        }

        const relations = await Friendship.find({
            $or: [{ requesterId: currentUserId }, { addresseeId: currentUserId }],
        })
            .select('requesterId addresseeId')
            .lean()

        const excludedUserIds = new Set([currentUserId])
        for (const relation of relations) {
            excludedUserIds.add(String(relation?.requesterId || ''))
            excludedUserIds.add(String(relation?.addresseeId || ''))
        }

        const regex = new RegExp(escapeRegex(query), 'i')
        const users = await User.find({
            _id: { $nin: Array.from(excludedUserIds) },
            username: { $regex: regex },
        })
            .select(USER_SELECT_FIELDS)
            .sort({ isOnline: -1, username: 1, _id: 1 })
            .limit(limit)
            .lean()

        const benefitsByUserId = await buildEffectiveVipBenefitsByUserId(users)

        return res.json({
            ok: true,
            users: users.map((entry) => serializeUser(entry, benefitsByUserId)),
        })
    } catch (error) {
        console.error('GET /api/friends/search error:', error)
        return res.status(500).json({
            ok: false,
            message: 'Không thể tìm người chơi',
        })
    }
})

export default router
