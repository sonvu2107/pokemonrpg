import express from 'express'
import mongoose from 'mongoose'
import PromoCode, { PROMO_CODE_REWARD_TYPES } from '../../models/PromoCode.js'
import PromoCodeClaim from '../../models/PromoCodeClaim.js'
import Item from '../../models/Item.js'
import Pokemon from '../../models/Pokemon.js'
import { normalizePokemonForms } from '../../utils/dailyCheckInUtils.js'

const router = express.Router()

const CODE_REGEX = /^[A-Z0-9_-]{3,30}$/

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseNullableDate = (value) => {
    if (value === null || value === undefined) return { ok: true, value: null }
    const raw = String(value || '').trim()
    if (!raw) return { ok: true, value: null }

    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false, message: 'Thời gian không hợp lệ' }
    }

    return { ok: true, value: parsed }
}

const normalizeItemRewardsFromDoc = (promoLike) => {
    const normalized = []
    const rewardRows = Array.isArray(promoLike?.itemRewards) ? promoLike.itemRewards : []

    rewardRows.forEach((row) => {
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
            itemId: rawItem?._id ? String(rawItem._id) : String(rawItem),
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

const deriveRewardBundleFromDoc = (entry) => {
    const rewardType = String(entry?.rewardType || 'platinumCoins')
    const legacyAmount = Math.max(1, Number.parseInt(entry?.amount, 10) || 1)

    let platinumCoinsAmount = Math.max(0, Number.parseInt(entry?.platinumCoinsAmount, 10) || 0)
    let moonPointsAmount = Math.max(0, Number.parseInt(entry?.moonPointsAmount, 10) || 0)
    const itemRewards = normalizeItemRewardsFromDoc(entry)
    let pokemonQuantity = clamp(Number.parseInt(entry?.pokemonQuantity, 10) || 0, 0, 100)

    if (rewardType === 'platinumCoins' && platinumCoinsAmount <= 0) {
        platinumCoinsAmount = legacyAmount
    }
    if (rewardType === 'moonPoints' && moonPointsAmount <= 0) {
        moonPointsAmount = legacyAmount
    }
    if (rewardType === 'pokemon' && pokemonQuantity <= 0 && entry?.pokemonId) {
        pokemonQuantity = clamp(legacyAmount, 1, 100)
    }

    const totalItemAmount = itemRewards.reduce((sum, row) => sum + Math.max(1, Number.parseInt(row?.quantity, 10) || 1), 0)
    const totalAmount = Math.max(0, platinumCoinsAmount) + Math.max(0, moonPointsAmount) + totalItemAmount + Math.max(0, pokemonQuantity)

    return {
        rewardType,
        platinumCoinsAmount,
        moonPointsAmount,
        itemRewards,
        pokemonQuantity,
        totalAmount,
    }
}

const serializePromoCode = (entry, now = new Date()) => {
    const rewardBundle = deriveRewardBundleFromDoc(entry)
    const rewardType = rewardBundle.rewardType
    const amount = Math.max(1, rewardBundle.totalAmount || Number.parseInt(entry?.amount, 10) || 1)
    const maxTotalClaims = Number.isInteger(entry?.maxTotalClaims) && Number(entry.maxTotalClaims) > 0
        ? Number(entry.maxTotalClaims)
        : null
    const claimCount = Math.max(0, Number.parseInt(entry?.claimCount, 10) || 0)
    const remainingClaims = maxTotalClaims === null
        ? null
        : Math.max(0, maxTotalClaims - claimCount)
    const startsAt = entry?.startsAt ? new Date(entry.startsAt) : null
    const endsAt = entry?.endsAt ? new Date(entry.endsAt) : null
    const isNotStarted = startsAt ? startsAt > now : false
    const isExpired = endsAt ? endsAt < now : false
    const canClaim = Boolean(entry?.isActive) && !isNotStarted && !isExpired && (remainingClaims === null || remainingClaims > 0)
    const normalizedFormId = normalizeFormId(entry?.formId || entry?.pokemonId?.defaultFormId || 'normal')

    const item = rewardBundle.itemRewards[0]?.item || null

    const pokemonForms = entry?.pokemonId ? normalizePokemonForms(entry.pokemonId) : []
    const pokemon = entry?.pokemonId && rewardBundle.pokemonQuantity > 0
        ? {
            _id: entry.pokemonId._id,
            name: entry.pokemonId.name,
            pokedexNumber: entry.pokemonId.pokedexNumber,
            defaultFormId: normalizeFormId(entry.pokemonId.defaultFormId || 'normal'),
            forms: pokemonForms.map((form) => ({
                formId: form.formId,
                formName: form.formName,
            })),
            sprite: resolvePokemonSprite(entry.pokemonId, normalizedFormId, Boolean(entry?.isShiny)),
        }
        : null

    return {
        _id: entry?._id,
        code: String(entry?.code || ''),
        title: String(entry?.title || '').trim(),
        description: String(entry?.description || '').trim(),
        rewardType,
        amount,
        platinumCoinsAmount: rewardBundle.platinumCoinsAmount,
        moonPointsAmount: rewardBundle.moonPointsAmount,
        pokemonQuantity: rewardBundle.pokemonQuantity,
        perUserLimit: clamp(Number.parseInt(entry?.perUserLimit, 10) || 1, 1, 100),
        maxTotalClaims,
        claimCount,
        remainingClaims,
        startsAt,
        endsAt,
        isActive: Boolean(entry?.isActive),
        status: {
            isNotStarted,
            isExpired,
            canClaim,
        },
        item,
        itemRewards: rewardBundle.itemRewards,
        pokemon,
        pokemonConfig: {
            formId: normalizedFormId,
            level: clamp(Number.parseInt(entry?.pokemonLevel, 10) || 5, 1, 1000),
            isShiny: Boolean(entry?.isShiny),
        },
        rewardBundle: {
            platinumCoinsAmount: rewardBundle.platinumCoinsAmount,
            moonPointsAmount: rewardBundle.moonPointsAmount,
            itemRewards: rewardBundle.itemRewards,
            pokemon: pokemon
                ? {
                    ...pokemon,
                    quantity: rewardBundle.pokemonQuantity,
                    config: {
                        formId: normalizedFormId,
                        level: clamp(Number.parseInt(entry?.pokemonLevel, 10) || 5, 1, 1000),
                        isShiny: Boolean(entry?.isShiny),
                    },
                }
                : null,
        },
        createdAt: entry?.createdAt,
        updatedAt: entry?.updatedAt,
    }
}

const parseAndValidatePayload = async (body = {}, { requireCode = true } = {}) => {
    const code = String(body?.code || '').trim().toUpperCase()
    const title = String(body?.title || '').trim().slice(0, 120)
    const description = String(body?.description || '').trim().slice(0, 400)
    const rewardTypeRaw = String(body?.rewardType || 'bundle').trim()
    let amount = Number.parseInt(body?.amount, 10)
    const perUserLimit = Number.parseInt(body?.perUserLimit, 10)
    const maxTotalClaimsRaw = body?.maxTotalClaims
    const itemIdRaw = String(body?.itemId || '').trim()
    const itemRewardsRaw = Array.isArray(body?.itemRewards) ? body.itemRewards : []
    const pokemonIdRaw = String(body?.pokemonId || '').trim()
    const formIdRaw = String(body?.formId || '').trim()
    const pokemonLevelRaw = Number.parseInt(body?.pokemonLevel, 10)
    const isShiny = Boolean(body?.isShiny)
    const platinumCoinsAmountRaw = Number.parseInt(body?.platinumCoinsAmount, 10)
    const moonPointsAmountRaw = Number.parseInt(body?.moonPointsAmount, 10)
    const pokemonQuantityRaw = Number.parseInt(body?.pokemonQuantity, 10)
    const isActive = body?.isActive === undefined ? true : Boolean(body?.isActive)

    const rewardType = rewardTypeRaw || 'bundle'

    if (requireCode) {
        if (!code) {
            throw new Error('Vui lòng nhập mã code')
        }
        if (!CODE_REGEX.test(code)) {
            throw new Error('Mã code chỉ gồm chữ, số, dấu _ hoặc -, độ dài 3-30 ký tự')
        }
    }

    if (!title) {
        throw new Error('Vui lòng nhập tiêu đề mã code')
    }

    if (!PROMO_CODE_REWARD_TYPES.includes(rewardType)) {
        throw new Error('Loại thưởng không hợp lệ')
    }

    if (!Number.isInteger(perUserLimit) || perUserLimit < 1 || perUserLimit > 100) {
        throw new Error('Giới hạn mỗi người phải từ 1 đến 100')
    }

    const startsAtParsed = parseNullableDate(body?.startsAt)
    if (!startsAtParsed.ok) {
        throw new Error('Thời gian bắt đầu không hợp lệ')
    }
    const endsAtParsed = parseNullableDate(body?.endsAt)
    if (!endsAtParsed.ok) {
        throw new Error('Thời gian kết thúc không hợp lệ')
    }

    const startsAt = startsAtParsed.value
    const endsAt = endsAtParsed.value
    if (startsAt && endsAt && endsAt < startsAt) {
        throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu')
    }

    let maxTotalClaims = null
    if (!(maxTotalClaimsRaw === null || maxTotalClaimsRaw === undefined || String(maxTotalClaimsRaw).trim() === '')) {
        const parsed = Number.parseInt(maxTotalClaimsRaw, 10)
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error('Giới hạn tổng lượt nhập phải lớn hơn 0 hoặc để trống')
        }
        maxTotalClaims = parsed
    }

    let platinumCoinsAmount = Number.isInteger(platinumCoinsAmountRaw) ? Math.max(0, platinumCoinsAmountRaw) : 0
    let moonPointsAmount = Number.isInteger(moonPointsAmountRaw) ? Math.max(0, moonPointsAmountRaw) : 0
    let pokemonQuantity = Number.isInteger(pokemonQuantityRaw) ? clamp(pokemonQuantityRaw, 0, 100) : 0

    const parsedRewards = itemRewardsRaw
        .map((entry) => ({
            itemId: String(entry?.itemId || '').trim(),
            quantity: Number.parseInt(entry?.quantity, 10),
        }))
        .filter((entry) => entry.itemId)

    if (parsedRewards.length === 0 && rewardType === 'item' && itemIdRaw) {
        parsedRewards.push({
            itemId: itemIdRaw,
            quantity: Number.isInteger(amount) && amount > 0 ? amount : 1,
        })
    }

    if (rewardType === 'platinumCoins' && platinumCoinsAmount <= 0) {
        platinumCoinsAmount = Math.max(1, Number.parseInt(amount, 10) || 1)
    }
    if (rewardType === 'moonPoints' && moonPointsAmount <= 0) {
        moonPointsAmount = Math.max(1, Number.parseInt(amount, 10) || 1)
    }
    if (rewardType === 'pokemon' && pokemonQuantity <= 0) {
        pokemonQuantity = clamp(Math.max(1, Number.parseInt(amount, 10) || 1), 1, 100)
    }

    let itemRewards = []
    if (parsedRewards.length > 0) {
        const normalizedMap = new Map()
        for (const row of parsedRewards) {
            const safeItemId = String(row.itemId || '').trim()
            const safeQty = Number.parseInt(row.quantity, 10)

            if (!mongoose.Types.ObjectId.isValid(safeItemId)) {
                throw new Error('Có vật phẩm thưởng không hợp lệ')
            }

            if (!Number.isInteger(safeQty) || safeQty <= 0) {
                throw new Error('Số lượng từng vật phẩm phải lớn hơn 0')
            }

            normalizedMap.set(safeItemId, (normalizedMap.get(safeItemId) || 0) + safeQty)
        }

        const normalizedEntries = [...normalizedMap.entries()].map(([id, qty]) => ({ itemId: id, quantity: qty }))
        const existingItems = await Item.find({ _id: { $in: normalizedEntries.map((entry) => entry.itemId) } })
            .select('_id')
            .lean()

        if (existingItems.length !== normalizedEntries.length) {
            throw new Error('Có vật phẩm thưởng không tồn tại')
        }

        itemRewards = normalizedEntries
    }

    const shouldValidatePokemon = pokemonQuantity > 0 || rewardType === 'pokemon'

    let pokemonId = null
    let formId = 'normal'
    let pokemonLevel = 5
    if (shouldValidatePokemon) {
        if (!mongoose.Types.ObjectId.isValid(pokemonIdRaw)) {
            throw new Error('Pokemon thưởng không hợp lệ')
        }

        const pokemonDoc = await Pokemon.findById(pokemonIdRaw)
            .select('defaultFormId forms')
            .lean()

        if (!pokemonDoc) {
            throw new Error('Không tìm thấy Pokemon thưởng')
        }

        const forms = normalizePokemonForms(pokemonDoc)
        const defaultFormId = normalizeFormId(pokemonDoc.defaultFormId || 'normal')
        const requestedFormId = normalizeFormId(formIdRaw || defaultFormId)
        const matchedForm = forms.find((entry) => entry.formId === requestedFormId)
            || forms.find((entry) => entry.formId === defaultFormId)
            || forms[0]

        pokemonId = pokemonIdRaw
        formId = matchedForm?.formId || 'normal'
        pokemonLevel = clamp(Number.isInteger(pokemonLevelRaw) ? pokemonLevelRaw : 5, 1, 1000)
    }

    const hasCoinReward = platinumCoinsAmount > 0
    const hasMoonReward = moonPointsAmount > 0
    const hasItemReward = itemRewards.length > 0
    const hasPokemonReward = pokemonQuantity > 0 && Boolean(pokemonId)

    if (!hasCoinReward && !hasMoonReward && !hasItemReward && !hasPokemonReward) {
        throw new Error('Mã code cần có ít nhất 1 phần thưởng')
    }

    const rewardTypeCount = [hasCoinReward, hasMoonReward, hasItemReward, hasPokemonReward].filter(Boolean).length
    let normalizedRewardType = rewardType
    if (rewardTypeCount > 1) {
        normalizedRewardType = 'bundle'
    } else if (hasCoinReward && !hasMoonReward && !hasItemReward && !hasPokemonReward) {
        normalizedRewardType = 'platinumCoins'
    } else if (!hasCoinReward && hasMoonReward && !hasItemReward && !hasPokemonReward) {
        normalizedRewardType = 'moonPoints'
    } else if (!hasCoinReward && !hasMoonReward && hasItemReward && !hasPokemonReward) {
        normalizedRewardType = 'item'
    } else if (!hasCoinReward && !hasMoonReward && !hasItemReward && hasPokemonReward) {
        normalizedRewardType = 'pokemon'
    }

    if (pokemonQuantity > 100) {
        throw new Error('Số lượng Pokemon mỗi lượt chỉ tối đa 100')
    }

    const totalItemQty = itemRewards.reduce((sum, row) => sum + row.quantity, 0)
    amount = Math.max(1, platinumCoinsAmount + moonPointsAmount + totalItemQty + pokemonQuantity)
    const itemId = itemRewards[0]?.itemId || null

    return {
        code,
        title,
        description,
        rewardType: normalizedRewardType,
        amount,
        platinumCoinsAmount,
        moonPointsAmount,
        itemId,
        itemRewards,
        pokemonId,
        formId,
        pokemonLevel,
        pokemonQuantity,
        isShiny: hasPokemonReward ? isShiny : false,
        perUserLimit,
        maxTotalClaims,
        startsAt,
        endsAt,
        isActive,
    }
}

// GET /api/admin/promo-codes
router.get('/', async (req, res) => {
    try {
        const search = String(req.query?.search || '').trim()
        const query = {}

        if (search) {
            const escaped = escapeRegExp(search)
            query.$or = [
                { code: { $regex: escaped, $options: 'i' } },
                { title: { $regex: escaped, $options: 'i' } },
            ]
        }

        const [codes, items, pokemonRows] = await Promise.all([
            PromoCode.find(query)
                .populate('itemId', 'name imageUrl type rarity')
                .populate('itemRewards.itemId', 'name imageUrl type rarity')
                .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
                .sort({ createdAt: -1 })
                .lean(),
            Item.find({})
                .select('name imageUrl type rarity')
                .sort({ nameLower: 1, _id: 1 })
                .lean(),
            Pokemon.find({})
                .select('name pokedexNumber imageUrl sprites defaultFormId forms')
                .sort({ pokedexNumber: 1, _id: 1 })
                .lean(),
        ])

        const now = new Date()

        res.json({
            ok: true,
            codes: codes.map((entry) => serializePromoCode(entry, now)),
            meta: {
                rewardTypes: PROMO_CODE_REWARD_TYPES,
                items,
                pokemon: pokemonRows.map((entry) => ({
                    _id: entry._id,
                    name: entry.name,
                    pokedexNumber: entry.pokedexNumber,
                    defaultFormId: normalizeFormId(entry.defaultFormId || 'normal'),
                    forms: normalizePokemonForms(entry).map((form) => ({
                        formId: form.formId,
                        formName: form.formName,
                    })),
                    sprite: resolvePokemonSprite(entry, normalizeFormId(entry.defaultFormId || 'normal'), false),
                })),
            },
        })
    } catch (error) {
        console.error('GET /api/admin/promo-codes error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải danh sách mã code' })
    }
})

// POST /api/admin/promo-codes
router.post('/', async (req, res) => {
    try {
        const payload = await parseAndValidatePayload(req.body, { requireCode: true })

        const created = await PromoCode.create({
            ...payload,
            createdBy: req.user?.userId || null,
            updatedBy: req.user?.userId || null,
        })

        const withRefs = await PromoCode.findById(created._id)
            .populate('itemId', 'name imageUrl type rarity')
            .populate('itemRewards.itemId', 'name imageUrl type rarity')
            .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
            .lean()

        res.json({
            ok: true,
            message: `Đã tạo mã ${payload.code}`,
            code: serializePromoCode(withRefs),
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Mã code đã tồn tại' })
        }
        console.error('POST /api/admin/promo-codes error:', error)
        res.status(400).json({ ok: false, message: error.message || 'Tạo mã code thất bại' })
    }
})

// PUT /api/admin/promo-codes/:id
router.put('/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, message: 'ID mã code không hợp lệ' })
        }

        const payload = await parseAndValidatePayload(req.body, { requireCode: true })

        const updated = await PromoCode.findByIdAndUpdate(
            id,
            {
                $set: {
                    ...payload,
                    updatedBy: req.user?.userId || null,
                },
            },
            { new: true }
        )

        if (!updated) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy mã code' })
        }

        const withRefs = await PromoCode.findById(updated._id)
            .populate('itemId', 'name imageUrl type rarity')
            .populate('itemRewards.itemId', 'name imageUrl type rarity')
            .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
            .lean()

        res.json({
            ok: true,
            message: `Đã cập nhật mã ${payload.code}`,
            code: serializePromoCode(withRefs),
        })
    } catch (error) {
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ ok: false, message: 'Mã code đã tồn tại' })
        }
        console.error('PUT /api/admin/promo-codes/:id error:', error)
        res.status(400).json({ ok: false, message: error.message || 'Cập nhật mã code thất bại' })
    }
})

// DELETE /api/admin/promo-codes/:id
router.delete('/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim()
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, message: 'ID mã code không hợp lệ' })
        }

        const deleted = await PromoCode.findByIdAndDelete(id).lean()
        if (!deleted) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy mã code' })
        }

        await PromoCodeClaim.deleteMany({ promoCodeId: id })

        res.json({
            ok: true,
            message: `Đã xóa mã ${deleted.code}`,
        })
    } catch (error) {
        console.error('DELETE /api/admin/promo-codes/:id error:', error)
        res.status(500).json({ ok: false, message: 'Xóa mã code thất bại' })
    }
})

export default router
