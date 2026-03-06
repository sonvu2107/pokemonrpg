import express from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import DailyActivity from '../models/DailyActivity.js'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import { authMiddleware } from '../middleware/auth.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'

const router = express.Router()
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const parseDateKey = (value = '') => {
    const raw = String(value || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
    const [y, m, d] = raw.split('-').map(Number)
    const parsed = new Date(y, m - 1, d)
    parsed.setHours(0, 0, 0, 0)
    if (Number.isNaN(parsed.getTime())) return null
    if (toDailyDateKey(parsed) !== raw) return null
    return parsed
}

const buildDateKeys = ({ days = 31, endDate = new Date() }) => {
    const safeDays = Math.min(60, Math.max(1, Number.parseInt(days, 10) || 31))
    const end = new Date(endDate)
    end.setHours(0, 0, 0, 0)

    return Array.from({ length: safeDays }, (_, index) => {
        const date = new Date(end)
        date.setDate(end.getDate() - index)
        return toDailyDateKey(date)
    })
}

const toSafePage = (value) => Math.max(1, Number.parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 35))
const STATS_CACHE_TTL_MS = 15 * 1000

let serverStatsCache = {
    value: null,
    expiresAt: 0,
}

const getServerStatsCached = async () => {
    const now = Date.now()
    if (serverStatsCache.value && serverStatsCache.expiresAt > now) {
        return serverStatsCache.value
    }

    const [totalUsers, onlineUsers] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isOnline: true }),
    ])

    const value = { totalUsers, onlineUsers }
    serverStatsCache = {
        value,
        expiresAt: now + STATS_CACHE_TTL_MS,
    }

    return value
}

const serializeWallet = (playerState) => {
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerState?.moonPoints || 0),
    }
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

const toSafeIsoDate = (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const createEmptyPartySlots = () => Array.from({ length: 6 }, () => null)

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

// GET /api/stats - Public endpoint for server statistics
router.get('/', async (req, res) => {
    try {
        const { totalUsers, onlineUsers } = await getServerStatsCached()

        res.json({
            ok: true,
            totalUsers,
            onlineUsers,
        })
    } catch (error) {
        console.error('GET /api/stats error:', error)
        res.status(500).json({
            ok: false,
            message: 'Không thể tải thống kê máy chủ'
        })
    }
})

// GET /api/stats/daily - Authenticated daily stats for current user
router.get('/daily', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const days = req.query.days
        const endDate = parseDateKey(req.query.endDate) || new Date()
        const dateKeys = buildDateKeys({ days, endDate })

        const [user, playerState, activities] = await Promise.all([
            User.findById(userId).select('username').lean(),
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            DailyActivity.find({
                userId,
                date: { $in: dateKeys },
            })
                .select('date searches mapExp moonPoints battles levels battleMoonPoints platinumCoins mines shards diamondCoins trainerExp mapStats')
                .lean(),
        ])

        const activityMap = new Map(
            (activities || []).map((entry) => [
                String(entry.date),
                {
                    searches: Number(entry.searches || 0),
                    mapExp: Number(entry.mapExp || 0),
                    moonPoints: Number(entry.moonPoints || 0),
                    battles: Number(entry.battles || 0),
                    levels: Number(entry.levels || 0),
                    battleMoonPoints: Number(entry.battleMoonPoints || 0),
                    platinumCoins: Number(entry.platinumCoins || 0),
                    mines: Number(entry.mines || 0),
                    shards: Number(entry.shards || 0),
                    diamondCoins: Number(entry.diamondCoins || 0),
                    trainerExp: Number(entry.trainerExp || 0),
                    mapStats: Array.isArray(entry.mapStats) ? entry.mapStats : [],
                },
            ])
        )

        const stats = dateKeys.map((date) => {
            const daily = activityMap.get(date) || {
                searches: 0,
                mapExp: 0,
                moonPoints: 0,
                battles: 0,
                levels: 0,
                battleMoonPoints: 0,
                platinumCoins: 0,
                mines: 0,
                shards: 0,
                diamondCoins: 0,
                trainerExp: 0,
                mapStats: [],
            }

            const mapStats = Array.isArray(daily.mapStats) ? daily.mapStats : []
            const sortedMapStats = [...mapStats].sort((a, b) => {
                const aScore = Number(a?.searches || 0) * 1000000 + Number(a?.mapExp || 0)
                const bScore = Number(b?.searches || 0) * 1000000 + Number(b?.mapExp || 0)
                return bScore - aScore
            })
            const mapSummary = mapStats.reduce((acc, row) => {
                acc.searches += Number(row?.searches || 0)
                acc.mapExp += Number(row?.mapExp || 0)
                acc.moonPoints += Number(row?.moonPoints || 0)
                return acc
            }, { searches: 0, mapExp: 0, moonPoints: 0 })

            if (mapStats.length === 0) {
                mapSummary.searches = Number(daily.searches || 0)
                mapSummary.mapExp = Number(daily.mapExp || 0)
                mapSummary.moonPoints = Number(daily.moonPoints || 0)
            }

            const mapName = sortedMapStats.length === 0
                ? '-'
                : sortedMapStats.length === 1
                    ? (String(sortedMapStats[0]?.mapName || '').trim() || '-')
                    : `${String(sortedMapStats[0]?.mapName || '').trim() || 'Nhiều bản đồ'} (+${sortedMapStats.length - 1})`

            const hasData = (
                mapSummary.searches > 0 ||
                mapSummary.mapExp > 0 ||
                mapSummary.moonPoints > 0 ||
                daily.battles > 0 ||
                daily.levels > 0 ||
                daily.battleMoonPoints > 0 ||
                daily.platinumCoins > 0 ||
                daily.mines > 0 ||
                daily.shards > 0 ||
                daily.diamondCoins > 0 ||
                daily.trainerExp > 0
            )

            return {
                date,
                hasData,
                mapName,
                searches: mapSummary.searches,
                mapMoonPoints: mapSummary.moonPoints,
                mapExp: mapSummary.mapExp,
                battles: daily.battles,
                levels: daily.levels,
                battleMoonPoints: daily.battleMoonPoints,
                platinumCoins: daily.platinumCoins,
                mines: daily.mines,
                shards: daily.shards,
                diamondCoins: daily.diamondCoins,
                trainerExp: daily.trainerExp,
            }
        })

        res.json({
            ok: true,
            user: {
                id: user?._id || userId,
                username: user?.username || 'Huấn Luyện Viên',
            },
            wallet: serializeWallet(playerState),
            stats,
        })
    } catch (error) {
        console.error('GET /api/stats/daily error:', error)
        res.status(500).json({
            ok: false,
            message: 'Không thể tải thống kê ngày'
        })
    }
})

// GET /api/stats/online/challenge/:userId - Online trainer challenge data
router.get('/online/challenge/:userId', authMiddleware, async (req, res) => {
    try {
        const targetUserId = String(req.params.userId || '').trim()
        if (!mongoose.isValidObjectId(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'userId không hợp lệ' })
        }

        const [user, playerState, partyRows] = await Promise.all([
            User.findById(targetUserId)
                .select('username avatar signature createdAt lastActive role vipTierLevel vipTierCode vipBenefits isOnline')
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

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên online' })
        }

        if (!user.isOnline) {
            return res.status(400).json({ ok: false, message: 'Huấn luyện viên này hiện không còn trực tuyến' })
        }

        const slots = createEmptyPartySlots()
        partyRows.forEach((entry) => {
            const snapshot = serializePartyPokemon(entry)
            if (!snapshot) return

            const slotIndex = Number(entry?.partyIndex)
            if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < slots.length && !slots[slotIndex]) {
                slots[slotIndex] = snapshot
                return
            }

            const firstEmpty = slots.findIndex((slot) => slot === null)
            if (firstEmpty !== -1) {
                slots[firstEmpty] = snapshot
            }
        })

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

        res.json({
            ok: true,
            trainer: {
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
                vipBenefits: {
                    title: String(user?.vipBenefits?.title || '').trim().slice(0, 80),
                    titleImageUrl: String(user?.vipBenefits?.titleImageUrl || '').trim(),
                    avatarFrameUrl: String(user?.vipBenefits?.avatarFrameUrl || '').trim(),
                    autoSearchEnabled: user?.vipBenefits?.autoSearchEnabled !== false,
                    autoSearchDurationMinutes: Math.max(0, parseInt(user?.vipBenefits?.autoSearchDurationMinutes, 10) || 0),
                    autoSearchUsesPerDay: Math.max(0, parseInt(user?.vipBenefits?.autoSearchUsesPerDay, 10) || 0),
                    autoBattleTrainerEnabled: user?.vipBenefits?.autoBattleTrainerEnabled !== false,
                    autoBattleTrainerDurationMinutes: Math.max(0, parseInt(user?.vipBenefits?.autoBattleTrainerDurationMinutes, 10) || 0),
                    autoBattleTrainerUsesPerDay: Math.max(0, parseInt(user?.vipBenefits?.autoBattleTrainerUsesPerDay, 10) || 0),
                },
                isOnline: Boolean(user?.isOnline),
                playTime: formatPlayTime(user?.createdAt, now),
                profile,
                party: slots,
            },
        })
    } catch (error) {
        console.error('GET /api/stats/online/challenge/:userId error:', error)
        res.status(500).json({
            ok: false,
            message: 'Không thể tải dữ liệu khiêu chiến online',
        })
    }
})

// GET /api/stats/online - Online trainers list
router.get('/online', authMiddleware, async (req, res) => {
    try {
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const [totalOnline, users] = await Promise.all([
            User.countDocuments({ isOnline: true }),
            User.find({ isOnline: true })
                .select('username avatar signature createdAt lastActive role vipTierLevel vipTierCode vipBenefits isOnline')
                .sort({ createdAt: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
        ])

        const now = new Date()
        const userIds = users.map((entry) => entry?._id).filter(Boolean)
        const playerStates = userIds.length === 0
            ? []
            : await PlayerState.find({ userId: { $in: userIds } })
                .select('userId level experience moonPoints wins losses gold hp maxHp stamina maxStamina')
                .lean()

        const playerStateMap = new Map(
            playerStates.map((entry) => [
                String(entry?.userId || ''),
                {
                    level: Math.max(1, Number(entry?.level || 1)),
                    experience: Number(entry?.experience || 0),
                    moonPoints: Number(entry?.moonPoints || 0),
                    wins: Number(entry?.wins || 0),
                    losses: Number(entry?.losses || 0),
                    platinumCoins: Number(entry?.gold || 0),
                    hp: Number(entry?.hp || 100),
                    maxHp: Number(entry?.maxHp || 100),
                    stamina: Number(entry?.stamina || 100),
                    maxStamina: Number(entry?.maxStamina || 100),
                },
            ])
        )

        const partyRows = userIds.length === 0
            ? []
            : await UserPokemon.find({
                userId: { $in: userIds },
                location: 'party',
            })
                .select('_id userId pokemonId nickname level formId isShiny partyIndex ivs evs')
                .populate({
                    path: 'pokemonId',
                    select: 'name types rarity baseStats imageUrl sprites defaultFormId forms',
                })
                .sort({ userId: 1, partyIndex: 1, _id: 1 })
                .lean()

        const partyMap = new Map(userIds.map((id) => [String(id), createEmptyPartySlots()]))

        partyRows.forEach((entry) => {
            const normalizedUserId = String(entry?.userId || '')
            if (!normalizedUserId) return

            if (!partyMap.has(normalizedUserId)) {
                partyMap.set(normalizedUserId, createEmptyPartySlots())
            }

            const slots = partyMap.get(normalizedUserId)
            const snapshot = serializePartyPokemon(entry)
            if (!snapshot || !Array.isArray(slots)) return

            const slotIndex = Number(entry?.partyIndex)
            if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < slots.length && !slots[slotIndex]) {
                slots[slotIndex] = snapshot
                return
            }

            const firstEmpty = slots.findIndex((slot) => slot === null)
            if (firstEmpty !== -1) {
                slots[firstEmpty] = snapshot
            }
        })

        const onlineTrainers = users.map((entry, index) => ({
            party: partyMap.get(String(entry?._id || '')) || createEmptyPartySlots(),
            userId: String(entry?._id || ''),
            rank: skip + index + 1,
            userIdLabel: `#${skip + index + 1}`,
            username: String(entry?.username || '').trim() || 'Huấn Luyện Viên',
            playTime: formatPlayTime(entry?.createdAt, now),
            avatar: normalizeAvatarUrl(entry?.avatar),
            signature: String(entry?.signature || '').trim(),
            createdAt: toSafeIsoDate(entry?.createdAt),
            lastActive: toSafeIsoDate(entry?.lastActive),
            role: String(entry?.role || 'user'),
            vipTierLevel: Math.max(0, parseInt(entry?.vipTierLevel, 10) || 0),
            vipTierCode: String(entry?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: {
                title: String(entry?.vipBenefits?.title || '').trim().slice(0, 80),
                titleImageUrl: String(entry?.vipBenefits?.titleImageUrl || '').trim(),
                avatarFrameUrl: String(entry?.vipBenefits?.avatarFrameUrl || '').trim(),
                autoSearchEnabled: entry?.vipBenefits?.autoSearchEnabled !== false,
                autoSearchDurationMinutes: Math.max(0, parseInt(entry?.vipBenefits?.autoSearchDurationMinutes, 10) || 0),
                autoSearchUsesPerDay: Math.max(0, parseInt(entry?.vipBenefits?.autoSearchUsesPerDay, 10) || 0),
                autoBattleTrainerEnabled: entry?.vipBenefits?.autoBattleTrainerEnabled !== false,
                autoBattleTrainerDurationMinutes: Math.max(0, parseInt(entry?.vipBenefits?.autoBattleTrainerDurationMinutes, 10) || 0),
                autoBattleTrainerUsesPerDay: Math.max(0, parseInt(entry?.vipBenefits?.autoBattleTrainerUsesPerDay, 10) || 0),
            },
            isOnline: Boolean(entry?.isOnline),
            profile: playerStateMap.get(String(entry?._id || '')) || {
                level: 1,
                experience: 0,
                moonPoints: 0,
                wins: 0,
                losses: 0,
                platinumCoins: 0,
                hp: 100,
                maxHp: 100,
                stamina: 100,
                maxStamina: 100,
            },
        }))

        res.json({
            ok: true,
            onlineCount: totalOnline,
            onlineTrainers,
            pagination: {
                page,
                limit,
                total: totalOnline,
                totalPages: Math.max(1, Math.ceil(totalOnline / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/stats/online error:', error)
        res.status(500).json({
            ok: false,
            message: 'Không thể tải danh sách người chơi online'
        })
    }
})

export default router
