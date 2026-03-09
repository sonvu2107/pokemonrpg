import './config/env.js'
import http from 'http'
import app from './app.js'
import { connectDB } from './config/db.js'
import { initSocket } from './socket/index.js'
import { startAutoTrainerWorker } from './workers/autoTrainerWorker.js'
import { startAutoSearchWorker } from './workers/autoSearchWorker.js'
import { startAuctionWorker } from './workers/auctionWorker.js'
import { enforcePartyUniqueSpeciesGlobally } from './utils/partyDuplicateUtils.js'

// Create HTTP server
const server = http.createServer(app)

// Initialize Socket.io
initSocket(server)

// Connect to MongoDB
await connectDB()

try {
    const partyCleanupResult = await enforcePartyUniqueSpeciesGlobally()
    if (partyCleanupResult?.usersChanged > 0 || partyCleanupResult?.movedToBox > 0) {
        console.log('[Party Cleanup] Enforced unique species in party')
        console.log(`[Party Cleanup] Users changed: ${partyCleanupResult.usersChanged}`)
        console.log(`[Party Cleanup] Pokemon moved to box: ${partyCleanupResult.movedToBox}`)
    }
} catch (error) {
    console.error('[Party Cleanup] Failed to enforce unique species:', error.message)
}

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    startAutoTrainerWorker({ baseUrl: `http://127.0.0.1:${PORT}` })
    startAutoSearchWorker({ baseUrl: `http://127.0.0.1:${PORT}` })
    startAuctionWorker()
})
