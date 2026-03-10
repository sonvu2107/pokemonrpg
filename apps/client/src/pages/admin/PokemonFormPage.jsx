
import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { pokemonApi, itemApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'
import { uploadOneToCloudinary, validateImageFile } from '../../utils/cloudinaryUtils'

const TYPES = [
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
]

const RARITIES = ['sss+', 'sss', 'ss', 's', 'a', 'b', 'c', 'd']

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
const EVOLUTION_TARGET_MODAL_PAGE_SIZE = 12
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
const BULK_UPLOAD_RETRY_ATTEMPTS = 3
const BULK_UPLOAD_RETRY_BASE_DELAY_MS = 800
const BULK_UPLOAD_MAX_CONCURRENCY = 3
const POKEMON_RARITY_ORDER = ['d', 'c', 'b', 'a', 's', 'ss', 'sss', 'sss+']

const waitForMs = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

const isRetryableUploadError = (error) => {
    const message = String(error?.message || '').toLowerCase()
    if (!message) return false

    const retryableHints = [
        'lỗi mạng',
        'network',
        'timeout',
        'timed out',
        '429',
        '500',
        '502',
        '503',
        '504',
    ]

    return retryableHints.some((hint) => message.includes(hint))
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

const isEvolutionItemAllowedForRarity = (item, rarity) => {
    const rarityIndex = POKEMON_RARITY_ORDER.indexOf(normalizeRarity(rarity))
    if (rarityIndex < 0) return true

    const fromIndex = POKEMON_RARITY_ORDER.indexOf(normalizeRarity(item?.evolutionRarityFrom || 'd'))
    const toIndex = POKEMON_RARITY_ORDER.indexOf(normalizeRarity(item?.evolutionRarityTo || 'sss+'))
    if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) return false
    return rarityIndex >= fromIndex && rarityIndex <= toIndex
}

const normalizeEvolutionState = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    const evolvesTo = String(source?.evolvesTo?._id || source?.evolvesTo || '').trim()
    const targetFormId = String(source?.targetFormId || '').trim().toLowerCase()
    const minLevel = source?.minLevel ?? ''
    const requiredItemId = String(source?.requiredItemId?._id || source?.requiredItemId || '').trim()
    const requiredItemQuantity = source?.requiredItemQuantity ?? 1

    return {
        evolvesTo,
        targetFormId,
        minLevel: minLevel === null ? '' : minLevel,
        requiredItemId,
        requiredItemQuantity: requiredItemId ? requiredItemQuantity : 1,
    }
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

const hasGigantamaxKeywordInStem = (stem = '') => {
    const compact = String(stem || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!compact) return false
    return compact.includes('gigantamax') || compact.includes('gmax')
}

const stripTrailingArtifactTokens = (tokens = []) => {
    const next = Array.isArray(tokens) ? [...tokens] : []
    while (next.length > 0) {
        const tail = String(next[next.length - 1] || '').toLowerCase()
        if (!tail) {
            next.pop()
            continue
        }

        const isLargeNumeric = /^\d{4,}$/.test(tail)
        const isNoiseToken = ['copy', 'final', 'edited', 'edit', 'new'].includes(tail)
        if (!isLargeNumeric && !isNoiseToken) break
        next.pop()
    }
    return next
}

const toTitleCaseFromTokens = (tokens = []) => (
    (Array.isArray(tokens) ? tokens : [])
        .filter(Boolean)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ')
)

const formatFormPreviewLabel = (formId = '', formName = '') => {
    const normalizedFormId = normalizeFormId(formId).toLowerCase()
    const normalizedFormName = normalizeFormName(formName)
    if (!normalizedFormId && !normalizedFormName) return 'Không xác định'
    if (!normalizedFormId) return normalizedFormName
    if (!normalizedFormName) return normalizedFormId
    return `${normalizedFormName} (${normalizedFormId})`
}

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

    const stemTokens = stripTrailingArtifactTokens(splitStemTokens(stemRaw))
    if (stemTokens.length === 0) return { formId: '', formName: '' }

    const pokemonSuffixTokenLength = findPokemonSuffixTokenLength(stemTokens, pokemonNames)
    const normalizedStemTokens = pokemonSuffixTokenLength > 0
        ? stemTokens.slice(0, stemTokens.length - pokemonSuffixTokenLength)
        : stemTokens
    const effectiveStemTokens = normalizedStemTokens
    if (effectiveStemTokens.length === 0) return { formId: 'normal', formName: 'Normal' }
    const variantPool = Array.isArray(variants) && variants.length > 0 ? variants : FORM_VARIANTS
    const compactStem = effectiveStemTokens.join('')
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
        const fallbackTokens = effectiveStemTokens
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

const collectDuplicateFormIdEntries = (formRows = []) => {
    const rowNumbersByFormId = new Map()

    ;(Array.isArray(formRows) ? formRows : []).forEach((entry, index) => {
        const formId = normalizeFormId(entry?.formId).toLowerCase()
        if (!formId) return

        if (!rowNumbersByFormId.has(formId)) {
            rowNumbersByFormId.set(formId, [])
        }

        rowNumbersByFormId.get(formId).push(index + 1)
    })

    return Array.from(rowNumbersByFormId.entries())
        .filter(([, rowNumbers]) => rowNumbers.length > 1)
        .map(([formId, rowNumbers]) => ({ formId, rowNumbers }))
}

const GROWTH_RATES = ['fast', 'medium_fast', 'medium_slow', 'slow', 'erratic', 'fluctuating']

export default function PokemonFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const isEdit = Boolean(id)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [allPokemon, setAllPokemon] = useState([])
    const [evolutionItems, setEvolutionItems] = useState([])
    const [moveCatalog, setMoveCatalog] = useState([])
    const [bulkFormUploading, setBulkFormUploading] = useState(false)
    const [bulkFormUploadProgress, setBulkFormUploadProgress] = useState(0)
    const [bulkFormUploadCount, setBulkFormUploadCount] = useState(0)
    const [bulkFormUploadNotice, setBulkFormUploadNotice] = useState('')
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false)
    const [bulkUploadMegaMode, setBulkUploadMegaMode] = useState('keep')
    const [bulkUploadGigantamaxMode, setBulkUploadGigantamaxMode] = useState('keep')
    const [bulkUploadSelectedFiles, setBulkUploadSelectedFiles] = useState([])
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
    const [showEvolutionTargetModal, setShowEvolutionTargetModal] = useState(false)
    const [evolutionTargetSearchTerm, setEvolutionTargetSearchTerm] = useState('')
    const [evolutionTargetPage, setEvolutionTargetPage] = useState(1)
    const [evolutionTargetModalScope, setEvolutionTargetModalScope] = useState({ type: 'base', formIndex: null })
    const [defaultFormId, setDefaultFormId] = useState('normal')
    const [forms, setForms] = useState([
        {
            formId: 'normal',
            formName: 'Normal',
            imageUrl: '',
            sprites: {},
            stats: {},
            evolution: normalizeEvolutionState(),
        },
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
        evolution: { evolvesTo: '', targetFormId: '', minLevel: '', requiredItemId: '', requiredItemQuantity: 1 },
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
    const hasPendingBulkQueueRows = bulkUploadQueueRows.some((row) => row.status === 'pending')
    const hasFailedBulkQueueRows = bulkUploadQueueRows.some((row) => row.status === 'error')
    const bulkMegaFileCount = bulkUploadQueueRows.filter((row) => row.hasMegaKeyword).length
    const bulkGigantamaxFileCount = bulkUploadQueueRows.filter((row) => row.hasGigantamaxKeyword).length
    const duplicateFormIdEntries = collectDuplicateFormIdEntries(forms)
    const hasDuplicateFormIds = duplicateFormIdEntries.length > 0
    const modalScopeIsForm = evolutionTargetModalScope?.type === 'form' && Number.isInteger(evolutionTargetModalScope?.formIndex)
    const modalScopeFormIndex = modalScopeIsForm ? evolutionTargetModalScope.formIndex : null
    const modalScopeForm = modalScopeIsForm ? forms[modalScopeFormIndex] : null
    const scopedEvolution = modalScopeForm
        ? normalizeEvolutionState(modalScopeForm?.evolution)
        : normalizeEvolutionState(formData?.evolution)
    const normalizedEvolutionTargetSearchTerm = String(evolutionTargetSearchTerm || '').trim().toLowerCase()
    const filteredEvolutionTargets = allPokemon
        .filter((entry) => String(entry?._id || '') !== String(id || ''))
        .filter((entry) => {
            if (!normalizedEvolutionTargetSearchTerm) return true
            const targetName = String(entry?.name || '').toLowerCase()
            const targetNumber = String(entry?.pokedexNumber || '')
            const formTokens = (Array.isArray(entry?.forms) ? entry.forms : [])
                .flatMap((form) => [form?.formId, form?.formName])
                .map((value) => String(value || '').toLowerCase())
                .filter(Boolean)
            return targetName.includes(normalizedEvolutionTargetSearchTerm)
                || targetNumber.includes(normalizedEvolutionTargetSearchTerm)
                || formTokens.some((token) => token.includes(normalizedEvolutionTargetSearchTerm))
        })
    const evolutionTargetTotal = filteredEvolutionTargets.length
    const evolutionTargetTotalPages = Math.max(1, Math.ceil(evolutionTargetTotal / EVOLUTION_TARGET_MODAL_PAGE_SIZE))
    const resolvedEvolutionTargetPage = Math.min(evolutionTargetPage, evolutionTargetTotalPages)
    const evolutionTargetPageStartIndex = (resolvedEvolutionTargetPage - 1) * EVOLUTION_TARGET_MODAL_PAGE_SIZE
    const evolutionTargetPageRows = filteredEvolutionTargets.slice(
        evolutionTargetPageStartIndex,
        evolutionTargetPageStartIndex + EVOLUTION_TARGET_MODAL_PAGE_SIZE
    )
    const selectedEvolutionTarget = allPokemon.find(
        (entry) => String(entry?._id || '') === String(formData?.evolution?.evolvesTo || '')
    ) || null
    const selectedEvolutionTargetForms = (() => {
        if (!selectedEvolutionTarget) return []
        const forms = Array.isArray(selectedEvolutionTarget.forms) ? selectedEvolutionTarget.forms : []
        if (forms.length > 0) return forms
        const fallbackFormId = normalizeFormId(selectedEvolutionTarget.defaultFormId || 'normal').toLowerCase() || 'normal'
        return [{ formId: fallbackFormId, formName: fallbackFormId }]
    })()
    const scopedSelectedEvolutionTarget = allPokemon.find(
        (entry) => String(entry?._id || '') === String(scopedEvolution?.evolvesTo || '')
    ) || null
    const scopedSelectedEvolutionTargetForms = (() => {
        if (!scopedSelectedEvolutionTarget) return []
        const forms = Array.isArray(scopedSelectedEvolutionTarget.forms) ? scopedSelectedEvolutionTarget.forms : []
        if (forms.length > 0) return forms
        const fallbackFormId = normalizeFormId(scopedSelectedEvolutionTarget.defaultFormId || 'normal').toLowerCase() || 'normal'
        return [{ formId: fallbackFormId, formName: fallbackFormId }]
    })()

    useEffect(() => {
        loadData()
    }, [id])

    useEffect(() => {
        const inferredCustomVariants = extractCustomVariantsFromForms(forms)
        if (inferredCustomVariants.length === 0) return
        setCustomFormVariants((prev) => mergeFormVariants(prev, inferredCustomVariants))
    }, [forms])

    useEffect(() => {
        if (!location.state?.openBulkFormUploadModal) return
        setShowBulkUploadModal(true)
    }, [location.state])

    useEffect(() => {
        if (!formData?.evolution?.evolvesTo) {
            if (formData?.evolution?.targetFormId) {
                setFormData((prev) => ({
                    ...prev,
                    evolution: {
                        ...prev.evolution,
                        targetFormId: '',
                    },
                }))
            }
            return
        }

        if (!selectedEvolutionTarget) return
        const allowedFormIds = new Set(
            selectedEvolutionTargetForms
                .map((form) => String(form?.formId || '').trim().toLowerCase())
                .filter(Boolean)
        )
        const currentTargetFormId = String(formData?.evolution?.targetFormId || '').trim().toLowerCase()
        if (!currentTargetFormId || allowedFormIds.has(currentTargetFormId)) return

        setFormData((prev) => ({
            ...prev,
            evolution: {
                ...prev.evolution,
                targetFormId: '',
            },
        }))
    }, [
        formData?.evolution?.evolvesTo,
        formData?.evolution?.targetFormId,
        selectedEvolutionTarget,
        selectedEvolutionTargetForms,
    ])

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
            // Fetch full Pokemon catalog for evolution modal + move catalog + shared form variants
            const loadAllPokemonForEvolution = async () => {
                const limit = 100
                let pageCursor = 1
                let totalPages = 1
                const collected = []

                do {
                    const data = await pokemonApi.list({ page: pageCursor, limit }).catch(() => ({ pokemon: [], pagination: { pages: 1 } }))
                    if (Array.isArray(data?.pokemon) && data.pokemon.length > 0) {
                        collected.push(...data.pokemon)
                    }
                    const parsedPages = Number.parseInt(data?.pagination?.pages, 10)
                    totalPages = Number.isFinite(parsedPages) && parsedPages > 0 ? parsedPages : 1
                    pageCursor += 1
                } while (pageCursor <= totalPages)

                const uniqueById = new Map()
                collected.forEach((entry) => {
                    const pokemonId = String(entry?._id || '').trim()
                    if (!pokemonId || uniqueById.has(pokemonId)) return
                    uniqueById.set(pokemonId, entry)
                })

                return [...uniqueById.values()]
            }

            const [pokemonRows, moveLookup, formVariantLookup] = await Promise.all([
                loadAllPokemonForEvolution(),
                pokemonApi.lookupMoves({ limit: 1000 }).catch(() => ({ moves: [] })),
                pokemonApi.listFormVariants({ limit: 1000 }).catch(() => ({ formVariants: [] })),
            ])
            const loadAllEvolutionItems = async () => {
                const limit = 100
                let pageCursor = 1
                let totalPages = 1
                const collected = []

                do {
                    const data = await itemApi.list({
                        page: pageCursor,
                        limit,
                        isEvolutionMaterial: true,
                    }).catch(() => ({ items: [], pagination: { pages: 1 } }))
                    if (Array.isArray(data?.items) && data.items.length > 0) {
                        collected.push(...data.items)
                    }
                    const parsedPages = Number.parseInt(data?.pagination?.pages, 10)
                    totalPages = Number.isFinite(parsedPages) && parsedPages > 0 ? parsedPages : 1
                    pageCursor += 1
                } while (pageCursor <= totalPages)

                return collected
            }

            const evolutionItemList = await loadAllEvolutionItems()
            setAllPokemon(pokemonRows)
            setMoveCatalog(moveLookup.moves || [])
            setCustomFormVariants(sanitizeCustomVariants(formVariantLookup.formVariants || []))
            setEvolutionItems(evolutionItemList)

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
                    evolution: normalizeEvolutionState(f?.evolution),
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
                        evolvesTo: String(pokemon.evolution?.evolvesTo?._id || pokemon.evolution?.evolvesTo || '').trim(),
                        targetFormId: String(pokemon.evolution?.targetFormId || '').trim().toLowerCase(),
                        minLevel: pokemon.evolution?.minLevel || '',
                        requiredItemId: String(
                            pokemon.evolution?.requiredItemId?._id || pokemon.evolution?.requiredItemId || ''
                        ).trim(),
                        requiredItemQuantity: pokemon.evolution?.requiredItemQuantity || 1,
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

        if (hasDuplicateFormIds) {
            const firstDuplicate = duplicateFormIdEntries[0]
            setError(`Dạng "${firstDuplicate.formId}" đang bị trùng ở dòng ${firstDuplicate.rowNumbers.join(', ')}. Vui lòng chỉnh lại ID dạng trước khi lưu.`)
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
                evolution: (() => {
                    const normalizedEvolution = normalizeEvolutionState(f?.evolution)
                    const evolvesTo = normalizedEvolution.evolvesTo || null
                    return {
                        evolvesTo,
                        targetFormId: evolvesTo ? (String(normalizedEvolution.targetFormId || '').trim().toLowerCase() || null) : null,
                        minLevel: evolvesTo ? (parseInt(normalizedEvolution.minLevel, 10) || null) : null,
                        requiredItemId: evolvesTo ? (String(normalizedEvolution.requiredItemId || '').trim() || null) : null,
                        requiredItemQuantity: evolvesTo && String(normalizedEvolution.requiredItemId || '').trim()
                            ? (Math.max(1, Number.parseInt(normalizedEvolution.requiredItemQuantity, 10) || 1))
                            : null,
                    }
                })(),
            }))
            .filter(f => f.formId)

        let effectiveDefaultFormId = resolveDefaultFormId(cleanedForms, normalizedDefaultFormId)

        if (cleanedForms.length > 0) {
            const ids = cleanedForms.map(f => f.formId)
            if (new Set(ids).size !== ids.length) {
                setError('Có dạng bị trùng nhau, vui lòng kiểm tra lại ID dạng')
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
                    targetFormId: formData.evolution.evolvesTo
                        ? (String(formData.evolution.targetFormId || '').trim().toLowerCase() || null)
                        : null,
                    minLevel: formData.evolution.evolvesTo ? (parseInt(formData.evolution.minLevel) || null) : null,
                    requiredItemId: formData.evolution.evolvesTo
                        ? (String(formData.evolution.requiredItemId || '').trim() || null)
                        : null,
                    requiredItemQuantity: formData.evolution.evolvesTo && String(formData.evolution.requiredItemId || '').trim()
                        ? (Math.max(1, Number.parseInt(formData.evolution.requiredItemQuantity, 10) || 1))
                        : null,
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
        setForms(prev => [...prev, {
            formId: '',
            formName: '',
            imageUrl: '',
            sprites: {},
            stats: {},
            evolution: normalizeEvolutionState(),
        }])
    }

    const buildBulkUploadQueueRows = (files = [], megaMode = 'keep', gigantamaxMode = 'keep') => {
        const list = Array.isArray(files) ? files : []
        const pokemonNames = allPokemon
            .map((entry) => String(entry?.name || '').trim())
            .filter(Boolean)
        const keepMega = megaMode === 'keep'
        const keepGigantamax = gigantamaxMode === 'keep'

        return list.map((file, index) => {
            const safeFileName = String(file?.name || '').trim()
            const inferredBase = inferFormVariantFromFileName(
                safeFileName,
                formVariantOptions,
                pokemonNames
            )
            const baseFormId = normalizeFormId(inferredBase.formId).toLowerCase()
            const baseFormName = normalizeFormName(inferredBase.formName) || baseFormId
            const stemRaw = safeFileName.replace(/\.[^.]+$/, '')
            const stemTokens = splitStemTokens(stemRaw)
            const hasMegaKeyword = stemTokens.includes('mega')
            const hasGigantamaxKeyword = hasGigantamaxKeywordInStem(stemRaw)
            const inferredKeepFormId = hasMegaKeyword ? baseFormId : ''
            const inferredKeepFormName = hasMegaKeyword ? baseFormName : 'Bỏ qua (không có Mega)'
            const inferredRemoveFormId = hasMegaKeyword ? '' : baseFormId
            const inferredRemoveFormName = hasMegaKeyword ? 'Bỏ qua (có Mega)' : baseFormName
            const inferredFormId = keepMega ? inferredKeepFormId : inferredRemoveFormId
            const inferredFormName = keepMega ? inferredKeepFormName : inferredRemoveFormName
            const megaSkipReason = keepMega
                ? (hasMegaKeyword ? '' : 'Ảnh không có Mega, bỏ qua theo chế độ Giữ Mega')
                : (hasMegaKeyword ? 'Ảnh có Mega, bỏ qua theo chế độ Bỏ Mega' : '')
            const gigantamaxSkipReason = keepGigantamax
                ? (hasGigantamaxKeyword ? '' : 'Ảnh không có Gigantamax, bỏ qua theo chế độ Giữ Gigantamax')
                : (hasGigantamaxKeyword ? 'Ảnh có Gigantamax, bỏ qua theo chế độ Bỏ Gigantamax' : '')
            const isMegaModeAffecting = inferredKeepFormId !== inferredRemoveFormId || inferredKeepFormName !== inferredRemoveFormName
            const skipReasonPreview = [megaSkipReason, gigantamaxSkipReason].filter(Boolean).join(' | ')
            const keepMessage = keepGigantamax
                ? 'Ảnh có Mega/Gigantamax đúng bộ lọc: sẽ giữ lại để tải lên'
                : 'Ảnh có Mega và không có Gigantamax: sẽ giữ lại để tải lên'
            const removeMessage = keepGigantamax
                ? 'Ảnh không có Mega và có Gigantamax: sẽ giữ lại để tải lên'
                : 'Ảnh không có Mega/Gigantamax: sẽ giữ lại để tải lên'
            const modeMessage = skipReasonPreview || (keepMega ? keepMessage : removeMessage)

            return {
                queueId: `${Date.now()}-${index}-${safeFileName || 'unnamed-file'}`,
                file,
                fileName: safeFileName || `file-${index + 1}`,
                inferredFormId,
                inferredFormName,
                inferredKeepFormId,
                inferredKeepFormName,
                inferredRemoveFormId,
                inferredRemoveFormName,
                hasMegaKeyword,
                hasGigantamaxKeyword,
                isMegaModeAffecting,
                megaSkipReason,
                status: 'pending',
                progress: 0,
                message: modeMessage,
            }
        })
    }

    const closeBulkUploadModal = (force = false) => {
        if (!force && bulkFormUploading) return
        setShowBulkUploadModal(false)
        setBulkUploadMegaMode('keep')
        setBulkUploadGigantamaxMode('keep')
        setBulkUploadSelectedFiles([])
        setBulkUploadQueueRows([])
        setBulkFormUploadProgress(0)
        setBulkFormUploadCount(0)
    }

    const updateBulkUploadQueueRow = (queueId, patch = {}) => {
        setBulkUploadQueueRows((prev) => prev.map((row) => (row.queueId === queueId ? { ...row, ...patch } : row)))
    }

    const handleBulkMegaModeChange = (mode) => {
        if (bulkFormUploading || bulkUploadSelectedFiles.length === 0 || !hasPendingBulkQueueRows) return
        const normalizedMode = mode === 'remove' ? 'remove' : 'keep'
        setBulkUploadMegaMode(normalizedMode)
        setBulkUploadQueueRows(buildBulkUploadQueueRows(bulkUploadSelectedFiles, normalizedMode, bulkUploadGigantamaxMode))
    }

    const handleBulkGigantamaxModeChange = (mode) => {
        if (bulkFormUploading || bulkUploadSelectedFiles.length === 0 || !hasPendingBulkQueueRows) return
        const normalizedMode = mode === 'remove' ? 'remove' : 'keep'
        setBulkUploadGigantamaxMode(normalizedMode)
        setBulkUploadQueueRows(buildBulkUploadQueueRows(bulkUploadSelectedFiles, bulkUploadMegaMode, normalizedMode))
    }

    const retryFailedBulkRows = () => {
        if (bulkFormUploading || !hasFailedBulkQueueRows) return

        setBulkUploadQueueRows((prev) => prev.map((row) => {
            if (row.status !== 'error') return row
            return {
                ...row,
                status: 'pending',
                progress: 0,
                message: 'Đã đưa lại vào hàng đợi để thử lại',
            }
        }))
        setBulkFormUploadProgress(0)
        setBulkFormUploadNotice('')
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

            items.forEach(({ formId, formName, url }) => {
                if (!url) return

                const normalizedFormId = normalizeFormId(formId).toLowerCase()
                const fallbackFormName = normalizeFormName(formName)

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
                    evolution: normalizeEvolutionState(),
                })
            })

            setDefaultFormId((prevDefault) => resolveDefaultFormId(next, prevDefault))
            if (typeof onSummary === 'function') {
                onSummary({ createdCount, skippedCount })
            }
            return next
        })
    }

    const handleBulkFormImagesSelected = (event) => {
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

        setError('')
        setBulkFormUploadNotice('')
        setBulkUploadMegaMode('keep')
        setBulkUploadGigantamaxMode('keep')
        setBulkUploadSelectedFiles(files)
        setBulkUploadQueueRows(buildBulkUploadQueueRows(files, 'keep', 'keep'))
        setBulkFormUploadProgress(0)
        setBulkFormUploadCount(files.length)
        setShowBulkUploadModal(true)
    }

    const startBulkFormUpload = async () => {
        if (bulkFormUploading || bulkUploadQueueRows.length === 0) return

        const preparedRows = bulkUploadQueueRows
            .filter((row) => row.status === 'pending')
            .map((row) => ({ ...row }))
        if (preparedRows.length === 0) return

        try {
            setError('')
            setBulkFormUploadNotice('')
            setBulkFormUploading(true)
            setBulkFormUploadProgress(0)
            setBulkFormUploadCount(preparedRows.length)

            const existingFormIds = new Set(
                forms
                    .map((entry) => normalizeFormId(entry?.formId).toLowerCase())
                    .filter(Boolean)
            )

            const uploadedItems = []
            let skippedBeforeUpload = 0
            let uploadFailed = 0

            let completedCount = 0
            const totalCount = preparedRows.length
            const uploadableRows = []
            const updateOverallProgress = () => {
                setBulkFormUploadProgress(Math.round((completedCount / totalCount) * 100))
            }

            preparedRows.forEach((row) => {
                const skipReasons = []
                if (bulkUploadMegaMode === 'keep' && !row.hasMegaKeyword) {
                    skipReasons.push('Ảnh không có Mega, bỏ qua theo chế độ Giữ Mega')
                }
                if (bulkUploadMegaMode === 'remove' && row.hasMegaKeyword) {
                    skipReasons.push('Ảnh có Mega, bỏ qua theo chế độ Bỏ Mega')
                }
                if (bulkUploadGigantamaxMode === 'keep' && !row.hasGigantamaxKeyword) {
                    skipReasons.push('Ảnh không có Gigantamax, bỏ qua theo chế độ Giữ Gigantamax')
                }
                if (bulkUploadGigantamaxMode === 'remove' && row.hasGigantamaxKeyword) {
                    skipReasons.push('Ảnh có Gigantamax, bỏ qua theo chế độ Bỏ Gigantamax')
                }

                if (skipReasons.length > 0) {
                    skippedBeforeUpload += 1
                    completedCount += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: skipReasons.join(' | '),
                    })
                    updateOverallProgress()
                    return
                }

                const normalizedFormId = normalizeFormId(row.inferredFormId).toLowerCase()

                if (!row.file) {
                    skippedBeforeUpload += 1
                    completedCount += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'error',
                        progress: 0,
                        message: 'Tệp ảnh không hợp lệ, vui lòng chọn lại',
                    })
                    updateOverallProgress()
                    return
                }

                if (!normalizedFormId) {
                    skippedBeforeUpload += 1
                    completedCount += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: 'Không đọc được formId từ tên file',
                    })
                    updateOverallProgress()
                    return
                }

                if (existingFormIds.has(normalizedFormId)) {
                    skippedBeforeUpload += 1
                    completedCount += 1
                    updateBulkUploadQueueRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: `Đã tồn tại formId ${normalizedFormId}, bỏ qua để tránh ghi đè`,
                    })
                    updateOverallProgress()
                    return
                }

                existingFormIds.add(normalizedFormId)
                uploadableRows.push({ ...row, normalizedFormId })
            })

            if (uploadableRows.length > 0) {
                let cursor = 0
                const workerCount = Math.min(BULK_UPLOAD_MAX_CONCURRENCY, uploadableRows.length)

                const workers = new Array(workerCount).fill(0).map(async () => {
                    while (true) {
                        const currentIndex = cursor
                        cursor += 1
                        if (currentIndex >= uploadableRows.length) break

                        const row = uploadableRows[currentIndex]
                        const normalizedFormId = row.normalizedFormId

                        updateBulkUploadQueueRow(row.queueId, {
                            status: 'uploading',
                            progress: 0,
                            message: `Đang upload: ${row.inferredFormName || normalizedFormId}`,
                        })

                        try {
                            let uploadedUrl = ''
                            let lastUploadError = null

                            for (let attempt = 1; attempt <= BULK_UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
                                if (attempt > 1) {
                                    updateBulkUploadQueueRow(row.queueId, {
                                        status: 'uploading',
                                        progress: 0,
                                        message: `Thử lại ${attempt}/${BULK_UPLOAD_RETRY_ATTEMPTS}: ${row.inferredFormName || normalizedFormId}`,
                                    })
                                }

                                try {
                                    const url = await uploadOneToCloudinary(row.file, (percentage) => {
                                        updateBulkUploadQueueRow(row.queueId, { progress: percentage })
                                    })
                                    uploadedUrl = url
                                    lastUploadError = null
                                    break
                                } catch (err) {
                                    lastUploadError = err
                                    const shouldRetry = attempt < BULK_UPLOAD_RETRY_ATTEMPTS && isRetryableUploadError(err)
                                    if (!shouldRetry) break

                                    const delayMs = BULK_UPLOAD_RETRY_BASE_DELAY_MS * attempt
                                    updateBulkUploadQueueRow(row.queueId, {
                                        status: 'uploading',
                                        progress: 0,
                                        message: `Mạng không ổn định, sẽ thử lại sau ${Math.ceil(delayMs / 1000)}s...`,
                                    })
                                    await waitForMs(delayMs)
                                }
                            }

                            if (!uploadedUrl) {
                                throw lastUploadError || new Error('Upload thất bại')
                            }

                            uploadedItems.push({
                                formId: normalizedFormId,
                                formName: row.inferredFormName,
                                url: uploadedUrl,
                            })
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
                            completedCount += 1
                            updateOverallProgress()
                        }
                    }
                })

                await Promise.all(workers)
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

    const openEvolutionTargetModal = (scope = { type: 'base', formIndex: null }) => {
        setEvolutionTargetSearchTerm('')
        setEvolutionTargetPage(1)
        setEvolutionTargetModalScope(scope)
        setShowEvolutionTargetModal(true)
    }

    const closeEvolutionTargetModal = () => {
        setShowEvolutionTargetModal(false)
        setEvolutionTargetModalScope({ type: 'base', formIndex: null })
    }

    const handlePickEvolutionTarget = (targetId, preferredTargetFormId = '') => {
        const target = allPokemon.find((entry) => String(entry?._id || '') === String(targetId || '')) || null
        const targetForms = Array.isArray(target?.forms) ? target.forms : []
        const normalizedPreferredFormId = String(preferredTargetFormId || '').trim().toLowerCase()
        const targetDefaultFormId = targetForms.length > 0
            ? String(target?.defaultFormId || targetForms[0]?.formId || '').trim().toLowerCase()
            : String(target?.defaultFormId || 'normal').trim().toLowerCase()
        const nextTargetFormId = normalizedPreferredFormId || targetDefaultFormId

        if (modalScopeIsForm && Number.isInteger(modalScopeFormIndex)) {
            updateForm(modalScopeFormIndex, {
                evolution: {
                    ...normalizeEvolutionState(forms[modalScopeFormIndex]?.evolution),
                    evolvesTo: String(targetId || '').trim(),
                    targetFormId: nextTargetFormId || '',
                },
            })
        } else {
            setFormData((prev) => ({
                ...prev,
                evolution: {
                    ...prev.evolution,
                    evolvesTo: String(targetId || '').trim(),
                    targetFormId: nextTargetFormId || '',
                },
            }))
        }
        closeEvolutionTargetModal()
    }

    const getFormEvolutionState = (form) => normalizeEvolutionState(form?.evolution)

    const updateFormEvolution = (formIndex, patch = {}) => {
        const currentEvolution = getFormEvolutionState(forms[formIndex])
        const nextEvolution = {
            ...currentEvolution,
            ...patch,
        }

        if (!nextEvolution.evolvesTo) {
            nextEvolution.targetFormId = ''
            nextEvolution.minLevel = ''
            nextEvolution.requiredItemId = ''
            nextEvolution.requiredItemQuantity = 1
        }

        updateForm(formIndex, { evolution: nextEvolution })
    }

    const renderFormEvolutionControls = (form, formIndex) => {
        const formEvolution = getFormEvolutionState(form)
        const targetPokemon = allPokemon.find(
            (entry) => String(entry?._id || '') === String(formEvolution?.evolvesTo || '')
        ) || null
        const targetForms = (() => {
            if (!targetPokemon) return []
            const rows = Array.isArray(targetPokemon.forms) ? targetPokemon.forms : []
            if (rows.length > 0) return rows
            const fallbackFormId = normalizeFormId(targetPokemon.defaultFormId || 'normal').toLowerCase() || 'normal'
            return [{ formId: fallbackFormId, formName: fallbackFormId }]
        })()

        return (
            <div className="mt-3 rounded border border-orange-200 bg-orange-50/70 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-orange-800 mb-2">Tiến hóa cho dạng này</div>
                <div className="flex flex-wrap gap-2 items-start">
                    <button
                        type="button"
                        onClick={() => openEvolutionTargetModal({ type: 'form', formIndex })}
                        className="px-2.5 py-1.5 bg-white border border-orange-200 rounded text-xs font-semibold hover:bg-orange-100"
                    >
                        {targetPokemon
                            ? `#${String(targetPokemon.pokedexNumber || 0).padStart(3, '0')} ${targetPokemon.name}${formEvolution.targetFormId ? ` (${formEvolution.targetFormId})` : ''}`
                            : 'Chọn Pokemon tiến hóa'}
                    </button>
                    <button
                        type="button"
                        onClick={() => updateFormEvolution(formIndex, { evolvesTo: '' })}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 rounded text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                        Không tiến hóa
                    </button>
                    <select
                        value={formEvolution.targetFormId || ''}
                        onChange={(event) => updateFormEvolution(formIndex, { targetFormId: event.target.value })}
                        className="px-2 py-1.5 bg-white border border-orange-200 rounded text-xs"
                        disabled={!formEvolution.evolvesTo}
                    >
                        <option value="">Dạng đích mặc định</option>
                        {targetForms.map((entry) => (
                            <option key={`form-evo-target-${formIndex}-${entry.formId}`} value={String(entry.formId || '').trim().toLowerCase()}>
                                {entry.formName || entry.formId}
                            </option>
                        ))}
                    </select>
                    <input
                        type="number"
                        min="1"
                        placeholder="Lv"
                        value={formEvolution.minLevel}
                        onChange={(event) => updateFormEvolution(formIndex, { minLevel: event.target.value })}
                        className="w-20 px-2 py-1.5 bg-white border border-orange-200 rounded text-xs"
                        disabled={!formEvolution.evolvesTo}
                    />
                    <select
                        value={formEvolution.requiredItemId || ''}
                        onChange={(event) => updateFormEvolution(formIndex, {
                            requiredItemId: event.target.value,
                            requiredItemQuantity: event.target.value
                                ? (Math.max(1, Number.parseInt(formEvolution.requiredItemQuantity, 10) || 1))
                                : 1,
                        })}
                        className="min-w-[190px] px-2 py-1.5 bg-white border border-orange-200 rounded text-xs"
                        disabled={!formEvolution.evolvesTo}
                    >
                        <option value="">Không cần item</option>
                        {availableEvolutionItems.map((item) => (
                            <option key={`form-evo-item-${formIndex}-${item._id}`} value={item._id}>
                                {item.name} ({String(item.evolutionRarityFrom || 'd').toUpperCase()}-{String(item.evolutionRarityTo || 'sss+').toUpperCase()})
                            </option>
                        ))}
                    </select>
                    <input
                        type="number"
                        min="1"
                        placeholder="SL"
                        value={formEvolution.requiredItemId ? (formEvolution.requiredItemQuantity || 1) : ''}
                        onChange={(event) => updateFormEvolution(formIndex, {
                            requiredItemQuantity: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                        })}
                        className="w-16 px-2 py-1.5 bg-white border border-orange-200 rounded text-xs text-center"
                        disabled={!formEvolution.evolvesTo || !formEvolution.requiredItemId}
                    />
                </div>
            </div>
        )
    }

    const availableEvolutionItems = evolutionItems.filter((item) => isEvolutionItemAllowedForRarity(item, formData.rarity))

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
                        <div id="bulk-form-quick-upload" className="mb-4 rounded border border-cyan-200 bg-cyan-50/60 p-3 scroll-mt-24">
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Upload nhanh nhiều ảnh dạng khác</label>
                            <p className="text-[11px] text-cyan-800 mb-2">
                                Chọn nhiều ảnh một lần, hệ thống sẽ tự tạo dạng mới theo tên file cho Pokemon hiện tại.
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
                                {bulkFormUploading ? `Đang up ${bulkFormUploadCount} ảnh...` : 'Chọn nhiều ảnh'}
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

                        <div className={`mb-4 rounded border px-3 py-2 text-xs ${hasDuplicateFormIds
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {hasDuplicateFormIds
                                ? (
                                    <div className="space-y-1">
                                        <p className="font-bold uppercase">Phát hiện dạng bị trùng</p>
                                        {duplicateFormIdEntries.map((entry) => (
                                            <p key={entry.formId}>
                                                Dạng <span className="font-bold">{entry.formId}</span> đang trùng ở dòng {entry.rowNumbers.join(', ')}
                                            </p>
                                        ))}
                                    </div>
                                )
                                : <p>Kiểm tra dạng: không có ID dạng nào bị trùng.</p>}
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

                                    {renderFormEvolutionControls(form, index)}
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
                                            max="100000"
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
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => openEvolutionTargetModal({ type: 'base', formIndex: null })}
                                        className="px-3 py-2 bg-white border border-orange-200 rounded text-sm font-semibold hover:bg-orange-50"
                                    >
                                        {selectedEvolutionTarget
                                            ? `#${String(selectedEvolutionTarget.pokedexNumber || 0).padStart(3, '0')} ${selectedEvolutionTarget.name}${formData.evolution.targetFormId ? ` (${formData.evolution.targetFormId})` : ''}`
                                            : '-- Chọn Pokémon --'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormData({
                                            ...formData,
                                            evolution: {
                                                ...formData.evolution,
                                                evolvesTo: '',
                                                targetFormId: '',
                                                minLevel: '',
                                                requiredItemId: '',
                                                requiredItemQuantity: 1,
                                            },
                                        })}
                                        className="px-3 py-2 bg-white border border-slate-300 rounded text-xs font-bold text-slate-600 hover:bg-slate-50"
                                    >
                                        Không tiến hóa
                                    </button>
                                </div>
                                {selectedEvolutionTarget && (
                                    <div className="mt-2 rounded border border-orange-200 bg-white px-3 py-2">
                                        <div className="text-xs font-semibold text-slate-700">
                                            Đã chọn: #{String(selectedEvolutionTarget.pokedexNumber || 0).padStart(3, '0')} {selectedEvolutionTarget.name}
                                        </div>
                                        {formData.evolution.targetFormId && (
                                            <div className="text-[11px] text-orange-700 font-semibold mt-1">
                                                Dạng đích: {formData.evolution.targetFormId}
                                            </div>
                                        )}
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {(Array.isArray(selectedEvolutionTarget.forms) ? selectedEvolutionTarget.forms : [])
                                                .slice(0, 8)
                                                .map((form) => (
                                                    <span
                                                        key={`${selectedEvolutionTarget._id}-${form.formId}`}
                                                        className="px-1.5 py-0.5 rounded border border-orange-200 bg-orange-50 text-[10px] font-semibold text-orange-700"
                                                    >
                                                        {form.formName || form.formId}
                                                    </span>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="w-32">
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Dạng đích</label>
                                <select
                                    value={formData.evolution.targetFormId || ''}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        evolution: {
                                            ...formData.evolution,
                                            targetFormId: e.target.value,
                                        },
                                    })}
                                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                                    disabled={!formData.evolution.evolvesTo}
                                >
                                    <option value="">Mặc định</option>
                                    {selectedEvolutionTargetForms.map((form) => (
                                        <option key={`target-form-${form.formId}`} value={String(form.formId || '').trim().toLowerCase()}>
                                            {form.formName || form.formId}
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
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_120px] gap-4">
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Vật phẩm tiến hóa</label>
                                <select
                                    value={formData.evolution.requiredItemId || ''}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        evolution: {
                                            ...formData.evolution,
                                            requiredItemId: e.target.value,
                                            requiredItemQuantity: e.target.value
                                                ? (Math.max(1, Number.parseInt(formData.evolution.requiredItemQuantity, 10) || 1))
                                                : 1,
                                        },
                                    })}
                                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                                    disabled={!formData.evolution.evolvesTo}
                                >
                                    <option value="">-- Không cần vật phẩm --</option>
                                    {availableEvolutionItems.map((item) => (
                                        <option key={item._id} value={item._id}>
                                            {item.name} ({String(item.evolutionRarityFrom || 'd').toUpperCase()}-{String(item.evolutionRarityTo || 'sss+').toUpperCase()})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Số lượng</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="SL"
                                    value={formData.evolution.requiredItemId ? (formData.evolution.requiredItemQuantity || 1) : ''}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        evolution: {
                                            ...formData.evolution,
                                            requiredItemQuantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                                        },
                                    })}
                                    className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                                    disabled={!formData.evolution.evolvesTo || !formData.evolution.requiredItemId}
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
                            disabled={loading || hasDuplicateFormIds}
                            className={`flex-1 py-3 text-white rounded-lg text-sm font-bold shadow-md transform transition-all active:scale-[0.98] ${loading || hasDuplicateFormIds
                                ? 'bg-slate-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'}`}
                        >
                            {loading ? 'Đang Xử Lý...' : hasDuplicateFormIds ? 'SỬA DẠNG TRÙNG ĐỂ TIẾP TỤC' : isEdit ? 'LƯU THAY ĐỔI' : 'TẠO POKEMON MỚI'}
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

            {showEvolutionTargetModal && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={closeEvolutionTargetModal}
                >
                    <div
                        className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-lg border border-orange-200 bg-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-orange-100 bg-orange-50">
                            <div>
                                <h3 className="text-base font-bold text-orange-900">Chọn Pokémon</h3>
                                <p className="text-xs text-orange-700">
                                    {modalScopeIsForm
                                        ? `Áp dụng cho dạng: ${modalScopeForm?.formName || modalScopeForm?.formId || 'form'}`
                                        : 'Áp dụng cho tiến hóa chính của Pokémon'}
                                    {' '}.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEvolutionTargetModal}
                                className="text-slate-400 hover:text-slate-700"
                            >
                                X
                            </button>
                        </div>

                        <div className="p-4 border-b border-orange-100 bg-white">
                            <input
                                type="text"
                                value={evolutionTargetSearchTerm}
                                onChange={(event) => {
                                    setEvolutionTargetSearchTerm(event.target.value)
                                    setEvolutionTargetPage(1)
                                }}
                                placeholder="Tìm theo tên, số Pokédex, formId, formName..."
                                className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm"
                            />
                            <div className="mt-2 text-xs text-slate-600">
                                Kết quả: {evolutionTargetTotal} Pokémon
                            </div>
                        </div>

                        <div className="p-4 overflow-y-auto max-h-[60vh]">
                            {evolutionTargetPageRows.length === 0 ? (
                                <div className="text-sm text-slate-500 text-center py-10">Không tìm thấy Pokémon phù hợp.</div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {evolutionTargetPageRows.map((target) => {
                                        const forms = Array.isArray(target.forms) ? target.forms : []
                                        const defaultForm = forms.find((entry) => String(entry?.formId || '').trim() === String(target.defaultFormId || '').trim()) || forms[0] || null
                                        const imageUrl = String(defaultForm?.imageUrl || target.imageUrl || '').trim()
                                        const isSelected = String(target._id || '') === String(scopedEvolution?.evolvesTo || '')

                                        return (
                                            <div
                                                key={target._id}
                                                className={`text-left rounded border p-3 transition-colors ${isSelected
                                                    ? 'border-orange-500 bg-orange-50'
                                                    : 'border-slate-200 bg-white hover:border-orange-300 hover:bg-orange-50/40'}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="w-14 h-14 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                        {imageUrl
                                                            ? <img src={imageUrl} alt={target.name} className="w-12 h-12 object-contain pixelated" />
                                                            : <span className="text-slate-300 text-xs">?</span>}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs text-slate-500">#{String(target.pokedexNumber || 0).padStart(3, '0')}</div>
                                                        <div className="text-sm font-bold text-slate-800 truncate">{target.name}</div>
                                                        {isSelected && <div className="text-[10px] font-bold text-orange-700 mt-1">Đang chọn</div>}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePickEvolutionTarget(target._id)}
                                                    className="mt-2 w-full px-2 py-1.5 rounded border border-orange-300 bg-white text-[11px] font-bold text-orange-700 hover:bg-orange-100"
                                                >
                                                    Chọn theo dạng mặc định
                                                </button>
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {forms.slice(0, 6).map((form) => {
                                                        const normalizedFormId = String(form?.formId || '').trim().toLowerCase()
                                                        const isSelectedForm = isSelected && String(scopedEvolution?.targetFormId || '').trim().toLowerCase() === normalizedFormId
                                                        return (
                                                        <button
                                                            key={`${target._id}-${form.formId}`}
                                                            type="button"
                                                            onClick={() => handlePickEvolutionTarget(target._id, normalizedFormId)}
                                                            className={`px-1.5 py-0.5 rounded border text-[10px] ${isSelectedForm
                                                                ? 'border-orange-400 bg-orange-100 text-orange-800 font-bold'
                                                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-orange-100 hover:border-orange-300'}`}
                                                        >
                                                            {form.formName || form.formId}
                                                        </button>
                                                    )})}
                                                    {forms.length > 6 && (
                                                        <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                                                            +{forms.length - 6} dạng
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="px-4 py-3 border-t border-orange-100 bg-orange-50 flex items-center justify-between">
                            <div className="text-xs text-slate-600">
                                Trang {resolvedEvolutionTargetPage} / {evolutionTargetTotalPages}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEvolutionTargetPage((prev) => Math.max(1, prev - 1))}
                                    disabled={resolvedEvolutionTargetPage <= 1}
                                    className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Trước
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEvolutionTargetPage((prev) => Math.min(evolutionTargetTotalPages, prev + 1))}
                                    disabled={resolvedEvolutionTargetPage >= evolutionTargetTotalPages}
                                    className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Sau
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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

                        <input
                            id="bulk-form-image-upload-modal"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleBulkFormImagesSelected}
                            className="hidden"
                            disabled={bulkFormUploading}
                        />
                        <div className="mb-4 flex justify-end">
                            <label
                                htmlFor="bulk-form-image-upload-modal"
                                className={`px-3 py-1.5 rounded border text-xs font-bold whitespace-nowrap transition-colors ${bulkFormUploading
                                    ? 'bg-cyan-100 border-cyan-200 text-cyan-700 cursor-wait'
                                    : 'bg-white border-cyan-300 text-cyan-700 hover:bg-cyan-100 cursor-pointer'}`}
                            >
                                {bulkFormUploading ? 'Đang tải lên...' : 'Chọn ảnh form'}
                            </label>
                        </div>

                        <div className="mb-4 rounded border border-cyan-200 bg-cyan-50 p-3">
                            <div className="flex items-center justify-between text-xs font-semibold text-cyan-900 mb-2">
                                <span>
                                    {bulkFormUploading
                                        ? `Đang upload tối đa ${BULK_UPLOAD_MAX_CONCURRENCY} ảnh song song (${bulkFormUploadCount} ảnh trong hàng xử lý)...`
                                        : hasPendingBulkQueueRows
                                            ? `Đã nạp ${bulkUploadQueueRows.length} ảnh, chờ bạn xác nhận để upload.`
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

                        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-bold text-slate-700 uppercase mb-2">Tùy chọn Mega trước khi upload</div>
                            <div className="flex flex-wrap gap-2 mb-2">
                                <button
                                    type="button"
                                    onClick={() => handleBulkMegaModeChange('keep')}
                                    disabled={bulkFormUploading || !hasPendingBulkQueueRows}
                                    className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors ${bulkUploadMegaMode === 'keep'
                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    Giữ Mega
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleBulkMegaModeChange('remove')}
                                    disabled={bulkFormUploading || !hasPendingBulkQueueRows}
                                    className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors ${bulkUploadMegaMode === 'remove'
                                        ? 'bg-amber-100 text-amber-700 border-amber-300'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    Bỏ Mega
                                </button>
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-200">
                                <div className="text-xs font-bold text-slate-700 uppercase mb-2">Tùy chọn Gigantamax</div>
                                <div className="flex flex-wrap gap-4">
                                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={bulkUploadGigantamaxMode === 'keep'}
                                            onChange={() => handleBulkGigantamaxModeChange('keep')}
                                            disabled={bulkFormUploading || !hasPendingBulkQueueRows}
                                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                                        />
                                        Giữ Gigantamax
                                    </label>
                                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={bulkUploadGigantamaxMode === 'remove'}
                                            onChange={() => handleBulkGigantamaxModeChange('remove')}
                                            disabled={bulkFormUploading || !hasPendingBulkQueueRows}
                                            className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 disabled:opacity-50"
                                        />
                                        Bỏ Gigantamax
                                    </label>
                                </div>
                            </div>
                            <p className="text-[11px] text-slate-600">
                                Có {bulkMegaFileCount} ảnh chứa Mega và {bulkGigantamaxFileCount} ảnh chứa Gigantamax.
                                Giữ/Bỏ Mega lọc theo từ khóa Mega; Giữ/Bỏ Gigantamax lọc theo từ khóa Gigantamax.
                            </p>
                            <p className="text-[11px] text-slate-600 mt-1">
                                Nếu lỗi mạng tạm thời, mỗi ảnh sẽ tự thử lại tối đa {BULK_UPLOAD_RETRY_ATTEMPTS} lần trước khi báo lỗi.
                            </p>
                            <p className="text-[11px] text-slate-600 mt-1">
                                Để tăng tốc, hệ thống upload song song tối đa {BULK_UPLOAD_MAX_CONCURRENCY} ảnh/lượt nhưng vẫn giữ rule không ghi đè formId đã có.
                            </p>
                        </div>

                        <div className="max-h-[52vh] overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
                            <div className="hidden sm:grid sm:grid-cols-12 px-4 py-2 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                <div className="sm:col-span-5">Tệp</div>
                                <div className="sm:col-span-3">Preview giữ Mega</div>
                                <div className="sm:col-span-3">Preview bỏ Mega</div>
                                <div className="sm:col-span-1 text-right">Trạng thái</div>
                            </div>
                            {bulkUploadQueueRows.length === 0 ? (
                                <div className="px-4 py-6 text-sm text-slate-500 text-center">Chưa có ảnh nào trong hàng đợi upload.</div>
                            ) : (
                                bulkUploadQueueRows.map((row, index) => {
                                    const statusMeta = BULK_UPLOAD_STATUS_META[row.status] || BULK_UPLOAD_STATUS_META.pending
                                    const keepPreviewLabel = formatFormPreviewLabel(row.inferredKeepFormId, row.inferredKeepFormName)
                                    const removePreviewLabel = formatFormPreviewLabel(row.inferredRemoveFormId, row.inferredRemoveFormName)
                                    const isKeepActive = bulkUploadMegaMode === 'keep'
                                    const isRemoveActive = bulkUploadMegaMode === 'remove'
                                    return (
                                        <div
                                            key={row.queueId}
                                            className={`px-4 py-3 bg-white ${row.isMegaModeAffecting && hasPendingBulkQueueRows ? 'border-l-4 border-l-amber-300' : ''}`}
                                        >
                                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3">
                                                <div className="sm:col-span-5 min-w-0">
                                                    <div className="text-sm font-semibold text-slate-800 truncate">{index + 1}. {row.fileName}</div>
                                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                                        Dạng đang áp dụng: {formatFormPreviewLabel(row.inferredFormId, row.inferredFormName)}
                                                    </div>
                                                    {row.message && (
                                                        <div className={`text-[11px] mt-1 ${row.isMegaModeAffecting ? 'text-amber-700 font-semibold' : 'text-slate-600'}`}>
                                                            {row.message}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className={`sm:col-span-3 text-[11px] rounded border px-2 py-1.5 ${isKeepActive
                                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold'
                                                    : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                                    {keepPreviewLabel}
                                                </div>

                                                <div className={`sm:col-span-3 text-[11px] rounded border px-2 py-1.5 ${isRemoveActive
                                                    ? 'border-amber-300 bg-amber-50 text-amber-700 font-semibold'
                                                    : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                                                    {removePreviewLabel}
                                                </div>

                                                <div className="sm:col-span-1 sm:text-right">
                                                    <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${statusMeta.badgeClass}`}>
                                                        {statusMeta.label}
                                                    </span>
                                                </div>
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
                                onClick={retryFailedBulkRows}
                                disabled={bulkFormUploading || !hasFailedBulkQueueRows}
                                className="mr-2 px-4 py-2 bg-white border border-red-300 rounded text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Retry ảnh lỗi
                            </button>
                            <button
                                type="button"
                                onClick={startBulkFormUpload}
                                disabled={bulkFormUploading || !hasPendingBulkQueueRows}
                                className="mr-2 px-4 py-2 bg-cyan-600 border border-cyan-600 rounded text-sm font-bold text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {bulkFormUploading ? 'Đang upload...' : (hasPendingBulkQueueRows ? 'Bắt đầu upload' : 'Đã upload xong')}
                            </button>
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
