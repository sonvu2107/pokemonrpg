import express from 'express'
import Post from '../models/Post.js'
import { authMiddleware, requireAdmin, requireAdminPermission } from '../middleware/auth.js'
import { ADMIN_PERMISSIONS } from '../constants/adminPermissions.js'

const router = express.Router()

// GET /api/news - Get latest published posts (public)
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10
        const allowedTypes = ['news', 'event', 'maintenance', 'update']
        const requestedType = String(req.query.type || '').trim().toLowerCase()
        const query = { isPublished: true }
        if (requestedType) {
            if (!allowedTypes.includes(requestedType)) {
                return res.status(400).json({ ok: false, message: 'Invalid post type filter' })
            }
            query.type = requestedType
        }

        const posts = await Post.find(query)
            .populate('author', 'username')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()

        res.json({ ok: true, posts })
    } catch (error) {
        console.error('GET /api/news error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/news/:id - Get single post (public)
router.get('/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)
            .populate('author', 'username')

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Post not found' })
        }

        res.json({ ok: true, post })
    } catch (error) {
        console.error('GET /api/news/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// GET /api/news/admin/all - Get all posts including unpublished (admin only)
router.get('/admin/all', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const posts = await Post.find()
            .populate('author', 'username')
            .sort({ createdAt: -1 })
            .lean()

        res.json({ ok: true, posts })
    } catch (error) {
        console.error('GET /api/news/admin/all error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

// POST /api/news - Create post (admin only)
router.post('/', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const { title, content, type, isPublished } = req.body

        if (!title || !content) {
            return res.status(400).json({ ok: false, message: 'Title and content are required' })
        }

        const post = new Post({
            title,
            content,
            author: req.user.userId,
            type: type || 'news',
            isPublished: isPublished !== undefined ? isPublished : true,
        })

        await post.save()
        await post.populate('author', 'username')

        res.status(201).json({ ok: true, post })
    } catch (error) {
        console.error('POST /api/news error:', error)
        res.status(500).json({ ok: false, message: error.message })
    }
})

// PUT /api/news/:id - Update post (admin only)
router.put('/:id', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const { title, content, type, isPublished } = req.body

        const post = await Post.findById(req.params.id)

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Post not found' })
        }

        if (title) post.title = title
        if (content) post.content = content
        if (type) post.type = type
        if (isPublished !== undefined) post.isPublished = isPublished

        await post.save()
        await post.populate('author', 'username')

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
            return res.status(404).json({ ok: false, message: 'Post not found' })
        }

        await post.deleteOne()

        res.json({ ok: true, message: 'Post deleted' })
    } catch (error) {
        console.error('DELETE /api/news/:id error:', error)
        res.status(500).json({ ok: false, message: 'Server error' })
    }
})

export default router
