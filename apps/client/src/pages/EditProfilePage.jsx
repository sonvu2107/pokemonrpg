import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import ImageUpload from '../components/ImageUpload'

export default function EditProfilePage() {
    const { user, login } = useAuth()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')

    const [formData, setFormData] = useState({
        username: '',
        email: '',
        avatar: '',
        signature: ''
    })

    useEffect(() => {
        if (user) {
            setFormData({
                username: user.username || '',
                email: user.email || '',
                avatar: user.avatar || '',
                signature: user.signature || ''
            })
        }
    }, [user])

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setMessage('')
        setSubmitting(true)

        try {
            const updatedUser = await api.updateProfile(formData)

            // Update auth context with new user data
            const token = localStorage.getItem('token')
            login(updatedUser.user, token)

            setMessage('Cập nhật hồ sơ thành công!')
            setTimeout(() => {
                navigate('/profile')
            }, 1500)
        } catch (err) {
            setError(err.message || 'Cập nhật thất bại')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="max-w-xl mx-auto pb-12">
            <div className="border border-blue-400 rounded overflow-hidden shadow-sm bg-white">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 border-b border-blue-700 shadow-sm flex justify-between items-center">
                    <span>Chỉnh Sửa Hồ Sơ</span>
                    <button
                        onClick={() => navigate('/profile')}
                        className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
                    >
                        Quay lại
                    </button>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded">
                            {message}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Avatar */}
                        <div>
                            <ImageUpload
                                label="Ảnh Đại Diện"
                                currentImage={formData.avatar}
                                onUploadSuccess={(url) => setFormData({ ...formData, avatar: url })}
                            />
                        </div>

                        {/* Username */}
                        <div>
                            <label className="block text-slate-700 text-sm font-bold mb-1.5">Tên hiển thị</label>
                            <input
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                required
                            />
                        </div>

                        {/* Email (Read only) */}
                        <div>
                            <label className="block text-slate-700 text-sm font-bold mb-1.5">Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                disabled
                                className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-500 rounded"
                            />
                            <p className="text-xs text-slate-400 mt-1">Không thể thay đổi email.</p>
                        </div>

                        {/* Signature */}
                        <div>
                            <label className="block text-slate-700 text-sm font-bold mb-1.5">Chữ ký</label>
                            <textarea
                                value={formData.signature}
                                onChange={(e) => setFormData({ ...formData, signature: e.target.value })}
                                rows="3"
                                className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                placeholder="Nhập chữ ký của bạn..."
                            ></textarea>
                        </div>

                        {/* Submit Button */}
                        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/profile')}
                                className="px-4 py-2 border border-slate-300 text-slate-700 rounded hover:bg-slate-50 font-medium text-sm"
                            >
                                Hủy Bỏ
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded hover:from-blue-700 hover:to-cyan-700 font-bold text-sm shadow-sm disabled:opacity-70"
                            >
                                {submitting ? 'Đang Lưu...' : 'Lưu Thay Đổi'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
