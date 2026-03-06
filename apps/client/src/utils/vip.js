const normalizeRole = (value = '') => String(value || '').trim().toLowerCase()

export const isVipRole = (userLike) => normalizeRole(userLike?.role) === 'vip'

export const getPublicRoleLabel = (userLike) => (isVipRole(userLike) ? 'VIP' : '--')

export const getVipTitle = (userLike) => {
    if (!isVipRole(userLike)) return ''
    return String(userLike?.vipBenefits?.title || '').trim().slice(0, 80)
}

export const getVipAvatarFrameUrl = (userLike) => {
    if (!isVipRole(userLike)) return ''
    return String(userLike?.vipBenefits?.avatarFrameUrl || '').trim()
}

export const hasVipAutoSearchAccess = (userLike) => {
    if (!isVipRole(userLike)) return false
    return userLike?.vipBenefits?.autoSearchEnabled !== false
}

export const hasVipAutoBattleTrainerAccess = (userLike) => {
    if (!isVipRole(userLike)) return false
    return userLike?.vipBenefits?.autoBattleTrainerEnabled !== false
}
