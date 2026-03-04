import express from 'express'
import Message from '../models/Message.js'
import { authMiddleware as auth } from '../middleware/auth.js'

const router = express.Router()

/**
 * GET /api/messages/global
 * Get global chat message history
 * Query params: limit (default 50), before (timestamp for pagination)
 */
router.get('/global', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100) // Max 100
    const before = req.query.before

    let messages

    if (before) {
      messages = await Message.getMessagesBefore('global', before, limit)
    } else {
      messages = await Message.getRecentMessages('global', limit)
    }

    res.json({
      ok: true,
      messages,
      count: messages.length
    })
  } catch (error) {
    console.error('Error fetching messages:', error)
    res.status(500).json({
      ok: false,
      error: 'Không thể tải tin nhắn'
    })
  }
})

/**
 * POST /api/messages/global
 * Send a new message to global chat
 * Body: { content: string }
 */
router.post('/global', auth, async (req, res) => {
  try {
    const { content } = req.body

    // Validation
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Nội dung tin nhắn không hợp lệ'
      })
    }

    if (content.length > 500) {
      return res.status(400).json({
        ok: false,
        error: 'Tin nhắn không được vượt quá 500 ký tự'
      })
    }

    // Rate limiting check (basic - in production use Redis)
    const recentMessages = await Message.countDocuments({
      'sender._id': req.user._id,
      timestamp: { $gte: new Date(Date.now() - 60000) } // Last 1 minute
    })

    if (recentMessages >= 10) {
      return res.status(429).json({
        ok: false,
        error: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một chút.'
      })
    }

    // Create message
    const message = new Message({
      room: 'global',
      sender: {
        _id: req.user._id,
        username: req.user.username,
        role: req.user.role || 'user',
        level: req.user.level || 1
      },
      content: content.trim(),
      type: 'text'
    })

    await message.save()

    // Broadcast via Socket.io (handled in socket handlers)
    // The socket handler will listen to this event
    if (req.app.get('io')) {
      req.app.get('io').to('global').emit('chat:new_message', message)
    }

    res.json({
      ok: true,
      message
    })
  } catch (error) {
    console.error('Error sending message:', error)
    res.status(500).json({
      ok: false,
      error: 'Không thể gửi tin nhắn'
    })
  }
})

/**
 * DELETE /api/messages/:messageId
 * Delete a message (Admin only)
 */
router.delete('/:messageId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Bạn không có quyền xóa tin nhắn'
      })
    }

    const message = await Message.findById(req.params.messageId)

    if (!message) {
      return res.status(404).json({
        ok: false,
        error: 'Không tìm thấy tin nhắn'
      })
    }

    await message.softDelete(req.user._id)

    // Broadcast deletion
    if (req.app.get('io')) {
      req.app.get('io').to('global').emit('chat:message_deleted', {
        messageId: message._id
      })
    }

    res.json({
      ok: true,
      message: 'Đã xóa tin nhắn'
    })
  } catch (error) {
    console.error('Error deleting message:', error)
    res.status(500).json({
      ok: false,
      error: 'Không thể xóa tin nhắn'
    })
  }
})

/**
 * GET /api/messages/stats
 * Get chat statistics (Admin only)
 */
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Không có quyền truy cập'
      })
    }

    const now = new Date()
    const last24h = new Date(now - 24 * 60 * 60 * 1000)
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000)

    const [totalMessages, messages24h, messages7d, uniqueSenders24hRows] = await Promise.all([
      Message.countDocuments({ isDeleted: false }),
      Message.countDocuments({ isDeleted: false, timestamp: { $gte: last24h } }),
      Message.countDocuments({ isDeleted: false, timestamp: { $gte: last7d } }),
      Message.aggregate([
        { $match: { isDeleted: false, timestamp: { $gte: last24h } } },
        { $group: { _id: '$sender._id' } },
        { $count: 'count' },
      ]),
    ])

    const uniqueSenders24h = Number(uniqueSenders24hRows?.[0]?.count || 0)

    res.json({
      ok: true,
      stats: {
        totalMessages,
        messages24h,
        messages7d,
        uniqueSenders24h
      }
    })
  } catch (error) {
    console.error('Error fetching chat stats:', error)
    res.status(500).json({
      ok: false,
      error: 'Không thể tải thống kê'
    })
  }
})

export default router
