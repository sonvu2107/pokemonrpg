import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import Friendship, { FRIENDSHIP_STATUS } from '../models/Friendship.js'
import { attachChatHandlers } from './chatHandlers.js'

let io = null
const activeSocketsByUser = new Map()

const normalizeUserId = (value) => String(value || '').trim()

const addUserSocket = (userId, socketId) => {
    const normalizedUserId = normalizeUserId(userId)
    const normalizedSocketId = String(socketId || '').trim()
    if (!normalizedUserId || !normalizedSocketId) return 0

    if (!activeSocketsByUser.has(normalizedUserId)) {
        activeSocketsByUser.set(normalizedUserId, new Set())
    }

    const socketSet = activeSocketsByUser.get(normalizedUserId)
    socketSet.add(normalizedSocketId)
    return socketSet.size
}

const removeUserSocket = (userId, socketId) => {
    const normalizedUserId = normalizeUserId(userId)
    const normalizedSocketId = String(socketId || '').trim()
    if (!normalizedUserId || !normalizedSocketId) return 0

    const socketSet = activeSocketsByUser.get(normalizedUserId)
    if (!socketSet) return 0

    socketSet.delete(normalizedSocketId)
    if (socketSet.size === 0) {
        activeSocketsByUser.delete(normalizedUserId)
        return 0
    }

    return socketSet.size
}

const emitFriendsPresenceChanged = async (userId, isOnline, lastActiveValue = new Date()) => {
    if (!io) return

    const normalizedUserId = normalizeUserId(userId)
    if (!normalizedUserId) return

    const relationships = await Friendship.find({
        status: FRIENDSHIP_STATUS.ACCEPTED,
        $or: [{ requesterId: normalizedUserId }, { addresseeId: normalizedUserId }],
    })
        .select('requesterId addresseeId')
        .lean()

    const payload = {
        userId: normalizedUserId,
        isOnline: Boolean(isOnline),
        lastActive: new Date(lastActiveValue).toISOString(),
    }

    for (const relation of relationships) {
        const requesterId = normalizeUserId(relation?.requesterId)
        const addresseeId = normalizeUserId(relation?.addresseeId)
        const friendUserId = requesterId === normalizedUserId ? addresseeId : requesterId
        if (!friendUserId) continue
        io.to(friendUserId).emit('friends:presence_changed', payload)
    }
}

const setUserPresenceState = async (userId, isOnline) => {
    const normalizedUserId = normalizeUserId(userId)
    if (!normalizedUserId) return

    const lastActive = new Date()
    await User.findByIdAndUpdate(
        normalizedUserId,
        {
            isOnline: Boolean(isOnline),
            lastActive,
        },
        {
            new: false,
        }
    )

    await emitFriendsPresenceChanged(normalizedUserId, isOnline, lastActive)
}

const handleSocketConnected = async (userId, socketId) => {
    const totalSockets = addUserSocket(userId, socketId)
    if (totalSockets === 1) {
        await setUserPresenceState(userId, true)
    }
}

const handleSocketDisconnected = async (userId, socketId) => {
    const totalSockets = removeUserSocket(userId, socketId)
    if (totalSockets === 0) {
        await setUserPresenceState(userId, false)
    }
}

// Initialize Socket.io with HTTP server
export const initSocket = (server) => {
    const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

    io = new Server(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true,
        },
    });
    // Socket.io authentication middleware
    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth.token
            console.log('Socket auth attempt:', {
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 20) + '...' : 'none'
            })

            if (!token) {
                console.error('Socket auth failed: No token provided')
                return next(new Error('Authentication error: No token provided'))
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET)
            socket.userId = decoded.userId
            console.log('Socket auth success:', decoded.userId)
            next()
        } catch (error) {
            console.error('Socket auth error:', error.message)
            next(new Error('Authentication error: Invalid token'))
        }
    })

    // Single connection handler for both chat and player state
    io.on('connection', (socket) => {
        const userId = normalizeUserId(socket.userId)
        socket.userId = userId
        console.log(`Socket connected: ${socket.id}, userId: ${socket.userId}`)

        // Join room based on userId for player state updates
        socket.join(userId)

        handleSocketConnected(userId, socket.id).catch((error) => {
            console.error('Socket presence update error (connect):', error)
        })

        // Attach chat event handlers (pass io for broadcasting)
        attachChatHandlers(socket, io)

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`)
            handleSocketDisconnected(userId, socket.id).catch((error) => {
                console.error('Socket presence update error (disconnect):', error)
            })
        })
    })

    console.log('Socket.io initialized')
    return io
}

// Helper to emit player state to specific user
export const emitPlayerState = (userId, playerState) => {
    if (io) {
        const normalizedUserId = normalizeUserId(userId)
        if (!normalizedUserId) return
        const platinumCoins = Number(playerState?.gold || 0)
        io.to(normalizedUserId).emit('playerState', {
            hp: playerState.hp,
            maxHp: playerState.maxHp,
            platinumCoins,
            moonPoints: Number(playerState?.moonPoints || 0),
            clicks: playerState.clicks,
        })
    }
}

export const emitToUser = (userId, eventName, payload = {}) => {
    if (!io) return
    const normalizedUserId = normalizeUserId(userId)
    if (!normalizedUserId || !eventName) return
    io.to(normalizedUserId).emit(eventName, payload)
}

export const getIO = () => io
