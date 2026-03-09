export const ADMIN_PERMISSIONS = Object.freeze({
    USERS: 'users',
    POKEMON: 'pokemon',
    MAPS: 'maps',
    ITEMS: 'items',
    BADGES: 'badges',
    MOVES: 'moves',
    NEWS: 'news',
    BATTLE: 'battle',
    REWARDS: 'rewards',
    CODES: 'codes',
    AUCTIONS: 'auctions',
})

export const ALL_ADMIN_PERMISSIONS = Object.freeze(Object.values(ADMIN_PERMISSIONS))

export const normalizeAdminPermissions = (permissions) => {
    if (!Array.isArray(permissions)) return null
    return [...new Set(
        permissions
            .map((permission) => String(permission || '').trim())
            .filter((permission) => ALL_ADMIN_PERMISSIONS.includes(permission))
    )]
}

// Backward compatibility:
// old admin accounts do not have adminPermissions field, treat as full permissions.
export const getEffectiveAdminPermissions = (userLike) => {
    if (!userLike || userLike.role !== 'admin') return []

    const normalized = normalizeAdminPermissions(userLike.adminPermissions)
    if (normalized === null || normalized.length === 0) {
        return [...ALL_ADMIN_PERMISSIONS]
    }
    return [...new Set([
        ...normalized,
        ADMIN_PERMISSIONS.BADGES,
    ])]
}

export const hasAdminPermission = (userLike, requiredPermission) => {
    if (!ALL_ADMIN_PERMISSIONS.includes(requiredPermission)) return false
    return getEffectiveAdminPermissions(userLike).includes(requiredPermission)
}
