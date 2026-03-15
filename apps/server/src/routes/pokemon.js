import express from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import Move from '../models/Move.js'
import MarketListing from '../models/MarketListing.js'
import UserMoveInventory from '../models/UserMoveInventory.js'
import UserInventory from '../models/UserInventory.js'
import Item from '../models/Item.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import {
    buildMoveLookupByName,
    buildMovePpStateFromMoves,
    normalizeMoveName,
    syncUserPokemonMovesAndPp,
} from '../utils/movePpUtils.js'
import { authMiddleware } from '../middleware/auth.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'
import { getUserPokedexFormSet } from '../services/userPokedexService.js'
import { getSessionOptions, runWithOptionalTransaction } from '../utils/mongoTransactions.js'
import {
    FUSION_ITEM_EFFECT_TYPES,
    FUSION_ITEM_FIELD_BY_EFFECT_TYPE,
    FUSION_ITEM_SLOT_META,
    normalizeFusionLevel,
    getFusionFailurePenalty,
    computeFusionFinalSuccessRate,
} from '../utils/fusionUtils.js'
import { loadFusionRuntimeConfig } from '../utils/fusionRuntimeConfig.js'
import { resolveUserPokemonFinalStats } from '../utils/userPokemonStats.js'

const router = express.Router()

const toBoolean = (value) => {
    if (typeof value === 'boolean') return value
    const normalized = String(value || '').trim().toLowerCase()
    return ['1', 'true', 'yes', 'on'].includes(normalized)
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const normalizeOptionalFormId = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized || null
}
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const POKEMON_RARITY_ORDER = ['d', 'c', 'b', 'a', 's', 'ss', 'sss', 'sss+']

const createHttpError = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
}

const normalizeObjectIdLike = (value) => String(value || '').trim()
const getPokemonRarityIndex = (rarity = '') => POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(rarity))
const normalizePokemonRarity = (value = '') => String(value || '').trim().toLowerCase()
const isEvolutionItemAllowedForRarity = (itemLike = {}, rarity = '') => {
    const rarityIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(rarity))
    if (rarityIndex < 0) return true

    const fromIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(itemLike?.evolutionRarityFrom || 'd'))
    const toIndex = POKEMON_RARITY_ORDER.indexOf(normalizePokemonRarity(itemLike?.evolutionRarityTo || 'sss+'))
    if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) return false
    return rarityIndex >= fromIndex && rarityIndex <= toIndex
}

const parseTrainerOrigin = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return { token: '', payload: '' }
    const [prefix, ...rest] = raw.split(':')
    return {
        token: String(prefix || '').trim().toLowerCase(),
        payload: String(rest.join(':') || '').trim(),
    }
}

const buildPokemonObtainedEvent = (userPokemon) => {
    const occurredAt = userPokemon?.obtainedAt || userPokemon?.createdAt || userPokemon?.updatedAt || null
    const { token, payload } = parseTrainerOrigin(userPokemon?.originalTrainer)
    const obtainedMapName = String(userPokemon?.obtainedMapName || '').trim()

    if (token === 'trade') {
        return {
            id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
            type: 'obtained',
            title: 'Nhận qua trao đổi',
            description: payload
                ? `Pokemon được chuyển cho bạn từ ${payload}.`
                : 'Pokemon được nhận thông qua giao dịch với người chơi khác.',
            occurredAt,
        }
    }

    if (token === 'daily_checkin') {
        return {
            id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
            type: 'obtained',
            title: 'Nhận từ điểm danh',
            description: payload
                ? `Pokemon là quà điểm danh ngày ${payload}.`
                : 'Pokemon được nhận từ phần thưởng điểm danh hằng ngày.',
            occurredAt,
        }
    }

    if (token === 'promo_code') {
        return {
            id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
            type: 'obtained',
            title: 'Nhận từ mã quà tặng',
            description: payload
                ? `Pokemon được nhận từ mã quà tặng ${payload}.`
                : 'Pokemon được nhận từ mã quà tặng.',
            occurredAt,
        }
    }

    if (token === 'battle_trainer_reward') {
        return {
            id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
            type: 'obtained',
            title: 'Nhận từ thưởng huấn luyện viên',
            description: 'Pokemon được nhận như phần thưởng sau trận đấu.',
            occurredAt,
        }
    }

    if (token === 'admin_grant' || token === 'system_grant') {
        return {
            id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
            type: 'obtained',
            title: '',
            description: '',
            occurredAt,
        }
    }

    return {
        id: `obtained-${String(userPokemon?._id || 'pokemon')}`,
        type: 'obtained',
        title: obtainedMapName ? 'Bắt hoang dã' : 'Nhận Pokemon',
        description: obtainedMapName
            ? `Pokemon được bắt tại ${obtainedMapName}.`
            : 'Pokemon đã được thêm vào bộ sưu tập của người chơi.',
        occurredAt,
    }
}

const buildPokemonHistory = (userPokemon, listings = []) => {
    const events = []
    const obtainedEvent = buildPokemonObtainedEvent(userPokemon)
    if (obtainedEvent) {
        events.push(obtainedEvent)
    }

    for (const listing of Array.isArray(listings) ? listings : []) {
        const listingId = String(listing?._id || '').trim() || `${events.length + 1}`
        const listedAt = listing?.listedAt || listing?.createdAt || listing?.updatedAt || null
        const updatedAt = listing?.updatedAt || listedAt || null
        const soldAt = listing?.soldAt || null
        const priceText = `${formatNumber(listing?.price || 0)} xu`
        const sellerName = String(listing?.sellerId?.username || listing?.otName || 'Người bán').trim() || 'Người bán'
        const buyerName = String(listing?.buyerId?.username || 'Người mua').trim() || 'Người mua'
        const status = String(listing?.status || '').trim().toLowerCase()

        events.push({
            id: `listed-${listingId}`,
            type: 'listed_for_sale',
            title: 'Đăng bán trên chợ',
            description: `Đăng bán với giá ${priceText}.`,
            occurredAt: listedAt,
        })

        if (status === 'sold' && soldAt) {
            events.push({
                id: `sold-${listingId}`,
                type: 'sold',
                title: 'Đã được mua',
                description: `${sellerName} đã bán Pokemon cho ${buyerName} với giá ${priceText}.`,
                occurredAt: soldAt,
            })
            continue
        }

        if (status === 'cancelled') {
            events.push({
                id: `cancelled-${listingId}`,
                type: 'sale_cancelled',
                title: 'Hủy đăng bán',
                description: `Tin đăng giá ${priceText} đã được hủy.`,
                occurredAt: updatedAt,
            })
            continue
        }

        if (status === 'active') {
            events.push({
                id: `active-${listingId}`,
                type: 'active_listing',
                title: 'Tin đăng đang hoạt động',
                description: `Pokemon hiện vẫn đang được rao bán với giá ${priceText}.`,
                occurredAt: updatedAt,
            })
        }
    }

    return events
        .filter((entry) => entry && entry.occurredAt)
        .sort((left, right) => {
            const leftTime = new Date(left.occurredAt).getTime()
            const rightTime = new Date(right.occurredAt).getTime()
            if (leftTime !== rightTime) return rightTime - leftTime
            return String(right.id || '').localeCompare(String(left.id || ''))
        })
}

const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(source?.avatarFrameUrl || '').trim(),
        usernameColor: /^#([0-9a-f]{6})$/i.test(String(source?.usernameColor || '').trim())
            ? String(source?.usernameColor || '').trim().toUpperCase()
            : '',
        usernameGradientColor: /^#([0-9a-f]{6})$/i.test(String(source?.usernameGradientColor || '').trim())
            ? String(source?.usernameGradientColor || '').trim().toUpperCase()
            : '',
        usernameEffectColors: [...new Set((Array.isArray(source?.usernameEffectColors) ? source.usernameEffectColors : [])
            .map((entry) => /^#([0-9a-f]{6})$/i.test(String(entry || '').trim()) ? String(entry || '').trim().toUpperCase() : '')
            .filter(Boolean))].slice(0, 8),
        usernameEffect: String(source?.usernameEffect || '').trim().toLowerCase() === 'animated' ? 'animated' : 'none',
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
    }
}

const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)
    return {
        ...current,
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
        usernameColor: current.usernameColor || tier.usernameColor,
        usernameGradientColor: current.usernameGradientColor || tier.usernameGradientColor,
        usernameEffectColors: current.usernameEffectColors.length > 0 ? current.usernameEffectColors : tier.usernameEffectColors,
        usernameEffect: current.usernameEffect !== 'none' ? current.usernameEffect : tier.usernameEffect,
    }
}

const resolveVipTierBenefitsForUser = async (userLike) => {
    if (!userLike) return {}

    const vipTierId = String(userLike?.vipTierId || '').trim()
    if (vipTierId) {
        const tier = await VipPrivilegeTier.findById(vipTierId)
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

const resolveEffectiveVipBenefits = async (userLike) => {
    if (!userLike) return normalizeVipBenefits({})
    const tierBenefits = await resolveVipTierBenefitsForUser(userLike)
    return mergeVipVisualBenefits(userLike?.vipBenefits, tierBenefits)
}

const normalizeStringSet = (values) => new Set(
    (Array.isArray(values) ? values : [])
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
)

const toDisplayMovePpState = (entries = []) => (Array.isArray(entries) ? entries : [])
    .map((entry) => {
        const moveName = String(entry?.moveName || '').trim()
        const maxPp = Math.max(1, Number(entry?.maxPp || 1))
        return {
            moveName,
            currentPp: maxPp,
            maxPp,
        }
    })
    .filter((entry) => entry.moveName)

const toMoveName = (entry) => {
    if (typeof entry === 'string') return String(entry || '').trim()
    return String(entry?.moveName || entry?.name || '').trim()
}

const toExplicitMoveList = (moves = [], limit = 4) => {
    const normalizedLimit = Math.max(0, Number(limit) || 4)
    const normalizedMoves = (Array.isArray(moves) ? moves : [])
        .map((entry) => toMoveName(entry))
        .filter(Boolean)

    return [...new Set(normalizedMoves)].slice(0, normalizedLimit)
}

const resolveKnownMoveList = ({ moves = [], movePpState = [] } = {}, limit = 4) => {
    const explicitMoves = toExplicitMoveList(moves, limit)
    if (explicitMoves.length > 0) return explicitMoves
    return toExplicitMoveList(movePpState, limit)
}

const getStoredOffTypeSkillAllowance = (userPokemonLike = null) => {
    const explicitAllowance = Math.max(0, Number.parseInt(userPokemonLike?.offTypeSkillAllowance, 10) || 0)
    if (explicitAllowance > 0) return explicitAllowance
    return userPokemonLike?.allowOffTypeSkills ? 1 : 0
}

const hasLegacyOffTypeSkillState = (userPokemonLike = null) => {
    const explicitAllowance = Math.max(0, Number.parseInt(userPokemonLike?.offTypeSkillAllowance, 10) || 0)
    return explicitAllowance <= 0 && Boolean(userPokemonLike?.allowOffTypeSkills)
}

const isMoveOffTypeForPokemon = (move, pokemonSpecies) => {
    const learnScope = String(move?.learnScope || 'all').trim().toLowerCase() || 'all'
    const speciesTypes = normalizeStringSet(pokemonSpecies?.types)

    if (learnScope === 'move_type') {
        const moveType = String(move?.type || '').trim().toLowerCase()
        return !moveType || !speciesTypes.has(moveType)
    }

    if (learnScope === 'type') {
        const allowedTypeSet = normalizeStringSet(move?.allowedTypes)
        return ![...speciesTypes].some((entry) => allowedTypeSet.has(entry))
    }

    return false
}

const countOffTypeMovesForPokemon = ({ moveNames = [], moveLookupMap = new Map(), pokemonSpecies = null } = {}) => (Array.isArray(moveNames) ? moveNames : [])
    .reduce((count, moveNameRaw) => {
        const moveName = String(moveNameRaw || '').trim()
        if (!moveName) return count
        const moveDoc = moveLookupMap.get(normalizeMoveName(moveName))
        if (!moveDoc) return count
        return count + (isMoveOffTypeForPokemon(moveDoc, pokemonSpecies) ? 1 : 0)
    }, 0)

const getOffTypeSkillAllowance = (userPokemonLike = null, options = {}) => {
    const storedAllowance = getStoredOffTypeSkillAllowance(userPokemonLike)
    const pokemonSpecies = options?.pokemonSpecies || null
    if (!pokemonSpecies) return storedAllowance

    const currentMoveNames = Array.isArray(options?.currentMoveNames) ? options.currentMoveNames : resolveKnownMoveList(userPokemonLike, 4)
    const currentMoveLookupMap = options?.currentMoveLookupMap instanceof Map ? options.currentMoveLookupMap : new Map()
    const equippedOffTypeMoveCount = countOffTypeMovesForPokemon({
        moveNames: currentMoveNames,
        moveLookupMap: currentMoveLookupMap,
        pokemonSpecies,
    })

    return Math.max(storedAllowance, equippedOffTypeMoveCount)
}

const evaluateMoveLearnRestriction = (move, pokemonSpecies, userPokemonLike = null, options = {}) => {
    const learnScope = String(move?.learnScope || 'all').trim().toLowerCase() || 'all'
    const speciesId = String(pokemonSpecies?._id || '').trim()
    const speciesRarity = String(pokemonSpecies?.rarity || '').trim().toLowerCase()
    const currentMoveNames = Array.isArray(options?.currentMoveNames) ? options.currentMoveNames : []
    const currentMoveLookupMap = options?.currentMoveLookupMap instanceof Map ? options.currentMoveLookupMap : new Map()
    const replacingMoveName = String(options?.replacingMoveName || '').trim()
    const offTypeSkillAllowance = getOffTypeSkillAllowance(userPokemonLike, {
        pokemonSpecies,
        currentMoveNames,
        currentMoveLookupMap,
    })
    const equippedOffTypeMoveCount = countOffTypeMovesForPokemon({
        moveNames: currentMoveNames,
        moveLookupMap: currentMoveLookupMap,
        pokemonSpecies,
    })

    if (learnScope === 'all') {
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    if (learnScope === 'move_type') {
        if (isMoveOffTypeForPokemon(move, pokemonSpecies)) {
            const replacingMoveDoc = replacingMoveName
                ? currentMoveLookupMap.get(normalizeMoveName(replacingMoveName))
                : null
            const replacingOffTypeMove = Boolean(replacingMoveDoc && isMoveOffTypeForPokemon(replacingMoveDoc, pokemonSpecies))
            const nextOffTypeMoveCount = equippedOffTypeMoveCount - (replacingOffTypeMove ? 1 : 0) + 1
            const canPreviewReplaceExistingOffType = !replacingMoveName && currentMoveNames.length >= 4 && equippedOffTypeMoveCount > 0 && offTypeSkillAllowance >= equippedOffTypeMoveCount

            if (nextOffTypeMoveCount <= offTypeSkillAllowance || canPreviewReplaceExistingOffType) {
                return {
                    canLearn: true,
                    reason: '',
                    usesOffTypeAllowance: true,
                    requiresReplacingOffTypeMove: canPreviewReplaceExistingOffType && nextOffTypeMoveCount > offTypeSkillAllowance,
                }
            }
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon cùng hệ với kỹ năng',
                usesOffTypeAllowance: false,
            }
        }
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    if (learnScope === 'type') {
        if (isMoveOffTypeForPokemon(move, pokemonSpecies)) {
            const replacingMoveDoc = replacingMoveName
                ? currentMoveLookupMap.get(normalizeMoveName(replacingMoveName))
                : null
            const replacingOffTypeMove = Boolean(replacingMoveDoc && isMoveOffTypeForPokemon(replacingMoveDoc, pokemonSpecies))
            const nextOffTypeMoveCount = equippedOffTypeMoveCount - (replacingOffTypeMove ? 1 : 0) + 1
            const canPreviewReplaceExistingOffType = !replacingMoveName && currentMoveNames.length >= 4 && equippedOffTypeMoveCount > 0 && offTypeSkillAllowance >= equippedOffTypeMoveCount

            if (nextOffTypeMoveCount <= offTypeSkillAllowance || canPreviewReplaceExistingOffType) {
                return {
                    canLearn: true,
                    reason: '',
                    usesOffTypeAllowance: true,
                    requiresReplacingOffTypeMove: canPreviewReplaceExistingOffType && nextOffTypeMoveCount > offTypeSkillAllowance,
                }
            }
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon đúng hệ yêu cầu',
                usesOffTypeAllowance: false,
            }
        }
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    if (learnScope === 'species') {
        const allowedIds = new Set((Array.isArray(move?.allowedPokemonIds) ? move.allowedPokemonIds : [])
            .map((entry) => {
                if (typeof entry === 'object') return String(entry?._id || '').trim()
                return String(entry || '').trim()
            })
            .filter(Boolean))
        if (!speciesId || !allowedIds.has(speciesId)) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ dành cho một số Pokemon đặc biệt',
                usesOffTypeAllowance: false,
            }
        }
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    if (learnScope === 'rarity') {
        const allowedRarities = normalizeStringSet(move?.allowedRarities)
        if (!speciesRarity || !allowedRarities.has(speciesRarity)) {
            return {
                canLearn: false,
                reason: 'Kỹ năng này chỉ học được bởi Pokemon huyền thoại/thần thoại',
                usesOffTypeAllowance: false,
            }
        }
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    return { canLearn: true, reason: '', usesOffTypeAllowance: false }
}

const resolveEvolutionRule = (species, currentFormId) => {
    const parseEvolutionRule = (ruleLike = null) => {
        const rule = ruleLike && typeof ruleLike === 'object' ? ruleLike : {}
        const evolvesTo = String(rule?.evolvesTo?._id || rule?.evolvesTo || '').trim()
        if (!evolvesTo) return null

        const parsedMinLevel = Number.parseInt(rule?.minLevel, 10)
        const minLevel = Number.isFinite(parsedMinLevel) && parsedMinLevel >= 1 ? parsedMinLevel : null
        const targetFormId = normalizeOptionalFormId(rule?.targetFormId)
        const requiredItemId = String(rule?.requiredItemId?._id || rule?.requiredItemId || '').trim()
        const parsedRequiredItemQuantity = Number.parseInt(rule?.requiredItemQuantity, 10)
        const requiredItemQuantity = requiredItemId
            ? (Number.isFinite(parsedRequiredItemQuantity) && parsedRequiredItemQuantity > 0 ? parsedRequiredItemQuantity : 1)
            : null

        if (minLevel === null && !requiredItemId) {
            return null
        }

        return {
            evolvesTo,
            targetFormId,
            minLevel,
            requiredItemId: requiredItemId || null,
            requiredItemQuantity,
        }
    }

    const baseEvolution = species?.evolution || null
    const parsedBaseRule = parseEvolutionRule(baseEvolution)
    if (parsedBaseRule) {
        return parsedBaseRule
    }

    const normalizedFormId = String(currentFormId || '').trim().toLowerCase()
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const matchedForm = forms.find((entry) => String(entry?.formId || '').trim().toLowerCase() === normalizedFormId) || null
    const formEvolution = matchedForm?.evolution || null
    return parseEvolutionRule(formEvolution)
}

const resolvePokemonFormDisplay = (pokemonLike, requestedFormId = null) => {
    if (!pokemonLike) {
        return {
            form: null,
            formId: 'normal',
            formName: 'normal',
            sprite: '',
        }
    }

    const forms = Array.isArray(pokemonLike.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike.defaultFormId || 'normal')
    const normalizedRequestedFormId = normalizeFormId(requestedFormId || defaultFormId)
    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === normalizedRequestedFormId) || null
    let resolvedFormId = normalizedRequestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return {
        form: resolvedForm,
        formId: resolvedFormId,
        formName: String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim(),
        sprite: resolvedForm?.sprites?.normal
            || resolvedForm?.sprites?.icon
            || resolvedForm?.imageUrl
            || pokemonLike.imageUrl
            || pokemonLike.sprites?.normal
            || pokemonLike.sprites?.icon
            || '',
    }
}

const resolveFormStats = (pokemonLike, requestedFormId = null) => {
    return resolveEffectivePokemonBaseStats({
        pokemonLike,
        formId: requestedFormId,
    })
}

const getPokedexFallbackSprite = (pokedexNumber) => {
    const numeric = Math.max(0, Number.parseInt(pokedexNumber, 10) || 0)
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${numeric}.png`
}

const getFormLabel = (formId, formName = '') => {
    const explicit = String(formName || '').trim()
    if (explicit) return explicit
    const normalized = normalizeFormId(formId)
    return normalized
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((entry) => entry.slice(0, 1).toUpperCase() + entry.slice(1))
        .join(' ')
}

const buildPokedexRows = (speciesRows = [], ownedFormSet = new Set()) => {
    const rows = []

    for (const species of (Array.isArray(speciesRows) ? speciesRows : [])) {
        const speciesId = String(species?._id || '').trim()
        if (!speciesId) continue

        const defaultFormId = normalizeFormId(species?.defaultFormId || 'normal')
        const speciesName = String(species?.name || '').trim() || 'Unknown'
        const types = Array.isArray(species?.types) ? species.types : []
        const forms = Array.isArray(species?.forms) ? species.forms : []

        const formMap = new Map()
        for (const form of forms) {
            const normalizedFormId = normalizeFormId(form?.formId || defaultFormId)
            if (!normalizedFormId || formMap.has(normalizedFormId)) continue
            formMap.set(normalizedFormId, {
                formId: normalizedFormId,
                formName: String(form?.formName || '').trim(),
                sprite: form?.sprites?.icon || form?.sprites?.normal || form?.imageUrl || '',
            })
        }

        const defaultFormMeta = formMap.get(defaultFormId) || null
        const baseSprite = defaultFormMeta?.sprite
            || species?.sprites?.icon
            || species?.sprites?.normal
            || species?.imageUrl
            || getPokedexFallbackSprite(species?.pokedexNumber)

        const defaultEntryId = `${speciesId}:${defaultFormId}`
        rows.push({
            _id: defaultEntryId,
            speciesId,
            formId: defaultFormId,
            defaultFormId,
            isForm: false,
            pokedexNumber: Number(species?.pokedexNumber || 0),
            name: speciesName,
            displayName: speciesName,
            types,
            imageUrl: String(species?.imageUrl || '').trim(),
            sprite: baseSprite,
            displaySprite: baseSprite,
            got: ownedFormSet.has(defaultEntryId),
        })

        const alternateForms = Array.from(formMap.values())
            .filter((entry) => entry.formId !== defaultFormId)
            .sort((left, right) => {
                const leftName = getFormLabel(left.formId, left.formName)
                const rightName = getFormLabel(right.formId, right.formName)
                return leftName.localeCompare(rightName, 'vi', { sensitivity: 'base' })
            })

        for (const form of alternateForms) {
            const entryId = `${speciesId}:${form.formId}`
            const sprite = form.sprite || baseSprite
            const formLabel = getFormLabel(form.formId, form.formName)
            rows.push({
                _id: entryId,
                speciesId,
                formId: form.formId,
                defaultFormId,
                isForm: true,
                pokedexNumber: Number(species?.pokedexNumber || 0),
                name: speciesName,
                displayName: `${speciesName} (${formLabel})`,
                types,
                imageUrl: String(species?.imageUrl || '').trim(),
                sprite,
                displaySprite: sprite,
                got: ownedFormSet.has(entryId),
            })
        }
    }

    return rows
}

const POKEDEX_SPECIES_CACHE_TTL_MS = 5 * 60 * 1000
const POKEDEX_SPECIES_SELECT = 'name pokedexNumber imageUrl sprites types forms defaultFormId'

let pokedexSpeciesCache = {
    rows: [],
    expiresAt: 0,
}

const loadPokedexSpeciesRows = async () => {
    const now = Date.now()
    if (pokedexSpeciesCache.expiresAt > now && Array.isArray(pokedexSpeciesCache.rows) && pokedexSpeciesCache.rows.length > 0) {
        return pokedexSpeciesCache.rows
    }

    const rows = await Pokemon.find({})
        .sort({ pokedexNumber: 1 })
        .select(POKEDEX_SPECIES_SELECT)
        .lean()

    pokedexSpeciesCache = {
        rows,
        expiresAt: now + POKEDEX_SPECIES_CACHE_TTL_MS,
    }

    return rows
}

const matchesPokedexSpeciesSearch = (species = {}, normalizedSearch = '', numericSearch = null) => {
    if (!normalizedSearch) return true

    if (Number.isFinite(numericSearch) && Number(species?.pokedexNumber || 0) === numericSearch) {
        return true
    }

    const speciesName = String(species?.name || '').trim().toLowerCase()
    if (speciesName.includes(normalizedSearch)) {
        return true
    }

    const forms = Array.isArray(species?.forms) ? species.forms : []
    for (const form of forms) {
        const formName = String(form?.formName || '').trim().toLowerCase()
        const formId = String(form?.formId || '').trim().toLowerCase()
        if (formName.includes(normalizedSearch) || formId.includes(normalizedSearch)) {
            return true
        }
    }

    return false
}

const POKEMON_SERVER_STATS_CACHE_TTL_MS = 30 * 1000

let pokemonServerStatsCache = {
    byPokemonId: new Map(),
    totalPokemon: 0,
    trackedSpecies: 0,
    expiresAt: 0,
}

const loadPokemonServerStatsCache = async () => {
    const now = Date.now()
    if (pokemonServerStatsCache.expiresAt > now) {
        return pokemonServerStatsCache
    }

    const [totalRows, speciesRows] = await Promise.all([
        UserPokemon.aggregate([
            { $match: withActiveUserPokemonFilter({}) },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                },
            },
        ]).allowDiskUse(true),
        UserPokemon.aggregate([
            { $match: withActiveUserPokemonFilter({}) },
            {
                $group: {
                    _id: '$pokemonId',
                    count: { $sum: 1 },
                },
            },
        ]).allowDiskUse(true),
    ])

    const byPokemonId = new Map()
    for (const row of speciesRows || []) {
        const key = String(row?._id || '').trim()
        if (!key) continue
        byPokemonId.set(key, Math.max(0, Number(row?.count || 0)))
    }

    pokemonServerStatsCache = {
        byPokemonId,
        totalPokemon: Math.max(0, Number(totalRows?.[0]?.total || 0)),
        trackedSpecies: byPokemonId.size,
        expiresAt: now + POKEMON_SERVER_STATS_CACHE_TTL_MS,
    }

    return pokemonServerStatsCache
}

const getPokemonServerStats = async (pokemonId) => {
    const cache = await loadPokemonServerStatsCache()
    const speciesKey = String(pokemonId || '').trim()
    const speciesTotal = Math.max(0, Number(cache.byPokemonId.get(speciesKey) || 0))

    let higherRankedSpeciesCount = 0
    for (const count of cache.byPokemonId.values()) {
        if (count > speciesTotal) {
            higherRankedSpeciesCount += 1
        }
    }

    return {
        speciesTotal,
        speciesRank: speciesTotal > 0 ? higherRankedSpeciesCount + 1 : null,
        totalPokemon: cache.totalPokemon,
        trackedSpecies: cache.trackedSpecies,
    }
}

// GET /api/pokemon - Public master list (lightweight)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 200 } = req.query
        const safePage = Math.max(1, parseInt(page, 10) || 1)
        const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 200))
        const skip = (safePage - 1) * safeLimit

        const [pokemon, total] = await Promise.all([
            Pokemon.find({})
                .sort({ pokedexNumber: 1 })
                .skip(skip)
                .limit(safeLimit)
                .select('name pokedexNumber imageUrl sprites types rarity forms defaultFormId')
                .lean(),
            Pokemon.countDocuments(),
        ])

        res.json({
            ok: true,
            pokemon,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total,
                pages: Math.max(1, Math.ceil(total / safeLimit)),
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/pokedex (protected)
router.get('/pokedex', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
        const skip = (page - 1) * limit

        const search = String(req.query.search || '').trim()
        const showIncomplete = toBoolean(req.query.incomplete)

        const userId = req.user.userId
        const ownedFormSet = await getUserPokedexFormSet(userId, { syncCurrentOwned: true })

        const allSpeciesRows = await loadPokedexSpeciesRows()
        const normalizedSearch = String(search || '').trim().toLowerCase()
        const numericSearch = Number.parseInt(search, 10)

        const filteredSpeciesRows = normalizedSearch
            ? allSpeciesRows.filter((species) => matchesPokedexSpeciesSearch(species, normalizedSearch, numericSearch))
            : allSpeciesRows

        const allRows = buildPokedexRows(allSpeciesRows, ownedFormSet)
        const filteredRows = normalizedSearch
            ? buildPokedexRows(filteredSpeciesRows, ownedFormSet)
            : allRows
        const dexEntryNumberById = new Map(
            allRows.map((entry, index) => [String(entry?._id || ''), index + 1])
        )
        const visibleRows = showIncomplete
            ? filteredRows.filter((entry) => !entry.got)
            : filteredRows
        const normalizedVisibleRows = visibleRows.map((entry) => ({
            ...entry,
            dexEntryNumber: Number(dexEntryNumberById.get(String(entry?._id || '')) || 0),
        }))
        const total = normalizedVisibleRows.length
        const rows = normalizedVisibleRows.slice(skip, skip + limit)
        const ownedCount = allRows.reduce((totalOwned, entry) => totalOwned + (entry.got ? 1 : 0), 0)
        const totalEntries = allRows.length
        const completionPercent = totalEntries > 0 ? Math.round((ownedCount / totalEntries) * 100) : 0

        res.json({
            ok: true,
            pokemon: rows,
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
            completion: {
                owned: ownedCount,
                total: totalEntries,
                percent: completionPercent,
            },
            filters: {
                search,
                incomplete: showIncomplete,
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon/pokedex error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/pokedex/status (protected)
router.post('/pokedex/status', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
        const requestedKeys = [...new Set(entries
            .map((entry) => {
                const pokemonId = String(entry?.pokemonId || '').trim()
                if (!pokemonId) return ''
                return `${pokemonId}:${normalizeFormId(entry?.formId || 'normal')}`
            })
            .filter(Boolean))]

        if (requestedKeys.length === 0) {
            return res.json({ ok: true, ownedKeys: [] })
        }

        const ownedFormSet = await getUserPokedexFormSet(userId, { syncCurrentOwned: true })
        const ownedKeys = requestedKeys.filter((key) => ownedFormSet.has(key))

        res.json({ ok: true, ownedKeys })
    } catch (error) {
        console.error('POST /api/pokemon/pokedex/status error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/evolution-zone (protected)
router.get('/evolution-zone', authMiddleware, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1)
        const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24))
        const skip = (page - 1) * limit
        const search = String(req.query.search || '').trim()
        const query = withActiveUserPokemonFilter({ userId: req.user.userId })

        if (search) {
            const searchRegex = new RegExp(escapeRegExp(search), 'i')
            const numericSearch = Number.parseInt(search, 10)
            const speciesSearchQuery = Number.isFinite(numericSearch)
                ? {
                    $or: [
                        { name: searchRegex },
                        { pokedexNumber: numericSearch },
                    ],
                }
                : { name: searchRegex }
            const speciesRows = await Pokemon.find(speciesSearchQuery)
                .select('_id')
                .lean()
            const speciesIds = speciesRows
                .map((entry) => entry?._id)
                .filter(Boolean)

            query.$or = [
                { nickname: searchRegex },
                { pokemonId: { $in: speciesIds } },
            ]
        }

        const userPokemonRows = await UserPokemon.find(query)
            .select('pokemonId nickname level formId isShiny location createdAt updatedAt')
            .populate('pokemonId', 'name pokedexNumber rarity imageUrl sprites baseStats forms defaultFormId evolution')
            .sort({ level: -1, updatedAt: -1, _id: -1 })
            .lean()

        const evolvableRows = []
        const targetIdSet = new Set()
        const requiredItemIdSet = new Set()

        for (const entry of userPokemonRows) {
            const species = entry?.pokemonId
            if (!species) continue

            const evolutionRule = resolveEvolutionRule(species, entry?.formId)
            const minLevel = Number.parseInt(evolutionRule?.minLevel, 10)
            if (!evolutionRule?.evolvesTo) continue

            const currentLevel = Math.max(1, Number.parseInt(entry?.level, 10) || 1)
            const hasMinLevelRequirement = Number.isFinite(minLevel) && minLevel >= 1
            if (hasMinLevelRequirement && currentLevel < minLevel) continue

            const targetId = String(evolutionRule.evolvesTo?._id || evolutionRule.evolvesTo || '').trim()
            if (!targetId) continue

            const requiredItemId = String(evolutionRule.requiredItemId?._id || evolutionRule.requiredItemId || '').trim()
            const requiredItemQuantity = requiredItemId
                ? Math.max(1, Number.parseInt(evolutionRule.requiredItemQuantity, 10) || 1)
                : 0

            targetIdSet.add(targetId)
            if (requiredItemId) requiredItemIdSet.add(requiredItemId)
            evolvableRows.push({
                entry,
                minLevel: hasMinLevelRequirement ? minLevel : null,
                targetId,
                targetFormId: evolutionRule?.targetFormId || null,
                requiredItemId,
                requiredItemQuantity,
            })
        }

        const targetIds = Array.from(targetIdSet)
        const targetSpeciesRows = targetIds.length > 0
            ? await Pokemon.find({ _id: { $in: targetIds } })
                .select('name pokedexNumber imageUrl sprites forms defaultFormId')
                .lean()
            : []
        const targetSpeciesById = new Map(
            targetSpeciesRows.map((row) => [String(row?._id || '').trim(), row])
        )

        const requiredItemIds = Array.from(requiredItemIdSet)
        const [requiredItemRows, inventoryRows] = requiredItemIds.length > 0
            ? await Promise.all([
                Item.find({ _id: { $in: requiredItemIds }, isEvolutionMaterial: true })
                    .select('_id name imageUrl isEvolutionMaterial evolutionRarityFrom evolutionRarityTo')
                    .lean(),
                UserInventory.find({
                    userId: req.user.userId,
                    itemId: { $in: requiredItemIds },
                })
                    .select('itemId quantity')
                    .lean(),
            ])
            : [[], []]

        const requiredItemById = new Map(
            requiredItemRows.map((row) => [String(row?._id || '').trim(), row])
        )
        const inventoryQuantityByItemId = new Map(
            inventoryRows.map((row) => [String(row?.itemId || '').trim(), Math.max(0, Number(row?.quantity || 0))])
        )

        const rows = evolvableRows.map(({ entry, minLevel, targetId, targetFormId, requiredItemId, requiredItemQuantity }) => {
            const species = entry?.pokemonId || null
            const currentDisplay = resolvePokemonFormDisplay(species, entry?.formId)
            const targetSpecies = targetSpeciesById.get(targetId) || null
            const targetDisplay = resolvePokemonFormDisplay(targetSpecies, targetFormId || entry?.formId)
            const requiredItem = requiredItemId ? requiredItemById.get(requiredItemId) : null
            const inventoryQuantity = requiredItemId
                ? Math.max(0, Number(inventoryQuantityByItemId.get(requiredItemId) || 0))
                : 0
            const isAllowedByRarity = !requiredItemId || (Boolean(requiredItem) && isEvolutionItemAllowedForRarity(requiredItem, species?.rarity))
            const hasRequiredItem = !requiredItemId || (isAllowedByRarity && inventoryQuantity >= requiredItemQuantity)

            if (!hasRequiredItem) return null

            return {
                ...entry,
                level: Math.max(1, Number.parseInt(entry?.level, 10) || 1),
                pokemonId: species
                    ? {
                        _id: species._id,
                        name: species.name,
                        pokedexNumber: Math.max(0, Number(species.pokedexNumber || 0)),
                        rarity: String(species.rarity || 'd').trim().toLowerCase() || 'd',
                        defaultFormId: normalizeFormId(species.defaultFormId || 'normal'),
                        forms: Array.isArray(species.forms) ? species.forms : [],
                        sprites: {
                            normal: currentDisplay.sprite,
                        },
                    }
                    : null,
                evolution: {
                    canEvolve: true,
                    evolutionLevel: minLevel,
                    requiredItem: requiredItem
                        ? {
                            _id: requiredItem._id,
                            name: requiredItem.name,
                            imageUrl: requiredItem.imageUrl || '',
                            requiredQuantity: requiredItemQuantity,
                            inventoryQuantity,
                            hasEnough: true,
                            rarityFrom: String(requiredItem.evolutionRarityFrom || 'd').trim().toLowerCase() || 'd',
                            rarityTo: String(requiredItem.evolutionRarityTo || 'sss+').trim().toLowerCase() || 'sss+',
                        }
                        : null,
                    targetPokemon: targetSpecies
                        ? {
                            _id: targetSpecies._id,
                            name: targetSpecies.name,
                            pokedexNumber: Math.max(0, Number(targetSpecies.pokedexNumber || 0)),
                            defaultFormId: normalizeFormId(targetSpecies.defaultFormId || 'normal'),
                            forms: Array.isArray(targetSpecies.forms) ? targetSpecies.forms : [],
                            sprites: {
                                normal: targetDisplay.sprite,
                            },
                        }
                        : null,
                },
            }
        }).filter(Boolean)

        const total = rows.length
        const pageRows = rows.slice(skip, skip + limit)
        const pages = Math.max(1, Math.ceil(total / limit))

        return res.json({
            ok: true,
            pokemon: pageRows,
            pagination: {
                page,
                limit,
                total,
                pages,
                hasNextPage: page < pages,
                hasPrevPage: page > 1,
            },
            filters: {
                search,
            },
            summary: {
                totalEligible: total,
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon/evolution-zone error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải khu vực tiến hóa' })
    }
})

// GET /api/pokemon/species/:id
router.get('/species/:id', async (req, res) => {
    try {
        const { id } = req.params
        const species = await Pokemon.findById(id).lean()
        if (!species) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy thông tin loài Pokemon' })
        }
        res.json({ ok: true, species })
    } catch (error) {
        console.error('GET /api/pokemon/species/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params
        const authHeader = String(req.headers.authorization || '').trim()
        let viewerUserId = ''

        if (authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.slice(7).trim()
                const decoded = jwt.verify(token, process.env.JWT_SECRET)
                viewerUserId = String(decoded?.userId || '').trim()
            } catch {
                viewerUserId = ''
            }
        }

        const userPokemon = await UserPokemon.findById(id)
            .populate('pokemonId')
            .populate('userId', 'username _id avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const basePokemon = userPokemon.pokemonId
        if (!basePokemon) {
            return res.status(404).json({ ok: false, message: 'Thiếu dữ liệu gốc của Pokemon' })
        }

        const ownerUserId = String(userPokemon?.userId?._id || userPokemon?.userId || '').trim()
        const canViewMoves = Boolean(viewerUserId && ownerUserId && viewerUserId === ownerUserId)

        // Calculate actual stats based on level, fusion, IVs and EVs
        const level = userPokemon.level || 1
        const rarity = basePokemon.rarity
        const mergedMoves = resolveKnownMoveList(userPokemon, 4)
        const moveLookupMap = await buildMoveLookupByName(mergedMoves)
        const movePpState = buildMovePpStateFromMoves({
            moveNames: mergedMoves,
            movePpState: userPokemon.movePpState,
            moveLookupMap,
        })
        const movePpMap = new Map(
            movePpState.map((entry) => [
                normalizeMoveName(entry?.moveName),
                {
                    currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                    maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                },
            ])
        )
        const moveDetails = mergedMoves.map((moveName) => {
            const moveKey = normalizeMoveName(moveName)
            const moveMeta = moveLookupMap.get(moveKey) || {}
            const ppState = movePpMap.get(moveKey) || { currentPp: 0, maxPp: Math.max(1, Number(moveMeta?.pp) || 1) }
            return {
                name: String(moveMeta?.name || moveName || '').trim(),
                type: String(moveMeta?.type || '').trim().toLowerCase(),
                category: String(moveMeta?.category || '').trim().toLowerCase(),
                power: Number.isFinite(Number(moveMeta?.power)) ? Number(moveMeta.power) : null,
                accuracy: Number.isFinite(Number(moveMeta?.accuracy)) ? Number(moveMeta.accuracy) : null,
                currentPp: ppState.currentPp,
                maxPp: ppState.maxPp,
            }
        })

        const currentFormId = normalizeFormId(userPokemon.formId || basePokemon.defaultFormId || 'normal')
        const resolvedStatsSource = resolveFormStats(basePokemon, currentFormId)
        const fusionRuntimeConfig = await loadFusionRuntimeConfig()
        const fusionLevel = Math.max(0, Number(userPokemon?.fusionLevel || 0))
        const resolvedUserStats = resolveUserPokemonFinalStats({
            baseStats: resolvedStatsSource,
            level,
            rarity,
            fusionLevel,
            totalStatBonusPercentByFusionLevel: fusionRuntimeConfig.totalStatBonusPercentByFusionLevel,
            ivs: userPokemon?.ivs,
            evs: userPokemon?.evs,
            isShiny: Boolean(userPokemon?.isShiny),
        })
        const stats = resolvedUserStats.finalStats
        const maxHp = resolvedUserStats.maxHp
        const combatPower = resolvedUserStats.combatPower

        // Enhance response with calculated stats
        const responseOffTypeSkillAllowance = getOffTypeSkillAllowance(userPokemon, {
            pokemonSpecies: basePokemon,
            currentMoveNames: mergedMoves,
            currentMoveLookupMap: moveLookupMap,
        })

        const responseData = {
            ...userPokemon,
            offTypeSkillAllowance: responseOffTypeSkillAllowance,
            allowOffTypeSkills: responseOffTypeSkillAllowance > 0,
            canViewMoves,
            moves: canViewMoves ? mergedMoves : [],
            moveDetails: canViewMoves ? moveDetails : [],
            movePpState: canViewMoves ? toDisplayMovePpState(movePpState) : [],
            stats: {
                ...stats,
                maxHp,
                currentHp: maxHp // Assuming full health for display or retrieve from separate state if tracked
            },
            combatPower,
            power: combatPower,
        }

        const evolutionRule = resolveEvolutionRule(basePokemon, userPokemon.formId)
        const minLevel = Number.isFinite(evolutionRule?.minLevel) ? evolutionRule.minLevel : null
        const requiredItemId = String(evolutionRule?.requiredItemId?._id || evolutionRule?.requiredItemId || '').trim()
        const requiredItemQuantity = requiredItemId
            ? Math.max(1, Number.parseInt(evolutionRule?.requiredItemQuantity, 10) || 1)
            : null
        const hasValidRule = Boolean(evolutionRule?.evolvesTo) && (Number.isFinite(minLevel) || Boolean(requiredItemId))
        let targetPokemon = null
        let previousPokemon = null
        let requiredItem = null
        let requiredItemInventoryQuantity = 0
        let hasRequiredItem = true

        if (hasValidRule) {
            const target = await Pokemon.findById(evolutionRule.evolvesTo)
                .select('name pokedexNumber imageUrl sprites forms defaultFormId')
                .lean()

            if (target) {
                const targetDisplay = resolvePokemonFormDisplay(target, evolutionRule?.targetFormId || currentFormId)
                targetPokemon = {
                    _id: target._id,
                    name: target.name,
                    pokedexNumber: target.pokedexNumber,
                    formId: targetDisplay.formId,
                    formName: targetDisplay.formName,
                    defaultFormId: target.defaultFormId || 'normal',
                    forms: Array.isArray(target.forms) ? target.forms : [],
                    sprites: {
                        normal: targetDisplay.sprite,
                    },
                }
            }
        }

        if (requiredItemId) {
            const itemDoc = await Item.findOne({
                _id: requiredItemId,
                isEvolutionMaterial: true,
            })
                .select('name imageUrl isEvolutionMaterial evolutionRarityFrom evolutionRarityTo')
                .lean()

            if (itemDoc) {
                const isAllowedByRarity = isEvolutionItemAllowedForRarity(itemDoc, basePokemon?.rarity)
                requiredItem = {
                    _id: itemDoc._id,
                    name: itemDoc.name,
                    imageUrl: itemDoc.imageUrl || '',
                    requiredQuantity: requiredItemQuantity,
                    rarityFrom: String(itemDoc.evolutionRarityFrom || 'd').trim().toLowerCase() || 'd',
                    rarityTo: String(itemDoc.evolutionRarityTo || 'sss+').trim().toLowerCase() || 'sss+',
                }
                if (ownerUserId) {
                    const inventoryEntry = await UserInventory.findOne({
                        userId: ownerUserId,
                        itemId: requiredItemId,
                    })
                        .select('quantity')
                        .lean()
                    requiredItemInventoryQuantity = Math.max(0, Number(inventoryEntry?.quantity || 0))
                }
                hasRequiredItem = isAllowedByRarity && requiredItemInventoryQuantity >= requiredItemQuantity
            } else {
                hasRequiredItem = false
            }
        }

        const previousSpecies = await Pokemon.findOne({
            'evolution.evolvesTo': basePokemon._id,
        })
            .select('name pokedexNumber imageUrl sprites forms defaultFormId')
            .lean()

        if (previousSpecies) {
            const previousDisplay = resolvePokemonFormDisplay(previousSpecies, currentFormId)
            previousPokemon = {
                _id: previousSpecies._id,
                name: previousSpecies.name,
                pokedexNumber: previousSpecies.pokedexNumber,
                sprites: {
                    normal: previousDisplay.sprite,
                },
            }
        }

        const [serverStats, marketListings, viewerSpeciesOwnedCount] = await Promise.all([
            getPokemonServerStats(basePokemon._id),
            MarketListing.find({ userPokemonId: userPokemon._id })
                .select('sellerId buyerId price otName status listedAt soldAt updatedAt createdAt')
                .populate('sellerId', 'username role vipTierLevel vipTierCode vipBenefits')
                .populate('buyerId', 'username role vipTierLevel vipTierCode vipBenefits')
                .sort({ listedAt: -1, _id: -1 })
                .lean(),
            viewerUserId
                ? UserPokemon.countDocuments(withActiveUserPokemonFilter({ userId: viewerUserId, pokemonId: basePokemon._id }))
                : 0,
        ])

        const ownerInfo = userPokemon?.userId && typeof userPokemon.userId === 'object'
            ? userPokemon.userId
            : null
        const effectiveOwnerVipBenefits = await resolveEffectiveVipBenefits(ownerInfo)
        const normalizedOwner = ownerInfo
            ? {
                ...ownerInfo,
                role: String(ownerInfo?.role || 'user').trim() || 'user',
                vipTierLevel: Math.max(0, Number.parseInt(ownerInfo?.vipTierLevel, 10) || 0),
                vipTierCode: String(ownerInfo?.vipTierCode || '').trim().toUpperCase(),
                vipBenefits: normalizeVipBenefits(effectiveOwnerVipBenefits),
            }
            : null

        responseData.userId = normalizedOwner

        responseData.evolution = {
            canEvolve: Boolean(targetPokemon)
                && (minLevel === null || level >= minLevel)
                && hasRequiredItem,
            evolutionLevel: hasValidRule ? minLevel : null,
            targetFormId: evolutionRule?.targetFormId || null,
            requiredItem: requiredItem
                ? {
                    ...requiredItem,
                    inventoryQuantity: requiredItemInventoryQuantity,
                    hasEnough: hasRequiredItem,
                }
                : null,
            targetPokemon,
            previousPokemon,
        }

        responseData.serverStats = {
            speciesTotal: serverStats.speciesTotal,
            speciesRank: serverStats.speciesRank,
            totalPokemon: serverStats.totalPokemon,
            trackedSpecies: serverStats.trackedSpecies,
            viewerSpeciesOwnedCount: Math.max(0, Number(viewerSpeciesOwnedCount || 0)),
        }

        responseData.history = {
            totalEvents: 0,
            events: buildPokemonHistory(userPokemon, marketListings),
        }
        responseData.history.totalEvents = responseData.history.events.length

        res.json({
            ok: true,
            pokemon: responseData
        })

    } catch (error) {
        console.error('Get Pokemon Detail Error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/:id/skills (protected) - Skills available from user inventory
router.get('/:id/skills', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const userPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: req.params.id, userId }))
            .select('moves movePpState pokemonId level allowOffTypeSkills offTypeSkillAllowance')
            .populate('pokemonId', 'types rarity levelUpMoves')
            .lean()

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }

        const knownMoves = resolveKnownMoveList(userPokemon, 4)
        const knownMoveSet = new Set(knownMoves.map((entry) => normalizeMoveName(entry)))
        const knownMoveLookupMap = await buildMoveLookupByName(knownMoves)

        const inventoryEntries = await UserMoveInventory.find({
            userId,
            quantity: { $gt: 0 },
        })
            .populate('moveId', 'name type category power accuracy pp priority description imageUrl rarity isActive learnScope allowedTypes allowedPokemonIds allowedRarities')
            .sort({ updatedAt: -1, _id: -1 })
            .lean()

        const skills = inventoryEntries
            .map((entry) => {
                const move = entry.moveId
                if (!move || move.isActive === false) return null
                const moveName = String(move.name || '').trim()
                const moveKey = normalizeMoveName(moveName)
                const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId, userPokemon, {
                    currentMoveNames: knownMoves,
                    currentMoveLookupMap: knownMoveLookupMap,
                })

                let canLearn = Boolean(moveName) && !knownMoveSet.has(moveKey)
                let reason = canLearn ? '' : 'Pokemon đã biết kỹ năng này'

                if (canLearn && !restrictionResult.canLearn) {
                    canLearn = false
                    reason = restrictionResult.reason
                }

                return {
                    _id: entry._id,
                    moveId: move._id,
                    quantity: Number(entry.quantity || 0),
                    canLearn,
                    reason,
                    usesOffTypeAllowance: Boolean(restrictionResult.usesOffTypeAllowance),
                    move: {
                        _id: move._id,
                        name: moveName,
                        type: move.type,
                        category: move.category,
                        power: move.power,
                        accuracy: move.accuracy,
                        pp: move.pp,
                        priority: move.priority,
                        description: move.description || '',
                        imageUrl: move.imageUrl || '',
                        rarity: move.rarity || 'common',
                        learnScope: move.learnScope || 'all',
                        allowedTypes: Array.isArray(move.allowedTypes) ? move.allowedTypes : [],
                        allowedPokemonIds: Array.isArray(move.allowedPokemonIds)
                            ? move.allowedPokemonIds.map((entry) => {
                                if (typeof entry === 'object') return String(entry?._id || '').trim()
                                return String(entry || '').trim()
                            }).filter(Boolean)
                            : [],
                        allowedRarities: Array.isArray(move.allowedRarities) ? move.allowedRarities : [],
                    },
                }
            })
            .filter(Boolean)
            .sort((a, b) => {
                const nameA = String(a?.move?.name || '').toLowerCase()
                const nameB = String(b?.move?.name || '').toLowerCase()
                if (nameA < nameB) return -1
                if (nameA > nameB) return 1
                return String(a.moveId).localeCompare(String(b.moveId))
            })

        const skillResponseOffTypeSkillAllowance = getOffTypeSkillAllowance(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            currentMoveNames: knownMoves,
            currentMoveLookupMap: knownMoveLookupMap,
        })

        res.json({
            ok: true,
            pokemon: {
                _id: req.params.id,
                moves: knownMoves,
                offTypeSkillAllowance: skillResponseOffTypeSkillAllowance,
                allowOffTypeSkills: skillResponseOffTypeSkillAllowance > 0,
            },
            skills,
        })
    } catch (error) {
        console.error('GET /api/pokemon/:id/skills error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/:id/level-transfer-candidates (protected)
router.get('/:id/level-transfer-candidates', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1)
        const limit = Math.min(24, Math.max(1, Number.parseInt(req.query?.limit, 10) || 12))
        const skip = (page - 1) * limit
        const search = String(req.query?.search || '').trim()
        const targetPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: req.params.id, userId }))
            .select('_id')
            .lean()

        if (!targetPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }

        const query = withActiveUserPokemonFilter({
            userId,
            _id: { $ne: req.params.id },
            level: { $gt: 1 },
        })

        if (search) {
            const searchRegex = new RegExp(escapeRegExp(search), 'i')
            const numericSearch = Number.parseInt(search, 10)
            const speciesSearchQuery = Number.isFinite(numericSearch)
                ? {
                    $or: [
                        { name: searchRegex },
                        { pokedexNumber: numericSearch },
                    ],
                }
                : { name: searchRegex }

            const speciesRows = await Pokemon.find(speciesSearchQuery)
                .select('_id')
                .lean()

            const speciesIds = speciesRows
                .map((entry) => entry?._id)
                .filter(Boolean)

            query.$or = [
                { nickname: searchRegex },
                { pokemonId: { $in: speciesIds } },
            ]
        }

        const total = await UserPokemon.countDocuments(query)
        const normalizedPage = total > 0 ? Math.min(page, Math.max(1, Math.ceil(total / limit))) : 1
        const normalizedSkip = (normalizedPage - 1) * limit

        const candidates = await UserPokemon.find(query)
            .select('_id pokemonId nickname level experience location formId isShiny updatedAt')
            .populate('pokemonId', 'name pokedexNumber imageUrl sprites forms defaultFormId')
            .sort({ level: -1, updatedAt: -1, _id: -1 })
            .skip(normalizedSkip)
            .limit(limit)
            .lean()

        res.json({
            ok: true,
            candidates: candidates.map((entry) => ({
                _id: entry._id,
                nickname: String(entry?.nickname || '').trim(),
                level: Math.max(1, Number.parseInt(entry?.level, 10) || 1),
                experience: Math.max(0, Number.parseInt(entry?.experience, 10) || 0),
                location: String(entry?.location || 'box').trim() || 'box',
                formId: String(entry?.formId || 'normal').trim().toLowerCase() || 'normal',
                isShiny: Boolean(entry?.isShiny),
                pokemon: {
                    _id: entry?.pokemonId?._id || null,
                    name: String(entry?.pokemonId?.name || '').trim(),
                    pokedexNumber: Number(entry?.pokemonId?.pokedexNumber || 0),
                    imageUrl: String(entry?.pokemonId?.imageUrl || '').trim(),
                    sprites: entry?.pokemonId?.sprites || {},
                    forms: Array.isArray(entry?.pokemonId?.forms) ? entry.pokemonId.forms : [],
                    defaultFormId: String(entry?.pokemonId?.defaultFormId || 'normal').trim().toLowerCase() || 'normal',
                },
            })),
            pagination: {
                page: normalizedPage,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            filters: {
                search,
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon/:id/level-transfer-candidates error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/:id/teach-skill (protected)
router.post('/:id/teach-skill', authMiddleware, async (req, res) => {
    let consumedSkill = false
    let consumeIdentity = null

    try {
        const userId = req.user.userId
        const moveId = String(req.body?.moveId || '').trim()
        const rawReplaceMoveIndex = req.body?.replaceMoveIndex

        if (!moveId) {
            return res.status(400).json({ ok: false, message: 'Thiếu moveId' })
        }

        const [userPokemon, move] = await Promise.all([
            UserPokemon.findOne(withActiveUserPokemonFilter({ _id: req.params.id, userId }))
                .populate('pokemonId', 'types rarity levelUpMoves'),
            Move.findOne({ _id: moveId, isActive: true })
                .select('name type category power accuracy pp priority learnScope allowedTypes allowedPokemonIds allowedRarities')
                .lean(),
        ])

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }
        if (!move || !String(move.name || '').trim()) {
            return res.status(404).json({ ok: false, message: 'Kỹ năng không tồn tại hoặc đã bị vô hiệu hóa' })
        }

        const inventoryEntry = await UserMoveInventory.findOne({
            userId,
            moveId,
            quantity: { $gt: 0 },
        })
            .select('quantity')
            .lean()

        if (!inventoryEntry) {
            return res.status(400).json({ ok: false, message: 'Bạn không có kỹ năng này trong kho' })
        }

        const currentMoves = resolveKnownMoveList(userPokemon, 4)

        const moveName = String(move.name || '').trim()
        const moveKey = normalizeMoveName(moveName)
        const knownMoveSet = new Set(currentMoves.map((entry) => normalizeMoveName(entry)))
        if (knownMoveSet.has(moveKey)) {
            return res.status(400).json({ ok: false, message: 'Pokemon đã biết kỹ năng này' })
        }

        let replaceMoveIndex = null
        if (rawReplaceMoveIndex !== undefined && rawReplaceMoveIndex !== null && rawReplaceMoveIndex !== '') {
            const parsed = parseInt(rawReplaceMoveIndex, 10)
            replaceMoveIndex = Number.isInteger(parsed) ? parsed : null
        }

        if (currentMoves.length >= 4 && (replaceMoveIndex === null || replaceMoveIndex < 0 || replaceMoveIndex >= currentMoves.length)) {
            return res.status(400).json({
                ok: false,
                message: 'Pokemon đã đủ 4 kỹ năng, vui lòng chọn kỹ năng cần thay thế',
            })
        }

        const currentMoveLookupMap = await buildMoveLookupByName(currentMoves)
        const replacedMoveName = replaceMoveIndex !== null && replaceMoveIndex >= 0 && replaceMoveIndex < currentMoves.length
            ? currentMoves[replaceMoveIndex]
            : ''
        const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId, userPokemon, {
            currentMoveNames: currentMoves,
            currentMoveLookupMap,
            replacingMoveName: replacedMoveName,
        })
        if (!restrictionResult.canLearn) {
            return res.status(400).json({ ok: false, message: restrictionResult.reason })
        }

        const consumeFilter = {
            userId,
            moveId,
            quantity: { $gte: 1 },
        }
        consumeIdentity = { userId, moveId }

        const consumedEntry = await UserMoveInventory.findOneAndUpdate(
            consumeFilter,
            { $inc: { quantity: -1 } },
            { new: true }
        )

        if (!consumedEntry) {
            return res.status(409).json({ ok: false, message: 'Kỹ năng trong kho đã thay đổi, vui lòng thử lại' })
        }
        consumedSkill = true

        const nextMoves = [...currentMoves]
        let replacedMove = null
        if (nextMoves.length < 4) {
            nextMoves.push(moveName)
        } else {
            replacedMove = nextMoves[replaceMoveIndex]
            nextMoves[replaceMoveIndex] = moveName
        }

        const moveLookupMap = await buildMoveLookupByName(nextMoves)
        const nextMovePpState = buildMovePpStateFromMoves({
            moveNames: nextMoves,
            movePpState: userPokemon.movePpState,
            moveLookupMap,
        })

        let persistedPokemon = null
        if (restrictionResult.usesOffTypeAllowance) {
            const currentOffTypeSkillAllowance = getOffTypeSkillAllowance(userPokemon, {
                pokemonSpecies: userPokemon.pokemonId,
                currentMoveNames: currentMoves,
                currentMoveLookupMap,
            })

            persistedPokemon = await UserPokemon.findOneAndUpdate(
                withActiveUserPokemonFilter({
                    _id: req.params.id,
                    userId,
                    updatedAt: userPokemon.updatedAt,
                }),
                {
                    $set: {
                        moves: nextMoves,
                        movePpState: nextMovePpState,
                        offTypeSkillAllowance: currentOffTypeSkillAllowance,
                        allowOffTypeSkills: currentOffTypeSkillAllowance > 0,
                    },
                },
                { new: true }
            )

            if (!persistedPokemon) {
                const conflictError = new Error('OFF_TYPE_SKILL_ALLOWANCE_CONFLICT')
                conflictError.statusCode = 409
                throw conflictError
            }
        } else {
            userPokemon.moves = nextMoves
            userPokemon.movePpState = nextMovePpState
            persistedPokemon = await userPokemon.save()
        }

        if (consumedEntry.quantity <= 0) {
            await UserMoveInventory.deleteOne({ _id: consumedEntry._id, quantity: { $lte: 0 } })
        }

        return res.json({
            ok: true,
            message: replacedMove
                ? `${persistedPokemon?.nickname || userPokemon.nickname || 'Pokemon'} đã học ${moveName} và quên ${replacedMove}`
                : `${persistedPokemon?.nickname || userPokemon.nickname || 'Pokemon'} đã học ${moveName}`,
            pokemon: {
                _id: persistedPokemon?._id || userPokemon._id,
                moves: persistedPokemon?.moves || nextMoves,
                movePpState: toDisplayMovePpState(persistedPokemon?.movePpState || nextMovePpState),
                offTypeSkillAllowance: getOffTypeSkillAllowance(persistedPokemon || userPokemon, {
                    pokemonSpecies: userPokemon.pokemonId,
                    currentMoveNames: persistedPokemon?.moves || nextMoves,
                    currentMoveLookupMap: moveLookupMap,
                }),
                allowOffTypeSkills: getOffTypeSkillAllowance(persistedPokemon || userPokemon, {
                    pokemonSpecies: userPokemon.pokemonId,
                    currentMoveNames: persistedPokemon?.moves || nextMoves,
                    currentMoveLookupMap: moveLookupMap,
                }) > 0,
            },
            taughtMove: {
                _id: move._id,
                name: moveName,
                type: move.type,
                category: move.category,
                power: move.power,
                accuracy: move.accuracy,
                pp: move.pp,
                priority: move.priority,
            },
            replacedMove,
            inventory: {
                moveId,
                remainingQuantity: Math.max(0, Number(consumedEntry.quantity || 0)),
            },
        })
    } catch (error) {
        if (consumedSkill && consumeIdentity) {
            try {
                await UserMoveInventory.updateOne(consumeIdentity, { $inc: { quantity: 1 } }, { upsert: true })
            } catch (rollbackError) {
                console.error('POST /api/pokemon/:id/teach-skill rollback error:', rollbackError)
            }
        }
        if (error?.statusCode === 409) {
            return res.status(409).json({ ok: false, message: 'Trạng thái ô skill khác hệ đã thay đổi, vui lòng thử lại' })
        }
        console.error('POST /api/pokemon/:id/teach-skill error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/pokemon/:id/remove-skill (protected)
router.post('/:id/remove-skill', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const rawMoveName = String(req.body?.moveName || '').trim()
        const rawMoveIndex = req.body?.moveIndex

        const userPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: req.params.id, userId }))
            .populate('pokemonId', 'levelUpMoves')

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon của bạn' })
        }

        const currentMoves = resolveKnownMoveList(userPokemon, 4)

        let moveIndex = -1
        if (rawMoveName) {
            const targetKey = normalizeMoveName(rawMoveName)
            moveIndex = currentMoves.findIndex((entry) => normalizeMoveName(entry) === targetKey)
        } else if (rawMoveIndex !== undefined && rawMoveIndex !== null && rawMoveIndex !== '') {
            const parsed = Number.parseInt(rawMoveIndex, 10)
            if (Number.isInteger(parsed)) {
                moveIndex = parsed
            }
        }

        if (moveIndex < 0 || moveIndex >= currentMoves.length) {
            return res.status(400).json({ ok: false, message: 'Không tìm thấy kỹ năng cần gỡ' })
        }

        const moveName = currentMoves[moveIndex]
        const defaultMoveSet = new Set(['struggle'])

        if (defaultMoveSet.has(normalizeMoveName(moveName))) {
            return res.status(400).json({ ok: false, message: 'Không thể gỡ kỹ năng mặc định của Pokemon' })
        }

        const nextMoves = currentMoves.filter((_, index) => index !== moveIndex)
        const removeKey = normalizeMoveName(moveName)
        const currentMoveLookupMap = await buildMoveLookupByName(currentMoves)
        const currentOffTypeSkillAllowance = getOffTypeSkillAllowance(userPokemon, {
            pokemonSpecies: userPokemon.pokemonId,
            currentMoveNames: currentMoves,
            currentMoveLookupMap,
        })
        let nextMovePpState = (Array.isArray(userPokemon.movePpState) ? userPokemon.movePpState : [])
            .filter((entry) => normalizeMoveName(entry?.moveName) !== removeKey)

        if (nextMoves.length > 0) {
            const nextMoveKeySet = new Set(nextMoves.map((entry) => normalizeMoveName(entry)))
            nextMovePpState = nextMovePpState.filter((entry) => nextMoveKeySet.has(normalizeMoveName(entry?.moveName)))
        }

        const moveLookupMap = await buildMoveLookupByName(nextMoves)
        const syncedMovePpState = buildMovePpStateFromMoves({
            moveNames: nextMoves,
            movePpState: nextMovePpState,
            moveLookupMap,
        })

        userPokemon.moves = nextMoves
        userPokemon.movePpState = syncedMovePpState
        userPokemon.offTypeSkillAllowance = currentOffTypeSkillAllowance
        userPokemon.allowOffTypeSkills = currentOffTypeSkillAllowance > 0
        await userPokemon.save()

        const removedMoveDoc = await Move.findOne({
            nameLower: normalizeMoveName(moveName),
        })
            .select('_id')
            .lean()

        if (removedMoveDoc?._id) {
            await UserMoveInventory.updateOne(
                {
                    userId,
                    moveId: removedMoveDoc._id,
                },
                { $inc: { quantity: 1 } },
                { upsert: true }
            )
        }

        res.json({
            ok: true,
            message: `${userPokemon.nickname || 'Pokemon'} đã gỡ kỹ năng ${moveName} và trả về kho kỹ năng`,
            pokemon: {
                _id: userPokemon._id,
                moves: userPokemon.moves,
                movePpState: toDisplayMovePpState(userPokemon.movePpState),
                offTypeSkillAllowance: getOffTypeSkillAllowance(userPokemon, {
                    pokemonSpecies: userPokemon.pokemonId,
                    currentMoveNames: userPokemon.moves,
                    currentMoveLookupMap: moveLookupMap,
                }),
                allowOffTypeSkills: getOffTypeSkillAllowance(userPokemon, {
                    pokemonSpecies: userPokemon.pokemonId,
                    currentMoveNames: userPokemon.moves,
                    currentMoveLookupMap: moveLookupMap,
                }) > 0,
            },
            removedMove: moveName,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/remove-skill error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/pokemon/fusion/config (protected)
router.get('/fusion/config', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const fusionRuntimeConfig = await loadFusionRuntimeConfig()
        const fusionItems = await Item.find({
            effectType: { $in: FUSION_ITEM_EFFECT_TYPES },
        })
            .select('_id name nameLower type rarity imageUrl description effectType effectValue')
            .sort({ effectType: 1, rarity: 1, nameLower: 1, _id: 1 })
            .lean()

        const fusionItemIds = fusionItems.map((entry) => entry?._id).filter(Boolean)
        const inventoryRows = fusionItemIds.length > 0
            ? await UserInventory.find({
                userId,
                itemId: { $in: fusionItemIds },
            })
                .select('itemId quantity')
                .lean()
            : []

        const inventoryByItemId = new Map(
            inventoryRows.map((entry) => [String(entry?.itemId || '').trim(), Math.max(0, Number(entry?.quantity || 0))])
        )

        const slotRows = FUSION_ITEM_EFFECT_TYPES.map((effectType) => {
            const meta = FUSION_ITEM_SLOT_META[effectType] || {}
            const items = fusionItems
                .filter((entry) => String(entry?.effectType || '').trim() === effectType)
                .map((entry) => ({
                    _id: entry._id,
                    name: entry.name,
                    type: entry.type,
                    rarity: entry.rarity,
                    imageUrl: entry.imageUrl || '',
                    description: entry.description || '',
                    effectType,
                    effectValue: Number(entry?.effectValue || 0),
                    inventoryQuantity: Math.max(0, Number(inventoryByItemId.get(String(entry?._id || '').trim()) || 0)),
                }))

            return {
                effectType,
                label: meta.label || effectType,
                required: meta.required === true,
                description: meta.description || '',
                requestField: FUSION_ITEM_FIELD_BY_EFFECT_TYPE[effectType],
                items,
            }
        })

        return res.json({
            ok: true,
            fusion: {
                itemSlots: slotRows,
                rulePreview: {
                    strictMaterialUntilFusionLevel: fusionRuntimeConfig.strictMaterialUntilFusionLevel,
                    superFusionStoneBonusPercent: fusionRuntimeConfig.superFusionStoneBonusPercent,
                    finalSuccessRateCapPercent: fusionRuntimeConfig.finalSuccessRateCapPercent,
                    baseSuccessRateByFusionLevel: fusionRuntimeConfig.baseSuccessRateByFusionLevel,
                    totalStatBonusPercentByFusionLevel: fusionRuntimeConfig.totalStatBonusPercentByFusionLevel,
                    milestones: fusionRuntimeConfig.milestones,
                    failurePenaltyByLevelBracket: fusionRuntimeConfig.failurePenaltyByLevelBracket,
                    failureLevelThresholdByBracket: fusionRuntimeConfig.failureLevelThresholdByBracket,
                },
            },
        })
    } catch (error) {
        console.error('GET /api/pokemon/fusion/config error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải cấu hình ghép Pokemon' })
    }
})

// POST /api/pokemon/:id/fusion (protected)
router.post('/:id/fusion', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const targetPokemonId = normalizeObjectIdLike(req.params.id)
        const materialPokemonId = normalizeObjectIdLike(req.body?.materialPokemonId)

        if (!mongoose.Types.ObjectId.isValid(targetPokemonId)) {
            return res.status(400).json({ ok: false, message: 'Pokemon đích không hợp lệ' })
        }
        if (!mongoose.Types.ObjectId.isValid(materialPokemonId)) {
            return res.status(400).json({ ok: false, message: 'Pokemon nguyên liệu không hợp lệ' })
        }
        if (targetPokemonId === materialPokemonId) {
            return res.status(400).json({ ok: false, message: 'Pokemon đích và Pokemon nguyên liệu phải khác nhau' })
        }

        const requestedFusionItems = FUSION_ITEM_EFFECT_TYPES.map((effectType) => ({
            effectType,
            requestField: FUSION_ITEM_FIELD_BY_EFFECT_TYPE[effectType],
            required: FUSION_ITEM_SLOT_META[effectType]?.required === true,
            itemId: normalizeObjectIdLike(req.body?.[FUSION_ITEM_FIELD_BY_EFFECT_TYPE[effectType]]),
        }))

        for (const requestedItem of requestedFusionItems) {
            if (requestedItem.required && !requestedItem.itemId) {
                const slotLabel = FUSION_ITEM_SLOT_META[requestedItem.effectType]?.label || requestedItem.effectType
                return res.status(400).json({ ok: false, message: `Thiếu ${slotLabel}` })
            }
            if (requestedItem.itemId && !mongoose.Types.ObjectId.isValid(requestedItem.itemId)) {
                return res.status(400).json({ ok: false, message: `${requestedItem.requestField} không hợp lệ` })
            }
        }

        const selectedItemIds = requestedFusionItems
            .map((entry) => entry.itemId)
            .filter(Boolean)

        const selectedItemIdSet = new Set(selectedItemIds)
        if (selectedItemIdSet.size !== selectedItemIds.length) {
            return res.status(400).json({ ok: false, message: 'Không thể dùng cùng một vật phẩm cho nhiều ô đá ghép' })
        }

        const fusionRuntimeConfig = await loadFusionRuntimeConfig()

        const fusionResult = await runWithOptionalTransaction(async (session) => {
            const withSession = (query) => (session ? query.session(session) : query)
            const standaloneRollbackState = {
                consumedInventoryRows: [],
                targetPokemonId: '',
                targetFusionLevelBefore: 0,
                targetFusionLevelUpdated: false,
            }

            const rollbackStandaloneFusionWrites = async () => {
                if (session) return

                if (standaloneRollbackState.targetFusionLevelUpdated && standaloneRollbackState.targetPokemonId) {
                    await UserPokemon.updateOne(
                        {
                            _id: standaloneRollbackState.targetPokemonId,
                            userId,
                        },
                        {
                            $set: { fusionLevel: standaloneRollbackState.targetFusionLevelBefore },
                        }
                    )
                }

                for (const row of standaloneRollbackState.consumedInventoryRows) {
                    if (!row?.itemId || Number(row?.quantity || 0) <= 0) continue
                    await UserInventory.updateOne(
                        {
                            userId,
                            itemId: row.itemId,
                        },
                        {
                            $inc: { quantity: Number(row.quantity || 0) },
                        },
                        { upsert: true }
                    )
                }
            }

            const [targetPokemon, materialPokemon] = await Promise.all([
                withSession(
                    UserPokemon.findOne(withActiveUserPokemonFilter({
                        _id: targetPokemonId,
                        userId,
                        location: 'box',
                    }))
                        .select('_id userId pokemonId nickname level formId fusionLevel location')
                        .populate('pokemonId', 'name rarity')
                ),
                withSession(
                    UserPokemon.findOne(withActiveUserPokemonFilter({
                        _id: materialPokemonId,
                        userId,
                        location: 'box',
                    }))
                        .select('_id userId pokemonId nickname level formId fusionLevel location')
                        .populate('pokemonId', 'name rarity')
                ),
            ])

            if (!targetPokemon) {
                throw createHttpError(404, 'Không tìm thấy Pokemon đích trong hộp đồ')
            }
            if (!materialPokemon) {
                throw createHttpError(404, 'Không tìm thấy Pokemon nguyên liệu trong hộp đồ')
            }

            const targetSpecies = targetPokemon?.pokemonId
            const materialSpecies = materialPokemon?.pokemonId
            if (!targetSpecies || !materialSpecies) {
                throw createHttpError(400, 'Thiếu dữ liệu loài Pokemon để ghép')
            }

            const targetFusionLevel = normalizeFusionLevel(targetPokemon?.fusionLevel)
            const targetSpeciesId = normalizeObjectIdLike(targetSpecies?._id)
            const materialSpeciesId = normalizeObjectIdLike(materialSpecies?._id)
            const targetFormId = normalizeFormId(targetPokemon?.formId || 'normal')
            const materialFormId = normalizeFormId(materialPokemon?.formId || 'normal')

            if (targetFusionLevel < fusionRuntimeConfig.strictMaterialUntilFusionLevel) {
                if (targetSpeciesId !== materialSpeciesId) {
                    throw createHttpError(400, 'Mốc ghép hiện tại yêu cầu Pokemon nguyên liệu cùng loài với Pokemon đích')
                }
                if (targetFormId !== materialFormId) {
                    throw createHttpError(400, 'Mốc ghép hiện tại yêu cầu Pokemon nguyên liệu cùng dạng với Pokemon đích')
                }
                if (Number(targetPokemon?.level || 1) !== Number(materialPokemon?.level || 1)) {
                    throw createHttpError(400, 'Mốc ghép hiện tại yêu cầu Pokemon nguyên liệu cùng cấp với Pokemon đích')
                }
            } else {
                const targetRarityIndex = getPokemonRarityIndex(targetSpecies?.rarity)
                const materialRarityIndex = getPokemonRarityIndex(materialSpecies?.rarity)
                if (targetRarityIndex < 0 || materialRarityIndex < 0 || materialRarityIndex < targetRarityIndex) {
                    throw createHttpError(400, 'Mốc ghép hiện tại yêu cầu Pokemon nguyên liệu có độ hiếm bằng hoặc cao hơn Pokemon đích')
                }
            }

            const requestedItemIds = selectedItemIds
            const itemDocs = requestedItemIds.length > 0
                ? await withSession(
                    Item.find({ _id: { $in: requestedItemIds } })
                        .select('_id name effectType effectValue imageUrl')
                        .lean()
                )
                : []

            const itemById = new Map(
                itemDocs.map((entry) => [normalizeObjectIdLike(entry?._id), entry])
            )

            const consumedItems = []
            for (const requestedItem of requestedFusionItems) {
                if (!requestedItem.itemId) continue
                const itemDoc = itemById.get(requestedItem.itemId)
                if (!itemDoc) {
                    throw createHttpError(400, `${requestedItem.requestField} không tồn tại`)
                }

                const actualEffectType = String(itemDoc?.effectType || '').trim()
                if (actualEffectType !== requestedItem.effectType) {
                    const expectedLabel = FUSION_ITEM_SLOT_META[requestedItem.effectType]?.label || requestedItem.effectType
                    throw createHttpError(400, `${itemDoc.name || 'Vật phẩm'} không phải ${expectedLabel}`)
                }

                const updatedInventory = await UserInventory.findOneAndUpdate(
                    {
                        userId,
                        itemId: itemDoc._id,
                        quantity: { $gte: 1 },
                    },
                    { $inc: { quantity: -1 } },
                    getSessionOptions(session, { new: true })
                )

                if (!updatedInventory) {
                    throw createHttpError(400, `Bạn không đủ ${itemDoc.name || 'vật phẩm ghép'} trong túi đồ`)
                }

                const remainingQuantity = Math.max(0, Number(updatedInventory?.quantity || 0))
                if (remainingQuantity <= 0) {
                    await UserInventory.deleteOne(
                        { _id: updatedInventory._id, quantity: { $lte: 0 } },
                        getSessionOptions(session)
                    )
                }
                standaloneRollbackState.consumedInventoryRows.push({ itemId: itemDoc._id, quantity: 1 })

                consumedItems.push({
                    _id: itemDoc._id,
                    name: itemDoc.name,
                    imageUrl: itemDoc.imageUrl || '',
                    effectType: actualEffectType,
                    effectValue: Number(itemDoc?.effectValue || 0),
                    consumedQuantity: 1,
                    remainingQuantity,
                })
            }

            const luckyItem = consumedItems.find((entry) => entry.effectType === 'fusionLuckyStone') || null
            const protectionItem = consumedItems.find((entry) => entry.effectType === 'fusionProtectionStone') || null
            const superFusionItem = consumedItems.find((entry) => entry.effectType === 'superFusionStone') || null

            const luckyBonusPercent = luckyItem
                ? Math.min(100, Math.max(0, Number(luckyItem.effectValue || 0)))
                : 0
            const successRate = computeFusionFinalSuccessRate({
                fusionLevel: targetFusionLevel,
                luckyBonusPercent,
                hasSuperFusionStone: Boolean(superFusionItem),
                baseSuccessRateByFusionLevel: fusionRuntimeConfig.baseSuccessRateByFusionLevel,
                superFusionStoneBonusPercent: fusionRuntimeConfig.superFusionStoneBonusPercent,
                finalSuccessRateCapPercent: fusionRuntimeConfig.finalSuccessRateCapPercent,
            })
            const rollPercent = Math.random() * 100
            const isSuccess = rollPercent < successRate.finalSuccessRate

            const fusionLevelBefore = targetFusionLevel
            let fusionLevelAfter = fusionLevelBefore
            let failurePenalty = 0
            standaloneRollbackState.targetPokemonId = String(targetPokemon?._id || '')
            standaloneRollbackState.targetFusionLevelBefore = fusionLevelBefore

            try {
                if (isSuccess) {
                    fusionLevelAfter = fusionLevelBefore + 1
                } else if (!protectionItem) {
                    failurePenalty = getFusionFailurePenalty(
                        fusionLevelBefore,
                        fusionRuntimeConfig.failurePenaltyByLevelBracket,
                        fusionRuntimeConfig.failureLevelThresholdByBracket
                    )
                    fusionLevelAfter = Math.max(0, fusionLevelBefore - failurePenalty)
                }

                targetPokemon.fusionLevel = fusionLevelAfter
                await targetPokemon.save(getSessionOptions(session))
                standaloneRollbackState.targetFusionLevelUpdated = true

                const materialDeleteResult = await UserPokemon.deleteOne(
                    { _id: materialPokemon._id, userId, location: 'box' },
                    getSessionOptions(session)
                )

                if (Number(materialDeleteResult?.deletedCount || 0) !== 1) {
                    throw createHttpError(409, 'Pokémon hiến tế không còn trong kho để ghép')
                }
            } catch (writeError) {
                if (!session) {
                    try {
                        await rollbackStandaloneFusionWrites()
                    } catch (rollbackError) {
                        console.error('Fusion standalone rollback failed:', rollbackError)
                    }
                }
                throw writeError
            }

            const targetDisplayName = String(targetPokemon?.nickname || targetSpecies?.name || 'Pokemon').trim() || 'Pokemon'
            const materialDisplayName = String(materialPokemon?.nickname || materialSpecies?.name || 'Pokemon').trim() || 'Pokemon'

            const message = isSuccess
                ? `${targetDisplayName} ghép thành công và tăng lên mốc +${fusionLevelAfter}.`
                : (protectionItem
                    ? `${targetDisplayName} ghép thất bại, nhưng đã được bảo hộ nên giữ nguyên mốc +${fusionLevelAfter}.`
                    : `${targetDisplayName} ghép thất bại và bị tụt ${failurePenalty} mốc về +${fusionLevelAfter}.`)

            return {
                message,
                fusion: {
                    success: isSuccess,
                    baseSuccessRate: successRate.baseSuccessRate,
                    luckyBonusPercent: successRate.luckyBonusPercent,
                    superBonusPercent: successRate.superBonusPercent,
                    finalSuccessRate: successRate.finalSuccessRate,
                    rollPercent: Number(rollPercent.toFixed(4)),
                    failurePenalty,
                    consumedMaterialPokemonId: materialPokemon._id,
                    consumedMaterialPokemonName: materialDisplayName,
                    protectionApplied: Boolean(protectionItem),
                    target: {
                        _id: targetPokemon._id,
                        name: targetDisplayName,
                        speciesName: targetSpecies?.name || '',
                        formId: targetFormId,
                        level: Number(targetPokemon?.level || 1),
                        fusionLevelBefore,
                        fusionLevelAfter,
                    },
                    consumedItems,
                },
            }
        })

        return res.json({
            ok: true,
            message: fusionResult.message,
            fusion: fusionResult.fusion,
        })
    } catch (error) {
        const status = Number(error?.status || 0)
        if (status >= 400 && status < 500) {
            return res.status(status).json({ ok: false, message: error.message || 'Ghép Pokemon thất bại' })
        }

        const fallbackMessage = String(error?.message || '').trim()
        const userFacingValidationPatterns = [
            'không hợp lệ',
            'không tìm thấy',
            'thiếu',
            'không đủ',
            'yêu cầu',
            'không phải',
            'thất bại',
        ]
        if (fallbackMessage) {
            const normalizedMessage = fallbackMessage.toLowerCase()
            if (userFacingValidationPatterns.some((pattern) => normalizedMessage.includes(pattern))) {
                return res.status(400).json({ ok: false, message: fallbackMessage })
            }
        }

        console.error('POST /api/pokemon/:id/fusion error:', error)
        const debugMessage = process.env.NODE_ENV !== 'production' && fallbackMessage
            ? `Lỗi máy chủ: ${fallbackMessage}`
            : 'Lỗi máy chủ'
        return res.status(500).json({ ok: false, message: debugMessage })
    }
})

// POST /api/pokemon/:id/evolve (protected)
router.post('/:id/evolve', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId
        const userPokemon = await UserPokemon.findOne(withActiveUserPokemonFilter({ _id: req.params.id, userId }))
            .populate('pokemonId')

        if (!userPokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        const currentSpecies = userPokemon.pokemonId
        if (!currentSpecies) {
            return res.status(404).json({ ok: false, message: 'Thiếu dữ liệu gốc của Pokemon' })
        }

        const evolutionRule = resolveEvolutionRule(currentSpecies, userPokemon.formId)
        if (!evolutionRule?.evolvesTo) {
            return res.status(400).json({ ok: false, message: 'Pokemon này chưa có cấu hình tiến hóa' })
        }

        if (Number.isFinite(evolutionRule.minLevel) && evolutionRule.minLevel >= 1 && userPokemon.level < evolutionRule.minLevel) {
            return res.status(400).json({ ok: false, message: `Cần đạt cấp ${evolutionRule.minLevel} để tiến hóa` })
        }

        const requiredItemId = String(evolutionRule.requiredItemId?._id || evolutionRule.requiredItemId || '').trim()
        const requiredItemQuantity = requiredItemId
            ? Math.max(1, Number.parseInt(evolutionRule.requiredItemQuantity, 10) || 1)
            : 0

        const targetSpecies = await Pokemon.findById(evolutionRule.evolvesTo)
            .select('name imageUrl sprites baseStats forms defaultFormId levelUpMoves')
            .lean()

        if (!targetSpecies) {
            return res.status(404).json({ ok: false, message: 'Pokemon tiến hóa không tồn tại' })
        }

        let consumedItem = null
        if (requiredItemId) {
            const requiredItem = await Item.findOne({
                _id: requiredItemId,
                isEvolutionMaterial: true,
            })
                .select('_id name imageUrl evolutionRarityFrom evolutionRarityTo')
                .lean()

            if (!requiredItem) {
                return res.status(400).json({ ok: false, message: 'Vật phẩm tiến hóa chưa được cấu hình hợp lệ' })
            }

            if (!isEvolutionItemAllowedForRarity(requiredItem, currentSpecies?.rarity)) {
                return res.status(400).json({
                    ok: false,
                    message: `${requiredItem.name} chỉ dùng cho Pokemon rank ${String(requiredItem.evolutionRarityFrom || 'd').toUpperCase()} - ${String(requiredItem.evolutionRarityTo || 'sss+').toUpperCase()}`,
                })
            }

            const updatedInventory = await UserInventory.findOneAndUpdate(
                {
                    userId,
                    itemId: requiredItemId,
                    quantity: { $gte: requiredItemQuantity },
                },
                {
                    $inc: { quantity: -requiredItemQuantity },
                },
                {
                    new: true,
                }
            ).lean()

            if (!updatedInventory) {
                return res.status(400).json({
                    ok: false,
                    message: `Bạn không đủ ${requiredItemQuantity} ${requiredItem.name} để tiến hóa`,
                })
            }

            const remainingQuantity = Math.max(0, Number(updatedInventory?.quantity || 0))
            if (remainingQuantity <= 0) {
                await UserInventory.deleteOne({ _id: updatedInventory._id })
            }

            consumedItem = {
                _id: requiredItem._id,
                name: requiredItem.name,
                imageUrl: requiredItem.imageUrl || '',
                quantity: requiredItemQuantity,
                remainingQuantity,
            }
        }

        const targetForms = Array.isArray(targetSpecies.forms) ? targetSpecies.forms : []
        const currentFormId = String(userPokemon.formId || '').trim().toLowerCase()
        const targetFormId = String(evolutionRule?.targetFormId || '').trim().toLowerCase()
        const hasExplicitTargetForm = targetFormId
            && targetForms.some((entry) => String(entry?.formId || '').trim().toLowerCase() === targetFormId)
        const canKeepForm = currentFormId && targetForms.some((entry) => String(entry?.formId || '').trim().toLowerCase() === currentFormId)
        const nextFormId = hasExplicitTargetForm
            ? targetFormId
            : (canKeepForm
                ? currentFormId
                : (String(targetSpecies.defaultFormId || '').trim().toLowerCase() || 'normal'))

        const fromName = currentSpecies.name
        const fusionLevelBeforeEvolution = Math.max(0, Number.parseInt(userPokemon.fusionLevel, 10) || 0)
        const confirmFusionReset = toBoolean(req.body?.confirmFusionReset)
        if (fusionLevelBeforeEvolution > 0 && !confirmFusionReset) {
            return res.status(400).json({
                ok: false,
                code: 'FUSION_RESET_CONFIRM_REQUIRED',
                message: `Pokemon này đang có mốc ghép +${fusionLevelBeforeEvolution}. Vui lòng xác nhận reset mốc ghép trước khi tiến hóa.`,
                fusionReset: {
                    required: true,
                    before: fusionLevelBeforeEvolution,
                    after: 0,
                },
            })
        }

        userPokemon.pokemonId = targetSpecies._id
        userPokemon.formId = nextFormId
        userPokemon.fusionLevel = 0
        await syncUserPokemonMovesAndPp(userPokemon)
        await userPokemon.save()
        await userPokemon.populate('pokemonId')

        res.json({
            ok: true,
            message: consumedItem
                ? `${fromName} đã tiến hóa thành ${targetSpecies.name}! Đã dùng ${consumedItem.quantity} ${consumedItem.name}.${fusionLevelBeforeEvolution > 0 ? ` Mốc ghép +${fusionLevelBeforeEvolution} đã được đặt lại về +0.` : ''}`
                : `${fromName} đã tiến hóa thành ${targetSpecies.name}!${fusionLevelBeforeEvolution > 0 ? ` Mốc ghép +${fusionLevelBeforeEvolution} đã được đặt lại về +0.` : ''}`,
            evolution: {
                from: fromName,
                to: targetSpecies.name,
                level: userPokemon.level,
                targetFormId: nextFormId,
                consumedItem,
                fusionReset: {
                    required: fusionLevelBeforeEvolution > 0,
                    before: fusionLevelBeforeEvolution,
                    after: 0,
                },
            },
            pokemon: userPokemon,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/evolve error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
