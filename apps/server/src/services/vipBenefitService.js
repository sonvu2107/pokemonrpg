import VipPrivilegeTier from '../models/VipPrivilegeTier.js'

export const normalizeVipBonusBenefits = (vipBenefitsLike = {}) => {
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
        platinumCoinBonusPercent,
        ssCatchRateBonusPercent,
    }
}

export const mergeVipBonusBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipBonusBenefits(currentBenefitsLike)
    const tier = normalizeVipBonusBenefits(tierBenefitsLike)

    return {
        platinumCoinBonusPercent: current.platinumCoinBonusPercent || tier.platinumCoinBonusPercent,
        ssCatchRateBonusPercent: current.ssCatchRateBonusPercent || tier.ssCatchRateBonusPercent,
    }
}

export const normalizeVipVisualBenefits = (vipBenefitsLike = {}) => {
    const source = vipBenefitsLike && typeof vipBenefitsLike === 'object' ? vipBenefitsLike : {}
    return {
        title: String(source?.title || '').trim().slice(0, 80),
        titleImageUrl: String(source?.titleImageUrl || '').trim(),
    }
}

export const mergeVipVisualBenefits = (currentBenefitsLike = {}, tierBenefitsLike = {}) => {
    const current = normalizeVipVisualBenefits(currentBenefitsLike)
    const tier = normalizeVipVisualBenefits(tierBenefitsLike)
    return {
        title: current.title || tier.title,
        titleImageUrl: current.titleImageUrl || tier.titleImageUrl,
    }
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

export const resolveEffectiveVipBonusBenefits = async (userLike) => {
    if (!userLike) return normalizeVipBonusBenefits({})
    const tierBenefits = await resolveVipTierBenefitsForUser(userLike)
    return mergeVipBonusBenefits(userLike?.vipBenefits, tierBenefits)
}

export const resolveEffectiveVipVisualBenefits = async (userLike) => {
    if (!userLike) return normalizeVipVisualBenefits({})
    const tierBenefits = await resolveVipTierBenefitsForUser(userLike)
    return mergeVipVisualBenefits(userLike?.vipBenefits, tierBenefits)
}
