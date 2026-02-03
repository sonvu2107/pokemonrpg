import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import GuestRightColumn from '../layouts/GuestRightColumn'

export default function LoginPage() {
    const navigate = useNavigate()
    const { login } = useAuth()

    const [isLogin, setIsLogin] = useState(true)
    const [email, setEmail] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const data = isLogin
                ? await api.login(email, password)
                : await api.register(email, username, password)

            // Save to AuthContext
            login(data.user, data.token)

            // Navigate to home
            navigate('/')
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
                <div className="mb-4 rounded-lg overflow-hidden shadow-lg border border-blue-500 bg-slate-900 h-40 flex items-center justify-center relative">
                    {/* Placeholder gradient/image */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-900 to-cyan-900"></div>
                    <h1 className="relative z-10 text-4xl font-extrabold text-white drop-shadow-lg tracking-wider" style={{ fontFamily: 'Verdana, sans-serif' }}>
                        <span className="text-yellow-400">Thú Ảo</span> <span className="text-cyan-300">VNPET</span>
                    </h1>
                    <div className="absolute bottom-2 text-white/60 text-xs font-mono">ONLINE RPG • VERSION 1.5</div>
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
                                    {isLogin ? 'Đăng Nhập' : 'Đăng Ký'}
                                </h2>
                            </div>

                            <div className="p-6 bg-white bg-opacity-95">

                                {/* Info Box */}
                                <div className="bg-blue-50 border border-blue-300 rounded p-3 mb-6 text-sm text-blue-900">
                                    <strong>{isLogin ? 'Yêu Cầu Đăng Nhập' : 'Tham Gia Ngay!'}</strong>
                                    <p>{isLogin ? 'Bạn vui lòng đăng nhập để truy cập trang này.' : 'Tạo tài khoản mới để bắt đầu hành trình của bạn.'}</p>
                                </div>

                                {/* Form Grid Table Style */}
                                <form onSubmit={handleSubmit} className="border border-blue-400 rounded overflow-hidden">
                                    {/* Table Header */}
                                    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold py-1 px-4 text-center border-b border-blue-600">
                                        {isLogin ? 'Đăng Nhập' : 'Đăng Ký'}
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
                                    {!isLogin && (
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
                                    )}

                                    {/* Password Input Row */}
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

                                    {/* Submit Button Row */}
                                    <div className="bg-white p-3 text-center">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="px-6 py-1 bg-gradient-to-t from-slate-100 to-white border border-slate-400 hover:bg-slate-50 text-slate-800 text-sm font-bold rounded shadow-sm hover:shadow active:translate-y-px transition-all"
                                        >
                                            {loading ? 'Đang xử lý...' : (isLogin ? 'Đăng Nhập' : 'Đăng Ký')}
                                        </button>
                                    </div>

                                </form>

                                <div className="mt-4 text-center text-xs text-slate-500">
                                    Nếu bạn quên mật khẩu, hãy khôi phục tại đây: <span className="font-bold text-blue-600 cursor-pointer hover:underline">quên mật khẩu</span>.
                                    <br />
                                    <button onClick={() => setIsLogin(!isLogin)} className="mt-2 text-blue-600 font-bold hover:underline">
                                        {isLogin ? 'Chưa có tài khoản? Đăng ký ngay' : 'Đã có tài khoản? Đăng nhập'}
                                    </button>
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
