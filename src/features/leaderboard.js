/**
 * Leaderboard Feature
 * Manages weekly leaderboards and rankings
 */

const db = require('../services/database');
const { compareRanks } = require('../utils/calculator');
const { createLeaderboardEmbed, createInfoEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

/**
 * Get current week's leaderboard
 * @returns {Object} Leaderboard data by category
 */
async function getLeaderboard() {
  try {
    const currentWeek = db.utils.getCurrentWeek();

    const leaderboards = await db.models.Leaderboard.find({ week: currentWeek });

    if (leaderboards.length === 0) {
      return null;
    }

    // Get user data for display
    const userIds = leaderboards.map(l => l.userId);
    const users = await db.models.User.find({ discordId: { $in: userIds } });
    const userMap = {};
    users.forEach(u => {
      userMap[u.discordId] = u;
    });

    // Category: Top Thần Đồng (Highest Rank)
    const topRank = leaderboards
      .filter(l => l.highestRank)
      .sort((a, b) => compareRanks(a.highestRank, b.highestRank))
      .slice(0, 10)
      .map(l => ({
        userId: l.userId,
        value: l.highestRank.replace('_', ' '),
        summonerName: userMap[l.userId]?.summonerName || 'Unknown',
      }));

    // Category: Top Máy Đếm Số (Most Deaths)
    const topDeaths = leaderboards
      .sort((a, b) => b.totalDeaths - a.totalDeaths)
      .slice(0, 10)
      .map(l => ({
        userId: l.userId,
        value: `${l.totalDeaths} deaths`,
        summonerName: userMap[l.userId]?.summonerName || 'Unknown',
      }));

    // Category: Top Sát Thủ (Most Kills)
    const topKills = leaderboards
      .sort((a, b) => b.totalKills - a.totalKills)
      .slice(0, 10)
      .map(l => ({
        userId: l.userId,
        value: `${l.totalKills} kills`,
        summonerName: userMap[l.userId]?.summonerName || 'Unknown',
      }));

    // Category: Top Cày Cuốc (Most Games)
    const topGames = leaderboards
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, 10)
      .map(l => ({
        userId: l.userId,
        value: `${l.gamesPlayed} games`,
        summonerName: userMap[l.userId]?.summonerName || 'Unknown',
      }));

    // Category: Top Win Rate (minimum 5 games)
    const topWinRate = leaderboards
      .filter(l => l.gamesPlayed >= 5)
      .sort((a, b) => {
        const wrA = (a.gamesWon / a.gamesPlayed) * 100;
        const wrB = (b.gamesWon / b.gamesPlayed) * 100;
        return wrB - wrA;
      })
      .slice(0, 10)
      .map(l => {
        const wr = Math.round((l.gamesWon / l.gamesPlayed) * 100);
        return {
          userId: l.userId,
          value: `${wr}% (${l.gamesWon}W-${l.gamesPlayed - l.gamesWon}L)`,
          summonerName: userMap[l.userId]?.summonerName || 'Unknown',
        };
      });

    // Category: Top Rich (Most Coins)
    const richUsers = await db.models.User.find({ discordId: { $in: userIds } })
      .sort({ currency: -1 })
      .limit(10);

    const topRich = richUsers.map(u => ({
      userId: u.discordId,
      value: `${u.currency} coins`,
      summonerName: u.summonerName,
    }));

    return {
      week: currentWeek,
      categories: {
        '🏆 Top "Thần Đồng"': topRank,
        '💀 Top "Máy Đếm Số"': topDeaths,
        '⚔️ Top "Sát Thủ"': topKills,
        '🚜 Top "Cày Cuốc"': topGames,
        '📈 Top Win Rate': topWinRate,
        '💰 Top Giàu': topRich,
      },
    };
  } catch (error) {
    log.error('Error getting leaderboard', error);
    throw error;
  }
}

/**
 * Get leaderboard embed for Discord
 * @returns {Object} Discord embed
 */
async function getLeaderboardEmbed() {
  try {
    const data = await getLeaderboard();

    if (!data) {
      return createInfoEmbed(
        'Bảng xếp hạng',
        'Chưa có dữ liệu cho tuần này. Hãy chơi vài game để xuất hiện trên bảng xếp hạng!'
      );
    }

    return createLeaderboardEmbed(data.week, data.categories);
  } catch (error) {
    log.error('Error getting leaderboard embed', error);
    throw error;
  }
}

/**
 * Get personal stats for a user
 * @param {string} userId - Discord user ID
 * @returns {Object} User stats
 */
async function getUserStats(userId) {
  try {
    const user = await db.models.User.findOne({ discordId: userId });
    if (!user) {
      throw new Error('Account not linked. Use /link first!');
    }

    const currentWeek = db.utils.getCurrentWeek();
    const weeklyStats = await db.models.Leaderboard.findOne({
      userId,
      week: currentWeek,
    });

    // Get all-time stats
    const allTimeMatches = await db.models.Match.find({
      'participants.discordId': userId,
    });

    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalWins = 0;
    let totalGames = allTimeMatches.length;

    allTimeMatches.forEach(match => {
      const participant = match.participants.find(p => p.discordId === userId);
      if (participant) {
        totalKills += participant.kills;
        totalDeaths += participant.deaths;
        totalAssists += participant.assists;
        if (participant.win) totalWins++;
      }
    });

    const avgKDA = totalDeaths > 0
      ? ((totalKills + totalAssists) / totalDeaths).toFixed(2)
      : (totalKills + totalAssists).toFixed(2);

    return {
      user: {
        discordId: userId,
        summonerName: user.summonerName,
        rank: user.currentRank ? `${user.currentRank.tier} ${user.currentRank.division}` : 'Unranked',
        currency: user.currency,
      },
      weekly: weeklyStats || {
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        gamesPlayed: 0,
        gamesWon: 0,
      },
      allTime: {
        totalKills,
        totalDeaths,
        totalAssists,
        totalGames,
        wins: totalWins,
        losses: totalGames - totalWins,
        avgKDA,
      },
    };
  } catch (error) {
    log.error('Error getting user stats', error);
    throw error;
  }
}

/**
 * Reset weekly leaderboard
 * @param {Object} client - Discord client
 */
async function resetWeeklyLeaderboard(client) {
  try {
    log.info('Resetting weekly leaderboard...');

    const previousWeek = db.utils.getCurrentWeek();

    // Get final standings
    const finalStandings = await getLeaderboard();

    if (finalStandings) {
      // Post final results to Discord
      const channel = await client.channels.fetch(config.discord.trackedChannelId);

      const embed = createInfoEmbed(
        '📊 KẾT THÚC TUẦN',
        `**Tuần ${previousWeek}** đã kết thúc!\n\nCác vị trí dẫn đầu:`
      );

      // Add top 3 from each category
      Object.entries(finalStandings.categories).forEach(([category, players]) => {
        if (players.length > 0) {
          const topPlayers = players.slice(0, 3).map((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            return `${medal} <@${p.userId}> - ${p.value}`;
          }).join('\n');

          embed.addFields({ name: category, value: topPlayers, inline: true });
        }
      });

      embed.addFields({
        name: '\u200B',
        value: 'Bảng xếp hạng mới bắt đầu từ bây giờ! 🔄',
      });

      await channel.send({ embeds: [embed] });
    }

    // Note: We don't delete old leaderboard data, just start a new week
    // Old data is kept for historical purposes

    log.info('Weekly leaderboard reset completed');
  } catch (error) {
    log.error('Error resetting weekly leaderboard', error);
  }
}

/**
 * Get top players by specific category
 * @param {string} category - Category name
 * @param {number} limit - Number of players to return
 * @returns {Array} Top players
 */
async function getTopPlayers(category, limit = 10) {
  try {
    const currentWeek = db.utils.getCurrentWeek();
    let leaderboards = await db.models.Leaderboard.find({ week: currentWeek });

    switch (category) {
      case 'rank':
        leaderboards = leaderboards
          .filter(l => l.highestRank)
          .sort((a, b) => compareRanks(a.highestRank, b.highestRank));
        break;

      case 'kills':
        leaderboards = leaderboards.sort((a, b) => b.totalKills - a.totalKills);
        break;

      case 'deaths':
        leaderboards = leaderboards.sort((a, b) => b.totalDeaths - a.totalDeaths);
        break;

      case 'games':
        leaderboards = leaderboards.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
        break;

      case 'winrate':
        leaderboards = leaderboards
          .filter(l => l.gamesPlayed >= 5)
          .sort((a, b) => {
            const wrA = (a.gamesWon / a.gamesPlayed) * 100;
            const wrB = (b.gamesWon / b.gamesPlayed) * 100;
            return wrB - wrA;
          });
        break;

      default:
        throw new Error(`Unknown category: ${category}`);
    }

    return leaderboards.slice(0, limit);
  } catch (error) {
    log.error('Error getting top players', error);
    throw error;
  }
}

module.exports = {
  getLeaderboard,
  getLeaderboardEmbed,
  getUserStats,
  resetWeeklyLeaderboard,
  getTopPlayers,
};
