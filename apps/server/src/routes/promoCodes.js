import express from 'express'
import PromoCode from '../models/PromoCode.js'
import PromoCodeClaim from '../models/PromoCodeClaim.js'
import DailyActivity from '../models/DailyActivity.js'
import PlayerState from '../models/PlayerState.js'
import UserInventory from '../models/UserInventory.js'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import Item from '../models/Item.js'
import { authMiddleware } from '../middleware/auth.js'
import { syncUserPokedexEntriesForPokemonDocs } from '../services/userPokedexService.js'
import { emitPlayerState } from '../socket/index.js'
import { normalizePokemonForms } from '../utils/dailyCheckInUtils.js'

const router = express.Router()

const CODE_REGEX = /^[A-Z0-9_-]{3,30}$/

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const trackGiftCodePlatinumCoins = async (userId, platinumCoins = 0) => {
    const safeAmount = Math.max(0, Math.floor(Number(platinumCoins) || 0))
    if (safeAmount <= 0) return

    const date = toDailyDateKey()
    await DailyActivity.findOneAndUpdate(
        { userId, date },
        {
            $setOnInsert: { userId, date },
            $inc: { platinumCoins: safeAmount },
        },
        { upsert: true }
    )
}

router.use(authMiddleware)

const resolvePokemonSprite = (pokemonLike, preferredFormId = 'normal', isShiny = false) => {
    if (!pokemonLike) return ''

    const forms = normalizePokemonForms(pokemonLike)
    const defaultFormId = normalizeFormId(pokemonLike.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(preferredFormId || defaultFormId)
    const selectedForm = forms.find((entry) => entry.formId === requestedFormId)
        || forms.find((entry) => entry.formId === defaultFormId)
        || forms[0]
        || null

    if (isShiny) {
        return selectedForm?.sprites?.shiny
            || pokemonLike?.sprites?.shiny
            || selectedForm?.sprites?.normal
            || selectedForm?.sprites?.icon
            || selectedForm?.imageUrl
            || pokemonLike?.sprites?.normal
            || pokemonLike?.sprites?.icon
            || pokemonLike?.imageUrl
            || ''
    }

    return selectedForm?.sprites?.normal
        || selectedForm?.sprites?.icon
        || selectedForm?.imageUrl
        || pokemonLike?.sprites?.normal
        || pokemonLike?.sprites?.icon
        || pokemonLike?.imageUrl
        || ''
}

const serializeWallet = (playerState) => {
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerState?.moonPoints || 0),
    }
}

const normalizeItemRewardsFromPromo = (promoLike) => {
    const normalized = []
    const rows = Array.isArray(promoLike?.itemRewards) ? promoLike.itemRewards : []

    rows.forEach((row) => {
        const rawItem = row?.itemId
        const itemId = rawItem?._id ? String(rawItem._id) : String(rawItem || '').trim()
        const quantity = Math.max(1, Number.parseInt(row?.quantity, 10) || 1)
        if (!itemId) return

        const existing = normalized.find((entry) => entry.itemId === itemId)
        if (existing) {
            existing.quantity += quantity
            return
        }

        normalized.push({
            itemId,
            quantity,
            item: rawItem?._id
                ? {
                    _id: rawItem._id,
                    name: rawItem.name,
                    imageUrl: rawItem.imageUrl || '',
                    type: rawItem.type,
                    rarity: rawItem.rarity,
                }
                : null,
        })
    })

    if (normalized.length === 0 && promoLike?.itemId) {
        const rawItem = promoLike.itemId
        normalized.push({
            itemId: rawItem?._id ? String(rawItem._id) : String(rawItem || '').trim(),
            quantity: Math.max(1, Number.parseInt(promoLike?.amount, 10) || 1),
            item: rawItem?._id
                ? {
                    _id: rawItem._id,
                    name: rawItem.name,
                    imageUrl: rawItem.imageUrl || '',
                    type: rawItem.type,
                    rarity: rawItem.rarity,
                }
                : null,
        })
    }

    return normalized
}

const deriveRewardBundleFromPromo = (promoLike) => {
    const rewardType = String(promoLike?.rewardType || 'platinumCoins')
    const legacyAmount = Math.max(1, Number.parseInt(promoLike?.amount, 10) || 1)

    let platinumCoinsAmount = Math.max(0, Number.parseInt(promoLike?.platinumCoinsAmount, 10) || 0)
    let moonPointsAmount = Math.max(0, Number.parseInt(promoLike?.moonPointsAmount, 10) || 0)
    const itemRewards = normalizeItemRewardsFromPromo(promoLike)
    let pokemonQuantity = clamp(Number.parseInt(promoLike?.pokemonQuantity, 10) || 0, 0, 100)

    if (rewardType === 'platinumCoins' && platinumCoinsAmount <= 0) {
        platinumCoinsAmount = legacyAmount
    }
    if (rewardType === 'moonPoints' && moonPointsAmount <= 0) {
        moonPointsAmount = legacyAmount
    }
    if (rewardType === 'pokemon' && pokemonQuantity <= 0 && promoLike?.pokemonId) {
        pokemonQuantity = clamp(legacyAmount, 1, 100)
    }

    const totalItemAmount = itemRewards.reduce((sum, row) => sum + Math.max(1, Number.parseInt(row?.quantity, 10) || 1), 0)
    const totalAmount = platinumCoinsAmount + moonPointsAmount + totalItemAmount + pokemonQuantity

    return {
        rewardType,
        platinumCoinsAmount,
        moonPointsAmount,
        itemRewards,
        pokemonQuantity,
        totalAmount,
    }
}

const serializePromoSummary = (promo, now = new Date()) => {
    const rewardBundle = deriveRewardBundleFromPromo(promo)
    const maxTotalClaims = Number.isInteger(promo?.maxTotalClaims) && Number(promo.maxTotalClaims) > 0
        ? Number(promo.maxTotalClaims)
        : null
    const claimCount = Math.max(0, Number.parseInt(promo?.claimCount, 10) || 0)
    const remainingClaims = maxTotalClaims === null
        ? null
        : Math.max(0, maxTotalClaims - claimCount)
    const startsAt = promo?.startsAt ? new Date(promo.startsAt) : null
    const endsAt = promo?.endsAt ? new Date(promo.endsAt) : null
    const isNotStarted = startsAt ? startsAt > now : false
    const isExpired = endsAt ? endsAt < now : false

    return {
        _id: promo?._id,
        code: String(promo?.code || ''),
        title: String(promo?.title || '').trim(),
        description: String(promo?.description || '').trim(),
        rewardType: rewardBundle.rewardType,
        amount: Math.max(1, rewardBundle.totalAmount || Number.parseInt(promo?.amount, 10) || 1),
        platinumCoinsAmount: rewardBundle.platinumCoinsAmount,
        moonPointsAmount: rewardBundle.moonPointsAmount,
        pokemonQuantity: rewardBundle.pokemonQuantity,
        perUserLimit: clamp(Number.parseInt(promo?.perUserLimit, 10) || 1, 1, 100),
        maxTotalClaims,
        claimCount,
        remainingClaims,
        startsAt,
        endsAt,
        isActive: Boolean(promo?.isActive),
        status: {
            isNotStarted,
            isExpired,
            canClaim: Boolean(promo?.isActive)
                && !isNotStarted
                && !isExpired
                && (remainingClaims === null || remainingClaims > 0),
        },
        item: rewardBundle.itemRewards[0]?.item || null,
        itemRewards: rewardBundle.itemRewards,
    }
}

const serializeClaimHistory = (entry) => {
    const promo = entry?.promoCodeId
    const summary = promo ? serializePromoSummary(promo) : null
    const normalizedFormId = normalizeFormId(promo?.formId || promo?.pokemonId?.defaultFormId || 'normal')

    return {
        _id: entry?._id,
        claimCount: Math.max(0, Number.parseInt(entry?.claimCount, 10) || 0),
        lastClaimAt: entry?.lastClaimAt || null,
        promo: summary
            ? {
                ...summary,
                pokemon: promo?.pokemonId
                    ? {
                        _id: promo.pokemonId._id,
                        name: promo.pokemonId.name,
                        pokedexNumber: promo.pokemonId.pokedexNumber,
                        defaultFormId: normalizeFormId(promo.pokemonId.defaultFormId || 'normal'),
                        forms: normalizePokemonForms(promo.pokemonId).map((form) => ({
                            formId: form.formId,
                            formName: form.formName,
                        })),
                        sprite: resolvePokemonSprite(promo.pokemonId, normalizedFormId, Boolean(promo?.isShiny)),
                    }
                    : null,
                pokemonConfig: {
                    formId: normalizedFormId,
                    level: clamp(Number.parseInt(promo?.pokemonLevel, 10) || 5, 1, 3000),
                    isShiny: Boolean(promo?.isShiny),
                },
            }
            : null,
    }
}

// GET /api/promo-codes/history
router.get('/history', async (req, res) => {
    try {
        const userId = req.user.userId
        const limit = clamp(Number.parseInt(req.query?.limit, 10) || 20, 1, 100)

        const rows = await PromoCodeClaim.find({ userId })
            .populate({
                path: 'promoCodeId',
                select: 'code title description rewardType amount perUserLimit maxTotalClaims claimCount startsAt endsAt isActive itemId itemRewards pokemonId formId pokemonLevel isShiny platinumCoinsAmount moonPointsAmount pokemonQuantity',
                populate: [
                    { path: 'itemId', select: 'name imageUrl type rarity' },
                    { path: 'itemRewards.itemId', select: 'name imageUrl type rarity' },
                    { path: 'pokemonId', select: 'name pokedexNumber imageUrl sprites defaultFormId forms' },
                ],
            })
            .sort({ lastClaimAt: -1, updatedAt: -1 })
            .limit(limit)
            .lean()

        res.json({
            ok: true,
            history: rows.map((entry) => serializeClaimHistory(entry)),
        })
    } catch (error) {
        console.error('GET /api/promo-codes/history error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải lịch sử nhập code' })
    }
})

// POST /api/promo-codes/redeem
router.post('/redeem', async (req, res) => {
    const userId = req.user.userId
    const inputCode = String(req.body?.code || '').trim().toUpperCase()

    if (!inputCode) {
        return res.status(400).json({ ok: false, message: 'Vui lòng nhập mã code' })
    }

    if (!CODE_REGEX.test(inputCode)) {
        return res.status(400).json({ ok: false, message: 'Mã code không hợp lệ' })
    }

    let reservedPromoId = null

    try {
        const now = new Date()
        const promo = await PromoCode.findOne({ code: inputCode }).lean()

        if (!promo) {
            return res.status(404).json({ ok: false, message: 'Mã code không tồn tại' })
        }

        if (!promo.isActive) {
            return res.status(400).json({ ok: false, message: 'Mã code này đang tạm khóa' })
        }

        if (promo.startsAt && new Date(promo.startsAt) > now) {
            return res.status(400).json({ ok: false, message: 'Mã code chưa đến thời gian sử dụng' })
        }

        if (promo.endsAt && new Date(promo.endsAt) < now) {
            return res.status(400).json({ ok: false, message: 'Mã code đã hết hạn' })
        }

        const perUserLimit = clamp(Number.parseInt(promo.perUserLimit, 10) || 1, 1, 100)
        const maxTotalClaims = Number.isInteger(promo.maxTotalClaims) && Number(promo.maxTotalClaims) > 0
            ? Number(promo.maxTotalClaims)
            : null

        const reservedPromo = await PromoCode.findOneAndUpdate(
            maxTotalClaims === null
                ? { _id: promo._id, isActive: true }
                : { _id: promo._id, isActive: true, claimCount: { $lt: maxTotalClaims } },
            { $inc: { claimCount: 1 } },
            { new: true }
        ).lean()

        if (!reservedPromo) {
            return res.status(409).json({ ok: false, message: 'Mã code đã hết lượt sử dụng' })
        }

        reservedPromoId = String(promo._id)

        const existingClaim = await PromoCodeClaim.findOne({
            promoCodeId: promo._id,
            userId,
        })
            .select('claimCount')
            .lean()

        if (Number(existingClaim?.claimCount || 0) >= perUserLimit) {
            await PromoCode.updateOne(
                { _id: promo._id, claimCount: { $gt: 0 } },
                { $inc: { claimCount: -1 } }
            )
            reservedPromoId = null

            return res.status(409).json({
                ok: false,
                message: 'Bạn đã dùng hết lượt nhập mã này',
            })
        }

        const rewardBundle = deriveRewardBundleFromPromo(promo)
        const rewardType = rewardBundle.rewardType
        let claimResult = null

        const walletInc = {
            gold: Math.max(0, Number.parseInt(rewardBundle.platinumCoinsAmount, 10) || 0),
            moonPoints: Math.max(0, Number.parseInt(rewardBundle.moonPointsAmount, 10) || 0),
        }

        if (walletInc.gold > 0 || walletInc.moonPoints > 0) {
            const incPayload = {}
            if (walletInc.gold > 0) incPayload.gold = walletInc.gold
            if (walletInc.moonPoints > 0) incPayload.moonPoints = walletInc.moonPoints

            const playerState = await PlayerState.findOneAndUpdate(
                { userId },
                {
                    $setOnInsert: { userId },
                    $inc: incPayload,
                },
                { new: true, upsert: true }
            )

            emitPlayerState(String(userId), playerState)
            await trackGiftCodePlatinumCoins(userId, walletInc.gold)

            claimResult = {
                rewardType: 'bundle',
                amount: walletInc.gold + walletInc.moonPoints,
                platinumCoinsAmount: walletInc.gold,
                moonPointsAmount: walletInc.moonPoints,
                wallet: serializeWallet(playerState),
            }
        }

        if (rewardType === 'item' || rewardType === 'bundle') {
            const itemRewardRows = rewardBundle.itemRewards
            if (itemRewardRows.length === 0 && rewardType === 'item') {
                throw new Error('Mã code chưa cấu hình vật phẩm hợp lệ')
            }

            if (itemRewardRows.length > 0) {
                const itemIds = itemRewardRows.map((entry) => entry.itemId)
                const itemDocs = await Item.find({ _id: { $in: itemIds } })
                    .select('name imageUrl type rarity')
                    .lean()

                if (itemDocs.length !== itemIds.length) {
                    throw new Error('Một số vật phẩm trong mã code không còn tồn tại')
                }

                const itemMap = new Map(itemDocs.map((entry) => [String(entry._id), entry]))
                const grantedItems = []

                for (const row of itemRewardRows) {
                    const itemId = row.itemId
                    const safeQty = Math.max(1, Number.parseInt(row.quantity, 10) || 1)
                    const item = itemMap.get(String(itemId))
                    if (!item) {
                        throw new Error('Một số vật phẩm trong mã code không còn tồn tại')
                    }

                    const inventoryEntry = await UserInventory.findOneAndUpdate(
                        { userId, itemId },
                        {
                            $setOnInsert: { userId, itemId },
                            $inc: { quantity: safeQty },
                        },
                        { new: true, upsert: true }
                    )

                    grantedItems.push({
                        item: {
                            _id: item._id,
                            name: item.name,
                            imageUrl: item.imageUrl || '',
                            type: item.type,
                            rarity: item.rarity,
                        },
                        quantity: safeQty,
                        totalItemQuantity: Number(inventoryEntry?.quantity || safeQty),
                    })
                }

                const totalGrantedAmount = grantedItems.reduce((sum, entry) => sum + entry.quantity, 0)

                claimResult = {
                    ...(claimResult || {}),
                    rewardType: 'bundle',
                    amount: (claimResult?.amount || 0) + Math.max(1, totalGrantedAmount),
                    item: grantedItems[0]?.item || null,
                    itemRewards: grantedItems,
                }
            }
        }

        if (rewardType === 'pokemon' || rewardType === 'bundle') {
            const pokemonRewardQuantity = Math.max(0, Number.parseInt(rewardBundle.pokemonQuantity, 10) || 0)
            if (pokemonRewardQuantity === 0 && rewardType === 'pokemon') {
                throw new Error('Mã code chưa cấu hình Pokemon hợp lệ')
            }

            if (pokemonRewardQuantity > 0) {
                const pokemonId = promo.pokemonId
                if (!pokemonId) {
                    throw new Error('Mã code chưa cấu hình Pokemon hợp lệ')
                }

                const pokemonDoc = await Pokemon.findById(pokemonId)
                    .select('name defaultFormId forms')
                    .lean()

                if (!pokemonDoc) {
                    throw new Error('Pokemon trong mã code không còn tồn tại')
                }

                const safeQuantity = clamp(pokemonRewardQuantity, 1, 100)
                const safeLevel = clamp(Number.parseInt(promo.pokemonLevel, 10) || 5, 1, 3000)
                const requestedFormId = normalizeFormId(promo.formId || pokemonDoc.defaultFormId || 'normal')
                const availableForms = new Set(
                    (Array.isArray(pokemonDoc.forms) ? pokemonDoc.forms : [])
                        .map((entry) => normalizeFormId(entry?.formId || ''))
                        .filter(Boolean)
                )
                const defaultFormId = normalizeFormId(pokemonDoc.defaultFormId || 'normal')
                const resolvedFormId = availableForms.has(requestedFormId)
                    ? requestedFormId
                    : (availableForms.has(defaultFormId) ? defaultFormId : 'normal')

                const docs = Array.from({ length: safeQuantity }, () => ({
                    userId,
                    pokemonId,
                    level: safeLevel,
                    experience: 0,
                    formId: resolvedFormId,
                    isShiny: Boolean(promo.isShiny),
                    location: 'box',
                    moves: [],
                    movePpState: [],
                    originalTrainer: `promo_code:${promo.code}`,
                }))

                await UserPokemon.insertMany(docs)
                await syncUserPokedexEntriesForPokemonDocs(docs)

                claimResult = {
                    ...(claimResult || {}),
                    rewardType: 'bundle',
                    amount: (claimResult?.amount || 0) + safeQuantity,
                    pokemon: {
                        _id: pokemonId,
                        name: pokemonDoc.name,
                        formId: resolvedFormId,
                        level: safeLevel,
                        isShiny: Boolean(promo.isShiny),
                    },
                    pokemonQuantity: safeQuantity,
                }
            }
        }

        if (!claimResult) {
            throw new Error('Mã code chưa có phần thưởng hợp lệ')
        }

        await PromoCodeClaim.findOneAndUpdate(
            {
                promoCodeId: promo._id,
                userId,
            },
            {
                $setOnInsert: {
                    promoCodeId: promo._id,
                    userId,
                },
                $set: {
                    lastClaimAt: now,
                },
                $inc: {
                    claimCount: 1,
                },
            },
            { upsert: true }
        )

        reservedPromoId = null

        const refreshedPromo = await PromoCode.findById(promo._id)
            .populate('itemId', 'name imageUrl type rarity')
            .populate('itemRewards.itemId', 'name imageUrl type rarity')
            .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
            .select('code title description rewardType amount perUserLimit maxTotalClaims claimCount startsAt endsAt isActive itemId itemRewards pokemonId formId pokemonLevel isShiny platinumCoinsAmount moonPointsAmount pokemonQuantity')
            .lean()

        res.json({
            ok: true,
            message: `Nhập code ${promo.code} thành công`,
            promo: refreshedPromo ? serializePromoSummary(refreshedPromo) : null,
            claimResult,
        })
    } catch (error) {
        if (reservedPromoId) {
            await PromoCode.updateOne(
                { _id: reservedPromoId, claimCount: { $gt: 0 } },
                { $inc: { claimCount: -1 } }
            )
        }

        console.error('POST /api/promo-codes/redeem error:', error)
        res.status(400).json({ ok: false, message: error.message || 'Nhập code thất bại' })
    }
})

export default router
