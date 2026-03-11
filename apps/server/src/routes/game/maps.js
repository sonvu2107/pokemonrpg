import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import PlayerState from '../../models/PlayerState.js'
import MapModel from '../../models/Map.js'
import MapProgress from '../../models/MapProgress.js'
import { getOrderedMapsCached } from '../../utils/orderedMapsCache.js'
import { serializePlayerWallet } from '../../services/wildEncounterService.js'
import {
    buildProgressIndex,
    buildUnlockRequirement,
    ensureMapUnlocked,
    formatMapProgress,
    resolveSourceMapForUnlock,
} from '../../services/mapProgressionService.js'
import { buildVisibleMapsResponse, canViewVipMap } from '../../services/gameMapViewService.js'

const router = express.Router()

const getOrderedMaps = getOrderedMapsCached

router.get('/maps', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const response = await buildVisibleMapsResponse({ userId, isAdmin, currentVipLevel })

        return res.json({ ok: true, maps: response })
    } catch (error) {
        return next(error)
    }
})

router.get('/event-maps', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const maps = await buildVisibleMapsResponse({ userId, isAdmin, currentVipLevel, eventOnly: true })
        return res.json({ ok: true, maps })
    } catch (error) {
        return next(error)
    }
})

router.get('/map/:slug/state', authMiddleware, async (req, res, next) => {
    try {
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)
        const playerState = await PlayerState.findOne({ userId })
            .select('gold moonPoints level')
            .lean()
        const currentPlayerLevel = Math.max(1, Number(playerState?.level) || 1)
        const playerCurrencyState = {
            ...serializePlayerWallet(playerState),
            level: currentPlayerLevel,
        }
        const map = await MapModel.findOne({ slug: req.params.slug })

        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        if (!canViewVipMap(map, currentVipLevel, isAdmin)) {
            return res.status(403).json({
                ok: false,
                message: `Map này chỉ hiển thị cho VIP ${Math.max(0, Number(map?.vipVisibilityLevel) || 0)} trở lên`,
            })
        }

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((m) => m._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ trong thứ tự tiến trình' })
        }

        const progresses = []
        const sourceMap = resolveSourceMapForUnlock(orderedMaps, mapIndex)
        if (sourceMap?._id) {
            const sourceProgress = await MapProgress.findOne({ userId, mapId: sourceMap._id })
                .select('mapId totalSearches')
                .lean()
            if (sourceProgress) {
                progresses.push(sourceProgress)
            }
        }
        const progressById = buildProgressIndex(progresses)
        const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel, currentVipLevel)
        const isUnlocked = isAdmin || (
            unlockRequirement.remainingSearches === 0
            && unlockRequirement.remainingPlayerLevels === 0
            && unlockRequirement.remainingVipLevels === 0
        )

        if (!isUnlocked) {
            return res.status(403).json({
                ok: false,
                locked: true,
                message: 'Bản đồ chưa mở khóa',
                unlock: unlockRequirement,
                playerState: playerCurrencyState,
            })
        }

        const progress = await ensureMapUnlocked(userId, map._id)

        let currentPlayerState = await PlayerState.findOne({ userId })
        if (!currentPlayerState) {
            currentPlayerState = await PlayerState.create({ userId })
        }

        return res.json({
            ok: true,
            mapProgress: formatMapProgress(progress),
            playerState: {
                ...serializePlayerWallet(currentPlayerState),
                level: Math.max(1, Number(currentPlayerState.level) || 1),
            },
            unlock: {
                requiredSearches: Math.max(0, map.requiredSearches || 0),
                currentSearches: progress.totalSearches,
                remainingSearches: Math.max(0, (map.requiredSearches || 0) - progress.totalSearches),
                requiredPlayerLevel: unlockRequirement.requiredPlayerLevel,
                currentPlayerLevel,
                remainingPlayerLevels: Math.max(0, unlockRequirement.requiredPlayerLevel - currentPlayerLevel),
                requiredVipLevel: unlockRequirement.requiredVipLevel,
                currentVipLevel,
                remainingVipLevels: Math.max(0, unlockRequirement.requiredVipLevel - currentVipLevel),
                sourceMap: unlockRequirement.sourceMap,
            },
            isUnlocked: true,
        })
    } catch (error) {
        return next(error)
    }
})

export default router
