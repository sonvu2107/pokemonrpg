import { NavLink } from "react-router-dom"
import { useState, useEffect } from "react"
import { api } from "../services/api"

const SidebarSection = ({ title, iconId, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(() => {
        if (typeof window === 'undefined') return defaultOpen
        return window.innerWidth < 1024 ? false : defaultOpen
    })

    return (
        <div className="rounded-md overflow-hidden shadow-sm mb-3">
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                className="w-full bg-gradient-to-t from-blue-700 to-cyan-500 px-2 py-1.5 flex items-center gap-2 border-b border-blue-600 text-left"
            >
                {iconId && (
                    <img
                        src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${iconId}.png`}
                        alt="icon"
                        className="w-6 h-6 -my-2 pixelated"
                    />
                )}
                <span className="text-sm font-bold text-white drop-shadow-md flex-1">{title}</span>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-white/40 bg-white/10 text-xs font-extrabold text-white">
                    {isOpen ? '-' : '+'}
                </span>
            </button>
            {isOpen && (
                <div className="bg-cyan-400 p-2 space-y-0.5">
                    {children}
                </div>
            )}
        </div>
    )
}

const SidebarLink = ({ to, children }) => (
    <NavLink
        to={to}
        className={({ isActive }) =>
            "block px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm " +
            (isActive ? "text-amber-300" : "")
        }
    >
        {children}
    </NavLink>
)

const InfoRow = ({ label, value }) => (
    <div className="flex flex-col text-sm font-bold text-white drop-shadow-sm px-2 py-0.5">
        <span>{label}: {value}</span>
    </div>
)
export default function GuestRightColumn() {
    const [stats, setStats] = useState({ totalUsers: 0, onlineUsers: 0 })
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const data = await api.getStats()
                setStats(data)
            } catch (error) {
                console.error('Không thể tải thống kê:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchStats()
        const interval = setInterval(fetchStats, 60000)
        return () => clearInterval(interval)
    }, [])

    const formatNumber = (num) => {
        if (loading) return "..."
        return num ? num.toLocaleString() : "0"
    }

    return (
        <div className="flex flex-col w-full">
            <SidebarSection title="Chung" iconId={12}> 
                <SidebarLink to="/">Trang Chủ</SidebarLink>
                <SidebarLink to="/register">Đăng Ký</SidebarLink>
                <SidebarLink to="/login">Đăng Nhập</SidebarLink>
            </SidebarSection>
            <SidebarSection title="Thống Kê" iconId={137}>
                <InfoRow label="Tổng Người Chơi" value={formatNumber(stats.totalUsers)} />
                <InfoRow label="Đang Online" value={formatNumber(stats.onlineUsers)} />
            </SidebarSection>
            <SidebarSection title="Khác" iconId={121}> 
                <SidebarLink to="/news">Tin Tức Mới</SidebarLink>
                <SidebarLink to="/news/archive">Lưu Trữ Tin</SidebarLink>
            </SidebarSection>
        </div>
    )
}
