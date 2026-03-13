import express from 'express'
import Post from '../models/Post.js'
import Map from '../models/Map.js'
import { authMiddleware, requireAdmin, requireAdminPermission } from '../middleware/auth.js'
import { ADMIN_PERMISSIONS } from '../constants/adminPermissions.js'

const router = express.Router()

const SUPPORT_TAG = 'ung-ho'
const SUPPORT_TAG_ALIASES = new Set([
    SUPPORT_TAG,
    'ung ho',
    'ung_ho',
    'ungho',
    'ủng hộ',
    'ủng-hộ',
])

const normalizeTagValue = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    if (SUPPORT_TAG_ALIASES.has(normalized)) {
        return SUPPORT_TAG
    }
    return normalized
}

const normalizeTags = (value) => {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const tags = []

    for (const entry of value) {
        const normalized = normalizeTagValue(entry)
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        tags.push(normalized)
    }

    return tags
}

const normalizeImageUrls = (value) => {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const imageUrls = []

    for (const entry of value) {
        const normalized = String(entry || '').trim()
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        imageUrls.push(normalized)
    }

    return imageUrls
}

const toPlainText = (value = '') => {
    return String(value || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
}

const buildExcerpt = (content = '', maxLength = 220) => {
    const plainText = toPlainText(content)
    const limit = Math.max(80, Number.parseInt(maxLength, 10) || 220)
    if (plainText.length <= limit) return plainText
    return `${plainText.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

const toNewsSummary = (postLike = {}) => {
    return {
        _id: postLike?._id,
        title: String(postLike?.title || '').trim(),
        type: String(postLike?.type || 'news').trim(),
        imageUrl: String(postLike?.imageUrl || '').trim(),
        imageUrls: normalizeImageUrls(postLike?.imageUrls),
        tags: normalizeTags(postLike?.tags),
        excerpt: buildExcerpt(postLike?.content || ''),
        author: postLike?.author
            ? {
                _id: postLike.author._id,
                username: String(postLike.author.username || '').trim(),
                role: String(postLike.author.role || 'user').trim() || 'user',
                vipTierLevel: Math.max(0, Number.parseInt(postLike.author.vipTierLevel, 10) || 0),
                vipTierCode: String(postLike.author.vipTierCode || '').trim().toUpperCase(),
                vipBenefits: postLike.author.vipBenefits || {},
            }
            : null,
        mapId: postLike?.mapId
            ? {
                _id: postLike.mapId._id,
                name: String(postLike.mapId.name || '').trim(),
                slug: String(postLike.mapId.slug || '').trim(),
            }
            : null,
        createdAt: postLike?.createdAt || null,
        updatedAt: postLike?.updatedAt || null,
    }
}

// GET /api/news - Get latest published posts (public)
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10))
        const allowedTypes = ['news', 'event', 'maintenance', 'update', 'notification', 'guide']
        const requestedType = String(req.query.type || '').trim().toLowerCase()
        const requestedTag = normalizeTagValue(req.query.tag)
        const query = { isPublished: true }
        if (requestedType) {
            if (!allowedTypes.includes(requestedType)) {
                return res.status(400).json({ ok: false, message: 'Bộ lọc loại bài viết không hợp lệ' })
            }
            query.type = requestedType
        }
        if (requestedTag) {
            query.tags = requestedTag
        }

        const posts = await Post.find(query)
            .populate('author', 'username role vipTierLevel vipTierCode vipBenefits')
            .populate('mapId', 'name slug')
            .select('title content type imageUrl imageUrls tags author mapId createdAt updatedAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()

        res.json({
            ok: true,
            posts: posts.map((post) => toNewsSummary(post)),
        })
    } catch (error) {
        console.error('GET /api/news error:', error)
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ' })
    }
})

// GET /api/news/admin/all - Get all posts including unpublished (admin only)
router.get('/admin/all', authMiddleware, requireAdmin, requireAdminPermission(ADMIN_PERMISSIONS.NEWS), async (req, res) => {
    try {
        const posts = await Post.find()
            .populate('author', 'username role vipTierLevel vipTierCode vipBenefits')
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
            .populate('author', 'username role vipTierLevel vipTierCode vipBenefits')
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
        const { title, content, type, isPublished, mapId, imageUrl, imageUrls, tags } = req.body
        const normalizedMapId = typeof mapId === 'string' ? mapId.trim() : ''
        const normalizedImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : ''
        const normalizedImageUrls = normalizeImageUrls(imageUrls)
        const resolvedImageUrls = normalizedImageUrls.length > 0
            ? normalizedImageUrls
            : (normalizedImageUrl ? [normalizedImageUrl] : [])
        const resolvedImageUrl = resolvedImageUrls[0] || ''
        const normalizedTags = normalizeTags(tags)

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
            imageUrl: resolvedImageUrl,
            imageUrls: resolvedImageUrls,
            tags: normalizedTags,
        })

        await post.save()
        await post.populate([
            { path: 'author', select: 'username role vipTierLevel vipTierCode vipBenefits' },
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
        const { title, content, type, isPublished, mapId, imageUrl, imageUrls, tags } = req.body

        const post = await Post.findById(req.params.id)

        if (!post) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bài viết' })
        }

        if (title) post.title = title
        if (content) post.content = content
        if (type) post.type = type
        if (isPublished !== undefined) post.isPublished = isPublished
        if (imageUrls !== undefined) {
            const normalizedImageUrls = normalizeImageUrls(imageUrls)
            post.imageUrls = normalizedImageUrls
            post.imageUrl = normalizedImageUrls[0] || ''
        } else if (imageUrl !== undefined) {
            const normalizedImageUrl = typeof imageUrl === 'string' ? imageUrl.trim() : ''
            post.imageUrl = normalizedImageUrl
            post.imageUrls = normalizedImageUrl ? [normalizedImageUrl] : []
        }
        if (tags !== undefined) {
            post.tags = normalizeTags(tags)
        }
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
