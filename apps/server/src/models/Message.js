import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema({
  room: {
    type: String,
    required: true,
    index: true,
    default: 'global',
    enum: ['global', 'private', 'system'] // Extensible for future features
  },
  sender: {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    username: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    level: {
      type: Number,
      default: 1
    },
    avatar: {
      type: String,
      default: ''
    }
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  type: {
    type: String,
    enum: ['text', 'system', 'pokemon_caught', 'trade', 'battle'],
    default: 'text'
  },
  metadata: {
    // For system messages and special events
    pokemonName: String,
    pokemonId: Number,
    isShiny: Boolean,
    eventType: String
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deletedAt: Date
}, {
  timestamps: true
})

// Compound index for efficient queries
messageSchema.index({ room: 1, timestamp: -1 })
messageSchema.index({ 'sender._id': 1, timestamp: -1 })

// TTL Index - Auto-delete messages after 7 days
// MongoDB will automatically remove documents where timestamp is older than 7 days
messageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 }) // 7 days = 604800 seconds

// Virtual for formatting
messageSchema.virtual('isSystemMessage').get(function() {
  return this.type !== 'text'
})

// Method to soft delete
messageSchema.methods.softDelete = function(userId) {
  this.isDeleted = true
  this.deletedBy = userId
  this.deletedAt = new Date()
  return this.save()
}

// Static method to get recent messages
messageSchema.statics.getRecentMessages = async function(room = 'global', limit = 50) {
  return this.find({ 
    room, 
    isDeleted: false 
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
    .then(messages => messages.reverse()) // Reverse to get chronological order
}

// Static method to get messages before a timestamp (pagination)
messageSchema.statics.getMessagesBefore = async function(room = 'global', beforeTimestamp, limit = 50) {
  return this.find({ 
    room, 
    isDeleted: false,
    timestamp: { $lt: new Date(beforeTimestamp) }
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
    .then(messages => messages.reverse())
}

// Pre-save hook to sanitize content
messageSchema.pre('save', function(next) {
  if (this.isModified('content')) {
    // Basic XSS prevention
    this.content = this.content
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim()
  }
  next()
})

const Message = mongoose.model('Message', messageSchema)

export default Message
