const BASE_STAT_KEYS = Object.freeze(['hp', 'atk', 'def', 'spatk', 'spdef', 'spd'])

const toPositiveIntOrZero = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.floor(parsed)
}

export const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'

export const normalizePokemonBaseStats = (statsLike = {}) => {
    const source = statsLike && typeof statsLike === 'object' ? statsLike : {}
    const spdef = toPositiveIntOrZero(source?.spdef ?? source?.spldef)
    return {
        hp: toPositiveIntOrZero(source?.hp),
        atk: toPositiveIntOrZero(source?.atk),
        def: toPositiveIntOrZero(source?.def),
        spatk: toPositiveIntOrZero(source?.spatk),
        spdef,
        spldef: spdef,
        spd: toPositiveIntOrZero(source?.spd),
    }
}

export const hasMeaningfulPokemonBaseStats = (statsLike = {}) => {
    const normalized = normalizePokemonBaseStats(statsLike)
    return BASE_STAT_KEYS.some((key) => Number(normalized?.[key] || 0) > 0)
}

export const mergePokemonBaseStatsWithFallback = (preferredStatsLike = {}, fallbackStatsLike = {}) => {
    const preferred = normalizePokemonBaseStats(preferredStatsLike)
    const fallback = normalizePokemonBaseStats(fallbackStatsLike)
    const merged = {
        hp: preferred.hp > 0 ? preferred.hp : fallback.hp,
        atk: preferred.atk > 0 ? preferred.atk : fallback.atk,
        def: preferred.def > 0 ? preferred.def : fallback.def,
        spatk: preferred.spatk > 0 ? preferred.spatk : fallback.spatk,
        spdef: preferred.spdef > 0 ? preferred.spdef : fallback.spdef,
        spd: preferred.spd > 0 ? preferred.spd : fallback.spd,
    }

    return {
        ...merged,
        spldef: merged.spdef,
    }
}

export const resolvePokemonFormEntry = (pokemonLike = {}, formId = null) => {
    const forms = Array.isArray(pokemonLike?.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)

    return forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null
}

export const resolveEffectivePokemonBaseStats = ({ pokemonLike = {}, formId = null, resolvedForm = null } = {}) => {
    const speciesStats = normalizePokemonBaseStats(pokemonLike?.baseStats || {})
    const form = resolvedForm || resolvePokemonFormEntry(pokemonLike, formId)
    const formStats = normalizePokemonBaseStats(form?.stats || {})

    if (!hasMeaningfulPokemonBaseStats(formStats)) {
        return speciesStats
    }

    const merged = mergePokemonBaseStatsWithFallback(formStats, speciesStats)
    return hasMeaningfulPokemonBaseStats(merged) ? merged : speciesStats
}

export const toStorageFormStats = (statsLike = {}) => {
    const normalized = normalizePokemonBaseStats(statsLike)
    return {
        hp: normalized.hp,
        atk: normalized.atk,
        def: normalized.def,
        spatk: normalized.spatk,
        spdef: normalized.spdef,
        spd: normalized.spd,
    }
}
