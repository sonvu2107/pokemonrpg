import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { attachChatHandlers } from './chatHandlers.js'

let io = null

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
        console.log(`Socket connected: ${socket.id}, userId: ${socket.userId}`)

        // Join room based on userId for player state updates
        socket.join(socket.userId.toString())

        // Attach chat event handlers (pass io for broadcasting)
        attachChatHandlers(socket, io)

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`)
        })
    })

    console.log('Socket.io initialized')
    return io
}

// Helper to emit player state to specific user
export const emitPlayerState = (userId, playerState) => {
    if (io) {
        const platinumCoins = Number(playerState?.gold || 0)
        io.to(userId).emit('playerState', {
            hp: playerState.hp,
            maxHp: playerState.maxHp,
            platinumCoins,
            moonPoints: Number(playerState?.moonPoints || 0),
            clicks: playerState.clicks,
        })
    }
}

export const getIO = () => io
