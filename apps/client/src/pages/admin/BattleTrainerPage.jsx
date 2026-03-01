import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { battleTrainerApi, pokemonApi } from '../../services/adminApi'
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
    platinumCoinsReward: 0,
    expReward: 0,
}

const PRIZE_POKEMON_MODAL_PAGE_SIZE = 40

export default function BattleTrainerPage() {
    const [trainers, setTrainers] = useState([])
    const [pokemon, setPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [form, setForm] = useState({ ...emptyTrainer })
    const [editingId, setEditingId] = useState('')
    const [showPrizePokemonModal, setShowPrizePokemonModal] = useState(false)
    const [prizePokemonSearchTerm, setPrizePokemonSearchTerm] = useState('')
    const [prizePokemonOptions, setPrizePokemonOptions] = useState([])
    const [prizePokemonLookup, setPrizePokemonLookup] = useState({})
    const [prizePokemonPage, setPrizePokemonPage] = useState(1)
    const [prizePokemonTotalPages, setPrizePokemonTotalPages] = useState(1)
    const [prizePokemonTotal, setPrizePokemonTotal] = useState(0)
    const [prizePokemonLoading, setPrizePokemonLoading] = useState(false)
    const [prizePokemonLoadError, setPrizePokemonLoadError] = useState('')

    useEffect(() => {
        loadData()
    }, [])

    useEffect(() => {
        if (!showPrizePokemonModal) return
        loadPrizePokemonOptions()
    }, [showPrizePokemonModal, prizePokemonPage, prizePokemonSearchTerm])

    const loadData = async () => {
        try {
            setLoading(true)
            const [trainerData, pokemonData] = await Promise.all([
                battleTrainerApi.list(),
                gameApi.getPokemonList({ page: 1, limit: 5000 }),
            ])
            setTrainers(trainerData.trainers || [])
            setPokemon(pokemonData.pokemon || [])
        } catch (err) {
            setError(err.message)
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

    const resetForm = () => {
        setForm({ ...emptyTrainer })
        setEditingId('')
    }

    const handleAddTeam = () => {
        setForm((prev) => ({
            ...prev,
            team: [...prev.team, { pokemonId: '', level: 5, formId: 'normal' }],
        }))
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
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        try {
            const payload = {
                ...form,
                team: form.team.length ? form.team : buildRandomTeam(),
                prizePokemonId: form.prizePokemonId || null,
                prizePokemonFormId: form.prizePokemonId
                    ? (String(form.prizePokemonFormId || '').trim().toLowerCase() || 'normal')
                    : null,
            }
            if (editingId) {
                await battleTrainerApi.update(editingId, payload)
            } else {
                await battleTrainerApi.create(payload)
            }
            resetForm()
            loadData()
        } catch (err) {
            setError(err.message)
        }
    }

    const handleEdit = (trainer) => {
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
            })),
            prizePokemonId: trainer.prizePokemonId?._id || trainer.prizePokemonId || '',
            prizePokemonFormId: String(trainer.prizePokemonFormId || trainer.prizePokemonId?.defaultFormId || 'normal').trim().toLowerCase() || 'normal',
            platinumCoinsReward: trainer.platinumCoinsReward || 0,
            expReward: trainer.expReward || 0,
        })
    }

    const handleDelete = async (id) => {
        if (!confirm('Xóa trainer này?')) return
        await battleTrainerApi.delete(id)
        loadData()
    }

    const handleOpenPrizePokemonModal = () => {
        setPrizePokemonSearchTerm('')
        setPrizePokemonPage(1)
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

    const getPokemonFormsForDisplay = (entry) => {
        const defaultFormId = normalizePokemonFormId(entry?.defaultFormId)
        const rawForms = Array.isArray(entry?.forms) && entry.forms.length > 0
            ? entry.forms
            : [{ formId: defaultFormId, formName: defaultFormId }]

        return rawForms
            .map((form) => ({
                formId: normalizePokemonFormId(form?.formId || defaultFormId),
                formName: String(form?.formName || '').trim() || normalizePokemonFormId(form?.formId || defaultFormId),
                resolvedImageUrl: form?.imageUrl
                    || form?.sprites?.normal
                    || form?.sprites?.icon
                    || getPokemonImageUrl(entry),
                isDefault: normalizePokemonFormId(form?.formId || defaultFormId) === defaultFormId,
            }))
            .filter((form, index, arr) => arr.findIndex((item) => item.formId === form.formId) === index)
            .sort((a, b) => {
                if (a.formId === defaultFormId) return -1
                if (b.formId === defaultFormId) return 1
                return a.formId.localeCompare(b.formId)
            })
    }

    const selectedPrizePokemon = pokemon.find((entry) => entry._id === form.prizePokemonId)
        || prizePokemonLookup[form.prizePokemonId]
        || null
    const selectedPrizePokemonForms = selectedPrizePokemon ? getPokemonFormsForDisplay(selectedPrizePokemon) : []
    const normalizedPrizePokemonFormId = normalizePokemonFormId(form.prizePokemonFormId)
    const selectedPrizePokemonForm = selectedPrizePokemonForms.find((entry) => entry.formId === normalizedPrizePokemonFormId)
        || selectedPrizePokemonForms[0]
        || null

    const prizePokemonFormRows = prizePokemonOptions.flatMap((entry) => {
        const forms = getPokemonFormsForDisplay(entry)
        return forms.map((rowForm) => ({
            key: `${entry._id}:${rowForm.formId}`,
            pokemon: entry,
            form: rowForm,
        }))
    })

    const prizePokemonPageStart = prizePokemonTotal > 0
        ? ((prizePokemonPage - 1) * PRIZE_POKEMON_MODAL_PAGE_SIZE) + 1
        : 0
    const prizePokemonPageEnd = prizePokemonTotal > 0
        ? Math.min(prizePokemonTotal, prizePokemonPage * PRIZE_POKEMON_MODAL_PAGE_SIZE)
        : 0

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider">Quản Lý Battle</h1>
            </div>
            <div className="p-4">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4 border border-slate-200 rounded p-4 bg-slate-50">
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
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Phần thưởng</label>
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
                            </div>
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
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">⭐ Exp Nhận Được</label>
                            <input
                                type="number"
                                min="0"
                                value={form.expReward}
                                onChange={(e) => setForm({ ...form, expReward: parseInt(e.target.value) || 0 })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                                placeholder="0 = dùng công thức mặc định"
                            />
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-slate-700 text-xs font-bold uppercase">Đội hình</label>
                            <div className="flex gap-2">
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
                        <div className="space-y-2">
                            {form.team.map((entry, index) => (
                                <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                    <select
                                        value={entry.pokemonId}
                                        onChange={(e) => handleUpdateTeam(index, 'pokemonId', e.target.value)}
                                        className="px-2 py-1 border border-slate-300 rounded text-sm"
                                    >
                                        <option value="">Chọn Pokémon</option>
                                        {pokemon.map((p) => (
                                            <option key={p._id} value={p._id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1"
                                        value={entry.level}
                                        onChange={(e) => handleUpdateTeam(index, 'level', parseInt(e.target.value) || 1)}
                                        className="px-2 py-1 border border-slate-300 rounded text-sm"
                                    />
                                    <input
                                        type="text"
                                        value={entry.formId}
                                        onChange={(e) => handleUpdateTeam(index, 'formId', e.target.value)}
                                        className="px-2 py-1 border border-slate-300 rounded text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveTeam(index)}
                                        className="px-2 py-1 text-xs font-bold bg-red-500 text-white rounded"
                                    >
                                        Xóa
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 text-white font-bold rounded"
                        >
                            {editingId ? 'Lưu trainer' : 'Tạo trainer'}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-4 py-2 bg-white border border-slate-300 rounded font-bold"
                            >
                                Hủy
                            </button>
                        )}
                    </div>
                </form>
                <div className="mt-6">
                    {loading ? (
                        <div className="text-sm text-slate-500">Đang tải...</div>
                    ) : (
                        <div className="space-y-3">
                            {trainers.map((trainer) => (
                                <div key={trainer._id} className="border border-slate-200 rounded p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {trainer.imageUrl ? (
                                            <img src={trainer.imageUrl} className="w-10 h-10 object-contain pixelated" />
                                        ) : (
                                            <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded" />
                                        )}
                                        <div>
                                            <div className="font-bold text-slate-800">{trainer.name}</div>
                                            <div className="text-xs text-slate-500">{trainer.team?.length || 0} Pokémon</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleEdit(trainer)}
                                            className="px-2 py-1 text-xs font-bold bg-green-600 text-white rounded"
                                        >
                                            Sửa
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

            {showPrizePokemonModal && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn"
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
                                        return (
                                            <button
                                                key={row.key}
                                                type="button"
                                                onClick={() => handleSelectPrizePokemon(entry._id, rowForm.formId)}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
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
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>
                                    Trang này có {prizePokemonFormRows.length} dạng từ {prizePokemonPageStart}-{prizePokemonPageEnd} / {prizePokemonTotal} Pokemon
                                </span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setPrizePokemonPage((prev) => Math.max(1, prev - 1))}
                                        disabled={prizePokemonPage <= 1 || prizePokemonLoading}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">
                                        Trang {prizePokemonPage}/{prizePokemonTotalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setPrizePokemonPage((prev) => Math.min(prizePokemonTotalPages, prev + 1))}
                                        disabled={prizePokemonPage >= prizePokemonTotalPages || prizePokemonLoading}
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
