const ARROW_SPLIT_REGEX = /\s*(?:\u2192|->)\s*/
const BRANCH_SPLIT_REGEX = /\s*\/\s*/
const LEADING_DEX_REGEX = /^(\d{1,4})\b/
const ANY_DEX_REGEX = /\b(\d{1,4})\b/

const normalizePokemonName = (value = '') => {
    return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/♀/g, 'f')
        .replace(/♂/g, 'm')
        .replace(/[’']/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '')
        .toLowerCase()
}

const createPokemonLookup = (allPokemon = []) => {
    const byDex = new Map()
    const byName = new Map()

    allPokemon.forEach((entry) => {
        if (!entry?._id) return

        const dex = Number.parseInt(entry.pokedexNumber, 10)
        if (Number.isFinite(dex) && !byDex.has(dex)) {
            byDex.set(dex, entry)
        }

        const normalizedName = normalizePokemonName(entry.name)
        if (normalizedName && !byName.has(normalizedName)) {
            byName.set(normalizedName, entry)
        }
    })

    return { byDex, byName }
}

const resolvePokemonToken = (token, lookup) => {
    const normalizedToken = String(token || '').trim()
    if (!normalizedToken) return null

    const inferredName = normalizedToken.replace(LEADING_DEX_REGEX, '').trim()
    const pokemonByName = inferredName
        ? (lookup.byName.get(normalizePokemonName(inferredName)) || null)
        : null

    const leadingDexMatch = normalizedToken.match(LEADING_DEX_REGEX)
    const anyDexMatch = normalizedToken.match(ANY_DEX_REGEX)
    const dexMatch = leadingDexMatch || anyDexMatch

    if (dexMatch) {
        const dexNumber = Number.parseInt(dexMatch[1], 10)
        const pokemonByDex = lookup.byDex.get(dexNumber)
        if (pokemonByDex) {
            if (!inferredName || !pokemonByName) return pokemonByDex

            const dexNameNormalized = normalizePokemonName(pokemonByDex.name)
            const inferredNameNormalized = normalizePokemonName(inferredName)

            if (dexNameNormalized && inferredNameNormalized && dexNameNormalized !== inferredNameNormalized) {
                return pokemonByName
            }

            return pokemonByDex
        }
    }

    return pokemonByName
}

const dedupePokemonList = (items = []) => {
    const byId = new Map()
    items.forEach((item) => {
        if (item?._id && !byId.has(item._id)) {
            byId.set(item._id, item)
        }
    })
    return [...byId.values()]
}

const getTransitionMinLevel = (transitionIndex) => {
    if (transitionIndex <= 1) return 20
    return 50
}

export const parseEvolutionImportCsv = (rawText, allPokemon = []) => {
    const lookup = createPokemonLookup(allPokemon)
    const lines = String(rawText || '').split(/\r?\n/)
    const updatesByPokemon = new Map()
    const warnings = []
    let hiddenWarningCount = 0
    let processedLines = 0
    let transitionCount = 0
    let clearedCount = 0
    let branchLineCount = 0

    const appendWarning = (message) => {
        if (warnings.length < 25) {
            warnings.push(message)
            return
        }
        hiddenWarningCount += 1
    }

    const upsertUpdate = ({ pokemonId, evolvesTo, minLevel }) => {
        updatesByPokemon.set(pokemonId, {
            pokemonId,
            evolvesTo: evolvesTo || null,
            minLevel: evolvesTo ? minLevel : null,
        })
    }

    lines.forEach((rawLine, lineIndex) => {
        const firstColumn = String(rawLine || '').split(/\t+/)[0].trim()
        if (!firstColumn) return
        if (!LEADING_DEX_REGEX.test(firstColumn)) return

        const stageParts = firstColumn
            .split(ARROW_SPLIT_REGEX)
            .map(part => part.trim())
            .filter(Boolean)

        if (stageParts.length === 0) return
        processedLines += 1

        const resolvedStages = stageParts.map((part) => {
            const tokens = part
                .split(BRANCH_SPLIT_REGEX)
                .map(token => token.trim())
                .filter(Boolean)

            const resolved = tokens
                .map((token) => {
                    const pokemon = resolvePokemonToken(token, lookup)
                    if (!pokemon) {
                        appendWarning(`Dong ${lineIndex + 1}: khong tim thay "${token}"`)
                    }
                    return pokemon
                })
                .filter(Boolean)

            return dedupePokemonList(resolved)
        })

        if (resolvedStages.length === 1) {
            const onlyStage = resolvedStages[0]
            if (onlyStage.length === 0) return
            onlyStage.forEach((source) => {
                upsertUpdate({ pokemonId: source._id, evolvesTo: null, minLevel: null })
                clearedCount += 1
            })
            return
        }

        for (let stageIndex = 1; stageIndex < resolvedStages.length; stageIndex += 1) {
            const previousStage = resolvedStages[stageIndex - 1]
            const currentStage = resolvedStages[stageIndex]

            if (previousStage.length === 0 || currentStage.length === 0) {
                appendWarning(`Dong ${lineIndex + 1}: bo qua cap tien hoa vi thieu Pokemon hop le`)
                continue
            }

            if (currentStage.length > 1 || previousStage.length > 1) {
                branchLineCount += 1
                appendWarning(`Dong ${lineIndex + 1}: he thong chi ho tro 1 nhanh, se lay muc dau tien`)
            }

            const target = currentStage[0]
            const minLevel = getTransitionMinLevel(stageIndex)

            previousStage.forEach((source) => {
                if (source._id === target._id) {
                    appendWarning(`Dong ${lineIndex + 1}: bo qua vi ${source.name} khong the tien hoa thanh chinh no`)
                    return
                }

                upsertUpdate({
                    pokemonId: source._id,
                    evolvesTo: target._id,
                    minLevel,
                })
                transitionCount += 1
            })
        }
    })

    return {
        updates: [...updatesByPokemon.values()],
        report: {
            processedLines,
            transitionCount,
            clearedCount,
            branchLineCount,
            warnings,
            hiddenWarningCount,
        },
    }
}
