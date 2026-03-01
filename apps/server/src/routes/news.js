import express from 'express'
import Post from '../models/Post.js'
import Map from '../models/Map.js'
import { authMiddleware, requireAdmin, requireAdminPermission } from '../middleware/auth.js'
import { ADMIN_PERMISSIONS } from '../constants/adminPermissions.js'

const router = express.Router()

// GET /api/news - Get latest published posts (public)
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10))
        const allowedTypes = ['news', 'event', 'maintenance', 'update']
        const requestedType = String(req.query.type || '').trim().toLowerCase()
        const query = { isPublished: true }
        if (requestedType) {
            if (!allowedTypes.includes(requestedType)) {
                return res.status(400).json({ ok: false, message: 'Bộ lọc loại bài viết không hợp lệ' })
            }
            query.type = requestedType
        }

        const posts = await Post.find(query)
            .populate('author', 'username')
            .populate('mapId', 'name slug')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()

        res.json({ ok: true, posts })
    } catch (error) {
        console.error('GET /api/news error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/news/admin/all - Get all posts including unpublished (admin only)
router.get('/admin/all', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const posts = await Post.find()
            .populate('author', 'username')
            .populate('mapId', 'name slug')
            .sort({ createdAt: -1 })
            .lean()

        res.json({ ok: true, posts })
    } catch (error) {
        console.error('GET /api/news/admin/all error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/news/:id - Get single post (public)
router.get('/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ _id: req.params.id, isPublished: true })
            .populate('author', 'username')
            .populate('mapId', 'name slug')

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bài viết' })
        }

        res.json({ ok: true, post })
    } catch (error) {
        console.error('GET /api/news/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// POST /api/news - Create post (admin only)
router.post('/', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const { title, content, type, isPublished, mapId } = req.body
        const normalizedMapId = typeof mapId === 'string' ? mapId.trim() : ''

        if (!title || !content) {
            return res.status(400).json({ ok: false, message: 'Tiêu đề và nội dung là bắt buộc' })
        }

        if (normalizedMapId) {
            const mapExists = await Map.exists({ _id: normalizedMapId })
            if (!mapExists) {
                return res.status(400).json({ ok: false, message: 'Bản đồ được liên kết không tồn tại' })
            }
        }

        const post = new Post({
            title,
            content,
            author: req.user.userId,
            type: type || 'news',
            isPublished: isPublished !== undefined ? isPublished : true,
            mapId: normalizedMapId || null,
        })

        await post.save()
        await post.populate([
            { path: 'author', select: 'username' },
            { path: 'mapId', select: 'name slug' },
        ])

        res.status(201).json({ ok: true, post })
    } catch (error) {
        console.error('POST /api/news error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/news/:id - Update post (admin only)
router.put('/:id', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const { title, content, type, isPublished, mapId } = req.body

        const post = await Post.findById(req.params.id)

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bài viết' })
        }

        if (title) post.title = title
        if (content) post.content = content
        if (type) post.type = type
        if (isPublished !== undefined) post.isPublished = isPublished
        if (mapId !== undefined) {
            const normalizedMapId = typeof mapId === 'string' ? mapId.trim() : ''
            if (!normalizedMapId) {
                post.mapId = null
            } else {
                const mapExists = await Map.exists({ _id: normalizedMapId })
                if (!mapExists) {
                    return res.status(400).json({ ok: false, message: 'Bản đồ được liên kết không tồn tại' })
                }
                post.mapId = normalizedMapId
            }
        }

        await post.save()
        await post.populate([
            { path: 'author', select: 'username' },
            { path: 'mapId', select: 'name slug' },
        ])

        res.json({ ok: true, post })
    } catch (error) {
        console.error('PUT /api/news/:id error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// DELETE /api/news/:id - Delete post (admin only)
router.delete('/:id', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bài viết' })
        }

        await post.deleteOne()

        res.json({ ok: true, message: 'Đã xóa bài viết' })
    } catch (error) {
        console.error('DELETE /api/news/:id error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

export default router
