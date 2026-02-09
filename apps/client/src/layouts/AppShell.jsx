import { useState } from "react"
import { Outlet, Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import LeftColumn from "./LeftColumn"
import RightColumn from "./RightColumn"

export default function AppShell() {
    const { user, logout } = useAuth()
    const [isMenuOpen, setIsMenuOpen] = useState(false)


    return (
        <div className="bg-white h-screen flex flex-col font-sans text-slate-800 overflow-hidden">
            {/* Header / Banner */}
            <header className="border-b border-blue-400 bg-white/95 sticky top-0 z-50 backdrop-blur-md shadow-sm">
                <div className="mx-auto max-w-[1280px] px-3 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {/* Mobile Menu Button */}
                            <button
                                onClick={() => setIsMenuOpen(true)}
                                className="lg:hidden p-1 text-slate-300 hover:text-white"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                </svg>
                            </button>

                            <Link to="/" className="text-blue-700 font-bold tracking-wide text-lg drop-shadow-sm hover:text-blue-800 transition-colors">
                                Thú Ảo VNPET
                            </Link>
                        </div>

                        <div className="flex items-center gap-3">


                            {user ? (
                                <div className="flex items-center gap-4">
                                    <div className="hidden md:flex items-baseline gap-2 text-slate-700">
                                        <div className="text-sm font-medium">
                                            {user.username}
                                        </div>
                                        <div className="text-xs">
                                            {user.role === 'admin' ? (
                                                <span className="px-1.5 py-0.5 bg-purple-600 rounded text-[10px] text-white font-bold uppercase tracking-wider">
                                                    ADMIN
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 text-[11px] font-medium opacity-80">
                                                    (Người chơi)
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={logout}
                                        className="hidden md:block px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-200 transition-colors"
                                    >
                                        Đăng xuất
                                    </button>
                                </div>
                            ) : (
                                <Link
                                    to="/login"
                                    className="px-4 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white font-medium shadow-sm transition-colors"
                                >
                                    Đăng nhập
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Grid */}
            <main className="mx-auto max-w-[1280px] w-full px-3 py-4 flex-1 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col lg:flex-row gap-4 items-start justify-center">
                    {/* Left Column (Desktop) */}
                    <aside className="hidden lg:block w-[260px] flex-shrink-0 sticky top-20 self-start mt-20">
                        <LeftColumn />
                    </aside>

                    {/* Main Content Area */}
                    <section className="flex-1 min-w-0 w-full">
                        <div className="rounded border border-blue-400 bg-white shadow-sm min-h-[500px]">
                            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-1.5 flex justify-center">
                                <div className="text-sm font-bold text-white uppercase tracking-wider drop-shadow-sm">
                                    Nội dung
                                </div>
                            </div>
                            <div className="p-3">
                                <Outlet />
                            </div>
                        </div>
                    </section>

                    {/* Right Column (Desktop) */}
                    <aside className="hidden lg:block w-[260px] flex-shrink-0 sticky top-20 self-start mt-12">
                        <RightColumn />
                    </aside>
                </div>
            </main>

            {/* Mobile Menu Drawer (Left) */}
            {isMenuOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)} />
                    <div className="absolute left-0 top-0 bottom-0 w-[300px] bg-white border-r border-blue-400 shadow-xl flex flex-col">
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between p-4 border-b border-blue-200 bg-white z-10">
                            <h2 className="text-lg font-bold text-blue-800 uppercase tracking-widest">Menu</h2>
                            <button
                                onClick={() => setIsMenuOpen(false)}
                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6" onClick={(e) => {
                            // Prevent closing when clicking scrollbar or empty space, but allow links to close it
                            if (e.target.tagName === 'A') setIsMenuOpen(false);
                        }}>

                            {/* User Profile Summary */}
                            {user && (
                                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-xl shadow-md">
                                            {user.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-base">{user.username}</div>
                                            <div className="flex gap-2 text-xs">
                                                {user.role === 'admin' && (
                                                    <span className="px-1.5 py-0.5 bg-purple-600 rounded text-white font-bold uppercase">ADMIN</span>
                                                )}
                                                <span className="text-slate-500">Level {user.level || 1}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            logout();
                                            setIsMenuOpen(false);
                                        }}
                                        className="w-full py-1.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 hover:text-red-700 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
                                        </svg>
                                        Đăng xuất
                                    </button>
                                </div>
                            )}

                            {/* Main Navigation (Left Column) */}
                            <div className="space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Chức năng chính</div>
                                <LeftColumn />
                            </div>

                            {/* Secondary Navigation (Right Column) */}
                            <div className="space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Thông tin khác</div>
                                <RightColumn />
                            </div>

                        </div>
                    </div>
                </div>
            )}

            {/* Mobile Chat Drawer (Left) */}

        </div>
    )
}
