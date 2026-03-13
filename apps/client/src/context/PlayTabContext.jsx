import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'

const PlayTabContext = createContext(null)

const TAB_ID_STORAGE_KEY = 'vnpet:tab-id'
const LOCK_PREFIX = 'vnpet:play-tab:'
const GAMEPLAY_LOCK_PREFIX = 'vnpet:gameplay-tab:'
const HEARTBEAT_MS = 2000
const STALE_LOCK_MS = 6500
const MAX_ALLOWED_TABS = 2

const createTabId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getCurrentTabId = () => {
    if (typeof window === 'undefined') return ''

    const storedValue = String(window.sessionStorage.getItem(TAB_ID_STORAGE_KEY) || '').trim()
    if (storedValue) {
        return storedValue
    }

    const nextTabId = createTabId()
    window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, nextTabId)
    return nextTabId
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
        if (Array.isArray(parsed?.tabs)) {
            return {
                tabs: parsed.tabs.map((entry) => ({
                    tabId: String(entry?.tabId || '').trim(),
                    lastSeen: Number(entry?.lastSeen || 0),
                })),
            }
        }

        if (parsed?.tabId) {
            return {
                tabs: [{
                    tabId: String(parsed?.tabId || '').trim(),
                    lastSeen: Number(parsed?.lastSeen || 0),
                }],
            }
        }

        return { tabs: [] }
    } catch {
        return null
    }
}

const isTabStale = (tabState) => {
    if (!tabState?.tabId) return true
    if (!Number.isFinite(tabState.lastSeen) || tabState.lastSeen <= 0) return true
    return (Date.now() - tabState.lastSeen) > STALE_LOCK_MS
}

const sanitizeTabs = (lockState) => {
    const tabs = Array.isArray(lockState?.tabs) ? lockState.tabs : []
    return tabs
        .map((entry) => ({
            tabId: String(entry?.tabId || '').trim(),
            lastSeen: Number(entry?.lastSeen || 0),
        }))
        .filter((entry) => !isTabStale(entry))
}

const readGameplayLockState = (lockKey) => {
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

const writeGameplayLockState = (lockKey, tabId) => {
    window.localStorage.setItem(lockKey, JSON.stringify({
        tabId,
        lastSeen: Date.now(),
    }))
}

const isGameplayLockStale = (lockState) => isTabStale(lockState)

export const PlayTabProvider = ({ children }) => {
    const { user, token } = useAuth()
    const tabIdRef = useRef(getCurrentTabId())
    const lockKeyRef = useRef('')
    const gameplayLockKeyRef = useRef('')
    const sessionTakenOverRef = useRef(false)
    const [isPrimaryPlayTab, setIsPrimaryPlayTab] = useState(true)
    const [isGameplayTab, setIsGameplayTab] = useState(true)
    const [isSessionTakenOver, setIsSessionTakenOver] = useState(false)

    const userKey = toUserKey(user)

    const releaseLock = (lockKey = lockKeyRef.current) => {
        if (!lockKey) return

        const currentLock = readLockState(lockKey)
        const remainingTabs = sanitizeTabs(currentLock).filter((entry) => entry.tabId !== tabIdRef.current)
        if (remainingTabs.length === 0) {
            window.localStorage.removeItem(lockKey)
            return
        }

        window.localStorage.setItem(lockKey, JSON.stringify({ tabs: remainingTabs }))
    }

    const writeTabs = (lockKey, tabs) => {
        window.localStorage.setItem(lockKey, JSON.stringify({ tabs }))
    }

    const releaseGameplayLock = (lockKey = gameplayLockKeyRef.current) => {
        if (!lockKey) return

        const currentLock = readGameplayLockState(lockKey)
        if (currentLock?.tabId === tabIdRef.current) {
            window.localStorage.removeItem(lockKey)
        }
    }

    const syncLock = (lockKey) => {
        if (!lockKey || sessionTakenOverRef.current) {
            setIsPrimaryPlayTab(false)
            return false
        }

        const currentLock = readLockState(lockKey)
        const tabs = sanitizeTabs(currentLock)
        const now = Date.now()
        const existingIndex = tabs.findIndex((entry) => entry.tabId === tabIdRef.current)

        if (existingIndex !== -1) {
            const nextTabs = tabs.map((entry, index) => index === existingIndex
                ? { ...entry, lastSeen: now }
                : entry)
            writeTabs(lockKey, nextTabs)
            setIsPrimaryPlayTab(true)
            return true
        }

        if (tabs.length < MAX_ALLOWED_TABS) {
            const nextTabs = [...tabs, { tabId: tabIdRef.current, lastSeen: now }]
            writeTabs(lockKey, nextTabs)
            const confirmedTabs = sanitizeTabs(readLockState(lockKey))
            const won = confirmedTabs.some((entry) => entry.tabId === tabIdRef.current)
            setIsPrimaryPlayTab(won)
            return won
        }

        setIsPrimaryPlayTab(false)
        return false
    }

    const syncGameplayLock = (lockKey) => {
        if (!lockKey || sessionTakenOverRef.current) {
            setIsGameplayTab(false)
            return false
        }

        const currentLock = readGameplayLockState(lockKey)
        if (currentLock?.tabId === tabIdRef.current) {
            writeGameplayLockState(lockKey, tabIdRef.current)
            setIsGameplayTab(true)
            return true
        }

        if (!currentLock || isGameplayLockStale(currentLock)) {
            writeGameplayLockState(lockKey, tabIdRef.current)
            const confirmedLock = readGameplayLockState(lockKey)
            const won = confirmedLock?.tabId === tabIdRef.current
            setIsGameplayTab(won)
            return won
        }

        setIsGameplayTab(false)
        return false
    }

    useEffect(() => {
        sessionTakenOverRef.current = false
        setIsSessionTakenOver(false)

        if (!token || !userKey) {
            releaseLock()
            releaseGameplayLock()
            lockKeyRef.current = ''
            gameplayLockKeyRef.current = ''
            setIsPrimaryPlayTab(true)
            setIsGameplayTab(true)
            return undefined
        }

        const lockKey = `${LOCK_PREFIX}${userKey}`
        const gameplayLockKey = `${GAMEPLAY_LOCK_PREFIX}${userKey}`
        lockKeyRef.current = lockKey
        gameplayLockKeyRef.current = gameplayLockKey
        const canUseTab = syncLock(lockKey)
        if (canUseTab) {
            syncGameplayLock(gameplayLockKey)
        } else {
            setIsGameplayTab(false)
        }

        const intervalId = window.setInterval(() => {
            const stillAllowed = syncLock(lockKey)
            if (stillAllowed) {
                syncGameplayLock(gameplayLockKey)
            } else {
                setIsGameplayTab(false)
            }
        }, HEARTBEAT_MS)

        const handleStorage = (event) => {
            if (event.key === lockKey || event.key === gameplayLockKey) {
                const stillAllowed = syncLock(lockKey)
                if (stillAllowed) {
                    syncGameplayLock(gameplayLockKey)
                } else {
                    setIsGameplayTab(false)
                }
            }
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                const stillAllowed = syncLock(lockKey)
                if (stillAllowed) {
                    syncGameplayLock(gameplayLockKey)
                } else {
                    setIsGameplayTab(false)
                }
            }
        }

        const handlePageHide = () => {
            releaseGameplayLock(gameplayLockKey)
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
            releaseGameplayLock(gameplayLockKey)
            releaseLock(lockKey)
        }
    }, [token, userKey])

    const markSessionTakenOver = () => {
        sessionTakenOverRef.current = true
        setIsSessionTakenOver(true)
        setIsPrimaryPlayTab(false)
        setIsGameplayTab(false)
        releaseGameplayLock()
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
        isGameplayTab,
        isSessionTakenOver,
        isPlayTabBlocked: Boolean(token && userKey) && (!isPrimaryPlayTab || isSessionTakenOver),
        isGameplayTabBlocked: Boolean(token && userKey) && isPrimaryPlayTab && !isGameplayTab,
        blockReason: isSessionTakenOver ? 'session-replaced' : (!isPrimaryPlayTab ? 'tab-limit-exceeded' : null),
        maxAllowedTabs: MAX_ALLOWED_TABS,
        markSessionTakenOver,
        clearSessionTakenOver,
        releasePlayTabLock: releaseLock,
        releaseGameplayLock,
        currentTabId: tabIdRef.current,
    }), [isPrimaryPlayTab, isGameplayTab, isSessionTakenOver, token, userKey])

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
