import express from 'express'
import mongoose from 'mongoose'
import User from '../../models/User.js'
import Pokemon from '../../models/Pokemon.js'
import Item from '../../models/Item.js'
import UserPokemon from '../../models/UserPokemon.js'
import UserInventory from '../../models/UserInventory.js'
import {
    ADMIN_PERMISSIONS,
    ALL_ADMIN_PERMISSIONS,
    getEffectiveAdminPermissions,
    hasAdminPermission,
    normalizeAdminPermissions,
} from '../../constants/adminPermissions.js'

const router = express.Router()

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toSafeLookupLimit = (value, fallback = 25) => Math.min(100, Math.max(1, parseInt(value, 10) || fallback))
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

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

const buildMovesForLevel = (pokemon, level) => {
    const pool = Array.isArray(pokemon?.levelUpMoves) ? pokemon.levelUpMoves : []
    const learned = pool
        .filter((entry) => Number.isFinite(entry?.level) && entry.level <= level)
        .sort((a, b) => a.level - b.level)
        .map((entry) => String(entry?.moveName || '').trim())
        .filter(Boolean)
    return learned.slice(-4)
}

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
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))

        const query = {}

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
                .select('-password') // Exclude password field
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
        res.status(500).json({ ok: false, message: 'Server error' })
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

        const rows = pokemon.map((entry) => ({
            _id: entry._id,
            name: entry.name,
            pokedexNumber: entry.pokedexNumber,
            sprite: resolvePokemonSprite(entry),
            defaultFormId: normalizeFormId(entry.defaultFormId || 'normal'),
            forms: (Array.isArray(entry.forms) ? entry.forms : []).map((form) => ({
                formId: normalizeFormId(form?.formId || 'normal'),
                formName: String(form?.formName || '').trim() || normalizeFormId(form?.formId || 'normal'),
            })),
        }))

        res.json({ ok: true, pokemon: rows })
    } catch (error) {
        console.error('GET /api/admin/users/lookup/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
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
        res.status(500).json({ ok: false, message: 'Server error' })
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
            return res.status(400).json({ ok: false, message: 'Invalid user id' })
        }
        if (!mongoose.Types.ObjectId.isValid(String(pokemonId || ''))) {
            return res.status(400).json({ ok: false, message: 'Invalid pokemon id' })
        }

        const [targetUser, pokemon] = await Promise.all([
            User.findById(targetUserId).select('username').lean(),
            Pokemon.findById(pokemonId)
                .select('name defaultFormId forms levelUpMoves')
                .lean(),
        ])

        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'User not found' })
        }
        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon not found' })
        }

        const safeLevel = clamp(parseInt(level, 10) || 5, 1, 100)
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

        const moves = buildMovesForLevel(pokemon, safeLevel)
        const docs = Array.from({ length: safeQuantity }, () => ({
            userId: targetUserId,
            pokemonId,
            level: safeLevel,
            experience: 0,
            formId: resolvedFormId,
            isShiny: Boolean(isShiny),
            location: 'box',
            moves,
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
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/admin/users/:id/grant-item - Grant items to user inventory
router.post('/:id/grant-item', async (req, res) => {
    try {
        const targetUserId = String(req.params.id || '').trim()
        const { itemId, quantity = 1 } = req.body || {}

        if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
            return res.status(400).json({ ok: false, message: 'Invalid user id' })
        }
        if (!mongoose.Types.ObjectId.isValid(String(itemId || ''))) {
            return res.status(400).json({ ok: false, message: 'Invalid item id' })
        }

        const safeQuantity = clamp(parseInt(quantity, 10) || 0, 0, 99999)
        if (safeQuantity <= 0) {
            return res.status(400).json({ ok: false, message: 'Quantity must be greater than 0' })
        }

        const [targetUser, item] = await Promise.all([
            User.findById(targetUserId).select('username').lean(),
            Item.findById(itemId).select('name type rarity').lean(),
        ])

        if (!targetUser) {
            return res.status(404).json({ ok: false, message: 'User not found' })
        }
        if (!item) {
            return res.status(404).json({ ok: false, message: 'Item not found' })
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
