import mongoose from 'mongoose'
import { incrementMongoOpCounter } from '../utils/perfMetrics.js'

const shouldTrackMongoOps = String(
    process.env.PERF_METRICS_ENABLED
    || (process.env.NODE_ENV === 'production' ? 'false' : 'true')
).trim().toLowerCase() === 'true'

const parseIntegerEnv = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

if (shouldTrackMongoOps) {
    mongoose.set('debug', () => {
        incrementMongoOpCounter()
    })
}

export const connectDB = async () => {
    try {
        const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
        const autoIndex = String(process.env.MONGO_AUTO_INDEX ?? (isProduction ? 'false' : 'true')).trim().toLowerCase() === 'true'
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            autoIndex,
            autoCreate: autoIndex,
            maxPoolSize: parseIntegerEnv(process.env.MONGO_MAX_POOL_SIZE, isProduction ? 30 : 10),
            minPoolSize: parseIntegerEnv(process.env.MONGO_MIN_POOL_SIZE, isProduction ? 5 : 0),
            serverSelectionTimeoutMS: parseIntegerEnv(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 5000),
            socketTimeoutMS: parseIntegerEnv(process.env.MONGO_SOCKET_TIMEOUT_MS, 45000),
        })

        console.log(`MongoDB Connected: ${conn.connection.host}`)
        console.log(`MongoDB autoIndex: ${autoIndex ? 'enabled' : 'disabled'}`)
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`)
        process.exit(1)
    }
}
