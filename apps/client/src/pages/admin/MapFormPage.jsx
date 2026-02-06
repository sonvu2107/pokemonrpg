import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { mapApi } from '../../services/adminApi'

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
        specialPokemonImages: [],
        requiredSearches: 0,
        orderIndex: 0,
    })

    const [uploadingImage, setUploadingImage] = useState(false)
    const [uploadingMapImage, setUploadingMapImage] = useState(false)

    useEffect(() => {
        if (isEdit) {
            loadMap()
        }
    }, [id])

    const loadMap = async () => {
        try {
            setLoading(true)
            const data = await mapApi.getById(id)
            setFormData({
                ...data.map,
                description: data.map.description || '',
                mapImageUrl: data.map.mapImageUrl || '',
                iconId: data.map.iconId || '',
                specialPokemonImages: data.map.specialPokemonImages || [],
                isLegendary: data.map.isLegendary || false,
                requiredSearches: data.map.requiredSearches || 0,
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

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files)
        if (!files.length) return

        const currentCount = formData.specialPokemonImages.length
        const availableSlots = 5 - currentCount

        if (files.length > availableSlots) {
            setError(`Chỉ có thể thêm tối đa ${availableSlots} ảnh nữa (giới hạn 5 ảnh)`)
            return
        }

        try {
            setUploadingImage(true)
            setError('')

            const uploadPromises = files.map(async (file) => {
                // Validate file size (2MB)
                if (file.size > 2 * 1024 * 1024) {
                    throw new Error(`File ${file.name} vượt quá 2MB`)
                }

                // Validate file type
                if (!file.type.startsWith('image/')) {
                    throw new Error(`File ${file.name} không phải là ảnh`)
                }

                const data = await mapApi.uploadSpecialImage(file)
                return data.imageUrl
            })

            const uploadedUrls = await Promise.all(uploadPromises)

            setFormData(prev => ({
                ...prev,
                specialPokemonImages: [...prev.specialPokemonImages, ...uploadedUrls]
            }))
        } catch (err) {
            setError(err.message)
        } finally {
            setUploadingImage(false)
            // Reset file input
            e.target.value = ''
        }
    }

    const handleMapImageUpload = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            setUploadingMapImage(true)
            setError('')

            if (file.size > 2 * 1024 * 1024) {
                throw new Error(`File ${file.name} vượt quá 2MB`)
            }

            if (!file.type.startsWith('image/')) {
                throw new Error(`File ${file.name} không phải là ảnh`)
            }

            const data = await mapApi.uploadMapImage(file)
            setFormData(prev => ({
                ...prev,
                mapImageUrl: data.imageUrl || '',
            }))
        } catch (err) {
            setError(err.message)
        } finally {
            setUploadingMapImage(false)
            e.target.value = ''
        }
    }

    const handleRemoveImage = (indexToRemove) => {
        setFormData(prev => ({
            ...prev,
            specialPokemonImages: prev.specialPokemonImages.filter((_, i) => i !== indexToRemove)
        }))
    }

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
                                        <p className="text-xs text-blue-700 mt-1">Ảnh đại diện cho bản đồ (tối đa 2MB).</p>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                                    {formData.mapImageUrl ? (
                                        <div className="grid grid-cols-5 gap-3 mb-4">
                                            <div className="relative group aspect-square bg-slate-50 rounded border border-slate-200 flex items-center justify-center overflow-hidden hover:border-blue-400 transition-colors">
                                                <img
                                                    src={formData.mapImageUrl}
                                                    alt="Map preview"
                                                    className="w-full h-full object-contain p-1"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, mapImageUrl: '' }))}
                                                    className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs"
                                                    title="Xóa"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-6">
                                            <p className="text-sm font-bold text-slate-500 mb-2">Chưa có ảnh nào</p>
                                            <label className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-md cursor-pointer transition-all hover:-translate-y-0.5">
                                                {uploadingMapImage ? 'Đang tải lên...' : 'Tải Ảnh Lên'}
                                                <input type="file" accept="image/*" onChange={handleMapImageUpload} disabled={uploadingMapImage} className="hidden" />
                                            </label>
                                        </div>
                                    )}
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

                        {/* Special Pokemon Images Upload Section */}
                        <div className="bg-white rounded border border-blue-100 p-6 shadow-sm">
                            <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-6">
                                <div>
                                    <h3 className="text-sm font-bold text-blue-900 uppercase">Ảnh Pokemon Đặc Biệt</h3>
                                    <p className="text-xs text-blue-700 mt-1">Ảnh sẽ hiển thị ngoài Game. Tối đa 5 ảnh.</p>
                                </div>
                                <span className="text-xs font-bold text-white bg-blue-600 px-2 py-1 rounded">
                                    {formData.specialPokemonImages.length} / 5
                                </span>
                            </div>

                            <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                                {formData.specialPokemonImages.length > 0 ? (
                                    <div className="grid grid-cols-5 gap-3 mb-4">
                                        {formData.specialPokemonImages.map((url, index) => (
                                            <div key={index} className="relative group aspect-square bg-slate-50 rounded border border-slate-200 flex items-center justify-center overflow-hidden hover:border-blue-400 transition-colors">
                                                <img
                                                    src={url}
                                                    alt={`Special ${index}`}
                                                    className="w-full h-full object-contain p-1"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveImage(index)}
                                                    className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs"
                                                    title="Xóa"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}

                                        {formData.specialPokemonImages.length < 5 && (
                                            <label className="aspect-square flex flex-col items-center justify-center cursor-pointer bg-slate-50 border-2 border-dashed border-blue-200 rounded hover:border-blue-500 hover:bg-blue-50 transition-all">
                                                {uploadingImage ? (
                                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-200 border-t-blue-600"></div>
                                                ) : (
                                                    <span className="text-2xl text-blue-400 font-bold">+</span>
                                                )}
                                                <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={uploadingImage} className="hidden" />
                                            </label>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-center py-6">
                                        <p className="text-sm font-bold text-slate-500 mb-2">Chưa có ảnh nào</p>
                                        <label className="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-md cursor-pointer transition-all hover:-translate-y-0.5">
                                            Upload Ảnh
                                            <input type="file" accept="image/*" multiple onChange={handleImageUpload} disabled={uploadingImage} className="hidden" />
                                        </label>
                                    </div>
                                )}
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
