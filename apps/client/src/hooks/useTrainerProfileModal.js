import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { friendsApi } from '../services/friendsApi'

const PARTY_SLOT_TOTAL = 6
const ALLOWED_RETURN_PATHS = new Set([
    '/friends',
    '/stats/online',
    '/rankings/pokemon',
    '/rankings/overall',
    '/rankings/daily',
])

const normalizeUserId = (value = '') => String(value || '').trim()

const resolveSafeReturnPath = (value, fallback = '/friends') => {
    const raw = String(value || '').trim()
    const normalized = raw ? `/${raw.replace(/^\/+/, '')}` : ''
    if (normalized && ALLOWED_RETURN_PATHS.has(normalized)) return normalized
    return ALLOWED_RETURN_PATHS.has(fallback) ? fallback : '/friends'
}

const buildSeedTrainer = (userLike = {}) => {
    const userId = normalizeUserId(userLike?.userId || userLike?._id)
    return {
        userId,
        userIdLabel: userId ? `#${userId.slice(-7).toUpperCase()}` : '???',
        username: String(userLike?.username || '').trim() || 'Huấn Luyện Viên',
        avatar: String(userLike?.avatar || '').trim(),
        signature: String(userLike?.signature || '').trim(),
        role: String(userLike?.role || 'user').trim() || 'user',
        vipTierLevel: Math.max(0, Number.parseInt(userLike?.vipTierLevel, 10) || 0),
        vipTierCode: String(userLike?.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: {
            title: String(userLike?.vipBenefits?.title || '').trim().slice(0, 80),
            titleImageUrl: String(userLike?.vipBenefits?.titleImageUrl || '').trim(),
            avatarFrameUrl: String(userLike?.vipBenefits?.avatarFrameUrl || '').trim(),
        },
        isOnline: Boolean(userLike?.isOnline),
        createdAt: userLike?.createdAt || null,
        lastActive: userLike?.lastActive || null,
        playTime: String(userLike?.playTime || '').trim(),
        showPartyInProfile: userLike?.showPartyInProfile !== false,
        canViewParty: true,
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
        party: Array.from({ length: PARTY_SLOT_TOTAL }, () => null),
    }
}

export function useTrainerProfileModal({ defaultReturnTo = '/friends' } = {}) {
    const navigate = useNavigate()
    const { user: currentUser } = useAuth()
    const profileRequestRef = useRef(0)

    const [isOpen, setIsOpen] = useState(false)
    const [trainer, setTrainer] = useState(null)
    const [returnPath, setReturnPath] = useState(resolveSafeReturnPath(defaultReturnTo))
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [detailError, setDetailError] = useState('')
    const [notice, setNotice] = useState('')
    const [sendingFriendRequest, setSendingFriendRequest] = useState(false)

    const selectedUserId = normalizeUserId(trainer?.userId)
    const isSelfTrainer = Boolean(
        selectedUserId && normalizeUserId(currentUser?.id || currentUser?._id) && selectedUserId === normalizeUserId(currentUser?.id || currentUser?._id)
    )
    const hasChallengeParty = useMemo(() => {
        const party = Array.isArray(trainer?.party) ? trainer.party : []
        return party.some((slot) => Boolean(slot?._id))
    }, [trainer])
    const canViewParty = trainer?.canViewParty !== false

    const closeTrainerProfile = useCallback(() => {
        profileRequestRef.current = 0
        setIsOpen(false)
        setTrainer(null)
        setLoadingDetail(false)
        setDetailError('')
        setNotice('')
        setSendingFriendRequest(false)
    }, [])

    const openTrainerProfile = useCallback(async (userLike = {}, options = {}) => {
        const userId = normalizeUserId(userLike?.userId || userLike?._id)
        if (!userId) return

        const seed = buildSeedTrainer(userLike)
        const safeReturnTo = resolveSafeReturnPath(options?.returnTo, resolveSafeReturnPath(defaultReturnTo))
        setReturnPath(safeReturnTo)
        setTrainer(seed)
        setIsOpen(true)
        setDetailError('')
        setNotice('')

        const requestId = Date.now()
        profileRequestRef.current = requestId
        setLoadingDetail(true)

        try {
            const data = await friendsApi.getTrainerProfile(userId)
            if (profileRequestRef.current !== requestId) return
            if (data?.trainer) {
                setTrainer({
                    ...seed,
                    ...data.trainer,
                    userId: normalizeUserId(data?.trainer?.userId || seed.userId),
                })
            }
        } catch (error) {
            if (profileRequestRef.current !== requestId) return
            setDetailError(error?.message || 'Không thể tải hồ sơ người chơi')
        } finally {
            if (profileRequestRef.current === requestId) {
                setLoadingDetail(false)
            }
        }
    }, [defaultReturnTo])

    const sendFriendRequestFromModal = useCallback(async () => {
        const userId = normalizeUserId(trainer?.userId)
        if (!userId) return

        if (isSelfTrainer) {
            setNotice('Bạn không thể tự gửi lời mời kết bạn cho chính mình.')
            return
        }

        try {
            setSendingFriendRequest(true)
            const data = await friendsApi.sendRequest(userId)
            setNotice(data?.message || 'Đã gửi lời mời kết bạn')
        } catch (error) {
            setNotice(error?.message || 'Không thể gửi lời mời kết bạn')
        } finally {
            setSendingFriendRequest(false)
        }
    }, [trainer, isSelfTrainer])

    const challengeFromModal = useCallback(() => {
        const userId = normalizeUserId(trainer?.userId)
        if (!userId) {
            setNotice('Không tìm thấy userId để khiêu chiến.')
            return
        }

        if (isSelfTrainer) {
            setNotice('Bạn không thể tự khiêu chiến chính mình.')
            return
        }

        if (!hasChallengeParty) {
            setNotice(`Huấn luyện viên ${trainer?.username || ''} chưa có Pokemon trong đội hình để khiêu chiến.`)
            return
        }

        const safeReturnPath = resolveSafeReturnPath(returnPath, '/friends')
        closeTrainerProfile()
        navigate(`/battle?challengeUserId=${encodeURIComponent(userId)}&returnTo=${encodeURIComponent(safeReturnPath)}`)
    }, [trainer, isSelfTrainer, hasChallengeParty, returnPath, closeTrainerProfile, navigate])

    return {
        openTrainerProfile,
        trainerModalProps: {
            isOpen,
            trainer,
            onClose: closeTrainerProfile,
            notice,
            detailError,
            loadingDetail,
            sendingFriendRequest,
            isSelfTrainer,
            hasChallengeParty,
            canViewParty,
            onSendFriendRequest: sendFriendRequestFromModal,
            onChallenge: challengeFromModal,
        },
    }
}
