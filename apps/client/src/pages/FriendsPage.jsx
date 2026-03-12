import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import SmartImage from '../components/SmartImage'
import VipCaughtStar from '../components/VipCaughtStar'
import VipAvatar from '../components/VipAvatar'
import VipTitleBadge from '../components/VipTitleBadge'
import VipUsername from '../components/VipUsername'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { friendsApi } from '../services/friendsApi'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'
import { getPublicRoleLabel } from '../utils/vip'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const PARTY_SLOT_TOTAL = 6

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const resolvePokemonCombatPower = (entry) => {
    const raw = Number(entry?.combatPower ?? entry?.power)
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw)
    const level = Math.max(1, Number(entry?.level || 1))
    return level * 10
}

const formatDateTime = (value) => {
    if (!value) return 'Không rõ'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return 'Không rõ'
    return parsed.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

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

const expToNext = (level) => 250 + Math.max(0, Number(level || 1) - 1) * 100

const normalizeUserId = (value = '') => String(value || '').trim()

const PresenceBadge = ({ isOnline }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${isOnline ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        {isOnline ? 'Online' : 'Offline'}
    </span>
)

const EmptyBox = ({ message }) => (
    <div className="border border-dashed border-blue-200 rounded bg-blue-50/40 px-4 py-8 text-center text-sm text-slate-500">
        {message}
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

const toSeedTrainer = (userLike = {}) => ({
    userId: normalizeUserId(userLike?.userId),
    userIdLabel: normalizeUserId(userLike?.userId)
        ? `#${normalizeUserId(userLike?.userId).slice(-7).toUpperCase()}`
        : '???',
    username: String(userLike?.username || '').trim() || 'Huấn Luyện Viên',
    avatar: String(userLike?.avatar || '').trim(),
    signature: String(userLike?.signature || '').trim(),
    role: String(userLike?.role || 'user').trim() || 'user',
    vipBenefits: {
        title: String(userLike?.vipBenefits?.title || '').trim().slice(0, 80),
        titleImageUrl: String(userLike?.vipBenefits?.titleImageUrl || '').trim(),
        avatarFrameUrl: String(userLike?.vipBenefits?.avatarFrameUrl || '').trim(),
    },
    isOnline: Boolean(userLike?.isOnline),
    createdAt: userLike?.createdAt || null,
    lastActive: userLike?.lastActive || null,
    playTime: String(userLike?.playTime || '').trim(),
    profile: {
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
    },
    badges: {
        equippedBadges: [],
        activeBonuses: {},
        maxEquipped: 5,
    },
    party: Array.from({ length: PARTY_SLOT_TOTAL }, () => null),
})

export default function FriendsPage() {
    const navigate = useNavigate()
    const { user: currentUser } = useAuth()
    const { socket } = useChat()
    const profileRequestRef = useRef(0)

    const [activeTab, setActiveTab] = useState('friends')
    const [friends, setFriends] = useState([])
    const [incomingRequests, setIncomingRequests] = useState([])
    const [outgoingRequests, setOutgoingRequests] = useState([])
    const [suggestedUsers, setSuggestedUsers] = useState([])
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [loadingFriends, setLoadingFriends] = useState(true)
    const [loadingRequests, setLoadingRequests] = useState(true)
    const [loadingSuggestions, setLoadingSuggestions] = useState(true)
    const [searching, setSearching] = useState(false)
    const [actingKey, setActingKey] = useState('')
    const [notice, setNotice] = useState('')
    const [error, setError] = useState('')
    const [selectedTrainer, setSelectedTrainer] = useState(null)
    const [loadingTrainerDetail, setLoadingTrainerDetail] = useState(false)
    const [trainerDetailError, setTrainerDetailError] = useState('')
    const [showTrainerParty, setShowTrainerParty] = useState(true)

    const pendingTotal = useMemo(
        () => incomingRequests.length + outgoingRequests.length,
        [incomingRequests.length, outgoingRequests.length]
    )

    const friendUserIds = useMemo(
        () => new Set(friends.map((entry) => normalizeUserId(entry?.user?.userId)).filter(Boolean)),
        [friends]
    )
    const incomingUserIds = useMemo(
        () => new Set(incomingRequests.map((entry) => normalizeUserId(entry?.user?.userId)).filter(Boolean)),
        [incomingRequests]
    )
    const outgoingUserIds = useMemo(
        () => new Set(outgoingRequests.map((entry) => normalizeUserId(entry?.user?.userId)).filter(Boolean)),
        [outgoingRequests]
    )

    const loadFriends = useCallback(async () => {
        try {
            setLoadingFriends(true)
            const data = await friendsApi.getFriends()
            setFriends(Array.isArray(data?.friends) ? data.friends : [])
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách bạn bè')
        } finally {
            setLoadingFriends(false)
        }
    }, [])

    const loadRequests = useCallback(async () => {
        try {
            setLoadingRequests(true)
            const data = await friendsApi.getRequests()
            setIncomingRequests(Array.isArray(data?.incoming) ? data.incoming : [])
            setOutgoingRequests(Array.isArray(data?.outgoing) ? data.outgoing : [])
        } catch (err) {
            setError(err.message || 'Không thể tải lời mời kết bạn')
        } finally {
            setLoadingRequests(false)
        }
    }, [])

    const loadSuggestions = useCallback(async () => {
        try {
            setLoadingSuggestions(true)
            const data = await friendsApi.getSuggestions(8)
            setSuggestedUsers(Array.isArray(data?.users) ? data.users : [])
        } catch (err) {
            setError(err.message || 'Không thể tải đề xuất người chơi')
        } finally {
            setLoadingSuggestions(false)
        }
    }, [])

    useEffect(() => {
        loadFriends()
        loadRequests()
        loadSuggestions()
    }, [loadFriends, loadRequests, loadSuggestions])

    useEffect(() => {
        if (selectedTrainer) {
            setShowTrainerParty(true)
        }
    }, [selectedTrainer?.userId])

    const refreshAllFriendData = useCallback(() => {
        loadFriends()
        loadRequests()
        loadSuggestions()
    }, [loadFriends, loadRequests, loadSuggestions])

    useEffect(() => {
        if (!socket) return

        const handlePresenceChanged = (payload = {}) => {
            const userId = normalizeUserId(payload?.userId)
            if (!userId) return

            setFriends((prev) => prev.map((entry) => {
                if (normalizeUserId(entry?.user?.userId) !== userId) return entry
                return {
                    ...entry,
                    user: {
                        ...entry.user,
                        isOnline: Boolean(payload?.isOnline),
                        lastActive: payload?.lastActive || entry?.user?.lastActive || null,
                    },
                }
            }))

            setSuggestedUsers((prev) => prev.map((entry) => {
                if (normalizeUserId(entry?.userId) !== userId) return entry
                return {
                    ...entry,
                    isOnline: Boolean(payload?.isOnline),
                    lastActive: payload?.lastActive || entry?.lastActive || null,
                }
            }))

            setSearchResults((prev) => prev.map((entry) => {
                if (normalizeUserId(entry?.userId) !== userId) return entry
                return {
                    ...entry,
                    isOnline: Boolean(payload?.isOnline),
                    lastActive: payload?.lastActive || entry?.lastActive || null,
                }
            }))

            setSelectedTrainer((prev) => {
                if (!prev || normalizeUserId(prev?.userId) !== userId) return prev
                return {
                    ...prev,
                    isOnline: Boolean(payload?.isOnline),
                    lastActive: payload?.lastActive || prev?.lastActive || null,
                }
            })
        }

        socket.on('friends:presence_changed', handlePresenceChanged)
        socket.on('friends:request_received', refreshAllFriendData)
        socket.on('friends:request_accepted', refreshAllFriendData)
        socket.on('friends:request_rejected', refreshAllFriendData)
        socket.on('friends:request_cancelled', refreshAllFriendData)
        socket.on('friends:removed', refreshAllFriendData)

        return () => {
            socket.off('friends:presence_changed', handlePresenceChanged)
            socket.off('friends:request_received', refreshAllFriendData)
            socket.off('friends:request_accepted', refreshAllFriendData)
            socket.off('friends:request_rejected', refreshAllFriendData)
            socket.off('friends:request_cancelled', refreshAllFriendData)
            socket.off('friends:removed', refreshAllFriendData)
        }
    }, [socket, refreshAllFriendData])

    const openTrainerModal = async (userLike = {}) => {
        const userId = normalizeUserId(userLike?.userId)
        if (!userId) return

        const seed = toSeedTrainer(userLike)
        setSelectedTrainer(seed)
        setTrainerDetailError('')

        const requestId = Date.now()
        profileRequestRef.current = requestId
        setLoadingTrainerDetail(true)

        try {
            const data = await friendsApi.getTrainerProfile(userId)
            if (profileRequestRef.current !== requestId) return

            if (data?.trainer) {
                setSelectedTrainer({
                    ...seed,
                    ...data.trainer,
                    userId: normalizeUserId(data?.trainer?.userId || seed.userId),
                })
            }
        } catch (err) {
            if (profileRequestRef.current !== requestId) return
            setTrainerDetailError(err.message || 'Không thể tải hồ sơ người chơi')
        } finally {
            if (profileRequestRef.current === requestId) {
                setLoadingTrainerDetail(false)
            }
        }
    }

    const closeTrainerModal = () => {
        profileRequestRef.current = 0
        setSelectedTrainer(null)
        setLoadingTrainerDetail(false)
        setTrainerDetailError('')
    }

    const handleAcceptRequest = async (requestId) => {
        try {
            setActingKey(`accept-${requestId}`)
            setError('')
            setNotice('')
            const data = await friendsApi.acceptRequest(requestId)
            setNotice(data?.message || 'Đã chấp nhận lời mời kết bạn')
            refreshAllFriendData()
        } catch (err) {
            setError(err.message || 'Không thể chấp nhận lời mời kết bạn')
        } finally {
            setActingKey('')
        }
    }

    const handleRejectRequest = async (requestId) => {
        try {
            setActingKey(`reject-${requestId}`)
            setError('')
            setNotice('')
            const data = await friendsApi.rejectRequest(requestId)
            setNotice(data?.message || 'Đã từ chối lời mời kết bạn')
            refreshAllFriendData()
        } catch (err) {
            setError(err.message || 'Không thể từ chối lời mời kết bạn')
        } finally {
            setActingKey('')
        }
    }

    const handleCancelRequest = async (requestId) => {
        try {
            setActingKey(`cancel-${requestId}`)
            setError('')
            setNotice('')
            const data = await friendsApi.cancelRequest(requestId)
            setNotice(data?.message || 'Đã hủy lời mời kết bạn')
            refreshAllFriendData()
        } catch (err) {
            setError(err.message || 'Không thể hủy lời mời kết bạn')
        } finally {
            setActingKey('')
        }
    }

    const handleRemoveFriend = async (friendUserId) => {
        try {
            setActingKey(`remove-${friendUserId}`)
            setError('')
            setNotice('')
            const data = await friendsApi.removeFriend(friendUserId)
            setNotice(data?.message || 'Đã xóa bạn bè thành công')
            refreshAllFriendData()
        } catch (err) {
            setError(err.message || 'Không thể xóa bạn bè')
        } finally {
            setActingKey('')
        }
    }

    const handleSearch = async () => {
        try {
            const query = String(searchQuery || '').trim()
            if (query.length < 2) {
                setSearchResults([])
                setNotice('Nhập ít nhất 2 ký tự để tìm người chơi.')
                return
            }

            setSearching(true)
            setError('')
            setNotice('')
            const data = await friendsApi.searchUsers(query, 20)
            setSearchResults(Array.isArray(data?.users) ? data.users : [])
        } catch (err) {
            setError(err.message || 'Không thể tìm người chơi')
        } finally {
            setSearching(false)
        }
    }

    const handleSendRequest = async (targetUserId) => {
        const normalizedTargetUserId = normalizeUserId(targetUserId)
        if (!normalizedTargetUserId) return

        try {
            setActingKey(`send-${normalizedTargetUserId}`)
            setError('')
            setNotice('')
            const data = await friendsApi.sendRequest(normalizedTargetUserId)
            setNotice(data?.message || 'Đã gửi lời mời kết bạn')

            setSearchResults((prev) => prev.filter((entry) => normalizeUserId(entry?.userId) !== normalizedTargetUserId))
            setSuggestedUsers((prev) => prev.filter((entry) => normalizeUserId(entry?.userId) !== normalizedTargetUserId))
            loadRequests()
        } catch (err) {
            setError(err.message || 'Không thể gửi lời mời kết bạn')
        } finally {
            setActingKey('')
        }
    }

    const selectedProfile = selectedTrainer?.profile || {}
    const selectedLevel = Math.max(1, Number(selectedProfile.level || 1))
    const selectedExp = Number(selectedProfile.experience || 0)
    const selectedWins = Number(selectedProfile.wins || 0)
    const selectedLosses = Number(selectedProfile.losses || 0)
    const selectedSignature = String(selectedTrainer?.signature || '').trim()
    const selectedTrainerEquippedBadges = Array.isArray(selectedTrainer?.badges?.equippedBadges)
        ? selectedTrainer.badges.equippedBadges
        : []
    const selectedTrainerBadgeBonuses = selectedTrainer?.badges?.activeBonuses || {}
    const selectedUserId = normalizeUserId(selectedTrainer?.userId)
    const canViewParty = selectedTrainer?.canViewParty !== false
    const selectedParty = Array.isArray(selectedTrainer?.party)
        ? selectedTrainer.party.slice(0, PARTY_SLOT_TOTAL)
        : []
    const paddedSelectedParty = [...selectedParty]
    while (paddedSelectedParty.length < PARTY_SLOT_TOTAL) {
        paddedSelectedParty.push(null)
    }
    const hasChallengeParty = paddedSelectedParty.some((slot) => Boolean(slot?._id))
    const isSelfTrainer = Boolean(
        selectedUserId && normalizeUserId(currentUser?.id) && selectedUserId === normalizeUserId(currentUser?.id)
    )

    const selectedRelationship = useMemo(() => {
        if (!selectedUserId) return 'none'
        if (isSelfTrainer) return 'self'
        if (friendUserIds.has(selectedUserId)) return 'friend'
        if (incomingUserIds.has(selectedUserId)) return 'incoming'
        if (outgoingUserIds.has(selectedUserId)) return 'outgoing'
        return 'none'
    }, [selectedUserId, isSelfTrainer, friendUserIds, incomingUserIds, outgoingUserIds])

    const selectedIncomingRequest = useMemo(
        () => incomingRequests.find((entry) => normalizeUserId(entry?.user?.userId) === selectedUserId) || null,
        [incomingRequests, selectedUserId]
    )

    const selectedOutgoingRequest = useMemo(
        () => outgoingRequests.find((entry) => normalizeUserId(entry?.user?.userId) === selectedUserId) || null,
        [outgoingRequests, selectedUserId]
    )

    const handleChallengeFromModal = () => {
        if (!selectedTrainer) return

        if (isSelfTrainer) {
            setNotice('Bạn không thể tự khiêu chiến chính mình.')
            return
        }

        if (!selectedUserId) {
            setNotice('Không tìm thấy userId để khiêu chiến.')
            return
        }

        if (!hasChallengeParty) {
            setNotice(`Huấn luyện viên ${selectedTrainer.username || ''} chưa có Pokemon trong đội hình để khiêu chiến.`)
            return
        }

        closeTrainerModal()
        navigate(`/battle?challengeUserId=${encodeURIComponent(selectedUserId)}&returnTo=${encodeURIComponent('friends')}`)
    }

    const renderTrainerIdentity = (userLike = {}, className = '') => {
        const userId = normalizeUserId(userLike?.userId)

        return (
            <div className={`flex items-center gap-3 min-w-0 ${className}`}>
                <button
                    type="button"
                    onClick={() => openTrainerModal(userLike)}
                    className="w-16 h-16 rounded-full bg-blue-50 border border-blue-200 overflow-hidden shrink-0 hover:border-blue-400"
                    disabled={!userId}
                >
                    <VipAvatar
                        userLike={userLike}
                        avatar={userLike?.avatar}
                        fallback={DEFAULT_AVATAR}
                        alt={userLike?.username || 'Trainer'}
                        wrapperClassName="w-full h-full"
                        imageClassName="w-full h-full object-cover rounded-full pixelated"
                        frameClassName="w-full h-full object-cover rounded-full"
                    />
                </button>
                <button
                    type="button"
                    onClick={() => openTrainerModal(userLike)}
                    className="text-left min-w-0"
                    disabled={!userId}
                >
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <VipUsername userLike={userLike} className="text-xl font-bold text-slate-800 truncate hover:text-blue-700 hover:underline leading-none">
                            {userLike?.username || 'Huấn Luyện Viên'}
                        </VipUsername>
                        <VipTitleBadge userLike={userLike} />
                    </div>
                    <div className="mt-0.5">
                        <PresenceBadge isOnline={Boolean(userLike?.isOnline)} />
                    </div>
                </button>
            </div>
        )
    }

    const renderFriendsTab = () => {
        if (loadingFriends) {
            return <div className="px-4 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách bạn bè...</div>
        }

        if (friends.length === 0) {
            return <EmptyBox message="Bạn chưa có bạn bè nào. Hãy qua tab Đề xuất để gửi lời mời kết bạn." />
        }

        return (
            <div className="space-y-3">
                {friends.map((entry) => {
                    const user = entry?.user || {}
                    const userId = normalizeUserId(user?.userId)
                    const challengeUrl = `/battle?challengeUserId=${encodeURIComponent(userId)}&returnTo=${encodeURIComponent('friends')}`

                    return (
                        <div key={entry.friendshipId || userId} className="border border-blue-200 rounded bg-white px-3 py-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    {renderTrainerIdentity(user)}
                                    <div className="mt-1 text-[11px] text-slate-500">Hoạt động: {formatDateTime(user.lastActive)}</div>
                                </div>
                                <div className="text-[11px] text-slate-500">Bạn từ: {formatDateTime(entry.acceptedAt || entry.createdAt)}</div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                <Link
                                    to={challengeUrl}
                                    className="px-3 py-1 rounded border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 text-xs font-bold"
                                >
                                    Khiêu chiến
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveFriend(userId)}
                                    disabled={actingKey === `remove-${userId}`}
                                    className="px-3 py-1 rounded border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 text-xs font-bold disabled:opacity-60"
                                >
                                    {actingKey === `remove-${userId}` ? 'Đang xử lý...' : 'Hủy kết bạn'}
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    const renderRequestsTab = () => (
        <div className="space-y-4">
            <div className="border border-blue-200 rounded overflow-hidden bg-white shadow-sm">
                <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 text-sm font-bold text-blue-900">Lời mời nhận được ({incomingRequests.length})</div>
                <div className="p-3">
                    {loadingRequests ? (
                        <div className="text-sm text-slate-500 font-bold animate-pulse">Đang tải...</div>
                    ) : incomingRequests.length === 0 ? (
                        <EmptyBox message="Hiện chưa có lời mời mới." />
                    ) : (
                        <div className="space-y-2">
                            {incomingRequests.map((entry) => {
                                const requestId = String(entry?.requestId || '')
                                return (
                                    <div key={requestId} className="border border-slate-200 rounded px-3 py-2 bg-white">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                {renderTrainerIdentity(entry?.user || {})}
                                                <div className="mt-1 text-xs text-slate-500">Gửi lúc: {formatDateTime(entry.createdAt)}</div>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleAcceptRequest(requestId)}
                                                disabled={actingKey === `accept-${requestId}`}
                                                className="px-3 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold disabled:opacity-60"
                                            >
                                                {actingKey === `accept-${requestId}` ? 'Đang xử lý...' : 'Chấp nhận'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRejectRequest(requestId)}
                                                disabled={actingKey === `reject-${requestId}`}
                                                className="px-3 py-1 rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold disabled:opacity-60"
                                            >
                                                {actingKey === `reject-${requestId}` ? 'Đang xử lý...' : 'Từ chối'}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="border border-blue-200 rounded overflow-hidden bg-white shadow-sm">
                <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 text-sm font-bold text-blue-900">Lời mời đã gửi ({outgoingRequests.length})</div>
                <div className="p-3">
                    {loadingRequests ? (
                        <div className="text-sm text-slate-500 font-bold animate-pulse">Đang tải...</div>
                    ) : outgoingRequests.length === 0 ? (
                        <EmptyBox message="Bạn chưa gửi lời mời nào." />
                    ) : (
                        <div className="space-y-2">
                            {outgoingRequests.map((entry) => {
                                const requestId = String(entry?.requestId || '')
                                return (
                                    <div key={requestId} className="border border-slate-200 rounded px-3 py-2 bg-white">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                {renderTrainerIdentity(entry?.user || {})}
                                                <div className="mt-1 text-xs text-slate-500">Gửi lúc: {formatDateTime(entry.createdAt)}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleCancelRequest(requestId)}
                                                disabled={actingKey === `cancel-${requestId}`}
                                                className="px-3 py-1 rounded border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 text-xs font-bold disabled:opacity-60"
                                            >
                                                {actingKey === `cancel-${requestId}` ? 'Đang xử lý...' : 'Hủy lời mời'}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    const renderSuggestionsTab = () => (
        <div className="space-y-4">
            <div className="border border-blue-200 rounded overflow-hidden bg-white shadow-sm">
                <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 text-sm font-bold text-blue-900">Đề xuất cho bạn</div>
                <div className="p-3">
                    {loadingSuggestions ? (
                        <div className="text-sm text-slate-500 font-bold animate-pulse">Đang tải đề xuất...</div>
                    ) : suggestedUsers.length === 0 ? (
                        <EmptyBox message="Tạm thời chưa có đề xuất phù hợp." />
                    ) : (
                        <div className="space-y-2">
                            {suggestedUsers.map((entry) => {
                                const userId = normalizeUserId(entry?.userId)
                                return (
                                    <div key={userId} className="border border-slate-200 rounded bg-white px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                {renderTrainerIdentity(entry)}
                                                <div className="mt-1 text-xs text-slate-500">Hoạt động: {formatDateTime(entry?.lastActive)}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleSendRequest(userId)}
                                                disabled={actingKey === `send-${userId}`}
                                                className="px-3 py-1 rounded border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 text-xs font-bold disabled:opacity-60"
                                            >
                                                {actingKey === `send-${userId}` ? 'Đang gửi...' : 'Kết bạn'}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="border border-blue-200 rounded bg-white p-3 shadow-sm">
                <div className="text-sm font-bold text-blue-900 mb-2">Tìm người chơi theo tên</div>
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Ví dụ: Red, Satoshi..."
                        className="flex-1 border border-blue-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                        type="button"
                        onClick={handleSearch}
                        disabled={searching}
                        className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-60"
                    >
                        {searching ? 'Đang tìm...' : 'Tìm'}
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                {searchResults.length === 0 ? (
                    <EmptyBox message="Chưa có kết quả tìm kiếm." />
                ) : (
                    searchResults.map((entry) => {
                        const userId = normalizeUserId(entry?.userId)
                        return (
                            <div key={userId} className="border border-slate-200 rounded bg-white p-3 shadow-sm">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        {renderTrainerIdentity(entry)}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSendRequest(userId)}
                                        disabled={actingKey === `send-${userId}`}
                                        className="px-3 py-1 rounded border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 text-xs font-bold disabled:opacity-60"
                                    >
                                        {actingKey === `send-${userId}` ? 'Đang gửi...' : 'Kết bạn'}
                                    </button>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )

    return (
        <div className="max-w-5xl mx-auto pb-10">
            <div className="text-center mb-5">
                <h1 className="text-3xl font-bold text-blue-900">Bạn bè</h1>
                <div className="mt-1 text-sm text-slate-600 font-medium">
                    Quản lý danh sách bạn bè, lời mời và kết nối huấn luyện viên mới.
                </div>
            </div>

            {error && (
                <div className="mb-3 border border-red-300 bg-red-50 text-red-700 px-4 py-3 font-bold text-sm">
                    {error}
                </div>
            )}

            {notice && (
                <div className="mb-3 border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 font-bold text-sm">
                    {notice}
                </div>
            )}

            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700">
                    Kết nối huấn luyện viên
                </div>

                <div className="p-3 border-b border-blue-100 bg-blue-50/40 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('friends')}
                        className={`px-3 py-1.5 rounded text-xs font-bold border ${activeTab === 'friends' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-800 border-blue-300 hover:bg-blue-50'}`}
                    >
                        Danh sách ({friends.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('requests')}
                        className={`px-3 py-1.5 rounded text-xs font-bold border ${activeTab === 'requests' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-800 border-blue-300 hover:bg-blue-50'}`}
                    >
                        Lời mời ({pendingTotal})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('suggestions')}
                        className={`px-3 py-1.5 rounded text-xs font-bold border ${activeTab === 'suggestions' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-800 border-blue-300 hover:bg-blue-50'}`}
                    >
                        Đề xuất
                    </button>
                </div>

                <div className="p-3 md:p-4 bg-white">
                    {activeTab === 'friends' && renderFriendsTab()}
                    {activeTab === 'requests' && renderRequestsTab()}
                    {activeTab === 'suggestions' && renderSuggestionsTab()}
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
                                    Ảnh đại diện
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
                                    Hành động
                                </div>

                                <div className="flex justify-center gap-2 text-xs font-bold text-blue-700 mb-4 px-4 flex-wrap">
                                    {selectedRelationship === 'self' && (
                                        <span className="px-3 py-1 rounded border border-slate-300 bg-slate-100 text-slate-600">Bạn đang xem hồ sơ của chính mình</span>
                                    )}

                                    {selectedRelationship === 'none' && (
                                        <button
                                            type="button"
                                            onClick={() => handleSendRequest(selectedUserId)}
                                            disabled={!selectedUserId || actingKey === `send-${selectedUserId}`}
                                            className="px-3 py-1 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {actingKey === `send-${selectedUserId}` ? '[ Đang gửi... ]' : '[ Kết bạn ]'}
                                        </button>
                                    )}

                                    {selectedRelationship === 'incoming' && selectedIncomingRequest && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleAcceptRequest(selectedIncomingRequest.requestId)}
                                                disabled={actingKey === `accept-${selectedIncomingRequest.requestId}`}
                                                className="px-3 py-1 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                            >
                                                {actingKey === `accept-${selectedIncomingRequest.requestId}` ? '[ Đang xử lý... ]' : '[ Chấp nhận ]'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRejectRequest(selectedIncomingRequest.requestId)}
                                                disabled={actingKey === `reject-${selectedIncomingRequest.requestId}`}
                                                className="px-3 py-1 rounded border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                            >
                                                {actingKey === `reject-${selectedIncomingRequest.requestId}` ? '[ Đang xử lý... ]' : '[ Từ chối ]'}
                                            </button>
                                        </>
                                    )}

                                    {selectedRelationship === 'outgoing' && selectedOutgoingRequest && (
                                        <button
                                            type="button"
                                            onClick={() => handleCancelRequest(selectedOutgoingRequest.requestId)}
                                            disabled={actingKey === `cancel-${selectedOutgoingRequest.requestId}`}
                                            className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            {actingKey === `cancel-${selectedOutgoingRequest.requestId}` ? '[ Đang xử lý... ]' : '[ Hủy lời mời ]'}
                                        </button>
                                    )}

                                    {(selectedRelationship === 'friend' || selectedRelationship === 'none' || selectedRelationship === 'outgoing' || selectedRelationship === 'incoming') && (
                                        <button
                                            type="button"
                                            onClick={handleChallengeFromModal}
                                            disabled={!selectedUserId || !hasChallengeParty || isSelfTrainer}
                                            className="px-3 py-1 rounded border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            [ Khiêu chiến ]
                                        </button>
                                    )}
                                </div>

                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Trạng thái
                                </div>
                                <div className="py-2 text-sm text-slate-700">
                                    <VipUsername userLike={selectedTrainer} className="font-bold text-slate-900">{selectedTrainer.username || 'Huấn Luyện Viên'}</VipUsername> hiện đang{' '}
                                    <span className={`font-bold ${selectedTrainer.isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                                        {selectedTrainer.isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}
                                    </span>.
                                </div>
                                <div className="text-xs text-slate-500">
                                    Hoạt động gần nhất: {formatProfileDate(selectedTrainer.lastActive, true)}
                                </div>

                                {loadingTrainerDetail && (
                                    <div className="mt-3 text-xs font-bold text-blue-700 animate-pulse">Đang tải chi tiết hồ sơ...</div>
                                )}

                                {trainerDetailError && (
                                    <div className="mt-3 text-xs font-bold text-rose-700">{trainerDetailError}</div>
                                )}
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Thông tin người chơi" />
                            <div className="bg-white">
                                <ProfileInfoRow label="ID Người Chơi" value={selectedTrainer.userIdLabel || '???'} isOdd={false} />
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
                                            key={badge?._id || `friend-badge-slot-${index}`}
                                            className={`rounded border p-3 text-center ${badge ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50'}`}
                                        >
                                            <div className="h-16 flex items-center justify-center overflow-hidden rounded border border-slate-200 bg-white mb-2">
                                                {badge?.imageUrl ? (
                                                    <img src={badge.imageUrl} alt={badge.name} className="max-h-full max-w-full object-contain" />
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
                                            {showTrainerParty ? 'Đội hình đang được hiển thị trong hồ sơ bạn bè.' : 'Đội hình hiện đang được thu gọn.'}
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
                                                        <span className="absolute -top-1 -right-1 text-amber-400 text-sm drop-shadow-sm">*</span>
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
                                    Nhấn "Hiện Đội Hình" để xem lại đội hình của người chơi này.
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
        </div>
    )
}
