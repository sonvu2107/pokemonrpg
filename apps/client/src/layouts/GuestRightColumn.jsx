import { NavLink } from "react-router-dom"

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

// Simplified RightColumn specifically for Login Page (Guest mode)
export default function GuestRightColumn() {
    return (
        <div className="flex flex-col w-full">

            {/* GENERAL */}
            <SidebarSection title="Chung" iconId={12}> {/* Butterfree/Generic */}
                <SidebarLink to="/">Trang Chủ</SidebarLink>
                <SidebarLink to="/register">Đăng Ký</SidebarLink>
                <SidebarLink to="/login">Đăng Nhập</SidebarLink>
            </SidebarSection>

            {/* STATISTICS */}
            <SidebarSection title="Thống Kê" iconId={137}> {/* Porygon */}
                <InfoRow label="Tổng Người Chơi" value="1,089,947" />
                <InfoRow label="Đang Online" value="682" />
            </SidebarSection>

            {/* MISCELLANEOUS */}
            <SidebarSection title="Khác" iconId={121}> {/* Starmie */}
                <SidebarLink to="/news">Tin Tức Mới</SidebarLink>
                <SidebarLink to="/news/archive">Lưu Trữ Tin</SidebarLink>
            </SidebarSection>

        </div>
    )
}
