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
        levelMin: 1,
        levelMax: 10,
        isLegendary: false,
        iconId: '',
    })

    useEffect(() => {
        if (isEdit) {
            loadMap()
        }
    }, [id])

    const loadMap = async () => {
        try {
            setLoading(true)
            const data = await mapApi.getById(id)
            setFormData(data.map)
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

    if (loading && isEdit) return <div className="text-blue-800 font-medium text-center py-8">Đang tải dữ liệu...</div>

    return (
        <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-4 border-b border-blue-600">
                    <h1 className="text-xl font-bold text-white uppercase tracking-wide drop-shadow-md">
                        {isEdit ? 'Cập Nhật Bản Đồ' : 'Thêm Mới Bản Đồ'}
                    </h1>
                    <p className="text-blue-100 text-xs mt-1 font-medium">
                        {isEdit ? 'Chỉnh sửa thông tin bản đồ hiện có' : 'Tạo bản đồ mới cho người chơi khám phá'}
                    </p>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-md flex items-center gap-2 shadow-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Map Name */}
                        <div>
                            <label className="block text-slate-700 text-sm font-bold mb-2">Tên Bản đồ <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Ví dụ: Rừng Viridian"
                                className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
                            />
                            <p className="text-xs text-slate-500 mt-1.5 italic">Slug URL sẽ được tạo tự động từ tên này (ví dụ: rung-viridian)</p>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-slate-700 text-sm font-bold mb-2">Mô tả</label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                rows="3"
                                placeholder="Mô tả ngắn gọn về bản đồ này..."
                                className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm resize-none"
                            />
                        </div>

                        {/* Levels Grid */}
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-2">Cấp độ tối thiểu <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        max="100"
                                        value={formData.levelMin}
                                        onChange={(e) => setFormData({ ...formData, levelMin: parseInt(e.target.value) || 1 })}
                                        className="w-full pl-4 pr-12 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm font-mono"
                                    />
                                    <span className="absolute right-3 top-2 text-slate-400 text-xs font-bold">LV</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-2">Cấp độ tối đa <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        max="100"
                                        value={formData.levelMax}
                                        onChange={(e) => setFormData({ ...formData, levelMax: parseInt(e.target.value) || 1 })}
                                        className="w-full pl-4 pr-12 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm font-mono"
                                    />
                                    <span className="absolute right-3 top-2 text-slate-400 text-xs font-bold">LV</span>
                                </div>
                            </div>
                        </div>

                        {/* Legendary Options */}
                        <div className="bg-amber-50 rounded-lg p-5 border border-amber-200">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="flex items-center h-5">
                                    <input
                                        type="checkbox"
                                        id="isLegendary"
                                        checked={formData.isLegendary}
                                        onChange={(e) => setFormData({ ...formData, isLegendary: e.target.checked })}
                                        className="w-5 h-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                    />
                                </div>
                                <label htmlFor="isLegendary" className="text-slate-800 text-sm font-bold cursor-pointer select-none">
                                    Đây là Khu Vực Huyền Thoại
                                </label>
                            </div>

                            {formData.isLegendary && (
                                <div className="ml-8 animate-fadeIn">
                                    <label className="block text-slate-700 text-sm font-bold mb-2">Pokemon Icon ID (1-1000)</label>
                                    <div className="flex gap-4 items-center">
                                        <div className="relative flex-1">
                                            <input
                                                type="number"
                                                min="1"
                                                max="1000"
                                                value={formData.iconId}
                                                onChange={(e) => setFormData({ ...formData, iconId: e.target.value })}
                                                placeholder="VD: 150 (Mewtwo)"
                                                className="w-full px-4 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-sm"
                                            />
                                        </div>
                                        {formData.iconId && (
                                            <div className="flex-shrink-0 w-12 h-12 bg-white rounded-lg border border-slate-200 flex items-center justify-center shadow-sm">
                                                <img
                                                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${formData.iconId}.png`}
                                                    alt="Preview"
                                                    className="w-10 h-10 pixelated"
                                                    onError={(e) => e.target.style.display = 'none'}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-2">Nhập ID của Pokemon (National Dex) để hiển thị icon trên sidebar. Để trống sẽ dùng icon mặc định.</p>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-md text-sm font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                            >
                                {loading ? 'Đang Xử Lý...' : isEdit ? 'Lưu Thay Đổi' : 'Tạo Bản Đồ'}
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/admin/maps')}
                                className="px-6 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
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
