import dotenv from 'dotenv'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'

dotenv.config()

const DEFAULT_API_URL = 'https://api.vnpet.games/api'
const DEFAULT_TIMEOUT_MS = 15000
const argv = process.argv.slice(2)

const printHelp = () => {
    console.log([
        'Usage: node src/scripts/reconcileOnlineUsers.js [options]',
        '',
        'Options:',
        '  --api-url <url>     API base URL. Default: https://api.vnpet.games/api',
        '  --token <jwt>       Use an existing bearer token',
        '  --user-id <id>      Mint a short-lived internal token from JWT_SECRET',
        '  --email <email>     Login email for /api/auth/login',
        '  --password <pass>   Login password for /api/auth/login',
        '  --apply             Apply DB updates',
        '  --json              Print raw JSON response',
        '  --help              Show this message',
        '',
        'Default mode is dry-run.',
    ].join('\n'))
}

const readArgValue = (args, index) => {
    const nextValue = args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
        throw new Error(`Thieu gia tri cho ${args[index]}`)
    }
    return nextValue
}

const parseArgs = (args) => {
    const options = {
        apiUrl: process.env.ONLINE_CHECK_API_URL || DEFAULT_API_URL,
        token: process.env.ONLINE_CHECK_TOKEN || '',
        userId: process.env.ONLINE_CHECK_USER_ID || '',
        email: process.env.ONLINE_CHECK_EMAIL || '',
        password: process.env.ONLINE_CHECK_PASSWORD || '',
        apply: false,
        json: false,
        help: false,
    }

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]

        if (arg === '--help') {
            options.help = true
            continue
        }

        if (arg === '--json') {
            options.json = true
            continue
        }

        if (arg === '--apply') {
            options.apply = true
            continue
        }

        if (arg === '--api-url') {
            options.apiUrl = readArgValue(args, index)
            index += 1
            continue
        }

        if (arg === '--token') {
            options.token = readArgValue(args, index)
            index += 1
            continue
        }

        if (arg === '--user-id') {
            options.userId = readArgValue(args, index)
            index += 1
            continue
        }

        if (arg === '--email') {
            options.email = readArgValue(args, index)
            index += 1
            continue
        }

        if (arg === '--password') {
            options.password = readArgValue(args, index)
            index += 1
            continue
        }

        throw new Error(`Khong ho tro tham so ${arg}`)
    }

    return options
}

const normalizeApiUrl = (value) => {
    const raw = String(value || '').trim().replace(/\/+$/, '')
    if (!raw) return DEFAULT_API_URL
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const parsed = new URL(withProtocol)
    if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/api'
    }
    return parsed.toString().replace(/\/+$/, '')
}

const fetchJson = async (url, options = {}) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
            throw new Error(data?.message || `Request that bai (${response.status})`)
        }
        return data
    } finally {
        clearTimeout(timeoutId)
    }
}

const createInternalToken = (userId) => {
    const jwtSecret = String(process.env.JWT_SECRET || '').trim()
    if (!jwtSecret) {
        throw new Error('JWT_SECRET chua duoc cau hinh')
    }

    return jwt.sign({ userId: String(userId), tokenType: 'internal' }, jwtSecret, { expiresIn: '30m' })
}

const ensureDbConnected = async () => {
    if (mongoose.connection.readyState === 1) return false
    await connectDB()
    return true
}

const resolveLocalAdminId = async () => {
    const adminUser = await User.findOne({ role: 'admin', isBanned: { $ne: true } })
        .select('_id')
        .sort({ createdAt: 1, _id: 1 })
        .lean()

    if (!adminUser?._id) {
        throw new Error('Khong tim thay admin user de goi endpoint doi chieu online')
    }

    return String(adminUser._id)
}

const loginAndGetToken = async ({ apiUrl, email, password }) => {
    const data = await fetchJson(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    })

    const token = String(data?.token || '').trim()
    if (!token) {
        throw new Error('Dang nhap thanh cong nhung khong nhan duoc token')
    }

    return token
}

const resolveToken = async (options) => {
    if (options.token) {
        return String(options.token).trim()
    }

    if (options.email && options.password) {
        return loginAndGetToken(options)
    }

    if (options.userId) {
        return createInternalToken(options.userId)
    }

    await ensureDbConnected()
    return createInternalToken(await resolveLocalAdminId())
}

const printUsers = (label, rows = []) => {
    if (!rows.length) {
        console.log(`${label}: 0`)
        return
    }

    console.log(`${label}: ${rows.length}`)
    rows.forEach((entry, index) => {
        console.log(`${String(index + 1).padStart(3, ' ')}. ${entry.username} (#${String(entry.userId || '').slice(-7).toUpperCase()}) role=${entry.role} lastActive=${entry.lastActive || '-'}`)
    })
}

let openedDbConnection = false

const run = async () => {
    const options = parseArgs(argv)
    if (options.help) {
        printHelp()
        return
    }

    options.apiUrl = normalizeApiUrl(options.apiUrl)

    const initialReadyState = mongoose.connection.readyState
    const token = await resolveToken(options)
    openedDbConnection = initialReadyState === 0 && mongoose.connection.readyState === 1

    const result = await fetchJson(`${options.apiUrl}/stats/online/reconcile`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apply: options.apply }),
    })

    if (options.json) {
        console.log(JSON.stringify(result, null, 2))
        return
    }

    console.log(`API: ${options.apiUrl}`)
    console.log(`Mode: ${options.apply ? 'apply' : 'dry-run'}`)
    console.log(`Live users: ${Number(result?.liveUsersCount || 0)}`)
    console.log(`Live socket connections: ${Number(result?.liveSocketConnectionsCount || 0)}`)
    console.log(`DB online users: ${Number(result?.dbOnlineUsersCount || 0)}`)
    console.log(`Set offline: ${Number(result?.usersToSetOfflineCount || 0)}${options.apply ? ` (modified ${Number(result?.offlineModifiedCount || 0)})` : ''}`)
    console.log(`Set online: ${Number(result?.usersToSetOnlineCount || 0)}${options.apply ? ` (modified ${Number(result?.onlineModifiedCount || 0)})` : ''}`)
    console.log('')
    printUsers('Users to set offline', Array.isArray(result?.usersToSetOffline) ? result.usersToSetOffline : [])
    console.log('')
    printUsers('Users to set online', Array.isArray(result?.usersToSetOnline) ? result.usersToSetOnline : [])
}

run()
    .catch((error) => {
        console.error('Reconcile online users failed:', error.message)
        process.exitCode = 1
    })
    .finally(async () => {
        if (openedDbConnection && mongoose.connection.readyState !== 0) {
            await mongoose.disconnect()
        }
    })
