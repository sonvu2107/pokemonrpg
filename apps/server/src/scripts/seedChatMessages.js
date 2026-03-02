/**
 * Seed Test Messages for Chat Feature
 * This script creates sample messages for testing
 * 
 * Usage: node apps/server/src/scripts/seedChatMessages.js
 */

import mongoose from 'mongoose'
import Message from '../models/Message.js'
import User from '../models/User.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '../../.env') })

const sampleMessages = [
  { content: 'Xin chào mọi người! 👋', delay: 0 },
  { content: 'Có ai muốn trade Pikachu không?', delay: 2000 },
  { content: 'Mình vừa bắt được Charizard Shiny! 🔥', delay: 4000 },
  { content: 'Level 50 rồi, khó quá!', delay: 6000 },
  { content: 'Admin ơi, map mới khi nào mở?', delay: 8000 },
]

const seedChatMessages = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pokemon-vnpet')
    console.log('✅ Connected to MongoDB')

    // Get first user from database
    const user = await User.findOne().select('username role level')
    
    if (!user) {
      console.log('❌ No users found in database. Please create a user first.')
      process.exit(1)
    }

    console.log(`\n👤 Using user: ${user.username} (Level ${user.level})`)

    // Clear existing test messages (optional)
    const existingCount = await Message.countDocuments({ room: 'global' })
    if (existingCount > 10) {
      console.log(`\n⚠️  Warning: ${existingCount} messages already exist in global chat`)
      console.log('   Skipping seed to avoid clutter')
      process.exit(0)
    }

    console.log('\n💬 Creating sample messages...')

    for (let i = 0; i < sampleMessages.length; i++) {
      const { content, delay } = sampleMessages[i]
      
      await new Promise(resolve => setTimeout(resolve, delay))

      const message = new Message({
        room: 'global',
        sender: {
          _id: user._id,
          username: user.username,
          role: user.role || 'user',
          level: user.level || 1
        },
        content,
        type: 'text'
      })

      await message.save()
      console.log(`   ✅ Message ${i + 1}/${sampleMessages.length}: "${content}"`)
    }

    // Add a system message
    const systemMessage = new Message({
      room: 'global',
      sender: {
        _id: new mongoose.Types.ObjectId('000000000000000000000000'),
        username: 'System',
        role: 'admin',
        level: 1
      },
      content: 'Hệ thống chat đang hoạt động tốt! Chúc các trainer vui vẻ! 🎮',
      type: 'system'
    })

    await systemMessage.save()
    console.log('   ✅ System message added')

    const totalMessages = await Message.countDocuments({ room: 'global' })
    console.log(`\n📊 Total messages in global chat: ${totalMessages}`)
    console.log('✨ Chat seeding completed successfully!')

  } catch (error) {
    console.error('\n❌ Error seeding messages:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('\n👋 Database connection closed')
  }
}

seedChatMessages()
