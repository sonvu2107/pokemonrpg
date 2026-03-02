export default function TypingIndicator({ typingUsers }) {
  if (!typingUsers || typingUsers.length === 0) return null

  const displayText = typingUsers.length === 1
    ? `${typingUsers[0]} đang gõ...`
    : typingUsers.length === 2
    ? `${typingUsers[0]} và ${typingUsers[1]} đang gõ...`
    : `${typingUsers[0]} và ${typingUsers.length - 1} người khác đang gõ...`

  return (
    <div className="flex items-center gap-2 px-2 py-1 animate-fade-in">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-white/70 italic drop-shadow-sm">
        {displayText}
      </span>
    </div>
  )
}
