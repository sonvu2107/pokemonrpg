import DailyReward from '../models/DailyReward.js'

export const DAILY_REWARD_CYCLE_DAYS = 30

const buildDefaultRewardByDay = (day) => {
    if (day === DAILY_REWARD_CYCLE_DAYS) {
        return {
            day,
            rewardType: 'platinumCoins',
            amount: 12000,
            title: 'Thưởng mốc 30 ngày',
        }
    }

    if (day % 5 === 0) {
        return {
            day,
            rewardType: 'moonPoints',
            amount: 40 + day * 3,
            title: `Điểm Nguyệt Các ngày ${day}`,
        }
    }

    if (day % 2 === 0) {
        return {
            day,
            rewardType: 'moonPoints',
            amount: 20 + day * 2,
            title: `Điểm danh ngày ${day}`,
        }
    }

    return {
        day,
        rewardType: 'platinumCoins',
        amount: 800 + day * 140,
        title: `Điểm danh ngày ${day}`,
    }
}

export const DEFAULT_DAILY_REWARDS = Object.freeze(
    Array.from({ length: DAILY_REWARD_CYCLE_DAYS }, (_, index) => buildDefaultRewardByDay(index + 1))
)

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

export const normalizePokemonForms = (pokemonLike) => {
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    const sourceForms = Array.isArray(pokemonLike?.forms) && pokemonLike.forms.length > 0
        ? pokemonLike.forms
        : [{ formId: defaultFormId, formName: defaultFormId }]

    return sourceForms
        .map((form) => ({
            formId: normalizeFormId(form?.formId || defaultFormId),
            formName: String(form?.formName || '').trim() || normalizeFormId(form?.formId || defaultFormId),
            sprites: form?.sprites || {},
            imageUrl: form?.imageUrl || '',
        }))
        .filter((form, index, arr) => arr.findIndex((entry) => entry.formId === form.formId) === index)
        .sort((a, b) => {
            if (a.formId === defaultFormId) return -1
            if (b.formId === defaultFormId) return 1
            return a.formId.localeCompare(b.formId)
        })
}

const resolvePokemonRewardSprite = (pokemonLike, preferredFormId, isShiny = false) => {
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

export const toDailyDateKey = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export const getYesterdayDateKey = (date = new Date()) => {
    const yesterday = new Date(date)
    yesterday.setDate(yesterday.getDate() - 1)
    return toDailyDateKey(yesterday)
}

export const ensureDailyRewardsSeeded = async () => {
    const existing = await DailyReward.find({})
        .select('day')
        .lean()

    const existingDays = new Set(
        existing
            .map((entry) => Number(entry?.day))
            .filter((day) => Number.isInteger(day) && day >= 1 && day <= DAILY_REWARD_CYCLE_DAYS)
    )

    const missing = DEFAULT_DAILY_REWARDS.filter((entry) => !existingDays.has(entry.day))
    if (missing.length === 0) return

    await DailyReward.bulkWrite(
        missing.map((entry) => ({
            updateOne: {
                filter: { day: entry.day },
                update: {
                    $setOnInsert: {
                        day: entry.day,
                        rewardType: entry.rewardType,
                        amount: entry.amount,
                        title: entry.title,
                    },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    )
}

export const serializeDailyReward = (entry) => {
    const rawRewardType = String(entry?.rewardType || 'platinumCoins')
    const rewardType = rawRewardType === 'gold' ? 'platinumCoins' : rawRewardType
    const amount = Math.max(1, Number.parseInt(entry?.amount, 10) || 1)
    const item = entry?.itemId
        ? {
            _id: entry.itemId._id,
            name: entry.itemId.name,
            imageUrl: entry.itemId.imageUrl || '',
            type: entry.itemId.type,
            rarity: entry.itemId.rarity,
        }
        : null

    const pokemonForms = entry?.pokemonId ? normalizePokemonForms(entry.pokemonId) : []
    const normalizedFormId = normalizeFormId(entry?.formId || entry?.pokemonId?.defaultFormId || 'normal')
    const pokemon = entry?.pokemonId
        ? {
            _id: entry.pokemonId._id,
            name: entry.pokemonId.name,
            pokedexNumber: entry.pokemonId.pokedexNumber,
            defaultFormId: normalizeFormId(entry.pokemonId.defaultFormId || 'normal'),
            forms: pokemonForms.map((form) => ({
                formId: form.formId,
                formName: form.formName,
            })),
            sprite: resolvePokemonRewardSprite(entry.pokemonId, normalizedFormId, Boolean(entry?.isShiny)),
        }
        : null

    return {
        _id: entry?._id,
        day: Number(entry?.day) || 1,
        rewardType,
        amount,
        item,
        pokemon,
        pokemonConfig: {
            formId: normalizedFormId,
            level: Math.max(1, Number.parseInt(entry?.pokemonLevel, 10) || 5),
            isShiny: Boolean(entry?.isShiny),
        },
        title: String(entry?.title || '').trim(),
    }
}
