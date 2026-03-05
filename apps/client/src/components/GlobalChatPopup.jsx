import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useChat } from '../context/ChatContext'
import { useAuth } from '../context/AuthContext'
import MessageList from './chat/MessageList'
import ChatInput from './chat/ChatInput'
import { CHAT_ICONS, getPokemonSpriteUrl } from '../utils/chatUtils'
import { useTrainerProfileModal } from '../hooks/useTrainerProfileModal'
import TrainerProfileModal from './TrainerProfileModal'

export default function GlobalChatPopup() {
  const location = useLocation()
  const { user } = useAuth()
  const { 
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
    incrementUnread
  } = useChat()

  const [isOpen, setIsOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const { openTrainerProfile, trainerModalProps } = useTrainerProfileModal({ defaultReturnTo: location.pathname })

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Increment unread when new message arrives and popup is closed
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      // Don't count own messages
      if (user && lastMessage.sender._id !== user._id) {
        incrementUnread()
      }
    }
  }, [messages, isOpen, user, incrementUnread])

  // Mark as read when opening popup
  useEffect(() => {
    if (isOpen) {
      markAsRead()
    }
  }, [isOpen, markAsRead])

  const handleToggle = () => {
    setIsOpen((prev) => !prev)
  }

  const handleSendMessage = (content) => {
    sendMessage(content)
  }

  const handleTyping = (isTyping) => {
    sendTyping(isTyping)
  }

  // Don't show if user is not logged in
  if (!user) {
    return null
  }

  // Floating button (collapsed state)
  if (!isOpen) {
    return (
      <button
        onClick={handleToggle}
        className="
          fixed bottom-6 right-6 z-40
          w-16 h-16
          bg-gradient-to-t from-blue-700 to-cyan-500
          hover:from-blue-800 hover:to-cyan-600
          border-3 border-blue-400
          rounded-lg shadow-xl
          transition-transform duration-200
          hover:scale-105 active:scale-95
          focus:outline-none focus:ring-2 focus:ring-blue-400
        "
        aria-label="Mở chat"
      >
        <img 
          src={getPokemonSpriteUrl(CHAT_ICONS.main)}
          alt="Chat"
          className="w-12 h-12 pixelated mx-auto"
        />
        
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="
            absolute -top-1 -right-1
            min-w-[24px] h-6 px-1
            rounded-full
            bg-red-500 border-2 border-white
            text-white text-xs font-bold
            flex items-center justify-center
            animate-pulse
          ">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Connection indicator */}
        {!isConnected && (
          <span className="
            absolute -bottom-1 -right-1
            w-4 h-4 rounded-full
            bg-slate-400 border-2 border-white
          " 
          title="Đang kết nối..."
          />
        )}
      </button>
    )
  }

  // Mobile: Full-screen overlay
  if (isMobile) {
    return (
      <>
      <div className="
        fixed inset-0 z-50
        bg-white
        flex flex-col
        animate-slide-up
      ">
        {/* Header */}
        <div className="
          bg-gradient-to-t from-blue-700 to-cyan-500
          px-4 py-3 
          border-b-2 border-blue-600
          flex items-center justify-between
          sticky top-0 z-10
          shadow-md
        ">
          <div className="flex items-center gap-2">
            <img 
              src={getPokemonSpriteUrl(CHAT_ICONS.main)}
              alt="Chat"
              className="w-7 h-7 -my-2 pixelated"
            />
            <div className="flex flex-col">
              <h2 className="text-base font-bold text-white drop-shadow-md uppercase tracking-wide">
                CHAT CHUNG
              </h2>
              <span className="text-[10px] text-cyan-100 font-medium">
                {onlineCount} người online
              </span>
            </div>
          </div>
          
          <button 
            onClick={handleToggle}
            className="
              w-8 h-8 rounded-full
              bg-white/20 hover:bg-red-400
              text-white font-bold text-xl
              transition-colors
              flex items-center justify-center
            "
            aria-label="Đóng chat"
          >
            ×
          </button>
        </div>

        {/* Connection status */}
        {!isConnected && (
          <div className="bg-amber-500 text-white text-xs font-bold text-center py-1 px-2">
            Đang kết nối lại...
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-red-500 text-white text-xs font-bold text-center py-1 px-2">
            {error}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-hidden">
          <MessageList 
            messages={messages} 
            typingUsers={typingUsers}
            loading={loading}
            onOpenProfile={(trainer) => openTrainerProfile(trainer, { returnTo: location.pathname })}
          />
        </div>

        {/* Input */}
        <ChatInput 
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          disabled={!isConnected}
        />
      </div>
      <TrainerProfileModal {...trainerModalProps} />
      </>
    )
  }

  // Desktop: Floating popup
  return (
    <>
    <div className="
      fixed bottom-6 right-6 z-40
      w-96 h-[600px]
      rounded-lg overflow-hidden
      border-3 border-blue-400
      shadow-2xl
      bg-white
      animate-fade-in
      flex flex-col
    ">
      {/* Header */}
      <div className="
        bg-gradient-to-t from-blue-700 to-cyan-500
        px-3 py-2 
        border-b-2 border-blue-600
        flex items-center justify-between
        flex-shrink-0
      ">
        <div className="flex items-center gap-2">
          <img 
            src={getPokemonSpriteUrl(CHAT_ICONS.main)}
            alt="Chat"
            className="w-6 h-6 -my-2 pixelated"
          />
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white drop-shadow-md uppercase tracking-wide">
              CHAT CHUNG
            </span>
            <span className="text-[10px] text-cyan-100 font-medium">
              {onlineCount} online
            </span>
          </div>
        </div>
        
        <div className="flex gap-1">
          {/* Minimize button */}
          <button 
            onClick={handleToggle}
            className="
              w-6 h-6 rounded
              bg-white/20 hover:bg-white/30
              text-white font-bold
              transition-colors
              flex items-center justify-center
            "
            aria-label="Thu nhỏ"
          >
            −
          </button>
          
          {/* Close button */}
          <button 
            onClick={handleToggle}
            className="
              w-6 h-6 rounded
              bg-white/20 hover:bg-red-400
              text-white font-bold
              transition-colors
              flex items-center justify-center
            "
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      </div>

      {/* Connection status */}
      {!isConnected && (
        <div className="bg-amber-500 text-white text-xs font-bold text-center py-1 px-2">
          Đang kết nối lại...
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-500 text-white text-xs font-bold text-center py-1 px-2">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList 
          messages={messages} 
          typingUsers={typingUsers}
          loading={loading}
          onOpenProfile={(trainer) => openTrainerProfile(trainer, { returnTo: location.pathname })}
        />
      </div>

      {/* Input */}
      <div className="flex-shrink-0">
        <ChatInput 
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          disabled={!isConnected}
        />
      </div>
    </div>
    <TrainerProfileModal {...trainerModalProps} />
    </>
  )
}
