import mongoose from 'mongoose'
import FusionConfig from '../models/FusionConfig.js'
import {
    DEFAULT_FUSION_RUNTIME_CONFIG,
    normalizeFusionRuntimeConfig,
} from './fusionUtils.js'

const FUSION_CONFIG_KEY = 'global'
const FUSION_RUNTIME_CACHE_TTL_MS = 30 * 1000

let cachedFusionRuntimeConfig = null
let cachedFusionRuntimeConfigExpiresAt = 0
let fusionRuntimeConfigInFlight = null

export const clearFusionRuntimeConfigCache = () => {
    cachedFusionRuntimeConfig = null
    cachedFusionRuntimeConfigExpiresAt = 0
    fusionRuntimeConfigInFlight = null
}

export const loadFusionRuntimeConfig = async ({ forceRefresh = false } = {}) => {
    const fallbackConfig = normalizeFusionRuntimeConfig(DEFAULT_FUSION_RUNTIME_CONFIG)
    if (mongoose.connection.readyState !== 1) {
        return fallbackConfig
    }

    const now = Date.now()
    if (!forceRefresh && cachedFusionRuntimeConfig && cachedFusionRuntimeConfigExpiresAt > now) {
        return cachedFusionRuntimeConfig
    }

    if (!forceRefresh && fusionRuntimeConfigInFlight) {
        return fusionRuntimeConfigInFlight
    }

    fusionRuntimeConfigInFlight = FusionConfig.findOne({ key: FUSION_CONFIG_KEY })
        .select('strictMaterialUntilFusionLevel superFusionStoneBonusPercent finalSuccessRateCapPercent baseSuccessRateByFusionLevel totalStatBonusPercentByFusionLevel failurePenaltyByLevelBracket failureLevelThresholdByBracket milestones')
        .lean()
        .then((configDoc) => {
            if (!configDoc) {
                return fallbackConfig
            }

            return normalizeFusionRuntimeConfig({
                strictMaterialUntilFusionLevel: configDoc.strictMaterialUntilFusionLevel,
                superFusionStoneBonusPercent: configDoc.superFusionStoneBonusPercent,
                finalSuccessRateCapPercent: configDoc.finalSuccessRateCapPercent,
                baseSuccessRateByFusionLevel: configDoc.baseSuccessRateByFusionLevel,
                totalStatBonusPercentByFusionLevel: configDoc.totalStatBonusPercentByFusionLevel,
                failurePenaltyByLevelBracket: configDoc.failurePenaltyByLevelBracket,
                failureLevelThresholdByBracket: configDoc.failureLevelThresholdByBracket,
                milestones: configDoc.milestones,
            })
        })
        .then((resolvedConfig) => {
            cachedFusionRuntimeConfig = resolvedConfig
            cachedFusionRuntimeConfigExpiresAt = Date.now() + FUSION_RUNTIME_CACHE_TTL_MS
            fusionRuntimeConfigInFlight = null
            return resolvedConfig
        })
        .catch((error) => {
            cachedFusionRuntimeConfig = fallbackConfig
            cachedFusionRuntimeConfigExpiresAt = Date.now() + Math.min(FUSION_RUNTIME_CACHE_TTL_MS, 5000)
            fusionRuntimeConfigInFlight = null
            return fallbackConfig
        })

    return fusionRuntimeConfigInFlight
}
