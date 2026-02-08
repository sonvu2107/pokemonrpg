import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { itemApi } from '../../services/adminApi'
import ImageUpload from '../../components/ImageUpload'

const ITEM_TYPES = [
    { value: 'healing', label: 'Hồi phục' },
    { value: 'pokeball', label: 'Bóng' },
    { value: 'evolution', label: 'Tiến hóa' },
    { value: 'battle', label: 'Chiến đấu' },
    { value: 'key', label: 'Chìa khóa' },
    { value: 'misc', label: 'Khác' },
]

const ITEM_RARITIES = [
    { value: 'common', label: 'Phổ biến' },
    { value: 'uncommon', label: 'Ít gặp' },
    { value: 'rare', label: 'Hiếm' },
    { value: 'epic', label: 'Sử thi' },
    { value: 'legendary', label: 'Huyền thoại' },
]

export default function ItemFormPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const isEdit = Boolean(id)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        type: 'misc',
        rarity: 'common',
        imageUrl: '',
        description: '',
        effectType: 'none',
        effectValue: 0,
        effectValueMp: 0,
    })

    useEffect(() => {
        if (isEdit) {
            loadItem()
        }
    }, [id])

    const loadItem = async () => {
        try {
            setLoading(true)
            const data = await itemApi.getById(id)
            setFormData({
                name: data.item.name || '',
                type: data.item.type || 'misc',
                rarity: data.item.rarity || 'common',
                imageUrl: data.item.imageUrl || '',
                description: data.item.description || '',
                effectType: data.item.effectType || 'none',
                effectValue: data.item.effectValue ?? 0,
                effectValueMp: data.item.effectValueMp ?? 0,
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
            setError('Tên vật phẩm là bắt buộc')
            return
        }

        try {
            setLoading(true)
            if (isEdit) {
                await itemApi.update(id, formData)
            } else {
                await itemApi.create(formData)
            }
            navigate('/admin/items')
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
                    {isEdit ? 'Cập Nhật Vật Phẩm' : 'Thêm Mới Vật Phẩm'}
                </h1>
            </div>

            <div className="p-6">
                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Tên Vật Phẩm *</label>
                        <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded text-slate-800 text-sm focus:border-blue-500"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Loại</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                {ITEM_TYPES.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
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
                                {ITEM_RARITIES.map((item) => (
                                    <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Hiệu Ứng</label>
                            <select
                                value={formData.effectType}
                                onChange={(e) => setFormData({ ...formData, effectType: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            >
                                <option value="none">Không có</option>
                                <option value="catchMultiplier">Tăng tỉ lệ bắt</option>
                                <option value="heal">Hồi HP/MP</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá trị HP</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={formData.effectValue}
                                onChange={(e) => setFormData({ ...formData, effectValue: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-slate-700 text-xs font-bold mb-1.5 uppercase">Giá trị MP</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={formData.effectValueMp}
                                onChange={(e) => setFormData({ ...formData, effectValueMp: parseFloat(e.target.value) || 0 })}
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-sm"
                            />
                        </div>
                    </div>

                    <div className="bg-white rounded border border-blue-100 p-4 shadow-sm">
                        <div className="flex justify-between items-center border-b border-blue-100 pb-3 mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-blue-900 uppercase">Ảnh Vật Phẩm</h3>
                                <p className="text-xs text-blue-700 mt-1">Tải ảnh đại diện cho vật phẩm.</p>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg border border-slate-100 min-h-[140px] flex flex-col justify-center shadow-inner p-4">
                            <ImageUpload
                                currentImage={formData.imageUrl}
                                onUploadSuccess={(url) => setFormData((prev) => ({
                                    ...prev,
                                    imageUrl: Array.isArray(url) ? (url[0] || '') : (url || ''),
                                }))}
                                label="Ảnh Vật Phẩm"
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
                            {loading ? 'Đang Xử Lý...' : isEdit ? 'LƯU THAY ĐỔI' : 'TẠO VẬT PHẨM MỚI'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/items')}
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
