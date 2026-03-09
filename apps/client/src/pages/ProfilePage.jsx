import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { gameApi } from '../services/gameApi'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'
import SmartImage from '../components/SmartImage'
import VipAvatar from '../components/VipAvatar'
import VipTitleBadge from '../components/VipTitleBadge'
import { getPublicRoleLabel } from '../utils/vip'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

const InfoRow = ({ label, value, note, isOdd }) => (
    <div className={`flex border-b border-blue-200 text-sm ${isOdd ? 'bg-blue-50/50' : 'bg-white'}`}>
        <div className="w-1/3 p-2 bg-blue-100/50 font-semibold text-blue-900 border-r border-blue-200 flex items-center justify-end pr-4">
            {label}:
        </div>
        <div className="w-2/3 p-2 text-slate-700 flex items-center font-medium">
            {value}
            {note && <span className="ml-1 text-slate-500 text-xs font-normal">{note}</span>}
        </div>
    </div>
)

const formatDate = (value, withTime = false) => {
    if (!value) return 'Không rõ'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Không rõ'
    return date.toLocaleString('vi-VN', withTime
        ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'long', day: 'numeric' })
}

const formatBadgeBonuses = (activeBonuses = {}) => {
    const parts = []
    if (Number(activeBonuses?.partyDamagePercent || 0) > 0) parts.push(`+${activeBonuses.partyDamagePercent}% sát thương toàn đội`)
    if (Number(activeBonuses?.partySpeedPercent || 0) > 0) parts.push(`+${activeBonuses.partySpeedPercent}% tốc độ toàn đội`)
    if (Number(activeBonuses?.partyHpPercent || 0) > 0) parts.push(`+${activeBonuses.partyHpPercent}% máu toàn đội`)
    Object.entries(activeBonuses?.typeDamagePercentByType || {}).forEach(([type, percent]) => {
        if (Number(percent || 0) > 0) parts.push(`+${percent}% sát thương hệ ${String(type).toUpperCase()}`)
    })
    return parts.length > 0 ? parts.join(' | ') : 'Chưa kích hoạt chỉ số của huy hiệu'
}

const badgeRankClassMap = {
    D: 'border-slate-300 bg-slate-100 text-slate-700',
    C: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    B: 'border-sky-300 bg-sky-50 text-sky-700',
    A: 'border-violet-300 bg-violet-50 text-violet-700',
    S: 'border-orange-300 bg-orange-50 text-orange-700',
    SS: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    SSS: 'border-rose-300 bg-gradient-to-r from-rose-50 to-amber-50 text-rose-700',
}

const getBadgeRankClasses = (rank = 'D') => badgeRankClassMap[String(rank || 'D').toUpperCase()] || badgeRankClassMap.D

export default function ProfilePage() {
    const { login } = useAuth()
    const [profile, setProfile] = useState(null)
    const [party, setParty] = useState(Array(6).fill(null))
    const [showParty, setShowParty] = useState(true)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [refreshing, setRefreshing] = useState(false)
    const [showCosmeticModal, setShowCosmeticModal] = useState(false)
    const [cosmeticModalMode, setCosmeticModalMode] = useState('general')
    const [cosmeticLoading, setCosmeticLoading] = useState(false)
    const [cosmeticSaving, setCosmeticSaving] = useState(false)
    const [cosmeticError, setCosmeticError] = useState('')
    const [ownedTitleImages, setOwnedTitleImages] = useState([])
    const [ownedAvatarFrames, setOwnedAvatarFrames] = useState([])
    const [selectedTitleImageUrl, setSelectedTitleImageUrl] = useState('')
    const [selectedAvatarFrameUrl, setSelectedAvatarFrameUrl] = useState('')

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            setLoading(true)
            const [profileData, partyData] = await Promise.all([
                api.getProfile(),
                gameApi.getParty()
            ])

            setProfile(profileData)
            setParty(partyData)

            if (profileData.user) {
                const token = localStorage.getItem('token')
                login(profileData.user, token)
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = async () => {
        setRefreshing(true)
        await loadData()
        setRefreshing(false)
    }

    const handleOpenCosmeticModal = async (mode = 'general') => {
        try {
            setCosmeticError('')
            setCosmeticLoading(true)
            setCosmeticModalMode(mode === 'title' ? 'title' : 'general')
            setShowCosmeticModal(true)

            const cosmetics = await api.getProfileCosmetics()
            const equipped = cosmetics?.equipped || {}
            setOwnedTitleImages(Array.isArray(cosmetics?.owned?.titleImages) ? cosmetics.owned.titleImages : [])
            setOwnedAvatarFrames(Array.isArray(cosmetics?.owned?.avatarFrames) ? cosmetics.owned.avatarFrames : [])
            setSelectedTitleImageUrl(String(equipped?.titleImageUrl || '').trim())
            setSelectedAvatarFrameUrl(String(equipped?.avatarFrameUrl || '').trim())
        } catch (err) {
            setCosmeticError(err.message || 'Không thể tải danh sách danh hiệu/khung avatar')
        } finally {
            setCosmeticLoading(false)
        }
    }

    const handleSaveCosmetics = async () => {
        try {
            setCosmeticSaving(true)
            setCosmeticError('')
            const payload = cosmeticModalMode === 'title'
                ? {
                    titleImageUrl: String(selectedTitleImageUrl || '').trim(),
                }
                : {
                    titleImageUrl: String(selectedTitleImageUrl || '').trim(),
                    avatarFrameUrl: String(selectedAvatarFrameUrl || '').trim(),
                }

            const response = await api.updateProfileCosmetics(payload)
            if (response?.user) {
                const token = localStorage.getItem('token')
                login(response.user, token)
            }

            await loadData()
            setShowCosmeticModal(false)
        } catch (err) {
            setCosmeticError(err.message || 'Không thể cập nhật danh hiệu/khung avatar')
        } finally {
            setCosmeticSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-slate-400 font-bold animate-pulse">Đang tải hồ sơ...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="max-w-md mx-auto mt-8 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                <p>Lỗi: {error}</p>
                <button
                    onClick={loadData}
                    className="mt-2 px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                    Thử lại
                </button>
            </div>
        )
    }

    const { user, playerState } = profile || {}
    const username = user?.username || 'Huấn Luyện Viên'
    const joinDate = formatDate(user?.createdAt)
    const lastActive = formatDate(user?.lastActive, true)
    const coins = playerState?.platinumCoins ?? 0
    const moonPoints = playerState?.moonPoints || 0
    const level = playerState?.level || 1
    const exp = playerState?.experience || 0
    const stamina = playerState?.stamina || 0
    const maxStamina = playerState?.maxStamina || 100
    const hp = playerState?.hp || 0
    const maxHp = playerState?.maxHp || 100
    const wins = playerState?.wins || 0
    const losses = playerState?.losses || 0
    const totalBattles = wins + losses
    const winRate = totalBattles > 0 ? `${Math.round((wins / totalBattles) * 100)}%` : '0%'
    const avatarSrc = String(user?.avatar || '').trim() || DEFAULT_AVATAR
    const signature = String(user?.signature || '').trim()
    const equippedBadges = Array.isArray(profile?.badges?.equippedBadges) ? profile.badges.equippedBadges : []
    const activeBadgeBonuses = profile?.badges?.activeBonuses || {}
    const profileTabs = [
        { label: 'Cá Nhân', to: '/profile', enabled: true },
        { label: 'Đội Hình', to: '/party', enabled: true },
        { label: 'Kho Pokémon', to: '/box', enabled: true },
        { label: 'Túi Đồ', to: '/inventory', enabled: true },
        { label: 'Pokédex', to: '/pokedex', enabled: true },
        { label: 'Xếp Hạng', to: '/rankings/overall', enabled: true },
        { label: 'Hầm Mỏ', to: '', enabled: false },
        { label: 'Huy Hiệu', to: '/badges', enabled: true },
    ]
    const quickActions = [
        { label: 'Chỉnh Sửa', to: '/profile/edit' },
        { label: 'Kho Pokémon', to: '/box' },
        { label: 'Đội Hình', to: '/party' },
        { label: 'Túi Đồ', to: '/inventory' },
        { label: 'Pokédex', to: '/pokedex' },
        { label: 'Huy Hiệu', to: '/badges' },
        { label: 'Mua Pokémon', to: '/shop/buy' },
        { label: 'Bán Pokémon', to: '/shop/sell' },
    ]
    return (
        <div className="max-w-4xl mx-auto font-sans pb-12">
            <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-slate-800 mb-2 drop-shadow-sm tracking-tight">{username}</h1>
                <div className="flex justify-center gap-6 text-sm font-bold text-slate-500">
                    <div className="flex items-center gap-1 text-slate-700 drop-shadow-sm">
                        <span>🪙 {coins.toLocaleString()} Xu Bạch Kim</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-600">
                        <span>🌑 {moonPoints.toLocaleString()} Điểm Nguyệt Các</span>
                    </div>
                </div>
            </div>
            <div className="rounded-t-lg overflow-hidden border border-blue-500 shadow-lg bg-slate-800">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold py-1 px-4 text-center border-b border-blue-600">
                    Menu Hồ Sơ
                </div>
                <div className="bg-blue-50 border-b border-blue-300 p-2 flex flex-wrap justify-center gap-1 text-xs font-bold text-blue-700">
                    {profileTabs.map((tab) => (
                        tab.enabled ? (
                            <Link key={tab.label} to={tab.to} className="hover:text-amber-600 hover:underline px-2 transition-colors">
                                [ {tab.label} ]
                            </Link>
                        ) : (
                            <span key={tab.label} className="px-2 text-slate-400 cursor-not-allowed" title="Tính năng sẽ được bổ sung sau">
                                [ {tab.label} ]
                            </span>
                        )
                    ))}
                </div>
                <div className="bg-white p-2 sm:p-4 space-y-6">
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title={`Hồ sơ của ${username}`} />
                        <div className="bg-blue-50/50 p-4 text-center">
                            <div className="max-w-2xl mx-auto">
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-4 shadow-sm">
                                    Ảnh Đại Diện
                                </div>
                                <div className="mx-auto w-32 h-32 mb-6 flex items-center justify-center">
                                    <VipAvatar
                                        userLike={user}
                                        avatar={avatarSrc}
                                        fallback={DEFAULT_AVATAR}
                                        alt="Trainer Avatar"
                                        wrapperClassName="w-full h-full"
                                        imageClassName="h-full w-full object-contain pixelated drop-shadow-md"
                                        frameClassName="h-full w-full object-cover rounded-full"
                                        loading="eager"
                                    />
                                </div>
                                <div className="mb-4 flex flex-col items-center gap-1">
                                    <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Danh hiệu VIP</div>
                                    <VipTitleBadge userLike={user} fallback="dash" />
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Hành Động
                                </div>
                                <div className="flex flex-wrap justify-center gap-2 text-xs font-bold text-blue-700 mb-6 px-4">
                                    {quickActions.map((action) => (
                                        <Link key={action.label} to={action.to} className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800">
                                            [ {action.label} ]
                                        </Link>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => handleOpenCosmeticModal('general')}
                                        className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800"
                                    >
                                        [ Chỉnh sửa chung ]
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleOpenCosmeticModal('title')}
                                        className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800"
                                    >
                                        [ Chỉnh sửa danh hiệu ]
                                    </button>
                                    <button onClick={handleRefresh} className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800">
                                        [ Làm Mới Hồ Sơ ]
                                        {refreshing && <span className="ml-1 animate-spin inline-block">↻</span>}
                                    </button>
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Trạng Thái
                                </div>
                                <div className="py-2 text-sm text-slate-700">
                                    <span className="font-bold text-slate-900">{username}</span> hiện đang{' '}
                                    <span className={`font-bold ${user?.isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                                        {user?.isOnline ? 'Trực Tuyến' : 'Ngoại Tuyến'}
                                    </span>.
                                </div>
                                <div className="text-xs text-slate-500 pb-2">
                                    Hoạt động gần nhất: {lastActive}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Huy Hiệu" />
                        <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-slate-600">
                            Tối đa 5 huy hiệu. Chỉ huy hiệu đang mặc mới kích hoạt chỉ số.
                        </div>
                        <div className="bg-white p-4 space-y-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                                {Array.from({ length: 5 }, (_, index) => equippedBadges[index] || null).map((badge, index) => (
                                    <Link
                                        key={badge?._id || `badge-slot-${index}`}
                                        to="/badges"
                                        className={`rounded border p-3 text-center transition-colors ${badge ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                                    >
                                        <div className="h-16 flex items-center justify-center overflow-hidden rounded border border-slate-200 bg-white mb-2">
                                            {badge?.imageUrl ? (
                                                <img src={badge.imageUrl} alt={badge.name} className="max-h-full max-w-full object-contain" />
                                            ) : (
                                                <span className="text-xs font-bold text-slate-300">{index + 1}</span>
                                            )}
                                        </div>
                                        <div className={`text-xs font-bold ${badge ? 'text-blue-800' : 'text-slate-400'}`}>
                                            {badge?.name || 'Trống'}
                                        </div>
                                        {badge ? (
                                            <div className="mt-1">
                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${getBadgeRankClasses(badge.rank)}`}>
                                                    {badge.rank || 'D'}
                                                </span>
                                            </div>
                                        ) : null}
                                    </Link>
                                ))}
                            </div>
                            <div className="rounded border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-blue-800 text-center">
                                {formatBadgeBonuses(activeBadgeBonuses)}
                            </div>
                        </div>
                    </div>
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Đội Hình" />
                        <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-3 py-2">
                            <div className="text-xs font-medium text-slate-500">
                                {showParty ? 'Đội hình đang hiển thị công khai trên trang hồ sơ này.' : 'Đội hình đang được thu gọn.'}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowParty((prev) => !prev)}
                                className="shrink-0 rounded border border-blue-300 bg-white px-3 py-1 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-100"
                            >
                                {showParty ? '[ Ẩn Đội Hình ]' : '[ Hiện Đội Hình ]'}
                            </button>
                        </div>
                        {showParty ? (
                            <div className="bg-slate-100 min-h-[160px] flex items-stretch divide-x divide-blue-200 border-b border-blue-200 overflow-x-auto">
                                {party.map((p, i) => {
                                    if (!p) {
                                        return (
                                            <div key={i} className="min-w-[16.66%] flex-1 flex flex-col items-center justify-center gap-2 p-3 bg-slate-50">
                                                <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-lg font-bold">
                                                    {i + 1}
                                                </div>
                                                <span className="text-[10px] text-slate-400 font-medium">Trống</span>
                                            </div>
                                        )
                                    }
                                    const species = p.pokemonId || {}
                                    const { formId, formName } = resolvePokemonForm(species, p.formId)
                                    const sprite = resolvePokemonSprite({
                                        species,
                                        formId,
                                        isShiny: Boolean(p.isShiny),
                                        fallback: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
                                    })
                                    const name = p.nickname || species.name || 'Unknown'

                                    return (
                                        <Link
                                            to={`/pokemon/${p._id}`}
                                            key={p._id}
                                            className="min-w-[16.66%] flex-1 flex flex-col items-center justify-between py-3 px-2 bg-white hover:bg-blue-50 transition-colors group border-t-2 border-t-transparent hover:border-t-blue-400"
                                        >
                                            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate max-w-full text-center">
                                                {species.name || '???'}
                                            </span>
                                            {p.nickname && p.nickname !== species.name ? (
                                                <span className="font-bold text-blue-900 text-xs truncate max-w-[80px] text-center group-hover:text-blue-600 transition-colors">
                                                    {p.nickname}
                                                </span>
                                            ) : (
                                                <span className="invisible text-xs">-</span>
                                            )}
                                            <div className="relative w-20 h-20 flex items-center justify-center my-1">
                                                <SmartImage
                                                    src={sprite || '/placeholder.png'}
                                                    alt={name}
                                                    width={80}
                                                    height={80}
                                                    className="max-w-full max-h-full pixelated rendering-pixelated group-hover:scale-110 transition-transform duration-200 drop-shadow-md"
                                                    fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                                                />
                                                {p.isShiny && (
                                                    <span className="absolute -top-1 -right-1 text-amber-400 text-sm drop-shadow-sm">★</span>
                                                )}
                                            </div>
                                            <span className="text-xs text-amber-600 font-bold">Lv. {p.level}</span>
                                            {formId !== 'normal' && (
                                                <span className="text-[9px] bg-sky-100 text-sky-700 font-bold px-1.5 py-0.5 rounded-full border border-sky-200">
                                                    {formName}
                                                </span>
                                            )}
                                        </Link>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="border-b border-blue-200 bg-slate-50 px-4 py-8 text-center text-sm italic text-slate-500">
                                Nhấn "Hiện Đội Hình" để xem lại đội hình hiện tại.
                            </div>
                        )}
                    </div>
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Thông Tin Người Chơi" />
                        <div className="bg-white">
                            <InfoRow label="ID Người Chơi" value={`#${user?.id ? user.id.slice(-7).toUpperCase() : '???'}`} isOdd={false} />
                            <InfoRow label="Tên Nhân Vật" value={username} isOdd={true} />
                            <InfoRow label="Nhóm" value={getPublicRoleLabel(user)} isOdd={false} />
                            <InfoRow label="Danh hiệu VIP" value={<VipTitleBadge userLike={user} fallback="dash" />} isOdd={true} />
                            <InfoRow label="Cấp Người Chơi" value={`Lv. ${level}`} isOdd={false} />
                            <InfoRow label="Kinh Nghiệm" value={`${exp.toLocaleString()} EXP (Thiếu ${expToNext(level).toLocaleString()} EXP để lên cấp)`} isOdd={true} />
                            <InfoRow label="HP" value={`${hp}/${maxHp} HP`} isOdd={false} />
                            <InfoRow label="Thể Lực" value={`${stamina}/${maxStamina} AP`} isOdd={true} />
                            <InfoRow label="Xu Bạch Kim" value={`${coins.toLocaleString()} Xu`} isOdd={false} />
                            <InfoRow label="Điểm Nguyệt Các" value={`${moonPoints.toLocaleString()} Điểm`} isOdd={true} />
                            <InfoRow label="Trận Đấu" value={`${wins} thắng - ${losses} thua`} isOdd={false} />
                            <InfoRow label="Tỷ Lệ Thắng" value={winRate} isOdd={true} />
                            <InfoRow label="Ngày Đăng Ký" value={joinDate} isOdd={false} />
                            <InfoRow label="Hoạt Động Gần Nhất" value={lastActive} isOdd={true} />
                            <InfoRow label="Phiên Bản" value="Beta 1.0" isOdd={false} />
                        </div>
                        <div className="bg-white border-t border-blue-200">
                            <SectionHeader title="Chữ Ký" />
                            <div className={`p-4 text-center text-sm ${signature ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                                {signature || 'Chưa có chữ ký'}
                            </div>
                        </div>
                    </div>

                    {showCosmeticModal && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
                            onClick={() => {
                                if (!cosmeticSaving) setShowCosmeticModal(false)
                            }}
                        >
                            <div
                                className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-4 shadow-2xl max-h-[90vh] overflow-y-auto"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
                                    <h3 className="text-base font-bold text-slate-800">
                                        {cosmeticModalMode === 'title' ? 'Chỉnh sửa danh hiệu' : 'Chỉnh sửa danh hiệu & khung avatar'}
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setShowCosmeticModal(false)}
                                        disabled={cosmeticSaving}
                                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 disabled:opacity-50"
                                    >
                                        Đóng
                                    </button>
                                </div>

                                {cosmeticError && (
                                    <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                                        {cosmeticError}
                                    </div>
                                )}

                                {cosmeticLoading ? (
                                    <div className="py-6 text-center text-sm font-semibold text-slate-500">Đang tải danh sách ảnh...</div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="rounded border border-blue-200 bg-blue-50/40 p-3">
                                            <div className="mb-2 text-xs font-bold uppercase text-blue-900">Danh hiệu</div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedTitleImageUrl('')}
                                                    className={`rounded border px-2 py-2 text-left text-xs font-bold ${!selectedTitleImageUrl
                                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                                                >
                                                    Dùng mặc định hệ thống/VIP
                                                </button>
                                                {ownedTitleImages.map((entry) => {
                                                    const imageUrl = String(entry?.imageUrl || '').trim()
                                                    if (!imageUrl) return null
                                                    const isSelected = imageUrl === selectedTitleImageUrl
                                                    return (
                                                        <button
                                                            key={`title-${imageUrl}`}
                                                            type="button"
                                                            onClick={() => setSelectedTitleImageUrl(imageUrl)}
                                                            className={`rounded border p-2 text-left ${isSelected
                                                                ? 'border-emerald-300 bg-emerald-50'
                                                                : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                                                        >
                                                            <div className="h-12 w-full flex items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                                                                <img src={imageUrl} alt="Danh hiệu" className="max-h-full max-w-full object-contain" />
                                                            </div>
                                                            <div className="mt-1 text-[10px] text-slate-500">
                                                                {entry?.weekStart ? `Tuần ${entry.weekStart}` : 'Từ thưởng top tuần'}
                                                            </div>
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>

                                        {cosmeticModalMode !== 'title' && (
                                            <div className="rounded border border-cyan-200 bg-cyan-50/30 p-3">
                                                <div className="mb-2 text-xs font-bold uppercase text-cyan-900">Khung avatar</div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedAvatarFrameUrl('')}
                                                        className={`rounded border px-2 py-2 text-left text-xs font-bold ${!selectedAvatarFrameUrl
                                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                                                    >
                                                        Dùng mặc định hệ thống/VIP
                                                    </button>
                                                    {ownedAvatarFrames.map((entry) => {
                                                        const imageUrl = String(entry?.imageUrl || '').trim()
                                                        if (!imageUrl) return null
                                                        const isSelected = imageUrl === selectedAvatarFrameUrl
                                                        return (
                                                            <button
                                                                key={`frame-${imageUrl}`}
                                                                type="button"
                                                                onClick={() => setSelectedAvatarFrameUrl(imageUrl)}
                                                                className={`rounded border p-2 text-left ${isSelected
                                                                    ? 'border-emerald-300 bg-emerald-50'
                                                                    : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                                                            >
                                                                <div className="h-12 w-full flex items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                                                                    <img src={imageUrl} alt="Khung avatar" className="max-h-full max-w-full object-contain" />
                                                                </div>
                                                                <div className="mt-1 text-[10px] text-slate-500">
                                                                    {entry?.weekStart ? `Tuần ${entry.weekStart}` : 'Từ thưởng top tuần'}
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowCosmeticModal(false)}
                                                disabled={cosmeticSaving}
                                                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                                            >
                                                Hủy
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSaveCosmetics}
                                                disabled={cosmeticSaving}
                                                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {cosmeticSaving ? 'Đang lưu...' : 'Lưu lựa chọn'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}

const expToNext = (level) => 250 + Math.max(0, level - 1) * 100
