/**
 * Database Service
 * MongoDB connection and Mongoose schemas
 */

const mongoose = require('mongoose');
const { config } = require('../config/config');
const log = require('../utils/logger');

/**
 * User Schema
 * Stores Discord users with linked Riot accounts
 */
const userSchema = new mongoose.Schema({
  discordId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  riotPuuid: {
    type: String,
    required: true,
    index: true,
  },
  summonerName: {
    type: String,
    required: true,
  },
  gameName: String, // Riot ID game name
  tagLine: String, // Riot ID tag line
  region: {
    type: String,
    default: 'vn2',
  },
  currency: {
    type: Number,
    default: config.features.betting.initialCoins,
  },
  linkedAt: {
    type: Date,
    default: Date.now,
  },
  lastRankSync: Date,
  currentRank: {
    tier: String, // IRON, BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, MASTER, GRANDMASTER, CHALLENGER
    division: String, // I, II, III, IV
    lp: Number,
    queueType: String, // RANKED_SOLO_5x5, RANKED_FLEX_SR
  },
}, {
  timestamps: true,
});

/**
 * Match Schema
 * Stores analyzed matches
 */
const matchSchema = new mongoose.Schema({
  matchId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  participants: [{
    discordId: String,
    puuid: String,
    summonerName: String,
    championName: String,
    championId: Number,
    teamId: Number,
    kills: Number,
    deaths: Number,
    assists: Number,
    totalDamageDealt: Number,
    totalDamageDealtToChampions: Number,
    totalDamageTaken: Number,
    goldEarned: Number,
    visionScore: Number,
    win: Boolean,
    mvpScore: Number, // Calculated MVP score
  }],
  mvp: String, // Discord ID of MVP
  feeder: String, // Discord ID of feeder
  gameDuration: Number, // Seconds
  gameMode: String,
  queueId: Number,
  timestamp: {
    type: Date,
    required: true,
    index: true,
  },
  analyzedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

/**
 * Bet Schema
 * Stores betting information
 */
const betSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  targetUserId: {
    type: String,
    required: true,
    index: true,
  },
  matchId: String, // Set when match is verified
  betType: {
    type: String,
    required: true,
    enum: ['win', 'loss', 'kda>3', 'deaths>7', 'time>30'],
  },
  amount: {
    type: Number,
    required: true,
    min: 1,
  },
  odds: {
    type: Number,
    required: true,
  },
  result: {
    type: String,
    enum: ['pending', 'won', 'lost', 'cancelled'],
    default: 'pending',
    index: true,
  },
  payout: Number,
  openedAt: {
    type: Date,
    required: true,
  },
  settledAt: Date,
}, {
  timestamps: true,
});

/**
 * Bet Window Schema
 * Tracks open betting windows
 */
const betWindowSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'matched', 'cancelled'],
    default: 'open',
    index: true,
  },
  openedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  closedAt: Date,
  matchId: String,
  totalBets: {
    type: Number,
    default: 0,
  },
  totalAmount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

/**
 * Leaderboard Schema
 * Weekly statistics for users
 */
const leaderboardSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  week: {
    type: String,
    required: true,
    index: true, // Format: "2024-W52"
  },
  totalKills: {
    type: Number,
    default: 0,
  },
  totalDeaths: {
    type: Number,
    default: 0,
  },
  totalAssists: {
    type: Number,
    default: 0,
  },
  gamesPlayed: {
    type: Number,
    default: 0,
  },
  gamesWon: {
    type: Number,
    default: 0,
  },
  highestRank: String, // "DIAMOND_II"
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index for week + userId
leaderboardSchema.index({ week: 1, userId: 1 }, { unique: true });

/**
 * Role Assignment Schema
 * Tracks temporary role assignments (like "Cục Tạ Vàng")
 */
const roleAssignmentSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  roleId: String,
  roleName: {
    type: String,
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  matchId: String,
  reason: String,
}, {
  timestamps: true,
});

/**
 * Schedule Schema
 * Stores game schedules/lobbies
 */
const scheduleSchema = new mongoose.Schema({
  odId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  creatorId: {
    type: String,
    required: true,
    index: true,
  },
  mode: {
    type: String,
    required: true,
    enum: ['solo', 'duo', 'flex3', 'flex5', 'aram', 'custom'],
  },
  maxPlayers: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  scheduledTime: {
    type: String, // e.g., "20:00", "tối nay", "now"
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  participants: [{
    odId: String,
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  messageId: String, // Discord message ID for updating
  channelId: String, // Discord channel ID
  status: {
    type: String,
    enum: ['open', 'full', 'started', 'cancelled', 'expired'],
    default: 'open',
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
}, {
  timestamps: true,
});

// Create models
const User = mongoose.model('User', userSchema);
const Match = mongoose.model('Match', matchSchema);
const Bet = mongoose.model('Bet', betSchema);
const BetWindow = mongoose.model('BetWindow', betWindowSchema);
const Leaderboard = mongoose.model('Leaderboard', leaderboardSchema);
const RoleAssignment = mongoose.model('RoleAssignment', roleAssignmentSchema);
const Schedule = mongoose.model('Schedule', scheduleSchema);

/**
 * Connect to MongoDB
 */
async function connect() {
  try {
    await mongoose.connect(config.database.uri, config.database.options);
    log.info('Connected to MongoDB', {
      database: mongoose.connection.name,
      host: mongoose.connection.host,
    });
  } catch (error) {
    log.error('Failed to connect to MongoDB', error);
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
async function disconnect() {
  try {
    await mongoose.disconnect();
    log.info('Disconnected from MongoDB');
  } catch (error) {
    log.error('Error disconnecting from MongoDB', error);
    throw error;
  }
}

/**
 * Get current ISO week string (e.g., "2024-W52")
 */
function getCurrentWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${week.toString().padStart(2, '0')}`;
}

/**
 * Database utilities
 */
const db = {
  connect,
  disconnect,
  models: {
    User,
    Match,
    Bet,
    BetWindow,
    Leaderboard,
    RoleAssignment,
    Schedule,
  },
  utils: {
    getCurrentWeek,
  },
};

// Handle MongoDB connection events
mongoose.connection.on('connected', () => {
  log.info('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  log.error('Mongoose connection error', err);
});

mongoose.connection.on('disconnected', () => {
  log.warn('Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await disconnect();
    process.exit(0);
  } catch (error) {
    log.error('Error during graceful shutdown', error);
    process.exit(1);
  }
});

module.exports = db;
