/**
 * Database Setup Script for Chat Feature
 * Run this after starting MongoDB to create indexes
 * 
 * Usage: node apps/server/src/scripts/setupChatDatabase.js
 */

import mongoose from 'mongoose'
import Message from '../models/Message.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') })

const setupChatDatabase = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pokemon-vnpet')
    console.log('✅ Connected to MongoDB')

    // Create indexes for Message model
    console.log('\n📊 Creating indexes for Message collection...')
    
    await Message.createIndexes()
    console.log('✅ Message indexes created:')
    console.log('   - { room: 1, timestamp: -1 } - Query by room')
    console.log('   - { sender._id: 1, timestamp: -1 } - Query by sender')
    console.log('   - { timestamp: 1 } with TTL=7 days - Auto-delete old messages')

    // Check existing messages
    const messageCount = await Message.countDocuments()
    console.log(`\n📝 Current messages in database: ${messageCount}`)

    if (messageCount === 0) {
      console.log('\n💬 Creating welcome system message...')
      
      const welcomeMessage = new Message({
        room: 'global',
        sender: {
          _id: new mongoose.Types.ObjectId('000000000000000000000000'),
          username: 'System',
          role: 'admin',
          level: 1
        },
        content: 'Chào mừng đến với Chat Chung! Hãy tôn trọng và thân thiện với mọi người. 🎮',
        type: 'system'
      })

      await welcomeMessage.save()
      console.log('✅ Welcome message created')
    }

    // Display collection stats
    const stats = await mongoose.connection.db.collection('messages').stats()
    console.log('\n📈 Collection Statistics:')
    console.log(`   Documents: ${stats.count}`)
    console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`)
    console.log(`   Indexes: ${stats.nindexes}`)

    console.log('\n✨ Chat database setup completed successfully!')
    console.log('\n⚠️  IMPORTANT: Messages older than 7 days will be automatically deleted by MongoDB')
    console.log('    This keeps your database clean and prevents unlimited growth.')
    console.log('\n🚀 You can now start the server with: npm run dev')

  } catch (error) {
    console.error('\n❌ Error setting up chat database:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('\n👋 Database connection closed')
  }
}

// Run the setup
setupChatDatabase()
