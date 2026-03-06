import { useState, useRef } from 'react'
import { validateMessage } from '../../utils/chatUtils'

export default function ChatInput({ onSendMessage, onTyping, disabled = false }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const typingTimeoutRef = useRef(null)

  const handleInputChange = (e) => {
    const value = e.target.value
    setMessage(value)
    setError('')

    // Emit typing event
    if (onTyping) {
      onTyping(true)
      
      // Stop typing after 2 seconds of inactivity
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false)
      }, 2000)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    
    // Validate message
    const validation = validateMessage(message)
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    // Send message
    onSendMessage(message.trim())
    
    // Clear input
    setMessage('')
    setError('')
    
    // Stop typing indicator
    if (onTyping) {
      onTyping(false)
    }
    clearTimeout(typingTimeoutRef.current)

    // Re-focus input
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  const handleKeyDown = (e) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="bg-white border-t-2 border-blue-400 p-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Nhập tin nhắn..."
            maxLength={500}
            className="
              w-full px-3 py-2
              rounded border-2 border-blue-300
              focus:border-blue-500 focus:ring-2 focus:ring-blue-200
              text-sm font-medium text-slate-800
              placeholder:text-slate-400
              disabled:bg-slate-100 disabled:cursor-not-allowed
              transition-colors
            "
          />
          {error && (
            <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-1">
            {message.length}/500 • Enter để gửi
          </p>
        </div>

        {/* Send button - Pokéball style */}
        <button
          type="submit"
          disabled={disabled || !message.trim()}
          className="
            px-4 py-2 rounded
            bg-gradient-to-t from-blue-700 to-cyan-500
            hover:from-blue-800 hover:to-cyan-600
            disabled:from-slate-300 disabled:to-slate-400
            border-2 border-blue-600
            disabled:border-slate-400
            text-white text-xs font-bold uppercase
            shadow-sm
            transition-all active:scale-95
            disabled:cursor-not-allowed disabled:active:scale-100
            h-fit
          "
        >
          Gửi
        </button>
      </form>
    </div>
  )
}
