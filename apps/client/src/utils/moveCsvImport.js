const VALID_TYPES = new Set([
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
])

const VALID_CATEGORIES = new Set(['physical', 'special', 'status'])

const stripHeaderPrefix = (value = '') => String(value || '').replace(/^\s*\d+\s*[:.)-]\s*/, '').trim()

const normalizeHeader = (value = '') => String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

const normalizeNameKey = (value = '') => String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()

const normalizeType = (value = '') => {
    const token = String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
    const aliases = {
        normal: 'normal',
        fire: 'fire',
        water: 'water',
        grass: 'grass',
        electric: 'electric',
        ice: 'ice',
        fighting: 'fighting',
        poison: 'poison',
        ground: 'ground',
        flying: 'flying',
        psychic: 'psychic',
        bug: 'bug',
        rock: 'rock',
        ghost: 'ghost',
        dragon: 'dragon',
        dark: 'dark',
        steel: 'steel',
        fairy: 'fairy',
    }
    return aliases[token] || token
}

const normalizeCategory = (value = '') => {
    const token = String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
    const aliases = {
        physical: 'physical',
        vat_ly: 'physical',
        special: 'special',
        dac_biet: 'special',
        status: 'status',
        trang_thai: 'status',
    }
    return aliases[token] || token
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
    const normalized = normalizeHeader(stripHeaderPrefix(header))

    if (['tenchieu', 'tenmove', 'movename', 'name', 'skillname', 'ten'].includes(normalized)) return 'name'
    if (['he', 'type', 'movetype'].includes(normalized)) return 'type'
    if (['phanloai', 'category', 'nhom', 'class', 'cat'].includes(normalized)) return 'category'
    if (['sucmanh', 'power', 'damage'].includes(normalized)) return 'power'
    if (['dochinhxac', 'accuracy', 'acc'].includes(normalized)) return 'accuracy'
    if (['pp', 'powerpoints'].includes(normalized)) return 'pp'
    if (['mota', 'description', 'effect', 'hieuung', 'ghichu', 'note'].includes(normalized)) return 'description'
    if (['prob', 'probability', 'probpercent', 'tilephantram', 'chance'].includes(normalized)) return 'effectChance'

    return null
}

const normalizeRawMoveImportText = (rawText) => {
    const lines = String(rawText || '').split(/\r?\n/)
    const firstNonEmptyIndex = lines.findIndex((line) => String(line || '').trim() !== '')
    if (firstNonEmptyIndex === -1) {
        return {
            text: String(rawText || ''),
            preWarnings: [],
        }
    }

    const stackedHeaders = []
    let cursor = firstNonEmptyIndex

    while (cursor < lines.length && stackedHeaders.length < 16) {
        const line = String(lines[cursor] || '').trim()
        if (!line) {
            cursor += 1
            continue
        }

        if (line.includes('\t') || line.includes(',') || line.includes(';')) {
            break
        }

        const headerKey = resolveHeaderKey(line)
        if (!headerKey) {
            break
        }

        stackedHeaders.push(stripHeaderPrefix(line))
        cursor += 1
    }

    const stackedHeaderKeys = new Set(stackedHeaders.map((entry) => resolveHeaderKey(entry)).filter(Boolean))
    const shouldMergeStackedHeaders = stackedHeaders.length >= 2
        && stackedHeaderKeys.has('name')
        && stackedHeaderKeys.has('type')

    if (!shouldMergeStackedHeaders) {
        return {
            text: String(rawText || ''),
            preWarnings: [],
        }
    }

    const mergedHeaderLine = stackedHeaders.join('\t')
    const rebuiltLines = [
        mergedHeaderLine,
        ...lines.slice(cursor),
    ]

    return {
        text: rebuiltLines.join('\n'),
        preWarnings: ['Phát hiện header bị xuống dòng theo cột, hệ thống đã tự ghép lại trước khi parse.'],
    }
}

const parseOptionalNumber = (value) => {
    const raw = String(value ?? '').trim()
    if (!raw || ['-', '--', '---', '_', '—', '–'].includes(raw)) return null
    if (raw === '∞' || raw.toLowerCase() === 'inf' || raw.toLowerCase() === 'infinity') return 100
    const parsed = Number(raw.replace(/,/g, '.'))
    return Number.isFinite(parsed) ? parsed : NaN
}

const isBlankRow = (cells = []) => cells.every((cell) => String(cell || '').trim() === '')

const POSITIONAL_COLUMN_INDEX_BY_KEY = {
    name: 0,
    type: 1,
    category: 2,
    power: 3,
    accuracy: 4,
    pp: 5,
    description: 6,
}

const looksLikePositionalDataRow = (cells = []) => {
    const name = String(cells[POSITIONAL_COLUMN_INDEX_BY_KEY.name] || '').trim()
    const type = normalizeType(cells[POSITIONAL_COLUMN_INDEX_BY_KEY.type] || '')
    return Boolean(name) && VALID_TYPES.has(type)
}

export const parseMoveCsvImport = (rawText, existingMoves = []) => {
    const normalizedInput = normalizeRawMoveImportText(rawText)
    const lines = String(normalizedInput.text || '').split(/\r?\n/)
    const firstNonEmptyLine = lines.find((line) => String(line || '').trim()) || ''
    const delimiter = detectDelimiter(firstNonEmptyLine)
    const rows = lines.map((line) => splitDelimitedLine(String(line || ''), delimiter))

    const headerRowIndex = rows.findIndex((cells) => !isBlankRow(cells))
    if (headerRowIndex === -1) {
        return {
            moves: [],
            report: {
                totalRows: 0,
                parsedRows: 0,
                skippedRows: 0,
                warnings: ['Không tìm thấy dữ liệu trong file import.'],
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

    const requiredColumns = ['name', 'type']
    let missingColumns = requiredColumns.filter((key) => columnIndexByKey[key] == null)
    let dataStartIndex = headerRowIndex + 1
    let usePositionalMode = false

    if (missingColumns.length > 0 && looksLikePositionalDataRow(headerCells)) {
        usePositionalMode = true
        dataStartIndex = headerRowIndex
        Object.assign(columnIndexByKey, POSITIONAL_COLUMN_INDEX_BY_KEY)
        missingColumns = requiredColumns.filter((key) => columnIndexByKey[key] == null)
    }

    if (missingColumns.length > 0) {
        return {
            moves: [],
            report: {
                totalRows: 0,
                parsedRows: 0,
                skippedRows: 0,
                warnings: [`Thiếu cột bắt buộc: ${missingColumns.join(', ')}`],
                hiddenWarningCount: 0,
            },
        }
    }

    const existingNameSet = new Set(
        existingMoves
            .map((entry) => normalizeNameKey(entry?.name || ''))
            .filter(Boolean)
    )

    const fileNameSet = new Set()
    const warnings = [...(normalizedInput.preWarnings || [])]
    let hiddenWarningCount = 0
    let totalRows = 0
    let skippedRows = 0
    const parsedMoves = []

    const appendWarning = (message) => {
        if (warnings.length < 30) {
            warnings.push(message)
            return
        }
        hiddenWarningCount += 1
    }

    if (usePositionalMode) {
        appendWarning('Không tìm thấy header chuẩn, đã tự đọc theo thứ tự cột: Tên chiêu, Hệ, Phân loại, Sức mạnh, Độ chính xác, PP, Mô tả')
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

        const name = getCell('name')
        const type = normalizeType(getCell('type'))
        const categoryInput = normalizeCategory(getCell('category'))
        const power = parseOptionalNumber(getCell('power'))
        const accuracy = parseOptionalNumber(getCell('accuracy'))
        const pp = parseOptionalNumber(getCell('pp'))
        const effectChance = parseOptionalNumber(getCell('effectChance'))
        const description = getCell('description')

        if (!name) {
            appendWarning(`Dòng ${rowNumber}: Tên chiêu trống`)
            skippedRows += 1
            continue
        }

        if (!VALID_TYPES.has(type)) {
            appendWarning(`Dòng ${rowNumber}: Hệ không hợp lệ (${getCell('type') || '-'})`)
            skippedRows += 1
            continue
        }

        if (Number.isNaN(power) || Number.isNaN(accuracy) || Number.isNaN(pp) || Number.isNaN(effectChance)) {
            appendWarning(`Dòng ${rowNumber}: Có trường số không hợp lệ`)
            skippedRows += 1
            continue
        }

        const inferredCategory = VALID_CATEGORIES.has(categoryInput)
            ? categoryInput
            : (power == null ? 'status' : 'physical')
        if (!VALID_CATEGORIES.has(inferredCategory)) {
            appendWarning(`Dòng ${rowNumber}: Phân loại không hợp lệ (${getCell('category') || '-'})`)
            skippedRows += 1
            continue
        }

        const normalizedName = normalizeNameKey(name)
        if (!normalizedName) {
            appendWarning(`Dòng ${rowNumber}: Tên chiêu không hợp lệ`)
            skippedRows += 1
            continue
        }

        if (existingNameSet.has(normalizedName)) {
            appendWarning(`Dòng ${rowNumber}: Bỏ qua vì kỹ năng "${name}" đã tồn tại`)
            skippedRows += 1
            continue
        }

        if (fileNameSet.has(normalizedName)) {
            appendWarning(`Dòng ${rowNumber}: Tên chiêu "${name}" bị trùng trong file`)
            skippedRows += 1
            continue
        }

        fileNameSet.add(normalizedName)

        parsedMoves.push({
            name,
            type,
            category: inferredCategory,
            power,
            accuracy: accuracy == null ? 100 : accuracy,
            pp: pp == null ? 10 : pp,
            description,
            effectChance,
        })
    }

    return {
        moves: parsedMoves,
        report: {
            totalRows,
            parsedRows: parsedMoves.length,
            skippedRows,
            warnings,
            hiddenWarningCount,
        },
    }
}
