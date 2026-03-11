import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'

const PlayTabContext = createContext(null)

const LOCK_PREFIX = 'vnpet:play-tab:'
const HEARTBEAT_MS = 2000
const STALE_LOCK_MS = 6500

const createTabId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const toUserKey = (userLike = null) => {
    const raw = userLike?.id || userLike?._id || userLike?.userId || userLike?.email || userLike?.username || ''
    return String(raw || '').trim()
}

const readLockState = (lockKey) => {
    if (!lockKey) return null

    try {
        const raw = window.localStorage.getItem(lockKey)
        if (!raw) return null

        const parsed = JSON.parse(raw)
        return {
            tabId: String(parsed?.tabId || '').trim(),
            lastSeen: Number(parsed?.lastSeen || 0),
        }
    } catch {
        return null
    }
}

const isLockStale = (lockState) => {
    if (!lockState?.tabId) return true
    if (!Number.isFinite(lockState.lastSeen) || lockState.lastSeen <= 0) return true
    return (Date.now() - lockState.lastSeen) > STALE_LOCK_MS
}

export const PlayTabProvider = ({ children }) => {
    const { user, token } = useAuth()
    const tabIdRef = useRef(createTabId())
    const lockKeyRef = useRef('')
    const sessionTakenOverRef = useRef(false)
    const [isPrimaryPlayTab, setIsPrimaryPlayTab] = useState(true)
    const [isSessionTakenOver, setIsSessionTakenOver] = useState(false)

    const userKey = toUserKey(user)

    const releaseLock = (lockKey = lockKeyRef.current) => {
        if (!lockKey) return

        const currentLock = readLockState(lockKey)
        if (currentLock?.tabId === tabIdRef.current) {
            window.localStorage.removeItem(lockKey)
        }
    }

    const writeOwnLock = (lockKey) => {
        window.localStorage.setItem(lockKey, JSON.stringify({
            tabId: tabIdRef.current,
            lastSeen: Date.now(),
        }))
    }

    const syncLock = (lockKey) => {
        if (!lockKey || sessionTakenOverRef.current) {
            setIsPrimaryPlayTab(false)
            return false
        }

        const currentLock = readLockState(lockKey)
        if (currentLock?.tabId === tabIdRef.current) {
            writeOwnLock(lockKey)
            setIsPrimaryPlayTab(true)
            return true
        }

        if (!currentLock || isLockStale(currentLock)) {
            writeOwnLock(lockKey)
            const confirmedLock = readLockState(lockKey)
            const won = confirmedLock?.tabId === tabIdRef.current
            setIsPrimaryPlayTab(won)
            return won
        }

        setIsPrimaryPlayTab(false)
        return false
    }

    useEffect(() => {
        sessionTakenOverRef.current = false
        setIsSessionTakenOver(false)

        if (!token || !userKey) {
            releaseLock()
            lockKeyRef.current = ''
            setIsPrimaryPlayTab(true)
            return undefined
        }

        const lockKey = `${LOCK_PREFIX}${userKey}`
        lockKeyRef.current = lockKey
        syncLock(lockKey)

        const intervalId = window.setInterval(() => {
            syncLock(lockKey)
        }, HEARTBEAT_MS)

        const handleStorage = (event) => {
            if (event.key === lockKey) {
                syncLock(lockKey)
            }
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                syncLock(lockKey)
            }
        }

        const handlePageHide = () => {
            releaseLock(lockKey)
        }

        window.addEventListener('storage', handleStorage)
        window.addEventListener('pagehide', handlePageHide)
        window.addEventListener('beforeunload', handlePageHide)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener('storage', handleStorage)
            window.removeEventListener('pagehide', handlePageHide)
            window.removeEventListener('beforeunload', handlePageHide)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            releaseLock(lockKey)
        }
    }, [token, userKey])

    const markSessionTakenOver = () => {
        sessionTakenOverRef.current = true
        setIsSessionTakenOver(true)
        setIsPrimaryPlayTab(false)
        releaseLock()
    }

    const clearSessionTakenOver = () => {
        sessionTakenOverRef.current = false
        setIsSessionTakenOver(false)
        if (lockKeyRef.current) {
            syncLock(lockKeyRef.current)
        }
    }

    const value = useMemo(() => ({
        isPrimaryPlayTab,
        isSessionTakenOver,
        isPlayTabBlocked: Boolean(token && userKey) && (!isPrimaryPlayTab || isSessionTakenOver),
        blockReason: isSessionTakenOver ? 'session-replaced' : (!isPrimaryPlayTab ? 'secondary-tab' : null),
        markSessionTakenOver,
        clearSessionTakenOver,
        releasePlayTabLock: releaseLock,
    }), [isPrimaryPlayTab, isSessionTakenOver, token, userKey])

    return (
        <PlayTabContext.Provider value={value}>
            {children}
        </PlayTabContext.Provider>
    )
}

export const usePlayTab = () => {
    const context = useContext(PlayTabContext)
    if (!context) {
        throw new Error('usePlayTab must be used within PlayTabProvider')
    }
    return context
}
