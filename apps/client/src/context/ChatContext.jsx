import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './AuthContext'
import { io } from 'socket.io-client'

const ChatContext = createContext()
const MAX_MESSAGES = 200
const TYPING_TIMEOUT_MS = 3000
const IS_DEV = Boolean(import.meta.env.DEV)

const debugLog = (...args) => {
  if (IS_DEV) {
    console.log(...args)
  }
}

const debugError = (...args) => {
  if (IS_DEV) {
    console.error(...args)
  }
}

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within ChatProvider')
  }
  return context
}

export function ChatProvider({ children }) {
  const { user, token } = useAuth()
  const [socket, setSocket] = useState(null)
  const [messages, setMessages] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const [typingUsers, setTypingUsers] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const typingTimeoutsRef = useRef(new Map())

  // Initialize socket connection
  useEffect(() => {
    debugLog('ChatContext: useEffect triggered', { hasUser: !!user, hasToken: !!token })
    
    if (!user || !token) {
      debugLog('ChatContext: No user or token, cleaning up')
      // Cleanup if user logs out
      if (socket) {
        socket.disconnect()
        setSocket(null)
      }
      setMessages([])
      setUnreadCount(0)
      setIsConnected(false)
      return
    }

    // Connect to socket with auth
    // Remove /api suffix from VITE_API_URL or use VITE_SOCKET_URL
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    const socketUrl = import.meta.env.VITE_SOCKET_URL || apiUrl.replace('/api', '')
    
    debugLog('ChatContext: Connecting to socket', {
      socketUrl, 
      apiUrl,
      VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
      VITE_API_URL: import.meta.env.VITE_API_URL,
      tokenPreview: token.substring(0, 20) + '...'
    })
    
    const newSocket = io(socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    const clearTypingTimeout = (username) => {
      const timeout = typingTimeoutsRef.current.get(username)
      if (timeout) {
        clearTimeout(timeout)
        typingTimeoutsRef.current.delete(username)
      }
    }

    const clearAllTypingTimeouts = () => {
      for (const timeout of typingTimeoutsRef.current.values()) {
        clearTimeout(timeout)
      }
      typingTimeoutsRef.current.clear()
    }

    // Connection events
    newSocket.on('connect', () => {
      debugLog('ChatContext: Socket connected!', newSocket.id)
      setIsConnected(true)
      setError(null)
      
      // Join global chat room
      debugLog('ChatContext: Joining global chat room')
      newSocket.emit('chat:join_global')
    })

    newSocket.on('disconnect', () => {
      debugLog('ChatContext: Socket disconnected')
      setIsConnected(false)
    })

    newSocket.on('connect_error', (err) => {
      debugError('ChatContext: Socket connection error:', err.message)
      setError('Không thể kết nối đến chat server')
      setIsConnected(false)
    })

    // Chat events
    newSocket.on('chat:new_message', (message) => {
      setMessages((prev) => {
        const next = [...prev, message]
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next
      })
      
      // Increment unread count if chat is not open
      // (This will be managed by GlobalChatPopup component)
    })

    newSocket.on('chat:message_history', (history) => {
      const list = Array.isArray(history) ? history : []
      setMessages(list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list)
      setLoading(false)
    })

    newSocket.on('chat:user_typing', ({ username }) => {
      clearTypingTimeout(username)

      setTypingUsers((prev) => {
        if (!prev.includes(username)) {
          return [...prev, username]
        }
        return prev
      })

      // Remove after 3 seconds
      const timeout = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u !== username))
        typingTimeoutsRef.current.delete(username)
      }, TYPING_TIMEOUT_MS)

      typingTimeoutsRef.current.set(username, timeout)
    })

    newSocket.on('chat:online_count', (count) => {
      setOnlineCount(count)
    })

    newSocket.on('chat:error', (errorMsg) => {
      setError(errorMsg)
    })

    setSocket(newSocket)

    // Cleanup on unmount
    return () => {
      clearAllTypingTimeouts()
      newSocket.disconnect()
    }
  }, [user, token])

  // Load initial message history
  useEffect(() => {
    if (socket && isConnected) {
      setLoading(true)
      socket.emit('chat:get_history', { limit: 50 })
    }
  }, [socket, isConnected])

  // Send message
  const sendMessage = useCallback((content) => {
    if (!socket || !isConnected) {
      setError('Chưa kết nối đến chat server')
      return false
    }

    if (!content || !content.trim()) {
      return false
    }

    socket.emit('chat:send_message', { content: content.trim() })
    return true
  }, [socket, isConnected])

  // Send typing indicator
  const sendTyping = useCallback((isTyping) => {
    if (!socket || !isConnected) return

    if (isTyping) {
      socket.emit('chat:typing')
    } else {
      socket.emit('chat:stop_typing')
    }
  }, [socket, isConnected])

  // Mark messages as read
  const markAsRead = useCallback(() => {
    setUnreadCount(0)
  }, [])

  // Increment unread count
  const incrementUnread = useCallback(() => {
    setUnreadCount((prev) => prev + 1)
  }, [])

  const value = {
    socket,
    messages,
    unreadCount,
    onlineCount,
    typingUsers,
    isConnected,
    loading,
    error,
    sendMessage,
    sendTyping,
    markAsRead,
    incrementUnread,
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}
