const normalizeRole = (value = '') => String(value || '').trim().toLowerCase()
const normalizeVipTierCode = (value = '') => String(value || '').trim().toUpperCase()

export const getVipTierLevel = (userLike) => {
    const directLevel = Number.parseInt(userLike?.vipTierLevel, 10)
    if (Number.isFinite(directLevel) && directLevel > 0) return directLevel

    const code = normalizeVipTierCode(userLike?.vipTierCode)
    const matched = code.match(/^VIP\s*[-_]?\s*(\d{1,4})$/)
    if (matched) {
        const fromCode = Number.parseInt(matched[1], 10)
        if (Number.isFinite(fromCode) && fromCode > 0) return fromCode
    }

    return 0
}

export const getVipBadgeLabel = (userLike) => {
    if (!isVipRole(userLike)) return ''
    const level = getVipTierLevel(userLike)
    return level > 0 ? `VIP ${level}` : 'VIP'
}

export const isAdminRole = (userLike) => normalizeRole(userLike?.role) === 'admin'
export const isVipRole = (userLike) => normalizeRole(userLike?.role) === 'vip'

export const hasVipVisualAccess = (userLike) => {
    return isVipRole(userLike) || isAdminRole(userLike)
}

export const getPublicRoleLabel = (userLike) => {
    if (isAdminRole(userLike)) return 'Admin'
    return isVipRole(userLike) ? getVipBadgeLabel(userLike) : '--'
}

export const getVipTitle = (userLike) => {
    if (!hasVipVisualAccess(userLike)) return ''
    return String(userLike?.vipBenefits?.title || '').trim().slice(0, 80)
}

export const getVipTitleImageUrl = (userLike) => {
    if (!hasVipVisualAccess(userLike)) return ''
    return String(userLike?.vipBenefits?.titleImageUrl || '').trim()
}

export const getVipAvatarFrameUrl = (userLike) => {
    if (!hasVipVisualAccess(userLike)) return ''
    return String(userLike?.vipBenefits?.avatarFrameUrl || '').trim()
}

export const hasVipAutoSearchAccess = (userLike) => {
    const level = getVipTierLevel(userLike)
    const role = normalizeRole(userLike?.role)
    const roleEligible = role === 'vip' || role === 'admin'
    return userLike?.vipBenefits?.autoSearchEnabled !== false && (roleEligible || level > 0)
}

export const hasVipAutoBattleTrainerAccess = (userLike) => {
    const level = getVipTierLevel(userLike)
    const role = normalizeRole(userLike?.role)
    const roleEligible = role === 'vip' || role === 'admin'
    return userLike?.vipBenefits?.autoBattleTrainerEnabled !== false && (roleEligible || level > 0)
}
