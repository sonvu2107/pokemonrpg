import { NavLink } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useState, useEffect } from "react"
import { mapApi } from "../services/mapApi"

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

export default function LeftColumn() {
    const { logout } = useAuth()
    const [legendaryMaps, setLegendaryMaps] = useState([])
    const [loadingMaps, setLoadingMaps] = useState(true)

    useEffect(() => {
        const loadLegendaryMaps = async () => {
            try {
                const maps = await mapApi.fetchLegendaryMaps()
                setLegendaryMaps(maps)
            } catch (err) {
                console.error('Failed to load legendary maps:', err)
            } finally {
                setLoadingMaps(false)
            }
        }
        loadLegendaryMaps()
    }, [])

    return (
        <div className="flex flex-col w-full">

            {/* WINTER EVENT */}
            <SidebarSection title="Sự Kiện Mùa Đông" iconId={38}> {/* Ninetales/Vulpix for winter feel */}
                <SidebarLink to="/event/winter" isSpecial>Sự Kiện Mùa Đông</SidebarLink>
                <SidebarLink to="/shop/snowflake" isSpecial>Cửa Hàng Tuyết</SidebarLink>
            </SidebarSection>

            {/* RECENTLY UPDATED */}
            <SidebarSection title="Mới Cập Nhật" iconId={89}> {/* Muk/Grimer generic placeholder, or use something else */}
                <SidebarLink to="/explore/sunless" isSpecial>Sunless Galaxy</SidebarLink>
                <SidebarLink to="/explore/enigma" isSpecial>Đảo Bí Ẩn</SidebarLink>
                <SidebarLink to="/explore/ruins">Tàn Tích Alph</SidebarLink>
            </SidebarSection>

            {/* GENERAL */}
            <SidebarSection title="Chung" iconId={81}> {/* Magnemite */}
                <SidebarLink to="/">Trang Chủ</SidebarLink>
                <SidebarLink to="/welcome">Chào Mừng</SidebarLink>
                <SidebarLink to="/messages">Tin Nhắn</SidebarLink>
                <SidebarLink to="/trades">Giao Dịch</SidebarLink>
                <SidebarLink to="/guides">Hướng Dẫn</SidebarLink>
                <SidebarLink to="/guide/new" isSpecial>Hướng Dẫn Tân Thủ</SidebarLink>
                <SidebarLink to="/friends">Bạn Bè</SidebarLink>
                <SidebarLink to="/staff">Ban Quản Trị</SidebarLink>
                <SidebarLink to="/rules">Nội Quy</SidebarLink>
                <SidebarLink to="/chat">Trò Chuyện</SidebarLink>
                <SidebarLink to="/forums">Diễn Đàn</SidebarLink>
                <SidebarLink to="/donations">Ủng Hộ</SidebarLink>
                <button onClick={logout} className="block w-full text-left px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm">
                    Đăng Xuất
                </button>
            </SidebarSection>

            {/* MISCELLANEOUS */}
            <SidebarSection title="Khác" iconId={121}> {/* Starmie */}
                <SidebarLink to="/search">Tìm Người Chơi</SidebarLink>
                <SidebarLink to="/options">Tùy Chọn</SidebarLink>
                <SidebarLink to="/referral">Giới Thiệu</SidebarLink>
                <SidebarLink to="/music">Nghe Nhạc</SidebarLink>
                <SidebarLink to="/art">Tác Giả</SidebarLink>
            </SidebarSection>

            {/* EXPLORE */}
            <SidebarSection title="Khám Phá" iconId={138}> {/* Omanyte/Omastar for exploration */}
                <SidebarLink to="/battle">Khu Vực Chiến Đấu</SidebarLink>
                <SidebarLink to="/legendary">Khu Vực Huyền Thoại</SidebarLink>
                <SidebarLink to="/mines">Hầm Mỏ</SidebarLink>
                <SidebarLink to="/center">Trung Tâm Pokemon</SidebarLink>
                <SidebarLink to="/minigames">Minigame</SidebarLink>
                <SidebarLink to="/dna">Trung Tâm DNA</SidebarLink>
                <SidebarLink to="/lottery">Xổ Số</SidebarLink>
                <SidebarLink to="/chase" isSpecial>Truy Đuổi Cầu Vồng</SidebarLink>
            </SidebarSection>

            {/* PLUSHIES */}
            <SidebarSection title="Thú Bông" iconId={60}> {/* Poliwag */}
                <SidebarLink to="/plushies">Thú Bông</SidebarLink>
                <SidebarLink to="/plushies/trade">Đổi Thú Bông</SidebarLink>
                <SidebarLink to="/plushies/dex">Plushie Dex</SidebarLink>
            </SidebarSection>

            {/* LEGENDARY AREAS */}
            {legendaryMaps.length > 0 && (
                <SidebarSection title="Khu Vực Huyền Thoại" iconId={legendaryMaps[0]?.iconId || 385}>
                    {loadingMaps ? (
                        <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                    ) : (
                        legendaryMaps.map((map) => (
                            <SidebarLink key={map._id} to={`/map/${map.slug}`}>
                                {map.name}
                            </SidebarLink>
                        ))
                    )}
                </SidebarSection>
            )}

        </div>
    )
}
