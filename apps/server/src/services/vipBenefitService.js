import VipPrivilegeTier from '../models/VipPrivilegeTier.js'

export const normalizeVipBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    const platinumCoinBonusPercent = Math.max(
        0,
        Number(source?.platinumCoinBonusPercent ?? source?.moonPointBonusPercent ?? 0) || 0
    )
    const ssCatchRateBonusPercent = Math.max(
        0,
        Number(source?.ssCatchRateBonusPercent ?? source?.catchRateBonusPercent ?? 0) || 0
    )

    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(source?.avatarFrameUrl || '').trim(),
        autoSearchEnabled: source?.autoSearchEnabled !== false,
        autoSearchDurationMinutes: Math.max(0, parseInt(source?.autoSearchDurationMinutes, 10) || 0),
        autoSearchUsesPerDay: Math.max(0, parseInt(source?.autoSearchUsesPerDay, 10) || 0),
        autoBattleTrainerEnabled: source?.autoBattleTrainerEnabled !== false,
        autoBattleTrainerDurationMinutes: Math.max(0, parseInt(source?.autoBattleTrainerDurationMinutes, 10) || 0),
        autoBattleTrainerUsesPerDay: Math.max(0, parseInt(source?.autoBattleTrainerUsesPerDay, 10) || 0),
        expBonusPercent: Math.max(0, Number(source?.expBonusPercent || 0) || 0),
        platinumCoinBonusPercent,
        moonPointBonusPercent: platinumCoinBonusPercent,
        ssCatchRateBonusPercent,
        catchRateBonusPercent: ssCatchRateBonusPercent,
        itemDropBonusPercent: Math.max(0, Number(source?.itemDropBonusPercent || 0) || 0),
        dailyRewardBonusPercent: Math.max(0, Number(source?.dailyRewardBonusPercent || 0) || 0),
        customBenefits: Array.isArray(source?.customBenefits)
            ? [...new Set(source.customBenefits.map((entry) => String(entry || '').trim()).filter(Boolean))]
            : [],
    }
}

export const normalizeVipBonusBenefits = (vipBenefitsLike = {}) => {
    const normalized = normalizeVipBenefits(vipBenefitsLike)

    return {
        platinumCoinBonusPercent: normalized.platinumCoinBonusPercent,
        ssCatchRateBonusPercent: normalized.ssCatchRateBonusPercent,
    }
}

export const mergeVipBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBenefits(currentBenefitsLike)
    const tier = normalizeVipBenefits(tierBenefitsLike)

    const platinumCoinBonusPercent = Math.max(current.platinumCoinBonusPercent, tier.platinumCoinBonusPercent)
    const ssCatchRateBonusPercent = Math.max(current.ssCatchRateBonusPercent, tier.ssCatchRateBonusPercent)

    return {
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
        avatarFrameUrl: current.avatarFrameUrl || tier.avatarFrameUrl,
        autoSearchEnabled: current.autoSearchEnabled || tier.autoSearchEnabled,
        autoSearchDurationMinutes: Math.max(current.autoSearchDurationMinutes, tier.autoSearchDurationMinutes),
        autoSearchUsesPerDay: Math.max(current.autoSearchUsesPerDay, tier.autoSearchUsesPerDay),
        autoBattleTrainerEnabled: current.autoBattleTrainerEnabled || tier.autoBattleTrainerEnabled,
        autoBattleTrainerDurationMinutes: Math.max(current.autoBattleTrainerDurationMinutes, tier.autoBattleTrainerDurationMinutes),
        autoBattleTrainerUsesPerDay: Math.max(current.autoBattleTrainerUsesPerDay, tier.autoBattleTrainerUsesPerDay),
        expBonusPercent: Math.max(current.expBonusPercent, tier.expBonusPercent),
        platinumCoinBonusPercent,
        moonPointBonusPercent: platinumCoinBonusPercent,
        ssCatchRateBonusPercent,
        catchRateBonusPercent: ssCatchRateBonusPercent,
        itemDropBonusPercent: Math.max(current.itemDropBonusPercent, tier.itemDropBonusPercent),
        dailyRewardBonusPercent: Math.max(current.dailyRewardBonusPercent, tier.dailyRewardBonusPercent),
        customBenefits: [...new Set([...current.customBenefits, ...tier.customBenefits])],
    }
}

export const mergeVipBonusBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const merged = mergeVipBenefits(currentBenefitsLike, tierBenefitsLike)

    return {
        platinumCoinBonusPercent: merged.platinumCoinBonusPercent,
        ssCatchRateBonusPercent: merged.ssCatchRateBonusPercent,
    }
}

export const normalizeVipVisualBenefits = (vipBenefitsLike = {}) => {
    const source = normalizeVipBenefits(vipBenefitsLike)
    return {
        title: source.title,
        titleImageUrl: source.titleImageUrl,
        avatarFrameUrl: source.avatarFrameUrl,
    }
}

export const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const merged = mergeVipBenefits(currentBenefitsLike, tierBenefitsLike)
    return {
        title: merged.title,
        titleImageUrl: merged.titleImageUrl,
        avatarFrameUrl: merged.avatarFrameUrl,
    }
}

export const buildVipTierLookupForUsers = async (users = []) => {
    const list = Array.isArray(users) ? users : []
    const tierIdSet = new Set()
    const tierLevelSet = new Set()

    for (const entry of list) {
        const vipTierId = String(entry?.vipTierId || '').trim()
        if (vipTierId) {
            tierIdSet.add(vipTierId)
            continue
        }

        const vipTierLevel = Math.max(0, Number.parseInt(entry?.vipTierLevel, 10) || 0)
        if (vipTierLevel > 0) {
            tierLevelSet.add(vipTierLevel)
        }
    }

    const conditions = []
    if (tierIdSet.size > 0) {
        conditions.push({ _id: { $in: Array.from(tierIdSet) } })
    }
    if (tierLevelSet.size > 0) {
        conditions.push({ level: { $in: Array.from(tierLevelSet) } })
    }

    if (conditions.length === 0) {
        return {
            tierById: new Map(),
            tierByLevel: new Map(),
        }
    }

    const tiers = await VipPrivilegeTier.find({ $or: conditions })
        .select('_id level benefits')
        .lean()

    const tierById = new Map()
    const tierByLevel = new Map()

    for (const tier of tiers) {
        const idKey = String(tier?._id || '').trim()
        if (idKey) {
            tierById.set(idKey, tier)
        }

        const levelKey = Math.max(0, Number.parseInt(tier?.level, 10) || 0)
        if (levelKey > 0) {
            tierByLevel.set(levelKey, tier)
        }
    }

    return { tierById, tierByLevel }
}

export const resolveVipTierBenefitsFromLookup = (userLike, tierById = new Map(), tierByLevel = new Map()) => {
    const vipTierId = String(userLike?.vipTierId || '').trim()
    if (vipTierId && tierById.has(vipTierId)) {
        return tierById.get(vipTierId)?.benefits || {}
    }

    const vipTierLevel = Math.max(0, Number.parseInt(userLike?.vipTierLevel, 10) || 0)
    if (vipTierLevel > 0 && tierByLevel.has(vipTierLevel)) {
        return tierByLevel.get(vipTierLevel)?.benefits || {}
    }

    return {}
}

export const resolveVipTierBenefitsForUser = async (userLike) => {
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

export const resolveEffectiveVipBenefits = async (userLike) => {
    if (!userLike) return normalizeVipBenefits({})
    const tierBenefits = await resolveVipTierBenefitsForUser(userLike)
    return mergeVipBenefits(userLike?.vipBenefits, tierBenefits)
}

export const resolveEffectiveVipBenefitsForUsers = async (users = []) => {
    const list = Array.isArray(users) ? users : []
    const result = new Map()
    if (list.length === 0) return result

    const { tierById, tierByLevel } = await buildVipTierLookupForUsers(list)
    for (const user of list) {
        const userId = String(user?._id || user?.id || '').trim()
        if (!userId) continue
        result.set(userId, mergeVipBenefits(user?.vipBenefits, resolveVipTierBenefitsFromLookup(user, tierById, tierByLevel)))
    }

    return result
}

export const resolveEffectiveVipBonusBenefits = async (userLike) => {
    if (!userLike) return normalizeVipBonusBenefits({})
    const effectiveBenefits = await resolveEffectiveVipBenefits(userLike)
    return normalizeVipBonusBenefits(effectiveBenefits)
}

export const resolveEffectiveVipVisualBenefits = async (userLike) => {
    if (!userLike) return normalizeVipVisualBenefits({})
    const effectiveBenefits = await resolveEffectiveVipBenefits(userLike)
    return normalizeVipVisualBenefits(effectiveBenefits)
}
