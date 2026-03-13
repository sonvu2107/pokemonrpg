import mongoose from 'mongoose'
import Auction from '../models/Auction.js'
import AuctionBid from '../models/AuctionBid.js'
import AuctionSettlementLog from '../models/AuctionSettlementLog.js'
import PlayerState from '../models/PlayerState.js'
import UserInventory from '../models/UserInventory.js'
import UserPokemon from '../models/UserPokemon.js'
import { attachSession, getSessionOptions, runWithOptionalTransaction } from '../utils/mongoTransactions.js'

export const AUCTION_REWARD_TYPE_ITEM = 'item'
export const AUCTION_REWARD_TYPE_POKEMON = 'pokemon'
export const AUCTION_CURRENCY_WHITE_PLATINUM = 'white_platinum'
export const AUCTION_REWARD_SOURCE_USER_POKEMON_ESCROW = 'user_pokemon_escrow'
export const AUCTION_STATUS = Object.freeze({
    DRAFT: 'draft',
    SCHEDULED: 'scheduled',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    SETTLEMENT_FAILED: 'settlement_failed',
})
export const AUCTION_SETTLEMENT_STATUS = Object.freeze({
    PENDING: 'pending',
    PROCESSING: 'processing',
    SUCCESS: 'success',
    FAILED: 'failed',
})

const buildDateCodePart = (date = new Date()) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
}

const buildRandomCodeSuffix = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')

export const buildAuctionCode = () => `AUC-${buildDateCodePart(new Date())}-${buildRandomCodeSuffix()}`

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonSpriteByForm = (pokemonLike = {}, preferredFormId = 'normal', isShiny = false) => {
    const forms = Array.isArray(pokemonLike?.forms) ? pokemonLike.forms : []
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(preferredFormId || defaultFormId)
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId)
        || forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId)
        || forms[0]
        || null

    if (isShiny) {
        return String(resolvedForm?.shinyImageUrl || pokemonLike?.shinyImageUrl || resolvedForm?.imageUrl || pokemonLike?.sprite || pokemonLike?.imageUrl || '').trim()
    }
    return String(resolvedForm?.imageUrl || pokemonLike?.sprite || pokemonLike?.imageUrl || '').trim()
}

export const buildItemRewardSnapshot = (itemLike = {}, quantity = 1) => ({
    itemId: itemLike?._id,
    pokemonId: null,
    formId: 'normal',
    level: 1,
    isShiny: false,
    name: String(itemLike?.name || 'Vật phẩm').trim() || 'Vật phẩm',
    imageUrl: String(itemLike?.imageUrl || '').trim(),
    rarity: String(itemLike?.rarity || 'common').trim() || 'common',
    type: String(itemLike?.type || 'misc').trim() || 'misc',
    quantity: Math.max(1, Number.parseInt(quantity, 10) || 1),
    metadata: {
        effectType: String(itemLike?.effectType || 'none').trim() || 'none',
    },
})

export const buildPokemonRewardSnapshot = (pokemonLike = {}, options = {}) => ({
    itemId: null,
    pokemonId: pokemonLike?._id,
    formId: String(options?.formId || pokemonLike?.defaultFormId || 'normal').trim().toLowerCase() || 'normal',
    level: Math.max(1, Number.parseInt(options?.level, 10) || 5),
    isShiny: Boolean(options?.isShiny),
    name: String(options?.name || pokemonLike?.name || 'Pokemon').trim() || 'Pokemon',
    imageUrl: String(options?.imageUrl || pokemonLike?.sprite || pokemonLike?.imageUrl || '').trim(),
    rarity: String(options?.rarity || 'pokemon').trim() || 'pokemon',
    type: 'pokemon',
    quantity: Math.max(1, Number.parseInt(options?.quantity, 10) || 1),
    metadata: {
        pokemonName: String(pokemonLike?.name || options?.name || 'Pokemon').trim() || 'Pokemon',
        formName: String(options?.formName || options?.formId || 'normal').trim() || 'normal',
    },
})

export const buildUserPokemonRewardSnapshot = (userPokemonLike = {}, pokemonLike = {}) => {
    const nickname = String(userPokemonLike?.nickname || '').trim()
    const speciesName = String(pokemonLike?.name || 'Pokemon').trim() || 'Pokemon'
    const formId = normalizeFormId(userPokemonLike?.formId || pokemonLike?.defaultFormId || 'normal')
    const isShiny = Boolean(userPokemonLike?.isShiny)

    return {
        itemId: null,
        pokemonId: pokemonLike?._id || userPokemonLike?.pokemonId?._id || userPokemonLike?.pokemonId || null,
        formId,
        level: Math.max(1, Number.parseInt(userPokemonLike?.level, 10) || 5),
        isShiny,
        name: nickname ? `${nickname} (${speciesName})` : speciesName,
        imageUrl: resolvePokemonSpriteByForm(pokemonLike, formId, isShiny),
        rarity: 'pokemon',
        type: 'pokemon',
        quantity: 1,
        metadata: {
            source: AUCTION_REWARD_SOURCE_USER_POKEMON_ESCROW,
            pokemonName: speciesName,
            formName: formId,
            nickname,
            sourceUserPokemonId: String(userPokemonLike?._id || '').trim(),
            sellerUserId: String(userPokemonLike?.userId || '').trim(),
            previousLocation: String(userPokemonLike?.location || 'box').trim() || 'box',
            previousBoxNumber: Number.parseInt(userPokemonLike?.boxNumber, 10) || 1,
            previousPartyIndex: userPokemonLike?.partyIndex === null || userPokemonLike?.partyIndex === undefined
                ? null
                : Number.parseInt(userPokemonLike?.partyIndex, 10),
        },
    }
}

export const isUserPokemonEscrowRewardSnapshot = (rewardSnapshot = {}) => (
    String(rewardSnapshot?.metadata?.source || '').trim() === AUCTION_REWARD_SOURCE_USER_POKEMON_ESCROW
        && mongoose.Types.ObjectId.isValid(String(rewardSnapshot?.metadata?.sourceUserPokemonId || '').trim())
)

export const restoreEscrowedAuctionPokemon = async (auctionLike = {}, options = {}) => {
    if (!isUserPokemonEscrowRewardSnapshot(auctionLike?.rewardSnapshot)) {
        return false
    }

    const sourceUserPokemonId = String(auctionLike?.rewardSnapshot?.metadata?.sourceUserPokemonId || '').trim()
    const previousBoxNumber = Math.max(1, Number.parseInt(auctionLike?.rewardSnapshot?.metadata?.previousBoxNumber, 10) || 1)

    const result = await UserPokemon.updateOne(
        { _id: sourceUserPokemonId, status: 'active' },
        {
            $set: {
                location: 'box',
                boxNumber: previousBoxNumber,
                partyIndex: null,
            },
        },
        getSessionOptions(options?.session)
    )

    return Number(result?.modifiedCount || 0) > 0
}

export const transferEscrowedAuctionPokemonToWinner = async (auctionLike = {}, winnerId, options = {}) => {
    if (!isUserPokemonEscrowRewardSnapshot(auctionLike?.rewardSnapshot)) {
        return false
    }

    const sourceUserPokemonId = String(auctionLike?.rewardSnapshot?.metadata?.sourceUserPokemonId || '').trim()
    const now = options?.now instanceof Date ? options.now : new Date()
    const result = await UserPokemon.updateOne(
        { _id: sourceUserPokemonId, status: 'active' },
        {
            $set: {
                userId: winnerId,
                location: 'box',
                boxNumber: 1,
                partyIndex: null,
                obtainedMapName: 'Khu Dau Gia',
                obtainedAt: now,
            },
        },
        getSessionOptions(options?.session)
    )

    return Number(result?.modifiedCount || 0) > 0
}

export const releaseCompletedNoBidEscrowAuctionsForUser = async (userId, options = {}) => {
    const normalizedUserId = String(userId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
        return 0
    }

    const rows = await Auction.find({
        createdBy: normalizedUserId,
        rewardType: AUCTION_REWARD_TYPE_POKEMON,
        status: AUCTION_STATUS.COMPLETED,
        settlementStatus: AUCTION_SETTLEMENT_STATUS.SUCCESS,
        winnerId: null,
        $or: [
            { highestBid: { $exists: false } },
            { highestBid: { $lte: 0 } },
        ],
        'rewardSnapshot.metadata.source': AUCTION_REWARD_SOURCE_USER_POKEMON_ESCROW,
    })
        .select('rewardSnapshot')
        .lean()

    let restoredCount = 0
    for (const row of rows) {
        const didRestore = await restoreEscrowedAuctionPokemon(row, options)
        if (didRestore) restoredCount += 1
    }
    return restoredCount
}

export const computeAuctionMinNextBid = (auctionLike = {}) => {
    const startingBid = Math.max(1, Number(auctionLike?.startingBid || 0))
    const highestBid = Math.max(0, Number(auctionLike?.highestBid || 0))
    const minIncrement = Math.max(1, Number(auctionLike?.minIncrement || 0))
    return highestBid > 0 ? (highestBid + minIncrement) : startingBid
}

export const activateDueAuctions = async (now = new Date()) => {
    const result = await Auction.updateMany(
        {
            status: AUCTION_STATUS.SCHEDULED,
            startsAt: { $lte: now },
        },
        {
            $set: {
                status: AUCTION_STATUS.ACTIVE,
                settlementStatus: AUCTION_SETTLEMENT_STATUS.PENDING,
            },
        }
    )
    return Number(result?.modifiedCount || 0)
}

export const getAuctionEffectiveStatus = (auctionLike = {}, now = new Date()) => {
    const currentStatus = String(auctionLike?.status || '').trim()
    const startsAtMs = auctionLike?.startsAt ? new Date(auctionLike.startsAt).getTime() : 0
    const endsAtMs = auctionLike?.endsAt ? new Date(auctionLike.endsAt).getTime() : 0
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()

    if (currentStatus === AUCTION_STATUS.SCHEDULED && startsAtMs > 0 && endsAtMs > nowMs && startsAtMs <= nowMs) {
        return AUCTION_STATUS.ACTIVE
    }
    return currentStatus || AUCTION_STATUS.DRAFT
}

export const serializeAuction = (auctionLike = {}, options = {}) => {
    const currentUserId = String(options?.currentUserId || '').trim()
    const now = options?.now instanceof Date ? options.now : new Date()
    const normalizeRefId = (value) => String(value?._id || value || '').trim()
    const highestBidderId = normalizeRefId(auctionLike?.highestBidderId)
    const winnerId = normalizeRefId(auctionLike?.winnerId)

    return {
        id: String(auctionLike?._id || '').trim(),
        code: String(auctionLike?.code || '').trim(),
        title: String(auctionLike?.title || '').trim(),
        description: String(auctionLike?.description || '').trim(),
        rewardType: String(auctionLike?.rewardType || AUCTION_REWARD_TYPE_ITEM).trim(),
        rewardSnapshot: {
            itemId: String(auctionLike?.rewardSnapshot?.itemId || '').trim(),
            pokemonId: String(auctionLike?.rewardSnapshot?.pokemonId || '').trim(),
            formId: String(auctionLike?.rewardSnapshot?.formId || 'normal').trim(),
            level: Math.max(1, Number(auctionLike?.rewardSnapshot?.level || 1)),
            isShiny: Boolean(auctionLike?.rewardSnapshot?.isShiny),
            name: String(auctionLike?.rewardSnapshot?.name || '').trim(),
            imageUrl: String(auctionLike?.rewardSnapshot?.imageUrl || '').trim(),
            rarity: String(auctionLike?.rewardSnapshot?.rarity || '').trim(),
            type: String(auctionLike?.rewardSnapshot?.type || '').trim(),
            quantity: Math.max(1, Number(auctionLike?.rewardSnapshot?.quantity || 1)),
            metadata: auctionLike?.rewardSnapshot?.metadata || null,
        },
        currency: String(auctionLike?.currency || AUCTION_CURRENCY_WHITE_PLATINUM).trim(),
        startingBid: Math.max(1, Number(auctionLike?.startingBid || 0)),
        minIncrement: Math.max(1, Number(auctionLike?.minIncrement || 0)),
        minNextBid: computeAuctionMinNextBid(auctionLike),
        startsAt: auctionLike?.startsAt || null,
        endsAt: auctionLike?.endsAt || null,
        antiSnipingEnabled: Boolean(auctionLike?.antiSnipingEnabled),
        antiSnipingWindowSeconds: Math.max(0, Number(auctionLike?.antiSnipingWindowSeconds || 0)),
        antiSnipingExtendSeconds: Math.max(0, Number(auctionLike?.antiSnipingExtendSeconds || 0)),
        antiSnipingMaxExtensions: Math.max(0, Number(auctionLike?.antiSnipingMaxExtensions || 0)),
        extensionCount: Math.max(0, Number(auctionLike?.extensionCount || 0)),
        status: getAuctionEffectiveStatus(auctionLike, now),
        highestBid: Math.max(0, Number(auctionLike?.highestBid || 0)),
        highestBidderId,
        highestBidAt: auctionLike?.highestBidAt || null,
        bidCount: Math.max(0, Number(auctionLike?.bidCount || 0)),
        winnerId,
        settlementStatus: String(auctionLike?.settlementStatus || AUCTION_SETTLEMENT_STATUS.PENDING).trim(),
        settledAt: auctionLike?.settledAt || null,
        settlementError: String(auctionLike?.settlementError || '').trim(),
        cancelReason: String(auctionLike?.cancelReason || '').trim(),
        createdAt: auctionLike?.createdAt || null,
        updatedAt: auctionLike?.updatedAt || null,
        createdBy: normalizeRefId(auctionLike?.createdBy),
        updatedBy: normalizeRefId(auctionLike?.updatedBy),
        cancelledBy: normalizeRefId(auctionLike?.cancelledBy),
        isLeading: currentUserId ? highestBidderId === currentUserId : false,
        isWinner: currentUserId ? winnerId === currentUserId : false,
    }
}

export const serializeAuctionBid = (bidLike = {}) => ({
    id: String(bidLike?._id || '').trim(),
    auctionId: String(bidLike?.auctionId || '').trim(),
    userId: String(bidLike?.userId?._id || bidLike?.userId || '').trim(),
    username: String(bidLike?.userId?.username || bidLike?.username || 'Người chơi').trim() || 'Người chơi',
    role: String(bidLike?.userId?.role || bidLike?.role || 'user').trim() || 'user',
    vipTierLevel: Math.max(0, Number.parseInt(bidLike?.userId?.vipTierLevel ?? bidLike?.vipTierLevel, 10) || 0),
    vipTierCode: String(bidLike?.userId?.vipTierCode || bidLike?.vipTierCode || '').trim().toUpperCase(),
    vipBenefits: bidLike?.userId?.vipBenefits || bidLike?.vipBenefits || {},
    amount: Math.max(0, Number(bidLike?.amount || 0)),
    previousHighestBid: Math.max(0, Number(bidLike?.previousHighestBid || 0)),
    previousHighestBidderId: String(bidLike?.previousHighestBidderId || '').trim(),
    isWinningBid: Boolean(bidLike?.isWinningBid),
    createdAt: bidLike?.createdAt || null,
    updatedAt: bidLike?.updatedAt || null,
})

const maybeExtendAuctionForAntiSniping = (auctionLike = {}, now = new Date()) => {
    if (!auctionLike?.antiSnipingEnabled) {
        return { nextEndsAt: auctionLike?.endsAt || null, didExtend: false }
    }

    const endsAt = auctionLike?.endsAt ? new Date(auctionLike.endsAt) : null
    if (!endsAt || Number.isNaN(endsAt.getTime())) {
        return { nextEndsAt: auctionLike?.endsAt || null, didExtend: false }
    }

    const nowDate = now instanceof Date ? now : new Date(now)
    const remainingMs = endsAt.getTime() - nowDate.getTime()
    const windowMs = Math.max(0, Number(auctionLike?.antiSnipingWindowSeconds || 0)) * 1000
    const extendMs = Math.max(0, Number(auctionLike?.antiSnipingExtendSeconds || 0)) * 1000
    const maxExtensions = Math.max(0, Number(auctionLike?.antiSnipingMaxExtensions || 0))
    const extensionCount = Math.max(0, Number(auctionLike?.extensionCount || 0))

    if (windowMs <= 0 || extendMs <= 0) {
        return { nextEndsAt: endsAt, didExtend: false }
    }
    if (maxExtensions > 0 && extensionCount >= maxExtensions) {
        return { nextEndsAt: endsAt, didExtend: false }
    }
    if (remainingMs > windowMs) {
        return { nextEndsAt: endsAt, didExtend: false }
    }

    return {
        nextEndsAt: new Date(endsAt.getTime() + extendMs),
        didExtend: true,
    }
}

export const settleAuctionById = async (auctionId, options = {}) => {
    const normalizedAuctionId = String(auctionId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(normalizedAuctionId)) {
        throw new Error('auctionId không hợp lệ')
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    const claimedAuction = await Auction.findOneAndUpdate(
        {
            _id: normalizedAuctionId,
            $or: [
                {
                    status: AUCTION_STATUS.ACTIVE,
                    endsAt: { $lte: now },
                    settlementStatus: AUCTION_SETTLEMENT_STATUS.PENDING,
                },
                {
                    status: AUCTION_STATUS.SETTLEMENT_FAILED,
                    settlementStatus: AUCTION_SETTLEMENT_STATUS.FAILED,
                },
            ],
        },
        {
            $set: {
                settlementStatus: AUCTION_SETTLEMENT_STATUS.PROCESSING,
                updatedAt: now,
            },
        },
        { new: true }
    )
        .select('rewardType rewardSnapshot highestBid highestBidderId status settlementStatus title endsAt')
        .lean()

    if (!claimedAuction) {
        return { ok: false, skipped: true, reason: 'NOT_READY' }
    }

    await AuctionSettlementLog.create({
        auctionId: normalizedAuctionId,
        status: 'started',
        winnerId: claimedAuction?.highestBidderId || null,
        finalBid: Math.max(0, Number(claimedAuction?.highestBid || 0)),
        payloadSnapshot: {
            source: String(options?.source || 'worker').trim() || 'worker',
            at: now,
        },
    })

    if (!claimedAuction?.highestBidderId || Number(claimedAuction?.highestBid || 0) <= 0) {
        if (String(claimedAuction?.rewardType || AUCTION_REWARD_TYPE_ITEM) === AUCTION_REWARD_TYPE_POKEMON) {
            await restoreEscrowedAuctionPokemon(claimedAuction)
        }
        await Auction.findByIdAndUpdate(normalizedAuctionId, {
            $set: {
                status: AUCTION_STATUS.COMPLETED,
                settlementStatus: AUCTION_SETTLEMENT_STATUS.SUCCESS,
                settledAt: now,
                winnerId: null,
                settlementError: '',
            },
        })

        await AuctionSettlementLog.create({
            auctionId: normalizedAuctionId,
            status: 'success',
            winnerId: null,
            finalBid: 0,
            payloadSnapshot: {
                outcome: 'no_bids',
            },
        })
        return { ok: true, status: AUCTION_STATUS.COMPLETED, winnerId: null, finalBid: 0 }
    }

    try {
        let resultPayload = { ok: false, status: AUCTION_STATUS.SETTLEMENT_FAILED }

        await runWithOptionalTransaction(async (session) => {
            const auction = await attachSession(Auction.findById(normalizedAuctionId), session)
            if (!auction) {
                throw new Error('Auction không tồn tại khi settle')
            }

            const winnerId = auction.highestBidderId
            const finalBid = Math.max(0, Number(auction.highestBid || 0))
            const winnerState = await attachSession(PlayerState.findOne({ userId: winnerId }), session)
            const sellerUserId = String(auction?.rewardSnapshot?.metadata?.sellerUserId || auction?.createdBy || '').trim()

            if (!winnerState || Math.max(0, Number(winnerState.gold || 0)) < finalBid) {
                auction.status = AUCTION_STATUS.SETTLEMENT_FAILED
                auction.settlementStatus = AUCTION_SETTLEMENT_STATUS.FAILED
                auction.settledAt = now
                auction.winnerId = winnerId
                auction.settlementError = 'INSUFFICIENT_BALANCE_AT_SETTLEMENT'
                await auction.save(getSessionOptions(session))

                await AuctionSettlementLog.create([{
                    auctionId: auction._id,
                    status: 'failed',
                    winnerId,
                    finalBid,
                    errorCode: 'INSUFFICIENT_BALANCE_AT_SETTLEMENT',
                    errorMessage: 'Người thắng không đủ Xu Bạch Kim tại thời điểm chốt đấu giá.',
                    payloadSnapshot: {
                        rewardSnapshot: auction.rewardSnapshot,
                    },
                }], getSessionOptions(session))

                resultPayload = {
                    ok: true,
                    status: AUCTION_STATUS.SETTLEMENT_FAILED,
                    winnerId: String(winnerId || '').trim(),
                    finalBid,
                }
                return
            }

            winnerState.gold = Math.max(0, Number(winnerState.gold || 0) - finalBid)
            await winnerState.save(getSessionOptions(session))

            if (sellerUserId && mongoose.Types.ObjectId.isValid(sellerUserId) && sellerUserId !== String(winnerId || '').trim()) {
                await PlayerState.findOneAndUpdate(
                    { userId: sellerUserId },
                    { $inc: { gold: finalBid } },
                    getSessionOptions(session)
                )
            }

            if (String(auction.rewardType || AUCTION_REWARD_TYPE_ITEM) === AUCTION_REWARD_TYPE_POKEMON) {
                if (isUserPokemonEscrowRewardSnapshot(auction.rewardSnapshot)) {
                    const didTransferEscrow = await transferEscrowedAuctionPokemonToWinner(auction, winnerId, { session, now })
                    if (!didTransferEscrow) {
                        throw new Error('ESCROWED_POKEMON_TRANSFER_FAILED')
                    }
                } else {
                    const rewardCount = Math.max(1, Number(auction.rewardSnapshot?.quantity || 1))
                    const pokemonDocs = Array.from({ length: rewardCount }, () => ({
                        userId: winnerId,
                        pokemonId: auction.rewardSnapshot.pokemonId,
                        formId: String(auction.rewardSnapshot?.formId || 'normal').trim().toLowerCase() || 'normal',
                        level: Math.max(1, Number.parseInt(auction.rewardSnapshot?.level, 10) || 5),
                        isShiny: Boolean(auction.rewardSnapshot?.isShiny),
                        location: 'box',
                        boxNumber: 1,
                        originalTrainer: `auction_reward:${String(auction.code || auction._id)}`,
                        obtainedMapName: 'Khu Dau Gia',
                        obtainedAt: now,
                    }))
                    await UserPokemon.insertMany(pokemonDocs, getSessionOptions(session))
                }
            } else {
                await UserInventory.findOneAndUpdate(
                    { userId: winnerId, itemId: auction.rewardSnapshot.itemId },
                    {
                        $setOnInsert: {
                            userId: winnerId,
                            itemId: auction.rewardSnapshot.itemId,
                        },
                        $inc: {
                            quantity: Math.max(1, Number(auction.rewardSnapshot?.quantity || 1)),
                        },
                    },
                    getSessionOptions(session, { upsert: true, new: true })
                )
            }

            auction.status = AUCTION_STATUS.COMPLETED
            auction.settlementStatus = AUCTION_SETTLEMENT_STATUS.SUCCESS
            auction.settledAt = now
            auction.winnerId = winnerId
            auction.settlementError = ''
            await auction.save(getSessionOptions(session))

            await AuctionSettlementLog.create([{
                auctionId: auction._id,
                status: 'success',
                winnerId,
                finalBid,
                payloadSnapshot: {
                    rewardSnapshot: auction.rewardSnapshot,
                },
            }], getSessionOptions(session))

            resultPayload = {
                ok: true,
                status: AUCTION_STATUS.COMPLETED,
                winnerId: String(winnerId || '').trim(),
                finalBid,
            }
        })

        return resultPayload
    } catch (error) {
        await Auction.findByIdAndUpdate(normalizedAuctionId, {
            $set: {
                status: AUCTION_STATUS.SETTLEMENT_FAILED,
                settlementStatus: AUCTION_SETTLEMENT_STATUS.FAILED,
                settledAt: now,
                settlementError: String(error?.message || 'SETTLEMENT_EXCEPTION').slice(0, 1000),
            },
        })
        await AuctionSettlementLog.create({
            auctionId: normalizedAuctionId,
            status: 'failed',
            winnerId: claimedAuction?.highestBidderId || null,
            finalBid: Math.max(0, Number(claimedAuction?.highestBid || 0)),
            errorCode: 'SETTLEMENT_EXCEPTION',
            errorMessage: String(error?.message || 'Settle auction thất bại').slice(0, 1000),
            payloadSnapshot: {
                source: String(options?.source || 'worker').trim() || 'worker',
            },
        })
        return {
            ok: false,
            status: AUCTION_STATUS.SETTLEMENT_FAILED,
            error: error,
        }
    }
}

export const settleDueAuctions = async (options = {}) => {
    const now = options?.now instanceof Date ? options.now : new Date()
    const limit = Math.max(1, Number.parseInt(options?.limit, 10) || 25)
    const rows = await Auction.find({
        status: AUCTION_STATUS.ACTIVE,
        endsAt: { $lte: now },
        settlementStatus: AUCTION_SETTLEMENT_STATUS.PENDING,
    })
        .select('_id')
        .sort({ endsAt: 1, _id: 1 })
        .limit(limit)
        .lean()

    const results = []
    for (const row of rows) {
        results.push(await settleAuctionById(row._id, { source: options?.source || 'worker', now }))
    }
    return results
}

export const placeAuctionBid = async ({ auctionId, userId, amount }) => {
    const normalizedAuctionId = String(auctionId || '').trim()
    const normalizedUserId = String(userId || '').trim()
    const bidAmount = Math.max(1, Number.parseInt(amount, 10) || 0)

    if (!mongoose.Types.ObjectId.isValid(normalizedAuctionId)) {
        throw new Error('auctionId không hợp lệ')
    }
    if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
        throw new Error('userId không hợp lệ')
    }
    if (bidAmount <= 0) {
        throw new Error('Giá đấu không hợp lệ')
    }

    const now = new Date()
    let payload = null
    await runWithOptionalTransaction(async (session) => {
        const auction = await attachSession(Auction.findById(normalizedAuctionId), session)
        if (!auction) {
            throw new Error('Không tìm thấy phiên đấu giá')
        }

        if (auction.status === AUCTION_STATUS.SCHEDULED && new Date(auction.startsAt).getTime() <= now.getTime() && new Date(auction.endsAt).getTime() > now.getTime()) {
            auction.status = AUCTION_STATUS.ACTIVE
            auction.settlementStatus = AUCTION_SETTLEMENT_STATUS.PENDING
        }

        if (auction.status !== AUCTION_STATUS.ACTIVE) {
            throw new Error('Phiên đấu giá hiện không ở trạng thái nhận giá')
        }
        if (String(auction.createdBy || '').trim() === normalizedUserId) {
            throw new Error('Bạn không thể tự trả giá phiên đấu giá của mình')
        }
        if (new Date(auction.startsAt).getTime() > now.getTime()) {
            throw new Error('Phiên đấu giá chưa bắt đầu')
        }
        if (new Date(auction.endsAt).getTime() <= now.getTime()) {
            throw new Error('Phiên đấu giá đã kết thúc')
        }

        const buyerState = await attachSession(PlayerState.findOne({ userId: normalizedUserId }), session)
        const currentBalance = Math.max(0, Number(buyerState?.gold || 0))
        if (currentBalance < bidAmount) {
            throw new Error('Không đủ Xu Bạch Kim để đặt giá đấu này')
        }

        const minNextBid = computeAuctionMinNextBid(auction)
        if (bidAmount < minNextBid) {
            throw new Error(`Giá đấu tối thiểu hiện tại là ${minNextBid.toLocaleString('vi-VN')} Xu Bạch Kim`)
        }

        const previousHighestBid = Math.max(0, Number(auction.highestBid || 0))
        const previousHighestBidderId = auction.highestBidderId || null
        const antiSnipingResult = maybeExtendAuctionForAntiSniping(auction, now)

        const updateResult = await Auction.findOneAndUpdate(
            {
                _id: auction._id,
                status: AUCTION_STATUS.ACTIVE,
                settlementStatus: auction.settlementStatus,
                highestBid: previousHighestBid,
                bidCount: Math.max(0, Number(auction.bidCount || 0)),
                endsAt: auction.endsAt,
            },
            {
                $set: {
                    highestBid: bidAmount,
                    highestBidderId: normalizedUserId,
                    highestBidAt: now,
                    endsAt: antiSnipingResult.nextEndsAt,
                    updatedAt: now,
                },
                $inc: {
                    bidCount: 1,
                    version: 1,
                    ...(antiSnipingResult.didExtend ? { extensionCount: 1 } : {}),
                },
            },
            getSessionOptions(session, { new: true })
        )

        if (!updateResult) {
            throw new Error('Phiên đấu giá vừa có người khác trả giá trước, vui lòng thử lại')
        }

        const [bidDoc] = await AuctionBid.create([{
            auctionId: auction._id,
            userId: normalizedUserId,
            amount: bidAmount,
            previousHighestBid,
            previousHighestBidderId,
            isWinningBid: true,
        }], getSessionOptions(session))

        payload = {
            auction: updateResult,
            bid: bidDoc,
            antiSnipingExtended: antiSnipingResult.didExtend,
        }
    })

    return payload
}
