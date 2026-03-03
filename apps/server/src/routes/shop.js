import express from 'express'
import mongoose from 'mongoose'
import { authMiddleware } from '../middleware/auth.js'
import MarketListing from '../models/MarketListing.js'
import PlayerState from '../models/PlayerState.js'
import UserPokemon from '../models/UserPokemon.js'
import User from '../models/User.js'
import Item from '../models/Item.js'
import UserInventory from '../models/UserInventory.js'
import ItemPurchaseLog from '../models/ItemPurchaseLog.js'
import Move from '../models/Move.js'
import UserMoveInventory from '../models/UserMoveInventory.js'
import MovePurchaseLog from '../models/MovePurchaseLog.js'

const router = express.Router()

const ORDER_BY_MAP = {
    date: 'listedAt',
    level: 'level',
    user: 'seller.username',
    price: 'price',
}

const toSafePage = (value) => Math.max(1, parseInt(value, 10) || 1)
const toSafeLimit = (value) => Math.min(50, Math.max(1, parseInt(value, 10) || 20))
const toSafePrice = (value) => Math.max(1, parseInt(value, 10) || 0)
const toSafeQuantity = (value) => Math.min(999, Math.max(1, parseInt(value, 10) || 1))
const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonForm = (pokemon = null, formId = null) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)

    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    let resolvedFormId = requestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return { form: resolvedForm, formId: resolvedFormId }
}

const resolvePokemonSpriteByForm = (pokemon = null, formId = null) => {
    const { form } = resolvePokemonForm(pokemon, formId)
    return form?.imageUrl
        || form?.sprites?.normal
        || form?.sprites?.icon
        || pokemon?.imageUrl
        || pokemon?.sprites?.normal
        || pokemon?.sprites?.front_default
        || ''
}

router.use(authMiddleware)

// GET /api/shop/items
router.get('/items', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit
        const type = String(req.query.type || '').trim().toLowerCase()

        const query = {
            isShopEnabled: true,
            shopPrice: { $gt: 0 },
        }
        if (type) {
            query.type = type
        }

        const [playerState, items, total] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            Item.find(query)
                .select('name type rarity imageUrl description shopPrice effectType effectValue effectValueMp')
                .sort({ shopPrice: 1, nameLower: 1, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Item.countDocuments(query),
        ])

        res.json({
            ok: true,
            wallet: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/items error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng vật phẩm' })
    }
})

// POST /api/shop/items/:itemId/buy
router.post('/items/:itemId/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const itemId = String(req.params.itemId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)

        if (!mongoose.Types.ObjectId.isValid(itemId)) {
            return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
        }

        const item = await Item.findOne({
            _id: itemId,
            isShopEnabled: true,
            shopPrice: { $gt: 0 },
        })
            .select('name shopPrice')
            .lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Vật phẩm không tồn tại hoặc không bán trong cửa hàng' })
        }

        const totalCost = Number(item.shopPrice || 0) * quantity
        if (!Number.isFinite(totalCost) || totalCost <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá mua không hợp lệ' })
        }

        const playerState = await PlayerState.findOneAndUpdate(
            {
                userId,
                gold: { $gte: totalCost },
            },
            {
                $inc: { gold: -totalCost },
            },
            { new: true }
        )

        if (!playerState) {
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua vật phẩm này' })
        }

        const inventoryEntry = await UserInventory.findOneAndUpdate(
            {
                userId,
                itemId,
            },
            {
                $setOnInsert: { userId, itemId },
                $inc: { quantity },
            },
            { new: true, upsert: true }
        )

        await ItemPurchaseLog.create({
            buyerId: userId,
            itemId,
            itemName: item.name || '',
            quantity,
            unitPrice: Number(item.shopPrice || 0),
            totalCost,
            walletGoldBefore: Number(playerState.gold || 0) + totalCost,
            walletGoldAfter: Number(playerState.gold || 0),
        })

        res.json({
            ok: true,
            message: `Mua thành công ${quantity} ${item.name}`,
            purchase: {
                itemId,
                quantity,
                unitPrice: item.shopPrice,
                totalCost,
            },
            wallet: {
                gold: Number(playerState.gold || 0),
                moonPoints: Number(playerState.moonPoints || 0),
            },
            inventory: {
                itemId,
                quantity: Number(inventoryEntry?.quantity || 0),
            },
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Xung đột dữ liệu kho đồ, vui lòng thử lại' })
        }
        console.error('POST /api/shop/items/:itemId/buy error:', error)
        res.status(500).json({ ok: false, message: 'Mua vật phẩm thất bại' })
    }
})

// GET /api/shop/skills
router.get('/skills', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const type = String(req.query.type || '').trim().toLowerCase()
        const category = String(req.query.category || '').trim().toLowerCase()
        const rarity = String(req.query.rarity || '').trim().toLowerCase()
        const sort = String(req.query.sort || '').trim().toLowerCase()

        const sortOptions = {
            price_asc: { shopPrice: 1, nameLower: 1, _id: 1 },
            price_desc: { shopPrice: -1, nameLower: 1, _id: 1 },
            type_asc: { type: 1, nameLower: 1, _id: 1 },
            type_desc: { type: -1, nameLower: 1, _id: 1 },
            rarity_asc: { rarity: 1, nameLower: 1, _id: 1 },
            rarity_desc: { rarity: -1, nameLower: 1, _id: 1 },
            name_asc: { nameLower: 1, _id: 1 },
            name_desc: { nameLower: -1, _id: 1 },
        }
        const sortQuery = sortOptions[sort] || sortOptions.price_asc

        const query = {
            isShopEnabled: true,
            isActive: true,
            shopPrice: { $gt: 0 },
        }
        if (type) {
            query.type = type
        }
        if (category) {
            query.category = category
        }
        if (rarity) {
            query.rarity = rarity
        }

        const [playerState, skills, total] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            Move.find(query)
                .select('name type category power accuracy pp priority description imageUrl rarity shopPrice learnScope allowedTypes allowedRarities')
                .sort(sortQuery)
                .skip(skip)
                .limit(limit)
                .lean(),
            Move.countDocuments(query),
        ])

        res.json({
            ok: true,
            wallet: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
            skills,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/skills error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng kỹ năng' })
    }
})

// POST /api/shop/skills/:moveId/buy
router.post('/skills/:moveId/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const moveId = String(req.params.moveId || '').trim()
        const quantity = toSafeQuantity(req.body?.quantity)

        if (!mongoose.Types.ObjectId.isValid(moveId)) {
            return res.status(400).json({ ok: false, message: 'moveId không hợp lệ' })
        }

        const move = await Move.findOne({
            _id: moveId,
            isShopEnabled: true,
            isActive: true,
            shopPrice: { $gt: 0 },
        })
            .select('name shopPrice')
            .lean()

        if (!move) {
            return res.status(404).json({ ok: false, message: 'Kỹ năng không tồn tại hoặc không bán trong cửa hàng' })
        }

        const totalCost = Number(move.shopPrice || 0) * quantity
        if (!Number.isFinite(totalCost) || totalCost <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá mua không hợp lệ' })
        }

        const playerState = await PlayerState.findOneAndUpdate(
            {
                userId,
                gold: { $gte: totalCost },
            },
            {
                $inc: { gold: -totalCost },
            },
            { new: true }
        )

        if (!playerState) {
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua kỹ năng này' })
        }

        const moveInventoryEntry = await UserMoveInventory.findOneAndUpdate(
            {
                userId,
                moveId,
            },
            {
                $setOnInsert: { userId, moveId },
                $inc: { quantity },
            },
            { new: true, upsert: true }
        )

        await MovePurchaseLog.create({
            buyerId: userId,
            moveId,
            moveName: move.name || '',
            quantity,
            unitPrice: Number(move.shopPrice || 0),
            totalCost,
            walletGoldBefore: Number(playerState.gold || 0) + totalCost,
            walletGoldAfter: Number(playerState.gold || 0),
        })

        res.json({
            ok: true,
            message: `Mua thành công ${quantity} kỹ năng ${move.name}`,
            purchase: {
                moveId,
                quantity,
                unitPrice: move.shopPrice,
                totalCost,
            },
            wallet: {
                gold: Number(playerState.gold || 0),
                moonPoints: Number(playerState.moonPoints || 0),
            },
            inventory: {
                moveId,
                quantity: Number(moveInventoryEntry?.quantity || 0),
            },
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Xung đột dữ liệu kho kỹ năng, vui lòng thử lại' })
        }
        console.error('POST /api/shop/skills/:moveId/buy error:', error)
        res.status(500).json({ ok: false, message: 'Mua kỹ năng thất bại' })
    }
})

// GET /api/shop/sell
router.get('/sell', async (req, res) => {
    try {
        const userId = req.user.userId
        const userIdObject = new mongoose.Types.ObjectId(userId)
        const activePage = toSafePage(req.query.activePage)
        const soldPage = toSafePage(req.query.soldPage)
        const limit = toSafeLimit(req.query.limit)
        const includeAvailable = String(req.query.includeAvailable || '1') !== '0'

        const availablePokemonPromise = includeAvailable
            ? UserPokemon.aggregate([
                {
                    $match: {
                        userId: userIdObject,
                        location: 'box',
                    },
                },
                {
                    $lookup: {
                        from: 'marketlistings',
                        let: { userPokemonId: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$userPokemonId', '$$userPokemonId'] },
                                            { $eq: ['$status', 'active'] },
                                        ],
                                    },
                                },
                            },
                            { $project: { _id: 1 } },
                        ],
                        as: 'activeListing',
                    },
                },
                {
                    $match: {
                        activeListing: { $eq: [] },
                    },
                },
                { $sort: { updatedAt: -1, _id: -1 } },
                { $limit: 200 },
                {
                    $lookup: {
                        from: 'pokemons',
                        localField: 'pokemonId',
                        foreignField: '_id',
                        as: 'pokemon',
                    },
                },
                {
                    $unwind: {
                        path: '$pokemon',
                        preserveNullAndEmptyArrays: true,
                    },
                },
                {
                    $project: {
                        _id: 1,
                        nickname: 1,
                        level: 1,
                        formId: 1,
                        pokemon: {
                            name: '$pokemon.name',
                            types: '$pokemon.types',
                            imageUrl: '$pokemon.imageUrl',
                            sprites: '$pokemon.sprites',
                            forms: '$pokemon.forms',
                            defaultFormId: '$pokemon.defaultFormId',
                        },
                    },
                },
            ]).allowDiskUse(true)
            : Promise.resolve([])

        const [playerState, listingFacet, availableRows] = await Promise.all([
            PlayerState.findOne({ userId }).select('gold moonPoints').lean(),
            MarketListing.aggregate([
                {
                    $match: {
                        sellerId: userIdObject,
                    },
                },
                {
                    $facet: {
                        activeRows: [
                            { $match: { status: 'active' } },
                            { $sort: { listedAt: -1, _id: -1 } },
                            { $skip: (activePage - 1) * limit },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'pokemons',
                                    localField: 'pokemonId',
                                    foreignField: '_id',
                                    as: 'pokemon',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$pokemon',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
                            {
                                $lookup: {
                                    from: 'users',
                                    localField: 'buyerId',
                                    foreignField: '_id',
                                    as: 'buyer',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$buyer',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
                            {
                                $project: {
                                    _id: 1,
                                    userPokemonId: 1,
                                    nickname: 1,
                                    formId: 1,
                                    level: 1,
                                    price: 1,
                                    otName: 1,
                                    listedAt: 1,
                                    soldAt: 1,
                                    status: 1,
                                    pokemon: {
                                        name: '$pokemon.name',
                                        types: '$pokemon.types',
                                        imageUrl: '$pokemon.imageUrl',
                                        sprites: '$pokemon.sprites',
                                        forms: '$pokemon.forms',
                                        defaultFormId: '$pokemon.defaultFormId',
                                    },
                                    buyer: {
                                        _id: '$buyer._id',
                                        username: '$buyer.username',
                                    },
                                },
                            },
                        ],
                        soldRows: [
                            { $match: { status: 'sold' } },
                            { $sort: { soldAt: -1, _id: -1 } },
                            { $skip: (soldPage - 1) * limit },
                            { $limit: limit },
                            {
                                $lookup: {
                                    from: 'pokemons',
                                    localField: 'pokemonId',
                                    foreignField: '_id',
                                    as: 'pokemon',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$pokemon',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
                            {
                                $lookup: {
                                    from: 'users',
                                    localField: 'buyerId',
                                    foreignField: '_id',
                                    as: 'buyer',
                                },
                            },
                            {
                                $unwind: {
                                    path: '$buyer',
                                    preserveNullAndEmptyArrays: true,
                                },
                            },
                            {
                                $project: {
                                    _id: 1,
                                    userPokemonId: 1,
                                    nickname: 1,
                                    formId: 1,
                                    level: 1,
                                    price: 1,
                                    otName: 1,
                                    listedAt: 1,
                                    soldAt: 1,
                                    status: 1,
                                    pokemon: {
                                        name: '$pokemon.name',
                                        types: '$pokemon.types',
                                        imageUrl: '$pokemon.imageUrl',
                                        sprites: '$pokemon.sprites',
                                        forms: '$pokemon.forms',
                                        defaultFormId: '$pokemon.defaultFormId',
                                    },
                                    buyer: {
                                        _id: '$buyer._id',
                                        username: '$buyer.username',
                                    },
                                },
                            },
                        ],
                        activeTotal: [
                            { $match: { status: 'active' } },
                            { $count: 'count' },
                        ],
                        soldTotal: [
                            { $match: { status: 'sold' } },
                            { $count: 'count' },
                        ],
                    },
                },
            ]).allowDiskUse(true),
            availablePokemonPromise,
        ])

        const listingData = listingFacet?.[0] || {}
        const activeRows = listingData.activeRows || []
        const soldRows = listingData.soldRows || []
        const activeTotal = listingData.activeTotal?.[0]?.count || 0
        const soldTotal = listingData.soldTotal?.[0]?.count || 0

        const availablePokemon = includeAvailable
            ? availableRows.map((entry) => {
                const resolvedForm = resolvePokemonForm(entry?.pokemon, entry?.formId)
                return {
                    id: entry._id,
                    pokemonName: entry.nickname || entry?.pokemon?.name || 'Pokemon',
                    speciesName: entry?.pokemon?.name || 'Pokemon',
                    level: entry.level || 1,
                    formId: resolvedForm.formId,
                    formName: resolvedForm.form?.formName || resolvedForm.formId,
                    sprite: resolvePokemonSpriteByForm(entry?.pokemon, resolvedForm.formId),
                    type: entry?.pokemon?.types || [],
                }
            })
            : null

        const mapListing = (row) => {
            const resolvedForm = resolvePokemonForm(row?.pokemon, row?.formId)
            return {
                id: row._id,
                userPokemonId: row.userPokemonId,
                pokemonName: row.nickname || row?.pokemon?.name || 'Pokemon',
                speciesName: row?.pokemon?.name || 'Pokemon',
                level: row.level || 1,
                formId: resolvedForm.formId,
                formName: resolvedForm.form?.formName || resolvedForm.formId,
                price: row.price || 0,
                otName: row.otName || '',
                listedAt: row.listedAt,
                soldAt: row.soldAt,
                sprite: resolvePokemonSpriteByForm(row?.pokemon, resolvedForm.formId),
                buyer: row?.buyer
                    ? {
                        id: row.buyer._id,
                        username: row.buyer.username || 'Không rõ',
                    }
                    : null,
                status: row.status,
            }
        }

        res.json({
            ok: true,
            wallet: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
            availablePokemon,
            activeListings: activeRows.map(mapListing),
            soldListings: soldRows.map(mapListing),
            pagination: {
                limit,
                active: {
                    page: activePage,
                    total: activeTotal,
                    totalPages: Math.max(1, Math.ceil(activeTotal / limit)),
                },
                sold: {
                    page: soldPage,
                    total: soldTotal,
                    totalPages: Math.max(1, Math.ceil(soldTotal / limit)),
                },
            },
        })
    } catch (error) {
        console.error('GET /api/shop/sell error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải dữ liệu cửa hàng bán' })
    }
})

// POST /api/shop/sell/list
router.post('/sell/list', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const userPokemonId = String(req.body?.userPokemonId || '').trim()
        const price = toSafePrice(req.body?.price)

        if (!mongoose.Types.ObjectId.isValid(userPokemonId)) {
            return res.status(400).json({ ok: false, message: 'userPokemonId không hợp lệ' })
        }
        if (!Number.isFinite(price) || price <= 0) {
            return res.status(400).json({ ok: false, message: 'Giá bán không hợp lệ' })
        }

        const userPokemon = await UserPokemon.findOne({
            _id: userPokemonId,
            userId: sellerId,
            location: 'box',
        })
            .select('pokemonId nickname formId level')
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Pokemon không tồn tại trong kho hoặc không thuộc sở hữu của bạn' })
        }

        const existingListing = await MarketListing.findOne({
            userPokemonId,
            status: 'active',
        })
            .select('_id')
            .lean()

        if (existingListing) {
            return res.status(409).json({ ok: false, message: 'Pokemon này đang được rao bán' })
        }

        const seller = await User.findById(sellerId).select('username').lean()

        await MarketListing.create({
            sellerId,
            userPokemonId,
            pokemonId: userPokemon.pokemonId,
            nickname: userPokemon.nickname || '',
            formId: userPokemon.formId || 'normal',
            level: Math.max(1, Number(userPokemon.level) || 1),
            price,
            otName: seller?.username || 'Không rõ',
            status: 'active',
            listedAt: new Date(),
        })

        res.status(201).json({ ok: true, message: 'Đăng bán Pokemon thành công!' })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Pokemon này đang được rao bán' })
        }
        console.error('POST /api/shop/sell/list error:', error)
        res.status(500).json({ ok: false, message: 'Tạo tin đăng thất bại' })
    }
})

// POST /api/shop/sell/:listingId/cancel
router.post('/sell/:listingId/cancel', async (req, res) => {
    try {
        const sellerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()

        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const cancelled = await MarketListing.findOneAndUpdate(
            {
                _id: listingId,
                sellerId,
                status: 'active',
            },
            {
                $set: {
                    status: 'cancelled',
                },
            },
            { new: true }
        )

        if (!cancelled) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng đang hoạt động để hủy' })
        }

        res.json({ ok: true, message: 'Đã hủy đăng bán Pokemon' })
    } catch (error) {
        console.error('POST /api/shop/sell/:listingId/cancel error:', error)
        res.status(500).json({ ok: false, message: 'Hủy tin đăng thất bại' })
    }
})

// GET /api/shop/buy
router.get('/buy', async (req, res) => {
    try {
        const userId = req.user.userId
        const page = toSafePage(req.query.page)
        const limit = toSafeLimit(req.query.limit)
        const skip = (page - 1) * limit

        const type = String(req.query.type || 'all').trim().toLowerCase()
        const pokemonName = String(req.query.pokemonName || 'all').trim()
        const display = String(req.query.display || 'all').trim().toLowerCase()
        const orderBy = String(req.query.orderBy || 'date').trim().toLowerCase()
        const direction = String(req.query.direction || 'desc').trim().toLowerCase() === 'asc' ? 1 : -1

        const baseMatch = {}
        if (display === 'sold_by_you') {
            baseMatch.sellerId = new mongoose.Types.ObjectId(userId)
            baseMatch.status = 'sold'
        } else {
            baseMatch.status = 'active'
            if (display === 'to_you') {
                baseMatch.reservedForUserId = new mongoose.Types.ObjectId(userId)
            }
        }

        const orderField = ORDER_BY_MAP[orderBy] || ORDER_BY_MAP.date
        const sortStage = { [orderField]: direction, _id: -1 }

        const postLookupMatch = {}
        if (type !== 'all') {
            postLookupMatch['pokemon.types'] = type
        }
        if (pokemonName !== 'all') {
            postLookupMatch['pokemon.name'] = pokemonName
        }

        const [result] = await MarketListing.aggregate([
            { $match: baseMatch },
            {
                $lookup: {
                    from: 'pokemons',
                    localField: 'pokemonId',
                    foreignField: '_id',
                    as: 'pokemon',
                },
            },
            { $unwind: '$pokemon' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'sellerId',
                    foreignField: '_id',
                    as: 'seller',
                },
            },
            {
                $unwind: {
                    path: '$seller',
                    preserveNullAndEmptyArrays: true,
                },
            },
            ...(Object.keys(postLookupMatch).length > 0 ? [{ $match: postLookupMatch }] : []),
            {
                $facet: {
                    rows: [
                        { $sort: sortStage },
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 1,
                                nickname: 1,
                                formId: 1,
                                level: 1,
                                price: 1,
                                otName: 1,
                                listedAt: 1,
                                status: 1,
                                reservedForUserId: 1,
                                pokemon: {
                                    _id: '$pokemon._id',
                                    name: '$pokemon.name',
                                    types: '$pokemon.types',
                                    imageUrl: '$pokemon.imageUrl',
                                    sprites: '$pokemon.sprites',
                                    forms: '$pokemon.forms',
                                    defaultFormId: '$pokemon.defaultFormId',
                                },
                                seller: {
                                    _id: '$seller._id',
                                    username: '$seller.username',
                                },
                            },
                        },
                    ],
                    total: [{ $count: 'count' }],
                    options: [
                        {
                            $group: {
                                _id: null,
                                types: { $addToSet: '$pokemon.types' },
                                pokemonNames: { $addToSet: '$pokemon.name' },
                            },
                        },
                    ],
                },
            },
        ]).allowDiskUse(true)

        const rows = result?.rows || []
        const total = result?.total?.[0]?.count || 0
        const optionTypesNested = result?.options?.[0]?.types || []
        const typeOptions = ['all', ...new Set(optionTypesNested.flat().map((entry) => String(entry || '').toLowerCase()).filter(Boolean))]
        const pokemonNameOptions = ['all', ...new Set((result?.options?.[0]?.pokemonNames || []).filter(Boolean).sort((a, b) => a.localeCompare(b)))]

        const playerState = await PlayerState.findOne({ userId }).select('gold moonPoints').lean()

        const listings = rows.map((row) => {
            const resolvedForm = resolvePokemonForm(row?.pokemon, row?.formId)
            const sprite = resolvePokemonSpriteByForm(row?.pokemon, resolvedForm.formId)
            return {
                id: row._id,
                pokemonName: row.nickname || row?.pokemon?.name || 'Pokemon',
                speciesName: row?.pokemon?.name || 'Pokemon',
                type: row?.pokemon?.types || [],
                level: row.level || 1,
                formId: resolvedForm.formId,
                formName: resolvedForm.form?.formName || resolvedForm.formId,
                price: row.price || 0,
                otName: row.otName || row?.seller?.username || 'Không rõ',
                seller: {
                    id: row?.seller?._id || null,
                    username: row?.seller?.username || 'Không rõ',
                },
                listedAt: row.listedAt,
                sprite,
                status: row.status,
                reservedForUserId: row.reservedForUserId || null,
            }
        })

        res.json({
            ok: true,
            listings,
            wallet: {
                gold: Number(playerState?.gold || 0),
                moonPoints: Number(playerState?.moonPoints || 0),
            },
            filters: {
                typeOptions,
                pokemonNameOptions,
            },
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        })
    } catch (error) {
        console.error('GET /api/shop/buy error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải danh sách cửa hàng' })
    }
})

// POST /api/shop/buy/:listingId
router.post('/buy/:listingId', async (req, res) => {
    try {
        const buyerId = req.user.userId
        const listingId = String(req.params.listingId || '').trim()
        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            return res.status(400).json({ ok: false, message: 'listingId không hợp lệ' })
        }

        const preview = await MarketListing.findById(listingId)
            .select('status sellerId reservedForUserId price userPokemonId')
            .lean()

        if (!preview) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy tin đăng' })
        }
        if (preview.status !== 'active') {
            return res.status(409).json({ ok: false, message: 'Tin đăng không còn khả dụng' })
        }
        if (String(preview.sellerId) === String(buyerId)) {
            return res.status(400).json({ ok: false, message: 'Bạn không thể mua tin đăng của chính mình' })
        }
        if (preview.reservedForUserId && String(preview.reservedForUserId) !== String(buyerId)) {
            return res.status(403).json({ ok: false, message: 'Tin đăng này đã dành cho người chơi khác' })
        }

        const claimedListing = await MarketListing.findOneAndUpdate(
            {
                _id: listingId,
                status: 'active',
                sellerId: { $ne: buyerId },
                ...(preview.reservedForUserId ? { reservedForUserId: buyerId } : {}),
            },
            {
                $set: {
                    status: 'sold',
                    buyerId,
                    soldAt: new Date(),
                },
            },
            { new: true }
        )

        if (!claimedListing) {
            return res.status(409).json({ ok: false, message: 'Tin đăng đã được mua' })
        }

        const buyerState = await PlayerState.findOneAndUpdate(
            { userId: buyerId, gold: { $gte: claimedListing.price } },
            { $inc: { gold: -claimedListing.price } },
            { new: true }
        )

        if (!buyerState) {
            await MarketListing.updateOne(
                { _id: claimedListing._id, status: 'sold', buyerId },
                { $set: { status: 'active', buyerId: null, soldAt: null } }
            )
            return res.status(400).json({ ok: false, message: 'Không đủ Xu Bạch Kim để mua Pokemon này' })
        }

        await PlayerState.findOneAndUpdate(
            { userId: claimedListing.sellerId },
            {
                $setOnInsert: { userId: claimedListing.sellerId },
                $inc: { gold: claimedListing.price },
            },
            { new: true, upsert: true }
        )

        const transferResult = await UserPokemon.updateOne(
            {
                _id: claimedListing.userPokemonId,
                userId: claimedListing.sellerId,
            },
            {
                $set: {
                    userId: buyerId,
                    location: 'box',
                    partyIndex: null,
                    boxNumber: 1,
                    updatedAt: new Date(),
                },
            }
        )

        if (!transferResult.modifiedCount) {
            await PlayerState.updateOne({ userId: buyerId }, { $inc: { gold: claimedListing.price } })
            await PlayerState.updateOne({ userId: claimedListing.sellerId }, { $inc: { gold: -claimedListing.price } })
            await MarketListing.updateOne(
                { _id: claimedListing._id, status: 'sold', buyerId },
                { $set: { status: 'active', buyerId: null, soldAt: null } }
            )
            return res.status(409).json({ ok: false, message: 'Chuyển Pokemon thất bại. Tin đăng đã được khôi phục.' })
        }

        res.json({ ok: true, message: 'Mua Pokemon thành công!' })
    } catch (error) {
        console.error('POST /api/shop/buy/:listingId error:', error)
        res.status(500).json({ ok: false, message: 'Hoàn tất mua thất bại' })
    }
})

export default router
