import Message from '../models/Message.js'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import {
  normalizeVipVisualBenefits,
  resolveEffectiveVipBenefitsForUsers,
  resolveEffectiveVipVisualBenefits,
} from '../services/vipBenefitService.js'

// Store typing users in memory (in production, use Redis)
const typingUsers = new Map() // roomId -> Set of usernames
const typingTimeouts = new Map() // socketId -> timeout
const usernameCache = new Map() // userId -> { username, expiresAt }

const TYPING_TIMEOUT_MS = 3000
const USERNAME_CACHE_TTL_MS = 5 * 60 * 1000
const USERNAME_CACHE_MAX_ENTRIES = 1000
const GLOBAL_ROOM = 'global'
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const enrichMessageSenderVipBenefits = async (messages = []) => {
  const list = Array.isArray(messages) ? messages : []
  if (list.length === 0) return list

  const senderIds = Array.from(new Set(
    list
      .map((entry) => String(entry?.sender?._id || '').trim())
      .filter(Boolean)
  ))

  if (senderIds.length === 0) return list

  const users = await User.find({ _id: { $in: senderIds } })
    .select('_id avatar role vipTierId vipTierLevel vipTierCode vipBenefits')
    .lean()

  const userById = new Map(users.map((entry) => [String(entry?._id || ''), entry]))
  const benefitsByUserId = await resolveEffectiveVipBenefitsForUsers(users)

  return list.map((entry) => {
    const senderId = String(entry?.sender?._id || '').trim()
    const senderUser = senderId ? userById.get(senderId) : null
    if (!senderUser || !entry?.sender) {
      return entry
    }

    const effectiveVipBenefits = benefitsByUserId.get(senderId)

    return effectiveVipBenefits ? {
      ...entry,
      sender: {
        ...entry.sender,
        avatar: normalizeAvatarUrl(senderUser?.avatar || entry?.sender?.avatar),
        role: senderUser.role || entry.sender.role || 'user',
        vipTierLevel: Math.max(0, parseInt(senderUser?.vipTierLevel, 10) || 0),
        vipTierCode: String(senderUser?.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: normalizeVipVisualBenefits(effectiveVipBenefits),
      },
    } : entry
  })
}

const pruneUsernameCache = () => {
  const now = Date.now()

  for (const [key, cached] of usernameCache.entries()) {
    if (!cached || cached.expiresAt <= now) {
      usernameCache.delete(key)
    }
  }

  while (usernameCache.size > USERNAME_CACHE_MAX_ENTRIES) {
    const oldestKey = usernameCache.keys().next().value
    if (!oldestKey) break
    usernameCache.delete(oldestKey)
  }
}

const cacheUsername = (userId, username) => {
  const normalizedUserId = String(userId || '').trim()
  const normalizedUsername = String(username || '').trim()
  if (!normalizedUserId || !normalizedUsername) return normalizedUsername

  pruneUsernameCache()

  usernameCache.set(normalizedUserId, {
    username: normalizedUsername,
    expiresAt: Date.now() + USERNAME_CACHE_TTL_MS,
  })

  return normalizedUsername
}

const getUsernameFromCache = (userId) => {
  pruneUsernameCache()

  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return null

  const cached = usernameCache.get(normalizedUserId)
  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    usernameCache.delete(normalizedUserId)
    return null
  }

  return cached.username
}

const getUsernameByUserId = async (userId) => {
  const cached = getUsernameFromCache(userId)
  if (cached) return cached

  const user = await User.findById(userId).select('username').lean()
  if (!user?.username) return null

  return cacheUsername(userId, user.username)
}

const clearTypingTimeout = (socketId) => {
  const timeout = typingTimeouts.get(socketId)
  if (timeout) {
    clearTimeout(timeout)
    typingTimeouts.delete(socketId)
  }
}

const removeTypingUser = (room, username) => {
  if (!username) return
  const roomTyping = typingUsers.get(room)
  if (!roomTyping) return

  roomTyping.delete(username)
  if (roomTyping.size === 0) {
    typingUsers.delete(room)
  }
}

/**
 * Attach chat socket handlers to a connected socket
 * @param {SocketIO.Socket} socket - The connected socket
 * @param {SocketIO.Server} io - The Socket.IO server instance
 */
const attachChatHandlers = (socket, io) => {
  const userId = socket.userId

  // Join global chat room
  socket.on('chat:join_global', async () => {
      try {
        socket.join(GLOBAL_ROOM)

        const username = await getUsernameByUserId(userId)
        if (username) {
          socket.data.chatUsername = username
        }

        console.log(`User ${userId} joined global chat`)

        // Send recent message history
        const messages = await Message.getRecentMessages(GLOBAL_ROOM, 50)
        const hydratedMessages = await enrichMessageSenderVipBenefits(messages)
        socket.emit('chat:message_history', hydratedMessages)

        // Send online count
        const onlineCount = io.sockets.adapter.rooms.get(GLOBAL_ROOM)?.size || 0
        io.to(GLOBAL_ROOM).emit('chat:online_count', onlineCount)
      } catch (error) {
        console.error('Error joining global chat:', error)
        socket.emit('chat:error', 'Không thể tham gia chat')
      }
    })

    // Leave global chat room
    socket.on('chat:leave_global', () => {
      const username = socket.data?.chatUsername || null
      clearTypingTimeout(socket.id)
      removeTypingUser(GLOBAL_ROOM, username)
      socket.leave(GLOBAL_ROOM)
      console.log(`User ${userId} left global chat`)

      // Update online count
      const onlineCount = io.sockets.adapter.rooms.get(GLOBAL_ROOM)?.size || 0
      io.to(GLOBAL_ROOM).emit('chat:online_count', onlineCount)
    })

    // Get message history (pagination)
    socket.on('chat:get_history', async ({ limit = 50, before }) => {
      try {
        const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 50))
        const messages = before
          ? await Message.getMessagesBefore(GLOBAL_ROOM, before, safeLimit)
          : await Message.getRecentMessages(GLOBAL_ROOM, safeLimit)

        const hydratedMessages = await enrichMessageSenderVipBenefits(messages)
        socket.emit('chat:message_history', hydratedMessages)
      } catch (error) {
        console.error('Error fetching message history:', error)
        socket.emit('chat:error', 'Không thể tải lịch sử tin nhắn')
      }
    })

    // Send message
    socket.on('chat:send_message', async ({ content }) => {
      try {
        // Get user info and player state
        const [user, playerState] = await Promise.all([
          User.findById(userId).select('username role avatar vipTierId vipTierLevel vipTierCode vipBenefits').lean(),
          PlayerState.findOne({ userId }).select('level').lean(),
        ])
        
        if (!user) {
          return socket.emit('chat:error', 'Không tìm thấy thông tin người dùng')
        }

        socket.data.chatUsername = cacheUsername(userId, user.username)

        const effectiveVipBenefits = await resolveEffectiveVipVisualBenefits(user)

        // Validation
        if (!content || typeof content !== 'string' || !content.trim()) {
          return socket.emit('chat:error', 'Nội dung tin nhắn không hợp lệ')
        }

        if (content.length > 500) {
          return socket.emit('chat:error', 'Tin nhắn không được vượt quá 500 ký tự')
        }

        // Rate limiting (basic - in production use Redis)
        const recentMessages = await Message.countDocuments({
          'sender._id': userId,
          timestamp: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
        })

        if (recentMessages >= 10) {
          return socket.emit('chat:error', 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một chút.')
        }

        // Check for duplicate message (spam prevention)
        const lastMessage = await Message.findOne({
          'sender._id': userId,
          room: GLOBAL_ROOM,
          isDeleted: false,
        })
          .select('content timestamp')
          .sort({ timestamp: -1 })
          .lean()

        if (lastMessage && lastMessage.content === content.trim() && 
            (Date.now() - lastMessage.timestamp.getTime()) < 5000) {
          return socket.emit('chat:error', 'Bạn vừa gửi tin nhắn này rồi')
        }

        // Create message
        const message = new Message({
          room: GLOBAL_ROOM,
          sender: {
            _id: user._id,
            username: user.username,
            role: user.role || 'user',
            level: playerState?.level || 1,
            avatar: normalizeAvatarUrl(user?.avatar),
            vipTierLevel: Math.max(0, parseInt(user?.vipTierLevel, 10) || 0),
            vipTierCode: String(user?.vipTierCode || '').trim().toUpperCase(),
            vipBenefits: effectiveVipBenefits,
          },
          content: content.trim(),
          type: 'text'
        })

        await message.save()

        // Broadcast to all users in global room
        io.to(GLOBAL_ROOM).emit('chat:new_message', message)

        // Send confirmation to sender
        socket.emit('chat:message_sent', { messageId: message._id })

      } catch (error) {
        console.error('Error sending message:', error)
        socket.emit('chat:error', 'Không thể gửi tin nhắn')
      }
    })

    // Typing indicator
    socket.on('chat:typing', async () => {
      try {
        const username = socket.data?.chatUsername || await getUsernameByUserId(userId)
        if (!username) return

        socket.data.chatUsername = username

        // Add to typing users
        if (!typingUsers.has(GLOBAL_ROOM)) {
          typingUsers.set(GLOBAL_ROOM, new Set())
        }
        typingUsers.get(GLOBAL_ROOM).add(username)

        // Broadcast to others (not to self)
        socket.to(GLOBAL_ROOM).emit('chat:user_typing', { username })

        clearTypingTimeout(socket.id)
        const timeout = setTimeout(() => {
          removeTypingUser(GLOBAL_ROOM, username)
          typingTimeouts.delete(socket.id)
        }, TYPING_TIMEOUT_MS)
        typingTimeouts.set(socket.id, timeout)
      } catch (error) {
        console.error('Error handling typing:', error)
      }
    })

    // Stop typing indicator
    socket.on('chat:stop_typing', async () => {
      try {
        const username = socket.data?.chatUsername || await getUsernameByUserId(userId)
        if (!username) return

        clearTypingTimeout(socket.id)
        removeTypingUser(GLOBAL_ROOM, username)
      } catch (error) {
        console.error('Error handling stop typing:', error)
      }
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      // Remove from typing users
      try {
        const username = socket.data?.chatUsername || getUsernameFromCache(userId)
        clearTypingTimeout(socket.id)
        removeTypingUser(GLOBAL_ROOM, username)

        const onlineCount = io.sockets.adapter.rooms.get(GLOBAL_ROOM)?.size || 0
        io.to(GLOBAL_ROOM).emit('chat:online_count', onlineCount)
      } catch (error) {
        console.error('Error handling disconnect cleanup:', error)
      }
    })

  console.log('Chat handlers attached to socket:', socket.id)
}

export { attachChatHandlers }
