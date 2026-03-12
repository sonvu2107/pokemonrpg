const EMPTY_VIP_BENEFITS = Object.freeze({
    title: '',
    titleImageUrl: '',
    avatarFrameUrl: '',
    usernameColor: '',
    usernameGradientColor: '',
    usernameEffect: 'none',
    autoSearchEnabled: true,
    autoSearchDurationMinutes: 0,
    autoSearchUsesPerDay: 0,
    autoBattleTrainerEnabled: true,
    autoBattleTrainerDurationMinutes: 0,
    autoBattleTrainerUsesPerDay: 0,
    expBonusPercent: 0,
    platinumCoinBonusPercent: 0,
    moonPointBonusPercent: 0,
    ssCatchRateBonusPercent: 0,
    catchRateBonusPercent: 0,
    itemDropBonusPercent: 0,
    dailyRewardBonusPercent: 0,
})

let lastExpireSweepAt = 0

export const addOneMonth = (value = new Date()) => {
    const baseDate = value instanceof Date ? new Date(value) : new Date(value)
    if (Number.isNaN(baseDate.getTime())) {
        return null
    }

    const nextDate = new Date(baseDate)
    nextDate.setMonth(nextDate.getMonth() + 1)
    return nextDate
}

export const isVipCurrentlyExpired = (userLike, nowMs = Date.now()) => {
    if (!userLike || String(userLike.role || '').trim().toLowerCase() !== 'vip') {
        return false
    }

    const expiresAtMs = userLike.vipExpiresAt ? new Date(userLike.vipExpiresAt).getTime() : Number.NaN
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

export const buildVipResetPayload = () => ({
    role: 'user',
    vipTierId: null,
    vipTierLevel: 0,
    vipTierCode: '',
    vipExpiresAt: null,
    vipBenefits: { ...EMPTY_VIP_BENEFITS },
})

export const applyVipResetToUserLike = (userLike) => {
    if (!userLike || typeof userLike !== 'object') return userLike
    Object.assign(userLike, buildVipResetPayload())
    return userLike
}

export const resetExpiredVipUser = async (userDoc) => {
    if (!userDoc || !isVipCurrentlyExpired(userDoc)) {
        return userDoc
    }

    applyVipResetToUserLike(userDoc)
    await userDoc.save()
    return userDoc
}

export const expireVipUsersIfNeeded = async (UserModel, { force = false, throttleMs = 60000 } = {}) => {
    const nowMs = Date.now()
    if (!force && nowMs - lastExpireSweepAt < throttleMs) {
        return
    }

    lastExpireSweepAt = nowMs
    await UserModel.updateMany(
        {
            role: 'vip',
            vipExpiresAt: { $ne: null, $lte: new Date(nowMs) },
        },
        {
            $set: buildVipResetPayload(),
        }
    )
}
