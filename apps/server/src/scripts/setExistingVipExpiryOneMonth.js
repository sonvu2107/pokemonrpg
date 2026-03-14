import '../config/env.js'
import mongoose from 'mongoose'
import User from '../models/User.js'

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI)

    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + 1)

    const result = await User.collection.updateMany(
        { role: 'vip' },
        { $set: { vipExpiresAt: expiresAt } }
    )

    const samples = await User.collection.find(
        { role: 'vip' },
        { projection: { username: 1, email: 1, vipTierCode: 1, vipExpiresAt: 1 } }
    ).limit(5).toArray()

    console.log(JSON.stringify({
        matched: result.matchedCount ?? 0,
        modified: result.modifiedCount ?? 0,
        expiresAt: expiresAt.toISOString(),
        samples,
    }, null, 2))

    await mongoose.disconnect()
}

run().catch(async (error) => {
    console.error(error)
    try {
        await mongoose.disconnect()
    } catch {
        // ignore disconnect error
    }
    process.exit(1)
})
