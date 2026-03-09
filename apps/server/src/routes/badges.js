import express from 'express'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { authMiddleware } from '../middleware/auth.js'
import BadgeDefinition from '../models/BadgeDefinition.js'
import { BADGE_MAX_EQUIPPED, buildBadgeOverviewForUser } from '../utils/badgeUtils.js'

const router = express.Router()

router.get('/', authMiddleware, async (req, res) => {
    try {
        const overview = await buildBadgeOverviewForUser(req.user.userId)
        res.json({
            ok: true,
            badges: overview.badges,
            equippedBadgeIds: overview.equippedBadgeIds,
            equippedBadges: overview.equippedBadges,
            activeBonuses: overview.activeBonuses,
            meta: {
                maxEquipped: BADGE_MAX_EQUIPPED,
            },
        })
    } catch (error) {
        console.error('GET /api/badges error:', error)
        res.status(500).json({ ok: false, message: 'Không thể tải danh sách huy hiệu' })
    }
})

router.put('/equipped', authMiddleware, async (req, res) => {
    try {
        const inputIds = Array.isArray(req.body?.badgeIds) ? req.body.badgeIds : []
        const badgeIds = [...new Set(inputIds
            .map((entry) => String(entry || '').trim())
            .filter((entry) => mongoose.Types.ObjectId.isValid(entry)))]

        if (badgeIds.length > BADGE_MAX_EQUIPPED) {
            return res.status(400).json({ ok: false, message: `Chỉ được trưng bày tối đa ${BADGE_MAX_EQUIPPED} huy hiệu` })
        }

        const [user, overview, definitions] = await Promise.all([
            User.findById(req.user.userId).select('equippedBadgeIds'),
            buildBadgeOverviewForUser(req.user.userId),
            badgeIds.length > 0
                ? BadgeDefinition.find({ _id: { $in: badgeIds }, isActive: true }).select('_id').lean()
                : Promise.resolve([]),
        ])

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người chơi' })
        }

        const unlockedBadgeIds = new Set(overview.badges.filter((badge) => badge.isUnlocked && badge.isActive).map((badge) => String(badge._id || '')))
        const existingBadgeIds = new Set(definitions.map((badge) => String(badge?._id || '')))

        for (const badgeId of badgeIds) {
            if (!existingBadgeIds.has(badgeId)) {
                return res.status(404).json({ ok: false, message: 'Có huy hiệu không tồn tại hoặc đã bị tắt' })
            }
            if (!unlockedBadgeIds.has(badgeId)) {
                return res.status(400).json({ ok: false, message: 'Chỉ có thể trưng bày huy hiệu đã mở khóa' })
            }
        }

        user.equippedBadgeIds = badgeIds
        await user.save()

        const nextOverview = await buildBadgeOverviewForUser(req.user.userId, { userDoc: user.toObject() })
        res.json({
            ok: true,
            message: 'Đã cập nhật huy hiệu trưng bày',
            equippedBadgeIds: nextOverview.equippedBadgeIds,
            equippedBadges: nextOverview.equippedBadges,
            activeBonuses: nextOverview.activeBonuses,
        })
    } catch (error) {
        console.error('PUT /api/badges/equipped error:', error)
        res.status(500).json({ ok: false, message: 'Không thể cập nhật huy hiệu trưng bày' })
    }
})

export default router
