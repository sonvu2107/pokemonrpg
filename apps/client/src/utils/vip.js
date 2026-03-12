const normalizeRole = (value = '') => String(value || '').trim().toLowerCase()
const normalizeVipTierCode = (value = '') => String(value || '').trim().toUpperCase()
const VIP_HEX_COLOR_REGEX = /^#([0-9a-f]{6})$/i

export const normalizeVipHexColor = (value = '') => {
    const raw = String(value || '').trim().toUpperCase()
    return VIP_HEX_COLOR_REGEX.test(raw) ? raw : ''
}

export const normalizeVipUsernameEffect = (value = 'none') => {
    return String(value || '').trim().toLowerCase() === 'animated' ? 'animated' : 'none'
}

const mixHexColor = (baseColor = '', targetColor = '#FFFFFF', amount = 0.35) => {
    const base = normalizeVipHexColor(baseColor)
    const target = normalizeVipHexColor(targetColor)
    if (!base || !target) return base

    const clampAmount = Math.max(0, Math.min(1, Number(amount) || 0))
    const toRgb = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
    const [r1, g1, b1] = toRgb(base)
    const [r2, g2, b2] = toRgb(target)
    const mixed = [r1, g1, b1].map((channel, index) => {
        const targetChannel = [r2, g2, b2][index]
        return Math.round(channel + ((targetChannel - channel) * clampAmount))
            .toString(16)
            .padStart(2, '0')
    })

    return `#${mixed.join('').toUpperCase()}`
}

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

export const getVipUsernameConfig = (userLike) => {
    if (!hasVipVisualAccess(userLike)) {
        return {
            color: '',
            gradientColor: '',
            effect: 'none',
            isAnimated: false,
            isColored: false,
        }
    }

    const color = normalizeVipHexColor(userLike?.vipBenefits?.usernameColor)
    const effect = normalizeVipUsernameEffect(userLike?.vipBenefits?.usernameEffect)
    const gradientColor = normalizeVipHexColor(userLike?.vipBenefits?.usernameGradientColor) || mixHexColor(color, '#FFFFFF', 0.42)
    const isAnimated = Boolean(color) && effect === 'animated'

    return {
        color,
        gradientColor,
        effect: isAnimated ? 'animated' : 'none',
        isAnimated,
        isColored: Boolean(color),
    }
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
