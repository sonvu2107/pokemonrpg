import { useEffect, useState } from "react"
import { Outlet, Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { usePlayTab } from "../context/PlayTabContext"
import VipAvatar from "../components/VipAvatar"
import VipUsername from "../components/VipUsername"
import { isVipRole, isAdminRole, getVipTitle, getVipBadgeLabel } from "../utils/vip"
import LeftColumn from "./LeftColumn"
import RightColumn from "./RightColumn"
import GlobalChatPopup from "../components/GlobalChatPopup"
import GlobalNotification from "../components/GlobalNotification"
import { useProfileQuery } from "../hooks/queries/gameQueries"

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

export default function AppShell() {
    const { user, logout } = useAuth()
    const { isPlayTabBlocked, isGameplayTabBlocked, blockReason, maxAllowedTabs } = usePlayTab()
    const { data: profilePayload } = useProfileQuery({ enabled: Boolean(user) })
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [mobileProfile, setMobileProfile] = useState({
        avatar: '',
        level: 1,
    })
    useEffect(() => {
        const fallbackAvatar = String(user?.avatar || '').trim()
        const fallbackLevel = Math.max(1, Number(user?.level || user?.playerState?.level || 1))
        if (!user) {
            setMobileProfile({ avatar: '', level: 1 })
            return
        }
        const resolvedAvatar = String(profilePayload?.user?.avatar || fallbackAvatar).trim()
        const resolvedLevel = Math.max(
            1,
            Number(profilePayload?.playerState?.level || fallbackLevel || 1)
        )
        setMobileProfile({
            avatar: resolvedAvatar,
            level: resolvedLevel,
        })
    }, [user?.id, user?.avatar, user?.level, user?.playerState?.level, profilePayload?.user?.avatar, profilePayload?.playerState?.level])
    const vipTitle = getVipTitle(user)
    const vipBadgeLabel = getVipBadgeLabel(user)
    const blockTitle = blockReason === 'session-replaced'
        ? 'Tài khoản đang chơi ở nơi khác'
        : 'Game đang mở ở tab khác'
    const blockMessage = blockReason === 'session-replaced'
        ? 'Phiên hiện tại đã bị thay thế. Hãy quay lại nơi đang chơi hoặc đăng nhập lại để tiếp tục hành trình.'
        : `Hệ thống chỉ cho phép tối đa ${maxAllowedTabs} tab chơi cho mỗi tài khoản trong cùng một phiên. Hãy đóng bớt tab đang mở rồi thử lại.`
    return (
        <div className="bg-white h-screen flex flex-col font-sans text-slate-800 overflow-hidden">
            <GlobalNotification />
            <header className="border-b border-blue-400 bg-white/95 sticky top-0 z-50 backdrop-blur-md shadow-sm">
                <div className="mx-auto max-w-[1280px] px-3 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setIsMenuOpen(true)}
                                className="lg:hidden p-1 text-slate-300 hover:text-white"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                </svg>
                            </button>
                            <Link to="/" className="text-blue-700 font-bold tracking-wide text-lg drop-shadow-sm hover:text-blue-800 transition-colors">
                                <img src="/vnpet.png" alt="Thú Ảo VNPET" className="hidden sm:block h-8 w-auto scale-[3] origin-left" />
                            </Link>
                        </div>
                        <div className="flex items-center gap-3">
                            {user ? (
                                <div className="flex items-center gap-4">
                                    <div className="hidden md:flex items-baseline gap-2 text-slate-700">
                                        <div className="text-sm font-medium">
                                            <VipUsername userLike={user}>{user.username}</VipUsername>
                                        </div>
                                        {vipTitle && (
                                            <div className="text-[11px] font-bold text-amber-600">
                                                {vipTitle}
                                            </div>
                                        )}
                                        <div className="text-xs">
                                            {isVipRole(user) ? (
                                                <span className="px-1.5 py-0.5 bg-amber-500 rounded text-[10px] text-white font-bold uppercase tracking-wider">
                                                    {vipBadgeLabel}
                                                </span>
                                            ) : isAdminRole(user) ? (
                                                <span className="px-1.5 py-0.5 bg-rose-500 rounded text-[10px] text-white font-bold uppercase tracking-wider">
                                                    Admin
                                                </span>
                                            ) : null}
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
            <main className="mx-auto max-w-[1280px] w-full px-3 py-4 flex-1 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col lg:flex-row gap-4 items-start justify-center">
                    <aside className="hidden lg:block w-[260px] flex-shrink-0 sticky top-20 self-start mt-20">
                        <LeftColumn />
                    </aside>
                    <section className="flex-1 min-w-0 w-full">
                        <div className="rounded border border-blue-400 bg-white shadow-sm min-h-[500px]">
                            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-1.5 flex justify-center">
                                <div className="text-sm font-bold text-white uppercase tracking-wider drop-shadow-sm">
                                    Nội dung
                                </div>
                            </div>
                            <div className="p-3">
                                {!isPlayTabBlocked && isGameplayTabBlocked ? (
                                    <div className="mb-4 rounded-2xl border-[3px] border-slate-800 bg-gradient-to-r from-sky-100 via-white to-emerald-100 px-4 py-3 shadow-sm">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-700">Che do xem</div>
                                                <div className="mt-1 text-sm font-bold text-slate-800">Tab này chỉ xem thông tin và chat. Muốn đánh/search, hãy quay lại tab đang chơi.</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => window.location.reload()}
                                                className="rounded-full border-2 border-slate-900 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-800 shadow-sm transition-transform hover:-translate-y-0.5"
                                            >
                                                Giành lại tab chơi
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                                {isPlayTabBlocked ? (
                                    <div className="mx-auto flex min-h-[420px] max-w-2xl items-center justify-center">
                                        <div className="relative w-full overflow-hidden rounded-[28px] border-[3px] border-slate-800 bg-sky-100 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                                            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-sky-300 via-sky-200 to-transparent" />
                                            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-lime-200 via-emerald-100 to-transparent" />
                                            <div className="absolute -left-8 top-16 h-24 w-24 rounded-full bg-white/50 blur-2xl" />
                                            <div className="relative border-b-[3px] border-slate-800 bg-gradient-to-r from-red-500 via-rose-500 to-orange-400 px-6 py-4 text-center">
                                                <div className="text-[11px] font-black uppercase tracking-[0.35em] text-white/80">Pokémon Trainer Alert</div>
                                                <div className="mt-1 text-2xl font-black uppercase tracking-[0.18em] text-white drop-shadow-sm">{blockTitle}</div>
                                            </div>
                                            <div className="relative px-6 py-8 text-center">
                                                <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full border-[6px] border-slate-900 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
                                                    <div className="relative h-full w-full overflow-hidden rounded-full">
                                                        <div className="absolute inset-x-0 top-0 h-1/2 bg-red-500" />
                                                        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-white" />
                                                        <div className="absolute left-0 right-0 top-1/2 h-[6px] -translate-y-1/2 bg-slate-900" />
                                                        <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[6px] border-slate-900 bg-white" />
                                                        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300" />
                                                    </div>
                                                </div>
                                                <div className="mx-auto inline-flex items-center gap-2 rounded-full border-2 border-slate-800 bg-yellow-300 px-4 py-1 text-xs font-black uppercase tracking-[0.2em] text-slate-800 shadow-sm">
                                                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                                    Phiên chơi bị khóa
                                                </div>
                                                <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-700">{blockMessage}</p>
                                                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                                                    <div className="rounded-2xl border-2 border-slate-800 bg-white/80 px-4 py-3 text-left shadow-sm">
                                                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-700">Luật hiện tại</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-700">Mỗi tài khoản có 1 phiên đăng nhập chính và tối đa {maxAllowedTabs} tab chơi trong cùng phiên đó.</div>
                                                    </div>
                                                    <div className="rounded-2xl border-2 border-slate-800 bg-white/80 px-4 py-3 text-left shadow-sm">
                                                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-700">Gợi ý</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-700">Đóng bớt tab đang chơi hoặc đăng nhập lại ở thiết bị bạn muốn sử dụng.</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="relative flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-slate-800 bg-white/90 px-6 py-5">
                                                <button
                                                    type="button"
                                                    onClick={() => window.location.reload()}
                                                    className="rounded-full border-2 border-slate-900 bg-gradient-to-b from-yellow-300 to-amber-400 px-5 py-2 text-sm font-black uppercase tracking-wide text-slate-900 shadow-sm transition-transform hover:-translate-y-0.5"
                                                >
                                                    Tải lại tab này
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={logout}
                                                    className="rounded-full border-2 border-slate-900 bg-gradient-to-b from-slate-100 to-slate-200 px-5 py-2 text-sm font-black uppercase tracking-wide text-slate-800 shadow-sm transition-transform hover:-translate-y-0.5"
                                                >
                                                    Đăng xuất
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <Outlet />
                                )}
                            </div>
                        </div>
                    </section>
                    <aside className="hidden lg:block w-[260px] flex-shrink-0 sticky top-20 self-start mt-12">
                        <RightColumn />
                    </aside>
                </div>
            </main>
            {isMenuOpen && (
                <div className="fixed inset-0 z-[60] lg:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMenuOpen(false)} />
                    <div className="absolute left-0 top-0 bottom-0 w-[300px] bg-white border-r border-blue-400 shadow-xl flex flex-col">
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
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6" onClick={(e) => {
                            if (e.target.tagName === 'A') setIsMenuOpen(false);
                        }}>
                            {user && (
                                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-14 h-14 rounded-full flex items-center justify-center shadow-md overflow-hidden shrink-0">
                                            <VipAvatar
                                                userLike={user}
                                                avatar={mobileProfile.avatar}
                                                fallback={DEFAULT_AVATAR}
                                                alt="Avatar"
                                                wrapperClassName="w-full h-full"
                                                imageClassName="w-full h-full object-cover rounded-full pixelated"
                                                frameClassName="w-full h-full object-cover rounded-full scale-[1.35]"
                                                loading="eager"
                                            />
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-base"><VipUsername userLike={user}>{user.username}</VipUsername></div>
                                            <div className="flex gap-2 text-xs">
                                                {isVipRole(user) ? (
                                                    <span className="px-1.5 py-0.5 bg-amber-500 rounded text-white font-bold uppercase">{vipBadgeLabel}</span>
                                                ) : isAdminRole(user) ? (
                                                    <span className="px-1.5 py-0.5 bg-rose-500 rounded text-white font-bold uppercase">Admin</span>
                                                ) : null}
                                                <span className="text-slate-500">Level {mobileProfile.level}</span>
                                            </div>
                                            {vipTitle && (
                                                <div className="mt-0.5 text-[10px] font-bold text-amber-600 max-w-[180px] truncate">
                                                    {vipTitle}
                                                </div>
                                            )}
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
                            <div className="space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Chức năng chính</div>
                                <LeftColumn />
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Thông tin khác</div>
                                <RightColumn />
                            </div>

                        </div>
                    </div>
                </div>
            )}
            {!isPlayTabBlocked ? <GlobalChatPopup /> : null}
        </div>
    )
}
