import { NavLink } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useState, useEffect } from "react"
import { gameApi } from "../services/gameApi"

const SidebarSection = ({ title, iconId, children }) => (
    <div className="rounded-md overflow-hidden shadow-sm mb-3">
        {/* Header */}
        <div className="bg-gradient-to-t from-blue-700 to-cyan-500 px-2 py-1.5 flex items-center gap-2 border-b border-blue-600">
            {iconId && (
                <img
                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${iconId}.png`}
                    alt="icon"
                    className="w-6 h-6 -my-2 pixelated"
                />
            )}
            <span className="text-sm font-bold text-white drop-shadow-md">{title}</span>
        </div>
        {/* Body */}
        <div className="bg-cyan-400 p-2 space-y-0.5">
            {children}
        </div>
    </div>
)

const SidebarLink = ({ to, children, isSpecial }) => (
    <NavLink
        to={to}
        className={({ isActive }) =>
            "block px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm " +
            (isActive ? "text-amber-300" : "") +
            (isSpecial ? " text-blue-800" : "")
        }
    >
        {isSpecial && <span className="mr-1 text-blue-700">*</span>}
        {children}
    </NavLink>
)

const InfoRow = ({ label, value }) => (
    <div className="flex flex-col text-sm font-bold text-white drop-shadow-sm px-2 py-0.5">
        <span>{label}: {value}</span>
    </div>
)

// Helper function to format numbers with commas
const formatNumber = (num) => {
    if (num === null || num === undefined) return '...'
    return num.toLocaleString('vi-VN')
}

export default function RightColumn() {
    const { user } = useAuth()
    const isAdmin = user?.role === 'admin'
    const [serverStats, setServerStats] = useState({ totalUsers: null, onlineUsers: null })
    const [loadingStats, setLoadingStats] = useState(true)

    // Fetch server stats on mount and refresh every 30 seconds
    useEffect(() => {
        const fetchStats = async () => {
            try {
                const data = await gameApi.getServerStats()
                if (data.ok) {
                    setServerStats({
                        totalUsers: data.totalUsers,
                        onlineUsers: data.onlineUsers,
                    })
                }
            } catch (err) {
                console.error('Failed to fetch server stats:', err)
            } finally {
                setLoadingStats(false)
            }
        }

        fetchStats()
        const interval = setInterval(fetchStats, 30000) // Refresh every 30 seconds

        return () => clearInterval(interval)
    }, [])

    return (
        <div className="flex flex-col w-full">


            {/* ADMIN (Internal) */}
            {isAdmin && (
                <SidebarSection title="Quản Trị" iconId={150}>
                    <SidebarLink to="/admin">Tổng quan</SidebarLink>
                    <SidebarLink to="/admin/users">Quản lý Người Chơi</SidebarLink>
                    <SidebarLink to="/admin/pokemon">Quản lý Pokemon</SidebarLink>
                    <SidebarLink to="/admin/maps">Quản lý Bản Đồ</SidebarLink>
                    <SidebarLink to="/admin/items">Quản lý Vật Phẩm</SidebarLink>
                    <SidebarLink to="/admin/config">Cấu Hình Game</SidebarLink>
                </SidebarSection>
            )}

            {/* INFORMATION */}
            <SidebarSection title="Thông Tin" iconId={137}>
                <InfoRow label="Tổng người chơi" value={formatNumber(serverStats.totalUsers)} />
                <InfoRow label="Đang online" value={formatNumber(serverStats.onlineUsers)} />
                <InfoRow label="Giờ Server" value={new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} />
                <SidebarLink to="/stats">Thống kê ngày</SidebarLink>
            </SidebarSection>

            {/* ACCOUNT */}
            <SidebarSection title="Tài Khoản" iconId={403}>
                <SidebarLink to="/profile">Hồ sơ ({user?.username || 'Khách'})</SidebarLink>
                <SidebarLink to="/inventory">Túi đồ</SidebarLink>
                <SidebarLink to="/profile/edit">Sửa hồ sơ</SidebarLink>
                <SidebarLink to="/titles">Danh hiệu</SidebarLink>
            </SidebarSection>

            {/* POKEMON */}
            <SidebarSection title="Pokemon" iconId={823}>
                <SidebarLink to="/box">Kho Pokemon</SidebarLink>
                <SidebarLink to="/party">Thay đổi đội hình</SidebarLink>
                <SidebarLink to="/evolve">Tiến hóa</SidebarLink>
                <SidebarLink to="/pokedex">Pokedex</SidebarLink>
            </SidebarSection>

            {/* FREE STUFF */}
            <SidebarSection title="Quà Tặng" iconId={385}>
                <SidebarLink to="/promo">Pokemon Sự Kiện</SidebarLink>
                <SidebarLink to="/daily">Quà Hàng Ngày</SidebarLink>
            </SidebarSection>

            {/* RANKS */}
            <SidebarSection title="Xếp Hạng" iconId={215}>
                <SidebarLink to="/rankings/pokemon">BXH Pokemon</SidebarLink>
                <SidebarLink to="/rankings/overall">BXH Tổng</SidebarLink>
                <SidebarLink to="/rankings/daily">BXH Ngày</SidebarLink>
            </SidebarSection>

            {/* ECONOMY */}
            <SidebarSection title="Kinh Tế" iconId={304}>
                <SidebarLink to="/shop/buy">Mua Pokemon</SidebarLink>
                <SidebarLink to="/shop/sell">Bán Pokemon</SidebarLink>
                <SidebarLink to="/shop/items">Cửa hàng Vật Phẩm</SidebarLink>
                <SidebarLink to="/shop/moon">Cửa hàng Nguyệt Các</SidebarLink>
                <SidebarLink to="/shop/mine">Cửa hàng Hầm Mỏ</SidebarLink>
                <SidebarLink to="/shop/parrot" isSpecial>Cửa hàng Vẹt</SidebarLink>
            </SidebarSection>

            {/* ADMIN (Internal) */}


        </div>
    )
}
