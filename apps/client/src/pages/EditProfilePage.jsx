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
    const [passwordSubmitting, setPasswordSubmitting] = useState(false)
    const [pinSubmitting, setPinSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [passwordError, setPasswordError] = useState('')
    const [passwordMessage, setPasswordMessage] = useState('')
    const [pinError, setPinError] = useState('')
    const [pinMessage, setPinMessage] = useState('')
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        avatar: '',
        signature: ''
    })
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
    })
    const [pinForm, setPinForm] = useState({
        currentPassword: '',
        recoveryPin: '',
        confirmRecoveryPin: '',
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

    const handlePasswordSubmit = async () => {
        setPasswordError('')
        setPasswordMessage('')

        const currentPassword = String(passwordForm.currentPassword || '')
        const newPassword = String(passwordForm.newPassword || '')
        const confirmPassword = String(passwordForm.confirmPassword || '')

        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError('Vui lòng nhập đầy đủ thông tin đổi mật khẩu.')
            return
        }

        if (newPassword.length < 6) {
            setPasswordError('Mật khẩu mới phải có ít nhất 6 ký tự.')
            return
        }

        if (newPassword !== confirmPassword) {
            setPasswordError('Mật khẩu xác nhận không khớp.')
            return
        }

        setPasswordSubmitting(true)

        try {
            const response = await api.changePassword(currentPassword, newPassword)
            setPasswordMessage(response?.message || 'Đổi mật khẩu thành công!')
            setPasswordForm({
                currentPassword: '',
                newPassword: '',
                confirmPassword: '',
            })
        } catch (err) {
            setPasswordError(err.message || 'Đổi mật khẩu thất bại')
        } finally {
            setPasswordSubmitting(false)
        }
    }

    const handlePinSubmit = async () => {
        setPinError('')
        setPinMessage('')

        const currentPassword = String(pinForm.currentPassword || '')
        const recoveryPin = String(pinForm.recoveryPin || '')
        const confirmRecoveryPin = String(pinForm.confirmRecoveryPin || '')

        if (!currentPassword || !recoveryPin || !confirmRecoveryPin) {
            setPinError('Vui lòng nhập đầy đủ thông tin cập nhật mã PIN.')
            return
        }

        if (!/^\d{6}$/.test(recoveryPin)) {
            setPinError('Mã PIN khôi phục phải gồm đúng 6 chữ số.')
            return
        }

        if (recoveryPin !== confirmRecoveryPin) {
            setPinError('Mã PIN xác nhận không khớp.')
            return
        }

        setPinSubmitting(true)

        try {
            const response = await api.updateRecoveryPin(currentPassword, recoveryPin)
            setPinMessage(response?.message || 'Cập nhật mã PIN thành công!')
            setPinForm({
                currentPassword: '',
                recoveryPin: '',
                confirmRecoveryPin: '',
            })
        } catch (err) {
            setPinError(err.message || 'Cập nhật mã PIN thất bại')
        } finally {
            setPinSubmitting(false)
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
                        <div>
                            <ImageUpload
                                label="Ảnh Đại Diện"
                                currentImage={formData.avatar}
                                onUploadSuccess={(url) => setFormData({ ...formData, avatar: url })}
                            />
                        </div>
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

                        <div className="pt-4 border-t border-slate-100">
                            <div className="mb-3">
                                <h3 className="text-slate-800 text-sm font-bold">Đổi Mật Khẩu</h3>
                                <p className="text-xs text-slate-500 mt-1">Dùng mục này khi bạn còn nhớ mật khẩu hiện tại.</p>
                            </div>

                            {passwordError && (
                                <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                                    {passwordError}
                                </div>
                            )}

                            {passwordMessage && (
                                <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded">
                                    {passwordMessage}
                                </div>
                            )}

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Mật khẩu hiện tại</label>
                                    <input
                                        type="password"
                                        value={passwordForm.currentPassword}
                                        onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Mật khẩu mới</label>
                                    <input
                                        type="password"
                                        value={passwordForm.newPassword}
                                        onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Xác nhận mật khẩu mới</label>
                                    <input
                                        type="password"
                                        value={passwordForm.confirmPassword}
                                        onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handlePasswordSubmit}
                                        disabled={passwordSubmitting}
                                        className="px-5 py-2 bg-gradient-to-r from-slate-700 to-slate-900 text-white rounded hover:from-slate-800 hover:to-black font-bold text-sm shadow-sm disabled:opacity-70"
                                    >
                                        {passwordSubmitting ? 'Đang Đổi...' : 'Đổi Mật Khẩu'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100">
                            <div className="mb-3">
                                <h3 className="text-slate-800 text-sm font-bold">Mã PIN Khôi Phục</h3>
                                <p className="text-xs text-slate-500 mt-1">PIN gồm 6 chữ số, dùng để khôi phục mật khẩu khi quên.</p>
                            </div>

                            {pinError && (
                                <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
                                    {pinError}
                                </div>
                            )}

                            {pinMessage && (
                                <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded">
                                    {pinMessage}
                                </div>
                            )}

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Mật khẩu hiện tại</label>
                                    <input
                                        type="password"
                                        value={pinForm.currentPassword}
                                        onChange={(e) => setPinForm({ ...pinForm, currentPassword: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">PIN khôi phục mới</label>
                                    <input
                                        type="password"
                                        value={pinForm.recoveryPin}
                                        onChange={(e) => setPinForm({ ...pinForm, recoveryPin: e.target.value.replace(/\D+/g, '').slice(0, 6) })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                        placeholder="6 chữ số"
                                    />
                                </div>

                                <div>
                                    <label className="block text-slate-700 text-sm font-bold mb-1.5">Xác nhận PIN mới</label>
                                    <input
                                        type="password"
                                        value={pinForm.confirmRecoveryPin}
                                        onChange={(e) => setPinForm({ ...pinForm, confirmRecoveryPin: e.target.value.replace(/\D+/g, '').slice(0, 6) })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded focus:border-blue-500 focus:outline-none"
                                        placeholder="Nhập lại PIN"
                                    />
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handlePinSubmit}
                                        disabled={pinSubmitting}
                                        className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded hover:from-amber-600 hover:to-orange-700 font-bold text-sm shadow-sm disabled:opacity-70"
                                    >
                                        {pinSubmitting ? 'Đang Cập Nhật...' : 'Cập Nhật PIN'}
                                    </button>
                                </div>
                            </div>
                        </div>

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
