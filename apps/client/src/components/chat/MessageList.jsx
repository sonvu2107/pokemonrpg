import { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'

export default function MessageList({ messages, typingUsers, loading }) {
  const messagesEndRef = useRef(null)
  const containerRef = useRef(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, typingUsers])

  if (loading) {
    return (
      <div className="
        bg-cyan-400 
        h-full
        flex items-center justify-center
        p-3
      ">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm font-bold text-white drop-shadow-sm">
            Đang tải tin nhắn...
          </p>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="
        bg-cyan-400 
        h-full
        flex items-center justify-center
        p-3
      ">
        <div className="text-center">
          <img 
            src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/132.png"
            alt="Ditto"
            className="w-20 h-20 pixelated mx-auto mb-2 opacity-80"
          />
          <p className="text-sm font-bold text-white drop-shadow-sm">
            Chưa có tin nhắn nào
          </p>
          <p className="text-xs text-white/70 mt-1">
            Hãy là người đầu tiên gửi tin nhắn!
          </p>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef}
      className="
        bg-cyan-400 
        h-full
        overflow-y-auto
        p-3 space-y-3
        custom-scrollbar
      "
    >
      {messages.map((message) => (
        <MessageBubble key={message._id} message={message} />
      ))}
      
      <TypingIndicator typingUsers={typingUsers} />
      
      {/* Invisible div for auto-scroll */}
      <div ref={messagesEndRef} />
    </div>
  )
}
