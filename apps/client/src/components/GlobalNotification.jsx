import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '../context/ChatContext'
import VipTitleBadge from './VipTitleBadge'
import VipUsername from './VipUsername'

const MARQUEE_DURATION_MS = 12000
const DEFAULT_ICON = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/master-ball.png'

const rarityThemeByKey = {
    'sss+': {
        label: 'SSS+',
        rarityClass: 'text-yellow-100',
        frameClass: 'border-yellow-200/90 bg-gradient-to-r from-amber-950/90 via-yellow-700/85 to-amber-950/90 shadow-[0_0_24px_rgba(250,204,21,0.55)]',
    },
    s: {
        label: 'S',
        rarityClass: 'text-amber-200',
        frameClass: 'border-amber-300/80 bg-gradient-to-r from-amber-900/85 via-orange-700/85 to-amber-900/85 shadow-[0_0_14px_rgba(251,191,36,0.45)]',
    },
    ss: {
        label: 'SS',
        rarityClass: 'text-rose-100',
        frameClass: 'border-rose-300/80 bg-gradient-to-r from-rose-900/85 via-red-700/85 to-rose-900/85 shadow-[0_0_18px_rgba(251,113,133,0.55)]',
    },
    sss: {
        label: 'SSS',
        rarityClass: 'text-cyan-100',
        frameClass: 'border-cyan-300/80 bg-gradient-to-r from-sky-900/85 via-cyan-700/85 to-sky-900/85 shadow-[0_0_20px_rgba(34,211,238,0.58)]',
    },
    default: {
        label: 'RARE',
        rarityClass: 'text-yellow-100',
        frameClass: 'border-yellow-200/80 bg-gradient-to-r from-slate-800/90 via-slate-700/90 to-slate-800/90 shadow-[0_0_14px_rgba(234,179,8,0.35)]',
    },
}

const normalizeNotificationPayload = (payload = {}) => {
    const message = String(payload?.message || '').trim()
    if (!message) return null

    const rarity = String(payload?.rarity || '').trim().toLowerCase()
    const providedId = String(payload?.notificationId || payload?.id || '').trim()
    return {
        id: providedId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message,
        rarity,
        imageUrl: String(payload?.imageUrl || '').trim(),
        username: String(payload?.username || '').trim(),
        pokemonName: String(payload?.pokemonName || '').trim(),
        rarityLabel: String(payload?.rarityLabel || '').trim(),
        isVip: Boolean(payload?.isVip),
        vipTitle: String(payload?.vipTitle || '').trim(),
        vipTitleImageUrl: String(payload?.vipTitleImageUrl || '').trim(),
        usernameColor: String(payload?.usernameColor || '').trim(),
        usernameGradientColor: String(payload?.usernameGradientColor || '').trim(),
        usernameEffectColors: Array.isArray(payload?.usernameEffectColors) ? payload.usernameEffectColors : [],
        usernameEffect: String(payload?.usernameEffect || '').trim(),
    }
}

export default function GlobalNotification() {
    const { socket } = useChat()
    const [notificationQueue, setNotificationQueue] = useState([])
    const [activeNotification, setActiveNotification] = useState(null)
    const seenNotificationIdsRef = useRef(new Set())

    const enqueueNotification = (payload) => {
        const normalized = normalizeNotificationPayload(payload)
        if (!normalized) return
        if (seenNotificationIdsRef.current.has(normalized.id)) return
        if (seenNotificationIdsRef.current.size > 500) {
            seenNotificationIdsRef.current.clear()
        }
        seenNotificationIdsRef.current.add(normalized.id)
        setNotificationQueue((prev) => [...prev, normalized])
    }

    useEffect(() => {
        if (socket) return
        setNotificationQueue([])
        setActiveNotification(null)
        seenNotificationIdsRef.current.clear()
    }, [socket])

    useEffect(() => {
        if (!socket) {
            return undefined
        }

        const handleGlobalNotification = (payload) => {
            enqueueNotification(payload)
        }

        socket.on('globalNotification', handleGlobalNotification)

        return () => {
            socket.off('globalNotification', handleGlobalNotification)
        }
    }, [socket])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const handleLocalGlobalNotification = (event) => {
            enqueueNotification(event?.detail)
        }

        window.addEventListener('globalNotification:local', handleLocalGlobalNotification)
        return () => {
            window.removeEventListener('globalNotification:local', handleLocalGlobalNotification)
        }
    }, [])

    useEffect(() => {
        if (activeNotification || notificationQueue.length === 0) return

        setActiveNotification(notificationQueue[0])
        setNotificationQueue((prev) => prev.slice(1))
    }, [activeNotification, notificationQueue])

    useEffect(() => {
        if (!activeNotification) return undefined

        const timeoutId = setTimeout(() => {
            setActiveNotification(null)
        }, MARQUEE_DURATION_MS + 250)

        return () => clearTimeout(timeoutId)
    }, [activeNotification])

    const rarityTheme = useMemo(() => {
        const rarity = String(activeNotification?.rarity || '').toLowerCase()
        return rarityThemeByKey[rarity] || rarityThemeByKey.default
    }, [activeNotification])

    const notificationUserLike = useMemo(() => {
        if (!activeNotification) return null
        const hasVipVisual = Boolean(activeNotification?.vipTitle || activeNotification?.vipTitleImageUrl)
        const isVip = Boolean(activeNotification?.isVip || hasVipVisual)
        return {
            role: isVip ? 'vip' : 'user',
            vipBenefits: {
                title: String(activeNotification?.vipTitle || '').trim(),
                titleImageUrl: String(activeNotification?.vipTitleImageUrl || '').trim(),
                usernameColor: String(activeNotification?.usernameColor || '').trim(),
                usernameGradientColor: String(activeNotification?.usernameGradientColor || '').trim(),
                usernameEffectColors: Array.isArray(activeNotification?.usernameEffectColors) ? activeNotification.usernameEffectColors : [],
                usernameEffect: String(activeNotification?.usernameEffect || '').trim(),
            },
        }
    }, [activeNotification])

    if (!activeNotification) {
        return null
    }

    return (
        <>
            <div className="pointer-events-none fixed inset-x-0 top-14 z-[9998] overflow-x-hidden overflow-y-visible sm:top-16">
                <div className="relative h-16 sm:h-[72px]">
                    <div
                        className={`absolute left-0 top-2 flex items-center gap-2 rounded-full border px-4 py-2 text-sm sm:text-base text-white ${rarityTheme.frameClass}`}
                        style={{
                            animation: `pokemonGlobalNotificationMarquee ${MARQUEE_DURATION_MS}ms linear forwards`,
                            transform: 'translateX(102vw)',
                            willChange: 'transform',
                        }}
                        onAnimationEnd={() => setActiveNotification(null)}
                    >
                        <img
                            src={activeNotification.imageUrl || DEFAULT_ICON}
                            alt="Rare Pokemon"
                            className="h-8 w-8 shrink-0 pixelated"
                            onError={(event) => {
                                event.currentTarget.onerror = null
                                event.currentTarget.src = DEFAULT_ICON
                            }}
                        />
                        <span className={`font-black uppercase tracking-wider ${rarityTheme.rarityClass}`}>
                            [{rarityTheme.label}]
                        </span>
                        {activeNotification.username && activeNotification.pokemonName ? (
                            <span className="whitespace-nowrap font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] inline-flex items-center gap-2">
                                <span>Người chơi</span>
                                <VipUsername userLike={notificationUserLike} className="text-cyan-100">{activeNotification.username}</VipUsername>
                                <VipTitleBadge
                                    userLike={notificationUserLike}
                                    imageClassName="h-7 max-w-[180px] object-contain shrink-0"
                                    textClassName="text-xs font-bold text-amber-100 truncate max-w-[180px] shrink-0"
                                />
                                <span>
                                    vừa bắt được Pokemon {activeNotification.rarityLabel || rarityTheme.label} - {activeNotification.pokemonName}!
                                </span>
                            </span>
                        ) : (
                            <span className="whitespace-nowrap font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                                {activeNotification.message}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes pokemonGlobalNotificationMarquee {
                    0% { transform: translateX(102vw); }
                    100% { transform: translateX(calc(-100% - 2rem)); }
                }
            `}</style>
        </>
    )
}
