
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
        <div className="rounded border border-blue-400 bg-white shadow-sm max-w-5xl mx-auto mb-10">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-6 py-3 sticky top-0 z-10 shadow-md flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm flex items-center gap-2">
                    {isEdit ? (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                            </svg>
                            Cập Nhật Pokemon
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Thêm Mới Pokemon
                        </>
                    )}
                </h1>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/pokemon')}
                        className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-bold transition-colors"
                    >
                        Quay lại
                    </button>
                    <button
                        type="submit"
                        disabled={loading}
                        onClick={handleSubmit} // Trigger form submit externally if needed
                        className="px-6 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-bold shadow-sm transition-colors uppercase tracking-wide"
                    >
                        {loading ? 'Đang Lưu...' : 'Lưu Dữ Liệu'}
                    </button>
                </div>
            </div>

            <div className="p-6 bg-slate-50 min-h-screen">
                {error && <div className="p-4 mb-6 bg-red-50 text-red-700 border border-red-200 rounded text-sm flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                </div>}

                <form onSubmit={handleSubmit} className="space-y-6">

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* --- LEFT COLUMN (Basic Info) --- */}
                        <div className="lg:col-span-4 space-y-6">
                            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2 border-b pb-2">
                                    <span className="bg-blue-100 text-blue-800 p-1 rounded">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                                        </svg>
                                    </span>
                                    Thông Tin Chung
                                </h3>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Số Pokedex</label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2 text-slate-400 font-mono text-sm">#</span>
                                                <input
                                                    type="number"
                                                    required
                                                    min="1"
                                                    max="9999"
                                                    value={formData.pokedexNumber}
                                                    onChange={(e) => setFormData({ ...formData, pokedexNumber: parseInt(e.target.value) || '' })}
                                                    className="w-full pl-6 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-800 text-sm font-mono font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                    placeholder="001"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Độ Hiếm</label>
                                            <select
                                                value={formData.rarity}
                                                onChange={(e) => setFormData({ ...formData, rarity: e.target.value })}
                                                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm font-medium focus:border-blue-500"
                                            >
                                                {RARITIES.map(r => (
                                                    <option key={r} value={r}>{r.toUpperCase().replace('_', ' ')}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Tên Pokemon</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-800 text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            placeholder="Bulbasaur"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Hệ (Chọn 1-2)</label>
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {TYPES.map(type => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => toggleType(type)}
                                                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase border transition-all ${formData.types.includes(type)
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                        : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    {type.slice(0, 3)}
                                                </button>
                                            ))}
                                        </div>
                                        {/* Selected Types Preview */}
                                        <div className="flex gap-2 min-h-[24px]">
                                            {formData.types.map(t => (
                                                <span key={t} className="px-2 py-0.5 bg-slate-800 text-white text-xs font-bold uppercase rounded shadow-sm">
                                                    {t}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Mô Tả</label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows="4"
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-600 focus:border-blue-500"
                                            placeholder="Mô tả ngắn gọn về Pokemon..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* --- RIGHT COLUMN (Stats, Mechanics, Evolution) --- */}
                        <div className="lg:col-span-8 space-y-6">

                            {/* Stats & Mechanics Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Base Stats */}
                                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2 border-b pb-2">
                                        <span className="bg-green-100 text-green-800 p-1 rounded">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                                            </svg>
                                        </span>
                                        Chỉ Số Cơ Bản
                                    </h3>
                                    <div className="grid grid-cols-3 gap-3">
                                        {['hp', 'atk', 'def', 'spatk', 'spldef', 'spd'].map(stat => (
                                            <div key={stat}>
                                                <label className="block text-slate-400 text-[10px] font-bold uppercase mb-1 text-center">{stat}</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="255"
                                                    value={formData.baseStats[stat]}
                                                    onChange={(e) => updateStat(stat, e.target.value)}
                                                    className={`w-full px-1 py-1.5 border border-slate-200 rounded text-sm text-center font-bold focus:border-blue-500 ${formData.baseStats[stat] >= 100 ? 'text-green-600 bg-green-50' :
                                                        formData.baseStats[stat] >= 60 ? 'text-slate-700 bg-slate-50' : 'text-red-500 bg-red-50'
                                                        }`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Mechanics */}
                                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2 border-b pb-2">
                                        <span className="bg-purple-100 text-purple-800 p-1 rounded">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                                            </svg>
                                        </span>
                                        Cơ Chế
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="flex gap-4">
                                            <div className="flex-1">
                                                <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Tỷ Lệ Bắt</label>
                                                <input
                                                    type="number"
                                                    value={formData.catchRate}
                                                    onChange={(e) => setFormData({ ...formData, catchRate: parseInt(e.target.value) || 45 })}
                                                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Base EXP</label>
                                                <input
                                                    type="number"
                                                    value={formData.baseExperience}
                                                    onChange={(e) => setFormData({ ...formData, baseExperience: parseInt(e.target.value) || 50 })}
                                                    className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1">Tốc Độ Lớn</label>
                                            <select
                                                value={formData.growthRate}
                                                onChange={(e) => setFormData({ ...formData, growthRate: e.target.value })}
                                                className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm"
                                            >
                                                {GROWTH_RATES.map(rate => (
                                                    <option key={rate} value={rate}>{rate.replace('_', ' ').toUpperCase()}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Evolution */}
                            <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-5 rounded-lg border border-orange-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-10">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={5} stroke="currentColor" className="w-24 h-24 text-orange-500">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                </div>
                                <h3 className="text-sm font-bold text-orange-800 uppercase mb-4 flex items-center gap-2 border-b border-orange-200 pb-2 relative z-10">
                                    <span className="bg-orange-200 text-orange-800 p-1 rounded">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                                        </svg>
                                    </span>
                                    Tiến Hóa
                                </h3>

                                <div className="flex flex-col md:flex-row gap-4 items-center relative z-10">
                                    {/* From (Current) */}
                                    <div className="flex-1 bg-white/50 p-3 rounded border border-orange-100 text-center">
                                        <div className="text-xs text-slate-500 uppercase font-bold mb-1">Hiện Tại</div>
                                        <div className="font-bold text-slate-800">{formData.name || '(Chưa đặt tên)'}</div>
                                    </div>

                                    {/* Arrow & Level */}
                                    <div className="flex flex-col items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-orange-400">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
                                        </svg>
                                        <div className="w-24">
                                            <input
                                                type="number"
                                                min="1"
                                                placeholder="Lv. Min"
                                                className="w-full text-center px-2 py-1 bg-white border border-orange-200 rounded text-xs font-bold focus:ring-1 focus:ring-orange-400 placeholder-orange-300"
                                                value={formData.evolution.minLevel || ''}
                                                onChange={(e) => setFormData({ ...formData, evolution: { ...formData.evolution, minLevel: e.target.value } })}
                                                disabled={!formData.evolution.evolvesTo}
                                            />
                                        </div>
                                    </div>

                                    {/* To (Target) */}
                                    <div className="flex-1 w-full md:w-auto">
                                        <label className="block text-slate-500 text-[10px] font-bold uppercase mb-1 text-center md:text-left">Tiến Hóa Thành</label>
                                        <select
                                            value={formData.evolution.evolvesTo}
                                            onChange={(e) => setFormData({ ...formData, evolution: { ...formData.evolution, evolvesTo: e.target.value } })}
                                            className="w-full px-3 py-2 bg-white border border-orange-200 rounded text-sm shadow-sm focus:ring-2 focus:ring-orange-200"
                                        >
                                            <option value="">-- Không tiến hóa --</option>
                                            {allPokemon.map(p => (
                                                <option key={p._id} value={p._id} disabled={p._id === id}>
                                                    #{p.pokedexNumber} {p.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* --- FULL WIDTH SECTIONS --- */}

                    {/* Moves */}
                    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mt-6">
                        <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2 border-b pb-2">
                            <span className="bg-indigo-100 text-indigo-800 p-1 rounded">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                                </svg>
                            </span>
                            Bộ Chiêu Thức (Level Up)
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {formData.levelUpMoves.map((move, index) => (
                                <div key={index} className="flex gap-2 items-center bg-slate-50 p-2 rounded border border-slate-200">
                                    <div className="w-16">
                                        <label className="text-[10px] text-slate-400 font-bold uppercase block text-center">Lv</label>
                                        <input
                                            type="number"
                                            value={move.level}
                                            onChange={(e) => updateMove(index, 'level', e.target.value)}
                                            className="w-full text-center bg-white border border-slate-300 rounded px-1 py-1 text-sm font-bold"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] text-slate-400 font-bold uppercase block">Move Name</label>
                                        <input
                                            type="text"
                                            value={move.moveName}
                                            onChange={(e) => updateMove(index, 'moveName', e.target.value)}
                                            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-sm"
                                            placeholder="Tackle"
                                        />
                                    </div>
                                    <div className="mt-4">
                                        <button
                                            type="button"
                                            onClick={() => removeMove(index)}
                                            className="text-red-400 hover:text-red-600 p-1"
                                            title="Xóa chiêu"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={addMove}
                                className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 rounded hover:border-blue-400 hover:bg-slate-50 text-slate-400 hover:text-blue-500 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 mb-1">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                                <span className="text-xs font-bold uppercase">Thêm Chiêu</span>
                            </button>
                        </div>
                    </div>

                    {/* Forms */}
                    <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mt-6">
                        <div className="flex justify-between items-center mb-4 border-b pb-2">
                            <h3 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
                                <span className="bg-pink-100 text-pink-800 p-1 rounded">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                                    </svg>
                                </span>
                                Các Biến Thể (Forms)
                            </h3>
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-500 font-bold uppercase">Form Mặc Định:</label>
                                <select
                                    value={defaultFormId}
                                    onChange={(e) => setDefaultFormId(normalizeFormId(e.target.value))}
                                    className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs font-bold"
                                >
                                    {forms.map(f => (
                                        <option key={f.formId} value={f.formId}>{f.formName || f.formId}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-6">
                            {forms.map((form, index) => (
                                <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-50 p-4 rounded border border-slate-200 relative">
                                    <button
                                        type="button"
                                        onClick={() => removeForm(index)}
                                        className="absolute top-2 right-2 text-red-300 hover:text-red-500"
                                        title="Xóa Form"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                                        </svg>
                                    </button>

                                    {/* Left: Identity of Form */}
                                    <div className="md:col-span-4 space-y-4 border-r border-slate-200 pr-4">
                                        <div>
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">ID Biến Thể</label>
                                            <div className="flex gap-2">
                                                <select
                                                    value=""
                                                    onChange={(e) => {
                                                        applyPresetToForm(index, e.target.value)
                                                        e.target.value = ''
                                                    }}
                                                    className="w-1/3 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                                                >
                                                    <option value="">Preset...</option>
                                                    {FORM_VARIANTS.map((variant) => (
                                                        <option key={variant.id} value={variant.id}>
                                                            {variant.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="text"
                                                    value={form.formId}
                                                    onChange={(e) => updateForm(index, { formId: e.target.value })}
                                                    className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-bold font-mono text-blue-700"
                                                    placeholder="normal"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Tên Hiển Thị</label>
                                            <input
                                                type="text"
                                                value={form.formName}
                                                onChange={(e) => updateForm(index, { formName: e.target.value })}
                                                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-sm"
                                                placeholder="Normal Form"
                                            />
                                        </div>
                                    </div>

                                    {/* Right: Images */}
                                    <div className="md:col-span-8">
                                        <ImageUpload
                                            currentImage={form.imageUrl}
                                            onUploadSuccess={(urls) => {
                                                const nextUrl = Array.isArray(urls) ? (urls[0] || '') : (urls || '')
                                                updateForm(index, { imageUrl: nextUrl })
                                            }}
                                            label="Hình Ảnh (Sprite)"
                                        />
                                    </div>
                                </div>
                            ))}

                            <button
                                type="button"
                                onClick={addForm}
                                className="w-full py-2 border-2 border-dashed border-slate-300 text-slate-500 rounded hover:border-blue-400 hover:text-blue-600 font-bold text-xs uppercase"
                            >
                                + Thêm Biến Thể Mới
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
