import { formatMessageTime } from '../../utils/chatUtils'
import { useAuth } from '../../context/AuthContext'
import VipAvatar from '../VipAvatar'
import { getVipTitle, getVipTitleImageUrl } from '../../utils/vip'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png' // Pikachu

export default function MessageBubble({ message, onOpenProfile }) {
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
  const vipTitle = getVipTitle(message?.sender)
  const vipTitleImageUrl = getVipTitleImageUrl(message?.sender)
  const senderUserId = String(message?.sender?._id || '').trim()
  const canOpenProfile = Boolean(senderUserId && typeof onOpenProfile === 'function')
  
  const avatarUrl = message.sender.avatar ? message.sender.avatar : DEFAULT_AVATAR

  const handleOpenProfile = () => {
    if (!canOpenProfile) return
    onOpenProfile({
      userId: senderUserId,
      username: message?.sender?.username,
      avatar: message?.sender?.avatar,
      role: message?.sender?.role,
      vipTierLevel: message?.sender?.vipTierLevel,
      vipTierCode: message?.sender?.vipTierCode,
      vipBenefits: message?.sender?.vipBenefits,
    })
  }

  return (
    <div className="flex flex-col gap-1 animate-fade-in">
      <div className="flex items-center gap-2">
        {/* User avatar */}
        <button
          type="button"
          onClick={handleOpenProfile}
          disabled={!canOpenProfile}
          className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0"
        >
          <VipAvatar
            userLike={message?.sender}
            avatar={avatarUrl}
            fallback={DEFAULT_AVATAR}
            alt={message.sender.username}
            wrapperClassName="w-11 h-11"
            imageClassName="w-11 h-11 rounded-full object-cover flex-shrink-0 pixelated"
            frameClassName="w-11 h-11 rounded-full object-cover"
          />
        </button>
        
        <span className="text-xs font-bold text-white drop-shadow-sm flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={handleOpenProfile}
            disabled={!canOpenProfile}
            className="hover:underline"
          >
            {message.sender.username}
          </button>
          
          {vipTitleImageUrl ? (
            <img
              src={vipTitleImageUrl}
              alt={vipTitle || 'Danh hiệu VIP'}
              className="h-6 max-w-[150px] object-contain"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          ) : (vipTitle ? (
            <span className="px-1.5 py-0.5 bg-amber-100 rounded text-[10px] text-amber-700 font-bold">
              {vipTitle}
            </span>
          ) : null)}
          
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
        ml-12 px-3 py-2 rounded-lg
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
