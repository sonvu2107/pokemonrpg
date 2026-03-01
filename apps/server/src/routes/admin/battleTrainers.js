import express from 'express'
import BattleTrainer from '../../models/BattleTrainer.js'
import Pokemon from '../../models/Pokemon.js'

const router = express.Router()

const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

const normalizeTeam = (team) => {
    if (!Array.isArray(team)) return []
    return team
        .map((entry) => ({
            pokemonId: entry?.pokemonId || entry?.pokemon || entry?._id || '',
            level: Number(entry?.level) || 5,
            formId: String(entry?.formId || 'normal').trim(),
        }))
        .filter((entry) => entry.pokemonId)
}

const validateTeam = async (team) => {
    if (!team.length) return null
    const ids = team.map((entry) => entry.pokemonId)
    const count = await Pokemon.countDocuments({ _id: { $in: ids } })
    if (count !== ids.length) return 'Đội hình chứa Pokemon id không hợp lệ'
    return null
}

const resolvePrizePokemonSelection = async (pokemonId, formId) => {
    const normalizedPokemonId = String(pokemonId || '').trim()
    if (!normalizedPokemonId) {
        return {
            prizePokemonId: null,
            prizePokemonFormId: 'normal',
            error: null,
        }
    }

    const prizePokemon = await Pokemon.findById(normalizedPokemonId)
        .select('_id forms defaultFormId')
        .lean()

    if (!prizePokemon) {
        return {
            prizePokemonId: null,
            prizePokemonFormId: 'normal',
            error: 'Pokemon phần thưởng không hợp lệ',
        }
    }

    const forms = Array.isArray(prizePokemon.forms) ? prizePokemon.forms : []
    const defaultFormId = normalizeFormId(prizePokemon.defaultFormId)
    const requestedFormId = normalizeFormId(formId)

    let resolvedFormId = requestedFormId
    if (forms.length > 0) {
        const hasRequestedForm = forms.some((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        if (!hasRequestedForm) {
            const fallbackFormId = normalizeFormId(forms[0]?.formId)
            resolvedFormId = defaultFormId || fallbackFormId || 'normal'
        }
    } else {
        resolvedFormId = defaultFormId || requestedFormId || 'normal'
    }

    return {
        prizePokemonId: prizePokemon._id,
        prizePokemonFormId: resolvedFormId,
        error: null,
    }
}

// GET /api/admin/battle-trainers
router.get('/', async (req, res) => {
    try {
        const trainers = await BattleTrainer.find()
            .sort({ orderIndex: 1, createdAt: 1 })
            .populate('team.pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .populate('prizePokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .lean()
        res.json({ ok: true, trainers })
    } catch (error) {
        console.error('GET /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/admin/battle-trainers
router.post('/', async (req, res) => {
    try {
        const {
            name,
            imageUrl,
            quote,
            isActive,
            orderIndex,
            team,
            prizePokemonId,
            prizePokemonFormId,
            platinumCoinsReward,
            expReward,
        } = req.body

        if (!name) {
            return res.status(400).json({ ok: false, message: 'Tên là bắt buộc' })
        }

        const normalizedTeam = normalizeTeam(team)
        const teamError = await validateTeam(normalizedTeam)
        if (teamError) {
            return res.status(400).json({ ok: false, message: teamError })
        }

        const resolvedPrizeSelection = await resolvePrizePokemonSelection(prizePokemonId, prizePokemonFormId)
        if (resolvedPrizeSelection.error) {
            return res.status(400).json({ ok: false, message: resolvedPrizeSelection.error })
        }

        const trainer = new BattleTrainer({
            name,
            imageUrl: imageUrl || '',
            quote: quote || '',
            isActive: isActive !== undefined ? isActive : true,
            orderIndex: orderIndex !== undefined ? orderIndex : 0,
            team: normalizedTeam,
            prizePokemonId: resolvedPrizeSelection.prizePokemonId,
            prizePokemonFormId: resolvedPrizeSelection.prizePokemonFormId,
            platinumCoinsReward: platinumCoinsReward !== undefined ? platinumCoinsReward : 0,
            expReward: expReward !== undefined ? expReward : 0,
        })

        await trainer.save()

        res.status(201).json({ ok: true, trainer })
    } catch (error) {
        console.error('POST /api/admin/battle-trainers error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/admin/battle-trainers/:id
router.put('/:id', async (req, res) => {
    try {
        const {
            name,
            imageUrl,
            quote,
            isActive,
            orderIndex,
            team,
            prizePokemonId,
            prizePokemonFormId,
            platinumCoinsReward,
            expReward,
        } = req.body

        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên' })
        }

        const normalizedTeam = normalizeTeam(team)
        const shouldUpdateTeam = team !== undefined
        if (shouldUpdateTeam) {
            const teamError = await validateTeam(normalizedTeam)
            if (teamError) {
                return res.status(400).json({ ok: false, message: teamError })
            }
        }

        if (name !== undefined) trainer.name = name
        if (imageUrl !== undefined) trainer.imageUrl = imageUrl
        if (quote !== undefined) trainer.quote = quote
        if (isActive !== undefined) trainer.isActive = isActive
        if (orderIndex !== undefined) trainer.orderIndex = orderIndex
        if (shouldUpdateTeam) trainer.team = normalizedTeam

        if (prizePokemonId !== undefined || prizePokemonFormId !== undefined) {
            const nextPrizePokemonId = prizePokemonId !== undefined ? prizePokemonId : trainer.prizePokemonId
            const nextPrizePokemonFormId = prizePokemonFormId !== undefined ? prizePokemonFormId : trainer.prizePokemonFormId
            const resolvedPrizeSelection = await resolvePrizePokemonSelection(nextPrizePokemonId, nextPrizePokemonFormId)
            if (resolvedPrizeSelection.error) {
                return res.status(400).json({ ok: false, message: resolvedPrizeSelection.error })
            }
            trainer.prizePokemonId = resolvedPrizeSelection.prizePokemonId
            trainer.prizePokemonFormId = resolvedPrizeSelection.prizePokemonFormId
        }

        if (platinumCoinsReward !== undefined) trainer.platinumCoinsReward = platinumCoinsReward
        if (expReward !== undefined) trainer.expReward = expReward

        await trainer.save()

        res.json({ ok: true, trainer })
    } catch (error) {
        console.error('PUT /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/admin/battle-trainers/:id
router.delete('/:id', async (req, res) => {
    try {
        const trainer = await BattleTrainer.findById(req.params.id)
        if (!trainer) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huấn luyện viên' })
        }
        await trainer.deleteOne()
        res.json({ ok: true, message: 'Đã xóa huấn luyện viên' })
    } catch (error) {
        console.error('DELETE /api/admin/battle-trainers/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
