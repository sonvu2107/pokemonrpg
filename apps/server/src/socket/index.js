import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'

let io = null

// Initialize Socket.io with HTTP server
export const initSocket = (server) => {
    const allowedOrigins = [
        process.env.CLIENT_URL || "http://localhost:5173",
        "https://vnpet.netlify.app",
    ];

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
            if (!token) {
                return next(new Error('Authentication error: No token provided'))
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET)
            socket.userId = decoded.userId
            next()
        } catch (error) {
            next(new Error('Authentication error: Invalid token'))
        }
    })

    // Connection handler
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}, userId: ${socket.userId}`)

        // Join room based on userId
        socket.join(socket.userId.toString())

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
        io.to(userId).emit('playerState', {
            hp: playerState.hp,
            maxHp: playerState.maxHp,
            gold: playerState.gold,
            clicks: playerState.clicks,
        })
    }
}

export const getIO = () => io
