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

export default function MoveFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [pokemonOptions, setPokemonOptions] = useState([])
    const [speciesSearch, setSpeciesSearch] = useState('')

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
        if (isEdit) {
            loadMove()
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
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
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
                                Tự động áp dụng: chỉ Pokemon có hệ trùng với hệ của kỹ năng mới học được (không cần tick tay).
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
        </div>
    )
}
