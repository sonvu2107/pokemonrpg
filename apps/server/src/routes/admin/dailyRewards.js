import express from 'express'
import mongoose from 'mongoose'
import DailyReward, { DAILY_REWARD_TYPES } from '../../models/DailyReward.js'
import Item from '../../models/Item.js'
import Pokemon from '../../models/Pokemon.js'
import {
    DAILY_REWARD_CYCLE_DAYS,
    ensureDailyRewardsSeeded,
    normalizePokemonForms,
    serializeDailyReward,
} from '../../utils/dailyCheckInUtils.js'

const router = express.Router()

const toSafeDay = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed)) return null
    if (parsed < 1 || parsed > DAILY_REWARD_CYCLE_DAYS) return null
    return parsed
}

const toSafeAmount = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) return null
    return parsed
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const resolvePokemonSprite = (pokemonLike, preferredFormId = 'normal') => {
    if (!pokemonLike) return ''
    const forms = normalizePokemonForms(pokemonLike)
    const defaultFormId = normalizeFormId(pokemonLike.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(preferredFormId || defaultFormId)
    const selectedForm = forms.find((entry) => entry.formId === requestedFormId)
        || forms.find((entry) => entry.formId === defaultFormId)
        || forms[0]
        || null

    return selectedForm?.sprites?.normal
        || selectedForm?.sprites?.icon
        || selectedForm?.imageUrl
        || pokemonLike?.sprites?.normal
        || pokemonLike?.sprites?.icon
        || pokemonLike?.imageUrl
        || ''
}

const toPokemonLookupRow = (pokemonLike) => {
    const forms = normalizePokemonForms(pokemonLike)
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    return {
        _id: pokemonLike._id,
        name: pokemonLike.name,
        pokedexNumber: pokemonLike.pokedexNumber,
        defaultFormId,
        forms: forms.map((form) => ({
            formId: form.formId,
            formName: form.formName,
        })),
        sprite: resolvePokemonSprite(pokemonLike, defaultFormId),
    }
}

const loadRewards = async () => {
    await ensureDailyRewardsSeeded()

    const rows = await DailyReward.find({
        day: { $gte: 1, $lte: DAILY_REWARD_CYCLE_DAYS },
    })
        .populate('itemId', 'name imageUrl type rarity')
        .populate('pokemonId', 'name pokedexNumber imageUrl sprites defaultFormId forms')
        .sort({ day: 1 })
        .lean()

    return rows.map((entry) => serializeDailyReward(entry))
}

// GET /api/admin/daily-rewards - list schedule + item lookup
router.get('/', async (_req, res) => {
    try {
        const [rewards, items, pokemonRows] = await Promise.all([
            loadRewards(),
            Item.find({})
                .select('name imageUrl type rarity')
                .sort({ nameLower: 1, _id: 1 })
                .lean(),
            Pokemon.find({})
                .select('name pokedexNumber imageUrl sprites defaultFormId forms')
                .sort({ pokedexNumber: 1, _id: 1 })
                .lean(),
        ])

        const pokemon = pokemonRows.map((entry) => toPokemonLookupRow(entry))

        res.json({
            ok: true,
            rewards,
            meta: {
                rewardTypes: DAILY_REWARD_TYPES,
                cycleDays: DAILY_REWARD_CYCLE_DAYS,
                items,
                pokemon,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/daily-rewards error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải cấu hình quà hằng ngày' })
    }
})

// PUT /api/admin/daily-rewards/:day - update single day reward
router.put('/:day', async (req, res) => {
    try {
        const day = toSafeDay(req.params.day)
        if (!day) {
            return res.status(400).json({ ok: false, message: `Ngày quà không hợp lệ (1-${DAILY_REWARD_CYCLE_DAYS})` })
        }

        const rewardType = String(req.body?.rewardType || '').trim()
        const amount = toSafeAmount(req.body?.amount)
        const title = String(req.body?.title || '').trim().slice(0, 100)
        const itemIdRaw = String(req.body?.itemId || '').trim()
        const pokemonIdRaw = String(req.body?.pokemonId || '').trim()
        const formIdRaw = String(req.body?.formId || '').trim()
        const pokemonLevelRaw = Number.parseInt(req.body?.pokemonLevel, 10)
        const isShiny = rewardType === 'pokemon' ? Boolean(req.body?.isShiny) : false

        if (!DAILY_REWARD_TYPES.includes(rewardType)) {
            return res.status(400).json({ ok: false, message: 'Loại quà không hợp lệ' })
        }

        if (!amount) {
            return res.status(400).json({ ok: false, message: 'Số lượng quà phải lớn hơn 0' })
        }

        let itemId = null
        let pokemonId = null
        let formId = 'normal'
        let pokemonLevel = 5

        if (rewardType === 'item') {
            if (!mongoose.Types.ObjectId.isValid(itemIdRaw)) {
                return res.status(400).json({ ok: false, message: 'itemId không hợp lệ' })
            }

            const itemExists = await Item.exists({ _id: itemIdRaw })
            if (!itemExists) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
            }

            itemId = itemIdRaw
        }

        if (rewardType === 'pokemon') {
            if (amount > 100) {
                return res.status(400).json({ ok: false, message: 'Số lượng Pokemon tối đa mỗi ngày là 100' })
            }

            if (!mongoose.Types.ObjectId.isValid(pokemonIdRaw)) {
                return res.status(400).json({ ok: false, message: 'pokemonId không hợp lệ' })
            }

            const pokemonDoc = await Pokemon.findById(pokemonIdRaw)
                .select('defaultFormId forms')
                .lean()

            if (!pokemonDoc) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
            }

            const forms = normalizePokemonForms(pokemonDoc)
            const defaultFormId = normalizeFormId(pokemonDoc.defaultFormId || 'normal')
            const requestedFormId = normalizeFormId(formIdRaw || defaultFormId)
            const matchedForm = forms.find((entry) => entry.formId === requestedFormId)
                || forms.find((entry) => entry.formId === defaultFormId)
                || forms[0]

            pokemonId = pokemonIdRaw
            formId = matchedForm?.formId || 'normal'
            pokemonLevel = clamp(Number.isInteger(pokemonLevelRaw) ? pokemonLevelRaw : 5, 1, 2000)
        }

        await DailyReward.findOneAndUpdate(
            { day },
            {
                $setOnInsert: { day },
                $set: {
                    rewardType,
                    amount,
                    itemId,
                    pokemonId,
                    formId,
                    pokemonLevel,
                    isShiny,
                    title,
                },
            },
            { upsert: true, new: true }
        )

        const rewards = await loadRewards()
        const updatedReward = rewards.find((entry) => entry.day === day) || null

        res.json({
            ok: true,
            message: `Đã cập nhật quà ngày ${day}`,
            reward: updatedReward,
            rewards,
            meta: {
                cycleDays: DAILY_REWARD_CYCLE_DAYS,
            },
        })
    } catch (error) {
        console.error('PUT /api/admin/daily-rewards/:day error:', error)
        res.status(500).json({ ok: false, message: 'Cập nhật quà hằng ngày thất bại' })
    }
})

export default router
