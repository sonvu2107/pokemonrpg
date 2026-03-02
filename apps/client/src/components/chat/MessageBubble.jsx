import { getUserPokemonId, getPokemonSpriteUrl, formatMessageTime } from '../../utils/chatUtils'
import { useAuth } from '../../context/AuthContext'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/132.png' // Ditto

export default function MessageBubble({ message }) {
  const { user } = useAuth()
  const isOwnMessage = user && message.sender._id === user._id
  const isSystemMessage = message.type === 'system'

  // System messages (center aligned, different style)
  if (isSystemMessage) {
    return (
      <div className="text-center py-2 px-3">
        <div className="inline-block text-xs font-medium text-white/80 italic border-y border-white/20 py-1 px-3">
          {message.content}
        </div>
      </div>
    )
  }

  // Own messages (right aligned, blue background)
  if (isOwnMessage) {
    return (
      <div className="flex flex-col items-end gap-1 animate-fade-in">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/60">
            {formatMessageTime(message.timestamp)}
          </span>
          <span className="text-xs font-bold text-white drop-shadow-sm">
            Bạn
          </span>
        </div>
        
        <div className="
          px-3 py-2 rounded-lg
          bg-blue-600 
          text-sm text-white font-medium
          shadow-sm
          max-w-[280px] break-words
        ">
          {message.content}
        </div>
      </div>
    )
  }

  // Other users' messages (left aligned, white background)
  const isAdmin = message.sender.role === 'admin'
  
  // Use user's avatar if available, otherwise fallback to Pokemon sprite or Ditto
  const avatarUrl = message.sender.avatar 
    ? message.sender.avatar 
    : (getUserPokemonId(message.sender._id) 
      ? getPokemonSpriteUrl(getUserPokemonId(message.sender._id))
      : DEFAULT_AVATAR)

  return (
    <div className="flex flex-col gap-1 animate-fade-in">
      <div className="flex items-center gap-2">
        {/* User avatar */}
        <img 
          src={avatarUrl}
          alt={message.sender.username}
          className="w-6 h-6 rounded-full object-cover flex-shrink-0 pixelated"
          loading="lazy"
          onError={(e) => {
            // Fallback to Ditto if image fails to load
            e.target.src = DEFAULT_AVATAR
          }}
        />
        
        <span className="text-xs font-bold text-white drop-shadow-sm flex items-center gap-1 flex-wrap">
          {message.sender.username}
          
          {/* Admin badge */}
          {isAdmin && (
            <span className="px-1.5 py-0.5 bg-purple-600 rounded text-[10px] text-white font-bold uppercase">
              ADMIN
            </span>
          )}
          
          {/* Level badge - only show if level exists and is > 0 */}
          {message.sender.level && message.sender.level > 0 && (
            <span className="px-1.5 py-0.5 bg-emerald-500 rounded text-[10px] text-white font-bold">
              Lv.{message.sender.level}
            </span>
          )}
        </span>
        
        <span className="text-[10px] text-white/60">
          {formatMessageTime(message.timestamp)}
        </span>
      </div>
      
      <div className="
        ml-8 px-3 py-2 rounded-lg
        bg-white/90 backdrop-blur-sm
        border border-blue-200
        text-sm text-slate-800 font-medium
        shadow-sm
        max-w-[280px] break-words
      ">
        {message.content}
      </div>
    </div>
  )
}
