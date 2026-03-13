import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { battleTrainerApi, itemApi, pokemonApi } from '../../services/adminApi'
import { gameApi } from '../../services/gameApi'
import ImageUpload from '../../components/ImageUpload'

const emptyTrainer = {
    name: '',
    imageUrl: '',
    quote: '',
    isActive: true,
    orderIndex: 0,
    team: [],
    prizePokemonId: '',
    prizePokemonFormId: 'normal',
    prizePokemonLevel: 0,
    prizeItemId: '',
    prizeItemQuantity: 1,
    platinumCoinsReward: 0,
    expReward: 0,
    moonPointsReward: 0,
}

const PRIZE_POKEMON_MODAL_PAGE_SIZE = 40
const PRIZE_POKEMON_FORM_PAGE_SIZE = 18
const TRAINER_PAGE_SIZE = 20
const AUTO_PRIZE_POKEMON_PAGE_SIZE = 24
const POKEMON_REFERENCE_FETCH_LIMIT = 200

const normalizeAutoPrizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

const buildAutoPrizeSelectionKey = (pokemonId, formId = 'normal') => {
    const normalizedPokemonId = String(pokemonId || '').trim()
    if (!normalizedPokemonId) return ''
    return `${normalizedPokemonId}:${normalizeAutoPrizeFormId(formId)}`
}

const normalizeAutoPrizeLevel = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.min(1000, parsed)
}

const normalizeTrainerDamagePercentRaw = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return 100
    return Math.max(0, Math.min(1000, parsed))
}

const normalizeTrainerDamageBonusPercent = (value) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(-100, Math.min(900, parsed))
}

const rawDamagePercentToBonus = (rawValue) => normalizeTrainerDamagePercentRaw(rawValue) - 100
const damageBonusToRawPercent = (bonusValue) => Math.max(0, Math.min(1000, 100 + normalizeTrainerDamageBonusPercent(bonusValue)))

const normalizeAutoDamageRuleLevel = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return fallback
    return parsed
}

const createAutoDamageBonusRule = (fromLevel = 1, toLevel = 1, bonusPercent = 0) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromLevel: String(Math.max(1, Number.parseInt(fromLevel, 10) || 1)),
    toLevel: String(Math.max(1, Number.parseInt(toLevel, 10) || 1)),
    bonusPercent: String(normalizeTrainerDamageBonusPercent(bonusPercent)),
})

const parseAutoPrizeSelectionKey = (selectionKey) => {
    const normalizedKey = String(selectionKey || '').trim()
    if (!normalizedKey) {
        return { pokemonId: '', formId: 'normal', key: '' }
    }

    const [pokemonId, rawFormId] = normalizedKey.split(':')
    const normalizedPokemonId = String(pokemonId || '').trim()
    const normalizedFormId = normalizeAutoPrizeFormId(rawFormId)
    return {
        pokemonId: normalizedPokemonId,
        formId: normalizedFormId,
        key: normalizedPokemonId ? `${normalizedPokemonId}:${normalizedFormId}` : '',
    }
}

const normalizeTrainerUsageRows = (rowsLike = []) => {
    if (!Array.isArray(rowsLike)) return []

    return rowsLike
        .map((trainer) => {
            const trainerId = String(trainer?.trainerId || trainer?._id || trainer?.id || '').trim()
            const prizePokemonId = String(trainer?.prizePokemonId?._id || trainer?.prizePokemonId || '').trim()
            const rawTeamPokemonIds = Array.isArray(trainer?.teamPokemonIds)
                ? trainer.teamPokemonIds
                : (Array.isArray(trainer?.team) ? trainer.team.map((entry) => entry?.pokemonId) : [])
            const teamPokemonIds = [...new Set(
                rawTeamPokemonIds
                    .map((value) => String(value?._id || value || '').trim())
                    .filter(Boolean)
            )]

            return {
                trainerId,
                prizePokemonId,
                teamPokemonIds,
            }
        })
        .filter((row) => row.trainerId)
}

const loadAllPokemonReferenceRows = async () => {
    const firstPageData = await gameApi.getPokemonList({
        page: 1,
        limit: POKEMON_REFERENCE_FETCH_LIMIT,
    })

    const firstPageRows = Array.isArray(firstPageData?.pokemon) ? firstPageData.pokemon : []
    const totalPages = Math.max(1, Number(firstPageData?.pagination?.pages) || 1)
    if (totalPages <= 1) {
        return firstPageRows
    }

    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
    const allRows = [...firstPageRows]

    for (let index = 0; index < pageNumbers.length; index += 4) {
        const pageChunk = pageNumbers.slice(index, index + 4)
        const chunkResponses = await Promise.all(pageChunk.map((page) => gameApi.getPokemonList({
            page,
            limit: POKEMON_REFERENCE_FETCH_LIMIT,
        })))
        chunkResponses.forEach((entry) => {
            const rows = Array.isArray(entry?.pokemon) ? entry.pokemon : []
            allRows.push(...rows)
        })
    }

    const uniqueById = new Map()
    allRows.forEach((entry) => {
        const id = String(entry?._id || '').trim()
        if (!id || uniqueById.has(id)) return
        uniqueById.set(id, entry)
    })
    return [...uniqueById.values()]
}

export default function BattleTrainerPage() {
    const [trainers, setTrainers] = useState([])
    const [trainerUsageRows, setTrainerUsageRows] = useState([])
    const [pokemon, setPokemon] = useState([])
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [form, setForm] = useState({ ...emptyTrainer })
    const [editingId, setEditingId] = useState('')
    const [showPrizePokemonModal, setShowPrizePokemonModal] = useState(false)
    const [prizePokemonSearchTerm, setPrizePokemonSearchTerm] = useState('')
    const [prizePokemonOptions, setPrizePokemonOptions] = useState([])
    const [prizePokemonLookup, setPrizePokemonLookup] = useState({})
    const [prizePokemonPage, setPrizePokemonPage] = useState(1)
    const [prizePokemonFormPage, setPrizePokemonFormPage] = useState(1)
    const [prizePokemonTotalPages, setPrizePokemonTotalPages] = useState(1)
    const [prizePokemonTotal, setPrizePokemonTotal] = useState(0)
    const [prizePokemonLoading, setPrizePokemonLoading] = useState(false)
    const [prizePokemonLoadError, setPrizePokemonLoadError] = useState('')
    const [showTeamPokemonModal, setShowTeamPokemonModal] = useState(false)
    const [teamPokemonTargetIndex, setTeamPokemonTargetIndex] = useState(-1)
    const [teamPokemonSearchTerm, setTeamPokemonSearchTerm] = useState('')
    const [teamPokemonOptions, setTeamPokemonOptions] = useState([])
    const [teamPokemonLookup, setTeamPokemonLookup] = useState({})
    const [teamPokemonPage, setTeamPokemonPage] = useState(1)
    const [teamPokemonFormPage, setTeamPokemonFormPage] = useState(1)
    const [teamPokemonTotalPages, setTeamPokemonTotalPages] = useState(1)
    const [teamPokemonTotal, setTeamPokemonTotal] = useState(0)
    const [teamPokemonLoading, setTeamPokemonLoading] = useState(false)
    const [teamPokemonLoadError, setTeamPokemonLoadError] = useState('')
    const [autoLevelStart, setAutoLevelStart] = useState(1)
    const [autoLevelMax, setAutoLevelMax] = useState(100)
    const [autoLevelStep, setAutoLevelStep] = useState(10)
    const [autoCoinsReward, setAutoCoinsReward] = useState('')
    const [autoExpReward, setAutoExpReward] = useState('')
    const [autoPrizePokemonSearchTerm, setAutoPrizePokemonSearchTerm] = useState('')
    const [autoPrizePokemonFormFilter, setAutoPrizePokemonFormFilter] = useState('')
    const [autoPrizePokemonSelections, setAutoPrizePokemonSelections] = useState([])
    const [autoPrizePokemonLevels, setAutoPrizePokemonLevels] = useState({})
    const [autoPrizePokemonPage, setAutoPrizePokemonPage] = useState(1)
    const [autoPrizePokemonEveryTrainer, setAutoPrizePokemonEveryTrainer] = useState(0)
    const [autoDamageBonusRules, setAutoDamageBonusRules] = useState([])
    const [showAutoPrizePokemonModal, setShowAutoPrizePokemonModal] = useState(false)
    const [autoTrainerImageUrl, setAutoTrainerImageUrl] = useState('')
    const [autoTrainerImageUrls, setAutoTrainerImageUrls] = useState([])
    const [teamDamagePercentBulk, setTeamDamagePercentBulk] = useState('0')
    const [autoGenerating, setAutoGenerating] = useState(false)
    const [deletingAll, setDeletingAll] = useState(false)
    const [deletingAutoGenerated, setDeletingAutoGenerated] = useState(false)
    const [resettingHistory, setResettingHistory] = useState(false)
    const [showCreateTrainerForm, setShowCreateTrainerForm] = useState(false)
    const [trainerPagination, setTrainerPagination] = useState({
        page: 1,
        pages: 1,
        total: 0,
        limit: TRAINER_PAGE_SIZE,
    })
    const [autoGeneratedTrainerCount, setAutoGeneratedTrainerCount] = useState(0)

    useEffect(() => {
        loadReferenceData()
    }, [])

    useEffect(() => {
        loadTrainers(trainerPagination.page)
    }, [trainerPagination.page])

    useEffect(() => {
        if (!showPrizePokemonModal) return
        loadPrizePokemonOptions()
    }, [showPrizePokemonModal, prizePokemonPage, prizePokemonSearchTerm])

    useEffect(() => {
        if (!showTeamPokemonModal) return
        loadTeamPokemonOptions()
    }, [showTeamPokemonModal, teamPokemonPage, teamPokemonSearchTerm])

    const loadReferenceData = async () => {
        try {
            const [pokemonRows, itemData] = await Promise.all([
                loadAllPokemonReferenceRows(),
                itemApi.list({ page: 1, limit: 5000 }),
            ])
            setPokemon(Array.isArray(pokemonRows) ? pokemonRows : [])
            setItems(itemData.items || [])
        } catch (err) {
            setError(err.message)
        }
    }

    const loadTrainers = async (targetPage = trainerPagination.page) => {
        try {
            setLoading(true)
            setError('')
            const [data, usageSummaryData] = await Promise.all([
                battleTrainerApi.list({
                    page: targetPage,
                    limit: trainerPagination.limit,
                }),
                battleTrainerApi.usageSummary().catch(() => null),
            ])

            const rows = Array.isArray(data?.trainers) ? data.trainers : []
            const usageRows = normalizeTrainerUsageRows(
                Array.isArray(usageSummaryData?.usages)
                    ? usageSummaryData.usages
                    : rows
            )
            const total = Math.max(0, Number(data?.pagination?.total) || 0)
            const totalPages = Math.max(1, Number(data?.pagination?.pages) || 1)
            const limit = Math.max(1, Number(data?.pagination?.limit) || TRAINER_PAGE_SIZE)

            if (rows.length === 0 && total > 0 && targetPage > 1) {
                setTrainerPagination((prev) => ({
                    ...prev,
                    page: Math.max(1, totalPages),
                }))
                return
            }

            setTrainers(rows)
            setTrainerUsageRows(usageRows)
            setTrainerPagination((prev) => ({
                ...prev,
                page: Math.max(1, Number(data?.pagination?.page) || targetPage),
                pages: totalPages,
                total,
                limit,
            }))
            setAutoGeneratedTrainerCount(Math.max(0, Number(data?.summary?.autoGeneratedTotal) || 0))
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách trainer')
            setTrainers([])
            setTrainerUsageRows([])
            setTrainerPagination((prev) => ({
                ...prev,
                pages: 1,
                total: 0,
            }))
            setAutoGeneratedTrainerCount(0)
        } finally {
            setLoading(false)
        }
    }

    const loadPrizePokemonOptions = async () => {
        try {
            setPrizePokemonLoading(true)
            setPrizePokemonLoadError('')

            const normalizedSearch = String(prizePokemonSearchTerm || '').trim()
            const data = await pokemonApi.list({
                page: prizePokemonPage,
                limit: PRIZE_POKEMON_MODAL_PAGE_SIZE,
                ...(normalizedSearch ? { search: normalizedSearch } : {}),
            })

            const rows = Array.isArray(data?.pokemon) ? data.pokemon : []
            setPrizePokemonOptions(rows)
            setPrizePokemonTotalPages(Math.max(1, Number(data?.pagination?.pages) || 1))
            setPrizePokemonTotal(Math.max(0, Number(data?.pagination?.total) || 0))
            setPrizePokemonLookup((prev) => {
                const next = { ...prev }
                rows.forEach((entry) => {
                    if (entry?._id) next[entry._id] = entry
                })
                return next
            })
        } catch (err) {
            setPrizePokemonOptions([])
            setPrizePokemonTotalPages(1)
            setPrizePokemonTotal(0)
            setPrizePokemonLoadError(err.message || 'Không thể tải danh sách Pokemon')
        } finally {
            setPrizePokemonLoading(false)
        }
    }

    const loadTeamPokemonOptions = async () => {
        try {
            setTeamPokemonLoading(true)
            setTeamPokemonLoadError('')

            const normalizedSearch = String(teamPokemonSearchTerm || '').trim()
            const data = await pokemonApi.list({
                page: teamPokemonPage,
                limit: PRIZE_POKEMON_MODAL_PAGE_SIZE,
                ...(normalizedSearch ? { search: normalizedSearch } : {}),
            })

            const rows = Array.isArray(data?.pokemon) ? data.pokemon : []
            setTeamPokemonOptions(rows)
            setTeamPokemonTotalPages(Math.max(1, Number(data?.pagination?.pages) || 1))
            setTeamPokemonTotal(Math.max(0, Number(data?.pagination?.total) || 0))
            setTeamPokemonLookup((prev) => {
                const next = { ...prev }
                rows.forEach((entry) => {
                    if (entry?._id) next[entry._id] = entry
                })
                return next
            })
        } catch (err) {
            setTeamPokemonOptions([])
            setTeamPokemonTotalPages(1)
            setTeamPokemonTotal(0)
            setTeamPokemonLoadError(err.message || 'Không thể tải danh sách Pokemon đội hình')
        } finally {
            setTeamPokemonLoading(false)
        }
    }

    const resetForm = () => {
        setForm({ ...emptyTrainer })
        setEditingId('')
        setTeamDamagePercentBulk('0')
        setShowTeamPokemonModal(false)
        setTeamPokemonTargetIndex(-1)
    }

    const handleApplyDamagePercentToAllTeam = () => {
        const normalizedBulkBonus = normalizeTrainerDamageBonusPercent(teamDamagePercentBulk)
        const normalizedBulkRaw = damageBonusToRawPercent(normalizedBulkBonus)
        setForm((prev) => ({
            ...prev,
            team: (Array.isArray(prev.team) ? prev.team : []).map((entry) => ({
                ...entry,
                damagePercent: normalizedBulkRaw,
            })),
        }))
        setTeamDamagePercentBulk(String(normalizedBulkBonus))
    }

    const handleAddTeam = () => {
        setForm((prev) => ({
            ...prev,
            team: [...prev.team, { pokemonId: '', level: 5, formId: 'normal', damagePercent: 100 }],
        }))
    }

    const handleOpenTeamPokemonModal = (targetIndex) => {
        if (!Number.isInteger(targetIndex) || targetIndex < 0) return
        const currentTeamEntry = form.team?.[targetIndex] || null
        const currentPokemon = pokemon.find((entry) => entry._id === currentTeamEntry?.pokemonId)
            || teamPokemonLookup[currentTeamEntry?.pokemonId]
            || null
        const suggestedSearch = currentPokemon?.name
            || (currentPokemon?.pokedexNumber ? String(currentPokemon.pokedexNumber) : '')

        setTeamPokemonTargetIndex(targetIndex)
        setTeamPokemonSearchTerm(suggestedSearch)
        setTeamPokemonPage(1)
        setTeamPokemonFormPage(1)
        setTeamPokemonLoadError('')
        setShowTeamPokemonModal(true)
    }

    const buildRandomTeam = () => {
        if (!pokemon.length) return []
        const picked = []
        const used = new Set()
        while (picked.length < Math.min(3, pokemon.length)) {
            const index = Math.floor(Math.random() * pokemon.length)
            if (used.has(index)) continue
            used.add(index)
            picked.push({
                pokemonId: pokemon[index]._id,
                level: Math.floor(Math.random() * 8) + 3,
                formId: 'normal',
                damagePercent: 100,
            })
        }
        return picked
    }

    const handleUpdateTeam = (index, key, value) => {
        setForm((prev) => {
            const team = [...prev.team]
            team[index] = { ...team[index], [key]: value }
            return { ...prev, team }
        })
    }

    const handleRemoveTeam = (index) => {
        setForm((prev) => {
            const team = prev.team.filter((_, i) => i !== index)
            return { ...prev, team }
        })
        if (showTeamPokemonModal) {
            setShowTeamPokemonModal(false)
            setTeamPokemonTargetIndex(-1)
        }
    }

    const handleClearTeamPokemon = (index) => {
        if (!Number.isInteger(index) || index < 0) return
        setForm((prev) => {
            if (!prev.team[index]) return prev
            const team = [...prev.team]
            team[index] = { ...team[index], pokemonId: '', formId: 'normal' }
            return { ...prev, team }
        })
    }

    const handleSelectTeamPokemon = (pokemonId, formId = 'normal') => {
        const targetIndex = Number(teamPokemonTargetIndex)
        if (!Number.isInteger(targetIndex) || targetIndex < 0) return

        setForm((prev) => {
            if (!prev.team[targetIndex]) return prev
            const team = [...prev.team]
            team[targetIndex] = {
                ...team[targetIndex],
                pokemonId,
                formId: String(formId || '').trim().toLowerCase() || 'normal',
            }
            return { ...prev, team }
        })

        setShowTeamPokemonModal(false)
        setTeamPokemonTargetIndex(-1)
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        try {
            const normalizedTeam = (form.team.length ? form.team : buildRandomTeam()).map((entry) => ({
                pokemonId: entry?.pokemonId || '',
                level: Math.max(1, Number.parseInt(entry?.level, 10) || 1),
                formId: String(entry?.formId || '').trim().toLowerCase() || 'normal',
                damagePercent: normalizeTrainerDamagePercentRaw(entry?.damagePercent),
            }))
            const payload = {
                ...form,
                team: normalizedTeam,
                prizePokemonId: form.prizePokemonId || null,
                prizePokemonFormId: form.prizePokemonId
                    ? (String(form.prizePokemonFormId || '').trim().toLowerCase() || 'normal')
                    : null,
                prizePokemonLevel: form.prizePokemonId
                    ? Math.max(0, Number.parseInt(form.prizePokemonLevel, 10) || 0)
                    : 0,
                prizeItemId: form.prizeItemId || null,
                prizeItemQuantity: form.prizeItemId
                    ? Math.max(1, Number.parseInt(form.prizeItemQuantity, 10) || 1)
                    : 1,
                moonPointsReward: Math.max(0, Number.parseInt(form.moonPointsReward, 10) || 0),
            }
            if (editingId) {
                await battleTrainerApi.update(editingId, payload)
            } else {
                await battleTrainerApi.create(payload)
            }
            resetForm()
            await loadTrainers(trainerPagination.page)
        } catch (err) {
            setError(err.message)
        }
    }

    const handleEdit = (trainer) => {
        setShowCreateTrainerForm(false)
        setEditingId(trainer._id)
        setForm({
            name: trainer.name || '',
            imageUrl: trainer.imageUrl || '',
            quote: trainer.quote || '',
            isActive: trainer.isActive !== undefined ? trainer.isActive : true,
            orderIndex: trainer.orderIndex || 0,
            team: (trainer.team || []).map((entry) => ({
                pokemonId: entry.pokemonId?._id || entry.pokemonId || '',
                level: entry.level || 5,
                formId: entry.formId || 'normal',
                damagePercent: normalizeTrainerDamagePercentRaw(entry?.damagePercent),
            })),
            prizePokemonId: trainer.prizePokemonId?._id || trainer.prizePokemonId || '',
            prizePokemonFormId: String(trainer.prizePokemonFormId || trainer.prizePokemonId?.defaultFormId || 'normal').trim().toLowerCase() || 'normal',
            prizePokemonLevel: Math.max(0, Number(trainer.prizePokemonLevel) || 0),
            prizeItemId: trainer.prizeItemId?._id || trainer.prizeItemId || '',
            prizeItemQuantity: Math.max(1, Number(trainer.prizeItemQuantity) || 1),
            platinumCoinsReward: trainer.platinumCoinsReward || 0,
            expReward: trainer.expReward || 0,
            moonPointsReward: trainer.moonPointsReward || 0,
        })
        setTeamDamagePercentBulk('0')
    }

    const handleDelete = async (id) => {
        if (!confirm('Xóa trainer này?')) return
        await battleTrainerApi.delete(id)
        await loadTrainers(trainerPagination.page)
    }

    const handleDeleteAll = async () => {
        if (!trainers.length) return
        if (!confirm('Xóa toàn bộ trainer battle hiện có? Hành động này không thể hoàn tác.')) return
        try {
            setError('')
            setDeletingAll(true)
            await battleTrainerApi.deleteAll()
            resetForm()
            setTrainerPagination((prev) => ({ ...prev, page: 1 }))
            await loadTrainers(1)
        } catch (err) {
            setError(err.message || 'Xóa toàn bộ trainer thất bại')
        } finally {
            setDeletingAll(false)
        }
    }

    const handleDeleteAutoGenerated = async () => {
        const autoGeneratedCount = trainers.filter((entry) => entry?.autoGenerated).length
        if (autoGeneratedCount === 0) return
        if (!confirm(`Xóa ${autoGeneratedCount} trainer auto-generated? Trainer tạo tay sẽ được giữ lại.`)) return
        try {
            setError('')
            setDeletingAutoGenerated(true)
            await battleTrainerApi.deleteAutoGenerated()
            resetForm()
            setTrainerPagination((prev) => ({ ...prev, page: 1 }))
            await loadTrainers(1)
        } catch (err) {
            setError(err.message || 'Xóa trainer auto-generated thất bại')
        } finally {
            setDeletingAutoGenerated(false)
        }
    }

    const handleResetBattleTrainerHistory = async () => {
        if (!confirm('Reset toàn bộ lịch sử đi tháp của người chơi về mốc đầu tiên? Hệ thống sẽ xóa tiến độ đã thắng và xóa trận đang đánh.')) return

        try {
            setError('')
            setResettingHistory(true)
            await battleTrainerApi.resetHistory({ keepSessions: false })
            await loadTrainers(trainerPagination.page)
        } catch (err) {
            setError(err.message || 'Reset lịch sử đi tháp thất bại')
        } finally {
            setResettingHistory(false)
        }
    }

    const handleAutoGenerateByMilestone = async () => {
        try {
            setError('')
            setAutoGenerating(true)
            const normalizedDamageBonusRules = (Array.isArray(autoDamageBonusRules) ? autoDamageBonusRules : [])
                .map((rule) => {
                    const fromLevelInput = normalizeAutoDamageRuleLevel(rule?.fromLevel, 1)
                    const toLevelInput = normalizeAutoDamageRuleLevel(rule?.toLevel, fromLevelInput)
                    const fromLevel = Math.min(fromLevelInput, toLevelInput)
                    const toLevel = Math.max(fromLevelInput, toLevelInput)
                    const bonusPercent = normalizeTrainerDamageBonusPercent(rule?.bonusPercent)
                    return {
                        fromLevel,
                        toLevel,
                        bonusPercent,
                    }
                })
                .filter((rule) => rule.toLevel >= rule.fromLevel)

            const payload = {
                startLevel: autoLevelStart,
                maxLevel: autoLevelMax,
                step: autoLevelStep,
                teamSize: 3,
                imageUrl: autoTrainerImageUrl,
                imageUrls: autoTrainerImageUrls,
            }

            if (normalizedDamageBonusRules.length > 0) {
                payload.damageBonusRules = normalizedDamageBonusRules
            }

            const normalizedCoinsReward = String(autoCoinsReward || '').trim()
            const normalizedExpReward = String(autoExpReward || '').trim()

            if (normalizedCoinsReward !== '') {
                payload.platinumCoinsRewardMultiplier = Math.max(0, Number.parseInt(normalizedCoinsReward, 10) || 0)
            }
            if (normalizedExpReward !== '') {
                payload.expRewardMultiplier = Math.max(0, Number.parseInt(normalizedExpReward, 10) || 0)
            }

            const normalizedPrizeEveryTrainer = Math.max(0, Number.parseInt(autoPrizePokemonEveryTrainer, 10) || 0)
            if (autoPrizePokemonSelectionSet.size > 0 && normalizedPrizeEveryTrainer < 1) {
                throw new Error('Hãy nhập số trainer cách nhau để nhận Pokemon thưởng (>= 1).')
            }

            if (autoPrizePokemonSelectionSet.size > 0 && normalizedPrizeEveryTrainer > 0) {
                payload.prizePokemonEveryTrainer = normalizedPrizeEveryTrainer
                payload.prizePokemonPool = [...autoPrizePokemonSelectionSet]
                    .map((selectionKey) => parseAutoPrizeSelectionKey(selectionKey))
                    .filter((entry) => entry.pokemonId)
                    .map((entry) => ({
                        pokemonId: entry.pokemonId,
                        formId: entry.formId,
                        level: normalizeAutoPrizeLevel(autoPrizePokemonLevels[entry.key]),
                    }))
            }

            await battleTrainerApi.autoGenerate(payload)
            setTrainerPagination((prev) => ({ ...prev, page: 1 }))
            await loadTrainers(1)
        } catch (err) {
            setError(err.message)
        } finally {
            setAutoGenerating(false)
        }
    }

    const addAutoDamageBonusRule = () => {
        setAutoDamageBonusRules((prev) => ([
            ...(Array.isArray(prev) ? prev : []),
            createAutoDamageBonusRule(autoLevelStart, autoLevelMax, 0),
        ]))
    }

    const updateAutoDamageBonusRule = (ruleId, key, value) => {
        const normalizedId = String(ruleId || '').trim()
        if (!normalizedId) return
        setAutoDamageBonusRules((prev) => (Array.isArray(prev) ? prev : []).map((rule) => {
            if (String(rule?.id || '').trim() !== normalizedId) return rule
            return {
                ...rule,
                [key]: value,
            }
        }))
    }

    const removeAutoDamageBonusRule = (ruleId) => {
        const normalizedId = String(ruleId || '').trim()
        if (!normalizedId) return
        setAutoDamageBonusRules((prev) => (Array.isArray(prev) ? prev : []).filter((rule) => String(rule?.id || '').trim() !== normalizedId))
    }

    const clearAutoDamageBonusRules = () => {
        setAutoDamageBonusRules([])
    }

    const toggleAutoPrizePokemon = (pokemonId, formId = 'normal') => {
        const selectionKey = buildAutoPrizeSelectionKey(pokemonId, formId)
        if (!selectionKey) return
        const isSelected = autoPrizePokemonSelectionSet.has(selectionKey)

        setAutoPrizePokemonSelections((prev) => {
            const normalizedPrev = Array.isArray(prev)
                ? prev.map((entry) => String(entry || '').trim()).filter(Boolean)
                : []
            if (normalizedPrev.includes(selectionKey)) {
                return normalizedPrev.filter((entry) => entry !== selectionKey)
            }
            return [...normalizedPrev, selectionKey]
        })

        setAutoPrizePokemonLevels((prev) => {
            const next = { ...(prev || {}) }
            if (isSelected) {
                delete next[selectionKey]
                return next
            }
            if (next[selectionKey] === undefined || next[selectionKey] === null || next[selectionKey] === '') {
                next[selectionKey] = 0
            }
            return next
        })
    }

    const selectAllFilteredAutoPrizePokemon = () => {
        const filteredSelectionKeys = autoPrizePokemonFilteredRows
            .map((row) => String(row?.selectionKey || '').trim())
            .filter(Boolean)
        if (filteredSelectionKeys.length === 0) return

        setAutoPrizePokemonSelections((prev) => {
            const merged = new Set((Array.isArray(prev) ? prev : []).map((entry) => String(entry || '').trim()).filter(Boolean))
            filteredSelectionKeys.forEach((selectionKey) => merged.add(selectionKey))
            return [...merged]
        })

        setAutoPrizePokemonLevels((prev) => {
            const next = { ...(prev || {}) }
            filteredSelectionKeys.forEach((selectionKey) => {
                if (next[selectionKey] === undefined || next[selectionKey] === null || next[selectionKey] === '') {
                    next[selectionKey] = 0
                }
            })
            return next
        })
    }

    const clearAutoPrizePokemon = () => {
        setAutoPrizePokemonSelections([])
        setAutoPrizePokemonLevels({})
    }

    const updateAutoPrizePokemonLevel = (selectionKey, levelLike) => {
        const normalizedKey = String(selectionKey || '').trim()
        if (!normalizedKey) return
        const normalizedLevel = normalizeAutoPrizeLevel(levelLike)
        setAutoPrizePokemonLevels((prev) => ({
            ...(prev || {}),
            [normalizedKey]: normalizedLevel,
        }))
    }

    const handleOpenAutoPrizePokemonModal = () => {
        setAutoPrizePokemonSearchTerm('')
        setAutoPrizePokemonFormFilter('')
        setAutoPrizePokemonPage(1)
        setShowAutoPrizePokemonModal(true)
    }

    const handleOpenPrizePokemonModal = () => {
        setPrizePokemonSearchTerm('')
        setPrizePokemonPage(1)
        setPrizePokemonFormPage(1)
        setPrizePokemonLoadError('')
        setShowPrizePokemonModal(true)
    }

    const handleSelectPrizePokemon = (pokemonId, formId = 'normal') => {
        setForm((prev) => ({
            ...prev,
            prizePokemonId: pokemonId,
            prizePokemonFormId: String(formId || '').trim().toLowerCase() || 'normal',
        }))
        setShowPrizePokemonModal(false)
    }

    const handleClearPrizePokemon = () => {
        setForm((prev) => ({
            ...prev,
            prizePokemonId: '',
            prizePokemonFormId: 'normal',
            prizePokemonLevel: 0,
        }))
    }

    const getPokemonImageUrl = (entry) => {
        const pokedexNumber = Number(entry?.pokedexNumber)
        return entry?.imageUrl
            || entry?.sprites?.normal
            || entry?.sprites?.front_default
            || (Number.isFinite(pokedexNumber)
                ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokedexNumber}.png`
                : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png')
    }

    const normalizePokemonFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
    const resolveTeamPokemonId = (entry) => String(entry?.pokemonId?._id || entry?.pokemonId || '').trim()

    const getPokemonFormsForDisplay = (entry) => {
        const defaultFormId = normalizePokemonFormId(entry?.defaultFormId)
        const rawForms = Array.isArray(entry?.forms) ? entry.forms : []

        const normalizedForms = rawForms
            .map((form) => {
                const formId = normalizePokemonFormId(form?.formId || defaultFormId)
                return {
                    formId,
                    formName: String(form?.formName || '').trim() || formId,
                    resolvedImageUrl: form?.imageUrl
                        || form?.sprites?.normal
                        || form?.sprites?.icon
                        || getPokemonImageUrl(entry),
                    isDefault: formId === defaultFormId,
                }
            })
            .filter((form, index, arr) => arr.findIndex((item) => item.formId === form.formId) === index)

        if (!normalizedForms.some((form) => form.formId === defaultFormId)) {
            normalizedForms.unshift({
                formId: defaultFormId,
                formName: defaultFormId,
                resolvedImageUrl: getPokemonImageUrl(entry),
                isDefault: true,
            })
        }

        return normalizedForms
            .sort((a, b) => {
                if (a.formId === defaultFormId) return -1
                if (b.formId === defaultFormId) return 1
                return a.formId.localeCompare(b.formId)
            })
    }

    const selectedPrizePokemon = pokemon.find((entry) => entry._id === form.prizePokemonId)
        || prizePokemonLookup[form.prizePokemonId]
        || null
    const selectedPrizeItem = items.find((entry) => entry._id === form.prizeItemId) || null
    const selectedPrizePokemonForms = selectedPrizePokemon ? getPokemonFormsForDisplay(selectedPrizePokemon) : []
    const normalizedPrizePokemonFormId = normalizePokemonFormId(form.prizePokemonFormId)
    const selectedPrizePokemonForm = selectedPrizePokemonForms.find((entry) => entry.formId === normalizedPrizePokemonFormId)
        || selectedPrizePokemonForms[0]
        || null

    const activeTeamEntry = Number.isInteger(Number(teamPokemonTargetIndex))
        ? form.team[Number(teamPokemonTargetIndex)]
        : null
    const selectedTeamPokemon = pokemon.find((entry) => entry._id === activeTeamEntry?.pokemonId)
        || teamPokemonLookup[activeTeamEntry?.pokemonId]
        || null
    const selectedTeamPokemonForms = selectedTeamPokemon ? getPokemonFormsForDisplay(selectedTeamPokemon) : []
    const normalizedTeamPokemonFormId = normalizePokemonFormId(activeTeamEntry?.formId)
    const selectedTeamPokemonForm = selectedTeamPokemonForms.find((entry) => entry.formId === normalizedTeamPokemonFormId)
        || selectedTeamPokemonForms[0]
        || null
    const normalizedEditingId = String(editingId || '').trim()

    const selectedPrizePokemonIdsInCurrentForm = useMemo(() => {
        const selectedIds = new Set()
        const prizePokemonId = String(form.prizePokemonId || '').trim()
        if (!prizePokemonId) return selectedIds
        selectedIds.add(prizePokemonId)
        return selectedIds
    }, [form.prizePokemonId])

    const selectedPrizePokemonIdsInOtherTrainers = useMemo(() => {
        const selectedIds = new Set()
        ;(Array.isArray(trainerUsageRows) ? trainerUsageRows : []).forEach((entry) => {
            const trainerId = String(entry?.trainerId || '').trim()
            if (normalizedEditingId && trainerId === normalizedEditingId) return
            const prizePokemonId = String(entry?.prizePokemonId || '').trim()
            if (!prizePokemonId) return
            selectedIds.add(prizePokemonId)
        })
        return selectedIds
    }, [trainerUsageRows, normalizedEditingId])

    const selectedPokemonIdsInCurrentForm = useMemo(() => {
        const selectedIds = new Set()
        ;(Array.isArray(form.team) ? form.team : []).forEach((entry) => {
            const pokemonId = resolveTeamPokemonId(entry)
            if (!pokemonId) return
            selectedIds.add(pokemonId)
        })
        return selectedIds
    }, [form.team])

    const selectedPokemonIdsInOtherTrainers = useMemo(() => {
        const selectedIds = new Set()
        ;(Array.isArray(trainerUsageRows) ? trainerUsageRows : []).forEach((trainer) => {
            const trainerId = String(trainer?.trainerId || '').trim()
            if (normalizedEditingId && trainerId === normalizedEditingId) return

            const teamPokemonIds = Array.isArray(trainer?.teamPokemonIds) ? trainer.teamPokemonIds : []
            teamPokemonIds.forEach((entry) => {
                const pokemonId = String(entry || '').trim()
                if (!pokemonId) return
                selectedIds.add(pokemonId)
            })
        })
        return selectedIds
    }, [trainerUsageRows, normalizedEditingId])

    const allPokemonLookup = useMemo(() => {
        const lookup = {}
        const mergedRows = [...pokemon, ...Object.values(prizePokemonLookup), ...Object.values(teamPokemonLookup)]
        mergedRows.forEach((entry) => {
            const id = String(entry?._id || '').trim()
            if (!id) return
            if (!lookup[id]) lookup[id] = entry
        })
        return lookup
    }, [pokemon, prizePokemonLookup, teamPokemonLookup])

    const autoPrizePokemonSelectionSet = useMemo(
        () => new Set((Array.isArray(autoPrizePokemonSelections) ? autoPrizePokemonSelections : []).map((entry) => String(entry || '').trim()).filter(Boolean)),
        [autoPrizePokemonSelections]
    )

    const autoPrizePokemonFormOptions = useMemo(() => {
        const optionMap = new Map()

        pokemon.forEach((entry) => {
            const forms = getPokemonFormsForDisplay(entry)
            forms.forEach((rowForm) => {
                const formId = String(rowForm?.formId || '').trim().toLowerCase()
                if (!formId) return

                const existing = optionMap.get(formId)
                if (existing) {
                    optionMap.set(formId, {
                        ...existing,
                        count: existing.count + 1,
                    })
                    return
                }

                optionMap.set(formId, {
                    formId,
                    formName: String(rowForm?.formName || rowForm?.formId || formId).trim() || formId,
                    count: 1,
                })
            })
        })

        return [...optionMap.values()].sort((a, b) => {
            if (a.formId === 'normal') return -1
            if (b.formId === 'normal') return 1
            return a.formName.localeCompare(b.formName)
        })
    }, [pokemon])

    const autoPrizePokemonFilteredRows = useMemo(() => {
        const normalizedSearch = String(autoPrizePokemonSearchTerm || '').trim().toLowerCase()
        const normalizedFormFilter = String(autoPrizePokemonFormFilter || '').trim().toLowerCase()
        const speciesRows = pokemon.filter((entry) => {
            const id = String(entry?._id || '').trim()
            if (!id) return false
            if (!normalizedSearch) return true
            const name = String(entry?.name || '').trim().toLowerCase()
            const pokedexNumber = String(entry?.pokedexNumber || '').trim().toLowerCase()
            const formsText = (Array.isArray(entry?.forms) ? entry.forms : [])
                .map((formEntry) => String(formEntry?.formName || formEntry?.formId || '').trim().toLowerCase())
                .join(' ')
            return name.includes(normalizedSearch)
                || pokedexNumber.includes(normalizedSearch)
                || id.toLowerCase().includes(normalizedSearch)
                || formsText.includes(normalizedSearch)
        })

        const formRows = speciesRows.flatMap((entry) => {
            const forms = getPokemonFormsForDisplay(entry)
            return forms.map((rowForm) => ({
                key: `${entry._id}:${rowForm.formId}`,
                selectionKey: buildAutoPrizeSelectionKey(entry._id, rowForm.formId),
                pokemon: entry,
                form: rowForm,
            }))
        })

        if (!normalizedFormFilter) {
            return formRows
        }

        return formRows.filter((row) => String(row?.form?.formId || '').trim().toLowerCase() === normalizedFormFilter)
    }, [pokemon, autoPrizePokemonSearchTerm, autoPrizePokemonFormFilter])

    const autoPrizePokemonTotal = autoPrizePokemonFilteredRows.length
    const autoPrizePokemonTotalPages = Math.max(1, Math.ceil(autoPrizePokemonTotal / AUTO_PRIZE_POKEMON_PAGE_SIZE))
    const safeAutoPrizePokemonPage = Math.min(Math.max(1, autoPrizePokemonPage), autoPrizePokemonTotalPages)
    const autoPrizePokemonSliceStart = (safeAutoPrizePokemonPage - 1) * AUTO_PRIZE_POKEMON_PAGE_SIZE
    const autoPrizePokemonPageRows = autoPrizePokemonFilteredRows.slice(
        autoPrizePokemonSliceStart,
        autoPrizePokemonSliceStart + AUTO_PRIZE_POKEMON_PAGE_SIZE
    )
    const autoPrizePokemonPageStart = autoPrizePokemonTotal > 0
        ? autoPrizePokemonSliceStart + 1
        : 0
    const autoPrizePokemonPageEnd = autoPrizePokemonTotal > 0
        ? Math.min(autoPrizePokemonTotal, autoPrizePokemonSliceStart + AUTO_PRIZE_POKEMON_PAGE_SIZE)
        : 0

    const autoPrizePokemonSelectedRows = useMemo(
        () => [...autoPrizePokemonSelectionSet]
            .map((selectionKey) => {
                const parsed = parseAutoPrizeSelectionKey(selectionKey)
                if (!parsed.pokemonId) return null
                const selectedPokemon = allPokemonLookup[parsed.pokemonId]
                if (!selectedPokemon) return null
                const forms = getPokemonFormsForDisplay(selectedPokemon)
                const selectedForm = forms.find((entry) => entry.formId === parsed.formId)
                    || forms[0]
                    || null
                return {
                    selectionKey: parsed.key || selectionKey,
                    pokemon: selectedPokemon,
                    form: selectedForm,
                    level: normalizeAutoPrizeLevel(autoPrizePokemonLevels[parsed.key || selectionKey]),
                }
            })
            .filter(Boolean),
        [autoPrizePokemonSelectionSet, allPokemonLookup, autoPrizePokemonLevels]
    )

    const autoPrizeRepeatPreview = useMemo(() => {
        const normalizedStartLevel = Math.max(1, Number.parseInt(autoLevelStart, 10) || 1)
        const parsedMaxLevel = Number.parseInt(autoLevelMax, 10)
        const normalizedMaxLevel = Math.max(
            normalizedStartLevel,
            Number.isFinite(parsedMaxLevel) && parsedMaxLevel > 0 ? parsedMaxLevel : normalizedStartLevel
        )
        const parsedStep = Number.parseInt(autoLevelStep, 10)
        const normalizedStep = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 10
        const normalizedEveryTrainer = Math.max(0, Number.parseInt(autoPrizePokemonEveryTrainer, 10) || 0)
        const poolSize = autoPrizePokemonSelectionSet.size

        const levelSet = new Set([normalizedStartLevel])
        for (let level = normalizedStep; level <= normalizedMaxLevel; level += normalizedStep) {
            if (level >= normalizedStartLevel) {
                levelSet.add(level)
            }
        }

        const levelList = [...levelSet].sort((a, b) => a - b)
        const rewardTrainerCount = normalizedEveryTrainer > 0
            ? levelList.reduce((count, _level, index) => (index % normalizedEveryTrainer === 0 ? count + 1 : count), 0)
            : 0

        const isRewardConfigEnabled = poolSize > 0 && normalizedEveryTrainer > 0
        const willRepeat = isRewardConfigEnabled && rewardTrainerCount > poolSize

        return {
            poolSize,
            levelCount: levelList.length,
            rewardTrainerCount,
            normalizedEveryTrainer,
            willRepeat,
            repeatCount: willRepeat ? rewardTrainerCount - poolSize : 0,
            isRewardConfigEnabled,
        }
    }, [
        autoLevelStart,
        autoLevelMax,
        autoLevelStep,
        autoPrizePokemonEveryTrainer,
        autoPrizePokemonSelectionSet,
    ])

    const allPrizePokemonFormRows = prizePokemonOptions.flatMap((entry) => {
        const forms = getPokemonFormsForDisplay(entry)
        return forms.map((rowForm) => ({
            key: `${entry._id}:${rowForm.formId}`,
            pokemon: entry,
            form: rowForm,
        }))
    })

    const prizePokemonFormTotal = allPrizePokemonFormRows.length
    const prizePokemonFormTotalPages = Math.max(1, Math.ceil(prizePokemonFormTotal / PRIZE_POKEMON_FORM_PAGE_SIZE))
    const safePrizePokemonFormPage = Math.min(prizePokemonFormPage, prizePokemonFormTotalPages)
    const prizePokemonFormSliceStart = (safePrizePokemonFormPage - 1) * PRIZE_POKEMON_FORM_PAGE_SIZE
    const prizePokemonFormRows = allPrizePokemonFormRows.slice(
        prizePokemonFormSliceStart,
        prizePokemonFormSliceStart + PRIZE_POKEMON_FORM_PAGE_SIZE
    )

    const allTeamPokemonFormRows = teamPokemonOptions.flatMap((entry) => {
        const forms = getPokemonFormsForDisplay(entry)
        return forms.map((rowForm) => ({
            key: `${entry._id}:${rowForm.formId}`,
            pokemon: entry,
            form: rowForm,
        }))
    })

    const teamPokemonFormTotal = allTeamPokemonFormRows.length
    const teamPokemonFormTotalPages = Math.max(1, Math.ceil(teamPokemonFormTotal / PRIZE_POKEMON_FORM_PAGE_SIZE))
    const safeTeamPokemonFormPage = Math.min(teamPokemonFormPage, teamPokemonFormTotalPages)
    const teamPokemonFormSliceStart = (safeTeamPokemonFormPage - 1) * PRIZE_POKEMON_FORM_PAGE_SIZE
    const teamPokemonFormRows = allTeamPokemonFormRows.slice(
        teamPokemonFormSliceStart,
        teamPokemonFormSliceStart + PRIZE_POKEMON_FORM_PAGE_SIZE
    )

    const prizePokemonPageStart = prizePokemonTotal > 0
        ? ((prizePokemonPage - 1) * PRIZE_POKEMON_MODAL_PAGE_SIZE) + 1
        : 0
    const prizePokemonPageEnd = prizePokemonTotal > 0
        ? Math.min(prizePokemonTotal, prizePokemonPage * PRIZE_POKEMON_MODAL_PAGE_SIZE)
        : 0
    const prizePokemonFormPageStart = prizePokemonFormTotal > 0
        ? prizePokemonFormSliceStart + 1
        : 0
    const prizePokemonFormPageEnd = prizePokemonFormTotal > 0
        ? Math.min(prizePokemonFormTotal, prizePokemonFormSliceStart + PRIZE_POKEMON_FORM_PAGE_SIZE)
        : 0
    const teamPokemonPageStart = teamPokemonTotal > 0
        ? ((teamPokemonPage - 1) * PRIZE_POKEMON_MODAL_PAGE_SIZE) + 1
        : 0
    const teamPokemonPageEnd = teamPokemonTotal > 0
        ? Math.min(teamPokemonTotal, teamPokemonPage * PRIZE_POKEMON_MODAL_PAGE_SIZE)
        : 0
    const teamPokemonFormPageStart = teamPokemonFormTotal > 0
        ? teamPokemonFormSliceStart + 1
        : 0
    const teamPokemonFormPageEnd = teamPokemonFormTotal > 0
        ? Math.min(teamPokemonFormTotal, teamPokemonFormSliceStart + PRIZE_POKEMON_FORM_PAGE_SIZE)
        : 0
    const trainerPageStart = trainerPagination.total > 0
        ? ((trainerPagination.page - 1) * trainerPagination.limit) + 1
        : 0
    const trainerPageEnd = trainerPagination.total > 0
        ? Math.min(trainerPagination.total, trainerPagination.page * trainerPagination.limit)
        : 0
    const trainerPageItems = useMemo(() => {
        const totalPages = Math.max(1, Number(trainerPagination.pages) || 1)
        const currentPage = Math.max(1, Number(trainerPagination.page) || 1)

        if (totalPages <= 9) {
            return Array.from({ length: totalPages }, (_, index) => index + 1)
        }

        const pages = [1]
        const start = Math.max(2, currentPage - 2)
        const end = Math.min(totalPages - 1, currentPage + 2)

        if (start > 2) pages.push('...')
        for (let value = start; value <= end; value += 1) {
            pages.push(value)
        }
        if (end < totalPages - 1) pages.push('...')
        pages.push(totalPages)

        return pages
    }, [trainerPagination.page, trainerPagination.pages])

    useEffect(() => {
        setPrizePokemonFormPage((prev) => {
            const normalized = Math.max(1, Math.min(prev, prizePokemonFormTotalPages))
            return normalized === prev ? prev : normalized
        })
    }, [prizePokemonFormTotalPages])

    useEffect(() => {
        setTeamPokemonFormPage((prev) => {
            const normalized = Math.max(1, Math.min(prev, teamPokemonFormTotalPages))
            return normalized === prev ? prev : normalized
        })
    }, [teamPokemonFormTotalPages])

    useEffect(() => {
        setAutoPrizePokemonPage((prev) => {
            const normalized = Math.max(1, Math.min(prev, autoPrizePokemonTotalPages))
            return normalized === prev ? prev : normalized
        })
    }, [autoPrizePokemonTotalPages])

    const isEditingTrainer = Boolean(editingId)

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider">Quản Lý Battle</h1>
            </div>
            <div className="p-4">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <div className="mb-4 border border-emerald-200 rounded p-3 bg-emerald-50/60">
                    <div className="flex flex-col md:flex-row md:items-end gap-3">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Mốc bắt đầu</label>
                            <input
                                type="number"
                                min="1"
                                value={autoLevelStart}
                                onChange={(e) => setAutoLevelStart(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                                className="w-24 px-2 py-1.5 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Mốc tối đa</label>
                            <input
                                type="number"
                                min="1"
                                value={autoLevelMax}
                                onChange={(e) => setAutoLevelMax(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                                className="w-24 px-2 py-1.5 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Bước cấp</label>
                            <input
                                type="number"
                                min="1"
                                value={autoLevelStep}
                                onChange={(e) => setAutoLevelStep(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                                className="w-24 px-2 py-1.5 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handleAutoGenerateByMilestone}
                            disabled={autoGenerating}
                            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded text-sm"
                        >
                            {autoGenerating ? 'Đang tạo...' : 'Auto tạo HLV mỗi 10 cấp'}
                        </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <ImageUpload
                                currentImage={autoTrainerImageUrl}
                                onUploadSuccess={(url) => {
                                    const nextUrls = Array.isArray(url)
                                        ? url.filter(Boolean)
                                        : [url].filter(Boolean)
                                    setAutoTrainerImageUrls(nextUrls)
                                    setAutoTrainerImageUrl(nextUrls[0] || '')
                                }}
                                multiple
                                label="Ảnh dùng cho trainer auto (chọn nhiều ảnh)"
                            />
                            {autoTrainerImageUrls.length > 0 && (
                                <div className="mt-2 text-[11px] text-emerald-800 font-medium">
                                    Đã chọn {autoTrainerImageUrls.length} ảnh, auto tạo sẽ gán lần lượt theo mốc cấp.
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">URL ảnh trainer auto</label>
                            <input
                                type="text"
                                value={autoTrainerImageUrl}
                                onChange={(e) => {
                                    const nextUrl = e.target.value
                                    setAutoTrainerImageUrl(nextUrl)
                                    setAutoTrainerImageUrls(nextUrl ? [nextUrl] : [])
                                }}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                placeholder="Để trống nếu không muốn đổi ảnh trainer auto"
                            />
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">🪙 Hệ số Xu (Lv x ?)</label>
                            <input
                                type="number"
                                min="0"
                                value={autoCoinsReward}
                                onChange={(e) => setAutoCoinsReward(e.target.value)}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                placeholder="Để trống = 10 (Lv x 10)"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">⭐ Hệ số EXP (Lv x ?)</label>
                            <input
                                type="number"
                                min="0"
                                value={autoExpReward}
                                onChange={(e) => setAutoExpReward(e.target.value)}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                placeholder="Để trống = 10 (Lv x 10)"
                            />
                        </div>
                    </div>
                    <div className="mt-3 border border-cyan-200 rounded bg-white/80 p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                                <div className="text-slate-700 text-xs font-bold uppercase">Mốc tăng/giảm sát thương NPC</div>
                                <div className="text-[11px] text-slate-500 mt-1">
                                    Thiết lập theo khoảng level: ví dụ 1-50 = +0%, 51-100 = +10%, 101-200 = +25%.
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={addAutoDamageBonusRule}
                                    className="px-3 py-2 border border-cyan-300 rounded bg-cyan-50 text-cyan-700 text-xs font-bold hover:bg-cyan-100"
                                >
                                    + Thêm mốc
                                </button>
                                <button
                                    type="button"
                                    onClick={clearAutoDamageBonusRules}
                                    disabled={autoDamageBonusRules.length === 0}
                                    className="px-3 py-2 border border-slate-300 rounded bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Xóa mốc
                                </button>
                            </div>
                        </div>

                        {autoDamageBonusRules.length > 0 ? (
                            <div className="mt-3 space-y-2">
                                <div className="hidden md:grid md:grid-cols-4 gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">
                                    <div>Từ level</div>
                                    <div>Đến level</div>
                                    <div>% thêm sát thương</div>
                                    <div>Thao tác</div>
                                </div>
                                {autoDamageBonusRules.map((rule) => {
                                    const ruleId = String(rule?.id || '').trim()
                                    if (!ruleId) return null
                                    return (
                                        <div key={ruleId} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                            <input
                                                type="number"
                                                min="1"
                                                value={rule?.fromLevel ?? ''}
                                                onChange={(e) => updateAutoDamageBonusRule(ruleId, 'fromLevel', e.target.value)}
                                                className="px-2 py-2 border border-slate-300 rounded text-sm"
                                                placeholder="Từ level"
                                            />
                                            <input
                                                type="number"
                                                min="1"
                                                value={rule?.toLevel ?? ''}
                                                onChange={(e) => updateAutoDamageBonusRule(ruleId, 'toLevel', e.target.value)}
                                                className="px-2 py-2 border border-slate-300 rounded text-sm"
                                                placeholder="Đến level"
                                            />
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    min="-100"
                                                    max="900"
                                                    value={rule?.bonusPercent ?? ''}
                                                    onChange={(e) => updateAutoDamageBonusRule(ruleId, 'bonusPercent', e.target.value)}
                                                    className="w-full px-2 py-2 pr-7 border border-slate-300 rounded text-sm"
                                                    placeholder="% thêm"
                                                />
                                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeAutoDamageBonusRule(ruleId)}
                                                className="px-2 py-2 border border-rose-300 bg-rose-50 text-rose-700 rounded text-xs font-bold hover:bg-rose-100"
                                            >
                                                Xóa mốc này
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="mt-2 text-[11px] text-slate-500">
                                Chưa có mốc sát thương. Nếu để trống, hệ thống dùng độ khó mặc định theo level (mốc cao sẽ tăng sát thương tự động).
                            </div>
                        )}
                    </div>
                    <div className="mt-3 border border-emerald-200 rounded bg-white/80 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                            <div>
                                <div className="text-slate-700 text-xs font-bold uppercase">Pool Pokemon thưởng ngẫu nhiên</div>
                                <div className="text-[11px] text-slate-500 mt-1">
                                    Chọn nhiều Pokemon để random làm thưởng cho trainer auto-generated.
                                </div>
                            </div>
                            <div>
                                <label className="block text-slate-700 text-[11px] font-semibold mb-1 uppercase">Cách nhau bao nhiêu trainer</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={autoPrizePokemonEveryTrainer}
                                    onChange={(e) => setAutoPrizePokemonEveryTrainer(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                                    className="w-40 px-2 py-1.5 bg-white border border-slate-300 rounded text-sm"
                                    placeholder="0 = tắt thưởng Pokemon"
                                />
                            </div>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                                type="button"
                                onClick={handleOpenAutoPrizePokemonModal}
                                className="px-3 py-2 border border-emerald-300 rounded bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                            >
                                Chọn Pokémo
                            </button>
                            <button
                                type="button"
                                onClick={clearAutoPrizePokemon}
                                disabled={autoPrizePokemonSelectionSet.size === 0}
                                className="px-3 py-2 border border-slate-300 rounded bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                            >
                                Bỏ chọn hết
                            </button>
                        </div>

                        <div className="mt-2 text-[11px] text-slate-600">
                            Đang chọn {autoPrizePokemonSelectionSet.size} lựa chọn Pokemon thưởng.
                            {autoPrizePokemonSelectedRows.length > 0 && (
                                <span>
                                    {' '}Ví dụ: {autoPrizePokemonSelectedRows
                                        .slice(0, 4)
                                        .map((entry) => {
                                            const pokemonName = String(entry?.pokemon?.name || '').trim()
                                            const formLabel = String(entry?.form?.formName || entry?.form?.formId || 'normal').trim()
                                            if (!pokemonName) return ''
                                            const baseLabel = formLabel && formLabel.toLowerCase() !== 'normal'
                                                ? `${pokemonName} (${formLabel})`
                                                : pokemonName
                                            return `${baseLabel} - Lv ${Math.max(0, Number(entry?.level) || 0)}`
                                        })
                                        .filter(Boolean)
                                        .join(', ')}
                                    {autoPrizePokemonSelectedRows.length > 4 ? ', ...' : ''}
                                </span>
                            )}
                        </div>
                    </div>
                    <p className="mt-2 text-[11px] text-emerald-800">
                        Nếu để trống hệ số thưởng thì hệ thống dùng mặc định: Lv x 10 cho Xu và EXP. Ví dụ nhập 15 nghĩa là Lv x 15. Trainer auto không có thưởng Điểm Nguyệt Các. Nếu có ảnh ở trên, trainer auto sẽ dùng ảnh đó. Pokémon thưởng chỉ áp dụng khi có pool Pokémon và "cách nhau bao nhiêu trainer" lớn hơn 0.
                    </p>
                </div>
                <div className="mb-4 border border-blue-200 rounded bg-blue-50/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold text-blue-900 uppercase tracking-wide">Form tạo trainer</div>
                        <button
                            type="button"
                            onClick={() => setShowCreateTrainerForm((prev) => !prev)}
                            className="px-3 py-1.5 text-xs font-bold rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-50"
                        >
                            {showCreateTrainerForm ? 'Thu gọn' : 'Mở form tạo'}
                        </button>
                    </div>
                    {!showCreateTrainerForm && !isEditingTrainer && (
                        <div className="mt-2 text-xs text-slate-600">
                            Form tạo trainer đang được thu gọn. Bấm "Mở form tạo" để thêm trainer mới.
                        </div>
                    )}
                </div>

                {isEditingTrainer && (
                    <div
                        className="fixed inset-0 bg-slate-900/45 z-30"
                        onClick={resetForm}
                    />
                )}

                {(showCreateTrainerForm || isEditingTrainer) && (
                    <div className={isEditingTrainer ? 'fixed inset-x-0 bottom-0 z-40 px-3 pb-3' : ''}>
                        <div className={isEditingTrainer ? 'mx-auto max-w-5xl bg-white border border-slate-300 rounded-t-xl shadow-2xl max-h-[86vh] overflow-y-auto' : ''}>
                            {isEditingTrainer && (
                                <div className="sticky top-0 z-[200] bg-gradient-to-t from-blue-600 to-cyan-500 text-white px-4 py-2 border-b border-blue-700 flex items-center justify-between">
                                    <div className="font-bold">Đang sửa trainer</div>
                                    <button
                                        type="button"
                                        onClick={resetForm}
                                        className="px-2 py-1 text-xs font-bold rounded bg-white/15 hover:bg-white/25"
                                    >
                                        Đóng
                                    </button>
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className={`space-y-4 border border-slate-200 rounded p-4 bg-slate-50 ${isEditingTrainer ? 'rounded-t-none border-x-0 border-b-0' : ''}`}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên Trainer</label>
                                        <input
                                            type="text"
                                            value={form.name}
                                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Ảnh Trainer</label>
                                        <ImageUpload
                                            currentImage={form.imageUrl}
                                            onUploadSuccess={(url) => setForm({ ...form, imageUrl: Array.isArray(url) ? (url[0] || '') : (url || '') })}
                                        />
                                        <input
                                            type="text"
                                            value={form.imageUrl}
                                            onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                                            className="mt-2 w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            placeholder="/assets/08_trainer_female.png"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Lời thoại</label>
                                    <input
                                        type="text"
                                        value={form.quote}
                                        onChange={(e) => setForm({ ...form, quote: e.target.value })}
                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Thứ tự</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={form.orderIndex}
                                            onChange={(e) => setForm({ ...form, orderIndex: parseInt(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Trạng thái</label>
                                        <select
                                            value={form.isActive ? 'active' : 'inactive'}
                                            onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        >
                                            <option value="active">Hoạt động</option>
                                            <option value="inactive">Ẩn</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Pokémon thưởng</label>
                                        <div className="space-y-2">
                                            <button
                                                type="button"
                                                onClick={handleOpenPrizePokemonModal}
                                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm text-left hover:border-blue-400 transition-colors"
                                            >
                                                {selectedPrizePokemon
                                                    ? `#${String(selectedPrizePokemon.pokedexNumber || 0).padStart(3, '0')} - ${selectedPrizePokemon.name}${selectedPrizePokemonForm && !selectedPrizePokemonForm.isDefault ? ` (${selectedPrizePokemonForm.formName || selectedPrizePokemonForm.formId})` : ''}`
                                                    : (form.prizePokemonId ? 'Pokemon đã chọn không còn trong danh sách' : 'Chọn Pokemon phần thưởng')}
                                            </button>
                                            {selectedPrizePokemon && (
                                                <div className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <img
                                                            src={selectedPrizePokemonForm?.resolvedImageUrl || getPokemonImageUrl(selectedPrizePokemon)}
                                                            alt={selectedPrizePokemon.name}
                                                            className="w-8 h-8 object-contain pixelated"
                                                        />
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-semibold text-slate-700 truncate">{selectedPrizePokemon.name}</div>
                                                            <div className="text-[11px] text-slate-500 font-mono">#{String(selectedPrizePokemon.pokedexNumber || 0).padStart(3, '0')}</div>
                                                            {selectedPrizePokemonForm && (
                                                                <div className="mt-1">
                                                                    <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 border border-blue-200">
                                                                        Dạng: {selectedPrizePokemonForm.formName || selectedPrizePokemonForm.formId}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={handleClearPrizePokemon}
                                                        className="px-2 py-1 text-[11px] font-bold bg-red-50 border border-red-200 text-red-700 rounded"
                                                    >
                                                        Bỏ chọn
                                                    </button>
                                                </div>
                                            )}
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                                                    Cấp Pokémon thưởng (0 = auto Lv 5)
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={form.prizePokemonLevel}
                                                    onChange={(e) => setForm((prev) => ({
                                                        ...prev,
                                                        prizePokemonLevel: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                                                    }))}
                                                    disabled={!form.prizePokemonId}
                                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm disabled:bg-slate-100 disabled:text-slate-400"
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Vật phẩm thưởng</label>
                                        <select
                                            value={form.prizeItemId}
                                            onChange={(e) => {
                                                const nextItemId = e.target.value
                                                setForm((prev) => ({
                                                    ...prev,
                                                    prizeItemId: nextItemId,
                                                    prizeItemQuantity: nextItemId ? Math.max(1, Number.parseInt(prev.prizeItemQuantity, 10) || 1) : 1,
                                                }))
                                            }}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                        >
                                            <option value="">Không có vật phẩm thưởng</option>
                                            {items.map((entry) => (
                                                <option key={entry._id} value={entry._id}>{entry.name}</option>
                                            ))}
                                        </select>
                                        {form.prizeItemId && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={form.prizeItemQuantity}
                                                    onChange={(e) => setForm({ ...form, prizeItemQuantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1) })}
                                                    className="w-24 px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                                />
                                                <span className="text-xs text-slate-500">Số lượng</span>
                                            </div>
                                        )}
                                        {selectedPrizeItem && (
                                            <div className="mt-2 text-xs text-slate-600">Đã chọn: {selectedPrizeItem.name}</div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">🪙 Xu Bạch Kim</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={form.platinumCoinsReward}
                                            onChange={(e) => setForm({ ...form, platinumCoinsReward: parseInt(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            placeholder="0"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">⭐ EXP Huấn Luyện Viên</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={form.expReward}
                                            onChange={(e) => setForm({ ...form, expReward: parseInt(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            placeholder="0 = dùng công thức mặc định"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">🌑 Điểm Nguyệt Các</label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={form.moonPointsReward}
                                            onChange={(e) => setForm({ ...form, moonPointsReward: parseInt(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                            placeholder="0 = dùng công thức mặc định"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-slate-700 text-xs font-bold uppercase">Đội hình</label>
                                        <div className="flex flex-wrap gap-2 justify-end">
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    min="-100"
                                                    max="900"
                                                    value={teamDamagePercentBulk}
                                                    onChange={(e) => setTeamDamagePercentBulk(e.target.value)}
                                                    className="w-24 px-2 py-1 text-xs border border-slate-300 rounded"
                                                    placeholder="+/- %"
                                                    title="% tăng/giảm thêm sát thương cho toàn team"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleApplyDamagePercentToAllTeam}
                                                    className="px-2 py-1 text-xs font-bold bg-violet-600 text-white rounded"
                                                >
                                                    Áp dụng toàn team
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setForm((prev) => ({ ...prev, team: buildRandomTeam() }))}
                                                className="px-2 py-1 text-xs font-bold bg-emerald-600 text-white rounded"
                                            >
                                                Random đội hình
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleAddTeam}
                                                className="px-2 py-1 text-xs font-bold bg-blue-600 text-white rounded"
                                            >
                                                + Thêm Pokémon
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mb-2 text-[11px] text-slate-500">
                                        Cột thứ 3 là <span className="font-semibold">% tăng/giảm thêm sát thương NPC</span> (10 = tăng thêm 10%, 0 = bình thường, -20 = giảm 20%).
                                    </div>
                                    <div className="space-y-2">
                                        <div className="hidden md:grid md:grid-cols-5 gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            <div>Pokémon</div>
                                            <div>Level</div>
                                            <div>% thêm sát thương</div>
                                            <div>Form</div>
                                            <div>Thao tác</div>
                                        </div>
                                        {form.team.map((entry, index) => {
                                            const selectedPokemon = pokemon.find((p) => p._id === entry.pokemonId)
                                                || teamPokemonLookup[entry.pokemonId]
                                                || null
                                            const selectedForms = selectedPokemon ? getPokemonFormsForDisplay(selectedPokemon) : []
                                            const normalizedFormId = normalizePokemonFormId(entry.formId)
                                            const selectedForm = selectedForms.find((row) => row.formId === normalizedFormId)
                                                || selectedForms[0]
                                                || null

                                            return (
                                                <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleOpenTeamPokemonModal(index)}
                                                        className="px-3 py-2 bg-white border border-slate-300 rounded text-sm text-left hover:border-blue-400 transition-colors"
                                                    >
                                                        {selectedPokemon
                                                            ? `#${String(selectedPokemon.pokedexNumber || 0).padStart(3, '0')} - ${selectedPokemon.name}${selectedForm && !selectedForm.isDefault ? ` (${selectedForm.formName || selectedForm.formId})` : ''}`
                                                            : 'Chọn Pokémon đội hình'}
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={entry.level}
                                                        onChange={(e) => handleUpdateTeam(index, 'level', parseInt(e.target.value, 10) || 1)}
                                                        className="px-2 py-2 border border-slate-300 rounded text-sm"
                                                        title="Level Pokémon đội hình"
                                                        placeholder="Lv"
                                                    />
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            min="-100"
                                                            max="900"
                                                            value={rawDamagePercentToBonus(entry?.damagePercent)}
                                                            onChange={(e) => handleUpdateTeam(index, 'damagePercent', damageBonusToRawPercent(e.target.value))}
                                                            className="w-full px-2 py-2 pr-7 border border-slate-300 rounded text-sm"
                                                            title="% tăng/giảm thêm sát thương Pokémon NPC gây ra"
                                                            placeholder="% thêm"
                                                        />
                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
                                                    </div>
                                                    <div className="px-2 py-1 border border-slate-200 rounded bg-white flex items-center justify-between gap-2 min-h-[38px]">
                                                        {selectedPokemon ? (
                                                            <>
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <img
                                                                        src={selectedForm?.resolvedImageUrl || getPokemonImageUrl(selectedPokemon)}
                                                                        alt={selectedPokemon.name}
                                                                        className="w-7 h-7 object-contain pixelated shrink-0"
                                                                    />
                                                                    <span className="text-[11px] text-slate-600 truncate">
                                                                        {selectedForm?.formName || selectedForm?.formId || 'normal'}
                                                                    </span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleClearTeamPokemon(index)}
                                                                    className="px-1.5 py-0.5 text-[10px] font-bold bg-red-50 border border-red-200 text-red-700 rounded shrink-0"
                                                                >
                                                                    Bỏ
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <span className="text-[11px] text-slate-400">Chưa chọn Pokémon</span>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveTeam(index)}
                                                        className="px-2 py-1 text-xs font-bold bg-red-500 text-white rounded"
                                                    >
                                                        Xóa
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="submit"
                                        className="px-4 py-2 bg-blue-600 text-white font-bold rounded"
                                    >
                                        {editingId ? 'Lưu trainer' : 'Tạo trainer'}
                                    </button>
                                    {editingId ? (
                                        <button
                                            type="button"
                                            onClick={resetForm}
                                            className="px-4 py-2 bg-white border border-slate-300 rounded font-bold"
                                        >
                                            Hủy
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setShowCreateTrainerForm(false)}
                                            className="px-4 py-2 bg-white border border-slate-300 rounded font-bold"
                                        >
                                            Thu gọn
                                        </button>
                                    )}
                                </div>
                            </form>
                        </div>
                    </div>
                )}
                <div className="mt-6">
                    <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm font-bold text-slate-700">
                            Danh sách trainer ({trainerPagination.total})
                            {trainerPagination.total > 0 && (
                                <span className="ml-1 text-xs text-slate-500 font-medium">
                                    [{trainerPageStart}-{trainerPageEnd}]
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleResetBattleTrainerHistory}
                                disabled={resettingHistory || deletingAutoGenerated || deletingAll || loading}
                                className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {resettingHistory ? 'Đang reset lịch sử...' : 'Reset lịch sử đi tháp'}
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteAutoGenerated}
                                disabled={deletingAutoGenerated || deletingAll || resettingHistory || loading || autoGeneratedTrainerCount === 0}
                                className="px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {deletingAutoGenerated
                                    ? 'Đang xóa auto...'
                                    : `Xóa trainer auto (${autoGeneratedTrainerCount})`}
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteAll}
                                disabled={deletingAll || deletingAutoGenerated || resettingHistory || loading || trainerPagination.total === 0}
                                className="px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {deletingAll ? 'Đang xóa tất cả...' : 'Xóa toàn bộ trainer'}
                            </button>
                        </div>
                    </div>
                    {loading ? (
                        <div className="text-sm text-slate-500">Đang tải...</div>
                    ) : (
                        <div className="space-y-3">
                            {trainers.length === 0 && (
                                <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded p-4 text-center">
                                    Chưa có trainer nào ở trang hiện tại.
                                </div>
                            )}
                            {trainers.map((trainer) => (
                                <div key={trainer._id} className="border border-slate-200 rounded p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                        {trainer.imageUrl ? (
                                            <img src={trainer.imageUrl} className="w-12 h-12 object-contain pixelated" />
                                        ) : (
                                            <div className="w-12 h-12 bg-slate-100 border border-slate-200 rounded" />
                                        )}
                                        <div>
                                            <div className="font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                                                <span>{trainer.name}</span>
                                                {trainer.autoGenerated && (
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                        AUTO {trainer.milestoneLevel ? `Lv ${trainer.milestoneLevel}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-500">{trainer.team?.length || 0} Pokémon • Order: {trainer.orderIndex ?? 0}</div>
                                            <div className="mt-1.5 text-[11px] text-slate-700 space-y-0.5">
                                                <div>
                                                    Pokémon thưởng: {trainer.prizePokemonId?.name
                                                        ? `${trainer.prizePokemonId.name}${trainer.prizePokemonFormId && trainer.prizePokemonFormId !== 'normal' ? ` (${trainer.prizePokemonFormId})` : ''}`
                                                        : 'Không có'}
                                                </div>
                                                <div>
                                                    Cấp Pokémon thưởng: {Math.max(0, Number(trainer.prizePokemonLevel) || 0) > 0
                                                        ? `Lv ${Math.max(1, Number(trainer.prizePokemonLevel) || 1)}`
                                                        : 'Auto Lv 5'}
                                                </div>
                                                <div>
                                                    Item thưởng: {trainer.prizeItemId?.name
                                                        ? `${trainer.prizeItemId.name} x${Math.max(1, Number(trainer.prizeItemQuantity) || 1)}`
                                                        : 'Không có'}
                                                </div>
                                                <div>
                                                    Thưởng: +{Math.max(0, Number(trainer.platinumCoinsReward) || 0)} Xu • +{Math.max(0, Number(trainer.expReward) || 0)} EXP • +{Math.max(0, Number(trainer.moonPointsReward) || 0)} Nguyệt Các
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleEdit(trainer)}
                                            className="px-2 py-1 text-xs font-bold bg-green-600 text-white rounded"
                                        >
                                            Sửa / Setup
                                        </button>
                                        <button
                                            onClick={() => handleDelete(trainer._id)}
                                            className="px-2 py-1 text-xs font-bold bg-red-500 text-white rounded"
                                        >
                                            Xóa
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {trainerPagination.pages > 1 && (
                                <div className="pt-2 flex flex-wrap items-center justify-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setTrainerPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                                        disabled={trainerPagination.page <= 1 || loading}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    {trainerPageItems.map((item, index) => (
                                        item === '...'
                                            ? <span key={`trainer-ellipsis-${index}`} className="px-1 text-xs text-slate-400">...</span>
                                            : (
                                                <button
                                                    key={`trainer-page-${item}`}
                                                    type="button"
                                                    onClick={() => setTrainerPagination((prev) => ({ ...prev, page: item }))}
                                                    className={`min-w-[32px] px-2 py-1 text-xs font-bold rounded border ${item === trainerPagination.page
                                                        ? 'bg-blue-600 text-white border-blue-700'
                                                        : 'bg-white text-slate-700 border-slate-300 hover:bg-blue-50 hover:border-blue-300'}`}
                                                >
                                                    {item}
                                                </button>
                                            )
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setTrainerPagination((prev) => ({
                                            ...prev,
                                            page: Math.min(prev.pages, prev.page + 1),
                                        }))}
                                        disabled={trainerPagination.page >= trainerPagination.pages || loading}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Sau
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="text-center mt-6 p-4">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>

            {showAutoPrizePokemonModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[65] p-4 animate-fadeIn"
                    onClick={() => setShowAutoPrizePokemonModal(false)}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Chọn Pokémon thưởng random</h3>
                                <p className="text-xs text-slate-500 mt-0.5">Chọn nhiều Pokémon để làm pool random cho trainer auto-generated</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAutoPrizePokemonModal(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokémon</label>
                                    <input
                                        type="text"
                                        value={autoPrizePokemonSearchTerm}
                                        onChange={(e) => {
                                            setAutoPrizePokemonSearchTerm(e.target.value)
                                            setAutoPrizePokemonPage(1)
                                        }}
                                        placeholder="Nhập tên, số Pokedex hoặc ID"
                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Lọc theo dạng</label>
                                    <select
                                        value={autoPrizePokemonFormFilter}
                                        onChange={(e) => {
                                            setAutoPrizePokemonFormFilter(e.target.value)
                                            setAutoPrizePokemonPage(1)
                                        }}
                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm"
                                    >
                                        <option value="">Tất cả dạng</option>
                                        {autoPrizePokemonFormOptions.map((entry) => (
                                            <option key={`auto-prize-form-filter-${entry.formId}`} value={entry.formId}>
                                                {entry.formName} ({entry.count})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={selectAllFilteredAutoPrizePokemon}
                                    className="px-3 py-1.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                                >
                                    Chọn tất cả theo lọc
                                </button>
                                <button
                                    type="button"
                                    onClick={clearAutoPrizePokemon}
                                    disabled={autoPrizePokemonSelectionSet.size === 0}
                                    className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Bỏ chọn hết
                                </button>
                                <span className="text-xs text-slate-500">Đang chọn: {autoPrizePokemonSelectionSet.size}</span>
                            </div>

                            <div
                                className={`rounded border px-3 py-2 text-[11px] leading-relaxed ${autoPrizeRepeatPreview.willRepeat
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
                            >
                                {autoPrizeRepeatPreview.isRewardConfigEnabled ? (
                                    <>
                                        <div className="font-semibold">
                                            Trạng thái lặp thưởng: {autoPrizeRepeatPreview.willRepeat ? 'Có thể bị lặp' : 'Không bị lặp'} (theo cấu hình hiện tại)
                                        </div>
                                        <div>
                                            Dự kiến có {autoPrizeRepeatPreview.rewardTrainerCount} trainer nhận Pokémon thưởng, pool hiện có {autoPrizeRepeatPreview.poolSize} lựa chọn.
                                            {autoPrizeRepeatPreview.willRepeat
                                                ? ` Vượt pool ${autoPrizeRepeatPreview.repeatCount} lượt nên sẽ bắt đầu lặp sau khi dùng hết 1 vòng.`
                                                : ' Số lượt thưởng không vượt pool nên chưa lặp.'}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="font-semibold">Trạng thái lặp thưởng: Chưa đủ dữ liệu để tính</div>
                                        <div>
                                            Hãy chọn pool Pokémon thưởng và nhập "Cách nhau bao nhiêu trainer" lớn hơn 0 để hệ thống dự đoán có bị lặp hay không.
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {autoPrizePokemonTotal === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokémon phù hợp</div>
                                ) : (
                                    autoPrizePokemonPageRows.map((row) => {
                                        const { pokemon: entry, form: rowForm } = row
                                        const pokemonId = String(entry?._id || '').trim()
                                        if (!pokemonId) return null
                                        const selectionKey = String(row?.selectionKey || '').trim()
                                        const selected = selectionKey && autoPrizePokemonSelectionSet.has(selectionKey)
                                        return (
                                            <label key={`auto-prize-${row.key}`} className={`w-full px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors ${selected ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleAutoPrizePokemon(pokemonId, rowForm?.formId)}
                                                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <div className="w-10 h-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                                                    <img
                                                        src={rowForm?.resolvedImageUrl || getPokemonImageUrl(entry)}
                                                        alt={entry?.name || pokemonId}
                                                        className="w-8 h-8 object-contain pixelated"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-semibold text-slate-700 truncate">#{String(entry?.pokedexNumber || 0).padStart(3, '0')} - {entry?.name || pokemonId}</div>
                                                    <div className="mt-1">
                                                        <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border ${rowForm?.isDefault
                                                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                            : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                                            {rowForm?.formName || rowForm?.formId || 'normal'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <span className={`text-[11px] font-bold rounded px-2 py-0.5 border ${selected ? 'text-emerald-700 bg-emerald-100 border-emerald-200' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                                                    {selected ? 'Đã chọn' : 'Chọn'}
                                                </span>
                                            </label>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-slate-500">
                                <span>
                                    Kết quả: {autoPrizePokemonPageStart}-{autoPrizePokemonPageEnd} / {autoPrizePokemonTotal}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setAutoPrizePokemonPage((prev) => Math.max(1, prev - 1))}
                                        disabled={safeAutoPrizePokemonPage <= 1}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">Trang {safeAutoPrizePokemonPage}/{autoPrizePokemonTotalPages}</span>
                                    <button
                                        type="button"
                                        onClick={() => setAutoPrizePokemonPage((prev) => Math.min(autoPrizePokemonTotalPages, prev + 1))}
                                        disabled={safeAutoPrizePokemonPage >= autoPrizePokemonTotalPages}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Sau
                                    </button>
                                </div>
                            </div>

                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs font-semibold text-slate-700">Thiết lập level cho Pokémon đã chọn</div>
                                {autoPrizePokemonSelectedRows.length === 0 ? (
                                    <div className="mt-1 text-xs text-slate-500">Chưa chọn Pokémon nào trong pool random.</div>
                                ) : (
                                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1.5">
                                        {autoPrizePokemonSelectedRows.map((entry) => {
                                            const selectionKey = String(entry?.selectionKey || '').trim()
                                            if (!selectionKey) return null
                                            const pokemonName = String(entry?.pokemon?.name || '').trim() || 'Pokemon'
                                            const formLabel = String(entry?.form?.formName || entry?.form?.formId || 'normal').trim()
                                            const levelValue = Math.max(0, Number(entry?.level) || 0)
                                            return (
                                                <div key={`auto-prize-level-${selectionKey}`} className="flex items-center justify-between gap-2 text-xs">
                                                    <div className="min-w-0 text-slate-700 truncate">
                                                        {pokemonName}
                                                        {formLabel && formLabel.toLowerCase() !== 'normal' ? ` (${formLabel})` : ''}
                                                    </div>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <span className="text-slate-500">Lv</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="1000"
                                                            value={levelValue}
                                                            onChange={(e) => updateAutoPrizePokemonLevel(selectionKey, e.target.value)}
                                                            className="w-20 px-2 py-1 border border-slate-300 rounded bg-white text-slate-700"
                                                        />
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                                <div className="mt-2 text-[11px] text-slate-500">Lv 0 = giữ mặc định hệ thống (Auto Lv 5).</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showPrizePokemonModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fadeIn"
                    onClick={() => setShowPrizePokemonModal(false)}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Chọn Pokemon phần thưởng</h3>
                            <button
                                type="button"
                                onClick={() => setShowPrizePokemonModal(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokemon</label>
                                <input
                                    type="text"
                                    value={prizePokemonSearchTerm}
                                    onChange={(e) => {
                                        setPrizePokemonSearchTerm(e.target.value)
                                        setPrizePokemonPage(1)
                                        setPrizePokemonFormPage(1)
                                    }}
                                    placeholder="Nhập tên hoặc số Pokedex #"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                <button
                                    type="button"
                                    onClick={() => handleSelectPrizePokemon('', 'normal')}
                                    className={`w-full px-3 py-2 text-left text-sm font-semibold transition-colors ${!form.prizePokemonId ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'}`}
                                >
                                    Không có Pokemon phần thưởng
                                </button>

                                {prizePokemonLoading ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải danh sách Pokemon...</div>
                                ) : prizePokemonLoadError ? (
                                    <div className="px-3 py-4 text-sm text-red-600 text-center">{prizePokemonLoadError}</div>
                                ) : prizePokemonFormRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokemon phù hợp</div>
                                ) : (
                                    prizePokemonFormRows.map((row) => {
                                        const { pokemon: entry, form: rowForm } = row
                                        const isSelected = form.prizePokemonId === entry._id
                                            && normalizedPrizePokemonFormId === rowForm.formId
                                        const isUsedInCurrentTrainer = selectedPrizePokemonIdsInCurrentForm.has(entry._id)
                                        const isUsedInOtherTrainer = selectedPrizePokemonIdsInOtherTrainers.has(entry._id)
                                        const showPickedTag = !isSelected && (isUsedInCurrentTrainer || isUsedInOtherTrainer)
                                        const pickedTagText = isUsedInCurrentTrainer && isUsedInOtherTrainer
                                            ? 'Đã chọn (trainer này + khác)'
                                            : isUsedInCurrentTrainer
                                                ? 'Đã chọn (trainer này)'
                                                : 'Đã chọn (trainer khác)'
                                        const pickedTagClassName = isUsedInCurrentTrainer
                                            ? 'text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-2 py-0.5'
                                            : 'text-[11px] font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5'
                                        return (
                                            <button
                                                key={row.key}
                                                type="button"
                                                onClick={() => handleSelectPrizePokemon(entry._id, rowForm.formId)}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${isSelected ? 'bg-blue-50' : showPickedTag ? (isUsedInCurrentTrainer ? 'bg-emerald-50/60' : 'bg-amber-50/70') : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={rowForm.resolvedImageUrl || getPokemonImageUrl(entry)}
                                                        alt={entry.name}
                                                        className="w-8 h-8 object-contain pixelated"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-mono text-xs text-slate-500 flex-shrink-0">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</span>
                                                        <span className="font-semibold text-slate-700 truncate">{entry.name}</span>
                                                    </div>
                                                    <div className="mt-1">
                                                        <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border ${rowForm.isDefault
                                                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                            : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                                            {rowForm.formName || rowForm.formId}
                                                        </span>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <span className="text-[11px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded px-2 py-0.5">Đã chọn</span>
                                                )}
                                                {!isSelected && showPickedTag && (
                                                    <span className={pickedTagClassName}>{pickedTagText}</span>
                                                )}
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="space-y-2 text-xs text-slate-500">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span>
                                        Dạng: {prizePokemonFormPageStart}-{prizePokemonFormPageEnd} / {prizePokemonFormTotal}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPrizePokemonFormPage((prev) => Math.max(1, prev - 1))}
                                            disabled={safePrizePokemonFormPage <= 1 || prizePokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Trước dạng
                                        </button>
                                        <span className="font-semibold text-slate-600">
                                            Trang dạng {safePrizePokemonFormPage}/{prizePokemonFormTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setPrizePokemonFormPage((prev) => Math.min(prizePokemonFormTotalPages, prev + 1))}
                                            disabled={safePrizePokemonFormPage >= prizePokemonFormTotalPages || prizePokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Sau dạng
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span>
                                        Loài: {prizePokemonPageStart}-{prizePokemonPageEnd} / {prizePokemonTotal}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPrizePokemonPage((prev) => Math.max(1, prev - 1))
                                                setPrizePokemonFormPage(1)
                                            }}
                                            disabled={prizePokemonPage <= 1 || prizePokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Trước loài
                                        </button>
                                        <span className="font-semibold text-slate-600">
                                            Trang loài {prizePokemonPage}/{prizePokemonTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPrizePokemonPage((prev) => Math.min(prizePokemonTotalPages, prev + 1))
                                                setPrizePokemonFormPage(1)
                                            }}
                                            disabled={prizePokemonPage >= prizePokemonTotalPages || prizePokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Sau loài
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showTeamPokemonModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fadeIn"
                    onClick={() => {
                        setShowTeamPokemonModal(false)
                        setTeamPokemonTargetIndex(-1)
                    }}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Chọn Pokémon đội hình</h3>
                                <p className="text-xs text-slate-500 mt-0.5">Slot #{Math.max(1, Number(teamPokemonTargetIndex) + 1)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowTeamPokemonModal(false)
                                    setTeamPokemonTargetIndex(-1)
                                }}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokémon đội hình</label>
                                <input
                                    type="text"
                                    value={teamPokemonSearchTerm}
                                    onChange={(e) => {
                                        setTeamPokemonSearchTerm(e.target.value)
                                        setTeamPokemonPage(1)
                                        setTeamPokemonFormPage(1)
                                    }}
                                    placeholder="Nhập tên hoặc số Pokedex #"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                <button
                                    type="button"
                                    onClick={() => handleSelectTeamPokemon('', 'normal')}
                                    className={`w-full px-3 py-2 text-left text-sm font-semibold transition-colors ${!activeTeamEntry?.pokemonId ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'}`}
                                >
                                    Không chọn Pokémon cho slot này
                                </button>

                                {teamPokemonLoading ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải danh sách Pokémon...</div>
                                ) : teamPokemonLoadError ? (
                                    <div className="px-3 py-4 text-sm text-red-600 text-center">{teamPokemonLoadError}</div>
                                ) : teamPokemonFormRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokémon phù hợp</div>
                                ) : (
                                    teamPokemonFormRows.map((row) => {
                                        const { pokemon: entry, form: rowForm } = row
                                        const isSelected = activeTeamEntry?.pokemonId === entry._id
                                            && normalizedTeamPokemonFormId === rowForm.formId
                                        const isUsedInCurrentTrainer = selectedPokemonIdsInCurrentForm.has(entry._id)
                                        const isUsedInOtherTrainer = selectedPokemonIdsInOtherTrainers.has(entry._id)
                                        const showPickedTag = !isSelected && (isUsedInCurrentTrainer || isUsedInOtherTrainer)
                                        const pickedTagText = isUsedInCurrentTrainer && isUsedInOtherTrainer
                                            ? 'Đã chọn (trainer này + khác)'
                                            : isUsedInCurrentTrainer
                                                ? 'Đã chọn (trainer này)'
                                                : 'Đã chọn (trainer khác)'
                                        const pickedTagClassName = isUsedInCurrentTrainer
                                            ? 'text-[11px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-2 py-0.5'
                                            : 'text-[11px] font-bold text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5'
                                        return (
                                            <button
                                                key={`team-${row.key}`}
                                                type="button"
                                                onClick={() => handleSelectTeamPokemon(entry._id, rowForm.formId)}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${isSelected ? 'bg-blue-50' : showPickedTag ? (isUsedInCurrentTrainer ? 'bg-emerald-50/60' : 'bg-amber-50/70') : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={rowForm.resolvedImageUrl || getPokemonImageUrl(entry)}
                                                        alt={entry.name}
                                                        className="w-8 h-8 object-contain pixelated"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-mono text-xs text-slate-500 flex-shrink-0">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</span>
                                                        <span className="font-semibold text-slate-700 truncate">{entry.name}</span>
                                                    </div>
                                                    <div className="mt-1">
                                                        <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border ${rowForm.isDefault
                                                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                            : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                                            {rowForm.formName || rowForm.formId}
                                                        </span>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <span className="text-[11px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded px-2 py-0.5">Đã chọn</span>
                                                )}
                                                {!isSelected && showPickedTag && (
                                                    <span className={pickedTagClassName}>{pickedTagText}</span>
                                                )}
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="space-y-2 text-xs text-slate-500">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span>
                                        Dạng: {teamPokemonFormPageStart}-{teamPokemonFormPageEnd} / {teamPokemonFormTotal}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setTeamPokemonFormPage((prev) => Math.max(1, prev - 1))}
                                            disabled={safeTeamPokemonFormPage <= 1 || teamPokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Trước dạng
                                        </button>
                                        <span className="font-semibold text-slate-600">
                                            Trang dạng {safeTeamPokemonFormPage}/{teamPokemonFormTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setTeamPokemonFormPage((prev) => Math.min(teamPokemonFormTotalPages, prev + 1))}
                                            disabled={safeTeamPokemonFormPage >= teamPokemonFormTotalPages || teamPokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Sau dạng
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span>
                                        Loài: {teamPokemonPageStart}-{teamPokemonPageEnd} / {teamPokemonTotal}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTeamPokemonPage((prev) => Math.max(1, prev - 1))
                                                setTeamPokemonFormPage(1)
                                            }}
                                            disabled={teamPokemonPage <= 1 || teamPokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Trước loài
                                        </button>
                                        <span className="font-semibold text-slate-600">
                                            Trang loài {teamPokemonPage}/{teamPokemonTotalPages}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTeamPokemonPage((prev) => Math.min(teamPokemonTotalPages, prev + 1))
                                                setTeamPokemonFormPage(1)
                                            }}
                                            disabled={teamPokemonPage >= teamPokemonTotalPages || teamPokemonLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Sau loài
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {selectedTeamPokemon && (
                                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                    Đang chọn cho slot này: <span className="font-bold text-slate-800">{selectedTeamPokemon.name}</span>
                                    {selectedTeamPokemonForm && (
                                        <span className="ml-1">({selectedTeamPokemonForm.formName || selectedTeamPokemonForm.formId})</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
