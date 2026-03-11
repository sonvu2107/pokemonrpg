import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import User from '../../models/User.js'
import BattleTrainer from '../../models/BattleTrainer.js'
import {
    hasVipAutoTrainerAccess,
    normalizeAutoTrainerState,
    normalizeId as normalizeAutoTrainerId,
    resolveDailyState as resolveAutoTrainerDailyState,
    toSafeInt as toSafeAutoTrainerInt,
} from '../../utils/autoTrainerUtils.js'
import { buildAutoTrainerStatusPayload } from '../../services/autoStatusService.js'
import { ensureTrainerCompletionTracked } from '../../services/mapProgressionService.js'
import { resolveEffectiveVipBenefits } from '../../services/vipBenefitService.js'

const router = express.Router()

const AUTO_TRAINER_LOGS_LIMIT = 12

router.get('/auto-trainer/status', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
            .lean()

        if (!user) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy người dùng' })
        }

        const effectiveVipBenefits = await resolveEffectiveVipBenefits(user)
        const normalizedState = normalizeAutoTrainerState(user.autoTrainer)
        const dailyLimit = toSafeAutoTrainerInt(effectiveVipBenefits?.autoBattleTrainerUsesPerDay, 0)
        const dailyState = resolveAutoTrainerDailyState(normalizedState, dailyLimit)
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
                        'autoTrainer.dayKey': dailyState.dayKey,
                        'autoTrainer.dayCount': dailyState.count,
                        'autoTrainer.dayLimit': dailyState.limit,
                        'autoTrainer.dayRuntimeMs': runtimeMsToday,
                        'autoTrainer.lastRuntimeAt': runtimeMsToday > 0 ? normalizedState.lastRuntimeAt : null,
                    },
                }
            )
        }

        const payload = await buildAutoTrainerStatusPayload({
            ...user,
            autoTrainer: {
                ...(user.autoTrainer || {}),
                dayKey: dailyState.dayKey,
                dayCount: dailyState.count,
                dayLimit: dailyState.limit,
                dayRuntimeMs: runtimeMsToday,
            },
        })

        return res.json({ ok: true, autoTrainer: payload })
    } catch (error) {
        return next(error)
    }
})

router.post('/auto-trainer/settings', authMiddleware, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')

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
        const requestedTrainerId = normalizeAutoTrainerId(req.body?.trainerId)
        const requestedClientInstanceId = normalizeAutoTrainerId(req.body?.clientInstanceId)
        const hasTrainerIdPatch = Object.prototype.hasOwnProperty.call(req.body || {}, 'trainerId')
        const requestedIntervalRaw = Number(req.body?.attackIntervalMs)
        const hasIntervalPatch = Number.isFinite(requestedIntervalRaw)
        const requestedInterval = hasIntervalPatch
            ? Math.max(450, Math.min(10000, Math.floor(requestedIntervalRaw)))
            : Math.max(450, toSafeAutoTrainerInt(user?.autoTrainer?.attackIntervalMs, 700))
        const normalizedState = normalizeAutoTrainerState(user.autoTrainer)
        const canUseVipAutoTrainer = hasVipAutoTrainerAccess(effectiveUser)
        const dailyLimit = toSafeAutoTrainerInt(effectiveVipBenefits?.autoBattleTrainerUsesPerDay, 0)
        const durationLimitMinutes = toSafeAutoTrainerInt(effectiveVipBenefits?.autoBattleTrainerDurationMinutes, 0)
        const dailyState = resolveAutoTrainerDailyState(normalizedState, dailyLimit)
        const currentDayRuntimeMs = String(normalizedState.dayKey || '') === dailyState.dayKey
            ? Math.max(0, Number(normalizedState.dayRuntimeMs || 0))
            : 0
        const currentDayRuntimeMinutes = Math.floor(currentDayRuntimeMs / 60000)

        const targetTrainerId = hasTrainerIdPatch
            ? requestedTrainerId
            : normalizeAutoTrainerId(normalizedState.trainerId)

        const nextEnabled = shouldUpdateEnabled
            ? Boolean(incomingEnabled)
            : Boolean(normalizedState.enabled)
        const storedClientInstanceId = normalizeAutoTrainerId(normalizedState.clientInstanceId)

        if (shouldUpdateEnabled && !nextEnabled) {
            console.warn('[auto-trainer-settings] disable request received:', {
                userId: req.user.userId,
                requestedTrainerId,
                targetTrainerId,
                requestedClientInstanceId,
                storedClientInstanceId,
                incomingEnabled,
                normalizedStateEnabled: Boolean(normalizedState.enabled),
                body: req.body,
                userAgent: req.get('user-agent') || '',
                referer: req.get('referer') || '',
                origin: req.get('origin') || '',
            })
        }

        if (nextEnabled && !canUseVipAutoTrainer) {
            return res.status(403).json({
                ok: false,
                message: 'Tài khoản hiện không có quyền lợi VIP để bật auto.',
            })
        }

        if (nextEnabled && dailyLimit > 0 && dailyState.count >= dailyLimit) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết lượt auto trong hôm nay (${dailyState.count}/${dailyLimit}).`,
            })
        }

        if (nextEnabled && durationLimitMinutes > 0 && currentDayRuntimeMinutes >= durationLimitMinutes) {
            return res.status(400).json({
                ok: false,
                message: `Đã hết thời gian auto trong hôm nay (${currentDayRuntimeMinutes}/${durationLimitMinutes} phút).`,
            })
        }

        if (nextEnabled) {
            if (!targetTrainerId) {
                return res.status(400).json({ ok: false, message: 'Hãy chọn trainer đã hoàn thành để bật auto.' })
            }

            const trainerExists = await BattleTrainer.exists({
                _id: targetTrainerId,
                $or: [
                    { isActive: true },
                    { isActive: { $exists: false } },
                    { isActive: null },
                ],
            })
            if (!trainerExists) {
                return res.status(404).json({ ok: false, message: 'Trainer đã chọn không còn khả dụng.' })
            }

            const completedList = (Array.isArray(user.completedBattleTrainers) ? user.completedBattleTrainers : [])
                .map((entry) => normalizeAutoTrainerId(entry))
            const isCompletedTrainer = completedList.includes(targetTrainerId)
            if (!isCompletedTrainer) {
                console.warn('[auto-trainer-settings] auto-repair: adding trainer to completedBattleTrainers:', {
                    targetTrainerId,
                    completedCount: completedList.length,
                    userId: req.user.userId,
                })
                await ensureTrainerCompletionTracked(req.user.userId, targetTrainerId)
            }
        }

        const now = new Date()
        const updateDoc = {
            $set: {
                'autoTrainer.enabled': nextEnabled,
                'autoTrainer.trainerId': targetTrainerId,
                'autoTrainer.clientInstanceId': shouldUpdateEnabled
                    ? (nextEnabled ? requestedClientInstanceId : '')
                    : storedClientInstanceId,
                'autoTrainer.attackIntervalMs': requestedInterval,
                'autoTrainer.startedAt': nextEnabled ? (normalizedState.startedAt || now) : null,
                'autoTrainer.dayKey': dailyState.dayKey,
                'autoTrainer.dayCount': dailyState.count,
                'autoTrainer.dayLimit': dailyState.limit,
                'autoTrainer.dayRuntimeMs': currentDayRuntimeMs,
                'autoTrainer.lastRuntimeAt': nextEnabled ? now : null,
                'autoTrainer.lastAction': {
                    action: 'toggle',
                    result: nextEnabled ? 'enabled' : 'disabled',
                    reason: '',
                    targetId: targetTrainerId,
                    at: now,
                },
            },
            $push: {
                'autoTrainer.logs': {
                    $each: [{
                        message: nextEnabled
                            ? `Đã bật auto với HLV ${targetTrainerId}.`
                            : 'Đã tắt auto.',
                        type: nextEnabled ? 'success' : 'info',
                        at: now,
                    }],
                    $position: 0,
                    $slice: AUTO_TRAINER_LOGS_LIMIT,
                },
            },
        }

        await User.updateOne({ _id: req.user.userId }, updateDoc)
        const refreshedUser = await User.findById(req.user.userId)
            .select('role vipTierId vipTierLevel vipBenefits completedBattleTrainers autoTrainer isBanned')
            .lean()
        const payload = await buildAutoTrainerStatusPayload(refreshedUser || user.toObject())

        return res.json({ ok: true, autoTrainer: payload })
    } catch (error) {
        return next(error)
    }
})

export default router
