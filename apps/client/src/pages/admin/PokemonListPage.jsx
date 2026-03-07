import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { pokemonApi } from '../../services/adminApi'
import { parseEvolutionImportCsv } from '../../utils/evolutionImport'
import { parsePokemonCsvImport } from '../../utils/pokemonCsvImport'
import { uploadToCloudinary, validateImageFile } from '../../utils/cloudinaryUtils'

const TYPE_COLORS = {
    normal: 'bg-gray-500',
    fire: 'bg-red-500',
    water: 'bg-blue-500',
    grass: 'bg-green-500',
    electric: 'bg-yellow-500',
    ice: 'bg-cyan-400',
    fighting: 'bg-orange-600',
    poison: 'bg-purple-600',
    ground: 'bg-amber-700',
    flying: 'bg-indigo-400',
    psychic: 'bg-pink-500',
    bug: 'bg-lime-600',
    rock: 'bg-stone-600',
    ghost: 'bg-violet-700',
    dragon: 'bg-indigo-700',
    dark: 'bg-gray-800',
    steel: 'bg-slate-500',
    fairy: 'bg-pink-400',
}

const QUICK_FORM_UPLOAD_MAX_CONCURRENCY = 3
const QUICK_FORM_UPLOAD_RETRY_ATTEMPTS = 3
const QUICK_FORM_UPLOAD_RETRY_BASE_DELAY_MS = 700
const QUICK_FORM_UPLOAD_STATUS_META = {
    pending: {
        label: 'Chờ xử lý',
        badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
    },
    uploading: {
        label: 'Đang tải lên',
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

export default function PokemonListPage() {
    const [pokemon, setPokemon] = useState([])
    const [allPokemon, setAllPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [evolutionEdits, setEvolutionEdits] = useState({})
    const [dirtyEvolutionKeys, setDirtyEvolutionKeys] = useState(() => new Set())
    const [savingId, setSavingId] = useState('')
    const [expandedIds, setExpandedIds] = useState(() => new Set())
    const [evolutionImportText, setEvolutionImportText] = useState('')
    const [evolutionImporting, setEvolutionImporting] = useState(false)
    const [evolutionImportReport, setEvolutionImportReport] = useState(null)
    const [pokemonCsvImportText, setPokemonCsvImportText] = useState('')
    const [pokemonCsvImporting, setPokemonCsvImporting] = useState(false)
    const [pokemonCsvImportReport, setPokemonCsvImportReport] = useState(null)
    const [uploadingImageKey, setUploadingImageKey] = useState('')
    const [showQuickFormUploadModal, setShowQuickFormUploadModal] = useState(false)
    const [quickFormUploadPokemon, setQuickFormUploadPokemon] = useState(null)
    const [quickFormUploadMegaMode, setQuickFormUploadMegaMode] = useState('keep')
    const [quickFormUploadRows, setQuickFormUploadRows] = useState([])
    const [quickFormUploadSelectedFiles, setQuickFormUploadSelectedFiles] = useState([])
    const [quickFormUploading, setQuickFormUploading] = useState(false)
    const [quickFormUploadProgress, setQuickFormUploadProgress] = useState(0)
    const [quickFormUploadCount, setQuickFormUploadCount] = useState(0)
    const [quickFormUploadNotice, setQuickFormUploadNotice] = useState('')

    // Scroll Sync
    const tableContainerRef = useRef(null)
    const topScrollRef = useRef(null)
    const evolutionImportFileRef = useRef(null)
    const pokemonCsvImportFileRef = useRef(null)

    // Filters
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })

    useEffect(() => {
        loadPokemon()
    }, [search, typeFilter, page])

    useEffect(() => {
        loadAllPokemon()
    }, [])

    // Sync Top Scrollbar
    useEffect(() => {
        const table = tableContainerRef.current
        const top = topScrollRef.current

        if (!table || !top) return

        const handleTableScroll = () => {
            if (top.scrollLeft !== table.scrollLeft) {
                top.scrollLeft = table.scrollLeft
            }
        }

        const handleTopScroll = () => {
            if (table.scrollLeft !== top.scrollLeft) {
                table.scrollLeft = top.scrollLeft
            }
        }

        table.addEventListener('scroll', handleTableScroll)
        top.addEventListener('scroll', handleTopScroll)

        return () => {
            table.removeEventListener('scroll', handleTableScroll)
            top.removeEventListener('scroll', handleTopScroll)
        }
    }, [pokemon])

    const loadPokemon = async () => {
        try {
            setLoading(true)
            const data = await pokemonApi.list({ search, type: typeFilter, page, limit: 20 })
            setPokemon(data.pokemon)
            setPagination(data.pagination)
            setEvolutionEdits(() => {
                const next = {}
                data.pokemon.forEach((p) => {
                    // Main Pokemon evolution
                    const evolvesTo = typeof p.evolution?.evolvesTo === 'string'
                        ? p.evolution.evolvesTo
                        : p.evolution?.evolvesTo?._id || ''
                    const minLevel = p.evolution?.minLevel ?? ''
                    next[p._id] = { evolvesTo, minLevel: minLevel === null ? '' : minLevel }

                    // Form evolutions
                    if (Array.isArray(p.forms)) {
                        p.forms.forEach(form => {
                            const formEvolvesTo = typeof form.evolution?.evolvesTo === 'string'
                                ? form.evolution.evolvesTo
                                : form.evolution?.evolvesTo?._id || ''
                            const formMinLevel = form.evolution?.minLevel ?? ''
                            next[`${p._id}_${form.formId}`] = { evolvesTo: formEvolvesTo, minLevel: formMinLevel === null ? '' : formMinLevel }
                        })
                    }
                })
                return next
            })
            setDirtyEvolutionKeys(new Set())
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadAllPokemon = async () => {
        try {
            const limit = 100
            let pageCursor = 1
            let totalPages = 1
            const collected = []

            do {
                const data = await pokemonApi.list({ page: pageCursor, limit })
                if (Array.isArray(data?.pokemon) && data.pokemon.length > 0) {
                    collected.push(...data.pokemon)
                }

                const parsedPages = Number.parseInt(data?.pagination?.pages, 10)
                totalPages = Number.isFinite(parsedPages) && parsedPages > 0 ? parsedPages : 1
                pageCursor += 1
            } while (pageCursor <= totalPages)

            const uniqueById = new Map()
            collected.forEach((entry) => {
                if (!entry?._id || uniqueById.has(entry._id)) return
                uniqueById.set(entry._id, entry)
            })

            setAllPokemon([...uniqueById.values()])
        } catch (err) {
            setError(err.message)
        }
    }

    const updateEvolutionEdit = (id, patch) => {
        setEvolutionEdits((prev) => ({
            ...prev,
            [id]: { ...prev[id], ...patch },
        }))
        setDirtyEvolutionKeys((prev) => {
            const next = new Set(prev)
            next.add(id)
            return next
        })
    }

    const handlePokemonCsvFileChange = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        try {
            const text = await file.text()
            setPokemonCsvImportText(text)
            setError('')
        } catch (err) {
            setError(`Doc file CSV Pokemon that bai: ${err.message}`)
        }
    }

    const handleApplyPokemonCsvImport = async () => {
        if (!pokemonCsvImportText.trim()) {
            setError('Vui long dan du lieu CSV Pokemon truoc khi import.')
            return
        }

        const parsed = parsePokemonCsvImport(pokemonCsvImportText, allPokemon)
        setPokemonCsvImportReport(parsed.report)

        if (!Array.isArray(parsed.pokemon) || parsed.pokemon.length === 0) {
            setError('Khong co Pokemon hop le de import.')
            return
        }

        if (parsed.pokemon.length > 500) {
            setError(`So Pokemon hop le qua lon (${parsed.pokemon.length}). Toi da 500 moi lan import.`)
            return
        }

        try {
            setPokemonCsvImporting(true)
            setError('')

            const result = await pokemonApi.importPokemonCsv(parsed.pokemon)

            setPokemonCsvImportReport((prev) => {
                const base = prev || parsed.report
                return {
                    ...base,
                    requestedCount: result?.requestedCount || parsed.pokemon.length,
                    createdCount: result?.createdCount || 0,
                    skippedCount: result?.skippedCount || 0,
                    errorCount: result?.errorCount || 0,
                    serverErrors: Array.isArray(result?.errors) ? result.errors : [],
                    hiddenServerErrorCount: result?.hiddenErrorCount || 0,
                }
            })

            await loadAllPokemon()
            await loadPokemon()

            const createdCount = Number.parseInt(result?.createdCount, 10) || 0
            const errorCount = Number.parseInt(result?.errorCount, 10) || 0
            if (createdCount === 0 && errorCount > 0) {
                setError(`Import hoan tat nhung khong tao duoc Pokemon nao (${errorCount} loi).`)
            }
        } catch (err) {
            setError(`Import Pokemon CSV that bai: ${err.message}`)
        } finally {
            setPokemonCsvImporting(false)
        }
    }

    const parseEvolutionEditKey = (key) => {
        const separatorIndex = key.indexOf('_')
        if (separatorIndex === -1) {
            return { pokemonId: key, formId: null }
        }

        return {
            pokemonId: key.slice(0, separatorIndex),
            formId: key.slice(separatorIndex + 1) || null,
        }
    }

    const handleSaveEvolution = async (p, formId = null) => {
        const key = formId ? `${p._id}_${formId}` : p._id
        const edit = evolutionEdits[key] || { evolvesTo: '', minLevel: '' }
        const evolvesToValue = edit.evolvesTo || null
        const minLevelValue = evolvesToValue ? (parseInt(edit.minLevel) || null) : null

        try {
            setSavingId(key)
            setError('')

            let payload
            if (formId) {
                if (!Array.isArray(p.forms) || p.forms.length === 0) {
                    throw new Error("Không tìm thấy dữ liệu các dạng của Pokemon này.")
                }
                // Updating a specific form
                const forms = p.forms.map(f => {
                    if (f.formId === formId) {
                        return {
                            ...f,
                            evolution: {
                                ...f.evolution,
                                evolvesTo: evolvesToValue,
                                minLevel: minLevelValue,
                            }
                        }
                    }
                    return f
                })
                payload = { forms }
            } else {
                // Updating main Pokemon
                payload = {
                    evolution: {
                        evolvesTo: evolvesToValue,
                        minLevel: minLevelValue,
                    },
                }
            }

            const result = await pokemonApi.update(p._id, payload)
            const updatedPokemon = result?.pokemon

            if (updatedPokemon?._id) {
                setPokemon((prev) => prev.map((entry) => (
                    entry._id === updatedPokemon._id ? updatedPokemon : entry
                )))
            }

            setDirtyEvolutionKeys((prev) => {
                const next = new Set(prev)
                next.delete(key)
                return next
            })
        } catch (err) {
            setError(`Lưu tiến hóa thất bại: ${err.message}`)
        } finally {
            setSavingId('')
        }
    }

    const handleSaveAllEvolution = async () => {
        const keys = [...dirtyEvolutionKeys]
        if (keys.length === 0) return

        const updates = keys.map((key) => {
            const { pokemonId, formId } = parseEvolutionEditKey(key)
            const edit = evolutionEdits[key] || { evolvesTo: '', minLevel: '' }
            const evolvesToValue = edit.evolvesTo || null
            const minLevelValue = evolvesToValue ? (parseInt(edit.minLevel, 10) || null) : null

            return {
                pokemonId,
                formId: formId || undefined,
                evolvesTo: evolvesToValue,
                minLevel: minLevelValue,
            }
        })

        try {
            setSavingId('__bulk__')
            setError('')

            const result = await pokemonApi.bulkUpdateEvolutions(updates)
            const updatedPokemon = Array.isArray(result?.pokemon) ? result.pokemon : []
            const updatedById = new Map(updatedPokemon.map((entry) => [entry._id, entry]))

            if (updatedById.size > 0) {
                setPokemon((prev) => prev.map((entry) => updatedById.get(entry._id) || entry))
            }

            setDirtyEvolutionKeys(new Set())
        } catch (err) {
            setError(`Lưu nhanh tiến hóa thất bại: ${err.message}`)
        } finally {
            setSavingId('')
        }
    }

    const handleEvolutionImportFileChange = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return

        try {
            const text = await file.text()
            setEvolutionImportText(text)
            setError('')
        } catch (err) {
            setError(`Doc file import that bai: ${err.message}`)
        }
    }

    const handleApplyEvolutionImport = async () => {
        if (!evolutionImportText.trim()) {
            setError('Vui long dan du lieu CSV/TXT truoc khi import.')
            return
        }

        if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
            setError('Danh sach Pokemon chua tai xong. Vui long thu lai.')
            return
        }

        const parsed = parseEvolutionImportCsv(evolutionImportText, allPokemon)
        setEvolutionImportReport(parsed.report)

        if (parsed.updates.length === 0) {
            setError('Khong tao duoc quy tac tien hoa nao tu du lieu import.')
            return
        }

        if (parsed.updates.length > 500) {
            setError(`So cap nhat qua lon (${parsed.updates.length}). Toi da 500 quy tac moi lan.`)
            return
        }

        try {
            setEvolutionImporting(true)
            setError('')

            const result = await pokemonApi.bulkUpdateEvolutions(parsed.updates)
            const updatedPokemon = Array.isArray(result?.pokemon) ? result.pokemon : []
            const updatedById = new Map(updatedPokemon.map((entry) => [entry._id, entry]))

            if (updatedById.size > 0) {
                setPokemon((prev) => prev.map((entry) => updatedById.get(entry._id) || entry))
                setAllPokemon((prev) => prev.map((entry) => updatedById.get(entry._id) || entry))
            }

            setDirtyEvolutionKeys(new Set())
            await loadPokemon()
            setEvolutionImportReport((prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    savedCount: result?.updatedCount || parsed.updates.length,
                }
            })
        } catch (err) {
            setError(`Import tien hoa that bai: ${err.message}`)
        } finally {
            setEvolutionImporting(false)
        }
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi vật phẩm này.`)) return

        try {
            await pokemonApi.delete(id)
            loadPokemon()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
    const normalizeOptionalFormId = (value = '') => String(value || '').trim().toLowerCase()
    const normalizeFormName = (value = '') => String(value || '').trim()

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

    const findPokemonSuffixTokenLength = (stemTokens = [], pokemonName = '') => {
        if (!Array.isArray(stemTokens) || stemTokens.length === 0) return 0
        const nameTokens = splitStemTokens(pokemonName)
        if (nameTokens.length === 0 || nameTokens.length > stemTokens.length) return 0

        const sourceTail = stemTokens.slice(stemTokens.length - nameTokens.length)
        const isTailMatched = nameTokens.every((token, index) => token === sourceTail[index])
        return isTailMatched ? nameTokens.length : 0
    }

    const inferFormFromFileName = (fileName = '', pokemonName = '') => {
        const stemRaw = String(fileName || '').replace(/\.[^.]+$/, '').trim()
        if (!stemRaw) return { formId: '', formName: '' }

        const stemTokens = stripTrailingArtifactTokens(splitStemTokens(stemRaw))
        if (stemTokens.length === 0) return { formId: '', formName: '' }

        const suffixLength = findPokemonSuffixTokenLength(stemTokens, pokemonName)
        const normalizedTokens = suffixLength > 0
            ? stemTokens.slice(0, stemTokens.length - suffixLength)
            : stemTokens
        const effectiveTokens = normalizedTokens

        if (effectiveTokens.length === 0) return { formId: 'normal', formName: 'Normal' }
        return {
            formId: effectiveTokens.join('-'),
            formName: toTitleCaseFromTokens(effectiveTokens),
        }
    }

    const formatFormPreviewLabel = (formId = '', formName = '') => {
        const normalizedId = normalizeOptionalFormId(formId)
        const normalizedName = normalizeFormName(formName)
        if (!normalizedId && !normalizedName) return 'Không xác định'
        if (!normalizedId) return normalizedName
        if (!normalizedName) return normalizedId
        return `${normalizedName} (${normalizedId})`
    }

    const getPokemonForms = (pokemonEntry) => {
        if (Array.isArray(pokemonEntry?.forms) && pokemonEntry.forms.length > 0) {
            return pokemonEntry.forms
        }

        return [{
            formId: pokemonEntry?.defaultFormId || 'normal',
            formName: pokemonEntry?.defaultFormId || 'normal',
            imageUrl: pokemonEntry?.imageUrl || '',
            sprites: {},
            stats: {},
        }]
    }

    const replacePokemonInLocalState = (updatedPokemon) => {
        if (!updatedPokemon?._id) return
        setPokemon((prev) => prev.map((entry) => (entry._id === updatedPokemon._id ? updatedPokemon : entry)))
        setAllPokemon((prev) => prev.map((entry) => (entry._id === updatedPokemon._id ? updatedPokemon : entry)))
    }

    const hasPendingQuickFormRows = quickFormUploadRows.some((row) => row.status === 'pending')
    const hasFailedQuickFormRows = quickFormUploadRows.some((row) => row.status === 'error')
    const quickMegaFileCount = quickFormUploadRows.filter((row) => row.hasMegaKeyword).length

    const buildQuickFormUploadRows = (files = [], megaMode = 'keep', pokemonEntry = null) => {
        const list = Array.isArray(files) ? files : []
        const keepMega = megaMode === 'keep'
        const pokemonName = String(pokemonEntry?.name || '').trim()

        return list.map((file, index) => {
            const safeFileName = String(file?.name || '').trim()
            const inferredBase = inferFormFromFileName(safeFileName, pokemonName)
            const baseFormId = normalizeOptionalFormId(inferredBase.formId)
            const baseFormName = normalizeFormName(inferredBase.formName) || baseFormId
            const stemTokens = splitStemTokens(safeFileName.replace(/\.[^.]+$/, ''))
            const hasMegaKeyword = stemTokens.includes('mega')
            const keepFormId = hasMegaKeyword ? baseFormId : ''
            const keepFormName = hasMegaKeyword ? baseFormName : 'Bỏ qua (không có Mega)'
            const removeFormId = hasMegaKeyword ? '' : baseFormId
            const removeFormName = hasMegaKeyword ? 'Bỏ qua (có Mega)' : baseFormName
            const appliedFormId = keepMega ? keepFormId : removeFormId
            const appliedFormName = keepMega ? keepFormName : removeFormName
            const megaSkipReason = keepMega
                ? (hasMegaKeyword ? '' : 'Ảnh không có Mega, bỏ qua theo chế độ Giữ Mega')
                : (hasMegaKeyword ? 'Ảnh có Mega, bỏ qua theo chế độ Bỏ Mega' : '')
            const isMegaModeAffecting = keepFormId !== removeFormId || keepFormName !== removeFormName

            return {
                queueId: `${Date.now()}-${index}-${safeFileName || 'unnamed-file'}`,
                file,
                fileName: safeFileName || `file-${index + 1}`,
                keepFormId,
                keepFormName,
                removeFormId,
                removeFormName,
                appliedFormId,
                appliedFormName,
                hasMegaKeyword,
                isMegaModeAffecting,
                megaSkipReason,
                status: 'pending',
                progress: 0,
                message: megaSkipReason || (keepMega ? 'Ảnh có Mega: sẽ giữ lại để tải lên' : 'Ảnh không có Mega: sẽ giữ lại để tải lên'),
            }
        })
    }

    const updateQuickFormUploadRow = (queueId, patch = {}) => {
        setQuickFormUploadRows((prev) => prev.map((row) => (row.queueId === queueId ? { ...row, ...patch } : row)))
    }

    const openQuickFormUploadModal = (pokemonEntry) => {
        if (!pokemonEntry?._id || quickFormUploading) return
        setQuickFormUploadPokemon(pokemonEntry)
        setQuickFormUploadMegaMode('keep')
        setQuickFormUploadSelectedFiles([])
        setQuickFormUploadRows([])
        setQuickFormUploadProgress(0)
        setQuickFormUploadCount(0)
        setQuickFormUploadNotice('')
        setShowQuickFormUploadModal(true)
        setError('')
    }

    const closeQuickFormUploadModal = (force = false) => {
        if (!force && quickFormUploading) return
        setShowQuickFormUploadModal(false)
        setQuickFormUploadPokemon(null)
        setQuickFormUploadMegaMode('keep')
        setQuickFormUploadSelectedFiles([])
        setQuickFormUploadRows([])
        setQuickFormUploadProgress(0)
        setQuickFormUploadCount(0)
        setQuickFormUploadNotice('')
    }

    const handleQuickFormFilesSelected = (event) => {
        const files = Array.from(event.target.files || [])
        event.target.value = ''
        if (files.length === 0 || !quickFormUploadPokemon) return

        for (const file of files) {
            const validationError = validateImageFile(file)
            if (validationError) {
                setError(`Ảnh "${file.name}" không hợp lệ: ${validationError}`)
                return
            }
        }

        setError('')
        setQuickFormUploadNotice('')
        setQuickFormUploadSelectedFiles(files)
        setQuickFormUploadMegaMode('keep')
        setQuickFormUploadRows(buildQuickFormUploadRows(files, 'keep', quickFormUploadPokemon))
        setQuickFormUploadProgress(0)
        setQuickFormUploadCount(files.length)
    }

    const handleQuickFormMegaModeChange = (mode) => {
        if (quickFormUploading || !quickFormUploadPokemon || quickFormUploadSelectedFiles.length === 0 || !hasPendingQuickFormRows) return
        const normalizedMode = mode === 'remove' ? 'remove' : 'keep'
        setQuickFormUploadMegaMode(normalizedMode)
        setQuickFormUploadRows(buildQuickFormUploadRows(quickFormUploadSelectedFiles, normalizedMode, quickFormUploadPokemon))
    }

    const retryFailedQuickFormRows = () => {
        if (quickFormUploading || !hasFailedQuickFormRows) return
        setQuickFormUploadRows((prev) => prev.map((row) => {
            if (row.status !== 'error') return row
            return {
                ...row,
                status: 'pending',
                progress: 0,
                message: 'Đã đưa lại vào hàng chờ để thử lại',
            }
        }))
        setQuickFormUploadProgress(0)
        setQuickFormUploadNotice('')
    }

    const startQuickFormUpload = async () => {
        if (quickFormUploading || !quickFormUploadPokemon || quickFormUploadRows.length === 0) return

        const pendingRows = quickFormUploadRows
            .filter((row) => row.status === 'pending')
            .map((row) => ({ ...row }))
        if (pendingRows.length === 0) return

        const currentPokemon = pokemon.find((entry) => entry._id === quickFormUploadPokemon._id) || quickFormUploadPokemon
        const currentForms = getPokemonForms(currentPokemon)

        try {
            setQuickFormUploading(true)
            setQuickFormUploadNotice('')
            setQuickFormUploadProgress(0)
            setQuickFormUploadCount(pendingRows.length)

            const reservedFormIds = new Set(currentForms.map((entry) => normalizeOptionalFormId(entry?.formId)).filter(Boolean))
            const uploadableRows = []
            let skippedCount = 0
            let uploadFailed = 0
            let completedCount = 0
            const totalCount = pendingRows.length
            const updateOverallProgress = () => {
                setQuickFormUploadProgress(Math.round((completedCount / totalCount) * 100))
            }

            pendingRows.forEach((row) => {
                const skipByMegaMode = quickFormUploadMegaMode === 'keep'
                    ? !row.hasMegaKeyword
                    : row.hasMegaKeyword
                if (skipByMegaMode) {
                    skippedCount += 1
                    completedCount += 1
                    const skipReason = quickFormUploadMegaMode === 'keep'
                        ? 'Ảnh không có Mega, bỏ qua theo chế độ Giữ Mega'
                        : 'Ảnh có Mega, bỏ qua theo chế độ Bỏ Mega'
                    updateQuickFormUploadRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: skipReason,
                    })
                    updateOverallProgress()
                    return
                }

                if (!row.file) {
                    skippedCount += 1
                    completedCount += 1
                    updateQuickFormUploadRow(row.queueId, {
                        status: 'error',
                        progress: 0,
                        message: 'Tệp ảnh không hợp lệ, vui lòng chọn lại',
                    })
                    updateOverallProgress()
                    return
                }

                const normalizedFormId = normalizeOptionalFormId(row.appliedFormId)
                if (!normalizedFormId) {
                    skippedCount += 1
                    completedCount += 1
                    updateQuickFormUploadRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: 'Không đọc được formId từ tên file',
                    })
                    updateOverallProgress()
                    return
                }

                if (reservedFormIds.has(normalizedFormId)) {
                    skippedCount += 1
                    completedCount += 1
                    updateQuickFormUploadRow(row.queueId, {
                        status: 'skipped',
                        progress: 0,
                        message: `Đã tồn tại formId ${normalizedFormId}, bỏ qua để tránh ghi đè`,
                    })
                    updateOverallProgress()
                    return
                }

                reservedFormIds.add(normalizedFormId)
                uploadableRows.push({ ...row, normalizedFormId })
            })

            const createdForms = []
            if (uploadableRows.length > 0) {
                let cursor = 0
                const workerCount = Math.min(QUICK_FORM_UPLOAD_MAX_CONCURRENCY, uploadableRows.length)

                const workers = new Array(workerCount).fill(0).map(async () => {
                    while (true) {
                        const currentIndex = cursor
                        cursor += 1
                        if (currentIndex >= uploadableRows.length) break

                        const row = uploadableRows[currentIndex]
                        updateQuickFormUploadRow(row.queueId, {
                            status: 'uploading',
                            progress: 0,
                            message: `Đang tải lên: ${row.appliedFormName || row.normalizedFormId}`,
                        })

                        try {
                            let uploadedUrl = ''
                            let lastUploadError = null

                            for (let attempt = 1; attempt <= QUICK_FORM_UPLOAD_RETRY_ATTEMPTS; attempt += 1) {
                                if (attempt > 1) {
                                    updateQuickFormUploadRow(row.queueId, {
                                        status: 'uploading',
                                        progress: 0,
                                        message: `Thử lại ${attempt}/${QUICK_FORM_UPLOAD_RETRY_ATTEMPTS}: ${row.appliedFormName || row.normalizedFormId}`,
                                    })
                                }

                                try {
                                    const url = await uploadToCloudinary(row.file, (percentage) => {
                                        updateQuickFormUploadRow(row.queueId, { progress: percentage })
                                    })
                                    uploadedUrl = url
                                    lastUploadError = null
                                    break
                                } catch (err) {
                                    lastUploadError = err
                                    const shouldRetry = attempt < QUICK_FORM_UPLOAD_RETRY_ATTEMPTS && isRetryableUploadError(err)
                                    if (!shouldRetry) break

                                    const delayMs = QUICK_FORM_UPLOAD_RETRY_BASE_DELAY_MS * attempt
                                    updateQuickFormUploadRow(row.queueId, {
                                        status: 'uploading',
                                        progress: 0,
                                        message: `Mạng không ổn định, sẽ thử lại sau ${Math.ceil(delayMs / 1000)}s...`,
                                    })
                                    await waitForMs(delayMs)
                                }
                            }

                            if (!uploadedUrl) {
                                throw lastUploadError || new Error('Tải lên thất bại')
                            }

                            createdForms.push({
                                formId: row.normalizedFormId,
                                formName: row.appliedFormName || row.normalizedFormId,
                                imageUrl: uploadedUrl,
                                sprites: {},
                                stats: {},
                            })
                            updateQuickFormUploadRow(row.queueId, {
                                status: 'success',
                                progress: 100,
                                message: `Đã tải lên xong và xếp vào dạng ${row.normalizedFormId}`,
                            })
                        } catch (err) {
                            uploadFailed += 1
                            updateQuickFormUploadRow(row.queueId, {
                                status: 'error',
                                progress: 0,
                                message: err.message || 'Tải lên thất bại',
                            })
                        } finally {
                            completedCount += 1
                            updateOverallProgress()
                        }
                    }
                })

                await Promise.all(workers)
            }

            let createdCount = 0
            if (createdForms.length > 0) {
                const nextForms = [...currentForms, ...createdForms]
                const result = await pokemonApi.update(currentPokemon._id, { forms: nextForms })
                replacePokemonInLocalState(result?.pokemon)
                setQuickFormUploadPokemon(result?.pokemon || currentPokemon)
                createdCount = createdForms.length
            }

            const summaryParts = [`Đã thêm ${createdCount} dạng mới`]
            if (skippedCount > 0) summaryParts.push(`bỏ qua ${skippedCount} ảnh trùng/không hợp lệ`)
            if (uploadFailed > 0) summaryParts.push(`${uploadFailed} ảnh tải lên lỗi`)
            setQuickFormUploadNotice(`${summaryParts.join(', ')}.`)
        } catch (err) {
            setError(err.message || 'Tải nhanh ảnh form thất bại')
        } finally {
            setQuickFormUploading(false)
        }
    }

    const buildFormUpdatePayload = (pokemonEntry, targetFormId, nextImageUrl) => {
        const normalizedTargetFormId = normalizeFormId(targetFormId)
        const forms = Array.isArray(pokemonEntry?.forms) ? pokemonEntry.forms : []
        if (forms.length === 0) {
            throw new Error('Pokemon này chưa có danh sách form để cập nhật ảnh nhanh.')
        }

        let found = false
        const nextForms = forms.map((entry) => {
            if (normalizeFormId(entry?.formId) !== normalizedTargetFormId) return entry
            found = true
            return {
                ...entry,
                imageUrl: nextImageUrl,
            }
        })

        if (!found) {
            throw new Error(`Không tìm thấy form "${normalizedTargetFormId}" để cập nhật ảnh.`)
        }

        return { forms: nextForms }
    }

    const handleInlineImageUpload = async (file, pokemonEntry, formId = null) => {
        const validationError = validateImageFile(file)
        if (validationError) {
            setError(validationError)
            return
        }

        const key = `${pokemonEntry?._id || 'unknown'}:${formId || 'base'}`

        try {
            setError('')
            setUploadingImageKey(key)

            const uploadedUrl = await uploadToCloudinary(file)
            const normalizedFormId = formId ? normalizeFormId(formId) : null
            const payload = normalizedFormId
                ? buildFormUpdatePayload(pokemonEntry, normalizedFormId, uploadedUrl)
                : (() => {
                    const forms = Array.isArray(pokemonEntry?.forms) ? pokemonEntry.forms : []
                    if (forms.length === 0) {
                        return { imageUrl: uploadedUrl }
                    }

                    const defaultFormId = normalizeFormId(pokemonEntry?.defaultFormId || forms[0]?.formId || 'normal')
                    const formPayload = buildFormUpdatePayload(pokemonEntry, defaultFormId, uploadedUrl)
                    return {
                        ...formPayload,
                        imageUrl: uploadedUrl,
                    }
                })()

            const result = await pokemonApi.update(pokemonEntry._id, payload)
            replacePokemonInLocalState(result?.pokemon)
        } catch (err) {
            setError(`Cập nhật ảnh thất bại: ${err.message}`)
        } finally {
            setUploadingImageKey('')
        }
    }

    const handleInlineImageInputChange = async (event, pokemonEntry, formId = null) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        await handleInlineImageUpload(file, pokemonEntry, formId)
    }

    const toggleExpanded = (id) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const buildRows = () => {
        return pokemon.flatMap((p) => {
            const forms = Array.isArray(p.forms) && p.forms.length > 0
                ? p.forms
                : [{
                    formId: p.defaultFormId || 'normal',
                    formName: p.defaultFormId || 'normal',
                    imageUrl: p.imageUrl || '',
                }]
            const defaultFormId = p.defaultFormId || forms[0]?.formId || 'normal'
            const defaultForm = forms.find((form) => form.formId === defaultFormId) || forms[0]
            const extraForms = forms.filter((form) => form.formId !== defaultFormId)
            const isExpanded = expandedIds.has(p._id)

            const rows = []

            rows.push(
                <tr key={`${p._id}-base`} className="hover:bg-blue-50 transition-colors">
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                    <td className="px-3 py-2">
                        {(defaultForm?.imageUrl || p.imageUrl) ? (
                            <img
                                src={defaultForm?.imageUrl || p.imageUrl}
                                alt={p.name}
                                className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm"
                            />
                        ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                ?
                            </div>
                        )}
                    </td>
                    <td className="px-3 py-2 text-slate-800 font-bold text-sm truncate max-w-[140px]" title={p.name}>
                        {p.name}
                    </td>
                    <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap max-w-[100px]">
                            {p.types.map(type => (
                                <span
                                    key={type}
                                    className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                >
                                    {type.slice(0, 3)}
                                </span>
                            ))}
                        </div>
                    </td>
                    <td className="px-3 py-2">
                        <span
                            className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                            title={defaultForm?.formName ? `${defaultForm.formName} (${defaultForm.formId})` : defaultForm?.formId}
                        >
                            {defaultForm?.formName || defaultForm?.formId}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                        <div className="flex items-center gap-2">
                            <select
                                value={evolutionEdits[p._id]?.evolvesTo || ''}
                                onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                className="w-32 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                            >
                                <option value="">--</option>
                                {allPokemon.map((target) => (
                                    <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                        #{target.pokedexNumber} {target.name}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min="1"
                                placeholder="Lv"
                                value={evolutionEdits[p._id]?.minLevel ?? ''}
                                onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                disabled={!evolutionEdits[p._id]?.evolvesTo}
                            />
                            <button
                                type="button"
                                onClick={() => handleSaveEvolution(p)}
                                disabled={savingId === p._id || savingId === '__bulk__'}
                                title="Lưu tiến hóa"
                                className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded shadow-sm flex items-center justify-center"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                            </button>
                        </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                            {extraForms.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => toggleExpanded(p._id)}
                                    title={isExpanded ? 'Ẩn dạng' : 'Xem dạng'}
                                    className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm"
                                >
                                    {isExpanded ? 'Ẩn dạng' : `Dạng (${extraForms.length})`}
                                </button>
                            )}
                            <Link
                                to={`/admin/pokemon/${p._id}/edit`}
                                title="Sửa"
                                className="p-1.5 bg-green-500 hover:bg-green-600 text-white rounded shadow-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                </svg>
                            </Link>
                            <button
                                onClick={() => handleDelete(p._id, p.name)}
                                title="Xóa"
                                className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded shadow-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            )

            if (isExpanded) {
                extraForms.forEach((form) => {
                    rows.push(
                        <tr key={`${p._id}-${form.formId}`} className="bg-slate-50/40">
                            <td className="px-3 py-2 text-slate-400 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                            <td className="px-3 py-2">
                                {(form.imageUrl || p.imageUrl) ? (
                                    <img
                                        src={form.imageUrl || p.imageUrl}
                                        alt={`${p.name} ${form.formName || form.formId}`.trim()}
                                        className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm"
                                    />
                                ) : (
                                    <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                        ?
                                    </div>
                                )}
                            </td>
                            <td className="px-3 py-2 text-slate-700 font-semibold text-sm truncate max-w-[140px]" title={p.name}>
                                {p.name}
                            </td>
                            <td className="px-3 py-2">
                                <div className="flex gap-1 flex-wrap max-w-[100px]">
                                    {p.types.map(type => (
                                        <span
                                            key={type}
                                            className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                        >
                                            {type.slice(0, 3)}
                                        </span>
                                    ))}
                                </div>
                            </td>
                            <td className="px-3 py-2">
                                <span
                                    className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                    title={form.formName ? `${form.formName} (${form.formId})` : form.formId}
                                >
                                    {form.formName || form.formId}
                                </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                                <div className="flex items-center gap-2">
                                    <select
                                        value={evolutionEdits[p._id]?.evolvesTo || ''}
                                        onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                        className="w-32 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                                    >
                                        <option value="">--</option>
                                        {allPokemon.map((target) => (
                                            <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                                #{target.pokedexNumber} {target.name}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="Lv"
                                        value={evolutionEdits[p._id]?.minLevel ?? ''}
                                        onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                        className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                        disabled={!evolutionEdits[p._id]?.evolvesTo}
                                    />
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right"></td>
                        </tr>
                    )
                })
            }

            return rows
        })
    }

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Pokemon</h1>
                <Link
                    to="/admin/pokemon/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                        type="text"
                        placeholder="Tìm theo tên..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-full sm:w-auto focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả hệ</option>
                        {Object.keys(TYPE_COLORS).map(type => (
                            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={handleSaveAllEvolution}
                        disabled={savingId === '__bulk__' || dirtyEvolutionKeys.size === 0 || evolutionImporting || pokemonCsvImporting}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-sm font-bold shadow-sm transition-colors"
                    >
                        {savingId === '__bulk__'
                            ? 'Đang lưu...'
                            : `Lưu nhanh (${dirtyEvolutionKeys.size})`}
                    </button>
                </div>

                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-bold text-emerald-900">Import them Pokemon CSV/TXT</p>
                        <div className="flex gap-2">
                            <input
                                ref={pokemonCsvImportFileRef}
                                type="file"
                                accept=".csv,.txt"
                                onChange={handlePokemonCsvFileChange}
                                className="hidden"
                            />
                            <button
                                type="button"
                                onClick={() => pokemonCsvImportFileRef.current?.click()}
                                disabled={pokemonCsvImporting || evolutionImporting}
                                className="px-3 py-1.5 bg-white border border-emerald-300 hover:bg-emerald-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-bold text-emerald-900"
                            >
                                Tai file CSV/TXT
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyPokemonCsvImport}
                                disabled={pokemonCsvImporting || evolutionImporting || !pokemonCsvImportText.trim()}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                            >
                                {pokemonCsvImporting ? 'Dang import...' : 'Import Pokemon'}
                            </button>
                        </div>
                    </div>

                    <textarea
                        rows={5}
                        value={pokemonCsvImportText}
                        onChange={(e) => setPokemonCsvImportText(e.target.value)}
                        placeholder={'ID,Name,Type1,Type2,tier,Total,HP,Attack,Defense,Sp. Atk,Sp. Def,Speed,Generation\n1,Bulbasaur,Grass,Poison,D,318,45,49,49,65,65,45,1'}
                        className="w-full px-3 py-2 bg-white border border-emerald-200 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-emerald-500"
                    />
                    <p className="mt-2 text-[11px] text-emerald-800">
                        Ho tro cot: ID, Name, Type1, Type2, tier, HP, Attack, Defense, Sp. Atk, Sp. Def, Speed. Bo qua cot Total va Generation.
                    </p>

                    {pokemonCsvImportReport && (
                        <div className="mt-2 text-xs text-emerald-900 bg-white/70 border border-emerald-200 rounded p-2">
                            <div className="font-semibold">
                                Doc {pokemonCsvImportReport.totalRows} dong • Hop le {pokemonCsvImportReport.parsedRows} • Bo qua {pokemonCsvImportReport.skippedRows}
                                {Number.isFinite(pokemonCsvImportReport.createdCount) ? ` • Da tao ${pokemonCsvImportReport.createdCount}` : ''}
                                {Number.isFinite(pokemonCsvImportReport.errorCount) ? ` • Loi ${pokemonCsvImportReport.errorCount}` : ''}
                            </div>
                            {Array.isArray(pokemonCsvImportReport.warnings) && pokemonCsvImportReport.warnings.length > 0 && (
                                <div className="mt-1">
                                    <div className="font-semibold">Canh bao parser:</div>
                                    <ul className="list-disc list-inside">
                                        {pokemonCsvImportReport.warnings.map((warning, index) => (
                                            <li key={`${warning}-${index}`}>{warning}</li>
                                        ))}
                                        {pokemonCsvImportReport.hiddenWarningCount > 0 && (
                                            <li>... va {pokemonCsvImportReport.hiddenWarningCount} canh bao khac</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                            {Array.isArray(pokemonCsvImportReport.serverErrors) && pokemonCsvImportReport.serverErrors.length > 0 && (
                                <div className="mt-1">
                                    <div className="font-semibold">Loi khi luu:</div>
                                    <ul className="list-disc list-inside">
                                        {pokemonCsvImportReport.serverErrors.map((message, index) => (
                                            <li key={`${message}-${index}`}>{message}</li>
                                        ))}
                                        {pokemonCsvImportReport.hiddenServerErrorCount > 0 && (
                                            <li>... va {pokemonCsvImportReport.hiddenServerErrorCount} loi khac</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-sm font-bold text-amber-900">Import tien hoa CSV/TXT (1→2 = Lv20, 2→3 = Lv50)</p>
                        <div className="flex gap-2">
                            <input
                                ref={evolutionImportFileRef}
                                type="file"
                                accept=".csv,.txt"
                                onChange={handleEvolutionImportFileChange}
                                className="hidden"
                            />
                            <button
                                type="button"
                                onClick={() => evolutionImportFileRef.current?.click()}
                                disabled={evolutionImporting || pokemonCsvImporting}
                                className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-bold text-amber-900"
                            >
                                Tai file CSV/TXT
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyEvolutionImport}
                                disabled={evolutionImporting || pokemonCsvImporting || !evolutionImportText.trim()}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                            >
                                {evolutionImporting ? 'Dang import...' : 'Import tien hoa'}
                            </button>
                        </div>
                    </div>

                    <textarea
                        rows={5}
                        value={evolutionImportText}
                        onChange={(e) => setEvolutionImportText(e.target.value)}
                        placeholder={'001 Bulbasaur → 002 Ivysaur → 003 Venusaur\n019 Rattata → 020 Raticate\n083 Farfetch\'d'}
                        className="w-full px-3 py-2 bg-white border border-amber-200 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-amber-500"
                    />
                    <p className="mt-2 text-[11px] text-amber-800">
                        Ho tro: moi dong bat dau bang so Pokedex, co the dung mui ten "→" hoac "-&gt;". Neu co nhanh (VD Eevee), he thong se lay nhanh dau tien.
                    </p>

                    {evolutionImportReport && (
                        <div className="mt-2 text-xs text-amber-900 bg-white/70 border border-amber-200 rounded p-2">
                            <div className="font-semibold">
                                Da doc {evolutionImportReport.processedLines} dong hop le • Tao {evolutionImportReport.transitionCount} cap tien hoa • Xoa {evolutionImportReport.clearedCount} cap tien hoa
                                {Number.isFinite(evolutionImportReport.savedCount) ? ` • Da luu ${evolutionImportReport.savedCount} cap nhat` : ''}
                            </div>
                            {evolutionImportReport.branchLineCount > 0 && (
                                <div className="mt-1">Co {evolutionImportReport.branchLineCount} dong co nhieu nhanh, he thong da lay nhanh dau tien.</div>
                            )}
                            {Array.isArray(evolutionImportReport.warnings) && evolutionImportReport.warnings.length > 0 && (
                                <div className="mt-1">
                                    <div className="font-semibold">Canh bao:</div>
                                    <ul className="list-disc list-inside">
                                        {evolutionImportReport.warnings.map((warning, index) => (
                                            <li key={`${warning}-${index}`}>{warning}</li>
                                        ))}
                                        {evolutionImportReport.hiddenWarningCount > 0 && (
                                            <li>... va {evolutionImportReport.hiddenWarningCount} canh bao khac</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                    <>
                        {/* Table */}
                        <div
                            ref={topScrollRef}
                            className="bg-slate-50 border border-slate-200 border-b-0 rounded-t-lg overflow-x-auto shadow-sm h-4 mb-[-1px] sticky-top-scrollbar hidden lg:block"
                            style={{ scrollbarWidth: 'thin' }}
                        >
                            <div className="h-full min-w-[800px] lg:min-w-[1200px]"></div>
                        </div>
                        <div
                            ref={tableContainerRef}
                            className="bg-white border border-slate-200 rounded-lg lg:rounded-t-none w-full max-w-full overflow-x-auto overscroll-x-contain shadow-sm max-h-[70vh] custom-scrollbar"
                        >
                            <table className="w-full text-sm min-w-[800px] lg:min-w-[1200px]">
                                <thead className="bg-blue-600 text-white border-b border-blue-700 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-14 whitespace-nowrap">#</th>
                                        <th className="px-3 py-3 text-center font-bold uppercase text-xs w-20 whitespace-nowrap">Hình</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs min-w-[150px] whitespace-nowrap">Tên</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs min-w-[280px] whitespace-nowrap">Tiến Hóa</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-32 whitespace-nowrap">Hệ</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-28 whitespace-nowrap">Dạng</th>
                                        <th className="px-3 py-3 text-right font-bold uppercase text-xs w-28 whitespace-nowrap">Hành Động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pokemon.map((p) => {
                                        const forms = Array.isArray(p.forms) && p.forms.length > 0
                                            ? p.forms
                                            : [{
                                                formId: p.defaultFormId || 'normal',
                                                formName: p.defaultFormId || 'normal',
                                                imageUrl: p.imageUrl || '',
                                            }]
                                        const defaultFormId = p.defaultFormId || forms[0]?.formId || 'normal'
                                        const defaultForm = forms.find((form) => form.formId === defaultFormId) || forms[0]
                                        const extraForms = forms.filter((form) => form.formId !== defaultFormId)
                                        const isExpanded = expandedIds.has(p._id)

                                        return (
                                            <React.Fragment key={p._id}>
                                                <tr className="hover:bg-blue-50/30 transition-colors border-b border-slate-100 last:border-0">
                                                    <td className="px-3 py-3 text-slate-500 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                                                    <td className="px-3 py-3 text-center">
                                                        <div className="flex flex-col items-center gap-1">
                                                            {(defaultForm?.imageUrl || p.imageUrl) ? (
                                                                <img
                                                                    src={defaultForm?.imageUrl || p.imageUrl}
                                                                    alt={p.name}
                                                                    className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm mx-auto"
                                                                />
                                                            ) : (
                                                                <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs mx-auto">
                                                                    ?
                                                                </div>
                                                            )}
                                                            <input
                                                                id={`quick-upload-${p._id}-base`}
                                                                type="file"
                                                                accept="image/*"
                                                                className="hidden"
                                                                disabled={Boolean(uploadingImageKey)}
                                                                onChange={(e) => handleInlineImageInputChange(e, p)}
                                                            />
                                                            <label
                                                                htmlFor={`quick-upload-${p._id}-base`}
                                                                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold transition-colors ${uploadingImageKey === `${p._id}:base`
                                                                    ? 'bg-blue-100 border-blue-200 text-blue-700 cursor-wait'
                                                                    : 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 cursor-pointer'}`}
                                                            >
                                                                {uploadingImageKey === `${p._id}:base` ? 'Đang up...' : 'Up ảnh'}
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => openQuickFormUploadModal(p)}
                                                                title="Mở modal tải nhanh nhiều ảnh form"
                                                                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap transition-colors ${uploadingImageKey
                                                                    ? 'bg-slate-100 border-slate-200 text-slate-400 pointer-events-none'
                                                                    : 'bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100'}`}
                                                            >
                                                                Up nhanh form
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-slate-800 font-bold text-sm truncate max-w-[150px]" title={p.name}>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="truncate">{p.name}</span>
                                                            {extraForms.length > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleExpanded(p._id)}
                                                                    title={isExpanded ? 'Ẩn dạng' : 'Xem dạng'}
                                                                    className={`px-1.5 py-0.5 border text-[10px] rounded font-bold shadow-sm transition-colors flex items-center gap-1 shrink-0 ${isExpanded ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                                                                >
                                                                    {isExpanded ? (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                                <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clipRule="evenodd" />
                                                                            </svg>
                                                                            Ẩn
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                                                                            </svg>
                                                                            +{extraForms.length}
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-slate-600">
                                                        <div className="flex items-center gap-2">
                                                            <select
                                                                value={evolutionEdits[p._id]?.evolvesTo || ''}
                                                                onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                                                className="w-36 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                                                            >
                                                                <option value="">--</option>
                                                                {allPokemon.map((target) => (
                                                                    <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                                                        #{target.pokedexNumber} {target.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                placeholder="Lv"
                                                                value={evolutionEdits[p._id]?.minLevel ?? ''}
                                                                onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                                                className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                                                disabled={!evolutionEdits[p._id]?.evolvesTo}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveEvolution(p)}
                                                                disabled={savingId === p._id || savingId === '__bulk__'}
                                                                title="Lưu tiến hóa"
                                                                className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded shadow-sm flex items-center justify-center transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="flex gap-1 flex-wrap max-w-[120px]">
                                                            {p.types.map(type => (
                                                                <span
                                                                    key={type}
                                                                    className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                                                >
                                                                    {type.slice(0, 3)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <span
                                                            className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                                            title={defaultForm?.formName ? `${defaultForm.formName} (${defaultForm.formId})` : defaultForm?.formId}
                                                        >
                                                            {defaultForm?.formName || defaultForm?.formId}
                                                        </span>
                                                    </td>

                                                    <td className="px-3 py-3 text-right whitespace-nowrap">
                                                        <div className="flex justify-end gap-1">
                                                            <Link
                                                                to={`/admin/pokemon/${p._id}/edit`}
                                                                title="Sửa"
                                                                className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded shadow-sm transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                                                </svg>
                                                            </Link>
                                                            <button
                                                                onClick={() => handleDelete(p._id, p.name)}
                                                                title="Xóa"
                                                                className="p-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded shadow-sm transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && extraForms.map((form) => {
                                                    const formEditKey = `${p._id}_${form.formId}`

                                                    return (
                                                        <tr key={`${p._id}-${form.formId}`} className="bg-slate-50/60">
                                                            <td className="px-3 py-3 text-slate-400 font-mono text-xs border-t border-slate-100/50">
                                                                <div className="flex justify-end pr-2">↳</div>
                                                            </td>
                                                            <td className="px-3 py-3 text-center border-t border-slate-100/50">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    {(form.imageUrl || p.imageUrl) ? (
                                                                        <img
                                                                            src={form.imageUrl || p.imageUrl}
                                                                            alt={`${p.name} ${form.formName || form.formId}`.trim()}
                                                                            className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm mx-auto opacity-90"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs mx-auto">
                                                                            ?
                                                                        </div>
                                                                    )}
                                                                    <input
                                                                        id={`quick-upload-${p._id}-${normalizeFormId(form.formId).replace(/[^a-z0-9_-]/gi, '_')}`}
                                                                        type="file"
                                                                        accept="image/*"
                                                                        className="hidden"
                                                                        disabled={Boolean(uploadingImageKey)}
                                                                        onChange={(e) => handleInlineImageInputChange(e, p, form.formId)}
                                                                    />
                                                                    <label
                                                                        htmlFor={`quick-upload-${p._id}-${normalizeFormId(form.formId).replace(/[^a-z0-9_-]/gi, '_')}`}
                                                                        className={`px-1.5 py-0.5 rounded border text-[10px] font-bold transition-colors ${uploadingImageKey === `${p._id}:${normalizeFormId(form.formId)}`
                                                                            ? 'bg-blue-100 border-blue-200 text-blue-700 cursor-wait'
                                                                            : 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50 cursor-pointer'}`}
                                                                    >
                                                                        {uploadingImageKey === `${p._id}:${normalizeFormId(form.formId)}` ? 'Đang up...' : 'Up ảnh'}
                                                                    </label>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 text-slate-600 font-medium text-sm truncate max-w-[200px] border-t border-slate-100/50">
                                                                {p.name} <span className="text-xs text-slate-400 italic">({form.formName || form.formId})</span>
                                                            </td>
                                                            <td className="px-3 py-3 border-t border-slate-100/50">
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={evolutionEdits[formEditKey]?.evolvesTo || ''}
                                                                        onChange={(e) => updateEvolutionEdit(formEditKey, { evolvesTo: e.target.value })}
                                                                        className="w-36 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                                                                    >
                                                                        <option value="">--</option>
                                                                        {allPokemon.map((target) => (
                                                                            <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                                                                #{target.pokedexNumber} {target.name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        placeholder="Lv"
                                                                        value={evolutionEdits[formEditKey]?.minLevel ?? ''}
                                                                        onChange={(e) => updateEvolutionEdit(formEditKey, { minLevel: e.target.value })}
                                                                        className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                                                        disabled={!evolutionEdits[formEditKey]?.evolvesTo}
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSaveEvolution(p, form.formId)}
                                                                        disabled={savingId === formEditKey || savingId === '__bulk__'}
                                                                        title="Lưu tiến hóa dạng"
                                                                        className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded shadow-sm flex items-center justify-center transition-colors"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 border-t border-slate-100/50">
                                                                <div className="flex gap-1 flex-wrap max-w-[120px] opacity-60">
                                                                    {p.types.map(type => (
                                                                        <span
                                                                            key={type}
                                                                            className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                                                        >
                                                                            {type.slice(0, 3)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-3 border-t border-slate-100/50">
                                                                <span
                                                                    className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 border border-blue-200"
                                                                >
                                                                    {form.formName || form.formId}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-3 text-right whitespace-nowrap border-t border-slate-100/50"></td>
                                                        </tr>
                                                    )
                                                })}
                                            </React.Fragment>
                                        )
                                    })}
                                    {pokemon.length === 0 && (
                                        <tr>
                                            <td colSpan="7" className="px-4 py-8 text-center text-slate-500 italic">
                                                Không tìm thấy Pokemon nào.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {pagination.pages > 1 && (() => {
                            const totalPages = pagination.pages
                            const SIBLING = 2
                            const pagesArr = []
                            const addPage = (n) => { if (n >= 1 && n <= totalPages && !pagesArr.includes(n)) pagesArr.push(n) }
                            addPage(1)
                            for (let i = page - SIBLING; i <= page + SIBLING; i++) addPage(i)
                            addPage(totalPages)
                            pagesArr.sort((a, b) => a - b)
                            const items = []
                            for (let i = 0; i < pagesArr.length; i++) {
                                if (i > 0 && pagesArr[i] - pagesArr[i - 1] > 1) items.push('...' + i)
                                items.push(pagesArr[i])
                            }
                            return (
                                <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-3 text-slate-600 text-xs font-medium">
                                    <div className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
                                        Tổng <span className="font-bold">{pagination.total}</span> bản ghi &bull; Trang <span className="font-bold text-blue-700">{page}</span>/{totalPages}
                                    </div>
                                    <div className="flex flex-wrap justify-center gap-1">
                                        <button
                                            disabled={page === 1}
                                            onClick={() => setPage(page - 1)}
                                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                        >
                                            &laquo;
                                        </button>
                                        {items.map((item) =>
                                            typeof item === 'string' ? (
                                                <span key={item} className="px-1 py-1 text-slate-400 select-none">…</span>
                                            ) : (
                                                <button
                                                    key={item}
                                                    onClick={() => setPage(item)}
                                                    className={`min-w-[32px] px-2 py-1 border rounded text-xs font-bold transition-colors shadow-sm ${page === item
                                                        ? 'bg-blue-600 border-blue-600 text-white'
                                                        : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                                        }`}
                                                >
                                                    {item}
                                                </button>
                                            )
                                        )}
                                        <button
                                            disabled={page >= totalPages}
                                            onClick={() => setPage(page + 1)}
                                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                        >
                                            &raquo;
                                        </button>
                                    </div>
                                </div>
                            )
                        })()}
                    </>
                )}
            </div>

            {showQuickFormUploadModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={() => closeQuickFormUploadModal()}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[96vw] sm:max-w-4xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">
                                Tải nhanh ảnh form - {quickFormUploadPokemon?.name || 'Pokemon'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => closeQuickFormUploadModal()}
                                disabled={quickFormUploading}
                                className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <input
                            id="quick-form-upload-modal-input"
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleQuickFormFilesSelected}
                            disabled={quickFormUploading}
                        />

                        <div className="mb-4 flex justify-between items-center gap-2 flex-wrap">
                            <label
                                htmlFor="quick-form-upload-modal-input"
                                className={`px-3 py-1.5 rounded border text-xs font-bold whitespace-nowrap transition-colors ${quickFormUploading
                                    ? 'bg-cyan-100 border-cyan-200 text-cyan-700 cursor-wait'
                                    : 'bg-white border-cyan-300 text-cyan-700 hover:bg-cyan-100 cursor-pointer'}`}
                            >
                                {quickFormUploading ? 'Đang tải lên...' : 'Chọn nhiều ảnh form'}
                            </label>
                            <div className="text-xs text-slate-600 font-semibold">
                                {quickFormUploading
                                    ? `Đang tải lên tối đa ${QUICK_FORM_UPLOAD_MAX_CONCURRENCY} ảnh song song (${quickFormUploadCount} ảnh trong hàng xử lý)`
                                    : hasPendingQuickFormRows
                                        ? `Đã nạp ${quickFormUploadRows.length} ảnh, chờ xác nhận tải lên`
                                        : `Đã xử lý ${quickFormUploadRows.length} ảnh`}
                            </div>
                        </div>

                        <div className="mb-4 rounded border border-cyan-200 bg-cyan-50 p-3">
                            <div className="flex items-center justify-between text-xs font-semibold text-cyan-900 mb-2">
                                <span>Tiến trình</span>
                                <span>{quickFormUploadProgress}%</span>
                            </div>
                            <div className="w-full bg-cyan-100 rounded-full h-2">
                                <div className="bg-cyan-500 h-2 rounded-full transition-all" style={{ width: `${quickFormUploadProgress}%` }} />
                            </div>
                            {quickFormUploadNotice && (
                                <div className="mt-2 text-[11px] font-semibold text-cyan-900">{quickFormUploadNotice}</div>
                            )}
                        </div>

                        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-bold text-slate-700 uppercase mb-2">Tùy chọn Mega trước khi tải lên</div>
                            <div className="flex flex-wrap gap-2 mb-2">
                                <button
                                    type="button"
                                    onClick={() => handleQuickFormMegaModeChange('keep')}
                                    disabled={quickFormUploading || !hasPendingQuickFormRows}
                                    className={`px-3 py-1.5 rounded text-xs font-bold border whitespace-nowrap transition-colors ${quickFormUploadMegaMode === 'keep'
                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    Giữ Mega
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickFormMegaModeChange('remove')}
                                    disabled={quickFormUploading || !hasPendingQuickFormRows}
                                    className={`px-3 py-1.5 rounded text-xs font-bold border whitespace-nowrap transition-colors ${quickFormUploadMegaMode === 'remove'
                                        ? 'bg-amber-100 text-amber-700 border-amber-300'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    Bỏ Mega
                                </button>
                            </div>
                            <p className="text-[11px] text-slate-600">
                                Có {quickMegaFileCount} ảnh chứa từ khóa Mega. Chế độ Giữ Mega chỉ tải ảnh có Mega; chế độ Bỏ Mega chỉ tải ảnh không có Mega.
                            </p>
                        </div>

                        <div className="max-h-[46vh] overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
                            <div className="hidden sm:grid sm:grid-cols-12 px-4 py-2 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                <div className="sm:col-span-4">Tệp</div>
                                <div className="sm:col-span-3">Xem trước giữ Mega</div>
                                <div className="sm:col-span-3">Xem trước bỏ Mega</div>
                                <div className="sm:col-span-2 text-right">Trạng thái</div>
                            </div>

                            {quickFormUploadRows.length === 0 ? (
                                <div className="px-4 py-6 text-sm text-slate-500 text-center">Chưa có ảnh nào trong hàng chờ tải lên.</div>
                            ) : (
                                quickFormUploadRows.map((row, index) => {
                                    const statusMeta = QUICK_FORM_UPLOAD_STATUS_META[row.status] || QUICK_FORM_UPLOAD_STATUS_META.pending
                                    const keepPreviewLabel = formatFormPreviewLabel(row.keepFormId, row.keepFormName)
                                    const removePreviewLabel = formatFormPreviewLabel(row.removeFormId, row.removeFormName)
                                    const isKeepActive = quickFormUploadMegaMode === 'keep'
                                    const isRemoveActive = quickFormUploadMegaMode === 'remove'

                                    return (
                                        <div key={row.queueId} className={`px-4 py-3 bg-white ${row.isMegaModeAffecting && hasPendingQuickFormRows ? 'border-l-4 border-l-amber-300' : ''}`}>
                                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3">
                                                <div className="sm:col-span-4 min-w-0">
                                                    <div className="text-sm font-semibold text-slate-800 truncate">{index + 1}. {row.fileName}</div>
                                                    <div className="text-[11px] text-slate-500 mt-0.5">Dạng đang áp dụng: {formatFormPreviewLabel(row.appliedFormId, row.appliedFormName)}</div>
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

                                                <div className="sm:col-span-2 sm:text-right">
                                                    <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${statusMeta.badgeClass}`}>
                                                        {statusMeta.label}
                                                    </span>
                                                </div>
                                            </div>

                                            {(row.status === 'uploading' || row.status === 'success') && (
                                                <div className="mt-2">
                                                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${row.progress || 0}%` }} />
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
                                onClick={retryFailedQuickFormRows}
                                disabled={quickFormUploading || !hasFailedQuickFormRows}
                                className="mr-2 px-4 py-2 bg-white border border-red-300 rounded text-sm font-bold text-red-700 whitespace-nowrap hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Thử lại ảnh lỗi
                            </button>
                            <button
                                type="button"
                                onClick={startQuickFormUpload}
                                disabled={quickFormUploading || !hasPendingQuickFormRows}
                                className="mr-2 px-4 py-2 bg-cyan-600 border border-cyan-600 rounded text-sm font-bold text-white whitespace-nowrap hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {quickFormUploading ? 'Đang tải lên...' : (hasPendingQuickFormRows ? 'Bắt đầu tải lên' : 'Đã tải lên xong')}
                            </button>
                            <button
                                type="button"
                                onClick={() => closeQuickFormUploadModal()}
                                disabled={quickFormUploading}
                                className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-bold text-slate-700 whitespace-nowrap hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {quickFormUploading ? 'Đang tải lên...' : 'Đóng'}
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
