const ACTIVE_STATUS_CLAUSE = {
    $or: [
        { status: 'active' },
        { status: { $exists: false } },
        { status: null },
    ],
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const withActiveUserPokemonFilter = (query = {}) => {
    const base = isPlainObject(query) ? { ...query } : {}
    const currentAnd = Array.isArray(base.$and) ? [...base.$and] : []
    currentAnd.push(ACTIVE_STATUS_CLAUSE)
    return {
        ...base,
        $and: currentAnd,
    }
}
