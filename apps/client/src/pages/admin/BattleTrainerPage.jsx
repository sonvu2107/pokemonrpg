import { useEffect, useState } from 'react'
import { battleTrainerApi, pokemonApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const emptyTrainer = {
    name: '',
    imageUrl: '',
    quote: '',
    isActive: true,
    orderIndex: 0,
    team: [],
    prizePokemonId: '',
}

export default function BattleTrainerPage() {
    const [trainers, setTrainers] = useState([])
    const [pokemon, setPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [form, setForm] = useState({ ...emptyTrainer })
    const [editingId, setEditingId] = useState('')

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            setLoading(true)
            const [trainerData, pokemonData] = await Promise.all([
                battleTrainerApi.list(),
                pokemonApi.list({ page: 1, limit: 5000 }),
            ])
            setTrainers(trainerData.trainers || [])
            setPokemon(pokemonData.pokemon || [])
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
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
        })
    }

    const handleDelete = async (id) => {
        if (!confirm('Xóa trainer này?')) return
        await battleTrainerApi.delete(id)
        loadData()
    }

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
                                placeholder="/assests/08_trainer_female.png"
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
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Phần thưởng</label>
                            <select
                                value={form.prizePokemonId}
                                onChange={(e) => setForm({ ...form, prizePokemonId: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                <option value="">Không có</option>
                                {pokemon.map((p) => (
                                    <option key={p._id} value={p._id}>{p.name}</option>
                                ))}
                            </select>
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
        </div>
    )
}
