import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mapApi } from '../../services/adminApi'
import { gameApi } from '../../services/gameApi'
import ImageUpload from '../../components/ImageUpload'

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
        specialPokemonIds: [],
        requiredSearches: 0,
        encounterRate: 1,
        itemDropRate: 0,
        orderIndex: 0,
    })

    const [allPokemon, setAllPokemon] = useState([])
    const [loadingPokemon, setLoadingPokemon] = useState(false)
    const [selectedPokemonIdToAdd, setSelectedPokemonIdToAdd] = useState('')

    const normalizeSpecialPokemonIds = (value) => {
        if (!Array.isArray(value)) return []
        return value
            .map((item) => {
                if (!item) return ''
                if (typeof item === 'string') return item
                return item._id || ''
            })
            .filter(Boolean)
    }

    useEffect(() => {
        loadPokemonOptions()
        if (isEdit) {
            loadMap()
        }
    }, [id])

    const loadPokemonOptions = async () => {
        try {
            setLoadingPokemon(true)
            const data = await gameApi.getPokemonList({ page: 1, limit: 5000 })
            setAllPokemon(data.pokemon || [])
        } catch (err) {
            setError(err.message)
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
                specialPokemonIds: normalizeSpecialPokemonIds(data.map.specialPokemonIds),
                isLegendary: data.map.isLegendary || false,
                requiredSearches: data.map.requiredSearches || 0,
                encounterRate: data.map.encounterRate ?? 1,
                itemDropRate: data.map.itemDropRate ?? 0,
                orderIndex: data.map.orderIndex || 0,
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

        if (formData.levelMax < formData.levelMin) {
            setError('Cấp độ tối đa phải >= Cấp độ tối thiểu')
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

    const handleAddSpecialPokemon = () => {
        if (!selectedPokemonIdToAdd) return

        if (formData.specialPokemonIds.length >= 5) {
            setError('Chỉ có thể chọn tối đa 5 Pokemon đặc biệt')
            return
        }

        if (formData.specialPokemonIds.includes(selectedPokemonIdToAdd)) {
            setSelectedPokemonIdToAdd('')
            return
        }

        setFormData((prev) => ({
            ...prev,
            specialPokemonIds: [...prev.specialPokemonIds, selectedPokemonIdToAdd],
        }))
        setSelectedPokemonIdToAdd('')
        setError('')
    }

    const handleRemoveSpecialPokemon = (pokemonIdToRemove) => {
        setFormData((prev) => ({
            ...prev,
            specialPokemonIds: prev.specialPokemonIds.filter((pokemonId) => pokemonId !== pokemonIdToRemove),
        }))
    }

    const selectedSpecialPokemon = formData.specialPokemonIds
        .map((id) => allPokemon.find((pokemon) => pokemon._id === id))
        .filter(Boolean)

    const selectablePokemon = allPokemon.filter((pokemon) => !formData.specialPokemonIds.includes(pokemon._id))

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
                            <div className="grid grid-cols-2 gap-6">
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
                                    <p className="text-xs text-blue-700 mt-1">Chọn Pokemon từ kho Pokemon admin. Tối đa 5 Pokemon.</p>
                                </div>
                                <span className="text-xs font-bold text-white bg-blue-600 px-2 py-1 rounded">
                                    {formData.specialPokemonIds.length} / 5
                                </span>
                            </div>

                            <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <select
                                        value={selectedPokemonIdToAdd}
                                        onChange={(e) => setSelectedPokemonIdToAdd(e.target.value)}
                                        disabled={loadingPokemon || formData.specialPokemonIds.length >= 5 || selectablePokemon.length === 0}
                                        className="flex-1 px-4 py-2 bg-white border border-slate-300 rounded text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">
                                            {loadingPokemon ? 'Đang tải Pokemon...' : 'Chọn Pokemon để thêm'}
                                        </option>
                                        {selectablePokemon.map((pokemon) => (
                                            <option key={pokemon._id} value={pokemon._id}>
                                                #{pokemon.pokedexNumber} - {pokemon.name}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={handleAddSpecialPokemon}
                                        disabled={!selectedPokemonIdToAdd || formData.specialPokemonIds.length >= 5}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Thêm
                                    </button>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] shadow-inner p-4">
                                    {selectedSpecialPokemon.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                                            {selectedSpecialPokemon.map((pokemon) => (
                                                <div key={pokemon._id} className="relative group aspect-square bg-slate-50 rounded border border-slate-200 flex flex-col items-center justify-center p-2 overflow-hidden hover:border-blue-400 transition-colors">
                                                    <img
                                                        src={pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.icon || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.pokedexNumber}.png`}
                                                        alt={pokemon.name}
                                                        className="w-16 h-16 object-contain pixelated"
                                                    />
                                                    <p className="text-[11px] font-semibold text-slate-700 text-center mt-1 line-clamp-2">{pokemon.name}</p>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveSpecialPokemon(pokemon._id)}
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
        </div>
    )
}





