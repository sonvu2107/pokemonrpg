import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'
import User from './models/User.js'
import PlayerState from './models/PlayerState.js'
import UserInventory from './models/UserInventory.js'
import Item from './models/Item.js'

dotenv.config()

const args = process.argv.slice(2)
const argsSet = new Set(args)

const getArgValue = (flag, fallback = '') => {
    const idx = args.indexOf(flag)
    if (idx < 0) return fallback
    return String(args[idx + 1] || '').trim() || fallback
}

const email = String(getArgValue('--email', 'vanthanh.pt20@gmail.com')).trim().toLowerCase()
const itemNameKeyword = String(getArgValue('--item-name', 'VIP6')).trim().toLowerCase()
const limitRaw = Number.parseInt(getArgValue('--limit', '50'), 10)
const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50
const allUsers = argsSet.has('--all-users')

const run = async () => {
    try {
        await connectDB()

        if (allUsers) {
            if (!itemNameKeyword) {
                throw new Error('Thiếu --item-name khi dùng --all-users')
            }

            const exactItem = await Item.findOne({ nameLower: itemNameKeyword })
                .select('_id name type rarity effectType effectValue effectValueMp isTradable')
                .lean()

            if (!exactItem?._id) {
                throw new Error(`Không tìm thấy item định nghĩa: ${itemNameKeyword}`)
            }

            const holderRows = await UserInventory.aggregate([
                {
                    $match: {
                        itemId: new mongoose.Types.ObjectId(String(exactItem._id)),
                        quantity: { $gt: 0 },
                    },
                },
                {
                    $group: {
                        _id: '$userId',
                        totalQuantity: { $sum: '$quantity' },
                        rowCount: { $sum: 1 },
                        latestUpdatedAt: { $max: '$updatedAt' },
                    },
                },
                {
                    $sort: { totalQuantity: -1, latestUpdatedAt: -1 },
                },
            ])

            const holderUserIds = holderRows
                .map((entry) => String(entry?._id || '').trim())
                .filter(Boolean)

            const users = await User.find({ _id: { $in: holderUserIds } })
                .select('_id email username role')
                .lean()
            const userById = new Map(users.map((entry) => [String(entry?._id || '').trim(), entry]))

            const normalizedHolders = holderRows.map((entry) => {
                const userId = String(entry?._id || '').trim()
                const user = userById.get(userId)
                return {
                    userId,
                    email: String(user?.email || '').trim(),
                    username: String(user?.username || '').trim(),
                    role: String(user?.role || '').trim(),
                    quantity: Math.max(0, Number(entry?.totalQuantity) || 0),
                    rowCount: Math.max(0, Number(entry?.rowCount) || 0),
                    latestUpdatedAt: entry?.latestUpdatedAt ? new Date(entry.latestUpdatedAt).toISOString() : null,
                }
            })

            const totalQuantityAllUsers = normalizedHolders.reduce((sum, entry) => sum + entry.quantity, 0)

            console.log('=== Scan Item Across All Users ===')
            console.log(`Item: ${exactItem.name} (${String(exactItem._id)})`)
            console.log(`Type/Rarity: ${exactItem.type}/${exactItem.rarity}`)
            console.log(`Holder users: ${normalizedHolders.length}`)
            console.log(`Total quantity across users: ${totalQuantityAllUsers}`)
            console.log(`Top holders (limit ${limit}):`)
            console.log(JSON.stringify(normalizedHolders.slice(0, limit), null, 2))
            return
        }

        if (!email) {
            throw new Error('Thiếu --email')
        }

        const user = await User.findOne({ email })
            .select('_id email username role')
            .lean()

        if (!user?._id) {
            throw new Error(`Không tìm thấy user với email: ${email}`)
        }

        const [playerState, inventoryRows] = await Promise.all([
            PlayerState.findOne({ userId: user._id })
                .select('gold moonPoints level experience')
                .lean(),
            UserInventory.find({ userId: user._id, quantity: { $gt: 0 } })
                .select('itemId quantity updatedAt')
                .populate('itemId', 'name type rarity effectType effectValue effectValueMp isTradable')
                .sort({ quantity: -1, updatedAt: -1 })
                .limit(limit)
                .lean(),
        ])

        const normalizedInventory = (Array.isArray(inventoryRows) ? inventoryRows : [])
            .map((entry) => ({
                itemId: String(entry?.itemId?._id || entry?.itemId || '').trim(),
                name: String(entry?.itemId?.name || '').trim() || '(unknown item)',
                type: String(entry?.itemId?.type || '').trim(),
                rarity: String(entry?.itemId?.rarity || '').trim(),
                quantity: Math.max(0, Number(entry?.quantity) || 0),
                effectType: String(entry?.itemId?.effectType || '').trim(),
                effectValue: Math.max(0, Number(entry?.itemId?.effectValue) || 0),
                effectValueMp: Math.max(0, Number(entry?.itemId?.effectValueMp) || 0),
                isTradable: Boolean(entry?.itemId?.isTradable),
                updatedAt: entry?.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
            }))
            .filter((entry) => entry.itemId && entry.quantity > 0)

        const keywordMatches = itemNameKeyword
            ? normalizedInventory.filter((entry) => entry.name.toLowerCase().includes(itemNameKeyword))
            : []

        let exactItem = null
        if (itemNameKeyword) {
            exactItem = await Item.findOne({ nameLower: itemNameKeyword })
                .select('_id name type rarity effectType effectValue effectValueMp isTradable')
                .lean()
        }

        const exactItemQuantity = exactItem?._id
            ? normalizedInventory.find((entry) => entry.itemId === String(exactItem._id))?.quantity || 0
            : null

        console.log('=== Check User Inventory By Email ===')
        console.log(`Email: ${user.email}`)
        console.log(`Username: ${String(user.username || '').trim() || '(none)'}`)
        console.log(`Role: ${String(user.role || '').trim() || 'user'}`)
        console.log(`Wallet gold: ${Math.max(0, Number(playerState?.gold) || 0)}`)
        console.log(`Wallet moonPoints: ${Math.max(0, Number(playerState?.moonPoints) || 0)}`)
        console.log(`Player level: ${Math.max(1, Number(playerState?.level) || 1)}`)
        console.log(`Inventory rows loaded: ${normalizedInventory.length}`)

        if (itemNameKeyword) {
            console.log(`Item keyword: ${itemNameKeyword}`)
            console.log(`Keyword match rows: ${keywordMatches.length}`)
            if (exactItem) {
                console.log(`Exact item: ${exactItem.name} (${String(exactItem._id)})`)
                console.log(`Exact item quantity in inventory: ${exactItemQuantity}`)
            } else {
                console.log('Exact item: not found in item definitions')
            }
            if (keywordMatches.length > 0) {
                console.log(JSON.stringify(keywordMatches, null, 2))
            }
        }

        console.log('Top inventory rows:')
        console.log(JSON.stringify(normalizedInventory, null, 2))
    } catch (error) {
        console.error('Check inventory failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
