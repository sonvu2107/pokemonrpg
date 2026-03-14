import dotenv from 'dotenv'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { connectDB } from '../config/db.js'
import User from '../models/User.js'

dotenv.config()

const DEFAULT_API_URL = 'https://api.vnpet.games/api'
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_TIMEOUT_MS = 10000

const argv = process.argv.slice(2)

const printHelp = () => {
    console.log([
        'Usage: node src/scripts/checkOnlineUsers.js [options]',
        '',
        'Options:',
        '  --api-url <url>     API base URL. Default: https://api.vnpet.games/api',
        '  --token <jwt>       Use an existing bearer token',
        '  --user-id <id>      Mint a short-lived internal token from JWT_SECRET',
        '  --email <email>     Login email for /api/auth/login',
        '  --password <pass>   Login password for /api/auth/login',
        '  --live              Read live users from active socket connections',
        '  --json              Print raw JSON response',
        '  --help              Show this message',
        '',
        'Priority: --token -> --email/--password -> --user-id -> auto-pick local user from MongoDB',
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
        live: false,
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

        if (arg === '--live') {
            options.live = true
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
    const pathname = parsed.pathname.replace(/\/+$/, '')
    if (!pathname || pathname === '/') {
        parsed.pathname = '/api'
        return parsed.toString().replace(/\/+$/, '')
    }

    if (pathname === '/api') {
        return parsed.toString().replace(/\/+$/, '')
    }

    return parsed.toString().replace(/\/+$/, '')
}

const maskUserId = (value) => {
    const normalized = String(value || '').trim()
    if (!normalized) return 'unknown'
    return `#${normalized.slice(-7).toUpperCase()}`
}

const toIsoOrDash = (value) => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toISOString()
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

const resolveLocalUserId = async () => {
    const adminUser = await User.findOne({ role: 'admin', isBanned: { $ne: true } })
        .select('_id')
        .sort({ createdAt: 1, _id: 1 })
        .lean()

    if (adminUser?._id) {
        return String(adminUser._id)
    }

    const regularUser = await User.findOne({ isBanned: { $ne: true } })
        .select('_id')
        .sort({ createdAt: 1, _id: 1 })
        .lean()

    if (regularUser?._id) {
        return String(regularUser._id)
    }

    throw new Error('Khong tim thay user nao de tao token noi bo')
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
        return {
            token: String(options.token).trim(),
            source: 'provided token',
        }
    }

    if (options.email && options.password) {
        return {
            token: await loginAndGetToken(options),
            source: 'login credentials',
        }
    }

    if (options.userId) {
        return {
            token: createInternalToken(options.userId),
            source: `internal token ${maskUserId(options.userId)}`,
        }
    }

    await ensureDbConnected()
    const userId = await resolveLocalUserId()
    return {
        token: createInternalToken(userId),
        source: `auto internal token ${maskUserId(userId)}`,
    }
}

const fetchAllOnlineUsers = async ({ apiUrl, token, live = false }) => {
    let page = 1
    let totalPages = 1
    let onlineCount = 0
    let liveSocketConnectionsCount = 0
    let globalChatConnectionsCount = 0
    let phantomOnlineUsersCount = 0
    const onlineTrainers = []
    const endpointPath = live ? '/stats/online/live' : '/stats/online'

    while (page <= totalPages) {
        const data = await fetchJson(`${apiUrl}${endpointPath}?page=${page}&limit=${DEFAULT_PAGE_SIZE}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })

        if (page === 1) {
            onlineCount = Number((live ? data?.liveUsersCount : data?.onlineCount) || 0)
            liveSocketConnectionsCount = Number(data?.liveSocketConnectionsCount || 0)
            globalChatConnectionsCount = Number(data?.globalChatConnectionsCount || 0)
            phantomOnlineUsersCount = Number(data?.phantomOnlineUsersCount || 0)
        }

        totalPages = Math.max(1, Number(data?.pagination?.totalPages || 1))
        onlineTrainers.push(...(Array.isArray(data?.onlineTrainers) ? data.onlineTrainers : []))
        page += 1
    }

    return {
        ok: true,
        live,
        onlineCount,
        liveSocketConnectionsCount,
        globalChatConnectionsCount,
        phantomOnlineUsersCount,
        onlineTrainers,
    }
}

const printTable = ({ apiUrl, authSource, live, onlineCount, liveSocketConnectionsCount, globalChatConnectionsCount, phantomOnlineUsersCount, onlineTrainers }) => {
    console.log(`API: ${apiUrl}`)
    console.log(`Auth: ${authSource}`)
    console.log(`Mode: ${live ? 'live sockets' : 'db online flags'}`)
    console.log(`Online now: ${onlineCount}`)
    if (live) {
        console.log(`Socket connections: ${liveSocketConnectionsCount}`)
        console.log(`Global chat connections: ${globalChatConnectionsCount}`)
        console.log(`DB online without socket: ${phantomOnlineUsersCount}`)
    }

    if (!onlineTrainers.length) {
        console.log('Khong co nguoi choi nao dang online.')
        return
    }

    console.log('')
    for (const trainer of onlineTrainers) {
        const vipLabel = trainer?.vipTierCode || trainer?.vipTierLevel || 0
        console.log([
            `${String(trainer?.rank || '-').padStart(3, ' ')}.`,
            String(trainer?.username || 'Trainer').padEnd(24, ' '),
            String(trainer?.userIdLabel || maskUserId(trainer?.userId)).padEnd(10, ' '),
            `role=${String(trainer?.role || 'user').padEnd(5, ' ')}`,
            `vip=${String(vipLabel).padEnd(6, ' ')}`,
            ...(live ? [`sockets=${String(trainer?.socketCount || 0).padEnd(3, ' ')}`] : []),
            `lastActive=${toIsoOrDash(trainer?.lastActive)}`,
        ].join(' '))
    }
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
    const auth = await resolveToken(options)
    openedDbConnection = initialReadyState === 0 && mongoose.connection.readyState === 1

    const result = await fetchAllOnlineUsers({
        apiUrl: options.apiUrl,
        token: auth.token,
        live: options.live,
    })

    if (options.json) {
        console.log(JSON.stringify({
            apiUrl: options.apiUrl,
            authSource: auth.source,
            ...result,
        }, null, 2))
        return
    }

    printTable({
        apiUrl: options.apiUrl,
        authSource: auth.source,
        ...result,
    })
}

run()
    .catch((error) => {
        console.error('Check online users failed:', error.message)
        process.exitCode = 1
    })
    .finally(async () => {
        if (openedDbConnection && mongoose.connection.readyState !== 0) {
            await mongoose.disconnect()
        }
    })
