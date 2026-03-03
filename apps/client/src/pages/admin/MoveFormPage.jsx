import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { moveApi, pokemonApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const MOVE_TYPES = [
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]

const MOVE_CATEGORIES = [
    { value: 'physical', label: 'Vật lý' },
    { value: 'special', label: 'Đặc biệt' },
    { value: 'status', label: 'Trạng thái' },
]

const MOVE_RARITIES = [
    { value: 'common', label: 'Phổ biến' },
    { value: 'uncommon', label: 'Ít gặp' },
    { value: 'rare', label: 'Hiếm' },
    { value: 'epic', label: 'Sử thi' },
    { value: 'legendary', label: 'Huyền thoại' },
]

const LEARN_SCOPE_OPTIONS = [
    { value: 'all', label: 'Mọi Pokemon' },
    { value: 'move_type', label: 'Cùng hệ với kỹ năng' },
    { value: 'type', label: 'Theo hệ Pokemon' },
    { value: 'species', label: 'Pokemon đặc biệt' },
    { value: 'rarity', label: 'Theo độ hiếm' },
]

const POKEMON_RARITIES = [
    { value: 'sss', label: 'SSS (Thần thoại cực hiếm)' },
    { value: 'ss', label: 'SS (Thần thoại)' },
    { value: 's', label: 'S (Huyền thoại)' },
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
    { value: 'd', label: 'D' },
]

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const FALLBACK_EFFECT_TRIGGER_OPTIONS = [
    'on_hit',
    'after_damage',
    'on_calculate_damage',
    'on_select_move',
    'before_accuracy_check',
    'before_opponent_accuracy_check',
    'before_damage_taken',
    'on_miss',
]

const FALLBACK_EFFECT_TARGET_OPTIONS = ['self', 'opponent', 'field']
const EFFECT_PICKER_PAGE_SIZE = 12

const EFFECT_TRIGGER_LABELS = {
    on_hit: 'Kích hoạt khi chiêu trúng mục tiêu',
    after_damage: 'Kích hoạt sau khi gây sát thương',
    on_calculate_damage: 'Kích hoạt ở bước tính sát thương',
    on_select_move: 'Kích hoạt khi chọn chiêu',
    before_accuracy_check: 'Kích hoạt trước khi kiểm tra độ chính xác',
    before_opponent_accuracy_check: 'Kích hoạt trước khi đối thủ kiểm tra độ chính xác',
    before_damage_taken: 'Kích hoạt trước khi nhận sát thương',
    on_miss: 'Kích hoạt khi chiêu bị trượt',
}

const EFFECT_TARGET_LABELS = {
    self: 'Áp dụng lên Pokemon dùng chiêu',
    opponent: 'Áp dụng lên mục tiêu/đối thủ',
    field: 'Áp dụng lên trạng thái sân đấu',
}

const createEffectDraft = (spec = {}, keySeed = '') => {
    const uniqueKey = `${Date.now()}_${Math.random().toString(36).slice(2)}_${keySeed}`
    return {
        key: uniqueKey,
        op: String(spec?.op || '').trim(),
        trigger: String(spec?.trigger || 'on_hit').trim() || 'on_hit',
        target: String(spec?.target || 'opponent').trim() || 'opponent',
        chance: Number.isFinite(Number(spec?.chance)) ? String(Number(spec.chance)) : '1',
        paramsText: JSON.stringify(spec?.params && typeof spec.params === 'object' ? spec.params : {}, null, 2),
    }
}

export default function MoveFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [pokemonOptions, setPokemonOptions] = useState([])
    const [speciesSearch, setSpeciesSearch] = useState('')
    const [effectCatalog, setEffectCatalog] = useState([])
    const [effectTriggerOptions, setEffectTriggerOptions] = useState(FALLBACK_EFFECT_TRIGGER_OPTIONS)
    const [effectTargetOptions, setEffectTargetOptions] = useState(FALLBACK_EFFECT_TARGET_OPTIONS)
    const [effectDrafts, setEffectDrafts] = useState([])
    const [effectCatalogLoading, setEffectCatalogLoading] = useState(false)
    const [showEffectPickerModal, setShowEffectPickerModal] = useState(false)
    const [effectPickerSearch, setEffectPickerSearch] = useState('')
    const [effectPickerPage, setEffectPickerPage] = useState(1)
    const [effectPickerDraftKey, setEffectPickerDraftKey] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        type: 'normal',
        category: 'physical',
        power: 50,
        accuracy: 100,
        pp: 10,
        priority: 0,
        description: '',
        imageUrl: '',
        rarity: 'common',
        shopPrice: 0,
        isShopEnabled: false,
        isActive: true,
        learnScope: 'all',
        allowedTypes: [],
        allowedPokemonIds: [],
        allowedRarities: [],
    })

    useEffect(() => {
        loadPokemonOptions()
        loadEffectCatalog()
        if (isEdit) {
            loadMove()
        } else {
            setEffectDrafts([])
        }
    }, [id])

    const loadPokemonOptions = async () => {
        try {
            const data = await pokemonApi.list({ page: 1, limit: 1000 })
            setPokemonOptions(data.pokemon || [])
        } catch (_err) {
            setPokemonOptions([])
        }
    }

    const loadEffectCatalog = async () => {
        try {
            setEffectCatalogLoading(true)
            const data = await moveApi.getEffectCatalog()
            setEffectCatalog(Array.isArray(data?.effects) ? data.effects : [])
            setEffectTriggerOptions(Array.isArray(data?.triggerOptions) && data.triggerOptions.length > 0
                ? data.triggerOptions
                : FALLBACK_EFFECT_TRIGGER_OPTIONS)
            setEffectTargetOptions(Array.isArray(data?.targetOptions) && data.targetOptions.length > 0
                ? data.targetOptions
                : FALLBACK_EFFECT_TARGET_OPTIONS)
        } catch (_err) {
            setEffectCatalog([])
            setEffectTriggerOptions(FALLBACK_EFFECT_TRIGGER_OPTIONS)
            setEffectTargetOptions(FALLBACK_EFFECT_TARGET_OPTIONS)
        } finally {
            setEffectCatalogLoading(false)
        }
    }

    const loadMove = async () => {
        try {
            setLoading(true)
            const data = await moveApi.getById(id)
            setFormData({
                name: data.move.name || '',
                type: data.move.type || 'normal',
                category: data.move.category || 'physical',
                power: data.move.power ?? '',
                accuracy: data.move.accuracy ?? 100,
                pp: data.move.pp ?? 10,
                priority: data.move.priority ?? 0,
                description: data.move.description || '',
                imageUrl: data.move.imageUrl || '',
                rarity: data.move.rarity || 'common',
                shopPrice: data.move.shopPrice ?? 0,
                isShopEnabled: Boolean(data.move.isShopEnabled),
                isActive: data.move.isActive !== false,
                learnScope: data.move.learnScope || 'all',
                allowedTypes: Array.isArray(data.move.allowedTypes) ? data.move.allowedTypes : [],
                allowedPokemonIds: Array.isArray(data.move.allowedPokemonIds)
                    ? data.move.allowedPokemonIds.map((entry) => {
                        if (typeof entry === 'object') return String(entry?._id || '')
                        return String(entry || '')
                    }).filter(Boolean)
                    : [],
                allowedRarities: Array.isArray(data.move.allowedRarities) ? data.move.allowedRarities : [],
            })
            const loadedEffectSpecs = Array.isArray(data?.move?.effectSpecs) ? data.move.effectSpecs : []
            setEffectDrafts(loadedEffectSpecs.map((spec, index) => createEffectDraft(spec, String(index))))
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const addEffectDraft = (effectId = '') => {
        const selectedCatalog = effectCatalog.find((entry) => String(entry?.id || '').trim() === effectId)
        const baseSpec = selectedCatalog?.defaultEffectSpec || {
            op: effectId || (effectCatalog?.[0]?.id || ''),
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        }
        if (!baseSpec.op) return
        setEffectDrafts((prev) => [...prev, createEffectDraft(baseSpec, baseSpec.op)])
    }

    const openEffectPicker = ({ draftKey = '' } = {}) => {
        setEffectPickerDraftKey(String(draftKey || ''))
        setEffectPickerSearch('')
        setEffectPickerPage(1)
        setShowEffectPickerModal(true)
    }

    const closeEffectPicker = () => {
        setShowEffectPickerModal(false)
        setEffectPickerDraftKey('')
    }

    const handleSelectEffectFromPicker = (effectId) => {
        const selectedCatalog = effectCatalog.find((entry) => String(entry?.id || '').trim() === String(effectId || '').trim())
        const baseSpec = selectedCatalog?.defaultEffectSpec || {
            op: effectId,
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
        }
        if (!baseSpec?.op) return

        if (effectPickerDraftKey) {
            updateEffectDraft(effectPickerDraftKey, {
                op: String(baseSpec.op || '').trim(),
                trigger: String(baseSpec.trigger || 'on_hit').trim() || 'on_hit',
                target: String(baseSpec.target || 'opponent').trim() || 'opponent',
                chance: Number.isFinite(Number(baseSpec.chance)) ? String(Number(baseSpec.chance)) : '1',
                paramsText: JSON.stringify(baseSpec.params && typeof baseSpec.params === 'object' ? baseSpec.params : {}, null, 2),
            })
        } else {
            addEffectDraft(String(baseSpec.op || '').trim())
        }

        closeEffectPicker()
    }

    const updateEffectDraft = (key, patch) => {
        setEffectDrafts((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)))
    }

    const removeEffectDraft = (key) => {
        setEffectDrafts((prev) => prev.filter((entry) => entry.key !== key))
    }

    const buildEffectSpecsPayload = () => {
        const parsedEffectSpecs = []
        for (let index = 0; index < effectDrafts.length; index += 1) {
            const draft = effectDrafts[index]
            const op = String(draft?.op || '').trim()
            if (!op) {
                throw new Error(`Hiệu ứng thứ ${index + 1} chưa chọn ID.`)
            }

            let params = {}
            const paramsText = String(draft?.paramsText || '').trim()
            if (paramsText) {
                try {
                    const parsed = JSON.parse(paramsText)
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        params = parsed
                    } else {
                        throw new Error('Params phải là object JSON')
                    }
                } catch (parseError) {
                    throw new Error(`Params JSON không hợp lệ ở hiệu ứng ${index + 1}: ${parseError.message}`)
                }
            }

            const chance = Number(draft?.chance)
            const safeChance = Number.isFinite(chance)
                ? Math.max(0, Math.min(1, chance))
                : 1

            parsedEffectSpecs.push({
                op,
                trigger: String(draft?.trigger || 'on_hit').trim() || 'on_hit',
                target: String(draft?.target || 'opponent').trim() || 'opponent',
                chance: safeChance,
                params,
            })
        }

        return parsedEffectSpecs
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (!formData.name.trim()) {
            setError('Tên kỹ năng là bắt buộc')
            return
        }

        if (!formData.type || !formData.category) {
            setError('Vui lòng chọn hệ và nhóm kỹ năng')
            return
        }

        if (formData.learnScope === 'type' && formData.allowedTypes.length === 0) {
            setError('Phạm vi theo hệ cần ít nhất 1 hệ Pokemon')
            return
        }
        if (formData.learnScope === 'species' && formData.allowedPokemonIds.length === 0) {
            setError('Phạm vi Pokemon đặc biệt cần ít nhất 1 loài Pokemon')
            return
        }
        if (formData.learnScope === 'rarity' && formData.allowedRarities.length === 0) {
            setError('Phạm vi theo độ hiếm cần ít nhất 1 mức độ hiếm')
            return
        }

        let manualEffectSpecs = []
        try {
            manualEffectSpecs = buildEffectSpecsPayload()
        } catch (buildError) {
            setError(buildError.message)
            return
        }

        const payload = {
            ...formData,
            power: toNumberOrNull(formData.power),
            accuracy: toNumberOrNull(formData.accuracy),
            pp: toNumberOrNull(formData.pp),
            priority: toNumberOrNull(formData.priority),
            shopPrice: toNumberOrNull(formData.shopPrice) || 0,
            allowedTypes: [...new Set((formData.allowedTypes || []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))],
            allowedPokemonIds: [...new Set((formData.allowedPokemonIds || []).map((entry) => String(entry).trim()).filter(Boolean))],
            allowedRarities: [...new Set((formData.allowedRarities || []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))],
            effectSpecs: manualEffectSpecs,
        }

        try {
            setLoading(true)
            if (isEdit) {
                await moveApi.update(id, payload)
            } else {
                await moveApi.create(payload)
            }
            navigate('/admin/moves')
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const effectPickerKeyword = String(effectPickerSearch || '').trim().toLowerCase()
    const filteredEffectCatalog = effectCatalog.filter((entry) => {
        if (!effectPickerKeyword) return true
        const id = String(entry?.id || '').toLowerCase()
        const nameEn = String(entry?.nameEn || '').toLowerCase()
        const nameVi = String(entry?.nameVi || '').toLowerCase()
        return id.includes(effectPickerKeyword)
            || nameEn.includes(effectPickerKeyword)
            || nameVi.includes(effectPickerKeyword)
    })
    const effectPickerTotal = filteredEffectCatalog.length
    const effectPickerTotalPages = Math.max(1, Math.ceil(effectPickerTotal / EFFECT_PICKER_PAGE_SIZE))
    const safeEffectPickerPage = Math.min(effectPickerPage, effectPickerTotalPages)
    const effectPickerStart = effectPickerTotal === 0 ? 0 : ((safeEffectPickerPage - 1) * EFFECT_PICKER_PAGE_SIZE) + 1
    const effectPickerEnd = effectPickerTotal === 0
        ? 0
        : Math.min(effectPickerTotal, safeEffectPickerPage * EFFECT_PICKER_PAGE_SIZE)
    const effectPickerRows = filteredEffectCatalog.slice(
        (safeEffectPickerPage - 1) * EFFECT_PICKER_PAGE_SIZE,
        safeEffectPickerPage * EFFECT_PICKER_PAGE_SIZE
    )

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm max-w-3xl mx-auto mb-10">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">
                    {isEdit ? 'Cập Nhật Kỹ Năng' : 'Thêm Mới Kỹ Năng'}
                </h1>
            </div>

            <div className="p-6">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên Kỹ Năng *</label>
                        <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Hệ</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {MOVE_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Nhóm</label>
                            <select
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {MOVE_CATEGORIES.map((entry) => (
                                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Độ Hiếm</label>
                            <select
                                value={formData.rarity}
                                onChange={(e) => setFormData({ ...formData, rarity: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {MOVE_RARITIES.map((entry) => (
                                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Power</label>
                            <input
                                type="number"
                                min="0"
                                max="250"
                                value={formData.power}
                                onChange={(e) => setFormData({ ...formData, power: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Accuracy</label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={formData.accuracy}
                                onChange={(e) => setFormData({ ...formData, accuracy: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">PP</label>
                            <input
                                type="number"
                                min="1"
                                max="40"
                                value={formData.pp}
                                onChange={(e) => setFormData({ ...formData, pp: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Priority</label>
                            <input
                                type="number"
                                min="-6"
                                max="6"
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá Cửa Hàng (Xu)</label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={formData.shopPrice}
                                onChange={(e) => setFormData({ ...formData, shopPrice: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                        <div className="flex items-end gap-5">
                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={Boolean(formData.isShopEnabled)}
                                    onChange={(e) => setFormData({ ...formData, isShopEnabled: e.target.checked })}
                                    className="accent-blue-600"
                                />
                                Hiển thị trong shop
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={Boolean(formData.isActive)}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="accent-blue-600"
                                />
                                Kỹ năng đang hoạt động
                            </label>
                        </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Phân Loại Đối Tượng Học</label>
                            <select
                                value={formData.learnScope}
                                onChange={(e) => setFormData((prev) => ({ ...prev, learnScope: e.target.value }))}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {LEARN_SCOPE_OPTIONS.map((entry) => (
                                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                                ))}
                            </select>
                        </div>

                        {formData.learnScope === 'move_type' && (
                            <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2">
                                Tự động áp dụng: chỉ Pokemon có hệ trùng với hệ của kỹ năng mới học được.
                            </div>
                        )}

                        {formData.learnScope === 'type' && (
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-2 uppercase">Các hệ Pokemon được học</label>
                                <div className="flex flex-wrap gap-2">
                                    {MOVE_TYPES.map((type) => {
                                        const isActive = formData.allowedTypes.includes(type)
                                        return (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setFormData((prev) => ({
                                                    ...prev,
                                                    allowedTypes: isActive
                                                        ? prev.allowedTypes.filter((entry) => entry !== type)
                                                        : [...prev.allowedTypes, type],
                                                }))}
                                                className={`px-2 py-1 border rounded text-xs font-bold uppercase ${isActive
                                                    ? 'bg-blue-600 text-white border-blue-600'
                                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                                    }`}
                                            >
                                                {type}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {formData.learnScope === 'species' && (
                            <div className="space-y-2">
                                <label className="block text-slate-700 text-xs font-bold uppercase">Pokemon đặc biệt được học</label>
                                <input
                                    type="text"
                                    value={speciesSearch}
                                    onChange={(e) => setSpeciesSearch(e.target.value)}
                                    placeholder="Tìm theo tên hoặc số pokedex..."
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                />
                                <div className="max-h-48 overflow-auto border border-slate-200 rounded bg-white p-2 space-y-1">
                                    {pokemonOptions
                                        .filter((pokemon) => {
                                            const keyword = speciesSearch.trim().toLowerCase()
                                            if (!keyword) return true
                                            return String(pokemon.name || '').toLowerCase().includes(keyword)
                                                || String(pokemon.pokedexNumber || '').includes(keyword)
                                        })
                                        .slice(0, 200)
                                        .map((pokemon) => {
                                            const pokemonId = String(pokemon._id)
                                            const checked = formData.allowedPokemonIds.includes(pokemonId)
                                            return (
                                                <label key={pokemonId} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-sm text-slate-700">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(e) => setFormData((prev) => ({
                                                            ...prev,
                                                            allowedPokemonIds: e.target.checked
                                                                ? [...prev.allowedPokemonIds, pokemonId]
                                                                : prev.allowedPokemonIds.filter((entry) => entry !== pokemonId),
                                                        }))}
                                                        className="accent-blue-600"
                                                    />
                                                    <span className="font-semibold">#{pokemon.pokedexNumber}</span>
                                                    <span>{pokemon.name}</span>
                                                </label>
                                            )
                                        })}
                                </div>
                                <p className="text-xs text-slate-500">Đã chọn: {formData.allowedPokemonIds.length} loài Pokemon.</p>
                            </div>
                        )}

                        {formData.learnScope === 'rarity' && (
                            <div>
                                <label className="block text-slate-700 text-xs font-bold mb-2 uppercase">Độ hiếm Pokemon được học</label>
                                <div className="flex flex-wrap gap-2">
                                    {POKEMON_RARITIES.map((entry) => {
                                        const active = formData.allowedRarities.includes(entry.value)
                                        return (
                                            <button
                                                key={entry.value}
                                                type="button"
                                                onClick={() => setFormData((prev) => ({
                                                    ...prev,
                                                    allowedRarities: active
                                                        ? prev.allowedRarities.filter((value) => value !== entry.value)
                                                        : [...prev.allowedRarities, entry.value],
                                                }))}
                                                className={`px-2 py-1 border rounded text-xs font-bold ${active
                                                    ? 'bg-amber-500 text-white border-amber-500'
                                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                                    }`}
                                            >
                                                {entry.label}
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">Gợi ý: chọn `S/SS/SSS` cho kỹ năng huyền thoại/thần thoại.</p>
                            </div>
                        )}
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-slate-700 text-xs font-bold uppercase">Hiệu ứng áp dụng vào kỹ năng</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Chọn hiệu ứng đã hoàn chỉnh. Nếu để trống, server sẽ tự phân tích từ mô tả khi lưu.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openEffectPicker()}
                                    disabled={effectCatalogLoading || effectCatalog.length === 0}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded text-xs font-bold"
                                >
                                    Chọn hiệu ứng
                                </button>
                            </div>
                        </div>

                        <div className="rounded border border-blue-100 bg-blue-50 p-3 text-[11px] text-blue-900 space-y-1">
                            <p className="font-bold uppercase">Ghi chú nhãn dữ liệu</p>
                            <p><span className="font-semibold">Effect ID:</span> Mã hiệu ứng của engine battle (quyết định logic chạy).</p>
                            <p><span className="font-semibold">Trigger:</span> Thời điểm kích hoạt hiệu ứng trong lượt đánh.</p>
                            <p><span className="font-semibold">Target:</span> Đối tượng nhận hiệu ứng (`self`, `opponent`, `field`).</p>
                            <p><span className="font-semibold">Chance (0-1):</span> Xác suất kích hoạt. Ví dụ `1 = 100%`, `0.3 = 30%`.</p>
                            <p><span className="font-semibold">Params JSON:</span> Tham số chi tiết tùy theo từng Effect ID.</p>
                        </div>

                        {effectDrafts.length === 0 ? (
                            <div className="text-xs text-slate-500 italic bg-white border border-slate-200 rounded p-3">
                                Chưa có hiệu ứng thủ công. Khi lưu, hệ thống sẽ tự parse từ mô tả kỹ năng.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {effectDrafts.map((draft, index) => (
                                    <div key={draft.key} className="bg-white border border-slate-200 rounded p-3 space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-xs font-bold text-slate-700 uppercase">Hiệu ứng #{index + 1}</p>
                                            <button
                                                type="button"
                                                onClick={() => removeEffectDraft(draft.key)}
                                                className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-xs font-bold"
                                            >
                                                Xóa
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                            <div className="md:col-span-2">
                                                <label className="block text-[11px] text-slate-600 mb-1 font-semibold uppercase">Effect ID</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={draft.op}
                                                        onChange={(e) => updateEffectDraft(draft.key, { op: e.target.value })}
                                                        placeholder="vd: apply_status"
                                                        className="flex-1 px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => openEffectPicker({ draftKey: draft.key })}
                                                        disabled={effectCatalogLoading || effectCatalog.length === 0}
                                                        className="px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-semibold whitespace-nowrap"
                                                    >
                                                        Chọn
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[11px] text-slate-600 mb-1 font-semibold uppercase">Trigger</label>
                                                <select
                                                    value={draft.trigger}
                                                    onChange={(e) => updateEffectDraft(draft.key, { trigger: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
                                                >
                                                    {effectTriggerOptions.map((entry) => (
                                                        <option key={entry} value={entry}>{entry} - {EFFECT_TRIGGER_LABELS[entry] || 'Kích hoạt theo cấu hình custom'}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-500 mt-1">{EFFECT_TRIGGER_LABELS[draft.trigger] || 'Thời điểm kích hoạt custom.'}</p>
                                            </div>

                                            <div>
                                                <label className="block text-[11px] text-slate-600 mb-1 font-semibold uppercase">Target</label>
                                                <select
                                                    value={draft.target}
                                                    onChange={(e) => updateEffectDraft(draft.key, { target: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
                                                >
                                                    {effectTargetOptions.map((entry) => (
                                                        <option key={entry} value={entry}>{entry} - {EFFECT_TARGET_LABELS[entry] || 'Mục tiêu custom'}</option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-slate-500 mt-1">{EFFECT_TARGET_LABELS[draft.target] || 'Đối tượng áp dụng custom.'}</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                            <div>
                                                <label className="block text-[11px] text-slate-600 mb-1 font-semibold uppercase">Chance (0-1)</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={draft.chance}
                                                    onChange={(e) => updateEffectDraft(draft.key, { chance: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
                                                />
                                            </div>
                                            <div className="md:col-span-3">
                                                <label className="block text-[11px] text-slate-600 mb-1 font-semibold uppercase">Params JSON</label>
                                                <textarea
                                                    rows={4}
                                                    value={draft.paramsText}
                                                    onChange={(e) => updateEffectDraft(draft.key, { paramsText: e.target.value })}
                                                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded border border-blue-100 p-4 shadow-sm">
                        <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-blue-900 uppercase">Ảnh Kỹ Năng</h3>
                                <p className="text-xs text-blue-700 mt-1">Tải ảnh đại diện cho kỹ năng.</p>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                            <ImageUpload
                                currentImage={formData.imageUrl}
                                onUploadSuccess={(url) => setFormData((prev) => ({
                                    ...prev,
                                    imageUrl: Array.isArray(url) ? (url[0] || '') : (url || ''),
                                }))}
                                label="Ảnh Kỹ Năng"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Mô Tả</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            rows="4"
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                        />
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-slate-200">
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg text-sm font-bold shadow-md transform transition-all active:scale-[0.98]"
                        >
                            {loading ? 'Đang Xử Lý...' : isEdit ? 'LƯU THAY ĐỔI' : 'TẠO KỸ NĂNG MỚI'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/moves')}
                            className="px-8 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-bold shadow-sm transition-all"
                        >
                            Hủy
                        </button>
                    </div>
                </form>
            </div>

            <div className="text-center mt-6 p-4">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>

            {showEffectPickerModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
                    onClick={closeEffectPicker}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                            <h3 className="text-lg font-bold text-slate-800">
                                {effectPickerDraftKey ? 'Chọn Effect ID cho hiệu ứng hiện tại' : 'Chọn hiệu ứng để thêm'}
                            </h3>
                            <button
                                type="button"
                                onClick={closeEffectPicker}
                                className="text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm hiệu ứng</label>
                                <input
                                    type="text"
                                    value={effectPickerSearch}
                                    onChange={(e) => {
                                        setEffectPickerSearch(e.target.value)
                                        setEffectPickerPage(1)
                                    }}
                                    placeholder="Nhập id, tên EN hoặc tên VI"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {effectCatalogLoading ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải danh mục hiệu ứng...</div>
                                ) : effectPickerRows.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy hiệu ứng phù hợp</div>
                                ) : (
                                    effectPickerRows.map((entry) => {
                                        const selectedDraft = effectPickerDraftKey
                                            ? effectDrafts.find((draft) => draft.key === effectPickerDraftKey)
                                            : null
                                        const isSelected = selectedDraft
                                            ? String(selectedDraft.op || '').trim() === String(entry.id || '').trim()
                                            : false
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => handleSelectEffectFromPicker(entry.id)}
                                                className={`w-full px-3 py-2 text-left transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="font-mono text-xs text-slate-500 flex-shrink-0">{entry.id}</span>
                                                            <span className="font-semibold text-slate-700 truncate">{entry.nameEn}</span>
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5 truncate">{entry.nameVi}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-2 py-0.5">
                                                            {Number(entry.usageCount || 0).toLocaleString('vi-VN')}
                                                        </span>
                                                        {isSelected && (
                                                            <span className="text-[11px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded px-2 py-0.5">Đã chọn</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>
                                    Trang này có {effectPickerRows.length} hiệu ứng từ {effectPickerStart}-{effectPickerEnd} / {effectPickerTotal}
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEffectPickerPage((prev) => Math.max(1, prev - 1))}
                                        disabled={safeEffectPickerPage <= 1 || effectCatalogLoading}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">
                                        Trang {safeEffectPickerPage}/{effectPickerTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setEffectPickerPage((prev) => Math.min(effectPickerTotalPages, prev + 1))}
                                        disabled={safeEffectPickerPage >= effectPickerTotalPages || effectCatalogLoading}
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
