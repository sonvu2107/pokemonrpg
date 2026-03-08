import { Link, NavLink } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useState, useEffect } from "react"
import { gameApi } from "../services/gameApi"
import { ADMIN_PERMISSIONS } from "../constants/adminPermissions"
import ComingSoonModal from "../components/ComingSoonModal"

const SidebarSection = ({ title, iconId, children }) => (
    <div className="rounded-md overflow-hidden shadow-sm mb-3">
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
        <div className="bg-cyan-400 p-2 space-y-0.5">
            {children}
        </div>
    </div>
)

const SidebarLink = ({ to, children, isSpecial, onClick }) => {
    if (onClick) {
        return (
            <button
                onClick={onClick}
                className={"block w-full text-left px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm" + (isSpecial ? " text-blue-800" : "")}
            >
                {isSpecial && <span className="mr-1 text-blue-700">*</span>}
                {children}
            </button>
        )
    }

    return (
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
}

const InfoRow = ({ label, value, to }) => {
    if (to) {
        return (
            <Link to={to} className="block px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm">
                {label}: {value}
            </Link>
        )
    }

    return (
        <div className="flex flex-col text-sm font-bold text-white drop-shadow-sm px-2 py-0.5">
            <span>{label}: {value}</span>
        </div>
    )
}

const formatNumber = (num) => {
    if (num === null || num === undefined) return '...'
    return num.toLocaleString('vi-VN')
}

export default function RightColumn() {
    const { user, canAccessAdminModule } = useAuth()
    const isAdmin = user?.role === 'admin'
    const adminLinks = [
        { to: '/admin', label: 'Tổng quan', permission: null },
        { to: '/admin/events', label: 'Quản lý Sự kiện', permission: ADMIN_PERMISSIONS.NEWS },
        { to: '/admin/users', label: 'Quản lý Người Chơi', permission: ADMIN_PERMISSIONS.USERS },
        { to: '/admin/vip-privileges', label: 'Đặc quyền VIP', permission: ADMIN_PERMISSIONS.USERS },
        { to: '/admin/pokemon', label: 'Quản lý Pokémon', permission: ADMIN_PERMISSIONS.POKEMON },
        { to: '/admin/maps', label: 'Quản lý Bản Đồ', permission: ADMIN_PERMISSIONS.MAPS },
        { to: '/admin/items', label: 'Quản lý Vật Phẩm', permission: ADMIN_PERMISSIONS.ITEMS },
        { to: '/admin/moves', label: 'Quản lý Kỹ Năng', permission: ADMIN_PERMISSIONS.MOVES },
        { to: '/admin/news', label: 'Quản lý Tin Tức', permission: ADMIN_PERMISSIONS.NEWS },
        { to: '/admin/battle', label: 'Quản lý Battle', permission: ADMIN_PERMISSIONS.BATTLE },
        { to: '/admin/daily-rewards', label: 'Quản lý Quà Ngày', permission: ADMIN_PERMISSIONS.REWARDS },
        { to: '/admin/weekly-leaderboards', label: 'Quản lý Top Tuần', permission: ADMIN_PERMISSIONS.REWARDS },
        { to: '/admin/promo-codes', label: 'Quản lý Mã Code', permission: ADMIN_PERMISSIONS.CODES },
    ].filter((link) => !link.permission || canAccessAdminModule(link.permission))

    const [serverStats, setServerStats] = useState({ totalUsers: null, onlineUsers: null })
    const [comingSoonModalOpen, setComingSoonModalOpen] = useState(false)
    const [comingSoonFeature, setComingSoonFeature] = useState('')

    const handleFeatureClick = (e, featureName) => {
        e.preventDefault()
        setComingSoonFeature(featureName)
        setComingSoonModalOpen(true)
    }

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
                console.error('Không thể tải thống kê máy chủ:', err)
            }
        }

        fetchStats()
        const interval = setInterval(fetchStats, 30000)
        return () => clearInterval(interval)
    }, [])

    return (
        <div className="flex flex-col w-full">
            {isAdmin && adminLinks.length > 0 && (
                <SidebarSection title="Quản Trị" iconId={150}>
                    {adminLinks.map((link) => (
                        <SidebarLink key={link.to} to={link.to}>{link.label}</SidebarLink>
                    ))}
                </SidebarSection>
            )}

            <SidebarSection title="Thông Tin" iconId={137}>
                <InfoRow label="Tổng người chơi" value={formatNumber(serverStats.totalUsers)} />
                <InfoRow label="Đang online" value={formatNumber(serverStats.onlineUsers)} to="/stats/online" />
                <InfoRow label="Giờ Server" value={new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} />
                <SidebarLink to="/stats">Thống kê ngày</SidebarLink>
            </SidebarSection>

            <SidebarSection title="Tài Khoản" iconId={403}>
                <SidebarLink to="/profile">Hồ sơ ({user?.username || 'Khách'})</SidebarLink>
                <SidebarLink to="/inventory">Túi đồ</SidebarLink>
                <SidebarLink to="/profile/edit">Sửa hồ sơ</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Danh hiệu')}>Danh hiệu</SidebarLink>
            </SidebarSection>

            <SidebarSection title="Pokemon" iconId={823}>
                <SidebarLink to="/box">Kho Pokémon</SidebarLink>
                <SidebarLink to="/party">Thay đổi đội hình</SidebarLink>
                <SidebarLink to="/evolve">Tiến hóa</SidebarLink>
                <SidebarLink to="/pokedex">Pokédex</SidebarLink>
            </SidebarSection>

            <SidebarSection title="Quà Tặng" iconId={385}>
                <SidebarLink to="/promo">Nhập Giftcode</SidebarLink>
                <SidebarLink to="/daily">Quà Hằng Ngày</SidebarLink>
            </SidebarSection>

            <SidebarSection title="Xếp Hạng" iconId={215}>
                <SidebarLink to="/rankings/pokemon">BXH Pokémon</SidebarLink>
                <SidebarLink to="/rankings/rarity">Bảng Độ Hiếm</SidebarLink>
                <SidebarLink to="/rankings/overall">BXH Tổng</SidebarLink>
                <SidebarLink to="/rankings/daily">BXH Ngày</SidebarLink>
            </SidebarSection>

            <SidebarSection title="Kinh Tế" iconId={304}>
                <SidebarLink to="/shop/buy">Mua Pokémon</SidebarLink>
                <SidebarLink to="/shop/sell">Bán Pokémon</SidebarLink>
                <SidebarLink to="/shop/items">Cửa hàng Vật Phẩm</SidebarLink>
                <SidebarLink to="/shop/skills">Cửa hàng Kỹ Năng</SidebarLink>
                <SidebarLink to="/shop/moon">Cửa hàng Nguyệt Các</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Cửa hàng Hầm Mỏ')}>Cửa hàng Hầm Mỏ</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Cửa hàng Vẹt')} isSpecial>Cửa hàng Vẹt</SidebarLink>
            </SidebarSection>
            <ComingSoonModal
                isOpen={comingSoonModalOpen}
                onClose={() => setComingSoonModalOpen(false)}
                featureName={comingSoonFeature}
            />
        </div>
    )
}
