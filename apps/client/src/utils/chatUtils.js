/**
 * Generate a consistent Pokemon ID for each user based on their user ID
 * @param {string} userId - User's MongoDB ObjectId
 * @returns {number} Pokemon ID (1-151, Gen 1)
 */
export const getUserPokemonId = (userId) => {
  if (!userId) return 25 // Default to Pikachu

  // Hash userId string to a number
  const hash = userId.split('').reduce((acc, char) => {
    return acc + char.charCodeAt(0)
  }, 0)

  // Map to Gen 1 Pokemon (1-151)
  return (hash % 151) + 1
}

/**
 * Get Pokemon sprite URL from PokeAPI
 * @param {number} pokemonId - Pokemon ID
 * @returns {string} Sprite URL
 */
export const getPokemonSpriteUrl = (pokemonId) => {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`
}

/**
 * Format timestamp to relative time (e.g., "2 phút trước")
 * @param {Date|string} timestamp 
 * @returns {string}
 */
export const formatMessageTime = (timestamp) => {
  const now = new Date()
  const messageTime = new Date(timestamp)
  const diffInSeconds = Math.floor((now - messageTime) / 1000)

  if (diffInSeconds < 60) {
    return 'Vừa xong'
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return `${diffInMinutes} phút trước`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return `${diffInHours} giờ trước`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) {
    return `${diffInDays} ngày trước`
  }

  // Format as date
  return messageTime.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Truncate text with ellipsis
 * @param {string} text 
 * @param {number} maxLength 
 * @returns {string}
 */
export const truncate = (text, maxLength = 50) => {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * Validate message content
 * @param {string} content 
 * @returns {{valid: boolean, error: string}}
 */
export const validateMessage = (content) => {
  if (!content || !content.trim()) {
    return { valid: false, error: 'Tin nhắn không được để trống' }
  }

  if (content.length > 500) {
    return { valid: false, error: 'Tin nhắn không được vượt quá 500 ký tự' }
  }

  return { valid: true, error: '' }
}

/**
 * Sanitize message content (basic XSS prevention)
 * @param {string} content 
 * @returns {string}
 */
export const sanitizeMessage = (content) => {
  if (!content) return ''
  
  return content
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Check if user is spamming
 * @param {Array} recentMessages - Array of recent message timestamps
 * @param {number} timeWindow - Time window in ms (default 60s)
 * @param {number} maxMessages - Max messages in time window (default 10)
 * @returns {boolean}
 */
export const isSpamming = (recentMessages, timeWindow = 60000, maxMessages = 10) => {
  const now = Date.now()
  const recentCount = recentMessages.filter(timestamp => {
    return now - timestamp < timeWindow
  }).length

  return recentCount >= maxMessages
}

/**
 * Pokemon reactions mapping
 */
export const POKEMON_REACTIONS = {
  happy: { emoji: '😊', name: 'Pikachu vui', pokemonId: 25 },
  sad: { emoji: '😢', name: 'Squirtle khóc', pokemonId: 7 },
  love: { emoji: '❤️', name: 'Chansey', pokemonId: 113 },
  fire: { emoji: '🔥', name: 'Charizard', pokemonId: 6 },
  thunder: { emoji: '⚡', name: 'Raichu', pokemonId: 26 },
  wow: { emoji: '😮', name: 'Psyduck', pokemonId: 54 },
  cool: { emoji: '😎', name: 'Blastoise', pokemonId: 9 },
  laugh: { emoji: '😂', name: 'Gengar', pokemonId: 94 }
}

/**
 * Chat icon Pokemon IDs
 */
export const CHAT_ICONS = {
  main: 132,    // Ditto (communication, transform)
  alt1: 25,     // Pikachu (iconic)
  alt2: 81,     // Magnemite (communication waves)
  alt3: 56,     // Mankey (chatty)
  online: 137   // Porygon (digital)
}
