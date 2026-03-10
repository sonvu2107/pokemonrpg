export const TYPE_EFFECTIVENESS_CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ground: 2, flying: 2, dragon: 2, steel: 0.5, ice: 0.5 },
    fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, fairy: 2, steel: 0.5 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
}

export const normalizeTypeToken = (value = '') => String(value || '').trim().toLowerCase()

export const normalizePokemonTypes = (types = []) => {
    const entries = Array.isArray(types) ? types : []
    return [...new Set(entries.map((entry) => normalizeTypeToken(entry)).filter(Boolean))]
}

export const inferMoveType = (name = '') => {
    const normalized = String(name || '').trim().toLowerCase()
    if (normalized.includes('fire')) return 'fire'
    if (normalized.includes('water')) return 'water'
    if (normalized.includes('grass') || normalized.includes('leaf') || normalized.includes('vine')) return 'grass'
    if (normalized.includes('electric') || normalized.includes('thunder') || normalized.includes('spark')) return 'electric'
    if (normalized.includes('ice') || normalized.includes('frost')) return 'ice'
    if (normalized.includes('dragon')) return 'dragon'
    if (normalized.includes('shadow') || normalized.includes('ghost')) return 'ghost'
    if (normalized.includes('poison') || normalized.includes('toxic')) return 'poison'
    return 'normal'
}

export const resolveTypeEffectiveness = (moveType, defenderTypes = []) => {
    const normalizedMoveType = normalizeTypeToken(moveType)
    const chart = TYPE_EFFECTIVENESS_CHART[normalizedMoveType] || {}
    const uniqueDefenderTypes = normalizePokemonTypes(defenderTypes)

    if (uniqueDefenderTypes.length === 0) {
        return { multiplier: 1, breakdown: [] }
    }

    let multiplier = 1
    const breakdown = uniqueDefenderTypes.map((type) => {
        const perType = Number.isFinite(chart[type]) ? chart[type] : 1
        multiplier *= perType
        return { type, multiplier: perType }
    })

    return { multiplier, breakdown }
}

export const resolveEffectivenessText = (multiplier) => {
    if (multiplier === 0) return 'Không có tác dụng.'
    if (multiplier >= 2) return 'Rất hiệu quả!'
    if (multiplier > 1) return 'Hiệu quả.'
    if (multiplier < 1) return 'Không hiệu quả lắm.'
    return ''
}
