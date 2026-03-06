import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOG_DIR = path.join(__dirname, '../../logs')
const LOG_FILE = path.join(LOG_DIR, 'api.log')

fs.mkdirSync(LOG_DIR, { recursive: true })

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
logStream.on('error', (error) => {
    console.error('API logger stream error:', error)
})

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim()
    }
    return req.ip || req.socket?.remoteAddress || ''
}

export const apiLogger = (req, res, next) => {
    const shouldLog = req.originalUrl.startsWith('/api') || req.originalUrl === '/health'
    if (!shouldLog) {
        return next()
    }

    const requestId = randomUUID()
    const startedAt = process.hrtime.bigint()

    req.requestId = requestId
    res.setHeader('x-request-id', requestId)

    res.on('finish', () => {
        const elapsedNs = process.hrtime.bigint() - startedAt
        const durationMs = Number(elapsedNs) / 1_000_000

        const logEntry = {
            time: new Date().toISOString(),
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            ip: getClientIp(req),
            userId: req.user?.userId || null,
        }

        if (req.actionGuardMeta && typeof req.actionGuardMeta === 'object') {
            logEntry.actionGuard = req.actionGuardMeta
        }

        logStream.write(`${JSON.stringify(logEntry)}\n`)
    })

    next()
}
