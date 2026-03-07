
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { pokemonApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'
import { uploadOneToCloudinary, validateImageFile } from '../../utils/cloudinaryUtils'

const TYPES = [
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
]

const RARITIES = ['sss', 'ss', 's', 'a', 'b', 'c', 'd']

const FORM_VARIANTS = [
    { id: 'normal', name: 'Normal' },
    { id: 'shiny', name: 'Shiny' },
    { id: 'dark', name: 'Dark' },
    { id: 'silver', name: 'Silver' },
    { id: 'golden', name: 'Golden' },
    { id: 'crystal', name: 'Crystal' },
    { id: 'ruby', name: 'Ruby' },
    { id: 'sapphire', name: 'Sapphire' },
    { id: 'emerald', name: 'Emerald' },
    { id: 'shadow', name: 'Shadow' },
    { id: 'light', name: 'Light' },
    { id: 'legacy', name: 'Legacy' },
    { id: 'pearl', name: 'Pearl' },
    { id: 'astral', name: 'Astral' },
    { id: 'rainbow', name: 'Rainbow' },
    { id: 'genesis', name: 'Genesis' },
    { id: 'relic', name: 'Relic' },
    { id: 'retro', name: 'Retro' },
    { id: 'hyper', name: 'Hyper' },
]
const FORM_VARIANT_NAME_BY_ID = Object.fromEntries(FORM_VARIANTS.map(v => [v.id, v.name]))
const BUILT_IN_FORM_VARIANT_IDS = new Set(FORM_VARIANTS.map(v => String(v.id || '').trim().toLowerCase()).filter(Boolean))
const FORM_VARIANT_MODAL_PAGE_SIZE = 12
const BULK_UPLOAD_STATUS_META = {
    pending: {
        label: 'Chờ xử lý',
        badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
    },
    uploading: {
        label: 'Đang upload',
        badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
    },
    success: {
        label: 'Thành công',
        badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    },
    skipped: {
        label: 'Bỏ qua',
        badgeClass: 'bg-amber-100 text-amber-700 border border-amber-200',
    },
    error: {
        label: 'Lỗi',
        badgeClass: 'bg-red-100 text-red-700 border border-red-200',
    },
}

const RARITY_ALIASES = {
    superlegendary: 'ss',
    legendary: 's',
    ultra_rare: 'a',
    rare: 'b',
    uncommon: 'c',
    common: 'd',
}

const normalizeRarity = (rarity) => {
    if (!rarity) return 'd'
    const normalized = String(rarity).trim().toLowerCase()
    return RARITY_ALIASES[normalized] || normalized
}


const normalizeFormId = (formId) => String(formId || '').trim()
const normalizeFormName = (formName) => String(formName || '').trim()
const getVariantDisplayName = (formId = '', fallbackName = '') => {
    const normalizedId = normalizeFormId(formId).toLowerCase()
    const normalizedFallbackName = normalizeFormName(fallbackName)
    return normalizedFallbackName || FORM_VARIANT_NAME_BY_ID[normalizedId] || normalizedId
}

const splitStemTokens = (value = '') => {
    const normalized = String(value || '').trim()
    if (!normalized) return []

    return normalized
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean)
}

const toTitleCaseFromTokens = (tokens = []) => (
    (Array.isArray(tokens) ? tokens : [])
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ')
)

const findPokemonSuffixTokenLength = (stemTokens = [], pokemonNames = []) => {
    if (!Array.isArray(stemTokens) || stemTokens.length === 0) return 0
    if (!Array.isArray(pokemonNames) || pokemonNames.length === 0) return 0

    let matchedLength = 0

    pokemonNames.forEach((name) => {
        const nameTokens = splitStemTokens(name)
        if (nameTokens.length === 0 || nameTokens.length > stemTokens.length) return

        const sourceTail = stemTokens.slice(stemTokens.length - nameTokens.length)
        const isTailMatched = nameTokens.every((token, index) => token === sourceTail[index])
        if (isTailMatched && nameTokens.length > matchedLength) {
            matchedLength = nameTokens.length
        }
    })

    return matchedLength
}

const inferFormVariantFromFileName = (fileName = '', variants = FORM_VARIANTS, pokemonNames = []) => {
    const stemRaw = String(fileName || '')
        .replace(/\.[^.]+$/, '')
        .trim()
    if (!stemRaw) return { formId: '', formName: '' }

    const stemTokens = splitStemTokens(stemRaw)
    if (stemTokens.length === 0) return { formId: '', formName: '' }

    const pokemonSuffixTokenLength = findPokemonSuffixTokenLength(stemTokens, pokemonNames)
    const normalizedStemTokens = pokemonSuffixTokenLength > 0
        ? stemTokens.slice(0, stemTokens.length - pokemonSuffixTokenLength)
        : stemTokens
    if (normalizedStemTokens.length === 0) return { formId: '', formName: '' }

    const variantPool = Array.isArray(variants) && variants.length > 0 ? variants : FORM_VARIANTS

    const compactStem = normalizedStemTokens.join('')

    const matchedVariantById = variantPool.find((variant) => {
        const compactVariantId = splitStemTokens(variant?.id).join('')
        return compactVariantId && compactVariantId === compactStem
    })

    const matchedVariantByName = !matchedVariantById
        ? variantPool.find((variant) => {
            const compactVariantName = splitStemTokens(variant?.name).join('')
            return compactVariantName && compactVariantName === compactStem
        })
        : null

    const matchedVariant = matchedVariantById || matchedVariantByName

    if (!matchedVariant) {
        const fallbackTokens = normalizedStemTokens
        return {
            formId: fallbackTokens.join('-'),
            formName: toTitleCaseFromTokens(fallbackTokens),
        }
    }

    return {
        formId: matchedVariant.id,
        formName: matchedVariant.name,
    }
}

const resolveDefaultFormId = (formList = [], preferredDefault = 'normal') => {
    const ids = formList.map(f => normalizeFormId(f?.formId)).filter(Boolean)
    if (ids.includes('normal')) return 'normal'
    const normalizedPreferred = normalizeFormId(preferredDefault)
    if (normalizedPreferred && ids.includes(normalizedPreferred)) return normalizedPreferred
    return ids[0] || 'normal'
}

const sanitizeCustomVariants = (variants = []) => {
    if (!Array.isArray(variants)) return []

    const next = []
    const seen = new Set()

    variants.forEach((entry) => {
        const id = normalizeFormId(entry?.id).toLowerCase()
        if (!id || BUILT_IN_FORM_VARIANT_IDS.has(id) || seen.has(id)) return
        seen.add(id)
        next.push({
            id,
            name: getVariantDisplayName(id, entry?.name),
        })
    })

    return next
}

const mergeFormVariants = (base = [], incoming = []) => {
    const next = [...(Array.isArray(base) ? base : [])]
    const indexById = new Map(
        next
            .map((entry, index) => [normalizeFormId(entry?.id).toLowerCase(), index])
            .filter(([id]) => Boolean(id))
    )

    ;(Array.isArray(incoming) ? incoming : []).forEach((entry) => {
        const id = normalizeFormId(entry?.id).toLowerCase()
        if (!id || BUILT_IN_FORM_VARIANT_IDS.has(id)) return
        const name = getVariantDisplayName(id, entry?.name)
        if (indexById.has(id)) {
            const foundIndex = indexById.get(id)
            next[foundIndex] = { id, name }
            return
        }
        indexById.set(id, next.length)
        next.push({ id, name })
    })

    return next
}

const extractCustomVariantsFromForms = (formRows = []) => {
    const variants = []
    const seen = new Set()

    ;(Array.isArray(formRows) ? formRows : []).forEach((entry) => {
        const formId = normalizeFormId(entry?.formId).toLowerCase()
        if (!formId || BUILT_IN_FORM_VARIANT_IDS.has(formId) || seen.has(formId)) return
        seen.add(formId)
        variants.push({
            id: formId,
            name: getVariantDisplayName(formId, entry?.formName),
        })
    })

    return variants
}

const GROWTH_RATES = ['fast', 'medium_fast', 'medium_slow', 'slow', 'erratic', 'fluctuating']

export default function PokemonFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [allPokemon, setAllPokemon] = useState([])
    const [moveCatalog, setMoveCatalog] = useState([])
    const [bulkFormUploading, setBulkFormUploading] = useState(false)
    const [bulkFormUploadProgress, setBulkFormUploadProgress] = useState(0)
    const [bulkFormUploadCount, setBulkFormUploadCount] = useState(0)
    const [bulkFormUploadNotice, setBulkFormUploadNotice] = useState('')
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false)
    const [bulkUploadQueueRows, setBulkUploadQueueRows] = useState([])
    const [customFormVariants, setCustomFormVariants] = useState([])
    const [showFormVariantModal, setShowFormVariantModal] = useState(false)
    const [formVariantModalTargetIndex, setFormVariantModalTargetIndex] = useState(null)
    const [formVariantSearchTerm, setFormVariantSearchTerm] = useState('')
    const [formVariantPage, setFormVariantPage] = useState(1)
    const [newFormVariantId, setNewFormVariantId] = useState('')
    const [newFormVariantName, setNewFormVariantName] = useState('')
    const [formVariantModalError, setFormVariantModalError] = useState('')
    const [formVariantSubmitting, setFormVariantSubmitting] = useState(false)

    const [defaultFormId, setDefaultFormId] = useState('normal')
    const [forms, setForms] = useState([
        { formId: 'normal', formName: 'Normal', imageUrl: '', sprites: {}, stats: {} },
    ])

    const [formData, setFormData] = useState({
        pokedexNumber: '',
        name: '',
        baseStats: { hp: 50, atk: 50, def: 50, spatk: 50, spldef: 50, spd: 50 },
        types: [],
        sprites: { normal: '', shiny: '', icon: '' },
        imageUrl: '',
        description: '',
        rarity: 'd',
        rarityWeight: 100,

        // New Fields
        levelUpMoves: [{ level: 1, moveName: '' }],
        evolution: { evolvesTo: '', minLevel: '' },
        catchRate: 45,
        baseExperience: 50,
        growthRate: 'medium_fast',
    })

    const formVariantOptions = [...FORM_VARIANTS, ...customFormVariants].reduce((acc, entry) => {
        const normalizedId = normalizeFormId(entry?.id).toLowerCase()
        if (!normalizedId || acc.some((item) => item.id === normalizedId)) return acc
        return [...acc, { id: normalizedId, name: getVariantDisplayName(normalizedId, entry?.name) }]
    }, [])

    const normalizedVariantSearchTerm = String(formVariantSearchTerm || '').trim().toLowerCase()
    const filteredFormVariantOptions = normalizedVariantSearchTerm
        ? formVariantOptions.filter((entry) => {
            const id = String(entry?.id || '').toLowerCase()
            const name = String(entry?.name || '').toLowerCase()
            return id.includes(normalizedVariantSearchTerm) || name.includes(normalizedVariantSearchTerm)
        })
        : formVariantOptions

    const formVariantTotal = filteredFormVariantOptions.length
    const formVariantTotalPages = Math.max(1, Math.ceil(formVariantTotal / FORM_VARIANT_MODAL_PAGE_SIZE))
    const resolvedFormVariantPage = Math.min(formVariantPage, formVariantTotalPages)
    const formVariantPageStartIndex = (resolvedFormVariantPage - 1) * FORM_VARIANT_MODAL_PAGE_SIZE
    const formVariantPageRows = filteredFormVariantOptions.slice(
        formVariantPageStartIndex,
        formVariantPageStartIndex + FORM_VARIANT_MODAL_PAGE_SIZE
    )
    const formVariantPageStart = formVariantTotal > 0 ? formVariantPageStartIndex + 1 : 0
    const formVariantPageEnd = formVariantTotal > 0
        ? Math.min(formVariantTotal, formVariantPageStartIndex + FORM_VARIANT_MODAL_PAGE_SIZE)
        : 0

    const selectedFormIndex = Number.isInteger(formVariantModalTargetIndex) ? formVariantModalTargetIndex : -1
    const usedFormIdsByOtherRows = new Set(
        forms
            .map((entry, index) => (index === selectedFormIndex ? '' : normalizeFormId(entry?.formId).toLowerCase()))
            .filter(Boolean)
    )

    useEffect(() => {
        loadData()
    }, [id])

    useEffect(() => {
        const inferredCustomVariants = extractCustomVariantsFromForms(forms)
        if (inferredCustomVariants.length === 0) return
        setCustomFormVariants((prev) => mergeFormVariants(prev, inferredCustomVariants))
    }, [forms])

    const canonicalizeMoveName = (value) => {
        const normalized = String(value || '').trim()
        if (!normalized) return ''
        const key = normalized.toLowerCase()
        const matched = moveCatalog.find((entry) => String(entry?.nameLower || entry?.name || '').trim().toLowerCase() === key)
        return matched?.name || normalized
    }

    const loadData = async () => {
        try {
            setLoading(true)
            // Fetch all pokemon for evolution dropdown + move catalog + shared form variants
            const [pokemonList, moveLookup, formVariantLookup] = await Promise.all([
                pokemonApi.list({ limit: 1000 }),
                pokemonApi.lookupMoves({ limit: 1000 }).catch(() => ({ moves: [] })),
                pokemonApi.listFormVariants({ limit: 1000 }).catch(() => ({ formVariants: [] })),
            ])
            setAllPokemon(pokemonList.pokemon || [])
            setMoveCatalog(moveLookup.moves || [])
            setCustomFormVariants(sanitizeCustomVariants(formVariantLookup.formVariants || []))

            if (isEdit) {
                const data = await pokemonApi.getById(id)
                console.log('Loaded Pokemon Data:', data.pokemon)

                const pokemon = data.pokemon
                const existingForms = Array.isArray(pokemon.forms) ? pokemon.forms : []
                const fallbackFormId = pokemon.defaultFormId || 'normal'
                const resolvedForms = existingForms.length > 0
                    ? existingForms
                    : [{
                        formId: fallbackFormId,
                        formName: fallbackFormId === 'normal' ? 'Normal' : fallbackFormId,
                        imageUrl: pokemon.imageUrl || '',
                        sprites: pokemon.sprites || {},
                        stats: pokemon.baseStats || {},
                    }]

                const normalizedForms = resolvedForms.map((f) => ({
                    ...f,
                    formId: normalizeFormId(f.formId).toLowerCase(),
                }))
                setForms(normalizedForms)
                setCustomFormVariants((prev) => mergeFormVariants(prev, extractCustomVariantsFromForms(normalizedForms)))
                setDefaultFormId(resolveDefaultFormId(normalizedForms, pokemon.defaultFormId))

                // Map API data to form state
                setFormData({
                    ...pokemon,
                    rarity: normalizeRarity(pokemon.rarity),
                    levelUpMoves: (pokemon.levelUpMoves && pokemon.levelUpMoves.length > 0)
                        ? pokemon.levelUpMoves
                        : (pokemon.initialMoves?.map(m => ({ level: 1, moveName: m })) || [{ level: 1, moveName: '' }]),
                    evolution: {
                        evolvesTo: pokemon.evolution?.evolvesTo || '',
                        minLevel: pokemon.evolution?.minLevel || ''
                    },
                    catchRate: pokemon.catchRate || 45,
                    baseExperience: pokemon.baseExperience || 50,
                    growthRate: pokemon.growthRate || 'medium_fast',
                })
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        // Validation
        if (formData.types.length < 1 || formData.types.length > 2) {
            setError('Phải chọn 1-2 hệ')
            return
        }

        if (new Set(formData.types).size !== formData.types.length) {
            setError('Các hệ phải khác nhau')
            return
        }

        const normalizedDefaultFormId = normalizeFormId(defaultFormId).toLowerCase() || 'normal'
        const cleanedForms = forms
            .map(f => ({
                ...f,
                formId: normalizeFormId(f?.formId).toLowerCase(),
                formName: normalizeFormName(f?.formName),
                imageUrl: String(f?.imageUrl || '').trim(),
                sprites: f?.sprites || {},
                stats: f?.stats || {},
            }))
            .filter(f => f.formId)

        let effectiveDefaultFormId = resolveDefaultFormId(cleanedForms, normalizedDefaultFormId)

        if (cleanedForms.length > 0) {
            const ids = cleanedForms.map(f => f.formId)
            if (new Set(ids).size !== ids.length) {
                setError('formId must be unique within one Pokemon')
                return
            }
            if (!ids.includes(effectiveDefaultFormId)) {
                effectiveDefaultFormId = resolveDefaultFormId(cleanedForms, normalizedDefaultFormId)
            }
        }

        try {
            setLoading(true)

            // Format Data for API
            const cleanedData = {
                ...formData,
                defaultFormId: effectiveDefaultFormId,
                forms: cleanedForms,
                levelUpMoves: formData.levelUpMoves
                    .filter(m => m.moveName.trim() !== '')
                    .map(m => ({
                        level: parseInt(m.level) || 1,
                        moveName: canonicalizeMoveName(m.moveName),
                    })),
                evolution: {
                    evolvesTo: formData.evolution.evolvesTo || null,
                    minLevel: formData.evolution.evolvesTo ? (parseInt(formData.evolution.minLevel) || null) : null
                }
            }

            // Remove legacy field if present in local state
            delete cleanedData.initialMoves

            if (cleanedForms.length > 0) {
                const defaultForm = cleanedForms.find(f => f.formId === effectiveDefaultFormId) || cleanedForms[0]
                if (defaultForm?.imageUrl) cleanedData.imageUrl = defaultForm.imageUrl
            }

            if (isEdit) {
                await pokemonApi.update(id, cleanedData)
            } else {
                await pokemonApi.create(cleanedData)
            }

            navigate('/admin/pokemon')
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const updateStat = (stat, value) => {
        setFormData(prev => ({
            ...prev,
            baseStats: { ...prev.baseStats, [stat]: parseInt(value) || 0 }
        }))
    }

    const toggleType = (type) => {
        setFormData(prev => ({
            ...prev,
            types: prev.types.includes(type)
                ? prev.types.filter(t => t !== type)
                : prev.types.length < 2 ? [...prev.types, type] : prev.types
        }))
    }

    // Moves Logic
    const updateMove = (index, field, value) => {
        setFormData(prev => ({
            ...prev,
            levelUpMoves: prev.levelUpMoves.map((m, i) => i === index ? { ...m, [field]: value } : m)
        }))
    }

    const addMove = () => {
        setFormData(prev => ({
            ...prev,
            levelUpMoves: [...prev.levelUpMoves, { level: 1, moveName: '' }]
        }))
    }

    const removeMove = (index) => {
        setFormData(prev => ({
            ...prev,
            levelUpMoves: prev.levelUpMoves.filter((_, i) => i !== index)
        }))
    }

    const addForm = () => {
        setForms(prev => [...prev, { formId: '', formName: '', imageUrl: '', sprites: {}, stats: {} }])
    }

    const closeBulkUploadModal = (force = false) => {
        if (!force && bulkFormUploading) return
        setShowBulkUploadModal(false)
        setBulkUploadQueueRows([])
    }

    const updateBulkUploadQueueRow = (queueId, patch = {}) => {
        setBulkUploadQueueRows((prev) => prev.map((row) => (row.queueId === queueId ? { ...row, ...patch } : row)))
    }

    const applyBulkFormUploadResults = (items = [], onSummary = null) => {
        if (!Array.isArray(items) || items.length === 0) {
            if (typeof onSummary === 'function') {
                onSummary({ createdCount: 0, skippedCount: 0 })
            }
            return
        }

        setForms((prev) => {
            const next = [...prev]
            const existingFormIds = new Set(
                next
                    .map((entry) => normalizeFormId(entry?.formId).toLowerCase())
                    .filter(Boolean)
            )
            let createdCount = 0
            let skippedCount = 0

            items.forEach(({ fileName, url }) => {
                if (!url) return

                const inferred = inferFormVariantFromFileName(
                    fileName,
                    formVariantOptions,
                    allPokemon.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
                )
                const normalizedFormId = normalizeFormId(inferred.formId).toLowerCase()
                const fallbackFormName = normalizeFormName(inferred.formName)

                if (!normalizedFormId) {
                    skippedCount += 1
                    return
                }

                if (existingFormIds.has(normalizedFormId)) {
                    skippedCount += 1
                    return
                }

                existingFormIds.add(normalizedFormId)
                createdCount += 1

                next.push({
                    formId: normalizedFormId,
                    formName: fallbackFormName || FORM_VARIANT_NAME_BY_ID[normalizedFormId] || normalizedFormId,
                    imageUrl: url,
                    sprites: {},
                    stats: {},
                })
            })

            setDefaultFormId((prevDefault) => resolveDefaultFormId(next, prevDefault))
            if (typeof onSummary === 'function') {
                onSummary({ createdCount, skippedCount })
            }
            return next
        })
    }

    const handleBulkFormImagesSelected = async (event) => {
        const files = Array.from(event.target.files || [])
        event.target.value = ''
        if (files.length === 0) return

        for (const file of files) {
            const validationError = validateImageFile(file)
            if (validationError) {
                setError(`Ảnh "${file.name}" không hợp lệ: ${validationError}`)
                return
            }
        }

        try {
            setError('')
            setBulkFormUploadNotice('')
            setShowBulkUploadModal(true)
            setBulkFormUploading(true)
            setBulkFormUploadProgress(0)
            setBulkFormUploadCount(files.length)

            const pokemonNames = allPokemon
                .map((entry) => String(entry?.name || '').trim())
                .filter(Boolean)

            const preparedRows = files.map((file, index) => {
                const inferred = inferFormVariantFromFileName(file.name, formVariantOptions, pokemonNames)
                const inferredFormId = normalizeFormId(inferred.formId).toLowerCase()
                const inferredFormName = normalizeFormName(inferred.formName) || inferredFormId
                return {
                    queueId: `${Date.now()}-${index}-${file.name}`,
                    file,
                    fileName: file.name,
                    inferredFormId,
                    inferredFormName,
                    status: 'pending',
                    progress: 0,
                    message: '',
                }
            })

            setBulkUploadQueueRows(preparedRows)

            const existingFormIds = new Set(
                forms
                    .map((entry) => normalizeFormId(entry?.formId).toLowerCase())
                    .filter(Boolean)
            )

            const uploadedItems = []
            let skippedBeforeUpload = 0
            let uploadFailed = 0

            for (let index = 0; index < preparedRows.length; index += 1) {
                const row = preparedRows[index]
                const normalizedFormId = normalizeFormId(row.inferredFormId).toLowerCase()

                if (!normalizedFormId) {
                    skippedBeforeUpload += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: 'Không đọc được formId từ tên file',
                    })
                    setBulkFormUploadProgress(Math.round(((index + 1) / preparedRows.length) * 100))
                    continue
                }

                if (existingFormIds.has(normalizedFormId)) {
                    skippedBeforeUpload += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: `Đã tồn tại formId ${normalizedFormId}, bỏ qua để tránh ghi đè`,
                    })
                    setBulkFormUploadProgress(Math.round(((index + 1) / preparedRows.length) * 100))
                    continue
                }

                updateBulkUploadQueueRow(row.queueId, {
                    status: 'uploading',
                    progress: 0,
                    message: `Đang upload: ${row.inferredFormName || normalizedFormId}`,
                })

                try {
                    const url = await uploadOneToCloudinary(row.file, (percentage) => {
                        updateBulkUploadQueueRow(row.queueId, { progress: percentage })
                    })

                    existingFormIds.add(normalizedFormId)
                    uploadedItems.push({ fileName: row.fileName, url })
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'success',
                        progress: 100,
                        message: `Đã upload xong và xếp vào dạng ${normalizedFormId}`,
                    })
                } catch (err) {
                    uploadFailed += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'error',
                        progress: 0,
                        message: err.message || 'Upload thất bại',
                    })
                } finally {
                    setBulkFormUploadProgress(Math.round(((index + 1) / preparedRows.length) * 100))
                }
            }

            await new Promise((resolve) => {
                applyBulkFormUploadResults(uploadedItems, (result) => {
                    const totalSkipped = skippedBeforeUpload + result.skippedCount
                    if (result.createdCount > 0 || totalSkipped > 0 || uploadFailed > 0) {
                        const summaryParts = [`Đã thêm ${result.createdCount} dạng mới`]
                        if (totalSkipped > 0) summaryParts.push(`bỏ qua ${totalSkipped} ảnh trùng/không hợp lệ`)
                        if (uploadFailed > 0) summaryParts.push(`${uploadFailed} ảnh upload lỗi`)
                        setBulkFormUploadNotice(`${summaryParts.join(', ')}.`)
                    } else {
                        setBulkFormUploadNotice('Không thêm được dạng mới từ bộ ảnh đã chọn.')
                    }
                    resolve()
                })
            })
        } catch (err) {
            setError(err.message || 'Upload ảnh form hàng loạt thất bại')
        } finally {
            setBulkFormUploading(false)
            setBulkFormUploadCount(0)
        }
    }

    const updateForm = (index, patch) => {
        setForms(prev => {
            const prevId = normalizeFormId(prev[index]?.formId).toLowerCase()
            const normalizedPatch = { ...patch }
            if ('formId' in normalizedPatch) {
                normalizedPatch.formId = normalizeFormId(normalizedPatch.formId).toLowerCase()
            }
            const next = prev.map((f, i) => (i === index ? { ...f, ...normalizedPatch } : f))

            const resolvedDefault = resolveDefaultFormId(next, defaultFormId)

            if (patch.formId && prevId === normalizeFormId(defaultFormId).toLowerCase()) {
                setDefaultFormId(resolvedDefault)
                return next
            }

            if (resolveDefaultFormId(next, defaultFormId) !== normalizeFormId(defaultFormId).toLowerCase()) {
                setDefaultFormId(resolvedDefault)
            }
            return next
        })
    }

    const applyPresetToForm = (index, presetId, presetName = '') => {
        const normalizedPresetId = normalizeFormId(presetId).toLowerCase()
        if (!normalizedPresetId) return
        const resolvedPresetName = getVariantDisplayName(normalizedPresetId, presetName)

        setForms(prev => {
            const next = prev.map((f, i) => {
                if (i !== index) return f
                return { ...f, formId: normalizedPresetId, formName: resolvedPresetName }
            })
            setDefaultFormId((prevDefault) => resolveDefaultFormId(next, prevDefault))
            return next
        })
    }

    const openFormVariantModal = (targetIndex) => {
        setFormVariantModalTargetIndex(targetIndex)
        setFormVariantSearchTerm('')
        setFormVariantPage(1)
        setNewFormVariantId('')
        setNewFormVariantName('')
        setFormVariantModalError('')
        setFormVariantSubmitting(false)
        setShowFormVariantModal(true)
    }

    const closeFormVariantModal = (force = false) => {
        if (!force && formVariantSubmitting) return
        setShowFormVariantModal(false)
        setFormVariantModalTargetIndex(null)
        setFormVariantSearchTerm('')
        setFormVariantPage(1)
        setNewFormVariantId('')
        setNewFormVariantName('')
        setFormVariantModalError('')
        setFormVariantSubmitting(false)
    }

    const handleSelectVariantFromModal = (variant) => {
        if (!variant || selectedFormIndex < 0) return
        const normalizedVariantId = normalizeFormId(variant.id).toLowerCase()
        if (!normalizedVariantId) return

        if (usedFormIdsByOtherRows.has(normalizedVariantId)) {
            setFormVariantModalError(`Dạng "${normalizedVariantId}" đã tồn tại ở form khác`)
            return
        }

        applyPresetToForm(selectedFormIndex, normalizedVariantId, variant.name)
        closeFormVariantModal()
    }

    const handleAddVariantFromModal = async () => {
        if (selectedFormIndex < 0) return

        const normalizedVariantId = normalizeFormId(newFormVariantId).toLowerCase()
        const normalizedVariantName = getVariantDisplayName(normalizedVariantId, newFormVariantName)

        if (!normalizedVariantId) {
            setFormVariantModalError('Vui lòng nhập ID dạng mới')
            return
        }

        if (usedFormIdsByOtherRows.has(normalizedVariantId)) {
            setFormVariantModalError(`Dạng "${normalizedVariantId}" đã tồn tại ở form khác`)
            return
        }

        try {
            setFormVariantSubmitting(true)
            setFormVariantModalError('')

            const response = await pokemonApi.upsertFormVariant({
                formId: normalizedVariantId,
                formName: normalizedVariantName,
            })

            const savedId = normalizeFormId(response?.formVariant?.id || normalizedVariantId).toLowerCase()
            const savedName = getVariantDisplayName(savedId, response?.formVariant?.name || normalizedVariantName)

            setCustomFormVariants((prev) => mergeFormVariants(prev, [{ id: savedId, name: savedName }]))
            applyPresetToForm(selectedFormIndex, savedId, savedName)
            closeFormVariantModal(true)
        } catch (err) {
            setFormVariantModalError(err.message || 'Không thể lưu dạng mới vào hệ thống')
        } finally {
            setFormVariantSubmitting(false)
        }
    }

    const removeForm = (index) => {
        setForms(prev => {
            const next = prev.filter((_, i) => i !== index)
            setDefaultFormId(resolveDefaultFormId(next, defaultFormId))
            return next
        })
    }

    if (loading && isEdit && !formData.name) return <div className="text-blue-800 text-center py-8">Đang tải...</div>

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm max-w-4xl mx-auto mb-10">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">
                    {isEdit ? 'Cập Nhật Pokemon' : 'Thêm Mới Pokemon'}
                </h1>
            </div>

            <div className="p-6">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-8">

                    {/* --- Basic Info --- */}
                    <div>
                        <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">1. Thông Tin Chung</h3>
                        <div className="grid grid-cols-1 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Số Pokedex *</label>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        max="9999"
                                        value={formData.pokedexNumber}
                                        onChange={(e) => setFormData({ ...formData, pokedexNumber: parseInt(e.target.value) || '' })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên Pokemon *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <ImageUpload
                                        currentImage={formData.imageUrl}
                                        onUploadSuccess={(url) => setFormData({ ...formData, imageUrl: url })}
                                        label="Hình Ảnh Pokemon"
                                    />
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* --- Forms --- */}
                    <div>
                        <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">2. Các Dạng</h3>
                        <div className="mb-4 rounded border border-cyan-200 bg-cyan-50/60 p-3">
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Upload nhanh nhiều ảnh form</label>
                            <p className="text-[11px] text-cyan-800 mb-2">
                                Chọn nhiều ảnh một lần, hệ thống sẽ tự tạo form mới theo tên file cho Pokemon hiện tại.
                            </p>
                            <p className="text-[11px] text-cyan-800 mb-2">
                                Hỗ trợ tên liền chữ kiểu CamelCase. Ví dụ AstralHyperGalaxyPikachu.png sẽ tự tách về dạng Astral Hyper Galaxy.
                            </p>
                            <p className="text-[11px] text-cyan-800 mb-2">
                                Nếu trùng formId đã có trong dữ liệu, hệ thống sẽ bỏ qua, không ghi đè.
                            </p>
                            <p className="text-[11px] text-cyan-800 mb-2">
                                Sau khi chọn ảnh, modal tiến trình sẽ hiện theo từng file: xong ảnh này rồi mới sang ảnh tiếp theo.
                            </p>
                            <input
                                id="bulk-form-image-upload"
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleBulkFormImagesSelected}
                                className="hidden"
                                disabled={bulkFormUploading}
                            />
                            <label
                                htmlFor="bulk-form-image-upload"
                                className={`inline-flex items-center justify-center px-3 py-2 rounded border text-xs font-bold transition-colors ${bulkFormUploading
                                    ? 'bg-cyan-100 border-cyan-200 text-cyan-700 cursor-wait'
                                    : 'bg-white border-cyan-300 text-cyan-700 hover:bg-cyan-100 cursor-pointer'}`}
                            >
                                {bulkFormUploading ? `Đang up ${bulkFormUploadCount} ảnh...` : 'Chọn nhiều ảnh form'}
                            </label>
                            {bulkFormUploading && (
                                <div className="mt-2">
                                    <div className="w-full bg-cyan-100 rounded-full h-1.5">
                                        <div
                                            className="bg-cyan-500 h-1.5 rounded-full transition-all"
                                            style={{ width: `${bulkFormUploadProgress}%` }}
                                        />
                                    </div>
                                    <div className="text-[10px] text-cyan-700 mt-1">{bulkFormUploadProgress}%</div>
                                </div>
                            )}
                            {bulkFormUploadNotice && (
                                <div className="mt-2 text-[11px] font-semibold text-cyan-900">{bulkFormUploadNotice}</div>
                            )}
                        </div>
                        <div className="mb-4">
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Dạng Mặc Định</label>
                            <select
                                value={defaultFormId}
                                onChange={(e) => setDefaultFormId(normalizeFormId(e.target.value))}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {forms.filter(f => f.formId).length === 0 && (
                                    <option value="normal">normal</option>
                                )}
                                {forms.filter(f => f.formId).map((form) => (
                                    <option key={form.formId} value={form.formId}>
                                        {form.formName ? `${form.formName} (${form.formId})` : form.formId}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-4">
                            {forms.map((form, index) => (
                                <div key={`${form.formId || 'form'}-${index}`} className="rounded border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                                            <div>
                                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">ID dạng *</label>
                                                <button
                                                    type="button"
                                                    onClick={() => openFormVariantModal(index)}
                                                    className="w-full mb-2 px-3 py-2 bg-white border border-slate-300 rounded text-xs text-left hover:bg-slate-50"
                                                >
                                                    {form.formId
                                                        ? `Đổi nhanh dạng: ${getVariantDisplayName(form.formId, form.formName)} (${form.formId})`
                                                        : 'Chọn nhanh dạng có sẵn...'}
                                                </button>
                                                <input
                                                    type="text"
                                                    value={form.formId}
                                                    onChange={(e) => {
                                                        const nextFormId = normalizeFormId(e.target.value).toLowerCase()
                                                        const nextPatch = { formId: nextFormId }
                                                        if (!normalizeFormId(form.formName) && FORM_VARIANT_NAME_BY_ID[nextFormId]) {
                                                            nextPatch.formName = FORM_VARIANT_NAME_BY_ID[nextFormId]
                                                        }
                                                        updateForm(index, nextPatch)
                                                    }}
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên dạng</label>
                                                <input
                                                    type="text"
                                                    value={form.formName || ''}
                                                    onChange={(e) => updateForm(index, { formName: e.target.value })}
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.preventDefault(); removeForm(index) }}
                                                className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 rounded text-xs font-bold"
                                            >
                                                Xóa dạng
                                            </button>
                                        </div>
                                    </div>

                                    <ImageUpload
                                        key={`${form.formId || 'form'}-${form.imageUrl || 'empty'}-${index}`}
                                        currentImage={form.imageUrl}
                                        onUploadSuccess={(urls) => {
                                            const nextUrl = Array.isArray(urls) ? (urls[0] || '') : (urls || '')
                                            updateForm(index, { imageUrl: nextUrl })
                                        }}
                                        label="Hình ảnh dạng"
                                    />
                                </div>
                            ))}
                        </div>

                        <button
                            type="button"
                            onClick={addForm}
                            className="mt-4 w-full py-2 border-2 border-dashed border-slate-300 text-slate-500 rounded hover:border-blue-400 hover:text-blue-600 font-bold text-xs"
                        >
                            Thêm Form
                        </button>
                    </div>

                    {/* --- Types & Stats --- */}
                    <div>
                        <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">3. Hệ & Chỉ Số</h3>

                        {/* Types */}
                        <div className="mb-6">
                            <label className="block text-slate-700 text-xs font-bold mb-2 uppercase">Hệ (Chọn 1-2)</label>
                            <div className="flex flex-wrap gap-2">
                                {TYPES.map(type => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => toggleType(type)}
                                        className={`px-3 py-1.5 rounded text-xs font-bold uppercase border transition-all ${formData.types.includes(type)
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm transform -translate-y-0.5'
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Base Stats */}
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                                {['hp', 'atk', 'def', 'spatk', 'spldef', 'spd'].map(stat => (
                                    <div key={stat}>
                                        <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1 text-center">{stat}</label>
                                        <input
                                            type="number"
                                            required
                                            min="1"
                                            max="255"
                                            value={formData.baseStats[stat]}
                                            onChange={(e) => updateStat(stat, e.target.value)}
                                            className="w-full px-1 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-sm text-center focus:border-blue-500 font-bold"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* --- Game Mechanics --- */}
                    <div>
                        <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">4. Cơ Chế Game</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Catch Rate */}
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tỷ Lệ Bắt (1-255)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="255"
                                    value={formData.catchRate}
                                    onChange={(e) => setFormData({ ...formData, catchRate: parseInt(e.target.value) || 45 })}
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">Cao = Dễ bắt (VD: Pidgey 255)</p>
                            </div>

                            {/* Base Exp */}
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">EXP Cơ Bản</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={formData.baseExperience}
                                    onChange={(e) => setFormData({ ...formData, baseExperience: parseInt(e.target.value) || 50 })}
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">EXP nhận được khi đánh bại</p>
                            </div>

                            {/* Growth Rate */}
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tốc Độ Lớn</label>
                                <select
                                    value={formData.growthRate}
                                    onChange={(e) => setFormData({ ...formData, growthRate: e.target.value })}
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                >
                                    {GROWTH_RATES.map(rate => (
                                        <option key={rate} value={rate}>{rate.replace('_', ' ').toUpperCase()}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* --- Evolution --- */}
                    <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                        <h3 className="text-sm font-bold text-orange-800 uppercase mb-3">5. Tiến Hóa</h3>
                        <div className="flex gap-4 items-start">
                            <div className="flex-1">
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tiến hóa thành</label>
                                <select
                                    value={formData.evolution.evolvesTo}
                                    onChange={(e) => setFormData({ ...formData, evolution: { ...formData.evolution, evolvesTo: e.target.value } })}
                                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                                >
                                    <option value="">-- Không tiến hóa --</option>
                                    {allPokemon.map(p => (
                                        <option key={p._id} value={p._id} disabled={p._id === id}>
                                            #{p.pokedexNumber} {p.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="w-32">
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Cấp độ</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="Lv."
                                    value={formData.evolution.minLevel}
                                    onChange={(e) => setFormData({ ...formData, evolution: { ...formData.evolution, minLevel: e.target.value } })}
                                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                                    disabled={!formData.evolution.evolvesTo}
                                />
                            </div>
                        </div>
                    </div>

                    {/* --- Moves --- */}
                    <div>
                        <h3 className="text-sm font-bold text-blue-900 uppercase mb-4 border-b border-blue-100 pb-2">6. Bộ Chiêu Thức (Theo Cấp)</h3>
                        <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                            <datalist id="pokemon-move-catalog-options">
                                {moveCatalog.map((move) => (
                                    <option
                                        key={move._id}
                                        value={move.name}
                                        label={`${move.name} • ${String(move.type || '').toUpperCase()} • ${String(move.category || '').toUpperCase()}`}
                                    />
                                ))}
                            </datalist>
                            <table className="w-full text-sm">
                                <thead className="bg-slate-100 text-slate-600 text-xs uppercase font-bold">
                                    <tr>
                                        <th className="px-4 py-2 text-left w-24">Level</th>
                                        <th className="px-4 py-2 text-left">Tên Chiêu Thức</th>
                                        <th className="px-4 py-2 w-20"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {formData.levelUpMoves.map((move, index) => (
                                        <tr key={index}>
                                            <td className="p-2">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="100"
                                                    value={move.level}
                                                    onChange={(e) => updateMove(index, 'level', e.target.value)}
                                                    className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-center"
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input
                                                    type="text"
                                                    placeholder="VD: Tackle"
                                                    value={move.moveName}
                                                    onChange={(e) => updateMove(index, 'moveName', e.target.value)}
                                                    onBlur={(e) => updateMove(index, 'moveName', canonicalizeMoveName(e.target.value))}
                                                    list="pokemon-move-catalog-options"
                                                    className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
                                                />
                                            </td>
                                            <td className="p-2 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => removeMove(index)}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="p-2 bg-slate-100 border-t border-slate-200">
                                <p className="text-[10px] text-slate-500 mb-2">
                                    Gợi ý tự động từ kho kỹ năng ({moveCatalog.length.toLocaleString('vi-VN')} kỹ năng).
                                </p>
                                <button
                                    type="button"
                                    onClick={addMove}
                                    className="w-full py-1.5 border-2 border-dashed border-slate-300 text-slate-500 rounded hover:border-blue-400 hover:text-blue-600 font-bold text-xs"
                                >
                                    + Thêm Chiêu Thức
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Độ Hiếm</label>
                            <select
                                value={formData.rarity}
                                onChange={(e) => setFormData({ ...formData, rarity: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {RARITIES.map(r => (
                                    <option key={r} value={r}>{r.toUpperCase().replace('_', ' ')}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Mô Tả</label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                rows="3"
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-6 border-t border-slate-200 sticky bottom-0 bg-white/95 backdrop-blur py-4 -mx-6 px-6 shadow-up">
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-sm font-bold shadow-md transform transition-all active:scale-[0.98]"
                        >
                            {loading ? 'Đang Xử Lý...' : isEdit ? 'LƯU THAY ĐỔI' : 'TẠO POKEMON MỚI'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/pokemon')}
                            className="px-8 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-bold shadow-sm transition-all"
                        >
                            Hủy
                        </button>
                    </div>
                </form>
            </div>

            {showFormVariantModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={closeFormVariantModal}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Chọn nhanh dạng có sẵn</h3>
                            <button
                                type="button"
                                onClick={closeFormVariantModal}
                                disabled={formVariantSubmitting}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm dạng</label>
                                <input
                                    type="text"
                                    value={formVariantSearchTerm}
                                    onChange={(event) => {
                                        setFormVariantSearchTerm(event.target.value)
                                        setFormVariantPage(1)
                                        setFormVariantModalError('')
                                    }}
                                    disabled={formVariantSubmitting}
                                    placeholder="Nhập tên dạng hoặc formId"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {formVariantPageRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không có dạng phù hợp</div>
                                ) : (
                                    formVariantPageRows.map((variant) => {
                                        const isAlreadyUsed = usedFormIdsByOtherRows.has(variant.id)
                                        return (
                                            <button
                                                key={variant.id}
                                                type="button"
                                                onClick={() => handleSelectVariantFromModal(variant)}
                                                disabled={isAlreadyUsed}
                                                className={`w-full px-3 py-2 text-left flex items-center justify-between transition-colors ${isAlreadyUsed
                                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                    : 'hover:bg-slate-50 text-slate-700'}`}
                                            >
                                                <span className="font-semibold">{variant.name} ({variant.id})</span>
                                                {isAlreadyUsed && <span className="text-[10px] font-bold uppercase">Đã dùng</span>}
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>
                                    Hiển thị {formVariantPageStart}-{formVariantPageEnd} / {formVariantTotal} dạng
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setFormVariantPage((prev) => Math.max(1, prev - 1))}
                                        disabled={resolvedFormVariantPage <= 1 || formVariantSubmitting}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">
                                        Trang {resolvedFormVariantPage}/{formVariantTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setFormVariantPage((prev) => Math.min(formVariantTotalPages, prev + 1))}
                                        disabled={resolvedFormVariantPage >= formVariantTotalPages || formVariantSubmitting}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Sau
                                    </button>
                                </div>
                            </div>

                            <div className="rounded border border-cyan-200 bg-cyan-50 p-3">
                                <div className="text-sm font-bold text-cyan-900 mb-2">Thêm dạng mới</div>
                                <p className="text-[11px] text-cyan-800 mb-2">
                                    Dạng mới sẽ được lưu ngay vào database và dùng chung cho các lần tạo/sửa Pokémon sau.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <input
                                        type="text"
                                        value={newFormVariantId}
                                        onChange={(event) => {
                                            setNewFormVariantId(event.target.value)
                                            setFormVariantModalError('')
                                        }}
                                        disabled={formVariantSubmitting}
                                        placeholder="formId mới (vd: cosmic)"
                                        className="w-full px-3 py-2 bg-white border border-cyan-200 rounded text-sm"
                                    />
                                    <input
                                        type="text"
                                        value={newFormVariantName}
                                        onChange={(event) => {
                                            setNewFormVariantName(event.target.value)
                                            setFormVariantModalError('')
                                        }}
                                        disabled={formVariantSubmitting}
                                        placeholder="Tên dạng (vd: Cosmic)"
                                        className="w-full px-3 py-2 bg-white border border-cyan-200 rounded text-sm"
                                    />
                                </div>
                                <div className="mt-2 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleAddVariantFromModal}
                                        disabled={formVariantSubmitting}
                                        className="px-3 py-2 bg-white border border-cyan-300 text-cyan-700 rounded text-xs font-bold hover:bg-cyan-100"
                                    >
                                        {formVariantSubmitting ? 'Đang lưu vào DB...' : 'Thêm và áp dụng dạng mới'}
                                    </button>
                                </div>
                            </div>

                            {formVariantModalError && (
                                <div className="text-sm font-bold text-red-600">{formVariantModalError}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showBulkUploadModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={() => closeBulkUploadModal()}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[96vw] sm:max-w-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Tiến trình upload ảnh form</h3>
                            <button
                                type="button"
                                onClick={() => closeBulkUploadModal()}
                                disabled={bulkFormUploading}
                                className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="mb-4 rounded border border-cyan-200 bg-cyan-50 p-3">
                            <div className="flex items-center justify-between text-xs font-semibold text-cyan-900 mb-2">
                                <span>
                                    {bulkFormUploading
                                        ? `Đang xử lý tuần tự ${bulkFormUploadCount} ảnh...`
                                        : `Đã xử lý xong ${bulkUploadQueueRows.length} ảnh.`}
                                </span>
                                <span>{bulkFormUploadProgress}%</span>
                            </div>
                            <div className="w-full bg-cyan-100 rounded-full h-2">
                                <div
                                    className="bg-cyan-500 h-2 rounded-full transition-all"
                                    style={{ width: `${bulkFormUploadProgress}%` }}
                                />
                            </div>
                        </div>

                        <div className="max-h-[52vh] overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
                            {bulkUploadQueueRows.length === 0 ? (
                                <div className="px-4 py-6 text-sm text-slate-500 text-center">Chưa có ảnh nào trong hàng đợi upload.</div>
                            ) : (
                                bulkUploadQueueRows.map((row, index) => {
                                    const statusMeta = BULK_UPLOAD_STATUS_META[row.status] || BULK_UPLOAD_STATUS_META.pending
                                    return (
                                        <div key={row.queueId} className="px-4 py-3 bg-white">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-slate-800 truncate">{index + 1}. {row.fileName}</div>
                                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                                        Dạng dự kiến: {row.inferredFormName ? `${row.inferredFormName} (${row.inferredFormId || 'n/a'})` : (row.inferredFormId || 'Không xác định')}
                                                    </div>
                                                    {row.message && (
                                                        <div className="text-[11px] text-slate-600 mt-1">{row.message}</div>
                                                    )}
                                                </div>
                                                <span className={`shrink-0 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${statusMeta.badgeClass}`}>
                                                    {statusMeta.label}
                                                </span>
                                            </div>
                                            {(row.status === 'uploading' || row.status === 'success') && (
                                                <div className="mt-2">
                                                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                        <div
                                                            className="bg-blue-500 h-1.5 rounded-full transition-all"
                                                            style={{ width: `${row.progress || 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={() => closeBulkUploadModal()}
                                disabled={bulkFormUploading}
                                className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {bulkFormUploading ? 'Đang upload...' : 'Đóng'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="text-center mt-6 p-4">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>
        </div>
    )
}







