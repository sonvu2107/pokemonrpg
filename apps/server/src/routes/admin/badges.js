import express from 'express'
import mongoose from 'mongoose'
import BadgeDefinition from '../../models/BadgeDefinition.js'
import {
    BADGE_MAX_EQUIPPED,
    normalizeBadgeRank,
    serializeBadgeDefinition,
    validateBadgeUpsertPayload,
} from '../../utils/badgeUtils.js'

const router = express.Router()

const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

router.get('/', async (req, res) => {
    try {
        const search = String(req.query?.search || '').trim()
        const status = String(req.query?.status || '').trim().toLowerCase()
        const missionType = String(req.query?.missionType || '').trim()
        const rank = normalizeBadgeRank(req.query?.rank || '')
        const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1)
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 20))
        const skip = (page - 1) * limit
        const query = {}

        if (search) {
            const regex = new RegExp(escapeRegExp(search), 'i')
            query.$or = [{ name: regex }, { code: regex }, { slug: regex }, { description: regex }]
        }
        if (status === 'active') query.isActive = true
        if (status === 'inactive') query.isActive = false
        if (missionType) query.missionType = missionType
        if (String(req.query?.rank || '').trim()) query.rank = rank

        const [rows, total] = await Promise.all([
            BadgeDefinition.find(query)
                .sort({ orderIndex: 1, createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            BadgeDefinition.countDocuments(query),
        ])

        res.json({
            ok: true,
            badges: rows.map((entry) => serializeBadgeDefinition(entry)),
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
            meta: {
                maxEquipped: BADGE_MAX_EQUIPPED,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/badges error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải danh sách huy hiệu admin' })
    }
})

router.get('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ ok: false, message: 'ID huy hiệu không hợp lệ' })
        }

        const badge = await BadgeDefinition.findById(req.params.id).lean()
        if (!badge) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huy hiệu' })
        }

        res.json({ ok: true, badge: serializeBadgeDefinition(badge) })
    } catch (error) {
        console.error('GET /api/admin/badges/:id error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải huy hiệu' })
    }
})

router.post('/', async (req, res) => {
    try {
        const payload = validateBadgeUpsertPayload(req.body || {})
        if (!payload.name) {
            return res.status(400).json({ ok: false, message: 'Tên huy hiệu là bắt buộc' })
        }

        const duplicate = await BadgeDefinition.findOne({
            $or: [{ code: payload.code }, { slug: payload.slug }],
        }).select('_id').lean()
        if (duplicate) {
            return res.status(409).json({ ok: false, message: 'Mã hoặc slug huy hiệu đã tồn tại' })
        }

        const badge = await BadgeDefinition.create({
            ...payload,
            createdBy: req.user?.userId || null,
            updatedBy: req.user?.userId || null,
        })

        res.status(201).json({ ok: true, badge: serializeBadgeDefinition(badge.toObject()) })
    } catch (error) {
        console.error('POST /api/admin/badges error:', error)
        res.status(400).json({ ok: false, message: error?.message || 'Không thể tạo huy hiệu' })
    }
})

router.put('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ ok: false, message: 'ID huy hiệu không hợp lệ' })
        }

        const badge = await BadgeDefinition.findById(req.params.id)
        if (!badge) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huy hiệu' })
        }

        const payload = validateBadgeUpsertPayload(req.body || {})
        if (!payload.name) {
            return res.status(400).json({ ok: false, message: 'Tên huy hiệu là bắt buộc' })
        }

        const duplicate = await BadgeDefinition.findOne({
            _id: { $ne: badge._id },
            $or: [{ code: payload.code }, { slug: payload.slug }],
        }).select('_id').lean()
        if (duplicate) {
            return res.status(409).json({ ok: false, message: 'Mã hoặc slug huy hiệu đã tồn tại' })
        }

        Object.assign(badge, payload, { updatedBy: req.user?.userId || null })
        await badge.save()

        res.json({ ok: true, badge: serializeBadgeDefinition(badge.toObject()) })
    } catch (error) {
        console.error('PUT /api/admin/badges/:id error:', error)
        res.status(400).json({ ok: false, message: error?.message || 'Không thể cập nhật huy hiệu' })
    }
})

router.delete('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ ok: false, message: 'ID huy hiệu không hợp lệ' })
        }
        const deleted = await BadgeDefinition.findByIdAndDelete(req.params.id).lean()
        if (!deleted) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy huy hiệu' })
        }

        res.json({ ok: true, message: 'Đã xóa huy hiệu' })
    } catch (error) {
        console.error('DELETE /api/admin/badges/:id error:', error)
        res.status(500).json({ ok: false, message: 'Không thể xóa huy hiệu' })
    }
})

export default router
