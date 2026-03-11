import express from 'express'
import Message from '../models/Message.js'
import User from '../models/User.js'
import PlayerState from '../models/PlayerState.js'
import { authMiddleware as auth } from '../middleware/auth.js'
import {
  normalizeVipVisualBenefits,
  resolveEffectiveVipBenefitsForUsers,
  resolveEffectiveVipVisualBenefits,
} from '../services/vipBenefitService.js'

const router = express.Router()
const DEFAULT_AVATAR_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const normalizeAvatarUrl = (value = '') => String(value || '').trim() || DEFAULT_AVATAR_URL

const hydrateMessageSendersVipBenefits = async (messages = []) => {
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

  const userById = new Map(users.map((entry) => [String(entry?._id || '').trim(), entry]))
  const benefitsByUserId = await resolveEffectiveVipBenefitsForUsers(users)

  return list.map((entry) => {
    const senderId = String(entry?.sender?._id || '').trim()
    const senderUser = senderId ? userById.get(senderId) : null
    const effectiveVipBenefits = benefitsByUserId.get(senderId)
    if (!senderUser || !entry?.sender || !effectiveVipBenefits) {
      return entry
    }

    return {
      ...entry,
      sender: {
        ...entry.sender,
        avatar: normalizeAvatarUrl(senderUser?.avatar || entry?.sender?.avatar),
        role: senderUser.role || entry.sender.role || 'user',
        vipTierLevel: Math.max(0, parseInt(senderUser?.vipTierLevel, 10) || 0),
        vipTierCode: String(senderUser?.vipTierCode || '').trim().toUpperCase(),
        vipBenefits: normalizeVipVisualBenefits(effectiveVipBenefits),
      },
    }
  })
}

router.get('/global', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100) 
    const before = req.query.before

    let messages

    if (before) {
      messages = await Message.getMessagesBefore('global', before, limit)
    } else {
      messages = await Message.getRecentMessages('global', limit)
    }

    const hydratedMessages = await hydrateMessageSendersVipBenefits(messages)

    res.json({
      ok: true,
      messages: hydratedMessages,
      count: hydratedMessages.length
    })
  } catch (error) {
    console.error('Error fetching messages:', error)
    res.status(500).json({
      ok: false,
      error: 'Không thể tải tin nhắn'
    })
  }
})

router.post('/global', auth, async (req, res) => {
  try {
    const { content } = req.body
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

    const currentUserId = String(req.user?.userId || '').trim()
    if (!currentUserId) {
      return res.status(401).json({
        ok: false,
        error: 'Không xác định được người dùng hiện tại'
      })
    }

    const [user, playerState] = await Promise.all([
      User.findById(currentUserId).select('username role avatar vipTierId vipTierLevel vipTierCode vipBenefits').lean(),
      PlayerState.findOne({ userId: currentUserId }).select('level').lean(),
    ])

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'Không tìm thấy thông tin người dùng'
      })
    }

    const recentMessages = await Message.countDocuments({
      'sender._id': currentUserId,
      timestamp: { $gte: new Date(Date.now() - 60000) }
    })

    if (recentMessages >= 10) {
      return res.status(429).json({
        ok: false,
        error: 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một chút.'
      })
    }

    const effectiveVipBenefits = await resolveEffectiveVipVisualBenefits(user)

    const message = new Message({
      room: 'global',
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

router.delete('/:messageId', auth, async (req, res) => {
  try {
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
    await message.softDelete(req.user.userId)

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
