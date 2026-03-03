import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'
import Map from '../models/Map.js'
import MapProgress from '../models/MapProgress.js'
import PlayerState from '../models/PlayerState.js'

dotenv.config()

const DEFAULT_EMAIL = 'aduprovip@gmail.com'
const MIN_TARGET_SEARCHES = 10000

const readArgValue = (flag, fallback = '') => {
    const argv = process.argv.slice(2)
    const index = argv.indexOf(flag)
    if (index === -1) return fallback
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) return fallback
    return String(value).trim()
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const includesKanto = (value) => /(^|[^a-z])kanto([^a-z]|$)/i.test(String(value || '').toLowerCase())

const resolveKantoMaps = (orderedMaps) => {
    const maps = Array.isArray(orderedMaps) ? orderedMaps : []
    const explicitKantoMaps = maps.filter((map) => includesKanto(map.slug) || includesKanto(map.name))

    if (explicitKantoMaps.length > 0) {
        return {
            maps: explicitKantoMaps,
            reason: 'matched by slug/name containing "kanto"',
        }
    }

    const nonLegendaryMaps = maps.filter((map) => !map.isLegendary)
    return {
        maps: nonLegendaryMaps,
        reason: 'fallback to non-legendary track',
    }
}

const run = async () => {
    const email = normalizeEmail(readArgValue('--email', DEFAULT_EMAIL) || DEFAULT_EMAIL)

    if (!email) {
        throw new Error('Email không hợp lệ')
    }

    try {
        await connectDB()

        const user = await User.findOne({ email }).select('_id email username').lean()
        if (!user) {
            throw new Error(`Không tìm thấy user với email: ${email}`)
        }

        const orderedMaps = await Map.find({})
            .select('name slug isLegendary requiredSearches requiredPlayerLevel orderIndex')
            .sort({ orderIndex: 1, createdAt: 1, _id: 1 })
            .lean()

        const { maps: kantoMaps, reason } = resolveKantoMaps(orderedMaps)
        if (kantoMaps.length === 0) {
            throw new Error('Không tìm thấy map Kanto để cập nhật tiến độ')
        }

        const kantoMapIds = kantoMaps.map((map) => map._id)
        const existingProgresses = await MapProgress.find({
            userId: user._id,
            mapId: { $in: kantoMapIds },
        })
            .select('mapId totalSearches')
            .lean()

        const existingByMapId = new Map(
            existingProgresses.map((entry) => [entry.mapId.toString(), Number(entry.totalSearches) || 0])
        )

        const now = new Date()
        const bulkOps = kantoMaps.map((map) => {
            const requiredSearches = Math.max(0, Number(map.requiredSearches) || 0)
            const existingSearches = existingByMapId.get(map._id.toString()) || 0
            const targetSearches = Math.max(requiredSearches, existingSearches, MIN_TARGET_SEARCHES)

            return {
                updateOne: {
                    filter: { userId: user._id, mapId: map._id },
                    update: {
                        $setOnInsert: {
                            userId: user._id,
                            mapId: map._id,
                            level: 1,
                            exp: 0,
                        },
                        $set: {
                            totalSearches: targetSearches,
                            isUnlocked: true,
                            unlockedAt: now,
                            lastSearchedAt: now,
                        },
                    },
                    upsert: true,
                },
            }
        })

        if (bulkOps.length > 0) {
            await MapProgress.bulkWrite(bulkOps, { ordered: false })
        }

        const maxRequiredPlayerLevel = kantoMaps.reduce((maxLevel, map) => {
            const requiredLevel = Math.max(1, Number(map.requiredPlayerLevel) || 1)
            return Math.max(maxLevel, requiredLevel)
        }, 1)

        const playerState = await PlayerState.findOne({ userId: user._id })
            .select('level')
            .lean()

        const currentLevel = Math.max(1, Number(playerState?.level) || 1)
        const targetLevel = Math.max(currentLevel, maxRequiredPlayerLevel)

        await PlayerState.findOneAndUpdate(
            { userId: user._id },
            {
                $setOnInsert: { userId: user._id },
                $set: {
                    level: targetLevel,
                },
            },
            { upsert: true, new: true }
        )

        console.log('=== Set Kanto Max Map Progress ===')
        console.log(`User: ${user.email} (${user.username || 'no-username'})`)
        console.log(`Resolved Kanto maps: ${kantoMaps.length} (${reason})`)
        console.log(`Min target searches/map: ${MIN_TARGET_SEARCHES}`)
        console.log(`Player level after update: ${targetLevel}`)
        console.log('Updated maps:')

        kantoMaps.forEach((map, index) => {
            const requiredSearches = Math.max(0, Number(map.requiredSearches) || 0)
            const existingSearches = existingByMapId.get(map._id.toString()) || 0
            const targetSearches = Math.max(requiredSearches, existingSearches, MIN_TARGET_SEARCHES)
            console.log(
                `${index + 1}. ${map.name} (${map.slug}) | requiredSearches=${requiredSearches} -> totalSearches=${targetSearches} | requiredLv=${Math.max(1, Number(map.requiredPlayerLevel) || 1)}`
            )
        })

        console.log('Done.')
    } catch (error) {
        console.error('Script failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
