import { NavLink } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useState, useEffect } from "react"
import { gameApi } from "../services/gameApi"
import newsApi from "../services/newsApi"

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
    const [eventPosts, setEventPosts] = useState([])
    const [updatePosts, setUpdatePosts] = useState([])
    const [loadingHighlights, setLoadingHighlights] = useState(true)

    const sortByDisplayOrder = (maps) => {
        return maps
            .map((map, index) => ({ ...map, __originalIndex: index }))
            .sort((a, b) => {
                const aParsedOrder = Number(a.orderIndex)
                const bParsedOrder = Number(b.orderIndex)
                const aOrder = Number.isFinite(aParsedOrder) ? aParsedOrder : Number.MAX_SAFE_INTEGER
                const bOrder = Number.isFinite(bParsedOrder) ? bParsedOrder : Number.MAX_SAFE_INTEGER
                if (aOrder !== bOrder) return aOrder - bOrder
                return a.__originalIndex - b.__originalIndex
            })
            .map(({ __originalIndex, ...map }) => map)
    }

    useEffect(() => {
        const loadLegendaryMaps = async () => {
            try {
                const maps = await gameApi.getMaps()
                const legendaryOnly = maps.filter((map) => map.isLegendary)
                setLegendaryMaps(sortByDisplayOrder(legendaryOnly))
            } catch (err) {
                console.error('Failed to load legendary maps:', err)
            } finally {
                setLoadingMaps(false)
            }
        }
        loadLegendaryMaps()
    }, [])

    useEffect(() => {
        const loadHighlights = async () => {
            try {
                const [eventRes, updateRes] = await Promise.all([
                    newsApi.getNews({ limit: 5, type: 'event' }),
                    newsApi.getNews({ limit: 5, type: 'update' }),
                ])

                setEventPosts(eventRes?.ok ? (eventRes.posts || []) : [])
                setUpdatePosts(updateRes?.ok ? (updateRes.posts || []) : [])
            } catch (err) {
                console.error('Failed to load highlights:', err)
                setEventPosts([])
                setUpdatePosts([])
            } finally {
                setLoadingHighlights(false)
            }
        }

        loadHighlights()
    }, [])

    return (
        <div className="flex flex-col w-full">

            {/* EVENTS */}
            <SidebarSection title="Sự Kiện" iconId={38}>
                {loadingHighlights ? (
                    <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                ) : eventPosts.length === 0 ? (
                    <div className="text-xs text-white/70 px-2 py-1">Chưa có sự kiện mới.</div>
                ) : (
                    eventPosts.map((post) => (
                        <SidebarLink key={post._id} to="/" isSpecial>
                            {post.title}
                        </SidebarLink>
                    ))
                )}
            </SidebarSection>

            {/* RECENT UPDATES */}
            <SidebarSection title="Mới Cập Nhật" iconId={89}>
                {loadingHighlights ? (
                    <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                ) : updatePosts.length === 0 ? (
                    <div className="text-xs text-white/70 px-2 py-1">Chưa có cập nhật mới.</div>
                ) : (
                    updatePosts.map((post) => (
                        <SidebarLink key={post._id} to="/" isSpecial>
                            {post.title}
                        </SidebarLink>
                    ))
                )}
            </SidebarSection>

            {/* GENERAL */}
            <SidebarSection title="Chung" iconId={81}> {/* Magnemite */}
                <SidebarLink to="/">Trang Chủ</SidebarLink>
                <SidebarLink to="/messages">Tin Nhắn</SidebarLink>
                <SidebarLink to="/trades">Giao Dịch</SidebarLink>
                <SidebarLink to="/friends">Bạn Bè</SidebarLink>
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
            </SidebarSection>

            {/* EXPLORE */}
            <SidebarSection title="Khám Phá" iconId={138}> {/* Omanyte/Omastar for exploration */}
                <SidebarLink to="/battle">Khu Vực Chiến Đấu</SidebarLink>
                <SidebarLink to="/legendary">Khu Vực Săn Bắt</SidebarLink>
                <SidebarLink to="/mines">Hầm Mỏ</SidebarLink>
                <SidebarLink to="/center">Trung Tâm Pokemon</SidebarLink>
                <SidebarLink to="/minigames">Minigame</SidebarLink>
            </SidebarSection>

            {/* LEGENDARY AREAS */}
            {legendaryMaps.length > 0 && (
                <SidebarSection title="Khu Vực Săn Bắt" iconId={legendaryMaps[0]?.iconId || 385}>
                    {loadingMaps ? (
                        <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                    ) : (
                        legendaryMaps.map((map) => {
                            const isLocked = !map.isUnlocked
                            const requiredSearches = map.unlockRequirement?.requiredSearches || 0
                            const remainingSearches = map.unlockRequirement?.remainingSearches || 0
                            const sourceMapName = map.unlockRequirement?.sourceMap?.name
                            const tooltip = isLocked
                                ? `Cần thêm ${remainingSearches} lượt tìm kiếm tại ${sourceMapName || 'map trước'}`
                                : ''

                            if (isLocked) {
                                return (
                                    <div key={map._id} title={tooltip} className="px-2 py-0.5 text-sm font-bold text-white/50 cursor-not-allowed">
                                        {map.name}
                                    </div>
                                )
                            }

                            return (
                                <SidebarLink key={map._id} to={`/map/${map.slug}`}>
                                    {map.name}
                                </SidebarLink>
                            )
                        })
                    )}
                </SidebarSection>
            )}

        </div>
    )
}
