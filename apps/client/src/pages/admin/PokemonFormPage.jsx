
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { pokemonApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const TYPES = [
    'normal', 'fire', 'water', 'grass', 'electric', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic',
    'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'
]

const RARITIES = ['ss', 's', 'a', 'b', 'c', 'd']

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

const resolveDefaultFormId = (formList = [], preferredDefault = 'normal') => {
    const ids = formList.map(f => normalizeFormId(f?.formId)).filter(Boolean)
    if (ids.includes('normal')) return 'normal'
    const normalizedPreferred = normalizeFormId(preferredDefault)
    if (normalizedPreferred && ids.includes(normalizedPreferred)) return normalizedPreferred
    return ids[0] || 'normal'
}

const GROWTH_RATES = ['fast', 'medium_fast', 'medium_slow', 'slow', 'erratic', 'fluctuating']

export default function PokemonFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [allPokemon, setAllPokemon] = useState([])

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

    useEffect(() => {
        loadData()
    }, [id])

    const loadData = async () => {
        try {
            setLoading(true)
            // Fetch all pokemon for evolution dropdown
            const pokemonList = await pokemonApi.list({ limit: 1000 })
            setAllPokemon(pokemonList.pokemon || [])

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
                    .map(m => ({ level: parseInt(m.level) || 1, moveName: m.moveName })),
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

    const applyPresetToForm = (index, presetId) => {
        const normalizedPresetId = normalizeFormId(presetId).toLowerCase()
        if (!normalizedPresetId) return
        const presetName = FORM_VARIANT_NAME_BY_ID[normalizedPresetId] || normalizedPresetId

        setForms(prev => {
            const next = prev.map((f, i) => {
                if (i !== index) return f
                return { ...f, formId: normalizedPresetId, formName: presetName }
            })
            setDefaultFormId((prevDefault) => resolveDefaultFormId(next, prevDefault))
            return next
        })
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
                                                <select
                                                    value=""
                                                    onChange={(e) => {
                                                        applyPresetToForm(index, e.target.value)
                                                        e.target.value = ''
                                                    }}
                                                    className="w-full mb-2 px-3 py-2 bg-white border border-slate-300 rounded text-xs"
                                                >
                                                    <option value="">Chọn nhanh dạng có sẵn...</option>
                                                    {FORM_VARIANTS.map((variant) => (
                                                        <option key={variant.id} value={variant.id}>
                                                            {variant.name} ({variant.id})
                                                        </option>
                                                    ))}
                                                </select>
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
                                        currentImage={form.imageUrl}
                                        onUploadSuccess={(urls) => {
                                            const nextUrl = Array.isArray(urls) ? (urls[0] || '') : (urls || '')
                                            updateForm(index, { imageUrl: nextUrl })
                                        }}
                                        multiple
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
        </div>
    )
}







