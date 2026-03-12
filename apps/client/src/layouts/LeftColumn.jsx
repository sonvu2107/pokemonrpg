import { NavLink } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { useState, useEffect } from "react"
import { gameApi } from "../services/gameApi"
import newsApi from "../services/newsApi"
import ComingSoonModal from "../components/ComingSoonModal"

const SUPPORT_TAG = 'ung-ho'

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

export default function LeftColumn() {
    const { user, logout } = useAuth()
    const [legendaryMaps, setLegendaryMaps] = useState([])
    const [vipMaps, setVipMaps] = useState([])
    const [loadingMaps, setLoadingMaps] = useState(true)
    const [notificationPosts, setNotificationPosts] = useState([])
    const [supportPosts, setSupportPosts] = useState([])
    const [updatePosts, setUpdatePosts] = useState([])
    const [loadingHighlights, setLoadingHighlights] = useState(true)
    const [comingSoonModalOpen, setComingSoonModalOpen] = useState(false)
    const [comingSoonFeature, setComingSoonFeature] = useState('')
    const handleFeatureClick = (e, featureName) => {
        e.preventDefault()
        setComingSoonFeature(featureName)
        setComingSoonModalOpen(true)
    }
    const resolveNewsTarget = (post) => {
        if (post?._id) return `/news/${post._id}`
        return '/'
    }
    const sortPostsByDate = (posts) => {
        return [...posts].sort((a, b) => {
            const aTime = new Date(a?.createdAt || 0).getTime()
            const bTime = new Date(b?.createdAt || 0).getTime()
            return bTime - aTime
        })
    }
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
        let isCancelled = false
        const loadLegendaryMaps = async () => {
            if (!user) {
                if (!isCancelled) {
                    setLegendaryMaps([])
                    setVipMaps([])
                    setLoadingMaps(false)
                }
                return
            }
            try {
                if (!isCancelled) {
                    setLoadingMaps(true)
                }
                const maps = await gameApi.getMaps()
                const vipOnly = maps.filter((map) => Number(map?.vipVisibilityLevel || 0) > 0)
                const legendaryOnly = maps.filter((map) => map.isLegendary && Number(map?.vipVisibilityLevel || 0) <= 0)
                if (!isCancelled) {
                    setVipMaps(sortByDisplayOrder(vipOnly))
                    setLegendaryMaps(sortByDisplayOrder(legendaryOnly))
                }
            } catch (err) {
                const message = String(err?.message || '')
                if (!/unauthorized|token expired|invalid token/i.test(message)) {
                    console.error('Không thể tải bản đồ huyền thoại:', err)
                }
                if (!isCancelled) {
                    setVipMaps([])
                }
            } finally {
                if (!isCancelled) {
                    setLoadingMaps(false)
                }
            }
        }

        const handleMapProgressUpdated = () => {
            loadLegendaryMaps()
        }

        loadLegendaryMaps()
        window.addEventListener('game:map-progress-updated', handleMapProgressUpdated)

        return () => {
            isCancelled = true
            window.removeEventListener('game:map-progress-updated', handleMapProgressUpdated)
        }
    }, [user])

    useEffect(() => {
        const loadHighlights = async () => {
            try {
                const [notificationRes, newsRes, updateRes, supportRes] = await Promise.all([
                    newsApi.getNews({ limit: 5, type: 'notification' }),
                    newsApi.getNews({ limit: 10, type: 'news' }),
                    newsApi.getNews({ limit: 5, type: 'update' }),
                    newsApi.getNews({ limit: 1, tag: SUPPORT_TAG }),
                ])
                const mergedUpdates = sortPostsByDate([
                    ...(newsRes?.ok ? (newsRes.posts || []) : []),
                    ...(updateRes?.ok ? (updateRes.posts || []) : []),
                ]).slice(0, 5)

                setNotificationPosts(sortPostsByDate(notificationRes?.ok ? (notificationRes.posts || []) : []).slice(0, 5))
                setSupportPosts(sortPostsByDate(supportRes?.ok ? (supportRes.posts || []) : []).slice(0, 1))
                setUpdatePosts(mergedUpdates)
            } catch (err) {
                console.error('Không thể tải điểm nhấn:', err)
                setNotificationPosts([])
                setSupportPosts([])
                setUpdatePosts([])
            } finally {
                setLoadingHighlights(false)
            }
        }

        loadHighlights()
    }, [])

    return (
        <div className="flex flex-col w-full">

            {vipMaps.length > 0 && (
                <SidebarSection title="Bản Đồ VIP" iconId={vipMaps[0]?.iconId || 145}>
                    {loadingMaps ? (
                        <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                    ) : (
                        vipMaps.map((map) => (
                            <SidebarLink key={map._id} to={`/map/${map.slug}`} isSpecial>
                                {`VIP ${Math.max(0, Number(map.vipVisibilityLevel) || 0)} - ${map.name}`}
                            </SidebarLink>
                        ))
                    )}
                </SidebarSection>
            )}
            <SidebarSection title="Tin Tức" iconId={89}>
                <SidebarLink to="/event-maps" isSpecial>Danh sách bản đồ sự kiện</SidebarLink>
                <SidebarLink to="/notifications" isSpecial>Danh sách thông báo</SidebarLink>
                <SidebarLink to="/news-list" isSpecial>Danh sách tin tức</SidebarLink>
            </SidebarSection>
            <SidebarSection title="Ủng Hộ" iconId={113}>
                {loadingHighlights ? (
                    <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                ) : supportPosts.length === 0 ? (
                    <div className="text-xs text-white/70 px-2 py-1">Chưa có bài ủng hộ.</div>
                ) : (
                    <SidebarLink to={resolveNewsTarget(supportPosts[0])}>
                        Ủng Hộ
                    </SidebarLink>
                )}
            </SidebarSection>
            <SidebarSection title="Chung" iconId={81}>
                <SidebarLink to="/">Trang Chủ</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Tin Nhắn')}>Tin Nhắn</SidebarLink>
                <SidebarLink to="/shop/buy">Giao Dịch</SidebarLink>
                <SidebarLink to="/friends">Bạn Bè</SidebarLink>
                <button onClick={logout} className="block w-full text-left px-2 py-0.5 text-sm font-bold text-white hover:text-amber-300 transition-colors drop-shadow-sm">
                    Đăng Xuất
                </button>
            </SidebarSection>
            <SidebarSection title="Khác" iconId={121}>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Tìm Người Chơi')}>Tìm Người Chơi</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Tùy Chọn')}>Tùy Chọn</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Giới Thiệu')}>Giới Thiệu</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Nghe Nhạc')}>Nghe Nhạc</SidebarLink>
            </SidebarSection>
            <SidebarSection title="Khám Phá" iconId={138}>
                <SidebarLink to="/battle">Khu Vực Chiến Đấu</SidebarLink>
                <SidebarLink to="/valley">Thung Lũng Pokémon</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Hầm Mỏ')}>Hầm Mỏ</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Trung Tâm Pokemon')}>Trung Tâm Pokemon</SidebarLink>
                <SidebarLink onClick={(e) => handleFeatureClick(e, 'Minigame')}>Minigame</SidebarLink>
            </SidebarSection>
            {legendaryMaps.length > 0 && (
                <SidebarSection title="Khu Vực Săn Bắt" iconId={legendaryMaps[0]?.iconId || 385}>
                    {loadingMaps ? (
                        <div className="text-xs text-white/70 px-2 py-1">Đang tải...</div>
                    ) : (
                        legendaryMaps.map((map) => {
                            const isLocked = !map.isUnlocked
                            const requiredSearches = map.unlockRequirement?.requiredSearches || 0
                            const remainingSearches = map.unlockRequirement?.remainingSearches || 0
                            const requiredPlayerLevel = Math.max(1, Number(map.unlockRequirement?.requiredPlayerLevel) || 1)
                            const currentPlayerLevel = Math.max(1, Number(map.unlockRequirement?.currentPlayerLevel) || 1)
                            const remainingPlayerLevels = map.unlockRequirement?.remainingPlayerLevels || 0
                            const sourceMapName = map.unlockRequirement?.sourceMap?.name
                            const tooltip = (() => {
                                if (!isLocked) return ''
                                const parts = []
                                if (remainingPlayerLevels > 0) {
                                    parts.push(`Cần Lv ${requiredPlayerLevel} (hiện tại Lv ${currentPlayerLevel})`)
                                }
                                if (requiredSearches > 0 && remainingSearches > 0) {
                                    parts.push(`Cần thêm ${remainingSearches} lượt tìm kiếm tại ${sourceMapName || 'map trước'}`)
                                }
                                return parts.join(' | ')
                            })()

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

            <ComingSoonModal
                isOpen={comingSoonModalOpen}
                onClose={() => setComingSoonModalOpen(false)}
                featureName={comingSoonFeature}
            />
        </div>
    )
}
