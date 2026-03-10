import BadgeDefinition, { BADGE_EFFECT_TYPES, BADGE_MISSION_TYPES, BADGE_RANKS } from '../models/BadgeDefinition.js'
import User from '../models/User.js'
import UserPokemon from '../models/UserPokemon.js'
import PlayerState from '../models/PlayerState.js'
import { withActiveUserPokemonFilter } from './userPokemonQuery.js'
import { getTotalOnlineHours } from './onlineTime.js'

export const BADGE_MAX_EQUIPPED = 5

const clampPercent = (value, min = 0, max = 1000) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return min
    return Math.max(min, Math.min(max, Math.round(parsed * 100) / 100))
}

const normalizePokemonType = (value = '') => String(value || '').trim().toLowerCase()
const normalizePokemonName = (value = '') => String(value || '').trim().toLowerCase()

const slugify = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

export const normalizeBadgeMissionConfig = (missionType = '', missionConfigLike = {}) => {
    const source = missionConfigLike && typeof missionConfigLike === 'object' ? missionConfigLike : {}
    const requiredCount = Math.max(1, Math.floor(Number(source?.requiredCount) || 1))

    if (missionType === 'collect_type_count' || missionType === 'collect_type_distinct_count') {
        return {
            pokemonType: normalizePokemonType(source?.pokemonType),
            pokemonName: '',
            requiredCount,
        }
    }

    if (missionType === 'collect_same_name_different_type_count') {
        return {
            pokemonType: '',
            pokemonName: normalizePokemonName(source?.pokemonName),
            requiredCount,
        }
    }

    return {
        pokemonType: '',
        pokemonName: '',
        requiredCount,
    }
}

export const normalizeBadgeRewardEffects = (rewardEffectsLike = []) => {
    if (!Array.isArray(rewardEffectsLike)) return []

    return rewardEffectsLike
        .map((entry) => {
            const effectType = String(entry?.effectType || '').trim()
            if (!BADGE_EFFECT_TYPES.includes(effectType)) return null

            const normalized = {
                effectType,
                percent: clampPercent(entry?.percent),
                pokemonType: '',
            }

            if (effectType === 'party_type_damage_percent') {
                normalized.pokemonType = normalizePokemonType(entry?.pokemonType)
                if (!normalized.pokemonType) return null
            }

            return normalized.percent > 0 ? normalized : null
        })
        .filter(Boolean)
        .slice(0, 8)
}

export const normalizeBadgeRank = (value = 'D') => {
    const normalized = String(value || '').trim().toUpperCase()
    return BADGE_RANKS.includes(normalized) ? normalized : 'D'
}

export const serializeBadgeDefinition = (badgeLike = {}) => {
    const missionType = String(badgeLike?.missionType || '').trim()
    const rewardEffects = normalizeBadgeRewardEffects(badgeLike?.rewardEffects)
    const missionConfig = normalizeBadgeMissionConfig(missionType, badgeLike?.missionConfig)
    return {
        _id: badgeLike?._id,
        code: String(badgeLike?.code || '').trim().toUpperCase(),
        slug: String(badgeLike?.slug || '').trim().toLowerCase(),
        name: String(badgeLike?.name || '').trim(),
        description: String(badgeLike?.description || '').trim(),
        imageUrl: String(badgeLike?.imageUrl || '').trim(),
        rank: normalizeBadgeRank(badgeLike?.rank),
        isActive: badgeLike?.isActive !== false,
        orderIndex: Math.max(0, Number(badgeLike?.orderIndex) || 0),
        missionType,
        missionConfig,
        rewardEffects,
        missionLabel: describeMission({ missionType, missionConfig }),
        rewardLabels: describeEffects(rewardEffects),
        rewardLabel: describeEffects(rewardEffects).join(', '),
        createdAt: badgeLike?.createdAt || null,
        updatedAt: badgeLike?.updatedAt || null,
    }
}

export const buildBadgeIdentity = ({ code = '', slug = '', name = '' } = {}) => {
    const normalizedCode = String(code || '').trim().toUpperCase()
    const normalizedName = String(name || '').trim()
    const nextSlug = slugify(slug || normalizedCode || normalizedName)
    const generatedCode = String(nextSlug || normalizedName || 'BADGE')
        .replace(/-/g, '_')
        .toUpperCase()
        .slice(0, 48)
    return {
        code: normalizedCode || generatedCode || 'BADGE',
        slug: nextSlug,
    }
}

const describeMission = (badge) => {
    const missionType = String(badge?.missionType || '').trim()
    const missionConfig = normalizeBadgeMissionConfig(missionType, badge?.missionConfig)
    const requiredCount = Math.max(1, Number(missionConfig?.requiredCount) || 1)

    if (missionType === 'collect_type_count') {
        return `Sở hữu ${requiredCount} Pokémon hệ ${String(missionConfig?.pokemonType || '').toUpperCase() || '???'} (tính trùng, tính form)`
    }

    if (missionType === 'collect_type_distinct_count') {
        return `Sở hữu ${requiredCount} Pokémon hệ ${String(missionConfig?.pokemonType || '').toUpperCase() || '???'} (không trùng, tính form)`
    }

    if (missionType === 'collect_same_name_different_type_count') {
        const pokemonName = String(missionConfig?.pokemonName || '').trim() || 'pokemon'
        return `Sưu tập ${requiredCount} biến thể hệ khác nhau của Pokémon tên ${pokemonName.toUpperCase()}`
    }

    if (missionType === 'collect_total_count') {
        return `Sở hữu tổng cộng ${requiredCount} Pokémon (bao gồm trùng, tính form)`
    }

    if (missionType === 'vip_tier_reached') {
        return `Đạt mốc VIP ${requiredCount}`
    }

    if (missionType === 'platinum_coins_owned_count') {
        return `Sở hữu ${requiredCount.toLocaleString('vi-VN')} Xu Bạch Kim`
    }

    if (missionType === 'catch_fail_count') {
        return `Bắt trượt Pokémon ${requiredCount.toLocaleString('vi-VN')} lần`
    }

    if (missionType === 'online_hours_count') {
        return `Tổng thời gian online đạt ${requiredCount} giờ`
    }

    if (missionType === 'complete_trainer_count') {
        return `Hoàn thành ${requiredCount} huấn luyện viên battle`
    }

    return 'Nhiệm vụ huy hiệu'
}

const describeEffects = (effects = []) => effects.map((entry) => {
    const percentText = `${Number(entry?.percent || 0).toLocaleString('vi-VN')}%`
    if (entry?.effectType === 'party_damage_percent') return `+${percentText} sát thương toàn đội`
    if (entry?.effectType === 'party_speed_percent') return `+${percentText} tốc độ toàn đội`
    if (entry?.effectType === 'party_hp_percent') return `+${percentText} máu toàn đội`
    if (entry?.effectType === 'party_type_damage_percent') return `+${percentText} sát thương cho Pokémon hệ ${String(entry?.pokemonType || '').toUpperCase()}`
    return `+${percentText}`
})

const createEmptyBonusSummary = () => ({
    partyDamagePercent: 0,
    partySpeedPercent: 0,
    partyHpPercent: 0,
    typeDamagePercentByType: {},
})

const createEmptyBattleBadgeBonusState = () => ({
    summary: createEmptyBonusSummary(),
    damageBonusPercent: 0,
    hpBonusPercent: 0,
    speedBonusPercent: 0,
})

export const mergeBadgeBonuses = (badges = []) => {
    const summary = createEmptyBonusSummary()

    for (const badge of Array.isArray(badges) ? badges : []) {
        for (const effect of normalizeBadgeRewardEffects(badge?.rewardEffects)) {
            if (effect.effectType === 'party_damage_percent') {
                summary.partyDamagePercent += effect.percent
                continue
            }
            if (effect.effectType === 'party_speed_percent') {
                summary.partySpeedPercent += effect.percent
                continue
            }
            if (effect.effectType === 'party_hp_percent') {
                summary.partyHpPercent += effect.percent
                continue
            }
            if (effect.effectType === 'party_type_damage_percent' && effect.pokemonType) {
                summary.typeDamagePercentByType[effect.pokemonType] = (summary.typeDamagePercentByType[effect.pokemonType] || 0) + effect.percent
            }
        }
    }

    return summary
}

export const resolveBadgeDamageBonusPercentForTypes = (bonusSummary = null, pokemonTypes = []) => {
    const summary = bonusSummary && typeof bonusSummary === 'object' ? bonusSummary : createEmptyBonusSummary()
    const normalizedTypes = [...new Set((Array.isArray(pokemonTypes) ? pokemonTypes : [])
        .map((entry) => normalizePokemonType(entry))
        .filter(Boolean))]

    return normalizedTypes.reduce(
        (total, type) => total + Math.max(0, Number(summary?.typeDamagePercentByType?.[type] || 0)),
        Math.max(0, Number(summary?.partyDamagePercent || 0))
    )
}

export const resolveBattleBadgeBonusState = (bonusSummary = null, pokemonTypes = []) => {
    const summary = bonusSummary && typeof bonusSummary === 'object'
        ? bonusSummary
        : createEmptyBonusSummary()

    return {
        summary,
        damageBonusPercent: resolveBadgeDamageBonusPercentForTypes(summary, pokemonTypes),
        hpBonusPercent: Math.max(0, Number(summary?.partyHpPercent || 0)),
        speedBonusPercent: Math.max(0, Number(summary?.partySpeedPercent || 0)),
    }
}

const computeMissionProgress = (badge, context = {}) => {
    const missionType = String(badge?.missionType || '').trim()
    const missionConfig = normalizeBadgeMissionConfig(missionType, badge?.missionConfig)
    const requiredCount = Math.max(1, Number(missionConfig?.requiredCount) || 1)
    let currentValue = 0

    if (missionType === 'collect_type_count') {
        currentValue = Math.max(0, Number(context?.ownedTypeCounts?.[missionConfig?.pokemonType] || 0))
    } else if (missionType === 'collect_type_distinct_count') {
        currentValue = Math.max(0, Number(context?.ownedDistinctTypeCounts?.[missionConfig?.pokemonType] || 0))
    } else if (missionType === 'collect_same_name_different_type_count') {
        currentValue = Math.max(0, Number(context?.ownedDifferentTypeCountByName?.[missionConfig?.pokemonName] || 0))
    } else if (missionType === 'collect_total_count') {
        currentValue = Math.max(0, Number(context?.ownedTotalCount || 0))
    } else if (missionType === 'vip_tier_reached') {
        currentValue = Math.max(0, Number(context?.vipTierLevel || 0))
    } else if (missionType === 'platinum_coins_owned_count') {
        currentValue = Math.max(0, Number(context?.platinumCoinsOwned || 0))
    } else if (missionType === 'catch_fail_count') {
        currentValue = Math.max(0, Number(context?.catchFailCount || 0))
    } else if (missionType === 'online_hours_count') {
        currentValue = Math.max(0, Number(context?.onlineHoursCount || 0))
    } else if (missionType === 'complete_trainer_count') {
        currentValue = Math.max(0, Number(context?.completedTrainerCount || 0))
    }

    return {
        currentValue,
        targetValue: requiredCount,
        isUnlocked: currentValue >= requiredCount,
    }
}

export const buildBadgeOverviewForUser = async (userId, options = {}) => {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId) {
        return {
            badges: [],
            equippedBadgeIds: [],
            equippedBadges: [],
            activeBonuses: createEmptyBonusSummary(),
        }
    }

    const [definitions, userDoc, ownedPokemonRows, playerStateDoc] = await Promise.all([
        Array.isArray(options?.definitions)
            ? options.definitions
            : BadgeDefinition.find({}).sort({ orderIndex: 1, createdAt: -1, _id: -1 }).lean(),
        options?.userDoc
            ? Promise.resolve(options.userDoc)
            : User.findById(normalizedUserId)
                .select('completedBattleTrainers equippedBadgeIds totalOnlineSeconds onlineSessionStartedAt isOnline lastActive vipTierLevel catchFailCount')
                .lean(),
        UserPokemon.find(withActiveUserPokemonFilter({ userId: normalizedUserId }))
            .select('pokemonId formId')
            .populate('pokemonId', 'name types defaultFormId')
            .lean(),
        PlayerState.findOne({ userId: normalizedUserId }).select('gold').lean(),
    ])

    const ownedTypeCounts = {}
    const ownedDistinctTypeCounts = {}
    const ownedDifferentTypeSetByName = {}
    const uniqueSpeciesFormKeys = new Set()
    for (const row of ownedPokemonRows) {
        const speciesId = String(row?.pokemonId?._id || '').trim()
        const speciesName = normalizePokemonName(row?.pokemonId?.name)
        const types = Array.isArray(row?.pokemonId?.types) ? row.pokemonId.types : []
        const normalizedTypeSignature = [...new Set(types.map((type) => normalizePokemonType(type)).filter(Boolean))]
            .sort()
            .join('/')

        if (speciesName && normalizedTypeSignature) {
            if (!ownedDifferentTypeSetByName[speciesName]) {
                ownedDifferentTypeSetByName[speciesName] = new Set()
            }
            ownedDifferentTypeSetByName[speciesName].add(normalizedTypeSignature)
        }

        for (const type of types) {
            const normalizedType = normalizePokemonType(type)
            if (!normalizedType) continue
            ownedTypeCounts[normalizedType] = (ownedTypeCounts[normalizedType] || 0) + 1
        }

        const normalizedFormId = String(row?.formId || row?.pokemonId?.defaultFormId || 'default').trim() || 'default'
        const uniqueSpeciesFormKey = speciesId ? `${speciesId}:${normalizedFormId}` : ''
        if (!uniqueSpeciesFormKey || uniqueSpeciesFormKeys.has(uniqueSpeciesFormKey)) continue
        uniqueSpeciesFormKeys.add(uniqueSpeciesFormKey)

        for (const type of types) {
            const normalizedType = normalizePokemonType(type)
            if (!normalizedType) continue
            ownedDistinctTypeCounts[normalizedType] = (ownedDistinctTypeCounts[normalizedType] || 0) + 1
        }
    }

    const completedTrainerCount = Array.isArray(userDoc?.completedBattleTrainers)
        ? userDoc.completedBattleTrainers.length
        : 0
    const equippedBadgeIdSet = new Set((Array.isArray(userDoc?.equippedBadgeIds) ? userDoc.equippedBadgeIds : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean))
    const onlineHoursCount = getTotalOnlineHours(userDoc)
    const ownedDifferentTypeCountByName = Object.fromEntries(
        Object.entries(ownedDifferentTypeSetByName).map(([name, typeSet]) => [name, typeSet.size])
    )

    const context = {
        ownedTypeCounts,
        ownedDistinctTypeCounts,
        ownedDifferentTypeCountByName,
        ownedTotalCount: ownedPokemonRows.length,
        vipTierLevel: Math.max(0, Number.parseInt(userDoc?.vipTierLevel, 10) || 0),
        platinumCoinsOwned: Math.max(0, Number(playerStateDoc?.gold || 0)),
        catchFailCount: Math.max(0, Number(userDoc?.catchFailCount || 0)),
        completedTrainerCount,
        onlineHoursCount,
    }

    const badges = definitions.map((entry) => {
        const badge = serializeBadgeDefinition(entry)
        const progress = computeMissionProgress(badge, context)
        const badgeId = String(badge?._id || '').trim()
        const isEquipped = badgeId ? equippedBadgeIdSet.has(badgeId) : false
        return {
            ...badge,
            missionLabel: describeMission(badge),
            rewardLabel: describeEffects(badge.rewardEffects).join(', '),
            rewardLabels: describeEffects(badge.rewardEffects),
            progress,
            isUnlocked: progress.isUnlocked,
            isEquipped,
        }
    })

    const equippedBadges = badges.filter((badge) => badge.isActive && badge.isUnlocked && badge.isEquipped)
        .slice(0, BADGE_MAX_EQUIPPED)
    const activeBonuses = mergeBadgeBonuses(equippedBadges)

    return {
        badges,
        equippedBadgeIds: equippedBadges.map((badge) => String(badge?._id || '')),
        equippedBadges,
        activeBonuses,
    }
}

export const loadActiveBadgeBonusesForUser = async (userId) => {
    const overview = await buildBadgeOverviewForUser(userId)
    return overview.activeBonuses
}

export const loadBattleBadgeBonusStateForUser = async (userId, pokemonTypes = []) => {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId) return createEmptyBattleBadgeBonusState()

    const activeBonuses = await loadActiveBadgeBonusesForUser(normalizedUserId)
    return resolveBattleBadgeBonusState(activeBonuses, pokemonTypes)
}

export const validateBadgeUpsertPayload = (payload = {}) => {
    const missionType = String(payload?.missionType || '').trim()
    if (!BADGE_MISSION_TYPES.includes(missionType)) {
        throw new Error('Loại nhiệm vụ huy hiệu không hợp lệ')
    }

    const identity = buildBadgeIdentity(payload)
    if (!identity.code || !identity.slug) {
        throw new Error('Mã hoặc slug huy hiệu không hợp lệ')
    }

    const missionConfig = normalizeBadgeMissionConfig(missionType, payload?.missionConfig)
    if ((missionType === 'collect_type_count' || missionType === 'collect_type_distinct_count') && !missionConfig.pokemonType) {
        throw new Error('Nhiệm vụ sưu tầm theo hệ cần chọn hệ Pokémon')
    }
    if (missionType === 'collect_same_name_different_type_count' && !missionConfig.pokemonName) {
        throw new Error('Nhiệm vụ cùng tên khác hệ cần nhập tên Pokémon')
    }

    const rewardEffects = normalizeBadgeRewardEffects(payload?.rewardEffects)
    if (rewardEffects.length === 0) {
        throw new Error('Cần cấu hình ít nhất 1 hiệu ứng thưởng cho huy hiệu')
    }

    return {
        code: identity.code,
        slug: identity.slug,
        name: String(payload?.name || '').trim().slice(0, 120),
        description: String(payload?.description || '').trim().slice(0, 500),
        imageUrl: String(payload?.imageUrl || '').trim(),
        rank: normalizeBadgeRank(payload?.rank),
        isActive: payload?.isActive !== false,
        orderIndex: Math.max(0, Math.floor(Number(payload?.orderIndex) || 0)),
        missionType,
        missionConfig,
        rewardEffects,
    }
}
