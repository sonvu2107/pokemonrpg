import express from 'express'
import jwt from 'jsonwebtoken'
import UserPokemon from '../models/UserPokemon.js'
import Pokemon from '../models/Pokemon.js'
import Move from '../models/Move.js'
import MarketListing from '../models/MarketListing.js'
import UserMoveInventory from '../models/UserMoveInventory.js'
import UserInventory from '../models/UserInventory.js'
import Item from '../models/Item.js'
import VipPrivilegeTier from '../models/VipPrivilegeTier.js'
import { calcStatsForLevel, calcMaxHp } from '../utils/gameUtils.js'
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

const getOffTypeSkillAllowance = (userPokemonLike = null) => {
    const explicitAllowance = Math.max(0, Number.parseInt(userPokemonLike?.offTypeSkillAllowance, 10) || 0)
    if (explicitAllowance > 0) return explicitAllowance
    return userPokemonLike?.allowOffTypeSkills ? 1 : 0
}

const hasLegacyOffTypeSkillState = (userPokemonLike = null) => {
    const explicitAllowance = Math.max(0, Number.parseInt(userPokemonLike?.offTypeSkillAllowance, 10) || 0)
    return explicitAllowance <= 0 && Boolean(userPokemonLike?.allowOffTypeSkills)
}

const evaluateMoveLearnRestriction = (move, pokemonSpecies, userPokemonLike = null) => {
    const learnScope = String(move?.learnScope || 'all').trim().toLowerCase() || 'all'
    const speciesId = String(pokemonSpecies?._id || '').trim()
    const speciesTypes = normalizeStringSet(pokemonSpecies?.types)
    const speciesRarity = String(pokemonSpecies?.rarity || '').trim().toLowerCase()
    const offTypeSkillAllowance = getOffTypeSkillAllowance(userPokemonLike)

    if (learnScope === 'all') {
        return { canLearn: true, reason: '', usesOffTypeAllowance: false }
    }

    if (learnScope === 'move_type') {
        const moveType = String(move?.type || '').trim().toLowerCase()
        if (!moveType || !speciesTypes.has(moveType)) {
            if (offTypeSkillAllowance > 0) {
                return { canLearn: true, reason: '', usesOffTypeAllowance: true }
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
        const allowedTypeSet = normalizeStringSet(move?.allowedTypes)
        const intersects = [...speciesTypes].some((entry) => allowedTypeSet.has(entry))
        if (!intersects) {
            if (offTypeSkillAllowance > 0) {
                return { canLearn: true, reason: '', usesOffTypeAllowance: true }
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

const toStatNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const toSafePositiveInt = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Number(fallback) || 1)
    return Math.max(1, Math.floor(parsed))
}

const calcPokemonCombatPower = ({ userPokemon, scaledStats, level }) => {
    const ivs = userPokemon?.ivs && typeof userPokemon.ivs === 'object' ? userPokemon.ivs : {}
    const evs = userPokemon?.evs && typeof userPokemon.evs === 'object' ? userPokemon.evs : {}

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
        + (Math.max(1, Number(level || 1)) * 2)
    const shinyBonus = userPokemon?.isShiny ? 1.03 : 1
    return toSafePositiveInt(rawPower * shinyBonus, Math.max(1, Number(level || 1) * 10))
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

        // Calculate actual stats based on level, rarity, (and potentially IVs/EVs in future)
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

        // Base stats from species/form
        const stats = calcStatsForLevel(resolvedStatsSource, level, rarity)
        const maxHp = calcMaxHp(resolvedStatsSource?.hp, level, rarity)
        const combatPower = calcPokemonCombatPower({
            userPokemon,
            scaledStats: {
                ...stats,
                hp: maxHp,
            },
            level,
        })

        // Enhance response with calculated stats
        const responseData = {
            ...userPokemon,
            offTypeSkillAllowance: getOffTypeSkillAllowance(userPokemon),
            allowOffTypeSkills: getOffTypeSkillAllowance(userPokemon) > 0,
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
                const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId, userPokemon)

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

        res.json({
            ok: true,
            pokemon: {
                _id: req.params.id,
                moves: knownMoves,
                offTypeSkillAllowance: getOffTypeSkillAllowance(userPokemon),
                allowOffTypeSkills: getOffTypeSkillAllowance(userPokemon) > 0,
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

        if (hasLegacyOffTypeSkillState(userPokemon)) {
            userPokemon.offTypeSkillAllowance = 1
            userPokemon.allowOffTypeSkills = true
            await userPokemon.save()
        }

        const restrictionResult = evaluateMoveLearnRestriction(move, userPokemon.pokemonId, userPokemon)
        if (!restrictionResult.canLearn) {
            return res.status(400).json({ ok: false, message: restrictionResult.reason })
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
            const currentOffTypeSkillAllowance = getOffTypeSkillAllowance(userPokemon)
            const nextOffTypeSkillAllowance = Math.max(0, currentOffTypeSkillAllowance - 1)

            persistedPokemon = await UserPokemon.findOneAndUpdate(
                withActiveUserPokemonFilter({
                    _id: req.params.id,
                    userId,
                    offTypeSkillAllowance: currentOffTypeSkillAllowance,
                }),
                {
                    $set: {
                        moves: nextMoves,
                        movePpState: nextMovePpState,
                        offTypeSkillAllowance: nextOffTypeSkillAllowance,
                        allowOffTypeSkills: nextOffTypeSkillAllowance > 0,
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
                offTypeSkillAllowance: getOffTypeSkillAllowance(persistedPokemon || userPokemon),
                allowOffTypeSkills: getOffTypeSkillAllowance(persistedPokemon || userPokemon) > 0,
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
            return res.status(409).json({ ok: false, message: 'Lượt học skill khác hệ đã thay đổi, vui lòng thử lại' })
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
            },
            removedMove: moveName,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/remove-skill error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
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
        userPokemon.pokemonId = targetSpecies._id
        userPokemon.formId = nextFormId
        await syncUserPokemonMovesAndPp(userPokemon)
        await userPokemon.save()
        await userPokemon.populate('pokemonId')

        res.json({
            ok: true,
            message: consumedItem
                ? `${fromName} đã tiến hóa thành ${targetSpecies.name}! Đã dùng ${consumedItem.quantity} ${consumedItem.name}.`
                : `${fromName} đã tiến hóa thành ${targetSpecies.name}!`,
            evolution: {
                from: fromName,
                to: targetSpecies.name,
                level: userPokemon.level,
                targetFormId: nextFormId,
                consumedItem,
            },
            pokemon: userPokemon,
        })
    } catch (error) {
        console.error('POST /api/pokemon/:id/evolve error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
