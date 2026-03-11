import express from 'express'
import UserInventory from '../models/UserInventory.js'
import PlayerState from '../models/PlayerState.js'
import Encounter from '../models/Encounter.js'
import UserPokemon, { USER_POKEMON_MAX_LEVEL } from '../models/UserPokemon.js'
import MapModel from '../models/Map.js'
import BattleSession from '../models/BattleSession.js'
import BattleTrainer from '../models/BattleTrainer.js'
import User from '../models/User.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import { authMiddleware } from '../middleware/auth.js'
import { createActionGuard } from '../middleware/actionGuard.js'
import { getIO } from '../socket/index.js'
import { syncUserPokemonMovesAndPp, normalizeMoveName } from '../utils/movePpUtils.js'
import { calcMaxHp, expToNext } from '../utils/gameUtils.js'
import { resolveEffectivePokemonBaseStats, resolvePokemonFormEntry } from '../utils/pokemonFormStats.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { getMaxCatchAttempts } from '../utils/autoTrainerUtils.js'
import { applyTrainerPenaltyTurn } from '../services/trainerPenaltyTurnService.js'
import {
    appendTurnPhaseEvent,
    createTurnTimeline,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
} from '../battle/turnTimeline.js'
import {
    applyTrainerSessionForcedPlayerSwitch,
    ensureTrainerSessionPlayerParty,
    serializeTrainerPlayerPartyState,
    setTrainerSessionActivePlayerByIndex,
    syncTrainerSessionActivePlayerToParty,
} from '../services/trainerBattlePlayerStateService.js'
import { addOneMonth } from '../utils/vipStatus.js'

const router = express.Router()
const useItemActionGuard = createActionGuard({
    actionKey: 'inventory:use',
    cooldownMs: 200,
    message: 'Dùng vật phẩm quá nhanh. Vui lòng đợi một chút.',
})

const clampChance = (value, min, max) => Math.min(max, Math.max(min, value))
const LOW_HP_CATCH_BONUS_CAP_BY_RARITY = Object.freeze({
    'sss+': 10,
    d: 31,
    c: 29,
    b: 27,
    a: 25,
    s: 21,
    ss: 17,
    sss: 14,
})
const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 23
const MAP_RARITY_CATCH_BONUS_KEYS = Object.freeze(['s', 'ss', 'sss', 'sss+'])
const MAP_RARITY_CATCH_BONUS_MIN_PERCENT = -95
const MAP_RARITY_CATCH_BONUS_MAX_PERCENT = 500

const normalizeMapRarityCatchBonusPercent = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return MAP_RARITY_CATCH_BONUS_KEYS.reduce((acc, key) => {
        const parsed = Number(source?.[key])
        acc[key] = Number.isFinite(parsed)
            ? clampChance(parsed, MAP_RARITY_CATCH_BONUS_MIN_PERCENT, MAP_RARITY_CATCH_BONUS_MAX_PERCENT)
            : 0
        return acc
    }, {})
}

const resolveMapRarityCatchBonusPercent = ({ mapLike, rarity }) => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    if (!MAP_RARITY_CATCH_BONUS_KEYS.includes(normalizedRarity)) return 0
    const normalizedMapBonus = normalizeMapRarityCatchBonusPercent(mapLike?.rarityCatchBonusPercent)
    return Number(normalizedMapBonus?.[normalizedRarity] || 0)
}

const serializePlayerWallet = (playerState) => {
    const platinumCoins = Number(playerState?.gold || 0)
    return {
        platinumCoins,
        moonPoints: Number(playerState?.moonPoints || 0),
    }
}

const calcCatchChance = ({ catchRate, hp, maxHp }) => {
    const rate = Math.min(255, Math.max(1, catchRate || 45))
    const hpFactor = (3 * maxHp - 2 * hp) / (3 * maxHp)
    const raw = (rate / 255) * hpFactor
    return clampChance(raw, 0.02, 0.95)
}

const resolveLowHpCatchBonusCapPercent = (rarity = '') => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    const capFromRarity = Number(LOW_HP_CATCH_BONUS_CAP_BY_RARITY[normalizedRarity])
    if (Number.isFinite(capFromRarity) && capFromRarity >= 0) return capFromRarity
    return LOW_HP_CATCH_BONUS_CAP_FALLBACK
}

const calcLowHpCatchBonusPercent = ({ hp, maxHp, rarity }) => {
    const normalizedMaxHp = Math.max(1, Number(maxHp) || 1)
    const resolvedHp = Number.isFinite(Number(hp)) ? Number(hp) : normalizedMaxHp
    const normalizedHp = clampChance(resolvedHp, 0, normalizedMaxHp)
    const missingHpRatio = (normalizedMaxHp - normalizedHp) / normalizedMaxHp
    const capPercent = resolveLowHpCatchBonusCapPercent(rarity)
    return Math.max(0, missingHpRatio * capPercent)
}

const normalizeVipVisualBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
    }
}

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipVisualBenefits(currentBenefitsLike)
    const tier = normalizeVipVisualBenefits(tierBenefitsLike)
    return {
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
    }
}

const resolveVipTierBenefitsForUser = async (userLike) => {
    if (!userLike) return {}

    if (userLike?.vipTierId) {
        const tier = await VipPrivilegeTier.findById(userLike.vipTierId)
            .select('benefits')
            .lean()
        return tier?.benefits || {}
    }

    const vipTierLevel = Math.max(0, Number.parseInt(userLike?.vipTierLevel, 10) || 0)
    if (vipTierLevel > 0) {
        const tier = await VipPrivilegeTier.findOne({ level: vipTierLevel })
            .select('benefits')
            .lean()
        return tier?.benefits || {}
    }

    return {}
}

const resolveEffectiveVipVisualBenefits = async (userLike) => {
    if (!userLike) return normalizeVipVisualBenefits({})
    const tierBenefits = await resolveVipTierBenefitsForUser(userLike)
    return mergeVipVisualBenefits(userLike?.vipBenefits, tierBenefits)
}

const getBallCatchChance = ({ item, baseChance, hp, maxHp, rarity, rarityCatchBonusPercent = 0 }) => {
    const hasFixedCatchRate = item?.effectType === 'catchMultiplier' && Number.isFinite(Number(item.effectValue))
    const chanceBeforeLowHpBonus = hasFixedCatchRate
        ? clampChance(Number(item.effectValue) / 100, 0, 1)
        : clampChance(
            clampChance(baseChance, 0.02, 0.95) * (1 + ((Number(rarityCatchBonusPercent) || 0) / 100)),
            0.02,
            0.95
        )
    const lowHpCatchBonusPercent = calcLowHpCatchBonusPercent({ hp, maxHp, rarity })
    const minChance = hasFixedCatchRate ? 0 : 0.02

    return {
        chance: clampChance(
            chanceBeforeLowHpBonus * (1 + (lowHpCatchBonusPercent / 100)),
            minChance,
            0.99
        ),
        lowHpCatchBonusPercent,
    }
}

const getHealAmounts = (item) => {
    if (item?.effectType === 'heal' || item?.effectType === 'healAmount') {
        const hpAmount = Number.isFinite(item.effectValue) ? item.effectValue : 0
        const ppAmount = Number.isFinite(item.effectValueMp) ? item.effectValueMp : 0
        return { hpAmount, ppAmount }
    }
    return { hpAmount: 0, ppAmount: 0 }
}

const applyExperienceGainToUserPokemon = (userPokemon, expAmount = 0) => {
    const safeExpAmount = Math.max(0, Math.floor(Number(expAmount) || 0))
    const expBefore = Math.max(0, Math.floor(Number(userPokemon?.experience) || 0))
    let levelsGained = 0

    if (userPokemon.level >= USER_POKEMON_MAX_LEVEL) {
        userPokemon.level = USER_POKEMON_MAX_LEVEL
        userPokemon.experience = 0
        return {
            expBefore,
            expAfter: 0,
            expGained: 0,
            levelsGained: 0,
            level: userPokemon.level,
            expToNext: 0,
        }
    }

    userPokemon.experience = expBefore + safeExpAmount
    while (
        userPokemon.level < USER_POKEMON_MAX_LEVEL
        && userPokemon.experience >= expToNext(userPokemon.level)
    ) {
        userPokemon.experience -= expToNext(userPokemon.level)
        userPokemon.level += 1
        levelsGained += 1
    }

    if (userPokemon.level >= USER_POKEMON_MAX_LEVEL) {
        userPokemon.level = USER_POKEMON_MAX_LEVEL
        userPokemon.experience = 0
    }

    return {
        expBefore,
        expAfter: Math.max(0, Math.floor(Number(userPokemon.experience) || 0)),
        expGained: safeExpAmount,
        levelsGained,
        level: Math.max(1, Math.floor(Number(userPokemon.level) || 1)),
        expToNext: userPokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : expToNext(userPokemon.level),
    }
}

const applyLevelGainToUserPokemon = (userPokemon, levelAmount = 0) => {
    const safeLevelAmount = Math.max(0, Math.floor(Number(levelAmount) || 0))
    const levelBefore = Math.max(1, Math.floor(Number(userPokemon?.level) || 1))
    const expBefore = Math.max(0, Math.floor(Number(userPokemon?.experience) || 0))

    if (levelBefore >= USER_POKEMON_MAX_LEVEL) {
        userPokemon.level = USER_POKEMON_MAX_LEVEL
        userPokemon.experience = 0
        return {
            levelBefore,
            levelAfter: USER_POKEMON_MAX_LEVEL,
            levelsGained: 0,
            expBefore,
            expAfter: 0,
            expToNext: 0,
        }
    }

    const levelsGained = Math.max(0, Math.min(safeLevelAmount, USER_POKEMON_MAX_LEVEL - levelBefore))
    userPokemon.level = levelBefore + levelsGained

    if (userPokemon.level >= USER_POKEMON_MAX_LEVEL) {
        userPokemon.level = USER_POKEMON_MAX_LEVEL
        userPokemon.experience = 0
    }

    return {
        levelBefore,
        levelAfter: Math.max(1, Math.floor(Number(userPokemon.level) || 1)),
        levelsGained,
        expBefore,
        expAfter: Math.max(0, Math.floor(Number(userPokemon.experience) || 0)),
        expToNext: userPokemon.level >= USER_POKEMON_MAX_LEVEL ? 0 : expToNext(userPokemon.level),
    }
}

const sanitizeObjectIdToken = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (/^[a-f\d]{24}$/i.test(raw)) return raw
    const objectIdMatch = raw.match(/ObjectId\(["']?([a-f\d]{24})["']?\)/i)
    if (objectIdMatch?.[1]) return objectIdMatch[1]
    return ''
}

const normalizeObjectIdInput = (value) => {
    if (typeof value === 'string') return sanitizeObjectIdToken(value)
    if (typeof value === 'number' && Number.isFinite(value)) return sanitizeObjectIdToken(String(value))
    if (value && typeof value === 'object') {
        if (typeof value.$oid === 'string') return sanitizeObjectIdToken(value.$oid)
        if (typeof value._id === 'string') return sanitizeObjectIdToken(value._id)
        if (typeof value.id === 'string') return sanitizeObjectIdToken(value.id)
        if (value._id && typeof value._id === 'object') {
            const nestedId = normalizeObjectIdInput(value._id)
            if (nestedId) return nestedId
        }
        if (typeof value.toHexString === 'function') {
            try {
                return sanitizeObjectIdToken(value.toHexString())
            } catch {
                return ''
            }
        }
    }
    return ''
}

const isValidObjectIdLike = (value = '') => /^[a-f\d]{24}$/i.test(String(value || '').trim())
const ALLOWED_ITEM_USE_BATTLE_MODES = new Set(['trainer', 'duel', 'online'])

const normalizeItemUseBattleMode = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    return ALLOWED_ITEM_USE_BATTLE_MODES.has(normalized) ? normalized : ''
}

const addMonthsFromBase = (baseValue = new Date(), months = 1) => {
    let nextDate = baseValue instanceof Date ? new Date(baseValue) : new Date(baseValue)
    if (Number.isNaN(nextDate.getTime())) {
        nextDate = new Date()
    }

    const totalMonths = Math.max(1, Math.floor(Number(months) || 1))
    for (let index = 0; index < totalMonths; index += 1) {
        nextDate = addOneMonth(nextDate) || nextDate
    }
    return nextDate
}

const addWeeksFromBase = (baseValue = new Date(), weeks = 1) => {
    let nextDate = baseValue instanceof Date ? new Date(baseValue) : new Date(baseValue)
    if (Number.isNaN(nextDate.getTime())) {
        nextDate = new Date()
    }

    const totalWeeks = Math.max(1, Math.floor(Number(weeks) || 1))
    nextDate.setDate(nextDate.getDate() + (totalWeeks * 7))
    return nextDate
}

const resetDailyAutoUsage = (userDoc) => {
    if (!userDoc || typeof userDoc !== 'object') return

    const toPlainObject = (value) => {
        if (!value || typeof value !== 'object') return {}
        if (typeof value.toObject === 'function') {
            return value.toObject()
        }
        return value
    }
    const isRecord = (value) => (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    )

    const autoSearch = toPlainObject(userDoc.autoSearch)
    const autoTrainer = toPlainObject(userDoc.autoTrainer)
    const actionByRarity = toPlainObject(autoSearch.actionByRarity)
    const history = toPlainObject(autoSearch.history)
    const autoSearchLastAction = toPlainObject(autoSearch.lastAction)
    const autoTrainerLastAction = toPlainObject(autoTrainer.lastAction)

    userDoc.autoSearch = {
        ...autoSearch,
        actionByRarity: isRecord(actionByRarity)
            ? actionByRarity
            : {
                'sss+': 'catch',
                sss: 'catch',
                ss: 'catch',
                s: 'catch',
                a: 'battle',
                b: 'battle',
                c: 'battle',
                d: 'battle',
            },
        history: isRecord(history)
            ? history
            : {
                foundPokemonCount: 0,
                itemDropCount: 0,
                itemDropQuantity: 0,
                runCount: 0,
                battleCount: 0,
                catchAttemptCount: 0,
                catchSuccessCount: 0,
            },
        lastAction: isRecord(autoSearchLastAction)
            ? autoSearchLastAction
            : {
                action: '',
                result: '',
                reason: '',
                targetId: '',
                at: null,
            },
        enabled: false,
        startedAt: null,
        dayCount: 0,
        dayRuntimeMs: 0,
        lastRuntimeAt: null,
    }

    userDoc.autoTrainer = {
        ...autoTrainer,
        lastAction: isRecord(autoTrainerLastAction)
            ? autoTrainerLastAction
            : {
                action: '',
                result: '',
                reason: '',
                targetId: '',
                at: null,
            },
        enabled: false,
        startedAt: null,
        dayCount: 0,
        dayRuntimeMs: 0,
        lastRuntimeAt: null,
    }
}

const normalizeItemUseContext = (requestBody = {}) => {
    const body = requestBody && typeof requestBody === 'object' ? requestBody : {}
    const rawContext = body.context && typeof body.context === 'object' ? body.context : {}
    const mode = normalizeItemUseBattleMode(rawContext.mode ?? body.mode)
    const trainerId = normalizeObjectIdInput(rawContext.trainerId ?? body.trainerId)
    const playerCurrentHpRaw = Number(rawContext.playerCurrentHp ?? body.playerCurrentHp)
    const playerMaxHpRaw = Number(rawContext.playerMaxHp ?? body.playerMaxHp)

    return {
        mode,
        trainerId: isValidObjectIdLike(trainerId) ? trainerId : '',
        playerCurrentHp: Number.isFinite(playerCurrentHpRaw) ? Math.max(0, Math.floor(playerCurrentHpRaw)) : null,
        playerMaxHp: Number.isFinite(playerMaxHpRaw) ? Math.max(1, Math.floor(playerMaxHpRaw)) : null,
    }
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const resolvePokemonImageForEncounter = (pokemon, formId, isShiny = false) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
    const normalSprite = resolvedForm?.imageUrl
        || resolvedForm?.sprites?.normal
        || resolvedForm?.sprites?.icon
        || pokemon?.imageUrl
        || pokemon?.sprites?.normal
        || pokemon?.sprites?.front_default
        || ''

    if (isShiny) {
        return resolvedForm?.sprites?.shiny || pokemon?.sprites?.shiny || normalSprite
    }

    return normalSprite
}

router.use(authMiddleware)
router.get('/', async (req, res) => {
    try {
        const userId = req.user.userId
        const [items, playerState] = await Promise.all([
            UserInventory.find({ userId })
                .populate('itemId')
                .lean(),
            PlayerState.findOne({ userId })
                .select('gold moonPoints')
                .lean(),
        ])

        const inventory = items.map((entry) => ({
            _id: entry._id,
            item: entry.itemId,
            quantity: entry.quantity,
        }))

        res.json({
            ok: true,
            inventory,
            playerState: serializePlayerWallet(playerState),
        })
    } catch (error) {
        console.error('GET /api/inventory error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

router.post('/use', useItemActionGuard, async (req, res) => {
    try {
        const requestBody = req.body && typeof req.body === 'object' ? req.body : {}
        const {
            itemId,
            quantity = 1,
            encounterId,
            activePokemonId = null,
            moveName = '',
            sourcePokemonId = null,
        } = requestBody
        const qty = Number(quantity)
        const userId = req.user.userId
        const normalizedItemId = normalizeObjectIdInput(itemId)
        const normalizedEncounterId = normalizeObjectIdInput(encounterId)
        const normalizedActivePokemonId = normalizeObjectIdInput(activePokemonId)
        const normalizedSourcePokemonId = normalizeObjectIdInput(sourcePokemonId)
        const itemUseContext = normalizeItemUseContext(requestBody)

        if (!normalizedItemId || !isValidObjectIdLike(normalizedItemId) || !Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ ok: false, message: 'Vật phẩm hoặc số lượng không hợp lệ' })
        }

        const Item = (await import('../models/Item.js')).default
        const item = await Item.findById(normalizedItemId).lean()

        if (!item) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy vật phẩm' })
        }

        if (item.type === 'pokeball') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Pokeball chỉ được dùng từng quả một' })
            }

            if (!normalizedEncounterId || !isValidObjectIdLike(normalizedEncounterId)) {
                return res.status(400).json({ ok: false, message: 'Cần trong trận chiến để dùng pokeball' })
            }

            const encounter = await Encounter.findOne({ _id: normalizedEncounterId, userId, isActive: true })
                .select('pokemonId mapId level hp maxHp isShiny formId catchAttempts')
                .lean()
            if (!encounter) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy trận chiến hoặc đã kết thúc. Vui lòng tải lại.' })
            }

            const consumedEntry = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedEntry) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            if (consumedEntry.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
            }

            const Pokemon = (await import('../models/Pokemon.js')).default
            const pokemon = await Pokemon.findById(encounter.pokemonId)
                .select('name pokedexNumber baseStats catchRate levelUpMoves rarity imageUrl forms sprites defaultFormId')
                .lean()

            if (!pokemon) {
                await UserInventory.updateOne(
                    { userId, itemId: normalizedItemId },
                    { $inc: { quantity: qty } },
                    { upsert: true }
                )
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
            }

            const encounterMap = encounter?.mapId
                ? await MapModel.findById(encounter.mapId)
                    .select('name rarityCatchBonusPercent')
                    .lean()
                : null
            const mapRarityCatchBonusPercent = resolveMapRarityCatchBonusPercent({
                mapLike: encounterMap,
                rarity: pokemon?.rarity,
            })

            const baseChance = calcCatchChance({
                catchRate: pokemon.catchRate,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
            })
            const { chance, lowHpCatchBonusPercent } = getBallCatchChance({
                item,
                baseChance,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                rarity: pokemon?.rarity,
                rarityCatchBonusPercent: mapRarityCatchBonusPercent,
            })
            const caught = Math.random() < chance

            if (caught) {
                const resolvedEncounter = await Encounter.findOneAndUpdate(
                    { _id: normalizedEncounterId, userId, isActive: true },
                    { $set: { isActive: false, endedAt: new Date() } },
                    { new: true }
                )

                if (!resolvedEncounter) {
                    await UserInventory.updateOne(
                        { userId, itemId: normalizedItemId },
                        { $inc: { quantity: qty } },
                        { upsert: true }
                    )
                    return res.status(409).json({ ok: false, message: 'Trận chiến đã kết thúc. Vui lòng tải lại.' })
                }

                const obtainedMapName = String(encounterMap?.name || '').trim()

                await UserPokemon.create({
                    userId,
                    pokemonId: encounter.pokemonId,
                    level: encounter.level,
                    experience: 0,
                    moves: [],
                    movePpState: [],
                    formId: encounter.formId || 'normal',
                    isShiny: encounter.isShiny,
                    obtainedMapName,
                    location: 'box',
                })

                const rarity = String(pokemon.rarity || '').trim().toLowerCase()
                const shouldEmitGlobalNotification = ['s', 'ss', 'sss', 'sss+'].includes(rarity)
                let globalNotificationPayload = null
                if (shouldEmitGlobalNotification) {
                    try {
                        const currentUser = await User.findById(userId)
                            .select('username role vipTierId vipTierLevel vipBenefits')
                            .lean()
                        const username = String(currentUser?.username || '').trim() || 'Người chơi'
                        const rarityLabel = rarity ? rarity.toUpperCase() : 'UNKNOWN'
                        const effectiveVipVisualBenefits = await resolveEffectiveVipVisualBenefits(currentUser)
                        const normalizedRole = String(currentUser?.role || '').trim().toLowerCase()
                        const isVip = normalizedRole === 'vip' || normalizedRole === 'admin'
                        const notificationImage = resolvePokemonImageForEncounter(
                            pokemon,
                            encounter.formId || pokemon.defaultFormId || 'normal',
                            encounter.isShiny
                        )
                        globalNotificationPayload = {
                            notificationId: `${resolvedEncounter._id}-${Date.now()}`,
                            username,
                            pokemonName: pokemon.name,
                            rarity,
                            rarityLabel,
                            imageUrl: notificationImage,
                            isVip,
                            vipTitle: effectiveVipVisualBenefits.title,
                            vipTitleImageUrl: effectiveVipVisualBenefits.titleImageUrl,
                            message: `Người chơi ${username} vừa bắt được Pokemon ${rarityLabel} - ${pokemon.name}!`,
                        }

                        const io = getIO()
                        if (io) {
                            io.emit('globalNotification', globalNotificationPayload)
                        }
                    } catch (notificationError) {
                        console.error('Không thể phát globalNotification:', notificationError)
                    }
                }

                return res.json({
                    ok: true,
                    caught: true,
                    encounterId: resolvedEncounter._id,
                    hp: resolvedEncounter.hp,
                    maxHp: resolvedEncounter.maxHp,
                    catchChancePercent: Number((chance * 100).toFixed(2)),
                    lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
                    message: `Đã bắt được ${pokemon.name}!`,
                    globalNotification: globalNotificationPayload,
                })
            }

            const isStillActive = await Encounter.exists({ _id: normalizedEncounterId, userId, isActive: true })
            if (!isStillActive) {
                await UserInventory.updateOne(
                    { userId, itemId: normalizedItemId },
                    { $inc: { quantity: qty } },
                    { upsert: true }
                )
                return res.status(409).json({ ok: false, message: 'Trận chiến đã kết thúc. Vui lòng tải lại.' })
            }

            // Catch failed - increment catchAttempts and check if Pokemon should flee
            const catchUser = await User.findById(userId)
                .select('role vipTierLevel vipBenefits')
                .lean()
            const maxAttempts = getMaxCatchAttempts(catchUser)
            const nextAttempts = Math.max(0, Number(encounter.catchAttempts || 0)) + 1

            await User.updateOne(
                { _id: userId },
                { $inc: { catchFailCount: 1 } }
            )

            if (nextAttempts >= maxAttempts) {
                // Pokemon flees
                await Encounter.findOneAndUpdate(
                    { _id: normalizedEncounterId, userId, isActive: true },
                    { $set: { isActive: false, endedAt: new Date(), catchAttempts: nextAttempts } }
                )
                return res.json({
                    ok: true,
                    caught: false,
                    fled: true,
                    encounterId: normalizedEncounterId,
                    hp: encounter.hp,
                    maxHp: encounter.maxHp,
                    catchChancePercent: Number((chance * 100).toFixed(2)),
                    lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
                    catchAttempts: nextAttempts,
                    maxCatchAttempts: maxAttempts,
                    message: `Pokemon đã thoát khỏi bóng và bỏ chạy! (Đã thử ${nextAttempts}/${maxAttempts} lần)`,
                })
            }

            // Still within attempt limit
            await Encounter.findOneAndUpdate(
                { _id: normalizedEncounterId, userId, isActive: true },
                { $set: { catchAttempts: nextAttempts } }
            )

            const remainingAttempts = maxAttempts - nextAttempts
            return res.json({
                ok: true,
                caught: false,
                fled: false,
                encounterId: normalizedEncounterId,
                hp: encounter.hp,
                maxHp: encounter.maxHp,
                catchChancePercent: Number((chance * 100).toFixed(2)),
                lowHpCatchBonusPercent: Number(lowHpCatchBonusPercent.toFixed(2)),
                catchAttempts: nextAttempts,
                maxCatchAttempts: maxAttempts,
                remainingAttempts,
                message: `Pokemon đã thoát khỏi bóng! Còn ${remainingAttempts} lần thử.`,
            })
        }

        const entry = await UserInventory.findOne({ userId, itemId: normalizedItemId })

        if (!entry || entry.quantity < qty) {
            return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
        }

        if (item.effectType === 'allowOffTypeSkills') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm này chỉ được dùng từng cái một' })
            }

            if (itemUseContext.mode === 'trainer' || itemUseContext.mode === 'duel' || itemUseContext.mode === 'online') {
                return res.status(403).json({ ok: false, message: 'Không thể dùng vật phẩm này trong battle' })
            }

            if (!normalizedActivePokemonId || !isValidObjectIdLike(normalizedActivePokemonId)) {
                return res.status(400).json({ ok: false, message: 'Cần chọn Pokemon để dùng vật phẩm này' })
            }

            const targetPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({
                _id: normalizedActivePokemonId,
                userId,
            }))
                .populate('pokemonId', 'name')

            if (!targetPokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon mục tiêu' })
            }

            if (targetPokemon.allowOffTypeSkills) {
                return res.status(400).json({ ok: false, message: 'Pokemon này đã được mở khóa dùng kỹ năng khác hệ' })
            }

            const consumedEntry = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedEntry) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            targetPokemon.allowOffTypeSkills = true

            try {
                await targetPokemon.save()
            } catch (saveError) {
                await UserInventory.findOneAndUpdate(
                    { userId, itemId: normalizedItemId },
                    {
                        $setOnInsert: { userId, itemId: normalizedItemId },
                        $inc: { quantity: qty },
                    },
                    { upsert: true, new: true }
                )
                throw saveError
            }

            if (consumedEntry.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
            }

            const targetPokemonName = String(targetPokemon?.nickname || targetPokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'

            return res.json({
                ok: true,
                message: `${targetPokemonName} đã mở khóa dùng kỹ năng khác hệ.`,
                itemId: normalizedItemId,
                quantity: qty,
                effect: {
                    type: 'allowOffTypeSkills',
                    targetPokemonId: targetPokemon._id,
                    allowOffTypeSkills: true,
                },
            })
        }

        if (item.effectType === 'grantPokemonExp' || item.effectType === 'grantPokemonLevel') {
            if (itemUseContext.mode === 'trainer' || itemUseContext.mode === 'duel' || itemUseContext.mode === 'online') {
                return res.status(403).json({ ok: false, message: 'Không thể dùng vật phẩm này trong battle' })
            }

            if (!normalizedActivePokemonId || !isValidObjectIdLike(normalizedActivePokemonId)) {
                return res.status(400).json({ ok: false, message: 'Cần chọn Pokemon để dùng vật phẩm này' })
            }

            const targetPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({
                _id: normalizedActivePokemonId,
                userId,
            }))
                .populate('pokemonId', 'name')

            if (!targetPokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon mục tiêu' })
            }

            const effectValue = Math.max(1, Math.floor(Number(item.effectValue) || 0))
            const totalEffectValue = Math.max(1, effectValue * qty)
            const isExpItem = item.effectType === 'grantPokemonExp'

            if (targetPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                return res.status(400).json({ ok: false, message: 'Pokemon này đã đạt cấp tối đa' })
            }

            const consumedEntry = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedEntry) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            const result = isExpItem
                ? applyExperienceGainToUserPokemon(targetPokemon, totalEffectValue)
                : applyLevelGainToUserPokemon(targetPokemon, totalEffectValue)

            try {
                await targetPokemon.save()
            } catch (saveError) {
                await UserInventory.findOneAndUpdate(
                    { userId, itemId: normalizedItemId },
                    {
                        $setOnInsert: { userId, itemId: normalizedItemId },
                        $inc: { quantity: qty },
                    },
                    { upsert: true, new: true }
                )
                throw saveError
            }

            if (consumedEntry.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
            }

            const targetPokemonName = String(targetPokemon?.nickname || targetPokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'

            return res.json({
                ok: true,
                message: isExpItem
                    ? `${targetPokemonName} nhận ${result.expGained} EXP.`
                    : `${targetPokemonName} tăng ${result.levelsGained} cấp.`,
                itemId: normalizedItemId,
                quantity: qty,
                effect: isExpItem
                    ? {
                        type: 'grantPokemonExp',
                        targetPokemonId: targetPokemon._id,
                        expGained: result.expGained,
                        expBefore: result.expBefore,
                        expAfter: result.expAfter,
                        levelsGained: result.levelsGained,
                        level: result.level,
                        expToNext: result.expToNext,
                    }
                    : {
                        type: 'grantPokemonLevel',
                        targetPokemonId: targetPokemon._id,
                        levelsGained: result.levelsGained,
                        levelBefore: result.levelBefore,
                        levelAfter: result.levelAfter,
                        expBefore: result.expBefore,
                        expAfter: result.expAfter,
                        expToNext: result.expToNext,
                    },
            })
        }

        if (item.effectType === 'transferPokemonLevel') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm này chỉ được dùng từng cái một' })
            }

            if (itemUseContext.mode === 'trainer' || itemUseContext.mode === 'duel' || itemUseContext.mode === 'online') {
                return res.status(403).json({ ok: false, message: 'Không thể dùng vật phẩm này trong battle' })
            }

            if (!normalizedActivePokemonId || !isValidObjectIdLike(normalizedActivePokemonId)) {
                return res.status(400).json({ ok: false, message: 'Cần chọn Pokemon đích để dùng vật phẩm này' })
            }

            if (!normalizedSourcePokemonId || !isValidObjectIdLike(normalizedSourcePokemonId)) {
                return res.status(400).json({ ok: false, message: 'Cần chọn Pokemon nguồn để chuyển level' })
            }

            if (normalizedSourcePokemonId === normalizedActivePokemonId) {
                return res.status(400).json({ ok: false, message: 'Pokemon nguồn và đích phải khác nhau' })
            }

            const [targetPokemon, sourcePokemon] = await Promise.all([
                UserPokemon.findOne(withActiveUserPokemonFilter({
                    _id: normalizedActivePokemonId,
                    userId,
                })).populate('pokemonId', 'name'),
                UserPokemon.findOne(withActiveUserPokemonFilter({
                    _id: normalizedSourcePokemonId,
                    userId,
                })).populate('pokemonId', 'name'),
            ])

            if (!targetPokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon đích' })
            }
            if (!sourcePokemon) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon nguồn' })
            }
            if (targetPokemon.level >= USER_POKEMON_MAX_LEVEL) {
                return res.status(400).json({ ok: false, message: 'Pokemon đích đã đạt cấp tối đa' })
            }

            const transferableLevels = Math.max(0, Math.floor(Number(sourcePokemon.level) || 1) - 1)
            if (transferableLevels <= 0) {
                return res.status(400).json({ ok: false, message: 'Pokemon nguồn phải từ cấp 2 trở lên' })
            }

            const consumedEntry = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedEntry) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            const sourceLevelBefore = Math.max(1, Math.floor(Number(sourcePokemon.level) || 1))
            const sourceExpBefore = Math.max(0, Math.floor(Number(sourcePokemon.experience) || 0))
            const targetResult = applyLevelGainToUserPokemon(targetPokemon, transferableLevels)

            sourcePokemon.level = 1
            sourcePokemon.experience = 0

            try {
                await Promise.all([
                    targetPokemon.save(),
                    sourcePokemon.save(),
                ])
            } catch (saveError) {
                await UserInventory.findOneAndUpdate(
                    { userId, itemId: normalizedItemId },
                    {
                        $setOnInsert: { userId, itemId: normalizedItemId },
                        $inc: { quantity: qty },
                    },
                    { upsert: true, new: true }
                )
                throw saveError
            }

            if (consumedEntry.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
            }

            const targetPokemonName = String(targetPokemon?.nickname || targetPokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'
            const sourcePokemonName = String(sourcePokemon?.nickname || sourcePokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'

            return res.json({
                ok: true,
                message: `Đã chuyển ${transferableLevels} cấp từ ${sourcePokemonName} sang ${targetPokemonName}.`,
                itemId: normalizedItemId,
                quantity: qty,
                effect: {
                    type: 'transferPokemonLevel',
                    targetPokemonId: targetPokemon._id,
                    sourcePokemonId: sourcePokemon._id,
                    transferredLevels: transferableLevels,
                    target: {
                        levelBefore: targetResult.levelBefore,
                        levelAfter: targetResult.levelAfter,
                        expBefore: targetResult.expBefore,
                        expAfter: targetResult.expAfter,
                        expToNext: targetResult.expToNext,
                    },
                    source: {
                        levelBefore: sourceLevelBefore,
                        levelAfter: 1,
                        expBefore: sourceExpBefore,
                        expAfter: 0,
                    },
                },
            })
        }

        if (item.type === 'healing') {
            const { hpAmount, ppAmount } = getHealAmounts(item)
            if (hpAmount <= 0 && ppAmount <= 0) {
                console.warn('inventory_use_no_effect', {
                    userId: String(userId),
                    itemId: normalizedItemId,
                    reason: 'item_effect_zero',
                })
                return res.status(400).json({ ok: false, message: 'Vật phẩm này không có hiệu ứng hồi phục' })
            }

            if (itemUseContext.mode === 'duel' || itemUseContext.mode === 'online') {
                console.warn('inventory_use_blocked_mode', {
                    userId: String(userId),
                    itemId: normalizedItemId,
                    mode: itemUseContext.mode,
                })
                return res.status(403).json({ ok: false, message: 'Không thể dùng vật phẩm ở chế độ battle này' })
            }

            const isTrainerBattleContext = itemUseContext.mode === 'trainer'
            if (isTrainerBattleContext && !itemUseContext.trainerId) {
                return res.status(400).json({ ok: false, message: 'Thiếu trainerId cho ngữ cảnh battle trainer' })
            }

            const totalHpHeal = hpAmount * qty
            const totalPpHeal = Math.max(0, Math.floor(ppAmount * qty))

            let targetPokemon = null
            if (normalizedActivePokemonId) {
                if (!isValidObjectIdLike(normalizedActivePokemonId)) {
                    return res.status(400).json({ ok: false, message: 'Pokemon đang chọn không hợp lệ' })
                }
                targetPokemon = await UserPokemon.findOne({
                    _id: normalizedActivePokemonId,
                    userId,
                    location: 'party',
                }).populate('pokemonId', 'levelUpMoves baseStats rarity forms defaultFormId')
                if (!targetPokemon) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon đang chọn' })
                }
            }

            let activeBattleSession = null
            if (isTrainerBattleContext) {
                activeBattleSession = await BattleSession.findOne({
                    userId,
                    trainerId: itemUseContext.trainerId,
                    expiresAt: { $gt: new Date() },
                })

                if (!activeBattleSession) {
                    console.warn('inventory_use_trainer_session_missing', {
                        userId: String(userId),
                        itemId: normalizedItemId,
                        trainerId: itemUseContext.trainerId,
                    })
                    return res.status(409).json({ ok: false, message: 'Không tìm thấy phiên battle trainer. Vui lòng vào lại trận.' })
                }

                await ensureTrainerSessionPlayerParty({
                    trainerSession: activeBattleSession,
                    userId,
                    preferredActivePokemonId: targetPokemon?._id || activeBattleSession.playerPokemonId,
                })

                const team = Array.isArray(activeBattleSession.team) ? activeBattleSession.team : []
                const currentIndex = Math.max(0, Number(activeBattleSession.currentIndex) || 0)
                if (team.length === 0 || currentIndex >= team.length) {
                    console.warn('inventory_use_trainer_session_missing', {
                        userId: String(userId),
                        itemId: normalizedItemId,
                        trainerId: itemUseContext.trainerId,
                        reason: 'session_inactive_or_finished',
                    })
                    return res.status(409).json({ ok: false, message: 'Phiên battle trainer đã kết thúc. Vui lòng vào trận mới.' })
                }

                if (!targetPokemon && activeBattleSession.playerPokemonId) {
                    targetPokemon = await UserPokemon.findOne({
                        _id: activeBattleSession.playerPokemonId,
                        userId,
                        location: 'party',
                    }).populate('pokemonId', 'levelUpMoves baseStats rarity forms defaultFormId')
                }
            }

            if (!targetPokemon) {
                targetPokemon = await UserPokemon.findOne({ userId, location: 'party' })
                    .sort({ partyIndex: 1 })
                    .populate('pokemonId', 'levelUpMoves baseStats rarity forms defaultFormId')
            }

            if (!isTrainerBattleContext && !normalizedEncounterId && targetPokemon) {
                activeBattleSession = await BattleSession.findOne({
                    userId,
                    playerPokemonId: targetPokemon._id,
                    expiresAt: { $gt: new Date() },
                })
            }

            let hpContext = 'player'
            let beforeHp = 0
            let maxHp = 1
            let nextHp = 1
            let playerState = null

            if (activeBattleSession) {
                hpContext = 'battle'

                const hasTrainerContextTarget = isTrainerBattleContext && targetPokemon
                const isSameTrainerBattlePokemon = hasTrainerContextTarget
                    && String(activeBattleSession.playerPokemonId || '') === String(targetPokemon._id)

                if (hasTrainerContextTarget) {
                    const resolvedForm = resolvePokemonFormEntry(
                        targetPokemon?.pokemonId,
                        targetPokemon?.formId || targetPokemon?.pokemonId?.defaultFormId || 'normal'
                    )
                    const resolvedBaseStats = resolveEffectivePokemonBaseStats({
                        pokemonLike: targetPokemon?.pokemonId,
                        formId: targetPokemon?.formId || targetPokemon?.pokemonId?.defaultFormId || 'normal',
                        resolvedForm,
                    })
                    const calculatedMaxHp = calcMaxHp(
                        Number(resolvedBaseStats?.hp || 1),
                        Math.max(1, Number(targetPokemon.level || 1)),
                        targetPokemon?.pokemonId?.rarity || 'd'
                    )
                    const requestedMaxHp = Number.isFinite(itemUseContext.playerMaxHp)
                        ? itemUseContext.playerMaxHp
                        : calculatedMaxHp
                    const resolvedMaxHp = clampChance(
                        Math.floor(requestedMaxHp),
                        1,
                        calculatedMaxHp
                    )
                    const fallbackCurrentHpRaw = Number(activeBattleSession.playerCurrentHp || resolvedMaxHp)
                    const resolvedCurrentHpRaw = Number.isFinite(itemUseContext.playerCurrentHp)
                        ? itemUseContext.playerCurrentHp
                        : fallbackCurrentHpRaw
                    const targetPartyIndex = Array.isArray(activeBattleSession.playerTeam)
                        ? activeBattleSession.playerTeam.findIndex((entry) => String(entry?.userPokemonId || '') === String(targetPokemon?._id || ''))
                        : -1

                    if (targetPartyIndex !== -1 && !isSameTrainerBattlePokemon) {
                        syncTrainerSessionActivePlayerToParty(activeBattleSession)
                        setTrainerSessionActivePlayerByIndex(activeBattleSession, targetPartyIndex)
                    }

                    if (targetPartyIndex !== -1) {
                        activeBattleSession.playerMaxHp = Math.max(1, Math.floor(resolvedMaxHp))
                        activeBattleSession.playerCurrentHp = clampChance(
                            Math.floor(resolvedCurrentHpRaw),
                            0,
                            activeBattleSession.playerMaxHp
                        )
                        syncTrainerSessionActivePlayerToParty(activeBattleSession)
                    } else {
                        const sessionMaxHp = Math.max(1, Number(activeBattleSession.playerMaxHp || calculatedMaxHp))
                        const normalizedRequestedMaxHp = Number.isFinite(itemUseContext.playerMaxHp)
                            ? clampChance(Math.floor(itemUseContext.playerMaxHp), 1, calculatedMaxHp)
                            : sessionMaxHp
                        const reconciledMaxHp = Math.max(1, Math.min(sessionMaxHp, normalizedRequestedMaxHp, calculatedMaxHp))
                        const sessionCurrentHp = clampChance(
                            Math.floor(Number(activeBattleSession.playerCurrentHp || reconciledMaxHp)),
                            0,
                            reconciledMaxHp
                        )
                        const normalizedRequestedCurrentHp = Number.isFinite(itemUseContext.playerCurrentHp)
                            ? clampChance(Math.floor(itemUseContext.playerCurrentHp), 0, reconciledMaxHp)
                            : sessionCurrentHp

                        activeBattleSession.playerMaxHp = reconciledMaxHp
                        activeBattleSession.playerCurrentHp = Math.min(sessionCurrentHp, normalizedRequestedCurrentHp)
                        syncTrainerSessionActivePlayerToParty(activeBattleSession)
                    }
                }

                beforeHp = Math.max(0, Number(activeBattleSession.playerCurrentHp || 0))
                maxHp = Math.max(1, Number(activeBattleSession.playerMaxHp || 1))
                nextHp = Math.min(maxHp, beforeHp + totalHpHeal)
            } else {
                playerState = await PlayerState.findOne({ userId })
                if (!playerState) {
                    return res.status(404).json({ ok: false, message: 'Không tìm thấy trạng thái người chơi' })
                }

                beforeHp = Math.max(0, Number(playerState.hp || 0))
                maxHp = Math.max(1, Number(playerState.maxHp || 1))
                nextHp = Math.min(maxHp, beforeHp + totalHpHeal)
            }

            const healedHp = Math.max(0, nextHp - beforeHp)

            let healedPp = 0
            let restoredPpMoves = []

            if (targetPokemon && totalPpHeal > 0) {
                await syncUserPokemonMovesAndPp(targetPokemon)

                const normalizedTargetMove = normalizeMoveName(moveName)
                const nextMovePpState = (Array.isArray(targetPokemon.movePpState) ? targetPokemon.movePpState : [])
                    .map((entry) => {
                        const currentPp = Math.max(0, Math.floor(Number(entry?.currentPp) || 0))
                        const maxPp = Math.max(1, Math.floor(Number(entry?.maxPp) || 1))
                        const moveLabel = String(entry?.moveName || '').trim()
                        const moveKey = normalizeMoveName(moveLabel)

                        if (!moveKey) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        if (normalizedTargetMove && moveKey !== normalizedTargetMove) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        if (currentPp >= maxPp) {
                            return {
                                moveName: moveLabel,
                                currentPp,
                                maxPp,
                            }
                        }

                        const nextCurrentPp = Math.min(maxPp, currentPp + totalPpHeal)
                        const diff = Math.max(0, nextCurrentPp - currentPp)
                        if (diff > 0) {
                            healedPp += diff
                            restoredPpMoves.push({
                                moveName: moveLabel,
                                restored: diff,
                                currentPp: nextCurrentPp,
                                maxPp,
                            })
                        }

                        return {
                            moveName: moveLabel,
                            currentPp: nextCurrentPp,
                            maxPp,
                        }
                    })

                targetPokemon.movePpState = nextMovePpState
            }

            if (healedHp === 0 && healedPp === 0) {
                console.warn('inventory_use_no_effect', {
                    userId: String(userId),
                    itemId: normalizedItemId,
                    reason: 'hp_pp_already_full',
                    contextMode: itemUseContext.mode || 'none',
                    hpContext,
                })
                return res.status(400).json({ ok: false, message: 'HP/PP đã đầy' })
            }

            if (hpContext === 'battle' && activeBattleSession) {
                activeBattleSession.playerCurrentHp = nextHp
                syncTrainerSessionActivePlayerToParty(activeBattleSession)
                await activeBattleSession.save()
                if (isTrainerBattleContext) {
                    console.info('inventory_use_trainer_heal_applied', {
                        userId: String(userId),
                        itemId: normalizedItemId,
                        trainerId: itemUseContext.trainerId,
                        targetPokemonId: String(targetPokemon?._id || activeBattleSession.playerPokemonId || ''),
                        healedHp,
                        healedPp,
                        hpAfter: nextHp,
                        maxHp,
                    })
                }
            } else {
                playerState.hp = nextHp
                await playerState.save()
            }

            let trainerCounterAttack = null
            if (isTrainerBattleContext && activeBattleSession && targetPokemon) {
                const team = Array.isArray(activeBattleSession.team) ? activeBattleSession.team : []
                const currentIndex = Math.max(0, Number(activeBattleSession.currentIndex) || 0)
                const activeTrainerOpponent = team[currentIndex] || null
                const trainerDoc = await BattleTrainer.findById(itemUseContext.trainerId)
                    .populate('team.pokemonId', 'name baseStats rarity forms defaultFormId types levelUpMoves initialMoves')
                    .lean()
                const trainerTeamEntry = Array.isArray(trainerDoc?.team) ? trainerDoc.team[currentIndex] : null
                trainerCounterAttack = await applyTrainerPenaltyTurn({
                    activeBattleSession,
                    activeTrainerOpponent,
                    targetPokemon,
                    trainerSpecies: trainerTeamEntry?.pokemonId || null,
                    playerCurrentHp: nextHp,
                    playerMaxHp: maxHp,
                    reason: 'item',
                })
                let playerForcedSwitch = null
                if (trainerCounterAttack?.defeatedPlayer) {
                    syncTrainerSessionActivePlayerToParty(activeBattleSession)
                    playerForcedSwitch = applyTrainerSessionForcedPlayerSwitch(activeBattleSession)
                    await activeBattleSession.save()
                }
                const turnTimeline = createTurnTimeline({ playerActsFirst: true })
                appendTurnPhaseEvent(turnTimeline, {
                    phaseKey: 'turn_start',
                    actor: 'player',
                    kind: 'item_used',
                    line: `Bạn dùng ${item.name || 'vật phẩm'} cho ${targetPokemon.nickname || targetPokemon?.pokemonId?.name || 'Pokemon'}.`,
                    itemId: normalizedItemId,
                })
                ;(Array.isArray(trainerCounterAttack?.turnPhases) ? trainerCounterAttack.turnPhases : []).forEach((phase) => {
                    ;(Array.isArray(phase?.events) ? phase.events : []).forEach((event) => {
                        appendTurnPhaseEvent(turnTimeline, {
                            phaseKey: phase.key,
                            actor: event?.actor || phase.actor || 'system',
                            kind: event?.kind || 'message',
                            line: event?.line || '',
                            ...event,
                        })
                    })
                })
                if (playerForcedSwitch?.switched && playerForcedSwitch?.nextEntry) {
                    appendTurnPhaseEvent(turnTimeline, {
                        phaseKey: 'forced_switch',
                        actor: 'system',
                        kind: 'forced_switch',
                        line: `${playerForcedSwitch.nextEntry.name || 'Pokemon'} vào sân thay thế.`,
                        target: 'player',
                        nextPokemonName: playerForcedSwitch.nextEntry.name || 'Pokemon',
                        nextIndex: playerForcedSwitch.nextIndex,
                    })
                }
                const turnPhases = finalizeTurnTimeline(turnTimeline)
                trainerCounterAttack.turnPhases = turnPhases
                trainerCounterAttack.logLines = flattenTurnPhaseLines(turnPhases)
                trainerCounterAttack.playerParty = serializeTrainerPlayerPartyState(activeBattleSession)
                trainerCounterAttack.forcedSwitch = playerForcedSwitch?.switched
                    ? {
                        target: 'player',
                        nextIndex: playerForcedSwitch.nextIndex,
                        nextPokemonId: playerForcedSwitch?.nextEntry?.userPokemonId || null,
                        nextPokemonName: playerForcedSwitch?.nextEntry?.name || null,
                    }
                    : null
            }

            if (targetPokemon) {
                await targetPokemon.save()
            }

            const consumedVipItem = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedVipItem) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            if (consumedVipItem.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedVipItem._id, quantity: { $lte: 0 } })
            }

            return res.json({
                ok: true,
                message: `Đã hồi ${healedHp} HP, ${healedPp} PP`,
                itemId: normalizedItemId,
                quantity: qty,
                effect: {
                    type: 'healing',
                    healedHp,
                    healedPp,
                    hp: nextHp,
                    maxHp,
                    hpContext,
                    targetPokemonId: targetPokemon?._id || null,
                    restoredMoves: restoredPpMoves,
                },
                trainerCounterAttack,
            })
        }

        if (item.effectType === 'grantVipTier') {
            if (qty !== 1) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm VIP chỉ được dùng từng cái một' })
            }

            const targetVipLevel = Math.max(0, Number.parseInt(item.effectValue, 10) || 0)
            const vipDurationValue = Math.max(1, Number.parseInt(item.effectValueMp, 10) || 1)
            const vipDurationUnit = ['week', 'month'].includes(String(item.effectDurationUnit || '').trim().toLowerCase())
                ? String(item.effectDurationUnit).trim().toLowerCase()
                : 'month'
            if (targetVipLevel <= 0) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm VIP chưa được cấu hình đúng cấp VIP' })
            }

            const [entry, userDoc, vipTier] = await Promise.all([
                UserInventory.findOne({ userId, itemId: normalizedItemId }),
                User.findById(userId),
                VipPrivilegeTier.findOne({ level: targetVipLevel }),
            ])

            if (!entry || Number(entry.quantity || 0) < qty) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }
            if (!userDoc) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
            }
            if (!vipTier) {
                return res.status(400).json({ ok: false, message: `Chưa tồn tại tier VIP ${targetVipLevel} để áp dụng vật phẩm` })
            }

            const now = new Date()
            const currentVipLevel = Math.max(0, Number.parseInt(userDoc?.vipTierLevel, 10) || 0)
            const currentExpiresAt = userDoc?.vipExpiresAt ? new Date(userDoc.vipExpiresAt) : null
            const hasActiveVip = currentExpiresAt && !Number.isNaN(currentExpiresAt.getTime()) && currentExpiresAt.getTime() > Date.now()

            if (hasActiveVip && currentVipLevel > targetVipLevel) {
                return res.status(400).json({ ok: false, message: `Bạn đang sở hữu VIP ${currentVipLevel} cao hơn vật phẩm này.` })
            }

            const baseDate = hasActiveVip && currentExpiresAt ? currentExpiresAt : now
            const nextExpiresAt = vipDurationUnit === 'week'
                ? addWeeksFromBase(baseDate, vipDurationValue)
                : addMonthsFromBase(baseDate, vipDurationValue)
            const durationLabel = `${vipDurationValue} ${vipDurationUnit === 'week' ? 'tuần' : 'tháng'}`

            const consumedVipItem = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: normalizedItemId,
                    quantity: { $gte: qty },
                },
                { $inc: { quantity: -qty } },
                { new: true }
            )

            if (!consumedVipItem) {
                return res.status(400).json({ ok: false, message: 'Không đủ vật phẩm' })
            }

            if (consumedVipItem.quantity <= 0) {
                await UserInventory.deleteOne({ _id: consumedVipItem._id, quantity: { $lte: 0 } })
            }

            userDoc.role = 'vip'
            userDoc.vipTierId = vipTier._id
            userDoc.vipTierLevel = Math.max(1, Number.parseInt(vipTier.level, 10) || 1)
            userDoc.vipTierCode = String(vipTier.code || '').trim().toUpperCase()
            userDoc.vipExpiresAt = nextExpiresAt
            userDoc.vipBenefits = {
                ...(userDoc.vipBenefits || {}),
                ...((vipTier?.benefits && typeof vipTier.benefits === 'object') ? vipTier.benefits : {}),
            }

            if (userDoc.vipTierLevel > currentVipLevel) {
                resetDailyAutoUsage(userDoc)
            }

            try {
                await userDoc.save()
            } catch (saveError) {
                await UserInventory.findOneAndUpdate(
                    { userId, itemId: normalizedItemId },
                    {
                        $setOnInsert: { userId, itemId: normalizedItemId },
                        $inc: { quantity: qty },
                    },
                    { upsert: true, new: true }
                )
                throw saveError
            }

            return res.json({
                ok: true,
                message: `Đã kích hoạt VIP ${userDoc.vipTierLevel} trong ${durationLabel}.`,
                itemId: normalizedItemId,
                quantity: qty,
                effect: {
                    type: 'grantVipTier',
                    vipTierLevel: userDoc.vipTierLevel,
                    vipDurationValue,
                    vipDurationUnit,
                    vipExpiresAt: nextExpiresAt,
                },
                user: {
                    role: userDoc.role,
                    vipTierId: userDoc.vipTierId,
                    vipTierLevel: userDoc.vipTierLevel,
                    vipTierCode: userDoc.vipTierCode || '',
                    vipExpiresAt: userDoc.vipExpiresAt,
                    vipBenefits: userDoc.vipBenefits || {},
                },
                globalNotification: {
                    type: 'success',
                    message: `Kich hoat thanh cong VIP ${userDoc.vipTierLevel}.`,
                },
            })
        }

        return res.status(400).json({ ok: false, message: 'Vật phẩm này không thể dùng lúc này' })
    } catch (error) {
        console.error('POST /api/inventory/use error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
