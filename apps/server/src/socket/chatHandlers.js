import Message from '../models/Message.js'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'

// Store typing users in memory (in production, use Redis)
const typingUsers = new Map() // roomId -> Set of usernames

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
        socket.join('global')
        console.log(`User ${userId} joined global chat`)

        // Send recent message history
        const messages = await Message.getRecentMessages('global', 50)
        socket.emit('chat:message_history', messages)

        // Send online count
        const onlineCount = io.sockets.adapter.rooms.get('global')?.size || 0
        io.to('global').emit('chat:online_count', onlineCount)
      } catch (error) {
        console.error('Error joining global chat:', error)
        socket.emit('chat:error', 'Không thể tham gia chat')
      }
    })

    // Leave global chat room
    socket.on('chat:leave_global', () => {
      socket.leave('global')
      console.log(`User ${userId} left global chat`)

      // Update online count
      const onlineCount = io.sockets.adapter.rooms.get('global')?.size || 0
      io.to('global').emit('chat:online_count', onlineCount)
    })

    // Get message history (pagination)
    socket.on('chat:get_history', async ({ limit = 50, before }) => {
      try {
        const messages = before
          ? await Message.getMessagesBefore('global', before, limit)
          : await Message.getRecentMessages('global', limit)

        socket.emit('chat:message_history', messages)
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
          User.findById(userId).select('username role avatar'),
          PlayerState.findOne({ userId }).select('level')
        ])
        
        if (!user) {
          return socket.emit('chat:error', 'Không tìm thấy thông tin người dùng')
        }

        // Validation
        if (!content || typeof content !== 'string' || !content.trim()) {
          return socket.emit('chat:error', 'Nội dung tin nhắn không hợp lệ')
        }

        if (content.length > 500) {
          return socket.emit('chat:error', 'Tin nhắn không được vượt quá 500 ký tự')
        }

        // Rate limiting (basic - in production use Redis)
        const recentMessages = await Message.find({
          'sender._id': userId,
          timestamp: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
        }).countDocuments()

        if (recentMessages >= 10) {
          return socket.emit('chat:error', 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một chút.')
        }

        // Check for duplicate message (spam prevention)
        const lastMessage = await Message.findOne({
          'sender._id': userId,
          room: 'global'
        }).sort({ timestamp: -1 })

        if (lastMessage && lastMessage.content === content.trim() && 
            (Date.now() - lastMessage.timestamp.getTime()) < 5000) {
          return socket.emit('chat:error', 'Bạn vừa gửi tin nhắn này rồi')
        }

        // Create message
        const message = new Message({
          room: 'global',
          sender: {
            _id: user._id,
            username: user.username,
            role: user.role || 'user',
            level: playerState?.level || 1,
            avatar: user.avatar || ''
          },
          content: content.trim(),
          type: 'text'
        })

        await message.save()

        // Broadcast to all users in global room
        io.to('global').emit('chat:new_message', message)

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
        const user = await User.findById(userId).select('username')
        if (!user) return

        const username = user.username

        // Add to typing users
        if (!typingUsers.has('global')) {
          typingUsers.set('global', new Set())
        }
        typingUsers.get('global').add(username)

        // Broadcast to others (not to self)
        socket.to('global').emit('chat:user_typing', { username })

        // Auto-remove after 3 seconds
        setTimeout(() => {
          const roomTyping = typingUsers.get('global')
          if (roomTyping) {
            roomTyping.delete(username)
          }
        }, 3000)
      } catch (error) {
        console.error('Error handling typing:', error)
      }
    })

    // Stop typing indicator
    socket.on('chat:stop_typing', async () => {
      try {
        const user = await User.findById(userId).select('username')
        if (!user) return

        const username = user.username
        const roomTyping = typingUsers.get('global')
        if (roomTyping) {
          roomTyping.delete(username)
        }
      } catch (error) {
        console.error('Error handling stop typing:', error)
      }
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      // Remove from typing users
      try {
        const rooms = ['global']
        rooms.forEach(room => {
          const roomTyping = typingUsers.get(room)
          if (roomTyping) {
            // We don't have username here, so clean up will happen via timeout
          }
        })

        // Update online count for all rooms user was in
        if (socket.rooms.has('global')) {
          const onlineCount = io.sockets.adapter.rooms.get('global')?.size || 0
          io.to('global').emit('chat:online_count', onlineCount)
        }
      } catch (error) {
        console.error('Error handling disconnect cleanup:', error)
      }
    })

  console.log('Chat handlers attached to socket:', socket.id)
}

export { attachChatHandlers }
