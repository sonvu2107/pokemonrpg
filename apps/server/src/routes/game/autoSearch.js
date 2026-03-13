import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import { requireActiveGameplayTab } from '../../middleware/gameplayTabGuard.js'
import User from '../../models/User.js'
import MapModel from '../../models/Map.js'
import {
    AUTO_SEARCH_RARITY_KEYS,
    hasVipAutoSearchAccess,
    isEventMapLike,
    normalizeAutoCatchFormMode,
    normalizeAutoSearchActionByRarity,
    normalizeAutoSearchState,
    normalizeId as normalizeAutoTrainerId,
    resolveDailyState as resolveAutoSearchDailyState,
    toSafeInt as toSafeAutoTrainerInt,
} from '../../utils/autoTrainerUtils.js'
import { buildAutoSearchStatusPayload } from '../../services/autoStatusService.js'
import { resolveEffectiveVipBenefits } from '../../services/vipBenefitService.js'

const router = express.Router()

const AUTO_SEARCH_LOGS_LIMIT = 12

router.get('/auto-search/status', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits autoSearch isBanned')
            .lean()

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const effectiveVipBenefits = await resolveEffectiveVipBenefits(user)
        const normalizedState = normalizeAutoSearchState(user.autoSearch)
        const dailyLimit = toSafeAutoTrainerInt(effectiveVipBenefits?.autoSearchUsesPerDay, 0)
        const dailyState = resolveAutoSearchDailyState(normalizedState, dailyLimit)
        const runtimeMsToday = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0

        const shouldSyncState = (
            String(normalizedState.dayKey || '') !== dailyState.dayKey
            || Number(normalizedState.dayCount || 0) !== dailyState.count
            || Number(normalizedState.dayLimit || 0) !== dailyState.limit
            || Number(normalizedState.dayRuntimeMs || 0) !== runtimeMsToday
        )

        if (shouldSyncState) {
            await User.updateOne(
                { _id: req.user.userId },
                {
                    $set: {
                        'autoSearch.dayKey': dailyState.dayKey,
                        'autoSearch.dayCount': dailyState.count,
                        'autoSearch.dayLimit': dailyState.limit,
                        'autoSearch.dayRuntimeMs': runtimeMsToday,
                        'autoSearch.lastRuntimeAt': runtimeMsToday > 0 ? normalizedState.lastRuntimeAt : null,
                    },
                }
            )
        }

        const payload = await buildAutoSearchStatusPayload({
            ...user,
            autoSearch: {
                ...(user.autoSearch || {}),
                dayKey: dailyState.dayKey,
                dayCount: dailyState.count,
                dayLimit: dailyState.limit,
                dayRuntimeMs: runtimeMsToday,
            },
        })

        return res.json({ ok: true, autoSearch: payload })
    } catch (error) {
        return next(error)
    }
})

router.post('/auto-search/settings', authMiddleware, requireActiveGameplayTab({ actionLabel: 'cap nhat auto tim kiem' }), async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits autoSearch isBanned')

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const effectiveVipBenefits = await resolveEffectiveVipBenefits(user)
        const effectiveUser = {
            ...user.toObject(),
            vipBenefits: effectiveVipBenefits,
        }
        const incomingEnabled = req.body?.enabled
        const shouldUpdateEnabled = incomingEnabled === true || incomingEnabled === false
        const hasMapSlugPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'mapSlug')
        const requestedMapSlug = String(req.body?.mapSlug || '').trim().toLowerCase()
        const requestedIntervalRaw = Number(req.body?.searchIntervalMs)
        const hasIntervalPatch = Number.isFinite(requestedIntervalRaw)
        const hasActionPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'actionByRarity')
        const hasCatchFormPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'catchFormMode')
        const hasCatchBallPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'catchBallItemId')

        const normalizedState = normalizeAutoSearchState(user.autoSearch)
        const canUseVipAutoSearch = hasVipAutoSearchAccess(effectiveUser)
        const dailyLimit = toSafeAutoTrainerInt(effectiveVipBenefits?.autoSearchUsesPerDay, 0)
        const durationLimitMinutes = toSafeAutoTrainerInt(effectiveVipBenefits?.autoSearchDurationMinutes, 0)
        const dailyState = resolveAutoSearchDailyState(normalizedState, dailyLimit)
        const currentDayRuntimeMs = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0
        const currentDayRuntimeMinutes = Math.floor(currentDayRuntimeMs / 60000)

        const nextEnabled = shouldUpdateEnabled
            ? Boolean(incomingEnabled)
            : Boolean(normalizedState.enabled)
        const nextMapSlug = hasMapSlugPatch
            ? requestedMapSlug
            : String(normalizedState.mapSlug || '').trim().toLowerCase()
        const nextIntervalMs = hasIntervalPatch
            ? Math.max(900, Math.min(10000, Math.floor(requestedIntervalRaw)))
            : Math.max(900, toSafeAutoTrainerInt(normalizedState.searchIntervalMs, 1200))
        const nextActionByRarity = hasActionPatch
            ? normalizeAutoSearchActionByRarity(req.body?.actionByRarity)
            : normalizeAutoSearchActionByRarity(normalizedState.actionByRarity)
        const nextCatchFormMode = hasCatchFormPatch
            ? normalizeAutoCatchFormMode(req.body?.catchFormMode)
            : normalizeAutoCatchFormMode(normalizedState.catchFormMode)
        const nextCatchBallItemId = hasCatchBallPatch
            ? normalizeAutoTrainerId(req.body?.catchBallItemId)
            : normalizeAutoTrainerId(normalizedState.catchBallItemId)

        if (nextEnabled && !canUseVipAutoSearch) {
            return res.status(403).json({
                ok: false,
                message: 'Tài khoản hiện không có quyền lợi VIP để bật tự tìm kiếm.',
            })
        }

        if (nextEnabled && !nextMapSlug) {
            return res.status(400).json({ ok: false, message: 'Cần chọn bản đồ khi bật tự tìm kiếm.' })
        }

        let resolvedMap = null
        if (nextMapSlug) {
            resolvedMap = await MapModel.findOne({ slug: nextMapSlug })
                .select('_id slug name isEventMap autoSearchRequiredVipLevel')
                .lean()
            if (!resolvedMap && nextEnabled) {
                return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ đã chọn cho tự tìm kiếm.' })
            }
        }

        if (nextEnabled && resolvedMap && isEventMapLike(resolvedMap)) {
            return res.status(400).json({ ok: false, message: 'Bản đồ sự kiện không hỗ trợ tự tìm kiếm.' })
        }

        const currentVipLevel = Math.max(0, Number(user?.vipTierLevel) || 0)
        const autoSearchRequiredVipLevel = Math.max(0, Number(resolvedMap?.autoSearchRequiredVipLevel) || 0)
        if (nextEnabled && resolvedMap && currentVipLevel < autoSearchRequiredVipLevel) {
            return res.status(403).json({
                ok: false,
                message: `Map này yêu cầu VIP ${autoSearchRequiredVipLevel} để bật tự tìm kiếm.`,
            })
        }

        const isCatchConfigured = AUTO_SEARCH_RARITY_KEYS.some(
            (rarityKey) => String(nextActionByRarity?.[rarityKey] || '').trim().toLowerCase() === 'catch'
        )
        if (nextEnabled && isCatchConfigured && !nextCatchBallItemId) {
            return res.status(400).json({ ok: false, message: 'Có thiết lập tự bắt nhưng chưa chọn bóng.' })
        }

        if (nextEnabled && dailyLimit > 0 && dailyState.count >= dailyLimit) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết lượt tự tìm kiếm trong hôm nay (${dailyState.count}/${dailyLimit}).`,
            })
        }

        if (nextEnabled && durationLimitMinutes > 0 && currentDayRuntimeMinutes >= durationLimitMinutes) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết thời lượng tự tìm kiếm hôm nay (${currentDayRuntimeMinutes}/${durationLimitMinutes} phút).`,
            })
        }

        const now = new Date()
        const resolvedMapName = String(resolvedMap?.name || nextMapSlug || '').trim() || nextMapSlug
        const nextDayCount = dailyState.count
        const nextStartedAt = nextEnabled
            ? (normalizedState.startedAt || now)
            : null

        const updateDoc = {
            $set: {
                'autoSearch.enabled': nextEnabled,
                'autoSearch.mapSlug': nextMapSlug,
                'autoSearch.searchIntervalMs': nextIntervalMs,
                'autoSearch.actionByRarity': nextActionByRarity,
                'autoSearch.catchFormMode': nextCatchFormMode,
                'autoSearch.catchBallItemId': nextCatchBallItemId,
                'autoSearch.startedAt': nextStartedAt,
                'autoSearch.dayKey': dailyState.dayKey,
                'autoSearch.dayCount': nextDayCount,
                'autoSearch.dayLimit': dailyState.limit,
                'autoSearch.dayRuntimeMs': currentDayRuntimeMs,
                'autoSearch.lastRuntimeAt': nextEnabled ? now : null,
                'autoSearch.lastAction': {
                    action: 'toggle',
                    result: nextEnabled ? 'enabled' : 'disabled',
                    reason: '',
                    targetId: resolvedMapName,
                    at: now,
                },
            },
            $push: {
                'autoSearch.logs': {
                    $each: [{
                        message: nextEnabled
                            ? `Đã bật tự tìm kiếm tại ${resolvedMapName}.`
                            : 'Đã tắt tự tìm kiếm.',
                        type: nextEnabled ? 'success' : 'info',
                        at: now,
                    }],
                    $position: 0,
                    $slice: AUTO_SEARCH_LOGS_LIMIT,
                },
            },
        }

        await User.updateOne({ _id: req.user.userId }, updateDoc)
        const refreshedUser = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits autoSearch isBanned')
            .lean()
        const payload = await buildAutoSearchStatusPayload(refreshedUser || user.toObject())

        return res.json({ ok: true, autoSearch: payload })
    } catch (error) {
        return next(error)
    }
})

export default router
