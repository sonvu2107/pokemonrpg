import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mapApi, pokemonApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const MIN_SPECIAL_WEIGHT = 0.0001
const SPECIAL_POKEMON_MODAL_PAGE_SIZE = 40
const normalizeFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'

export default function MapFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        mapImageUrl: '',
        levelMin: 1,
        levelMax: 10,
        isLegendary: false,
        iconId: '',
        specialPokemonConfigs: [],
        specialPokemonEncounterRate: 0,
        requiredSearches: 0,
        requiredPlayerLevel: 1,
        encounterRate: 1,
        itemDropRate: 0,
        orderIndex: 0,
    })

    const [pokemonLookup, setPokemonLookup] = useState({})
    const [specialPokemonOptions, setSpecialPokemonOptions] = useState([])
    const [loadingPokemon, setLoadingPokemon] = useState(false)
    const [specialPokemonLoadError, setSpecialPokemonLoadError] = useState('')
    const [showSpecialPokemonModal, setShowSpecialPokemonModal] = useState(false)
    const [specialPokemonSearchTerm, setSpecialPokemonSearchTerm] = useState('')
    const [specialPokemonPage, setSpecialPokemonPage] = useState(1)
    const [specialPokemonTotalPages, setSpecialPokemonTotalPages] = useState(1)
    const [specialPokemonTotal, setSpecialPokemonTotal] = useState(0)

    const normalizeSpecialPokemonConfigs = (value, fallbackIds = []) => {
        const fromConfigs = Array.isArray(value)
            ? value
                .map((entry) => {
                    if (!entry) return null
                    const pokemonId = typeof entry === 'string'
                        ? entry
                        : (entry.pokemonId?._id || entry.pokemonId)
                    const formId = typeof entry === 'object' && entry !== null
                        ? normalizeFormId(entry.formId)
                        : 'normal'
                    const weightRaw = typeof entry === 'object' && entry !== null ? entry.weight : 1
                    const weight = Number.isFinite(Number(weightRaw)) && Number(weightRaw) > 0
                        ? Number(weightRaw)
                        : 1
                    return pokemonId ? { pokemonId: String(pokemonId), formId, weight } : null
                })
                .filter(Boolean)
            : []

        if (fromConfigs.length > 0) return fromConfigs

        if (!Array.isArray(fallbackIds)) return []
        return fallbackIds
            .map((item) => {
                if (!item) return ''
                if (typeof item === 'string') return item
                return item._id || ''
            })
            .filter(Boolean)
            .map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))
    }

    useEffect(() => {
        if (isEdit) {
            loadMap()
        }
    }, [id])

    useEffect(() => {
        if (!showSpecialPokemonModal) return
        loadPokemonOptions()
    }, [showSpecialPokemonModal, specialPokemonPage, specialPokemonSearchTerm])

    const mergePokemonLookup = (rows = []) => {
        setPokemonLookup((prev) => {
            const next = { ...prev }
            rows.forEach((entry) => {
                if (entry?._id) next[entry._id] = entry
            })
            return next
        })
    }

    const loadPokemonOptions = async () => {
        try {
            setLoadingPokemon(true)
            setSpecialPokemonLoadError('')

            const normalizedSearch = String(specialPokemonSearchTerm || '').trim()
            const data = await pokemonApi.list({
                page: specialPokemonPage,
                limit: SPECIAL_POKEMON_MODAL_PAGE_SIZE,
                ...(normalizedSearch ? { search: normalizedSearch } : {}),
            })

            const rows = Array.isArray(data?.pokemon) ? data.pokemon : []
            setSpecialPokemonOptions(rows)
            setSpecialPokemonTotalPages(Math.max(1, Number(data?.pagination?.pages) || 1))
            setSpecialPokemonTotal(Math.max(0, Number(data?.pagination?.total) || 0))
            mergePokemonLookup(rows)
        } catch (err) {
            setSpecialPokemonOptions([])
            setSpecialPokemonTotalPages(1)
            setSpecialPokemonTotal(0)
            setSpecialPokemonLoadError(err.message || 'Không thể tải danh sách Pokemon')
        } finally {
            setLoadingPokemon(false)
        }
    }

    const loadMap = async () => {
        try {
            setLoading(true)
            const data = await mapApi.getById(id)
            setFormData({
                ...data.map,
                description: data.map.description || '',
                mapImageUrl: data.map.mapImageUrl || '',
                iconId: data.map.iconId || '',
                specialPokemonConfigs: normalizeSpecialPokemonConfigs(data.map.specialPokemonConfigs, data.map.specialPokemonIds),
                specialPokemonEncounterRate: data.map.specialPokemonEncounterRate ?? 0,
                isLegendary: data.map.isLegendary || false,
                requiredSearches: data.map.requiredSearches || 0,
                requiredPlayerLevel: Math.max(1, Number(data.map.requiredPlayerLevel) || 1),
                encounterRate: data.map.encounterRate ?? 1,
                itemDropRate: data.map.itemDropRate ?? 0,
                orderIndex: data.map.orderIndex || 0,
            })

            const mapPokemonRows = []
            if (Array.isArray(data.map?.specialPokemonConfigs)) {
                data.map.specialPokemonConfigs.forEach((entry) => {
                    if (entry?.pokemonId && typeof entry.pokemonId === 'object' && entry.pokemonId._id) {
                        mapPokemonRows.push(entry.pokemonId)
                    }
                })
            }
            if (Array.isArray(data.map?.specialPokemonIds)) {
                data.map.specialPokemonIds.forEach((entry) => {
                    if (entry && typeof entry === 'object' && entry._id) {
                        mapPokemonRows.push(entry)
                    }
                })
            }
            mergePokemonLookup(mapPokemonRows)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (formData.levelMax < formData.levelMin) {
            setError('Cấp độ tối đa phải >= Cấp độ tối thiểu')
            return
        }

        if (Number(formData.requiredPlayerLevel) < 1) {
            setError('Lv yêu cầu vào map phải >= 1')
            return
        }

        const hasInvalidSpecialWeight = (formData.specialPokemonConfigs || [])
            .some((entry) => Number(entry?.weight) < MIN_SPECIAL_WEIGHT)
        if (hasInvalidSpecialWeight) {
            setError(`Tỷ lệ từng Pokemon đặc biệt phải >= ${MIN_SPECIAL_WEIGHT}`)
            return
        }

        try {
            setLoading(true)

            if (isEdit) {
                await mapApi.update(id, formData)
            } else {
                await mapApi.create(formData)
            }

            navigate('/admin/maps')
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleOpenSpecialPokemonModal = () => {
        if (formData.specialPokemonConfigs.length >= 5) {
            setError('Chỉ có thể chọn tối đa 5 Pokemon đặc biệt')
            return
        }
        setSpecialPokemonSearchTerm('')
        setSpecialPokemonPage(1)
        setSpecialPokemonLoadError('')
        setShowSpecialPokemonModal(true)
    }

    const handleAddSpecialPokemon = (pokemonId, formId) => {
        const normalizedPokemonId = String(pokemonId || '').trim()
        const normalizedFormId = normalizeFormId(formId)
        const uniqueKey = `${normalizedPokemonId}:${normalizedFormId}`
        if (!normalizedPokemonId) return

        if (formData.specialPokemonConfigs.length >= 5) {
            setError('Chỉ có thể chọn tối đa 5 Pokemon đặc biệt')
            return
        }

        if (formData.specialPokemonConfigs.some((entry) => `${entry.pokemonId}:${normalizeFormId(entry.formId)}` === uniqueKey)) {
            return
        }

        setFormData((prev) => ({
            ...prev,
            specialPokemonConfigs: [...prev.specialPokemonConfigs, { pokemonId: normalizedPokemonId, formId: normalizedFormId, weight: 1 }],
        }))
        setShowSpecialPokemonModal(false)
        setError('')
    }

    const handleRemoveSpecialPokemon = (pokemonIdToRemove, formIdToRemove) => {
        const removeFormId = normalizeFormId(formIdToRemove)
        setFormData((prev) => ({
            ...prev,
            specialPokemonConfigs: prev.specialPokemonConfigs.filter((entry) => !(
                entry.pokemonId === pokemonIdToRemove
                && normalizeFormId(entry.formId) === removeFormId
            )),
        }))
    }

    const handleUpdateSpecialPokemonWeight = (pokemonId, formId, nextWeightRaw) => {
        const normalizedForm = normalizeFormId(formId)
        const parsed = Number.parseFloat(nextWeightRaw)
        const nextWeight = Number.isFinite(parsed) && parsed >= MIN_SPECIAL_WEIGHT ? parsed : 0
        setFormData((prev) => ({
            ...prev,
            specialPokemonConfigs: prev.specialPokemonConfigs.map((entry) => (
                entry.pokemonId === pokemonId && normalizeFormId(entry.formId) === normalizedForm
                    ? { ...entry, weight: nextWeight }
                    : entry
            )),
        }))
    }

    const totalSpecialWeight = formData.specialPokemonConfigs
        .reduce((sum, entry) => sum + (Number(entry.weight) > 0 ? Number(entry.weight) : 0), 0)

    const clampRate = (value) => Math.max(0, Math.min(1, Number(value) || 0))
    const formatPercent = (rate) => `${(Math.max(0, Number(rate) || 0) * 100).toFixed(3).replace(/\.?0+$/, '')}%`
    const hasSpecialPokemonPool = formData.specialPokemonConfigs.length > 0
    const encounterRatePreview = clampRate(formData.encounterRate)
    const specialPokemonRatePreview = clampRate(formData.specialPokemonEncounterRate)
    const specialEncounterPerSearchRate = hasSpecialPokemonPool
        ? encounterRatePreview * specialPokemonRatePreview
        : 0

    const selectedSpecialPokemon = formData.specialPokemonConfigs
        .map((entry) => {
            const weight = Number(entry.weight) > 0 ? Number(entry.weight) : 0
            const relativePoolRate = totalSpecialWeight > 0 ? (weight / totalSpecialWeight) : 0
            const perSearchRate = specialEncounterPerSearchRate * relativePoolRate
            const pokemon = pokemonLookup[entry.pokemonId] || null
            if (!pokemon) {
                return {
                    _id: entry.pokemonId,
                    name: `Pokemon (${entry.pokemonId})`,
                    pokedexNumber: 0,
                    formId: normalizeFormId(entry.formId),
                    formName: normalizeFormId(entry.formId),
                    formImageUrl: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
                    key: `${entry.pokemonId}:${normalizeFormId(entry.formId)}`,
                    weight,
                    relativePoolRate,
                    perSearchRate,
                    isMissing: true,
                }
            }

            const forms = Array.isArray(pokemon.forms) ? pokemon.forms : []
            const defaultFormId = normalizeFormId(pokemon.defaultFormId)
            const resolvedFormId = normalizeFormId(entry.formId || defaultFormId)
            const resolvedForm = forms.find((form) => normalizeFormId(form?.formId) === resolvedFormId) || null
            const imageUrl = resolvedForm?.imageUrl
                || resolvedForm?.sprites?.normal
                || resolvedForm?.sprites?.icon
                || pokemon.imageUrl
                || pokemon.sprites?.normal
                || pokemon.sprites?.icon
                || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokedexNumber}.png`
            return {
                ...pokemon,
                formId: resolvedFormId,
                formName: resolvedForm?.formName || resolvedFormId,
                formImageUrl: imageUrl,
                key: `${pokemon._id}:${resolvedFormId}`,
                weight,
                relativePoolRate,
                perSearchRate,
                isMissing: false,
            }
        })
        .filter(Boolean)

    const selectedSpecialPokemonKeys = new Set(
        formData.specialPokemonConfigs.map((entry) => `${entry.pokemonId}:${normalizeFormId(entry.formId)}`)
    )

    const selectableSpecialPokemonRows = specialPokemonOptions.flatMap((pokemon) => {
        const defaultFormId = normalizeFormId(pokemon.defaultFormId)
        const forms = Array.isArray(pokemon.forms) && pokemon.forms.length > 0
            ? pokemon.forms
            : [{ formId: defaultFormId, formName: defaultFormId }]

        return forms
            .map((form) => {
                const formId = normalizeFormId(form?.formId || defaultFormId)
                const key = `${pokemon._id}:${formId}`
                const imageUrl = form?.imageUrl
                    || form?.sprites?.normal
                    || form?.sprites?.icon
                    || pokemon.imageUrl
                    || pokemon.sprites?.normal
                    || pokemon.sprites?.icon
                    || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokedexNumber}.png`

                return {
                    key,
                    pokemonId: pokemon._id,
                    formId,
                    pokedexNumber: pokemon.pokedexNumber,
                    pokemonName: pokemon.name,
                    formName: String(form?.formName || '').trim() || formId,
                    imageUrl,
                    isDefault: formId === defaultFormId,
                }
            })
            .filter((row) => !selectedSpecialPokemonKeys.has(`${row.pokemonId}:${row.formId}`))
    })

    const specialPokemonPageStart = specialPokemonTotal > 0
        ? ((specialPokemonPage - 1) * SPECIAL_POKEMON_MODAL_PAGE_SIZE) + 1
        : 0
    const specialPokemonPageEnd = specialPokemonTotal > 0
        ? Math.min(specialPokemonTotal, specialPokemonPage * SPECIAL_POKEMON_MODAL_PAGE_SIZE)
        : 0

    if (loading && isEdit) return <div className="text-blue-800 font-medium text-center py-8">Đang tải dữ liệu...</div>

    return (
        <div className="max-w-3xl mx-auto py-6 animate-fade-in">
            <div className="bg-white rounded border border-blue-400 shadow-sm overflow-hidden">
                {/* Blue Gradient Header */}
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-4 border-b border-blue-600 flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-bold text-white uppercase tracking-wide drop-shadow-sm">
                            {isEdit ? 'Cập Nhật Bản Đồ' : 'Thêm Bản Đồ Mới'}
                        </h1>
                        <p className="text-blue-100 text-xs mt-1 font-medium">
                            {isEdit ? 'Chỉnh sửa thông số và cấu hình bản đồ' : 'Thiết lập bản đồ mới cho hệ thống'}
                        </p>
                    </div>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm flex items-center gap-2">
                            <span className="font-bold">Lỗi:</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">

                        {/* Basic Info */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-2">Tên Bản Đồ <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Tên bản đồ..."
                                    className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
                                />
                                {formData.name && (
                                    <p className="text-xs text-slate-500 mt-1 italic">
                                        Slug: {formData.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '')}
                                    </p>
                                )}
                            </div>

                            <div className="bg-white rounded border border-blue-100 p-6 shadow-sm">
                                <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-6">
                                    <div>
                                        <h3 className="text-sm font-bold text-blue-900 uppercase">Ảnh Bản Đồ</h3>
                                        <p className="text-xs text-blue-700 mt-1">Ảnh đại diện cho bản đồ (tối đa 5MB).</p>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                                    <ImageUpload
                                        currentImage={formData.mapImageUrl}
                                        onUploadSuccess={(url) => setFormData((prev) => ({
                                            ...prev,
                                            mapImageUrl: Array.isArray(url) ? (url[0] || '') : (url || ''),
                                        }))}
                                        label="Ảnh Bản Đồ"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-2">Mô Tả</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows="3"
                                    placeholder="Mô tả..."
                                    className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2">Cấp Độ Tối Thiểu <span className="text-red-500">*</span></label>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        value={formData.levelMin}
                                        onChange={(e) => setFormData({ ...formData, levelMin: parseInt(e.target.value) || 1 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2">Cấp Độ Tối Đa <span className="text-red-500">*</span></label>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        value={formData.levelMax}
                                        onChange={(e) => setFormData({ ...formData, levelMax: parseInt(e.target.value) || 1 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                </div>
                            </div>

                            {/* Map Progression Settings */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2 h-10 flex items-end pb-1">
                                        <span>Số Lượt Tìm Kiếm Yêu Cầu</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="10000"
                                        value={formData.requiredSearches}
                                        onChange={(e) => setFormData({ ...formData, requiredSearches: parseInt(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Số lượt tìm kiếm để mở map tiếp theo (0 = không khóa)</p>
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2 h-10 flex items-end pb-1">
                                        <span>Thứ Tự Map</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formData.orderIndex}
                                        onChange={(e) => setFormData({ ...formData, orderIndex: parseInt(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Số nhỏ hơn → hiện trước</p>
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2 h-10 flex items-end pb-1">
                                        <span>Lv Yêu Cầu Vào Map</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.requiredPlayerLevel}
                                        onChange={(e) => setFormData({ ...formData, requiredPlayerLevel: Math.max(1, parseInt(e.target.value) || 1) })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Người chơi phải đạt cấp này để vào map.</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-6 mt-4">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2 h-10 flex items-end pb-1">
                                        <span>Tỷ Lệ Gặp Pokemon (0-1)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={formData.encounterRate}
                                        onChange={(e) => setFormData({ ...formData, encounterRate: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Ví dụ: 0.6 = 60% gặp</p>
                                    <p className="text-xs text-blue-700 mt-1 font-semibold">
                                        Preview: {formatPercent(encounterRatePreview)} mỗi lượt tìm sẽ gặp Pokemon.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2 h-10 flex items-end pb-1">
                                        <span>Tỷ Lệ Rơi Vật Phẩm (0-1)</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={formData.itemDropRate}
                                        onChange={(e) => setFormData({ ...formData, itemDropRate: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Chỉ áp dụng khi map có cấu hình item drop</p>
                                </div>
                            </div>
                        </div>

                        {/* Configuration */}
                        <div className="bg-slate-50 p-5 rounded border border-slate-200">
                            <label className="flex items-center cursor-pointer mb-4">
                                <input
                                    type="checkbox"
                                    checked={formData.isLegendary}
                                    onChange={(e) => setFormData({ ...formData, isLegendary: e.target.checked })}
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="ml-3 text-sm font-bold text-slate-700">Đây là Khu Vực Săn Bắt</span>
                            </label>

                            {formData.isLegendary && (
                                <div className="pl-8 animate-fade-in">
                                    <label className="block text-slate-700 text-sm font-bold mb-2">Icon ID (Pokedex)</label>
                                    <div className="flex gap-4 items-center">
                                        <input
                                            type="number"
                                            min="1"
                                            max="1000"
                                            value={formData.iconId}
                                            onChange={(e) => setFormData({ ...formData, iconId: e.target.value })}
                                            placeholder="150"
                                            className="w-24 px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        {formData.iconId && (
                                            <div className="w-10 h-10 border border-slate-300 bg-white rounded flex items-center justify-center">
                                                <img
                                                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${formData.iconId}.png`}
                                                    alt="Preview"
                                                    className="w-8 h-8 pixelated"
                                                    onError={(e) => e.target.style.display = 'none'}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Special Pokemon Selector Section */}
                        <div className="bg-white rounded border border-blue-100 p-6 shadow-sm">
                            <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-6">
                                <div>
                                    <h3 className="text-sm font-bold text-blue-900 uppercase">Pokemon Đặc Biệt</h3>
                                    <p className="text-xs text-blue-700 mt-1">Chọn Pokemon từ kho admin và chỉnh trọng số từng con. Tối đa 5 Pokemon.</p>
                                </div>
                                <span className="text-xs font-bold text-white bg-blue-600 px-2 py-1 rounded">
                                    {formData.specialPokemonConfigs.length} / 5
                                </span>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-2">Tỷ Lệ Gặp Pokemon Đặc Biệt (0-1)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.001"
                                        value={formData.specialPokemonEncounterRate}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            specialPokemonEncounterRate: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)),
                                        })}
                                        className="w-full px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">
                                        Ví dụ: 0.2 = 20% số lần gặp Pokemon sẽ lấy từ danh sách đặc biệt.
                                    </p>
                                    <p className="text-xs text-blue-700 mt-1 font-semibold">
                                        Preview: {formatPercent(specialEncounterPerSearchRate)} mỗi lượt tìm sẽ gặp Pokemon đặc biệt.
                                    </p>
                                    {!hasSpecialPokemonPool && (
                                        <p className="text-xs text-amber-600 mt-1">
                                            Chưa chọn Pokemon đặc biệt nên tỉ lệ thực tế hiện tại vẫn là 0%.
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        type="button"
                                        onClick={handleOpenSpecialPokemonModal}
                                        disabled={formData.specialPokemonConfigs.length >= 5}
                                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        + Thêm Pokemon đặc biệt (chọn theo dạng)
                                    </button>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] shadow-inner p-4">
                                    {selectedSpecialPokemon.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                                            {selectedSpecialPokemon.map((pokemon) => (
                                                <div key={pokemon.key} className="relative group bg-slate-50 rounded border border-slate-200 flex flex-col items-center justify-center p-2 overflow-hidden hover:border-blue-400 transition-colors min-h-[150px]">
                                                    <img
                                                        src={pokemon.formImageUrl}
                                                        alt={pokemon.name}
                                                        className="w-16 h-16 object-contain pixelated"
                                                    />
                                                    <p className="text-[11px] font-semibold text-slate-700 text-center mt-1 line-clamp-2">{pokemon.name}</p>
                                                    <span className="mt-1 px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 border border-blue-200">
                                                        {pokemon.formName}
                                                    </span>
                                                    <div className="w-full mt-1 space-y-1">
                                                        <input
                                                            type="number"
                                                            min={MIN_SPECIAL_WEIGHT}
                                                            step="0.0001"
                                                            value={pokemon.weight}
                                                            title={`Trọng số xuất hiện (>= ${MIN_SPECIAL_WEIGHT})`}
                                                            placeholder="Trọng số"
                                                            onChange={(e) => handleUpdateSpecialPokemonWeight(pokemon._id, pokemon.formId, e.target.value)}
                                                            className="w-full px-1.5 py-1 border border-slate-300 rounded text-[10px] text-center font-semibold"
                                                        />
                                                        <div className="text-[10px] text-center text-violet-700 font-bold">
                                                            Pool: {formatPercent(pokemon.relativePoolRate)}
                                                        </div>
                                                        <div className="text-[10px] text-center text-emerald-700 font-bold">
                                                            Mỗi lượt tìm: {formatPercent(pokemon.perSearchRate)}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveSpecialPokemon(pokemon._id, pokemon.formId)}
                                                        className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs"
                                                        title="Xóa"
                                                    >
                                                        X
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-sm font-bold text-slate-500">Chưa chọn Pokemon đặc biệt nào</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Form Actions */}
                        <div className="pt-4 flex gap-3 border-t border-slate-100">
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded text-sm font-bold shadow-md transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Đang xử lý...' : (isEdit ? 'Lưu Thay Đổi' : 'Tạo Bản Đồ')}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/admin/maps')}
                                className="px-6 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-sm font-bold shadow-sm transition-all"
                            >
                                Hủy Bỏ
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {showSpecialPokemonModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={() => setShowSpecialPokemonModal(false)}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Thêm Pokemon đặc biệt</h3>
                            <button
                                type="button"
                                onClick={() => setShowSpecialPokemonModal(false)}
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
                                    value={specialPokemonSearchTerm}
                                    onChange={(e) => {
                                        setSpecialPokemonSearchTerm(e.target.value)
                                        setSpecialPokemonPage(1)
                                    }}
                                    placeholder="Nhập tên hoặc số Pokedex #"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {loadingPokemon ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải danh sách Pokemon...</div>
                                ) : specialPokemonLoadError ? (
                                    <div className="px-3 py-4 text-sm text-red-600 text-center">{specialPokemonLoadError}</div>
                                ) : selectableSpecialPokemonRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không còn Pokemon/dạng phù hợp để thêm</div>
                                ) : (
                                    selectableSpecialPokemonRows.map((entry) => (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            onClick={() => handleAddSpecialPokemon(entry.pokemonId, entry.formId)}
                                            className="w-full px-3 py-2 text-left flex items-center gap-3 transition-colors hover:bg-slate-50"
                                        >
                                            <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                <img
                                                    src={entry.imageUrl}
                                                    alt={entry.pokemonName}
                                                    className="w-8 h-8 object-contain pixelated"
                                                />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="font-mono text-xs text-slate-500 flex-shrink-0">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</span>
                                                    <span className="font-semibold text-slate-700 truncate">{entry.pokemonName}</span>
                                                </div>
                                                <div className="mt-1">
                                                    <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide border ${entry.isDefault
                                                        ? 'bg-slate-100 text-slate-700 border-slate-200'
                                                        : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                                                        {entry.formName}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>
                                    Trang này có {selectableSpecialPokemonRows.length} dạng từ {specialPokemonPageStart}-{specialPokemonPageEnd} / {specialPokemonTotal} Pokemon
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSpecialPokemonPage((prev) => Math.max(1, prev - 1))}
                                        disabled={specialPokemonPage <= 1 || loadingPokemon}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">
                                        Trang {specialPokemonPage}/{specialPokemonTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setSpecialPokemonPage((prev) => Math.min(specialPokemonTotalPages, prev + 1))}
                                        disabled={specialPokemonPage >= specialPokemonTotalPages || loadingPokemon}
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
    )
}





