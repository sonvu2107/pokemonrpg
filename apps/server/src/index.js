import dotenv from 'dotenv'
import http from 'http'
import app from './app.js'
import { connectDB } from './config/db.js'
import { initSocket } from './socket/index.js'

// Load environment variables
dotenv.config()

// Create HTTP server
const server = http.createServer(app)

// Initialize Socket.io
initSocket(server)

// Connect to MongoDB
await connectDB()

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})
