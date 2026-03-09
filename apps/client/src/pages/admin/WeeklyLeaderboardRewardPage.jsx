import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../../services/gameApi'
import { leaderboardRewardApi, userApi } from '../../services/adminApi'
import { uploadToCloudinary } from '../../utils/cloudinaryUtils'

const MODE_OPTIONS = [
    { value: 'wealth', label: 'Top Tài Phú Tuần' },
    { value: 'trainerBattle', label: 'Top Leo Tháp Tuần' },
    { value: 'lc', label: 'Top LC Party Tuần' },
]

const REWARD_TYPE_OPTIONS = [
    { value: 'platinumCoins', label: 'Xu Bạch Kim' },
    { value: 'moonPoints', label: 'Điểm Nguyệt Các' },
    { value: 'item', label: 'Vật phẩm' },
    { value: 'pokemon', label: 'Pokemon' },
    { value: 'titleImage', label: 'Danh hiệu ảnh' },
    { value: 'avatarFrame', label: 'Khung avatar' },
]

const DEFAULT_POKEMON_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
const POKEMON_MODAL_PAGE_SIZE = 40
const COSMETIC_CONFIG_RANKS = [1, 2, 3]

const normalizeFormId = (value = 'normal') => String(value || 'normal').trim().toLowerCase() || 'normal'

const numberFormat = (value) => {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized)) return '0'
    return normalized.toLocaleString('vi-VN')
}

const formatDateTime = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('vi-VN')
}

const getDefaultRewardAmount = (rank, rewardType = 'platinumCoins') => {
    if (rewardType === 'item' || rewardType === 'pokemon' || rewardType === 'titleImage' || rewardType === 'avatarFrame') return 1
    const safeRank = Math.max(1, Number.parseInt(rank, 10) || 1)
    if (safeRank === 1) return 10000
    if (safeRank === 2) return 7000
    if (safeRank === 3) return 5000
    if (safeRank <= 10) return 2000
    return 1000
}

const getPrimaryLabelByMode = (mode) => {
    if (mode === 'trainerBattle') return 'Top Leo Tháp'
    if (mode === 'lc') return 'Tổng LC Party'
    return 'Xu BK Kiếm Được Tuần'
}

const getPrimaryValueByMode = (mode, row = {}) => {
    if (mode === 'trainerBattle') {
        return Math.max(0, Number(row?.weeklyTrainerBattleLevels ?? row?.trainerBattleLevel ?? 0))
    }
    if (mode === 'lc') {
        return Math.max(0, Number(row?.combatPower ?? 0))
    }
    return Math.max(0, Number(row?.weeklyPlatinumCoins ?? row?.platinumCoins ?? 0))
}

const formatRewardSummary = (entry = {}) => {
    const rewardType = String(entry?.rewardType || 'platinumCoins').trim()
    const amount = Math.max(0, Number(entry?.rewardAmount || 0))

    if (rewardType === 'moonPoints') {
        return `${numberFormat(amount)} Điểm Nguyệt Các`
    }
    if (rewardType === 'item') {
        return `${numberFormat(amount)} ${entry?.rewardItemNameSnapshot || 'vật phẩm'}`
    }
    if (rewardType === 'pokemon') {
        const pokemonName = entry?.rewardPokemonNameSnapshot || 'Pokemon'
        const level = Math.max(1, Number(entry?.rewardPokemonLevel || 1))
        const shinyText = entry?.rewardPokemonIsShiny ? ' (Shiny)' : ''
        return `${numberFormat(amount)} ${pokemonName} Lv.${numberFormat(level)}${shinyText}`
    }
    if (rewardType === 'titleImage') {
        return amount > 1 ? `${numberFormat(amount)} ảnh danh hiệu` : 'Ảnh danh hiệu'
    }
    if (rewardType === 'avatarFrame') {
        return amount > 1 ? `${numberFormat(amount)} ảnh khung avatar` : 'Ảnh khung avatar'
    }
    return `${numberFormat(amount)} Xu BK`
}

const getRewardAmountLabel = (rewardType) => {
    if (rewardType === 'moonPoints') return 'Điểm Nguyệt'
    if (rewardType === 'item') return 'SL vật phẩm'
    if (rewardType === 'pokemon') return 'SL Pokémon'
    if (rewardType === 'titleImage') return 'Ảnh danh hiệu'
    if (rewardType === 'avatarFrame') return 'Ảnh khung avatar'
    return 'Xu BK'
}

const getRewardTypeLabel = (rewardType) => {
    if (rewardType === 'moonPoints') return 'Điểm Nguyệt'
    if (rewardType === 'item') return 'Vật phẩm'
    if (rewardType === 'pokemon') return 'Pokemon'
    if (rewardType === 'titleImage') return 'Danh hiệu ảnh'
    if (rewardType === 'avatarFrame') return 'Khung avatar'
    return 'Xu BK'
}

const isCosmeticRewardType = (rewardType) => rewardType === 'titleImage' || rewardType === 'avatarFrame'

const validateImageFile = (file) => {
    if (!file) return 'Chưa chọn tệp ảnh'
    const maxBytes = 10 * 1024 * 1024
    if (Number(file.size || 0) <= 0) return 'Tệp ảnh không hợp lệ'
    if (Number(file.size || 0) > maxBytes) return 'Ảnh vượt quá 10MB'
    if (!String(file.type || '').startsWith('image/')) return 'Vui lòng chọn tệp ảnh'
    return ''
}

const buildRewardStatusByUserId = (rewardRows = [], modeFilter = '') => {
    const normalizedModeFilter = String(modeFilter || '').trim()
    const map = {}
    for (const entry of rewardRows) {
        if (normalizedModeFilter) {
            const entryMode = String(entry?.mode || '').trim()
            if (entryMode !== normalizedModeFilter) {
                continue
            }
        }

        const userId = String(entry?.userId || '').trim()
        if (!userId) continue
        if (!map[userId]) {
            map[userId] = {
                entries: [],
                byType: {},
            }
        }
        map[userId].entries.push(entry)
        const typeKey = String(entry?.rewardType || '').trim() || 'platinumCoins'
        map[userId].byType[typeKey] = entry
    }

    Object.values(map).forEach((group) => {
        group.entries.sort((a, b) => {
            const aTime = new Date(a?.rewardedAt || 0).getTime()
            const bTime = new Date(b?.rewardedAt || 0).getTime()
            if (aTime !== bTime) return bTime - aTime
            return String(a?.id || '').localeCompare(String(b?.id || ''))
        })
    })

    return map
}

const createDefaultCosmeticConfigs = (mode) => COSMETIC_CONFIG_RANKS.map((rank) => ({
    id: '',
    mode,
    rank,
    titleImageUrl: '',
    avatarFrameUrl: '',
}))

const getCosmeticConfigForRank = (configs = [], rank) => {
    const safeRank = Math.max(1, Number.parseInt(rank, 10) || 1)
    return configs.find((entry) => Number(entry?.rank || 0) === safeRank) || null
}

export default function WeeklyLeaderboardRewardPage() {
    const [mode, setMode] = useState('wealth')
    const [page, setPage] = useState(1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [searchKeyword, setSearchKeyword] = useState('')
    const [searchingUsers, setSearchingUsers] = useState(false)
    const [rankings, setRankings] = useState([])
    const [searchedRankings, setSearchedRankings] = useState([])
    const [pagination, setPagination] = useState(null)
    const [period, setPeriod] = useState(null)
    const [rewardStatusByUserId, setRewardStatusByUserId] = useState({})
    const [rewardAmountByUserId, setRewardAmountByUserId] = useState({})
    const [rewardingUserId, setRewardingUserId] = useState('')
    const [revokingUserId, setRevokingUserId] = useState('')
    const [rewardedTotal, setRewardedTotal] = useState(0)
    const [selectedRewardTypes, setSelectedRewardTypes] = useState({
        platinumCoins: true,
        moonPoints: false,
        item: false,
        pokemon: false,
        titleImage: false,
        avatarFrame: false,
    })
    const [itemSearch, setItemSearch] = useState('')
    const [pokemonSearch, setPokemonSearch] = useState('')
    const [pokemonPickerOpen, setPokemonPickerOpen] = useState(false)
    const [pokemonPickerPage, setPokemonPickerPage] = useState(1)
    const [pokemonPickerTotalPages, setPokemonPickerTotalPages] = useState(1)
    const [pokemonPickerTotal, setPokemonPickerTotal] = useState(0)
    const [itemLookupLoading, setItemLookupLoading] = useState(false)
    const [pokemonLookupLoading, setPokemonLookupLoading] = useState(false)
    const [pokemonLoadError, setPokemonLoadError] = useState('')
    const [itemOptions, setItemOptions] = useState([])
    const [pokemonOptions, setPokemonOptions] = useState([])
    const [pokemonLookupById, setPokemonLookupById] = useState({})
    const [rewardItemId, setRewardItemId] = useState('')
    const [rewardPokemonId, setRewardPokemonId] = useState('')
    const [rewardPokemonFormId, setRewardPokemonFormId] = useState('normal')
    const [rewardPokemonLevel, setRewardPokemonLevel] = useState('5')
    const [rewardPokemonIsShiny, setRewardPokemonIsShiny] = useState(false)
    const [selectedCosmeticRanks, setSelectedCosmeticRanks] = useState({
        titleImage: 1,
        avatarFrame: 1,
    })
    const [cosmeticConfigs, setCosmeticConfigs] = useState(createDefaultCosmeticConfigs('wealth'))
    const [savingCosmeticConfigKey, setSavingCosmeticConfigKey] = useState('')
    const [uploadingRewardAsset, setUploadingRewardAsset] = useState({})

    const primaryLabel = useMemo(() => getPrimaryLabelByMode(mode), [mode])
    const selectedRewardTypeValues = useMemo(() => {
        return REWARD_TYPE_OPTIONS
            .map((entry) => entry.value)
            .filter((type) => Boolean(selectedRewardTypes?.[type]))
    }, [selectedRewardTypes])
    const activeSearchKeyword = String(searchKeyword || '').trim()
    const displayedRankings = activeSearchKeyword ? searchedRankings : rankings

    const loadRewardStatus = async (targetMode, weekStart) => {
        const rewardData = await leaderboardRewardApi.list({ mode: targetMode, weekStart })
        const rewardRows = Array.isArray(rewardData?.rewards) ? rewardData.rewards : []
        setRewardStatusByUserId(buildRewardStatusByUserId(rewardRows, targetMode))
        setRewardedTotal(Math.max(0, Number(rewardData?.totalRewarded || rewardRows.length || 0)))
    }

    const loadCosmeticConfigs = async (targetMode) => {
        const configData = await leaderboardRewardApi.getCosmeticConfigs(targetMode)
        const rows = Array.isArray(configData?.configs) ? configData.configs : []
        setCosmeticConfigs(rows.length > 0 ? rows : createDefaultCosmeticConfigs(targetMode))
    }

    const loadData = async (targetMode, targetPage) => {
        try {
            setLoading(true)
            setError('')

            const rankingData = await gameApi.getRankings('overall', targetPage, 35, { mode: targetMode })
            const rankingRows = Array.isArray(rankingData?.rankings) ? rankingData.rankings : []
            const rankingPeriod = rankingData?.period || null

            setRankings(rankingRows)
            setPagination(rankingData?.pagination || null)
            setPeriod(rankingPeriod)

            const weekStart = String(rankingPeriod?.weekStart || '').trim()
            await Promise.all([
                loadRewardStatus(targetMode, weekStart),
                loadCosmeticConfigs(targetMode),
            ])

            setRewardAmountByUserId((prev) => {
                const next = { ...prev }
                for (const row of rankingRows) {
                    const userId = String(row?.userId || '').trim()
                    if (!userId) continue
                    const prevUserEntry = next[userId] && typeof next[userId] === 'object' ? next[userId] : {}
                    next[userId] = {
                        platinumCoins: prevUserEntry.platinumCoins || String(getDefaultRewardAmount(row?.rank, 'platinumCoins')),
                        moonPoints: prevUserEntry.moonPoints || String(getDefaultRewardAmount(row?.rank, 'moonPoints')),
                        item: prevUserEntry.item || String(getDefaultRewardAmount(row?.rank, 'item')),
                        pokemon: prevUserEntry.pokemon || String(getDefaultRewardAmount(row?.rank, 'pokemon')),
                    }
                }
                return next
            })
        } catch (err) {
            setError(err.message || 'Không thể tải leaderboard tuần')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadData(mode, page)
    }, [mode, page])

    useEffect(() => {
        setPage(1)
    }, [mode])

    useEffect(() => {
        setSearchedRankings([])
    }, [mode])

    useEffect(() => {
        setRewardAmountByUserId((prev) => {
            const next = { ...prev }
            for (const row of rankings) {
                const userId = String(row?.userId || '').trim()
                if (!userId) continue
                const current = next[userId] && typeof next[userId] === 'object' ? next[userId] : {}
                next[userId] = {
                    platinumCoins: Number.parseInt(current.platinumCoins, 10) > 0 ? current.platinumCoins : String(getDefaultRewardAmount(row?.rank, 'platinumCoins')),
                    moonPoints: Number.parseInt(current.moonPoints, 10) > 0 ? current.moonPoints : String(getDefaultRewardAmount(row?.rank, 'moonPoints')),
                    item: Number.parseInt(current.item, 10) > 0 ? current.item : String(getDefaultRewardAmount(row?.rank, 'item')),
                    pokemon: Number.parseInt(current.pokemon, 10) > 0 ? current.pokemon : String(getDefaultRewardAmount(row?.rank, 'pokemon')),
                }
            }
            return next
        })
    }, [rankings])

    const loadItemLookup = async (searchText = '') => {
        try {
            setItemLookupLoading(true)
            const res = await leaderboardRewardApi.lookupItems({ search: searchText, limit: 80 })
            const rows = Array.isArray(res?.items) ? res.items : []
            setItemOptions(rows)
            if (!rewardItemId && rows[0]?._id) {
                setRewardItemId(String(rows[0]._id))
            }
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách vật phẩm thưởng')
        } finally {
            setItemLookupLoading(false)
        }
    }

    const loadPokemonLookup = async (searchText = '', targetPage = 1) => {
        try {
            setPokemonLookupLoading(true)
            setPokemonLoadError('')
            const res = await leaderboardRewardApi.lookupPokemon({
                search: searchText,
                page: targetPage,
                limit: POKEMON_MODAL_PAGE_SIZE,
            })
            const rows = Array.isArray(res?.pokemon) ? res.pokemon : []
            setPokemonOptions(rows)
            setPokemonPickerTotalPages(Math.max(1, Number(res?.pagination?.pages || 1)))
            setPokemonPickerTotal(Math.max(0, Number(res?.pagination?.total || 0)))
            setPokemonLookupById((prev) => {
                const next = { ...prev }
                for (const row of rows) {
                    const rowId = String(row?._id || '').trim()
                    if (rowId) next[rowId] = row
                }
                return next
            })
            if (!rewardPokemonId && rows[0]?._id) {
                const firstId = String(rows[0]._id)
                setRewardPokemonId(firstId)
                const firstFormId = normalizeFormId(rows[0]?.defaultFormId || rows[0]?.forms?.[0]?.formId || 'normal')
                setRewardPokemonFormId(firstFormId)
            }
        } catch (err) {
            setPokemonOptions([])
            setPokemonPickerTotalPages(1)
            setPokemonPickerTotal(0)
            setPokemonLoadError(err.message || 'Không thể tải danh sách Pokemon thưởng')
            setError(err.message || 'Không thể tải danh sách Pokemon thưởng')
        } finally {
            setPokemonLookupLoading(false)
        }
    }

    useEffect(() => {
        if (selectedRewardTypes.item && itemOptions.length === 0 && !itemLookupLoading) {
            loadItemLookup(itemSearch)
        }
        if (selectedRewardTypes.pokemon && pokemonOptions.length === 0 && !pokemonLookupLoading) {
            loadPokemonLookup(pokemonSearch, 1)
        }
    }, [selectedRewardTypes])

    useEffect(() => {
        if (!pokemonPickerOpen) return
        const timeout = setTimeout(() => {
            loadPokemonLookup(pokemonSearch, pokemonPickerPage)
        }, 250)
        return () => clearTimeout(timeout)
    }, [pokemonPickerOpen, pokemonSearch, pokemonPickerPage])

    const selectedPokemon = pokemonLookupById[String(rewardPokemonId || '')] || null
    const selectedPokemonForms = Array.isArray(selectedPokemon?.forms) && selectedPokemon.forms.length > 0
        ? selectedPokemon.forms
        : [{ formId: normalizeFormId(selectedPokemon?.defaultFormId || 'normal'), formName: normalizeFormId(selectedPokemon?.defaultFormId || 'normal') }]

    const selectablePokemonRows = pokemonOptions.flatMap((pokemon) => {
        const pokemonId = String(pokemon?._id || '').trim()
        if (!pokemonId) return []

        const forms = Array.isArray(pokemon?.forms) && pokemon.forms.length > 0
            ? pokemon.forms
            : [{ formId: normalizeFormId(pokemon?.defaultFormId || 'normal'), formName: normalizeFormId(pokemon?.defaultFormId || 'normal') }]
        const defaultFormId = normalizeFormId(pokemon?.defaultFormId || forms[0]?.formId || 'normal')

        return forms.map((formEntry) => {
            const formId = normalizeFormId(formEntry?.formId || defaultFormId)
            return {
                key: `${pokemonId}:${formId}`,
                pokemonId,
                formId,
                formName: formEntry?.formName || formId,
                pokemonName: pokemon?.name || 'Pokemon',
                pokedexNumber: Math.max(0, Number(pokemon?.pokedexNumber || 0)),
                imageUrl: pokemon?.sprite || DEFAULT_POKEMON_IMAGE,
                isDefault: formId === defaultFormId,
            }
        })
    })

    useEffect(() => {
        if (!selectedPokemon) return
        const normalizedCurrent = normalizeFormId(rewardPokemonFormId)
        const hasCurrent = selectedPokemonForms.some((entry) => normalizeFormId(entry?.formId) === normalizedCurrent)
        if (!hasCurrent) {
            setRewardPokemonFormId(normalizeFormId(selectedPokemonForms[0]?.formId || selectedPokemon?.defaultFormId || 'normal'))
        }
    }, [rewardPokemonId, selectedPokemon, rewardPokemonFormId])

    const handleRewardAmountChange = (userId, rewardType, value) => {
        setRewardAmountByUserId((prev) => ({
            ...prev,
            [userId]: {
                ...(prev?.[userId] && typeof prev[userId] === 'object' ? prev[userId] : {}),
                [rewardType]: value,
            },
        }))
    }

    const getRewardAmountInputValue = (userId, rewardType, rank) => {
        const userRow = rewardAmountByUserId?.[userId]
        const value = userRow && typeof userRow === 'object' ? userRow[rewardType] : ''
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value)
        return String(getDefaultRewardAmount(rank, rewardType))
    }

    const handleToggleRewardType = (rewardType, checked) => {
        setSelectedRewardTypes((prev) => ({
            ...prev,
            [rewardType]: Boolean(checked),
        }))
    }

    const handleOpenPokemonPicker = async () => {
        setPokemonPickerOpen(true)
        setPokemonPickerPage(1)
        if (pokemonOptions.length === 0) {
            await loadPokemonLookup(pokemonSearch, 1)
        }
    }

    const handleSelectPokemonFromModal = (entry) => {
        const pokemonId = String(entry?.pokemonId || '').trim()
        if (!pokemonId) return
        setRewardPokemonId(pokemonId)
        setRewardPokemonFormId(normalizeFormId(entry?.formId || 'normal'))
        setPokemonPickerOpen(false)
    }

    const handleCosmeticConfigFieldChange = (rank, field, value) => {
        setCosmeticConfigs((prev) => prev.map((entry) => (
            Number(entry?.rank || 0) === Number(rank)
                ? { ...entry, [field]: value }
                : entry
        )))
    }

    const handleSelectedCosmeticRankChange = (rewardType, value) => {
        const safeRank = COSMETIC_CONFIG_RANKS.includes(Number(value)) ? Number(value) : 1
        setSelectedCosmeticRanks((prev) => ({ ...prev, [rewardType]: safeRank }))
    }

    const handleUploadRewardAsset = async (rank, type, file) => {
        const validationError = validateImageFile(file)
        if (validationError) {
            setError(validationError)
            return
        }

        const field = type === 'title' ? 'titleImageUrl' : 'avatarFrameUrl'
        const key = `${rank}:${field}`
        try {
            setError('')
            setUploadingRewardAsset((prev) => ({ ...prev, [key]: true }))
            let imageUrl = ''

            try {
                imageUrl = await uploadToCloudinary(file, undefined, { folder: 'pokemon/vip-assets' })
            } catch (directUploadError) {
                const uploadRes = await leaderboardRewardApi.uploadImage(file)
                imageUrl = String(uploadRes?.imageUrl || '').trim()
                if (!imageUrl) {
                    throw directUploadError
                }
            }

            if (!imageUrl) {
                throw new Error('Không nhận được URL ảnh sau khi tải lên')
            }
            handleCosmeticConfigFieldChange(rank, field, imageUrl)
        } catch (err) {
            setError(err.message || 'Không thể tải ảnh thưởng')
        } finally {
            setUploadingRewardAsset((prev) => ({ ...prev, [key]: false }))
        }
    }

    const handleSaveCosmeticConfig = async (rank) => {
        const targetConfig = getCosmeticConfigForRank(cosmeticConfigs, rank)
        if (!targetConfig) return

        try {
            setError('')
            setSavingCosmeticConfigKey(`${mode}:${rank}`)
            const res = await leaderboardRewardApi.updateCosmeticConfig(mode, rank, {
                titleImageUrl: String(targetConfig?.titleImageUrl || '').trim(),
                avatarFrameUrl: String(targetConfig?.avatarFrameUrl || '').trim(),
            })
            const savedConfig = res?.config || targetConfig
            setCosmeticConfigs((prev) => prev.map((entry) => (
                Number(entry?.rank || 0) === Number(rank) ? savedConfig : entry
            )))
        } catch (err) {
            setError(err.message || 'Không thể lưu cấu hình top tuần')
        } finally {
            setSavingCosmeticConfigKey('')
        }
    }

    const handleSearchUsers = async () => {
        const keyword = String(searchKeyword || '').trim()
        if (!keyword) {
            setSearchedRankings([])
            return
        }

        try {
            setSearchingUsers(true)
            setError('')

            const userRes = await userApi.list({ search: keyword, page: 1, limit: 100 })
            const matchedUsers = Array.isArray(userRes?.users) ? userRes.users : []
            const matchedUserIds = new Set(matchedUsers.map((entry) => String(entry?._id || '').trim()).filter(Boolean))

            if (matchedUserIds.size === 0) {
                setSearchedRankings([])
                return
            }

            const firstPage = await gameApi.getRankings('overall', 1, 100, { mode })
            const firstRows = Array.isArray(firstPage?.rankings) ? firstPage.rankings : []
            const totalPages = Math.max(1, Number(firstPage?.pagination?.totalPages || 1))

            const otherPages = totalPages > 1
                ? await Promise.all(
                    Array.from({ length: totalPages - 1 }, (_, index) => gameApi.getRankings('overall', index + 2, 100, { mode }))
                )
                : []

            const allRows = [
                ...firstRows,
                ...otherPages.flatMap((pageData) => Array.isArray(pageData?.rankings) ? pageData.rankings : []),
            ]

            setSearchedRankings(
                allRows.filter((entry) => matchedUserIds.has(String(entry?.userId || '').trim()))
            )
        } catch (err) {
            setError(err.message || 'Không thể tìm người chơi theo email hoặc tên')
            setSearchedRankings([])
        } finally {
            setSearchingUsers(false)
        }
    }

    const handleClearSearch = () => {
        setSearchKeyword('')
        setSearchedRankings([])
        setError('')
    }

    const handleAward = async (player) => {
        const userId = String(player?.userId || '').trim()
        if (!userId) return

        const rewardStatus = rewardStatusByUserId[userId] || { entries: [], byType: {} }
        const selectedTypes = selectedRewardTypeValues
        if (selectedTypes.length === 0) {
            alert('Vui lòng chọn ít nhất 1 loại thưởng')
            return
        }

        const rewardEntries = []
        const skippedTypes = []

        for (const type of selectedTypes) {
            const alreadyForType = rewardStatus.byType?.[type]
            if (alreadyForType && String(alreadyForType?.mode || '').trim() === String(mode || '').trim()) {
                skippedTypes.push(getRewardTypeLabel(type))
                continue
            }

            const amountRaw = isCosmeticRewardType(type) ? '1' : getRewardAmountInputValue(userId, type, player?.rank)
            const amount = Math.max(0, Number.parseInt(amountRaw, 10) || 0)
            if (amount <= 0) {
                alert(`Số lượng của ${getRewardTypeLabel(type)} phải lớn hơn 0`)
                return
            }

            if (type === 'item' && !rewardItemId) {
                alert('Vui lòng chọn vật phẩm để trao thưởng')
                return
            }
            if (type === 'pokemon' && !rewardPokemonId) {
                alert('Vui lòng chọn Pokemon để trao thưởng')
                return
            }
            const cosmeticConfigRank = isCosmeticRewardType(type)
                ? Math.max(1, Number.parseInt(selectedCosmeticRanks?.[type], 10) || 1)
                : 0
            const cosmeticConfig = isCosmeticRewardType(type)
                ? getCosmeticConfigForRank(cosmeticConfigs, cosmeticConfigRank)
                : null

            if (type === 'titleImage' && !String(cosmeticConfig?.titleImageUrl || '').trim()) {
                alert(`Top ${cosmeticConfigRank} chưa được cấu hình ảnh danh hiệu cố định`)
                return
            }
            if (type === 'avatarFrame' && !String(cosmeticConfig?.avatarFrameUrl || '').trim()) {
                alert(`Top ${cosmeticConfigRank} chưa được cấu hình ảnh khung avatar cố định`)
                return
            }

            rewardEntries.push({
                rewardType: type,
                rewardAmount: amount,
                cosmeticConfigRank,
                itemId: type === 'item' ? rewardItemId : null,
                pokemonId: type === 'pokemon' ? rewardPokemonId : null,
                pokemonFormId: type === 'pokemon' ? rewardPokemonFormId : 'normal',
                pokemonLevel: type === 'pokemon' ? Math.max(1, Number.parseInt(rewardPokemonLevel, 10) || 5) : 5,
                pokemonIsShiny: type === 'pokemon' ? Boolean(rewardPokemonIsShiny) : false,
                titleImageUrl: type === 'titleImage' ? String(cosmeticConfig?.titleImageUrl || '').trim() : '',
                avatarFrameUrl: type === 'avatarFrame' ? String(cosmeticConfig?.avatarFrameUrl || '').trim() : '',
            })
        }

        if (rewardEntries.length === 0) {
            alert('Các loại thưởng đã chọn đều đã được trao trước đó cho người chơi này')
            return
        }

        const selectedItem = itemOptions.find((entry) => String(entry?._id || '') === String(rewardItemId || ''))
        const selectedPoke = pokemonOptions.find((entry) => String(entry?._id || '') === String(rewardPokemonId || ''))
        const rewardPreviewText = rewardEntries.map((entry) => {
            if (entry.rewardType === 'moonPoints') return `${numberFormat(entry.rewardAmount)} Điểm Nguyệt Các`
            if (entry.rewardType === 'item') return `${numberFormat(entry.rewardAmount)} ${selectedItem?.name || 'vật phẩm'}`
            if (entry.rewardType === 'pokemon') {
                const shinyText = entry.pokemonIsShiny ? ' (Shiny)' : ''
                return `${numberFormat(entry.rewardAmount)} ${selectedPoke?.name || 'Pokemon'} Lv.${numberFormat(entry.pokemonLevel)}${shinyText}`
            }
            if (entry.rewardType === 'titleImage') return `ảnh danh hiệu top ${entry?.cosmeticConfigRank || 1}`
            if (entry.rewardType === 'avatarFrame') return `ảnh khung avatar top ${entry?.cosmeticConfigRank || 1}`
            return `${numberFormat(entry.rewardAmount)} Xu Bạch Kim`
        }).join(' + ')

        const confirmed = confirm(
            `${skippedTypes.length > 0 ? `[Bỏ qua đã trao: ${skippedTypes.join(', ')}]\n` : ''}Trao ${rewardPreviewText} cho ${player?.username || 'người chơi'} (hạng #${player?.rank || '-'})?`
        )
        if (!confirmed) return

        try {
            setRewardingUserId(userId)
            const scoreValue = getPrimaryValueByMode(mode, player)
            const res = await leaderboardRewardApi.award({
                mode,
                weekStart: period?.weekStart || '',
                weekEnd: period?.weekEnd || '',
                userId,
                rank: Number(player?.rank || 0),
                scoreValue,
                rewardEntries,
            })
            alert(res?.message || 'Trao thưởng thành công')
            await loadRewardStatus(mode, String(period?.weekStart || '').trim())
        } catch (err) {
            alert(err.message || 'Trao thưởng thất bại')
        } finally {
            setRewardingUserId('')
        }
    }

    const handleRevoke = async (player) => {
        const userId = String(player?.userId || '').trim()
        if (!userId) return

        const rewardStatus = rewardStatusByUserId[userId] || { entries: [] }
        if (!Array.isArray(rewardStatus.entries) || rewardStatus.entries.length === 0) {
            alert('Người chơi này chưa có phần thưởng để thu hồi')
            return
        }

        const confirmed = confirm(`Thu hồi toàn bộ phần thưởng top tuần đã trao cho ${player?.username || 'người chơi'}?`)
        if (!confirmed) return

        try {
            setRevokingUserId(userId)
            const res = await leaderboardRewardApi.revoke({
                mode,
                weekStart: period?.weekStart || '',
                userId,
            })
            if (Array.isArray(res?.warnings) && res.warnings.length > 0) {
                alert(`Đã thu hồi, nhưng có cảnh báo:\n- ${res.warnings.join('\n- ')}`)
            } else {
                alert(res?.message || 'Thu hồi phần thưởng thành công')
            }
            await loadRewardStatus(mode, String(period?.weekStart || '').trim())
        } catch (err) {
            alert(err.message || 'Thu hồi phần thưởng thất bại')
        } finally {
            setRevokingUserId('')
        }
    }

    const totalUsers = Math.max(0, Number(pagination?.totalUsers || 0))
    const periodText = period?.weekStart && period?.weekEnd
        ? `${period.weekStart} - ${period.weekEnd}`
        : '--'

    if (loading && rankings.length === 0 && displayedRankings.length === 0) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải leaderboard quản trị...</div>
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Quản Lý Top Tuần & Trao Thưởng</h1>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                >
                    Quay lại
                </Link>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100 space-y-3">
                <div className="flex flex-wrap gap-2">
                    {MODE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => setMode(option.value)}
                            className={`px-3 py-1.5 rounded-md text-sm font-bold border transition-colors ${mode === option.value
                                ? 'bg-blue-600 border-blue-700 text-white'
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Tuần đang theo dõi</div>
                        <div className="font-semibold text-slate-800 mt-1">{periodText}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Tổng người chơi</div>
                        <div className="font-semibold text-slate-800 mt-1">{numberFormat(totalUsers)}</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Tổng lượt đã trao</div>
                        <div className="font-semibold text-emerald-700 mt-1">{numberFormat(rewardedTotal)}</div>
                    </div>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <div className="text-xs font-bold text-slate-500 uppercase">Tìm người chơi trong BXH tuần</div>
                    <div className="flex flex-col md:flex-row gap-2">
                        <input
                            type="text"
                            value={searchKeyword}
                            onChange={(e) => setSearchKeyword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleSearchUsers()
                                }
                            }}
                            placeholder="Tìm theo email hoặc tên người chơi..."
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={handleSearchUsers}
                                disabled={searchingUsers}
                                className="px-3 py-2 rounded border border-blue-300 bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60"
                            >
                                {searchingUsers ? 'Đang tìm...' : 'Tìm'}
                            </button>
                            {activeSearchKeyword && (
                                <button
                                    type="button"
                                    onClick={handleClearSearch}
                                    className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50"
                                >
                                    Xóa lọc
                                </button>
                            )}
                        </div>
                    </div>
                    {activeSearchKeyword && (
                        <div className="text-xs font-semibold text-slate-600">
                            Kết quả cho "{activeSearchKeyword}": {numberFormat(displayedRankings.length)} người chơi khớp trong BXH {mode === 'wealth' ? 'Tài Phú' : mode === 'trainerBattle' ? 'Leo Tháp' : 'LC Party'} tuần.
                        </div>
                    )}
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <div className="text-xs font-bold text-slate-500 uppercase">Cấu hình loại thưởng</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {REWARD_TYPE_OPTIONS.map((entry) => (
                            <label key={entry.value} className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 rounded border border-slate-300 bg-white px-2 py-1.5">
                                <input
                                    type="checkbox"
                                    checked={Boolean(selectedRewardTypes?.[entry.value])}
                                    onChange={(e) => handleToggleRewardType(entry.value, e.target.checked)}
                                />
                                {entry.label}
                            </label>
                        ))}
                    </div>

                    {selectedRewardTypeValues.length === 0 && (
                        <div className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                            Chọn ít nhất 1 loại thưởng để có thể trao.
                        </div>
                    )}

                    {(selectedRewardTypes.titleImage || selectedRewardTypes.avatarFrame) && (
                        <div className="rounded border border-blue-200 bg-blue-50/40 p-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-bold text-blue-900 uppercase tracking-wide">Cố định khung / danh hiệu theo top 1-3</div>
                                <div className="text-[11px] font-semibold text-blue-700">Khi trao, chọn trực tiếp bộ top 1, top 2 hoặc top 3 ngay tại từng dòng quà</div>
                            </div>
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                                {COSMETIC_CONFIG_RANKS.map((rank) => {
                                    const config = getCosmeticConfigForRank(cosmeticConfigs, rank) || { rank, titleImageUrl: '', avatarFrameUrl: '' }
                                    const titleUploadKey = `${rank}:titleImageUrl`
                                    const frameUploadKey = `${rank}:avatarFrameUrl`
                                    const savingKey = `${mode}:${rank}`
                                    return (
                                        <div key={`${mode}-top-${rank}`} className="rounded border border-slate-200 bg-white p-3 space-y-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-sm font-bold text-slate-800">Top {rank}</div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveCosmeticConfig(rank)}
                                                    disabled={savingCosmeticConfigKey === savingKey}
                                                    className="px-2.5 py-1.5 rounded border border-blue-300 bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60"
                                                >
                                                    {savingCosmeticConfigKey === savingKey ? 'Đang lưu...' : 'Lưu cấu hình'}
                                                </button>
                                            </div>

                                            {selectedRewardTypes.titleImage && (
                                                <div className="space-y-2">
                                                    <div className="text-[11px] font-semibold text-slate-700">Danh hiệu cố định</div>
                                                    <div className="h-16 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                        {config.titleImageUrl ? (
                                                            <img src={config.titleImageUrl} alt={`Danh hiệu top ${rank}`} className="max-h-full max-w-full object-contain" />
                                                        ) : (
                                                            <span className="text-[11px] text-slate-400">Chưa cấu hình danh hiệu</span>
                                                        )}
                                                    </div>
                                                    <input
                                                        id={`leaderboard-reward-title-upload-${rank}`}
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0]
                                                            e.target.value = ''
                                                            handleUploadRewardAsset(rank, 'title', file)
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`leaderboard-reward-title-upload-${rank}`}
                                                        className="inline-flex w-full items-center justify-center rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                                    >
                                                        {uploadingRewardAsset[titleUploadKey] ? 'Đang tải ảnh...' : 'Tải ảnh danh hiệu'}
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={config.titleImageUrl}
                                                        onChange={(e) => handleCosmeticConfigFieldChange(rank, 'titleImageUrl', e.target.value)}
                                                        placeholder="URL ảnh danh hiệu"
                                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                                                    />
                                                </div>
                                            )}

                                            {selectedRewardTypes.avatarFrame && (
                                                <div className="space-y-2">
                                                    <div className="text-[11px] font-semibold text-slate-700">Khung avatar cố định</div>
                                                    <div className="h-16 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                        {config.avatarFrameUrl ? (
                                                            <img src={config.avatarFrameUrl} alt={`Khung top ${rank}`} className="max-h-full max-w-full object-contain" />
                                                        ) : (
                                                            <span className="text-[11px] text-slate-400">Chưa cấu hình khung</span>
                                                        )}
                                                    </div>
                                                    <input
                                                        id={`leaderboard-reward-frame-upload-${rank}`}
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0]
                                                            e.target.value = ''
                                                            handleUploadRewardAsset(rank, 'frame', file)
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`leaderboard-reward-frame-upload-${rank}`}
                                                        className="inline-flex w-full items-center justify-center rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                                                    >
                                                        {uploadingRewardAsset[frameUploadKey] ? 'Đang tải ảnh...' : 'Tải ảnh khung'}
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={config.avatarFrameUrl}
                                                        onChange={(e) => handleCosmeticConfigFieldChange(rank, 'avatarFrameUrl', e.target.value)}
                                                        placeholder="URL ảnh khung avatar"
                                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        {selectedRewardTypes.item && (
                            <>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Tìm vật phẩm</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={itemSearch}
                                            onChange={(e) => setItemSearch(e.target.value)}
                                            placeholder="Tên vật phẩm..."
                                            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => loadItemLookup(itemSearch)}
                                            className="px-3 py-1.5 rounded text-xs font-bold bg-white border border-slate-300 hover:bg-slate-100"
                                        >
                                            {itemLookupLoading ? '...' : 'Tìm'}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Vật phẩm thưởng</label>
                                    <select
                                        value={rewardItemId}
                                        onChange={(e) => setRewardItemId(e.target.value)}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Chọn vật phẩm...</option>
                                        {itemOptions.map((entry) => (
                                            <option key={entry._id} value={entry._id}>{entry.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        {selectedRewardTypes.pokemon && (
                            <>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Pokemon thưởng</label>
                                    <button
                                        type="button"
                                        onClick={handleOpenPokemonPicker}
                                        className="w-full px-3 py-1.5 rounded text-sm font-bold border border-slate-300 bg-white hover:bg-slate-100 text-left flex items-center gap-2"
                                    >
                                        <img
                                            src={selectedPokemon?.sprite || DEFAULT_POKEMON_IMAGE}
                                            alt={selectedPokemon?.name || 'Pokemon'}
                                            className="w-7 h-7 object-contain pixelated"
                                            onError={(e) => {
                                                e.currentTarget.onerror = null
                                                e.currentTarget.src = DEFAULT_POKEMON_IMAGE
                                            }}
                                        />
                                        {selectedPokemon
                                            ? `#${numberFormat(selectedPokemon?.pokedexNumber || 0)} ${selectedPokemon?.name || 'Pokemon'}`
                                            : 'Chọn Pokemon'}
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Form</label>
                                    <select
                                        value={rewardPokemonFormId}
                                        onChange={(e) => setRewardPokemonFormId(normalizeFormId(e.target.value))}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {selectedPokemonForms.map((entry) => (
                                            <option key={normalizeFormId(entry?.formId)} value={normalizeFormId(entry?.formId)}>
                                                {entry?.formName || normalizeFormId(entry?.formId)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">Level</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="1000"
                                            value={rewardPokemonLevel}
                                            onChange={(e) => setRewardPokemonLevel(e.target.value)}
                                            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 pb-2">
                                            <input
                                                type="checkbox"
                                                checked={rewardPokemonIsShiny}
                                                onChange={(e) => setRewardPokemonIsShiny(e.target.checked)}
                                            />
                                            Shiny
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {pokemonPickerOpen && (
                    <div
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                        onClick={() => setPokemonPickerOpen(false)}
                    >
                        <div
                            className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                <h3 className="text-lg font-bold text-slate-800">Chọn Pokemon thưởng</h3>
                                <button
                                    type="button"
                                    onClick={() => setPokemonPickerOpen(false)}
                                    disabled={pokemonLookupLoading}
                                    className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
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
                                        value={pokemonSearch}
                                        onChange={(e) => {
                                            setPokemonSearch(e.target.value)
                                            setPokemonPickerPage(1)
                                        }}
                                        placeholder="Nhập tên hoặc số Pokedex"
                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                    />
                                </div>

                                <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                    {pokemonLookupLoading ? (
                                        <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải danh sách Pokemon...</div>
                                    ) : pokemonLoadError ? (
                                        <div className="px-3 py-4 text-sm text-red-600 text-center">{pokemonLoadError}</div>
                                    ) : selectablePokemonRows.length === 0 ? (
                                        <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokemon</div>
                                    ) : (
                                        selectablePokemonRows.map((entry) => (
                                            <button
                                                type="button"
                                                key={entry.key}
                                                onClick={() => handleSelectPokemonFromModal(entry)}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors hover:bg-slate-50 ${String(rewardPokemonId || '') === String(entry?.pokemonId || '') && normalizeFormId(rewardPokemonFormId) === normalizeFormId(entry?.formId) ? 'bg-slate-50' : ''}`}
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                    <img
                                                        src={entry?.imageUrl || DEFAULT_POKEMON_IMAGE}
                                                        alt={entry?.pokemonName || 'Pokemon'}
                                                        className="w-8 h-8 object-contain pixelated"
                                                        onError={(e) => {
                                                            e.currentTarget.onerror = null
                                                            e.currentTarget.src = DEFAULT_POKEMON_IMAGE
                                                        }}
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-mono text-xs text-slate-500 flex-shrink-0">#{String(entry?.pokedexNumber || 0).padStart(3, '0')}</span>
                                                        <span className="font-semibold text-slate-700 truncate">{entry?.pokemonName || 'Pokemon'}</span>
                                                    </div>
                                                    <div className="mt-1">
                                                        <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border ${entry?.isDefault
                                                            ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                            : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                                            {entry?.formName || normalizeFormId(entry?.formId)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </button>
                                        ))
                                    )}
                                </div>

                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>
                                        Trang này có {selectablePokemonRows.length} dạng từ {pokemonPickerTotal > 0 ? (((pokemonPickerPage - 1) * POKEMON_MODAL_PAGE_SIZE) + 1) : 0}-{pokemonPickerTotal > 0 ? Math.min(pokemonPickerTotal, pokemonPickerPage * POKEMON_MODAL_PAGE_SIZE) : 0} / {pokemonPickerTotal} Pokemon
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPokemonPickerPage((prev) => Math.max(1, prev - 1))}
                                            disabled={pokemonPickerPage <= 1 || pokemonLookupLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Trước
                                        </button>
                                        <span className="font-semibold text-slate-600">Trang {pokemonPickerPage}/{pokemonPickerTotalPages}</span>
                                        <button
                                            type="button"
                                            onClick={() => setPokemonPickerPage((prev) => Math.min(pokemonPickerTotalPages, prev + 1))}
                                            disabled={pokemonPickerPage >= pokemonPickerTotalPages || pokemonLookupLoading}
                                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Sau
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm font-medium">
                    {error}
                </div>
            )}

            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                Trên điện thoại, phần Trao thưởng hiển thị ở từng thẻ bên dưới. Trên desktop, nút nằm ở cột cuối bảng. Có thể chọn nhiều loại thưởng cùng lúc.
            </div>

            <div className="bg-white border border-blue-100 rounded-lg shadow-sm overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[980px]">
                        <thead>
                            <tr className="bg-slate-100 border-b border-slate-200 text-slate-700">
                                <th className="px-3 py-2 text-left text-xs font-bold uppercase">Hạng</th>
                                <th className="px-3 py-2 text-left text-xs font-bold uppercase">Người chơi</th>
                                <th className="px-3 py-2 text-right text-xs font-bold uppercase">{primaryLabel}</th>
                                <th className="px-3 py-2 text-right text-xs font-bold uppercase">Cấp độ</th>
                                <th className="px-3 py-2 text-left text-xs font-bold uppercase">Trạng thái thưởng</th>
                                <th className="px-3 py-2 text-left text-xs font-bold uppercase">Trao thưởng</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayedRankings.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400 italic">
                                        {activeSearchKeyword ? 'Không tìm thấy người chơi khớp trong BXH tuần' : 'Chưa có dữ liệu top tuần'}
                                    </td>
                                </tr>
                            ) : displayedRankings.map((entry, index) => {
                                const userId = String(entry?.userId || '').trim()
                                const rewardStatus = rewardStatusByUserId[userId] || { entries: [], byType: {} }
                                const isRewarding = rewardingUserId === userId
                                const isRevoking = revokingUserId === userId
                                const scoreValue = getPrimaryValueByMode(mode, entry)
                                const availableRewardTypes = selectedRewardTypeValues.filter((type) => !rewardStatus.byType?.[type])
                                const isAllSelectedTypesRewarded = availableRewardTypes.length === 0

                                return (
                                    <tr
                                        key={`${userId || 'row'}-${entry?.rank || index}`}
                                        className={`border-b border-slate-100 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                    >
                                        <td className="px-3 py-2 font-bold text-blue-700">#{numberFormat(entry?.rank || 0)}</td>
                                        <td className="px-3 py-2">
                                            <div className="font-semibold text-slate-800">{entry?.username || 'Unknown'}</div>
                                            <div className="text-xs text-slate-500">ID: {userId || '--'}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{numberFormat(scoreValue)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{numberFormat(entry?.level || 1)}</td>
                                        <td className="px-3 py-2">
                                            {rewardStatus.entries.length > 0 ? (
                                                <div className="space-y-0.5">
                                                    {rewardStatus.entries.map((rewardLog) => (
                                                        <div key={rewardLog?.id || `${userId}-${rewardLog?.rewardType || 'reward'}`} className="text-xs">
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700">
                                                                {getRewardTypeLabel(rewardLog?.rewardType)}: {formatRewardSummary(rewardLog)}
                                                            </span>
                                                            <span className="ml-1 text-slate-500">
                                                                {formatDateTime(rewardLog?.rewardedAt)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">
                                                    Chưa trao
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="space-y-2">
                                                {selectedRewardTypeValues.map((type) => {
                                                    const typeAwarded = Boolean(rewardStatus.byType?.[type])
                                                    const cosmeticType = isCosmeticRewardType(type)
                                                    const selectedCosmeticRank = cosmeticType ? Math.max(1, Number.parseInt(selectedCosmeticRanks?.[type], 10) || 1) : 0
                                                    const rankCosmeticConfig = getCosmeticConfigForRank(cosmeticConfigs, selectedCosmeticRank)
                                                    const cosmeticMissing = type === 'titleImage'
                                                        ? !String(rankCosmeticConfig?.titleImageUrl || '').trim()
                                                        : (type === 'avatarFrame' ? !String(rankCosmeticConfig?.avatarFrameUrl || '').trim() : false)
                                                    return (
                                                        <div key={`${userId}-${type}`} className="flex items-center gap-2">
                                                            <span className={`w-24 text-[11px] font-bold ${typeAwarded ? 'text-emerald-700' : 'text-slate-600'}`}>
                                                                {getRewardTypeLabel(type)}
                                                            </span>
                                                            {cosmeticType ? (
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={selectedCosmeticRank}
                                                                        onChange={(e) => handleSelectedCosmeticRankChange(type, e.target.value)}
                                                                        disabled={typeAwarded || isRewarding}
                                                                        className="w-32 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white disabled:bg-slate-100 disabled:text-slate-500"
                                                                    >
                                                                        {COSMETIC_CONFIG_RANKS.map((rank) => (
                                                                            <option key={`${userId}-${type}-rank-${rank}`} value={rank}>Trao top {rank}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-semibold ${cosmeticMissing
                                                                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                                                                        : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                                                                        {cosmeticMissing ? 'Chưa cấu hình' : 'Sẵn sàng'}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    value={getRewardAmountInputValue(userId, type, entry?.rank)}
                                                                    onChange={(e) => handleRewardAmountChange(userId, type, e.target.value)}
                                                                    disabled={typeAwarded || isRewarding}
                                                                    className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                                                                    title={getRewardAmountLabel(type)}
                                                                />
                                                            )}
                                                            {typeAwarded && (
                                                                <span className="text-[11px] font-bold text-emerald-700">Đã trao</span>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAward(entry)}
                                                        disabled={isAllSelectedTypesRewarded || isRewarding || isRevoking || selectedRewardTypeValues.length === 0}
                                                        className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {isRewarding ? 'Đang trao...' : (isAllSelectedTypesRewarded ? 'Đã trao hết loại chọn' : `Trao ${availableRewardTypes.length} loại`)}
                                                    </button>
                                                    {rewardStatus.entries.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRevoke(entry)}
                                                            disabled={isRewarding || isRevoking}
                                                            className="px-3 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            {isRevoking ? 'Đang thu hồi...' : 'Thu hồi'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="md:hidden space-y-3 p-3">
                    {displayedRankings.length === 0 ? (
                        <div className="px-4 py-6 text-center text-slate-400 italic border border-slate-200 rounded">
                            {activeSearchKeyword ? 'Không tìm thấy người chơi khớp trong BXH tuần' : 'Chưa có dữ liệu top tuần'}
                        </div>
                    ) : displayedRankings.map((entry) => {
                        const userId = String(entry?.userId || '').trim()
                        const rewardStatus = rewardStatusByUserId[userId] || { entries: [], byType: {} }
                        const isRewarding = rewardingUserId === userId
                        const isRevoking = revokingUserId === userId
                        const scoreValue = getPrimaryValueByMode(mode, entry)
                        const availableRewardTypes = selectedRewardTypeValues.filter((type) => !rewardStatus.byType?.[type])
                        const isAllSelectedTypesRewarded = availableRewardTypes.length === 0

                        return (
                            <div key={`${userId || 'mobile'}-${entry?.rank || 0}`} className="rounded border border-slate-200 bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-bold text-blue-700">#{numberFormat(entry?.rank || 0)}</div>
                                    <div className="text-xs text-slate-500">Lv {numberFormat(entry?.level || 1)}</div>
                                </div>
                                <div>
                                    <div className="font-semibold text-slate-800">{entry?.username || 'Unknown'}</div>
                                    <div className="text-xs text-slate-500">{primaryLabel}: {numberFormat(scoreValue)}</div>
                                </div>
                                <div>
                                    {rewardStatus.entries.length > 0 ? (
                                        <div className="space-y-1">
                                            {rewardStatus.entries.map((rewardLog) => (
                                                <div key={rewardLog?.id || `${userId}-${rewardLog?.rewardType || 'reward-mobile'}`} className="text-xs">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700">
                                                        {getRewardTypeLabel(rewardLog?.rewardType)}: {formatRewardSummary(rewardLog)}
                                                    </span>
                                                    <span className="ml-1 text-slate-500">{formatDateTime(rewardLog?.rewardedAt)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">
                                            Chưa trao
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    {selectedRewardTypeValues.map((type) => {
                                        const typeAwarded = Boolean(rewardStatus.byType?.[type])
                                        const cosmeticType = isCosmeticRewardType(type)
                                        const selectedCosmeticRank = cosmeticType ? Math.max(1, Number.parseInt(selectedCosmeticRanks?.[type], 10) || 1) : 0
                                        const rankCosmeticConfig = getCosmeticConfigForRank(cosmeticConfigs, selectedCosmeticRank)
                                        const cosmeticMissing = type === 'titleImage'
                                            ? !String(rankCosmeticConfig?.titleImageUrl || '').trim()
                                            : (type === 'avatarFrame' ? !String(rankCosmeticConfig?.avatarFrameUrl || '').trim() : false)
                                        return (
                                            <div key={`${userId}-${type}-mobile`} className="flex items-center gap-2">
                                                <span className={`w-24 text-[11px] font-bold ${typeAwarded ? 'text-emerald-700' : 'text-slate-600'}`}>
                                                    {getRewardTypeLabel(type)}
                                                </span>
                                                {cosmeticType ? (
                                                    <div className="flex items-center gap-2">
                                                        <select
                                                            value={selectedCosmeticRank}
                                                            onChange={(e) => handleSelectedCosmeticRankChange(type, e.target.value)}
                                                            disabled={typeAwarded || isRewarding}
                                                            className="w-32 px-2 py-1.5 border border-slate-300 rounded text-xs bg-white disabled:bg-slate-100 disabled:text-slate-500"
                                                        >
                                                            {COSMETIC_CONFIG_RANKS.map((rank) => (
                                                                <option key={`${userId}-${type}-mobile-rank-${rank}`} value={rank}>Trao top {rank}</option>
                                                            ))}
                                                        </select>
                                                        <span className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-semibold ${cosmeticMissing
                                                            ? 'border-amber-300 bg-amber-50 text-amber-700'
                                                            : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                                                            {cosmeticMissing ? 'Chưa cấu hình' : 'Sẵn sàng'}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={getRewardAmountInputValue(userId, type, entry?.rank)}
                                                        onChange={(e) => handleRewardAmountChange(userId, type, e.target.value)}
                                                        disabled={typeAwarded || isRewarding}
                                                        className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                                                    />
                                                )}
                                                {typeAwarded && (
                                                    <span className="text-[11px] font-bold text-emerald-700">Đã trao</span>
                                                )}
                                            </div>
                                        )
                                    })}
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleAward(entry)}
                                            disabled={isAllSelectedTypesRewarded || isRewarding || isRevoking || selectedRewardTypeValues.length === 0}
                                            className="px-3 py-1.5 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isRewarding ? 'Đang trao...' : (isAllSelectedTypesRewarded ? 'Đã trao hết loại chọn' : `Trao ${availableRewardTypes.length} loại`)}
                                        </button>
                                        {rewardStatus.entries.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => handleRevoke(entry)}
                                                disabled={isRewarding || isRevoking}
                                                className="px-3 py-1.5 rounded text-xs font-bold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isRevoking ? 'Đang thu hồi...' : 'Thu hồi'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex flex-wrap justify-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page <= 1}
                        className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Trước
                    </button>
                    <span className="px-3 py-1.5 text-sm font-semibold text-slate-600">
                        Trang {numberFormat(page)} / {numberFormat(pagination.totalPages)}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((prev) => Math.min(Number(pagination.totalPages || prev), prev + 1))}
                        disabled={page >= Number(pagination.totalPages || 1)}
                        className="px-3 py-1.5 rounded border border-slate-300 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Sau
                    </button>
                </div>
            )}
        </div>
    )
}
