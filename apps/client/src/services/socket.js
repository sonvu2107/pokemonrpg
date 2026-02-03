import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'

let socket = null

export const connectSocket = (token) => {
    if (socket) {
        socket.disconnect()
    }

    // Pass token in auth handshake
    socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
        console.log('Socket connected:', socket.id)
    })

    socket.on('disconnect', () => {
        console.log('Socket disconnected')
    })

    socket.on('error', (err) => {
        console.error('Socket error:', err)
    })

    return socket
}

export const disconnectSocket = () => {
    if (socket) {
        socket.disconnect()
        socket = null
    }
}

export const getSocket = () => socket
