/**
 * Betting System Feature
 * Manages betting windows, bets, and payouts
 */

const db = require('../services/database');
const riotApi = require('../services/riotApi');
const aiService = require('../services/aiService');
const { calculateBettingOdds, calculatePayout, evaluateBet, calculateKDA } = require('../utils/calculator');
const { createBettingWindowEmbed, createBettingResultsEmbed, createInfoEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

/**
 * Open a betting window for a user
 * @param {Object} client - Discord client
 * @param {string} userId - Discord user ID
 * @param {Object} interaction - Discord interaction
 * @returns {Object} Betting window data
 */
async function openBettingWindow(client, userId, interaction) {
  try {
    log.bet('open', userId);

    // Check if user has linked account
    const user = await db.models.User.findOne({ discordId: userId });
    if (!user) {
      throw new Error('Account not linked. Use /link first!');
    }

    // Check if user already has an open bet window
    const existingWindow = await db.models.BetWindow.findOne({
      userId,
      status: { $in: ['open', 'closed'] },
    });

    if (existingWindow) {
      throw new Error('You already have an active betting window!');
    }

    // Get user's recent stats
    const winRateData = await riotApi.calculateWinRate(user.riotPuuid, 20);
    const kdaData = await riotApi.calculateAverageKDA(user.riotPuuid, 20);

    const stats = {
      winRate: winRateData.winRate,
      wins: winRateData.wins,
      losses: winRateData.losses,
      avgKDA: kdaData.kda,
      avgKills: kdaData.avgKills,
      avgDeaths: kdaData.avgDeaths,
      avgAssists: kdaData.avgAssists,
      rank: user.currentRank ? `${user.currentRank.tier} ${user.currentRank.division}` : 'Unranked',
    };

    // Calculate betting odds
    const odds = calculateBettingOdds({
      winRate: stats.winRate,
      avgKDA: stats.avgKDA,
      avgDeaths: stats.avgDeaths,
    });

    // Generate AI announcement (optional, non-blocking)
    let announcement = null;
    try {
      announcement = await aiService.generateBettingAnnouncement({
        name: user.summonerName,
        rank: stats.rank,
        winRate: stats.winRate,
        recentRecord: `${stats.wins}W-${stats.losses}L`,
        avgKDA: stats.avgKDA,
      });
    } catch (error) {
      log.warn('Failed to generate AI announcement, continuing without it', error);
    }

    // Create bet window
    const betWindow = new db.models.BetWindow({
      userId,
      status: 'open',
      openedAt: new Date(),
    });

    await betWindow.save();
    log.db('insert', 'BetWindow', true);

    // Post to Discord
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    const embed = createBettingWindowEmbed(
      {
        discordId: userId,
        stats,
        announcement,
      },
      odds,
      config.features.betting.bettingWindowDuration
    );

    const message = await channel.send({ embeds: [embed] });

    // Schedule window closure
    setTimeout(async () => {
      await closeBettingWindow(client, betWindow._id);
    }, config.features.betting.bettingWindowDuration * 60 * 1000);

    log.bet('opened', userId, null, null);

    return {
      windowId: betWindow._id,
      odds,
      stats,
      messageId: message.id,
    };
  } catch (error) {
    log.error('Error opening betting window', error);
    throw error;
  }
}

/**
 * Close a betting window
 * @param {Object} client - Discord client
 * @param {string} windowId - Bet window ID
 */
async function closeBettingWindow(client, windowId) {
  try {
    const betWindow = await db.models.BetWindow.findById(windowId);
    if (!betWindow || betWindow.status !== 'open') {
      return;
    }

    betWindow.status = 'closed';
    betWindow.closedAt = new Date();
    await betWindow.save();

    log.bet('closed', betWindow.userId);

    // Post closure notification
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    const embed = createInfoEmbed(
      '🔒 Cửa cược đã đóng',
      `Cửa cược cho <@${betWindow.userId}> đã đóng!\nTổng cược: ${betWindow.totalBets} (${betWindow.totalAmount} coins)\nChờ kết quả trận đấu...`
    );

    await channel.send({ embeds: [embed] });

    // Schedule cancellation if no match found within maxMatchWaitTime
    setTimeout(async () => {
      await checkAndCancelWindow(client, windowId);
    }, config.features.betting.maxMatchWaitTime * 60 * 1000);
  } catch (error) {
    log.error('Error closing betting window', error);
  }
}

/**
 * Check and cancel window if no match found
 * @param {Object} client - Discord client
 * @param {string} windowId - Bet window ID
 */
async function checkAndCancelWindow(client, windowId) {
  try {
    const betWindow = await db.models.BetWindow.findById(windowId);
    if (!betWindow || betWindow.status !== 'closed') {
      return;
    }

    // If still no match found, cancel
    betWindow.status = 'cancelled';
    await betWindow.save();

    // Refund all bets
    const bets = await db.models.Bet.find({
      openedAt: betWindow.openedAt,
      targetUserId: betWindow.userId,
      result: 'pending',
    });

    for (const bet of bets) {
      const user = await db.models.User.findOne({ discordId: bet.userId });
      if (user) {
        user.currency += bet.amount;
        await user.save();
      }

      bet.result = 'cancelled';
      await bet.save();
    }

    // Penalize the window opener
    const opener = await db.models.User.findOne({ discordId: betWindow.userId });
    if (opener) {
      opener.currency -= config.features.betting.cancellationPenalty;
      await opener.save();
    }

    // Notify
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    const embed = createInfoEmbed(
      '⚠️ Cược bị hủy',
      `<@${betWindow.userId}> không vào game trong ${config.features.betting.maxMatchWaitTime} phút.\n` +
      `Tất cả coins đã được hoàn trả.\n` +
      `Phạt: ${config.features.betting.cancellationPenalty} coins.`
    );

    await channel.send({ embeds: [embed] });

    log.bet('cancelled', betWindow.userId);
  } catch (error) {
    log.error('Error checking/cancelling window', error);
  }
}

/**
 * Place a bet
 * @param {string} userId - Discord user ID
 * @param {string} targetUserId - User being bet on
 * @param {string} betType - Type of bet
 * @param {number} amount - Bet amount
 * @param {number} odds - Betting odds
 * @returns {Object} Bet data
 */
async function placeBet(userId, targetUserId, betType, amount, odds) {
  try {
    log.bet('place', userId, amount, betType);

    // Check if user has enough currency
    const user = await db.models.User.findOne({ discordId: userId });
    if (!user) {
      throw new Error('Account not linked. Use /link first!');
    }

    if (user.currency < amount) {
      throw new Error(`Not enough coins! You have ${user.currency} coins.`);
    }

    // Find open bet window for target user
    const betWindow = await db.models.BetWindow.findOne({
      userId: targetUserId,
      status: 'open',
    });

    if (!betWindow) {
      throw new Error('No open betting window for this user!');
    }

    // Deduct coins
    user.currency -= amount;
    await user.save();

    // Create bet
    const bet = new db.models.Bet({
      userId,
      targetUserId,
      betType,
      amount,
      odds,
      openedAt: betWindow.openedAt,
    });

    await bet.save();

    // Update bet window stats
    betWindow.totalBets += 1;
    betWindow.totalAmount += amount;
    await betWindow.save();

    log.db('insert', 'Bet', true);
    log.bet('placed', userId, amount, betType);

    return {
      betId: bet._id,
      amount,
      odds,
      potentialPayout: calculatePayout(amount, odds),
    };
  } catch (error) {
    log.error('Error placing bet', error);
    throw error;
  }
}

/**
 * Settle bets for a completed match
 * @param {Object} client - Discord client
 * @param {string} windowId - Bet window ID
 * @param {Object} playerStats - Player statistics from match
 * @param {string} matchId - Match ID
 */
async function settleBets(client, windowId, playerStats, matchId) {
  try {
    log.bet('settle', playerStats.discordId);

    const betWindow = await db.models.BetWindow.findById(windowId);
    if (!betWindow) {
      return;
    }

    // Get all pending bets for this window
    const bets = await db.models.Bet.find({
      openedAt: betWindow.openedAt,
      targetUserId: betWindow.userId,
      result: 'pending',
    });

    if (bets.length === 0) {
      log.info('No bets to settle');
      return;
    }

    const winners = [];
    const losers = [];

    // Calculate match stats for bet evaluation
    const matchStats = {
      win: playerStats.win,
      kda: calculateKDA(playerStats.kills, playerStats.deaths, playerStats.assists),
      deaths: playerStats.deaths,
      gameDuration: matchId ? (await db.models.Match.findOne({ matchId }))?.gameDuration : 0,
    };

    // Evaluate each bet
    for (const bet of bets) {
      const won = evaluateBet(bet.betType, matchStats);

      if (won) {
        // Winner - calculate payout
        const payout = calculatePayout(bet.amount, bet.odds);
        bet.payout = payout;
        bet.result = 'won';

        // Add coins to user
        const user = await db.models.User.findOne({ discordId: bet.userId });
        if (user) {
          user.currency += payout;
          await user.save();
        }

        winners.push({
          userId: bet.userId,
          betType: bet.betType,
          amount: bet.amount,
          payout,
        });
      } else {
        // Loser - no payout
        bet.payout = 0;
        bet.result = 'lost';

        losers.push({
          userId: bet.userId,
          betType: bet.betType,
          amount: bet.amount,
        });
      }

      bet.matchId = matchId;
      bet.settledAt = new Date();
      await bet.save();
    }

    // Post results to Discord
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    const embed = createBettingResultsEmbed({
      matchId,
      totalBets: bets.length,
      winners,
      losers,
    });

    await channel.send({ embeds: [embed] });

    log.bet('settled', betWindow.userId, null, `${winners.length}W-${losers.length}L`);
  } catch (error) {
    log.error('Error settling bets', error);
  }
}

/**
 * Get user's betting balance
 * @param {string} userId - Discord user ID
 * @returns {Object} Balance information
 */
async function getBalance(userId) {
  try {
    const user = await db.models.User.findOne({ discordId: userId });
    if (!user) {
      throw new Error('Account not linked. Use /link first!');
    }

    // Get betting stats
    const totalBets = await db.models.Bet.countDocuments({ userId });
    const wonBets = await db.models.Bet.countDocuments({ userId, result: 'won' });
    const lostBets = await db.models.Bet.countDocuments({ userId, result: 'lost' });

    const totalWagered = await db.models.Bet.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const totalWon = await db.models.Bet.aggregate([
      { $match: { userId, result: 'won' } },
      { $group: { _id: null, total: { $sum: '$payout' } } },
    ]);

    return {
      currency: user.currency,
      totalBets,
      wonBets,
      lostBets,
      winRate: totalBets > 0 ? Math.round((wonBets / totalBets) * 100) : 0,
      totalWagered: totalWagered[0]?.total || 0,
      totalWon: totalWon[0]?.total || 0,
    };
  } catch (error) {
    log.error('Error getting balance', error);
    throw error;
  }
}

/**
 * Cleanup expired bet windows
 */
async function cleanupExpiredWindows() {
  try {
    log.info('Cleaning up expired bet windows...');

    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - (config.features.betting.maxMatchWaitTime + 10));

    const expiredWindows = await db.models.BetWindow.find({
      status: 'closed',
      closedAt: { $lte: cutoffTime },
    });

    for (const window of expiredWindows) {
      window.status = 'cancelled';
      await window.save();
    }

    log.info(`Cleaned up ${expiredWindows.length} expired bet windows`);
  } catch (error) {
    log.error('Error in cleanupExpiredWindows', error);
  }
}

module.exports = {
  openBettingWindow,
  closeBettingWindow,
  placeBet,
  settleBets,
  getBalance,
  cleanupExpiredWindows,
};
