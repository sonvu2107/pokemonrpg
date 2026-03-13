import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { friendsApi } from '../services/friendsApi'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import VipAvatar from '../components/VipAvatar'
import VipTitleBadge from '../components/VipTitleBadge'
import VipUsername from '../components/VipUsername'
import SmartImage from '../components/SmartImage'
import VipCaughtStar from '../components/VipCaughtStar'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'
import { getPublicRoleLabel } from '../utils/vip'
import { useProfileQuery } from '../hooks/queries/gameQueries'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const resolvePokemonCombatPower = (entry) => {
    const raw = Number(entry?.combatPower ?? entry?.power)
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw)
    const level = Math.max(1, Number(entry?.level || 1))
    return level * 10
}
const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const formatProfileDate = (value, withTime = false) => {
    if (!value) return 'Không rõ'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Không rõ'
    return date.toLocaleString('vi-VN', withTime
        ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'long', day: 'numeric' })
}

const formatWinRate = (wins, losses) => {
    const total = Number(wins || 0) + Number(losses || 0)
    if (total <= 0) return '0%'
    return `${((Number(wins || 0) / total) * 100).toFixed(1)}%`
}

const formatBadgeBonuses = (activeBonuses = {}) => {
    const parts = []
    if (Number(activeBonuses?.partyDamagePercent || 0) > 0) parts.push(`+${activeBonuses.partyDamagePercent}% sát thương toàn đội`)
    if (Number(activeBonuses?.partySpeedPercent || 0) > 0) parts.push(`+${activeBonuses.partySpeedPercent}% tốc độ toàn đội`)
    if (Number(activeBonuses?.partyHpPercent || 0) > 0) parts.push(`+${activeBonuses.partyHpPercent}% máu toàn đội`)
    Object.entries(activeBonuses?.typeDamagePercentByType || {}).forEach(([type, percent]) => {
        if (Number(percent || 0) > 0) parts.push(`+${percent}% sát thương hệ ${String(type).toUpperCase()}`)
    })
    return parts.length > 0 ? parts.join(' | ') : 'Chưa kích hoạt bonus huy hiệu'
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

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

const ProfileSectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

const ProfileInfoRow = ({ label, value, isOdd }) => (
    <div className={`flex border-b border-blue-200 text-sm ${isOdd ? 'bg-blue-50/50' : 'bg-white'}`}>
        <div className="w-2/5 sm:w-1/3 p-2 bg-blue-100/50 font-semibold text-blue-900 border-r border-blue-200 flex items-center justify-end pr-3 sm:pr-4">
            {label}:
        </div>
        <div className="w-3/5 sm:w-2/3 p-2 text-slate-700 flex items-center font-medium break-words">
            {value}
        </div>
    </div>
)

const expToNext = (level) => 250 + Math.max(0, Number(level || 1) - 1) * 100
const PARTY_SLOT_TOTAL = 6

export default function OnlineStatsPage() {
    const navigate = useNavigate()
    const { user: currentUser } = useAuth()
    const { data: profilePayload } = useProfileQuery()
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const [onlineCount, setOnlineCount] = useState(0)
    const [onlineTrainers, setOnlineTrainers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [featureNotice, setFeatureNotice] = useState('')
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1 })
    const [selectedTrainer, setSelectedTrainer] = useState(null)
    const [selectedTrainerLoading, setSelectedTrainerLoading] = useState(false)
    const [sendingFriendRequest, setSendingFriendRequest] = useState(false)
    const [showTrainerParty, setShowTrainerParty] = useState(true)
    const trainerDetailRequestRef = useRef(0)

    useEffect(() => {
        loadOnline(1)
    }, [])

    useEffect(() => {
        if (!profilePayload) return
        setWallet({
            platinumCoins: Number(profilePayload?.playerState?.platinumCoins ?? 0),
            moonPoints: Number(profilePayload?.playerState?.moonPoints || 0),
        })
    }, [profilePayload?.playerState?.platinumCoins, profilePayload?.playerState?.moonPoints])

    useEffect(() => {
        if (selectedTrainer) {
            setShowTrainerParty(true)
        }
    }, [selectedTrainer?.userId])

    const loadOnline = async (page = 1) => {
        try {
            setLoading(true)
            setError('')
            setFeatureNotice('')
            const data = await gameApi.getOnlineStats({ page, limit: 25 })
            setOnlineCount(Number(data?.onlineCount || 0))
            setOnlineTrainers(Array.isArray(data?.onlineTrainers) ? data.onlineTrainers : [])
            setPagination({
                page: Number(data?.pagination?.page || 1),
                totalPages: Number(data?.pagination?.totalPages || 1),
            })
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách online')
        } finally {
            setLoading(false)
        }
    }

    const closeTrainerModal = () => {
        trainerDetailRequestRef.current += 1
        setSelectedTrainerLoading(false)
        setSelectedTrainer(null)
    }

    const openTrainerModal = async (entry) => {
        const userId = String(entry?.userId || '').trim()
        if (!userId) return

        const requestId = trainerDetailRequestRef.current + 1
        trainerDetailRequestRef.current = requestId

        setSelectedTrainer({
            ...entry,
            profile: entry?.profile || null,
            party: entry?.party || [],
        })
        setSelectedTrainerLoading(true)

        try {
            const data = await gameApi.getOnlineChallengeTarget(userId)
            if (trainerDetailRequestRef.current !== requestId) return

            const detailTrainer = data?.trainer || null
            if (!detailTrainer) {
                throw new Error('Không thể tải hồ sơ huấn luyện viên này')
            }

            setSelectedTrainer((prev) => {
                if (!prev || String(prev?.userId || '') !== userId) return prev
                return {
                    ...prev,
                    ...detailTrainer,
                    userId: String(detailTrainer?.userId || userId),
                }
            })
        } catch (err) {
            if (trainerDetailRequestRef.current === requestId) {
                setFeatureNotice(err.message || 'Không thể tải dữ liệu huấn luyện viên online.')
            }
        } finally {
            if (trainerDetailRequestRef.current === requestId) {
                setSelectedTrainerLoading(false)
            }
        }
    }

    const selectedProfile = selectedTrainer?.profile || {
        level: 1,
        experience: 0,
        moonPoints: 0,
        wins: 0,
        losses: 0,
        platinumCoins: 0,
        hp: 100,
        maxHp: 100,
        stamina: 100,
        maxStamina: 100,
    }
    const selectedLevel = Math.max(1, Number(selectedProfile.level || 1))
    const selectedExp = Number(selectedProfile.experience || 0)
    const selectedWins = Number(selectedProfile.wins || 0)
    const selectedLosses = Number(selectedProfile.losses || 0)
    const selectedSignature = String(selectedTrainer?.signature || '').trim()
    const canViewParty = selectedTrainer?.canViewParty !== false
    const selectedParty = Array.isArray(selectedTrainer?.party)
        ? selectedTrainer.party.slice(0, PARTY_SLOT_TOTAL)
        : []
    const paddedSelectedParty = [...selectedParty]
    while (paddedSelectedParty.length < PARTY_SLOT_TOTAL) {
        paddedSelectedParty.push(null)
    }
    const hasChallengeParty = !selectedTrainerLoading && paddedSelectedParty.some((slot) => Boolean(slot?._id))
    const challengeUserId = String(selectedTrainer?.userId || '').trim()
    const isSelfTrainer = Boolean(
        selectedTrainer?.userId && currentUser?.id && String(selectedTrainer.userId) === String(currentUser.id)
    )
    const trainerProfileId = selectedTrainer?.userId
        ? `#${String(selectedTrainer.userId).slice(-7).toUpperCase()}`
        : (selectedTrainer?.userIdLabel || '???')
    const selectedTrainerEquippedBadges = Array.isArray(selectedTrainer?.badges?.equippedBadges)
        ? selectedTrainer.badges.equippedBadges
        : []
    const selectedTrainerBadgeBonuses = selectedTrainer?.badges?.activeBonuses || {}

    const handleChallengeFromOnline = () => {
        if (!selectedTrainer) return

        if (isSelfTrainer) {
            setFeatureNotice('Bạn không thể tự khiêu chiến chính mình.')
            return
        }

        if (!challengeUserId) {
            setFeatureNotice('Không tìm thấy userId để khiêu chiến online.')
            return
        }

        if (!hasChallengeParty) {
            setFeatureNotice(`Huấn luyện viên ${selectedTrainer.username || ''} chưa có Pokemon trong đội hình để khiêu chiến.`)
            return
        }

        closeTrainerModal()
        navigate(`/battle?challengeUserId=${encodeURIComponent(challengeUserId)}&returnTo=${encodeURIComponent('stats/online')}`)
    }

    const handleSendFriendRequest = async () => {
        if (!selectedTrainer) return

        if (isSelfTrainer) {
            setFeatureNotice('Bạn không thể tự gửi lời mời kết bạn cho chính mình.')
            return
        }

        if (!challengeUserId) {
            setFeatureNotice('Không tìm thấy userId để kết bạn.')
            return
        }

        try {
            setSendingFriendRequest(true)
            const data = await friendsApi.sendRequest(challengeUserId)
            setFeatureNotice(data?.message || `Đã gửi lời mời kết bạn tới ${selectedTrainer.username || 'huấn luyện viên'}.`)
        } catch (err) {
            setFeatureNotice(err.message || 'Không thể gửi lời mời kết bạn.')
        } finally {
            setSendingFriendRequest(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12">
            <div className="text-center mb-5">
                <h1 className="text-3xl font-bold text-blue-900">Huấn luyện viên trực tuyến</h1>
                <div className="mt-2 text-sm text-slate-700 font-medium">
                    Hiện đang có <span className="font-bold text-blue-900">{formatNumber(onlineCount)}</span> huấn luyện viên online.
                </div>
            </div>

            {error && (
                <div className="mb-4 border border-red-300 bg-red-50 text-red-700 px-4 py-3 font-bold">
                    {error}
                </div>
            )}

            {featureNotice && (
                <div className="mb-4 border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 font-bold">
                    {featureNotice}
                </div>
            )}

            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <SectionHeader title="Danh sách đang online" />
                <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm font-bold text-slate-700 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                    <span>Xu Bạch Kim: <span className="text-blue-900">{formatNumber(wallet.platinumCoins)}</span></span>
                    <span>Điểm Nguyệt Các: <span className="text-blue-900">{formatNumber(wallet.moonPoints)}</span></span>
                </div>

                <div className="md:hidden">
                    {loading ? (
                        <div className="px-4 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách online...</div>
                    ) : onlineTrainers.length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-400 italic">Không có huấn luyện viên online</div>
                    ) : (
                        <div className="divide-y divide-blue-100">
                            {onlineTrainers.map((entry, index) => (
                                <div
                                    key={entry.userId || `${entry.rank}-${entry.username}`}
                                    className={`px-3 py-3 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs font-bold text-slate-600">{entry.userIdLabel}</span>
                                        <span className="text-xs text-slate-600">{entry.playTime}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 min-w-0 flex-nowrap">
                                        <button
                                            type="button"
                                            onClick={() => openTrainerModal(entry)}
                                            className="text-left text-sm font-bold text-indigo-800 hover:text-indigo-600 hover:underline truncate"
                                        >
                                            <VipUsername userLike={entry}>{entry.username}</VipUsername>
                                        </button>
                                        <VipTitleBadge userLike={entry} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="hidden md:block">
                    <table className="w-full text-sm table-fixed">
                        <thead>
                            <tr className="bg-blue-50 border-b border-blue-300">
                                <th className="px-3 py-3 text-center font-bold text-blue-900 w-24">Mã</th>
                                <th className="px-3 py-3 text-center font-bold text-blue-900">Người chơi</th>
                                <th className="px-3 py-3 text-center font-bold text-blue-900 w-40">Thời gian chơi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="3" className="px-3 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách online...</td>
                                </tr>
                            ) : onlineTrainers.length === 0 ? (
                                <tr>
                                    <td colSpan="3" className="px-3 py-8 text-center text-slate-400 italic">Không có huấn luyện viên online</td>
                                </tr>
                            ) : (
                                onlineTrainers.map((entry, index) => (
                                    <tr
                                        key={entry.userId || `${entry.rank}-${entry.username}`}
                                        className={`border-b border-blue-100 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}`}
                                    >
                                        <td className="px-3 py-3 text-center font-bold text-slate-800">{entry.userIdLabel}</td>
                                        <td className="px-3 py-3 text-center">
                                            <div className="flex items-center justify-center gap-2 min-w-0 flex-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => openTrainerModal(entry)}
                                                    className="font-bold text-indigo-800 hover:text-indigo-600 hover:underline truncate"
                                                >
                                                    <VipUsername userLike={entry}>{entry.username}</VipUsername>
                                                </button>
                                                <VipTitleBadge userLike={entry} />
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-center text-slate-700">{entry.playTime}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal
                isOpen={Boolean(selectedTrainer)}
                onClose={closeTrainerModal}
                title="Thông tin huấn luyện viên"
                maxWidth="md"
            >
                {selectedTrainer && (
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <ProfileSectionHeader title={<><span>Hồ sơ của </span><VipUsername userLike={selectedTrainer}>{selectedTrainer.username || 'Huấn Luyện Viên'}</VipUsername></>} />
                        <div className="bg-blue-50/50 p-4 text-center">
                            <div className="max-w-2xl mx-auto">
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-4 shadow-sm">
                                    Ảnh Đại Diện
                                </div>
                                <div className="mx-auto w-28 h-28 mb-4 flex items-center justify-center">
                                    <VipAvatar
                                        userLike={selectedTrainer}
                                        avatar={selectedTrainer.avatar}
                                        fallback={DEFAULT_AVATAR}
                                        alt={selectedTrainer.username || 'Huấn luyện viên'}
                                        wrapperClassName="w-full h-full"
                                        imageClassName="h-full w-full object-contain pixelated drop-shadow-md"
                                        frameClassName="h-full w-full object-cover rounded-full"
                                        loading="eager"
                                    />
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Hành Động
                                </div>
                                 <div className="flex justify-center gap-2 text-xs font-bold text-blue-700 mb-4 px-4">
                                    <button
                                        type="button"
                                        onClick={handleSendFriendRequest}
                                        disabled={!challengeUserId || isSelfTrainer || sendingFriendRequest || selectedTrainerLoading}
                                        className="px-3 py-1 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {sendingFriendRequest ? '[ Đang gửi... ]' : (selectedTrainerLoading ? '[ Đang tải... ]' : '[ Kết bạn ]')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleChallengeFromOnline}
                                        disabled={!challengeUserId || !hasChallengeParty || isSelfTrainer || selectedTrainerLoading}
                                        className="px-3 py-1 rounded border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {selectedTrainerLoading ? '[ Đang tải... ]' : '[ Khiêu Chiến ]'}
                                    </button>
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Trạng Thái
                                </div>
                                <div className="py-2 text-sm text-slate-700">
                                    <VipUsername userLike={selectedTrainer} className="font-bold text-slate-900">{selectedTrainer.username || 'Huấn Luyện Viên'}</VipUsername> hiện đang{' '}
                                    <span className={`font-bold ${selectedTrainer.isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                                        {selectedTrainer.isOnline ? 'Trực Tuyến' : 'Ngoại Tuyến'}
                                    </span>.
                                </div>
                                <div className="text-xs text-slate-500">
                                    Hoạt động gần nhất: {formatProfileDate(selectedTrainer.lastActive, true)}
                                </div>
                                {selectedTrainerLoading && (
                                    <div className="mt-2 text-xs font-bold text-blue-700 animate-pulse">
                                        Đang tải hồ sơ chi tiết và đội hình...
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Thông Tin Người Chơi" />
                            <div className="bg-white">
                                <ProfileInfoRow label="ID Người Chơi" value={trainerProfileId} isOdd={false} />
                                <ProfileInfoRow label="Tên Nhân Vật" value={<VipUsername userLike={selectedTrainer} className="font-semibold text-slate-900">{selectedTrainer.username || 'Huấn Luyện Viên'}</VipUsername>} isOdd={true} />
                                <ProfileInfoRow label="Nhóm" value={getPublicRoleLabel(selectedTrainer)} isOdd={false} />
                                <ProfileInfoRow label="Danh hiệu VIP" value={<VipTitleBadge userLike={selectedTrainer} fallback="dash" />} isOdd={true} />
                                <ProfileInfoRow label="Cấp Người Chơi" value={`Lv. ${formatNumber(selectedLevel)}`} isOdd={false} />
                                <ProfileInfoRow
                                    label="Kinh Nghiệm"
                                    value={`${formatNumber(selectedExp)} EXP (Thiếu ${formatNumber(expToNext(selectedLevel))} EXP để lên cấp)`}
                                    isOdd={true}
                                />
                                <ProfileInfoRow label="HP" value={`${formatNumber(selectedProfile.hp)}/${formatNumber(selectedProfile.maxHp)} HP`} isOdd={false} />
                                <ProfileInfoRow label="Thể Lực" value={`${formatNumber(selectedProfile.stamina)}/${formatNumber(selectedProfile.maxStamina)} AP`} isOdd={true} />
                                <ProfileInfoRow label="Xu Bạch Kim" value={`${formatNumber(selectedProfile.platinumCoins)} Xu`} isOdd={false} />
                                <ProfileInfoRow label="Điểm Nguyệt Các" value={`${formatNumber(selectedProfile.moonPoints)} Điểm`} isOdd={true} />
                                <ProfileInfoRow label="Trận Đấu" value={`${formatNumber(selectedWins)} thắng - ${formatNumber(selectedLosses)} thua`} isOdd={false} />
                                <ProfileInfoRow label="Tỷ Lệ Thắng" value={formatWinRate(selectedWins, selectedLosses)} isOdd={true} />
                                <ProfileInfoRow label="Thời Gian Chơi" value={selectedTrainer.playTime || 'Không rõ'} isOdd={false} />
                                <ProfileInfoRow label="Ngày Đăng Ký" value={formatProfileDate(selectedTrainer.createdAt)} isOdd={true} />
                                <ProfileInfoRow label="Hoạt Động Gần Nhất" value={formatProfileDate(selectedTrainer.lastActive, true)} isOdd={false} />
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Huy Hiệu" />
                            <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-slate-600">
                                Tối đa 5 huy hiệu. Chỉ huy hiệu đang mặc mới kích hoạt chỉ số.
                            </div>
                            <div className="bg-white p-4 space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                                    {Array.from({ length: 5 }, (_, index) => selectedTrainerEquippedBadges[index] || null).map((badge, index) => (
                                        <div
                                            key={badge?._id || `trainer-badge-slot-${index}`}
                                            className={`rounded border p-3 text-center ${badge ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50'}`}
                                        >
                                            <div className="h-16 flex items-center justify-center overflow-hidden rounded border border-slate-200 bg-white mb-2">
                                                {badge?.imageUrl ? (
                                                    <SmartImage
                                                        src={badge.imageUrl}
                                                        alt={badge.name}
                                                        width={64}
                                                        height={64}
                                                        className="max-h-full max-w-full object-contain"
                                                    />
                                                ) : (
                                                    <span className="text-xs font-bold text-slate-300">Slot {index + 1}</span>
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
                                        </div>
                                    ))}
                                </div>
                                <div className="rounded border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm font-bold text-blue-800 text-center">
                                    {formatBadgeBonuses(selectedTrainerBadgeBonuses)}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Đội Hình" />
                            {canViewParty ? (
                                <>
                                    <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-3 py-2">
                                        <div className="text-xs font-medium text-slate-500">
                                            {showTrainerParty ? 'Đội hình đang được hiển thị trong hồ sơ online.' : 'Đội hình hiện đang được thu gọn.'}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowTrainerParty((prev) => !prev)}
                                            className="shrink-0 rounded border border-blue-300 bg-white px-3 py-1 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-100"
                                        >
                                            {showTrainerParty ? '[ Ẩn Đội Hình ]' : '[ Hiện Đội Hình ]'}
                                        </button>
                                    </div>
                                    {showTrainerParty ? (
                                <div className="bg-slate-100 min-h-[160px] flex items-stretch divide-x divide-blue-200 border-b border-blue-200 overflow-x-auto">
                                    {paddedSelectedParty.map((p, i) => {
                                        if (!p) {
                                            return (
                                                <div key={`empty-${i}`} className="min-w-[16.66%] flex-1 flex flex-col items-center justify-center gap-2 p-3 bg-slate-50">
                                                    <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-lg font-bold">
                                                        {i + 1}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 font-medium">Trống</span>
                                                </div>
                                            )
                                        }

                                        const species = p.pokemonId || {}
                                        const { formId } = resolvePokemonForm(species, p.formId)
                                        const sprite = resolvePokemonSprite({
                                            species,
                                            formId,
                                            isShiny: Boolean(p.isShiny),
                                            fallback: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
                                        })
                                        const displayName = p.nickname || species.name || 'Unknown'
                                        const combatPower = resolvePokemonCombatPower(p)

                                        return (
                                            <Link
                                                to={`/pokemon/${p._id}`}
                                                key={p._id || `slot-${i}`}
                                                className="min-w-[16.66%] flex-1 flex flex-col items-center justify-between py-3 px-2 bg-white hover:bg-blue-50 transition-colors group border-t-2 border-t-transparent hover:border-t-blue-400"
                                            >
                                                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate max-w-full text-center">
                                                    {species.name || '???'}
                                                </span>
                                                {displayName && displayName !== species.name ? (
                                                    <span className="inline-flex max-w-[90px] items-center justify-center gap-1 text-xs font-bold text-center text-blue-900 transition-colors group-hover:text-blue-600">
                                                        <span className="truncate">{displayName}</span>
                                                        <VipCaughtStar level={p.obtainedVipMapLevel} className="text-[10px] shrink-0" />
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-blue-900">
                                                        <VipCaughtStar level={p.obtainedVipMapLevel} className="text-[10px]" />
                                                    </span>
                                                )}
                                                <div className="relative w-20 h-20 flex items-center justify-center my-1">
                                                    <SmartImage
                                                        src={sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'}
                                                        alt={displayName}
                                                        width={80}
                                                        height={80}
                                                        className="max-w-full max-h-full pixelated rendering-pixelated group-hover:scale-110 transition-transform duration-200 drop-shadow-md"
                                                        fallback="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"
                                                    />
                                                    {p.isShiny && (
                                                        <span className="absolute -top-1 -right-1 text-amber-400 text-sm drop-shadow-sm">★</span>
                                                    )}
                                                </div>
                                                <span className="text-xs text-amber-600 font-bold">Lv. {formatNumber(p.level)}</span>
                                                <span className="text-[11px] text-rose-600 font-bold">LC: {formatNumber(combatPower)}</span>
                                            </Link>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="border-b border-blue-200 bg-slate-50 px-4 py-8 text-center text-sm italic text-slate-500">
                                    Nhấn "Hiện Đội Hình" để xem lại đội hình của huấn luyện viên online này.
                                </div>
                                    )}
                                </>
                            ) : (
                                <div className="border-b border-blue-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                    Huấn luyện viên này đang ẩn đội hình với người chơi khác.
                                </div>
                            )}
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Chữ Ký" />
                            <div className={`p-4 text-center text-sm ${selectedSignature ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                                {selectedSignature || 'Chưa có chữ ký'}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {pagination.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
                    <button
                        onClick={() => loadOnline(Math.max(1, pagination.page - 1))}
                        disabled={pagination.page <= 1 || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Trước
                    </button>
                    <span className="text-slate-700">Trang {pagination.page}/{pagination.totalPages}</span>
                    <button
                        onClick={() => loadOnline(Math.min(pagination.totalPages, pagination.page + 1))}
                        disabled={pagination.page >= pagination.totalPages || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Sau
                    </button>
                </div>
            )}
        </div>
    )
}
