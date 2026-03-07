import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import GuestRightColumn from '../layouts/GuestRightColumn'

const resolveModeFromPath = (pathname) => {
    if (pathname === '/register') return 'register'
    if (pathname === '/forgot-password' || pathname === '/reset-password') return 'forgot'
    return 'login'
}

const modeMeta = {
    login: {
        title: 'Đăng Nhập',
        infoTitle: 'Yêu Cầu Đăng Nhập',
        infoBody: 'Bạn vui lòng đăng nhập để truy cập trang này.',
        submitLabel: 'Đăng Nhập',
    },
    register: {
        title: 'Đăng Ký',
        infoTitle: 'Tham Gia Ngay!',
        infoBody: 'Tạo tài khoản mới để bắt đầu hành trình của bạn.',
        submitLabel: 'Đăng Ký',
    },
    forgot: {
        title: 'Quên Mật Khẩu',
        infoTitle: 'Khôi Phục Tài Khoản',
        infoBody: 'Nhập email, mã PIN khôi phục và mật khẩu mới để đặt lại tài khoản.',
        submitLabel: 'Khôi Phục Mật Khẩu',
    },
}

export default function LoginPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { login } = useAuth()

    const [mode, setMode] = useState(resolveModeFromPath(location.pathname))
    const [email, setEmail] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [recoveryPin, setRecoveryPin] = useState('')
    const [confirmRecoveryPin, setConfirmRecoveryPin] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')

    useEffect(() => {
        setMode(resolveModeFromPath(location.pathname))
        setError('')
        setMessage('')
    }, [location.pathname])

    const meta = modeMeta[mode] || modeMeta.login

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setMessage('')
        setLoading(true)

        try {
            if (mode === 'login') {
                const data = await api.login(email, password)

                // Save to AuthContext
                login(data.user, data.token)

                // Navigate to home
                navigate('/')
                return
            }

            if (mode === 'register') {
                if (!recoveryPin || !confirmRecoveryPin) {
                    throw new Error('Vui lòng nhập mã PIN khôi phục và xác nhận PIN')
                }
                if (!/^\d{6}$/.test(recoveryPin)) {
                    throw new Error('Mã PIN khôi phục phải gồm đúng 6 chữ số')
                }
                if (recoveryPin !== confirmRecoveryPin) {
                    throw new Error('Mã PIN xác nhận không khớp')
                }

                const data = await api.register(email, username, password, recoveryPin)

                // Save to AuthContext
                login(data.user, data.token)

                // Navigate to home
                navigate('/')
                return
            }

            if (mode === 'forgot') {
                if (!recoveryPin) {
                    throw new Error('Mã PIN khôi phục là bắt buộc')
                }
                if (!/^\d{6}$/.test(recoveryPin)) {
                    throw new Error('Mã PIN khôi phục phải gồm đúng 6 chữ số')
                }
                if (!newPassword || !confirmPassword) {
                    throw new Error('Vui lòng nhập đầy đủ mật khẩu mới')
                }
                if (newPassword !== confirmPassword) {
                    throw new Error('Mật khẩu xác nhận không khớp')
                }

                const data = await api.forgotPassword(email, recoveryPin, newPassword)
                setPassword('')
                setNewPassword('')
                setConfirmPassword('')
                setRecoveryPin('')
                setConfirmRecoveryPin('')
                setMessage(data.message || 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập ngay.')
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-white font-sans text-slate-800 overflow-y-auto">
            {/* Main Layout Grid - Similar to AppShell but specific for Login */}
            <div className="mx-auto max-w-[1280px] w-full px-3 py-4">

                {/* Top Banner (Optional, placeholder based on screenshot) */}
                <div className="mb-4 rounded-lg overflow-hidden shadow-lg border border-blue-500 relative group bg-slate-900 max-w-2xl mx-auto">
                    {/* Background image filling the entire container naturally */}
                    <img src="/vnpet-logo.jpg" alt="Thú Ảo VNPET" className="w-full h-auto block transition-transform duration-700 group-hover:scale-105" />

                    {/* Gradient overlay for text readability */}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent pointer-events-none"></div>

                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-white/80 text-[10px] sm:text-xs font-mono font-semibold tracking-widest drop-shadow-md whitespace-nowrap">
                        <span className="bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm border border-white/20">
                            ONLINE RPG • VERSION BETA 1.0
                        </span>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-4 items-start justify-center">

                    {/* Left Column - Guest Version */}
                    <aside className="hidden lg:block w-[180px] flex-shrink-0 sticky top-4 self-start">
                        <GuestRightColumn />
                    </aside>

                    {/* Main Content - Login Form */}
                    <div className="flex-1 min-w-0 w-full max-w-2xl">
                        <div className="rounded border border-blue-800 bg-white shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="bg-gradient-to-t from-blue-100 to-white py-4 px-6 border-b border-blue-200 text-center">
                                <h2 className="text-3xl font-bold text-blue-900 tracking-wide drop-shadow-sm">
                                    {meta.title}
                                </h2>
                            </div>

                            <div className="p-6 bg-white bg-opacity-95">

                                {/* Info Box */}
                                <div className="bg-blue-50 border border-blue-300 rounded p-3 mb-6 text-sm text-blue-900">
                                    <strong>{meta.infoTitle}</strong>
                                    <p>{meta.infoBody}</p>
                                </div>

                                {/* Form Grid Table Style */}
                                <form onSubmit={handleSubmit} className="border border-blue-400 rounded overflow-hidden">
                                    {/* Table Header */}
                                    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold py-1 px-4 text-center border-b border-blue-600">
                                        {meta.title}
                                    </div>

                                    {/* Table Header Row */}
                                    <div className="flex border-b border-blue-300 bg-blue-100 text-xs font-bold text-blue-900 text-center">
                                        <div className="w-1/3 py-1 border-r border-blue-300">Mục</div>
                                        <div className="w-2/3 py-1">Thông Tin</div>
                                    </div>

                                    {/* Errors */}
                                    {error && (
                                        <div className="p-2 bg-red-100 text-center text-red-700 text-sm border-b border-blue-300">
                                            {error}
                                        </div>
                                    )}

                                    {message && (
                                        <div className="p-2 bg-green-100 text-center text-green-700 text-sm border-b border-blue-300">
                                            {message}
                                        </div>
                                    )}

                                    {/* Email Input Row */}
                                    <div className="flex border-b border-blue-200 bg-white">
                                        <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                            Email:
                                        </div>
                                        <div className="w-2/3 py-3 px-4">
                                            <input
                                                type="email"
                                                required
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>

                                    {/* Username Input Row (Register only) */}
                                    {mode === 'register' && (
                                        <>
                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    Tên Người Dùng:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="text"
                                                        required
                                                        value={username}
                                                        onChange={(e) => setUsername(e.target.value)}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    PIN Khôi Phục:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="password"
                                                        required
                                                        value={recoveryPin}
                                                        onChange={(e) => setRecoveryPin(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                        placeholder="6 chữ số"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    Xác Nhận PIN:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="password"
                                                        required
                                                        value={confirmRecoveryPin}
                                                        onChange={(e) => setConfirmRecoveryPin(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                        placeholder="Nhập lại PIN"
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* Password Input Row */}
                                    {(mode === 'login' || mode === 'register') && (
                                        <div className="flex border-b border-blue-200 bg-white">
                                            <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                Mật Khẩu:
                                            </div>
                                            <div className="w-2/3 py-3 px-4">
                                                <input
                                                    type="password"
                                                    required
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {mode === 'forgot' && (
                                        <>
                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    PIN Khôi Phục:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="password"
                                                        required
                                                        value={recoveryPin}
                                                        onChange={(e) => setRecoveryPin(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                        placeholder="6 chữ số"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    Mật Khẩu Mới:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="password"
                                                        required
                                                        value={newPassword}
                                                        onChange={(e) => setNewPassword(e.target.value)}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex border-b border-blue-200 bg-white">
                                                <div className="w-1/3 py-3 px-2 border-r border-blue-200 text-right font-bold text-sm text-slate-700 flex items-center justify-end">
                                                    Xác Nhận MK:
                                                </div>
                                                <div className="w-2/3 py-3 px-4">
                                                    <input
                                                        type="password"
                                                        required
                                                        value={confirmPassword}
                                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                                        className="w-full max-w-[250px] px-2 py-1 bg-white border border-slate-400 shadow-inner text-sm focus:outline-none focus:border-blue-500"
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* Submit Button Row */}
                                    <div className="bg-white p-3 text-center">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="px-6 py-1 bg-gradient-to-t from-slate-100 to-white border border-slate-400 hover:bg-slate-50 text-slate-800 text-sm font-bold rounded shadow-sm hover:shadow active:translate-y-px transition-all"
                                        >
                                            {loading ? 'Đang xử lý...' : meta.submitLabel}
                                        </button>
                                    </div>

                                </form>

                                <div className="mt-4 text-center text-xs text-slate-500">
                                    {(mode === 'login' || mode === 'register') && (
                                        <>
                                            Nếu bạn quên mật khẩu, hãy khôi phục tại đây:{' '}
                                            <Link to="/forgot-password" className="font-bold text-blue-600 hover:underline">quên mật khẩu</Link>.
                                            <br />
                                        </>
                                    )}

                                    {mode === 'login' && (
                                        <Link to="/register" className="mt-2 inline-block text-blue-600 font-bold hover:underline">
                                            Chưa có tài khoản? Đăng ký ngay
                                        </Link>
                                    )}

                                    {mode === 'register' && (
                                        <Link to="/login" className="mt-2 inline-block text-blue-600 font-bold hover:underline">
                                            Đã có tài khoản? Đăng nhập
                                        </Link>
                                    )}

                                    {mode === 'forgot' && (
                                        <>
                                            <Link to="/login" className="mt-2 inline-block text-blue-600 font-bold hover:underline">
                                                Quay lại đăng nhập
                                            </Link>
                                            <br />
                                            <Link to="/register" className="mt-1 inline-block text-blue-600 font-bold hover:underline">
                                                Chưa có tài khoản? Đăng ký
                                            </Link>
                                        </>
                                    )}

                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Guest Version */}
                    <aside className="hidden lg:block w-[180px] flex-shrink-0 sticky top-4 self-start">
                        <GuestRightColumn />
                    </aside>
                </div>

                {/* Footer Disclaimer */}
                <div className="mt-8 text-center text-[10px] text-slate-500 pb-4">
                    <div className="font-bold text-yellow-600 text-xs mb-1">Miễn Trừ Trách Nhiệm</div>
                    © 2026 VNPET. Không có hoạt động thương mại nào diễn ra trên trang web này.
                    <div className="mt-1 text-blue-500">
                        [ Tác Giả & Hình Ảnh ] [ Chính Sách Bảo Mật ] [ Điều Khoản Sử Dụng ]
                    </div>
                </div>

            </div>
        </div>
    )
}
