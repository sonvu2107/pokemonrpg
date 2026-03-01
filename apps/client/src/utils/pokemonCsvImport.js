const VALID_TYPES = new Set([
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
])

const RARITY_ALIASES = {
    superlegendary: 'ss',
    legendary: 's',
    ultra_rare: 'a',
    rare: 'b',
    uncommon: 'c',
    common: 'd',
}

const VALID_RARITIES = new Set(['sss', 'ss', 's', 'a', 'b', 'c', 'd'])

const normalizeHeader = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')

const normalizeNameKey = (value = '') => {
    return String(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u2640/g, 'f')
        .replace(/\u2642/g, 'm')
        .replace(/[’']/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '')
        .toLowerCase()
}

const normalizeRarity = (value) => {
    if (!value) return 'd'
    const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_')
    return RARITY_ALIASES[normalized] || normalized
}

const normalizeType = (value = '') => {
    return String(value).trim().toLowerCase().replace(/\s+/g, '_')
}

const detectDelimiter = (line = '') => {
    if (line.includes('\t')) return '\t'
    const commaCount = (line.match(/,/g) || []).length
    const semicolonCount = (line.match(/;/g) || []).length
    return semicolonCount > commaCount ? ';' : ','
}

const splitDelimitedLine = (line, delimiter) => {
    const values = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i]

        if (char === '"') {
            const nextChar = line[i + 1]
            if (inQuotes && nextChar === '"') {
                current += '"'
                i += 1
            } else {
                inQuotes = !inQuotes
            }
            continue
        }

        if (!inQuotes && char === delimiter) {
            values.push(current.trim())
            current = ''
            continue
        }

        current += char
    }

    values.push(current.trim())
    return values
}

const resolveHeaderKey = (header) => {
    const normalized = normalizeHeader(header)

    if (['id', 'dex', 'pokedex', 'pokedexnumber', 'number', 'no'].includes(normalized)) return 'id'
    if (['name', 'pokemon', 'pokemonname'].includes(normalized)) return 'name'
    if (['type1', 'primarytype'].includes(normalized)) return 'type1'
    if (['type2', 'secondarytype'].includes(normalized)) return 'type2'
    if (['tier', 'rarity'].includes(normalized)) return 'tier'
    if (['hp'].includes(normalized)) return 'hp'
    if (['attack', 'atk'].includes(normalized)) return 'attack'
    if (['defense', 'defence', 'def'].includes(normalized)) return 'defense'
    if (['spatk', 'specialattack', 'spa'].includes(normalized)) return 'spatk'
    if (['spdef', 'specialdefense', 'specialdefence', 'spddef'].includes(normalized)) return 'spdef'
    if (['speed', 'spd'].includes(normalized)) return 'speed'

    return null
}

const parseInteger = (value) => {
    const parsed = Number.parseInt(String(value || '').trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
}

const isBlankRow = (cells = []) => cells.every(cell => String(cell || '').trim() === '')

const POSITIONAL_COLUMN_INDEX_BY_KEY = {
    id: 0,
    name: 1,
    type1: 2,
    type2: 3,
    tier: 4,
    hp: 6,
    attack: 7,
    defense: 8,
    spatk: 9,
    spdef: 10,
    speed: 11,
}

const looksLikePositionalDataRow = (cells = []) => {
    const id = parseInteger(cells[POSITIONAL_COLUMN_INDEX_BY_KEY.id])
    const name = String(cells[POSITIONAL_COLUMN_INDEX_BY_KEY.name] || '').trim()
    const type1 = normalizeType(cells[POSITIONAL_COLUMN_INDEX_BY_KEY.type1] || '')
    return Number.isFinite(id) && id > 0 && Boolean(name) && VALID_TYPES.has(type1)
}

export const parsePokemonCsvImport = (rawText, existingPokemon = []) => {
    const lines = String(rawText || '').split(/\r?\n/)
    const firstNonEmptyLine = lines.find(line => String(line || '').trim()) || ''
    const delimiter = detectDelimiter(firstNonEmptyLine)
    const rows = lines.map(line => splitDelimitedLine(String(line || ''), delimiter))

    const headerRowIndex = rows.findIndex(cells => !isBlankRow(cells))
    if (headerRowIndex === -1) {
        return {
            pokemon: [],
            report: {
                totalRows: 0,
                parsedRows: 0,
                skippedRows: 0,
                warnings: ['Khong tim thay dong header trong file import.'],
                hiddenWarningCount: 0,
            },
        }
    }

    const headerCells = rows[headerRowIndex]
    const columnIndexByKey = {}
    headerCells.forEach((header, index) => {
        const key = resolveHeaderKey(header)
        if (key && columnIndexByKey[key] == null) {
            columnIndexByKey[key] = index
        }
    })

    const requiredColumns = ['id', 'name', 'type1', 'hp', 'attack', 'defense', 'spatk', 'spdef', 'speed']
    let missingColumns = requiredColumns.filter(key => columnIndexByKey[key] == null)
    let dataStartIndex = headerRowIndex + 1
    let usePositionalMode = false

    if (missingColumns.length > 0 && looksLikePositionalDataRow(headerCells)) {
        usePositionalMode = true
        dataStartIndex = headerRowIndex
        Object.assign(columnIndexByKey, POSITIONAL_COLUMN_INDEX_BY_KEY)
        missingColumns = requiredColumns.filter(key => columnIndexByKey[key] == null)
    }

    if (missingColumns.length > 0) {
        return {
            pokemon: [],
            report: {
                totalRows: 0,
                parsedRows: 0,
                skippedRows: 0,
                warnings: [`Thieu cot bat buoc: ${missingColumns.join(', ')}`],
                hiddenWarningCount: 0,
            },
        }
    }

    const existingDexSet = new Set(
        existingPokemon
            .map((entry) => Number.parseInt(entry?.pokedexNumber, 10))
            .filter(Number.isFinite)
    )

    const existingNameSet = new Set(
        existingPokemon
            .map((entry) => normalizeNameKey(entry?.name || ''))
            .filter(Boolean)
    )

    const fileDexSet = new Set()
    const fileNameSet = new Set()
    const warnings = []
    let hiddenWarningCount = 0

    const appendWarning = (message) => {
        if (warnings.length < 30) {
            warnings.push(message)
            return
        }
        hiddenWarningCount += 1
    }

    const parsedPokemon = []
    let totalRows = 0
    let skippedRows = 0

    if (usePositionalMode) {
        appendWarning('Khong tim thay header, da tu dong doc theo thu tu cot mac dinh: ID, Name, Type1, Type2, tier, Total, HP, Attack, Defense, Sp. Atk, Sp. Def, Speed, Generation')
    }

    for (let rowIndex = dataStartIndex; rowIndex < rows.length; rowIndex += 1) {
        const cells = rows[rowIndex]
        if (!cells || isBlankRow(cells)) continue

        totalRows += 1

        const rowNumber = rowIndex + 1
        const getCell = (key) => {
            const idx = columnIndexByKey[key]
            if (idx == null) return ''
            return String(cells[idx] || '').trim()
        }

        const id = parseInteger(getCell('id'))
        const name = getCell('name')
        const type1 = normalizeType(getCell('type1'))
        const type2Raw = getCell('type2')
        const type2 = normalizeType(type2Raw)
        const rawRarity = normalizeRarity(getCell('tier'))
        const rarity = VALID_RARITIES.has(rawRarity) ? rawRarity : 'd'
        if (rawRarity && !VALID_RARITIES.has(rawRarity)) {
            appendWarning(`Dong ${rowNumber}: tier "${getCell('tier')}" khong hop le, mac dinh ve D`)
        }

        const hp = parseInteger(getCell('hp'))
        const atk = parseInteger(getCell('attack'))
        const def = parseInteger(getCell('defense'))
        const spatk = parseInteger(getCell('spatk'))
        const spdef = parseInteger(getCell('spdef'))
        const spd = parseInteger(getCell('speed'))

        if (!id || id < 1 || id > 9999) {
            appendWarning(`Dong ${rowNumber}: ID khong hop le`)
            skippedRows += 1
            continue
        }

        if (!name) {
            appendWarning(`Dong ${rowNumber}: Name trong`)
            skippedRows += 1
            continue
        }

        if (!VALID_TYPES.has(type1)) {
            appendWarning(`Dong ${rowNumber}: Type1 khong hop le (${getCell('type1') || '-'})`)
            skippedRows += 1
            continue
        }

        if (type2Raw && !VALID_TYPES.has(type2)) {
            appendWarning(`Dong ${rowNumber}: Type2 khong hop le (${type2Raw})`)
            skippedRows += 1
            continue
        }

        const statValues = [hp, atk, def, spatk, spdef, spd]
        const hasInvalidStat = statValues.some(stat => !Number.isFinite(stat) || stat < 1 || stat > 255)
        if (hasInvalidStat) {
            appendWarning(`Dong ${rowNumber}: co chi so khong hop le (1-255)`)
            skippedRows += 1
            continue
        }

        const normalizedName = normalizeNameKey(name)
        if (!normalizedName) {
            appendWarning(`Dong ${rowNumber}: Name khong hop le`)
            skippedRows += 1
            continue
        }

        if (existingDexSet.has(id)) {
            appendWarning(`Dong ${rowNumber}: bo qua vi ID ${id} da ton tai`)
            skippedRows += 1
            continue
        }

        if (existingNameSet.has(normalizedName)) {
            appendWarning(`Dong ${rowNumber}: bo qua vi Name "${name}" da ton tai`)
            skippedRows += 1
            continue
        }

        if (fileDexSet.has(id)) {
            appendWarning(`Dong ${rowNumber}: ID ${id} bi trung trong file`)
            skippedRows += 1
            continue
        }

        if (fileNameSet.has(normalizedName)) {
            appendWarning(`Dong ${rowNumber}: Name "${name}" bi trung trong file`)
            skippedRows += 1
            continue
        }

        fileDexSet.add(id)
        fileNameSet.add(normalizedName)

        const types = [type1]
        if (type2 && type2 !== type1) {
            types.push(type2)
        }

        parsedPokemon.push({
            pokedexNumber: id,
            name,
            types,
            rarity,
            baseStats: {
                hp,
                atk,
                def,
                spatk,
                spldef: spdef,
                spd,
            },
        })
    }

    return {
        pokemon: parsedPokemon,
        report: {
            totalRows,
            parsedRows: parsedPokemon.length,
            skippedRows,
            warnings,
            hiddenWarningCount,
        },
    }
}
