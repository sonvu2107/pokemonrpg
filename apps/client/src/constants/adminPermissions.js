export const ADMIN_PERMISSIONS = Object.freeze({
    USERS: 'users',
    POKEMON: 'pokemon',
    MAPS: 'maps',
    ITEMS: 'items',
    NEWS: 'news',
    BATTLE: 'battle',
})

export const ALL_ADMIN_PERMISSIONS = Object.freeze(Object.values(ADMIN_PERMISSIONS))

export const ADMIN_PERMISSION_OPTIONS = Object.freeze([
    { key: ADMIN_PERMISSIONS.USERS, label: 'User' },
    { key: ADMIN_PERMISSIONS.POKEMON, label: 'Pokemon' },
    { key: ADMIN_PERMISSIONS.MAPS, label: 'Map' },
    { key: ADMIN_PERMISSIONS.ITEMS, label: 'Item' },
    { key: ADMIN_PERMISSIONS.NEWS, label: 'News' },
    { key: ADMIN_PERMISSIONS.BATTLE, label: 'Battle' },
])

export const getEffectiveAdminPermissions = (userLike) => {
    if (!userLike || userLike.role !== 'admin') return []

    if (!Array.isArray(userLike.adminPermissions) || userLike.adminPermissions.length === 0) {
        return [...ALL_ADMIN_PERMISSIONS]
    }

    return [...new Set(
        userLike.adminPermissions.filter((permission) => ALL_ADMIN_PERMISSIONS.includes(permission))
    )]
}

export const hasAdminPermission = (userLike, permission) => {
    return getEffectiveAdminPermissions(userLike).includes(permission)
}
