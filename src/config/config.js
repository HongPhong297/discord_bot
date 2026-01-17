/**
 * Configuration Module
 * Loads and validates environment variables
 */

require('dotenv').config();

/**
 * Validates required environment variables
 * @throws {Error} If required variables are missing
 */
function validateConfig() {
  const required = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'GUILD_ID',
    'RIOT_API_KEY',
    'MONGODB_URI',
    'TRACKED_CHANNEL_ID',
    'CEREBRAS_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file against .env.example'
    );
  }
}

// Validate on import
validateConfig();

/**
 * Application Configuration
 */
const config = {
  // Discord Configuration
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.GUILD_ID,
    trackedChannelId: process.env.TRACKED_CHANNEL_ID,
  },

  // Riot API Configuration
  riot: {
    apiKey: process.env.RIOT_API_KEY,
    region: process.env.RIOT_REGION || 'vn2', // Default to Vietnam server
    platformId: process.env.RIOT_PLATFORM_ID || 'VN2',
    // Rate limiting
    rateLimit: {
      requestsPerSecond: 20,
      requestsPer2Minutes: 100,
    },
  },

  // AI Service Configuration (Cerebras)
  ai: {
    cerebras: {
      apiKey: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
      temperature: parseFloat(process.env.CEREBRAS_TEMPERATURE || '0.9'),
      maxTokens: parseInt(process.env.CEREBRAS_MAX_TOKENS || '150', 10),
    },
  },

  // Database Configuration
  database: {
    uri: process.env.MONGODB_URI,
    options: {
      // useNewUrlParser: true, // Deprecated in Mongoose 6+
      // useUnifiedTopology: true, // Deprecated in Mongoose 6+
    },
  },

  // Bot Features Configuration
  features: {
    // Post-game analysis
    postGame: {
      minPlayersRequired: 2, // Minimum Discord members in match to analyze
      autoRefreshInterval: 10, // Minutes between auto-refresh checks
      matchType: 'ranked', // Filter: 'ranked', 'normal', 'tourney', 'tutorial', or null for all
      // Queue IDs reference: 420 = Solo/Duo, 440 = Flex, 450 = ARAM, 400 = Normal Draft
    },

    // Betting system
    betting: {
      bettingWindowDuration: 5, // Minutes - thời gian mở cửa cược
      maxMatchWaitTime: 90, // Minutes - chờ game BẮT ĐẦU + game KẾT THÚC (40 + 50 = 90)
      maxGameStartWindow: 40, // Minutes - game phải BẮT ĐẦU trong 40 phút sau khi bet opens
      cancellationPenalty: 50, // Coins penalty for opening bet but not playing
      initialCoins: 1000, // Starting coins for new users
      houseEdge: 0.05, // 5% house edge on bets
    },

    // Leaderboard
    leaderboard: {
      resetDay: 0, // Sunday (0 = Sunday, 6 = Saturday)
      resetHour: 0, // Midnight
    },

    // Rank sync
    rankSync: {
      intervalHours: 6, // Check rank every 6 hours
    },

    // Role assignments
    roles: {
      feederRoleName: 'Cục Tạ Vàng',
      feederRoleDuration: 24, // Hours
      feederRoleColor: '#808080', // Gray color
      rankRoles: {
        CHALLENGER: { name: 'Đỏ', color: '#F4C430' },
        GRANDMASTER: { name: 'Đỏ', color: '#F4C430' },
        MASTER: { name: 'Đỏ', color: '#F4C430' },
        DIAMOND: { name: 'Xanh Ngọc', color: '#3EEAD5' },
        PLATINUM: { name: 'Xanh Lam', color: '#4A90E2' },
        GOLD: { name: 'Vàng', color: '#FFD700' },
        SILVER: { name: 'Bạc', color: '#C0C0C0' },
        BRONZE: { name: 'Đồng', color: '#CD7F32' },
        IRON: { name: 'Xám', color: '#4A4A4A' },
      },
    },
  },

  // Application Settings
  app: {
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',
  },
};

/**
 * Get configuration object
 * @returns {Object} Configuration object
 */
function getConfig() {
  return config;
}

/**
 * Check if in development mode
 * @returns {boolean}
 */
function isDevelopment() {
  return config.app.isDevelopment;
}

/**
 * Check if in production mode
 * @returns {boolean}
 */
function isProduction() {
  return config.app.isProduction;
}

module.exports = {
  config,
  getConfig,
  isDevelopment,
  isProduction,
  validateConfig,
};
