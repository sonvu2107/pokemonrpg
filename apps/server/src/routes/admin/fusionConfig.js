import express from 'express'
import mongoose from 'mongoose'
import FusionConfig from '../../models/FusionConfig.js'
import FusionConfigRevision from '../../models/FusionConfigRevision.js'
import {
    DEFAULT_FUSION_RUNTIME_CONFIG,
    normalizeFusionRuntimeConfig,
} from '../../utils/fusionUtils.js'
import { clearFusionRuntimeConfigCache } from '../../utils/fusionRuntimeConfig.js'

const router = express.Router()

const FUSION_CONFIG_KEY = 'global'
const FUSION_CONFIG_HISTORY_LIMIT_MAX = 100
const toChangeNote = (value = '') => String(value || '').trim().slice(0, 300)

const toRevisionPayload = (entry = null) => {
    const normalized = normalizeFusionRuntimeConfig({
        strictMaterialUntilFusionLevel: entry?.strictMaterialUntilFusionLevel,
        superFusionStoneBonusPercent: entry?.superFusionStoneBonusPercent,
        finalSuccessRateCapPercent: entry?.finalSuccessRateCapPercent,
        baseSuccessRateByFusionLevel: entry?.baseSuccessRateByFusionLevel,
        totalStatBonusPercentByFusionLevel: entry?.totalStatBonusPercentByFusionLevel,
        failurePenaltyByLevelBracket: entry?.failurePenaltyByLevelBracket,
        failureLevelThresholdByBracket: entry?.failureLevelThresholdByBracket,
        milestones: entry?.milestones,
    })

    return {
        strictMaterialUntilFusionLevel: normalized.strictMaterialUntilFusionLevel,
        superFusionStoneBonusPercent: normalized.superFusionStoneBonusPercent,
        finalSuccessRateCapPercent: normalized.finalSuccessRateCapPercent,
        baseSuccessRateByFusionLevel: normalized.baseSuccessRateByFusionLevel,
        totalStatBonusPercentByFusionLevel: normalized.totalStatBonusPercentByFusionLevel,
        failurePenaltyByLevelBracket: normalized.failurePenaltyByLevelBracket,
        failureLevelThresholdByBracket: normalized.failureLevelThresholdByBracket,
        milestones: normalized.milestones,
    }
}

const toSerializableConfig = (entry = null) => {
    const normalized = toRevisionPayload(entry)

    return {
        ...normalized,
        updatedAt: entry?.updatedAt || null,
        updatedBy: entry?.updatedBy && typeof entry.updatedBy === 'object'
            ? {
                _id: entry.updatedBy._id || null,
                username: entry.updatedBy.username || '',
            }
            : null,
    }
}

const toSerializableRevision = (entry = null) => {
    if (!entry) return null
    return {
        _id: entry._id,
        key: entry.key,
        action: entry.action,
        changeNote: String(entry?.changeNote || '').trim(),
        rollbackFromRevisionId: entry.rollbackFromRevisionId || null,
        ...toRevisionPayload(entry),
        createdAt: entry.createdAt || null,
        updatedBy: entry?.updatedBy && typeof entry.updatedBy === 'object'
            ? {
                _id: entry.updatedBy._id || null,
                username: entry.updatedBy.username || '',
            }
            : null,
    }
}

const createHistorySnapshot = async ({
    configLike,
    updatedBy = null,
    action = 'update',
    rollbackFromRevisionId = null,
    changeNote = '',
} = {}) => {
    if (!configLike) return null

    const payload = toRevisionPayload(configLike)
    return FusionConfigRevision.create({
        key: FUSION_CONFIG_KEY,
        action: action === 'rollback' ? 'rollback' : 'update',
        changeNote: toChangeNote(changeNote),
        rollbackFromRevisionId: rollbackFromRevisionId || null,
        ...payload,
        updatedBy: updatedBy || null,
    })
}

const getOrCreateFusionConfig = async () => {
    let config = await FusionConfig.findOne({ key: FUSION_CONFIG_KEY })
        .populate('updatedBy', 'username')
    if (config) return config

    config = await FusionConfig.create({
        key: FUSION_CONFIG_KEY,
        ...DEFAULT_FUSION_RUNTIME_CONFIG,
    })
    return FusionConfig.findById(config._id).populate('updatedBy', 'username')
}

// GET /api/admin/fusion-config
router.get('/', async (_req, res) => {
    try {
        const config = await getOrCreateFusionConfig()
        return res.json({
            ok: true,
            config: toSerializableConfig(config),
        })
    } catch (error) {
        console.error('GET /api/admin/fusion-config error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải cấu hình ghép Pokemon' })
    }
})

// PUT /api/admin/fusion-config
router.put('/', async (req, res) => {
    try {
        const nextConfig = normalizeFusionRuntimeConfig(req.body || {})
        const changeNote = toChangeNote(req.body?.changeNote)

        const saved = await FusionConfig.findOneAndUpdate(
            { key: FUSION_CONFIG_KEY },
            {
                $set: {
                    ...nextConfig,
                    updatedBy: req.user?.userId || null,
                },
                $setOnInsert: {
                    key: FUSION_CONFIG_KEY,
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
            }
        )
            .populate('updatedBy', 'username')

        await createHistorySnapshot({
            configLike: saved,
            updatedBy: req.user?.userId || null,
            action: 'update',
            changeNote,
        })
        clearFusionRuntimeConfigCache()

        return res.json({
            ok: true,
            message: 'Đã cập nhật cấu hình ghép Pokemon',
            config: toSerializableConfig(saved),
        })
    } catch (error) {
        console.error('PUT /api/admin/fusion-config error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể cập nhật cấu hình ghép Pokemon' })
    }
})

// GET /api/admin/fusion-config/history?page=&limit=
router.get('/history', async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
        const limit = Math.max(1, Math.min(FUSION_CONFIG_HISTORY_LIMIT_MAX, Number.parseInt(req.query.limit, 10) || 20))
        const action = String(req.query.action || '').trim().toLowerCase()
        const keyword = String(req.query.keyword || '').trim()
        const updatedBy = String(req.query.updatedBy || '').trim()
        const fromDateRaw = String(req.query.fromDate || '').trim()
        const toDateRaw = String(req.query.toDate || '').trim()
        const sort = String(req.query.sort || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc'
        const skip = (page - 1) * limit

        const query = { key: FUSION_CONFIG_KEY }
        if (action === 'update' || action === 'rollback') {
            query.action = action
        }

        if (keyword) {
            query.changeNote = { $regex: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
        }

        if (updatedBy && mongoose.Types.ObjectId.isValid(updatedBy)) {
            query.updatedBy = updatedBy
        }

        const dateQuery = {}
        if (fromDateRaw) {
            const fromDate = new Date(fromDateRaw)
            if (!Number.isNaN(fromDate.getTime())) {
                dateQuery.$gte = fromDate
            }
        }
        if (toDateRaw) {
            const toDate = new Date(toDateRaw)
            if (!Number.isNaN(toDate.getTime())) {
                toDate.setHours(23, 59, 59, 999)
                dateQuery.$lte = toDate
            }
        }
        if (Object.keys(dateQuery).length > 0) {
            query.createdAt = dateQuery
        }

        const sortOrder = sort === 'asc' ? 1 : -1

        const [rows, total] = await Promise.all([
            FusionConfigRevision.find(query)
                .sort({ createdAt: sortOrder, _id: sortOrder })
                .skip(skip)
                .limit(limit)
                .populate('updatedBy', 'username')
                .lean(),
            FusionConfigRevision.countDocuments(query),
        ])

        return res.json({
            ok: true,
            rows: rows.map((entry) => toSerializableRevision(entry)),
            pagination: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
            filters: {
                action: query.action || '',
                keyword,
                updatedBy,
                fromDate: fromDateRaw,
                toDate: toDateRaw,
                sort,
            },
        })
    } catch (error) {
        console.error('GET /api/admin/fusion-config/history error:', error)
        return res.status(500).json({ ok: false, message: 'Không thể tải lịch sử cấu hình ghép Pokemon' })
    }
})

// POST /api/admin/fusion-config/rollback/:revisionId
router.post('/rollback/:revisionId', async (req, res) => {
    try {
        const revisionId = String(req.params.revisionId || '').trim()
        const changeNote = toChangeNote(req.body?.changeNote)
        if (!mongoose.Types.ObjectId.isValid(revisionId)) {
            return res.status(400).json({ ok: false, message: 'revisionId không hợp lệ' })
        }

        const revision = await FusionConfigRevision.findOne({
            _id: revisionId,
            key: FUSION_CONFIG_KEY,
        }).lean()

        if (!revision) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiên bản cấu hình để rollback' })
        }

        const rollbackConfig = toRevisionPayload(revision)

        const saved = await FusionConfig.findOneAndUpdate(
            { key: FUSION_CONFIG_KEY },
            {
                $set: {
                    ...rollbackConfig,
                    updatedBy: req.user?.userId || null,
                },
                $setOnInsert: {
                    key: FUSION_CONFIG_KEY,
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
            }
        )
            .populate('updatedBy', 'username')

        await createHistorySnapshot({
            configLike: saved,
            updatedBy: req.user?.userId || null,
            action: 'rollback',
            rollbackFromRevisionId: revision._id,
            changeNote,
        })
        clearFusionRuntimeConfigCache()

        return res.json({
            ok: true,
            message: 'Đã rollback cấu hình ghép Pokemon thành công',
            config: toSerializableConfig(saved),
        })
    } catch (error) {
        console.error('POST /api/admin/fusion-config/rollback/:revisionId error:', error)
        return res.status(500).json({ ok: false, message: 'Rollback cấu hình ghép Pokemon thất bại' })
    }
})

export default router
