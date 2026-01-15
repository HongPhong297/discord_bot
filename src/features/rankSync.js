/**
 * Rank Sync Feature
 * Synchronizes League of Legends rank with Discord roles
 */

const db = require('../services/database');
const riotApi = require('../services/riotApi');
const { getRankTier } = require('../utils/calculator');
const { createInfoEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

/**
 * Sync ranks for all linked users
 * @param {Object} client - Discord client
 */
async function syncAllRanks(client) {
  try {
    log.info('Starting rank sync for all users...');

    const users = await db.models.User.find({});
    if (users.length === 0) {
      log.info('No linked users to sync');
      return;
    }

    const guild = await client.guilds.fetch(config.discord.guildId);
    let syncedCount = 0;
    let errorCount = 0;
    const rankChanges = [];

    for (const user of users) {
      try {
        const result = await syncUserRank(client, user.discordId, guild);
        if (result.changed) {
          syncedCount++;
          rankChanges.push({
            userId: user.discordId,
            oldRank: result.oldRank,
            newRank: result.newRank,
          });
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        errorCount++;
        log.error(`Error syncing rank for ${user.discordId}`, error);
      }
    }

    log.info('Rank sync completed', {
      total: users.length,
      synced: syncedCount,
      errors: errorCount,
    });

    // Post summary to Discord if there are changes
    if (rankChanges.length > 0) {
      await postRankChanges(client, rankChanges);
    }
  } catch (error) {
    log.error('Error in syncAllRanks', error);
  }
}

/**
 * Sync rank for a specific user
 * @param {Object} client - Discord client
 * @param {string} userId - Discord user ID
 * @param {Object} guild - Discord guild (optional)
 * @returns {Object} Sync result
 */
async function syncUserRank(client, userId, guild = null) {
  try {
    const user = await db.models.User.findOne({ discordId: userId });
    if (!user) {
      throw new Error('User not found');
    }

    // Get ranked stats using PUUID (handles summoner lookup internally)
    const rankedStats = await riotApi.getRankedStatsByPuuid(user.riotPuuid, user.region);
    if (!rankedStats || rankedStats.length === 0) {
      log.info(`User ${userId} is unranked`);
      return { changed: false };
    }

    // Find RANKED_SOLO_5x5 queue (prioritize solo queue)
    let rankData = rankedStats.find(r => r.queueType === 'RANKED_SOLO_5x5');

    // Fallback to flex queue if no solo queue
    if (!rankData) {
      rankData = rankedStats.find(r => r.queueType === 'RANKED_FLEX_SR');
    }

    if (!rankData) {
      return { changed: false };
    }

    const oldRank = user.currentRank ? `${user.currentRank.tier} ${user.currentRank.division}` : 'Unranked';
    const newRank = `${rankData.tier} ${rankData.rank}`;

    // Check if rank changed
    const rankChanged = oldRank !== newRank;

    // Update user's rank in database
    user.currentRank = {
      tier: rankData.tier,
      division: rankData.rank,
      lp: rankData.leaguePoints,
      queueType: rankData.queueType,
    };
    user.lastRankSync = new Date();
    await user.save();

    log.info(`Synced rank for ${userId}`, {
      oldRank,
      newRank,
      changed: rankChanged,
    });

    // Update Discord role
    if (rankChanged) {
      if (!guild) {
        guild = await client.guilds.fetch(config.discord.guildId);
      }
      await updateDiscordRole(guild, userId, rankData.tier);
    }

    return {
      changed: rankChanged,
      oldRank,
      newRank,
    };
  } catch (error) {
    log.error(`Error syncing rank for ${userId}`, error);
    throw error;
  }
}

/**
 * Update Discord role based on rank tier
 * @param {Object} guild - Discord guild
 * @param {string} userId - Discord user ID
 * @param {string} tier - Rank tier (IRON, BRONZE, etc.)
 */
async function updateDiscordRole(guild, userId, tier) {
  try {
    const member = await guild.members.fetch(userId);
    if (!member) {
      log.warn(`Member ${userId} not found in guild`);
      return;
    }

    const rankConfig = config.features.roles.rankRoles[tier];
    if (!rankConfig) {
      log.warn(`No role config for tier: ${tier}`);
      return;
    }

    // Find or create rank role
    let role = guild.roles.cache.find(r => r.name === rankConfig.name);

    if (!role) {
      role = await guild.roles.create({
        name: rankConfig.name,
        color: rankConfig.color,
        reason: `Auto-created rank role for ${tier}`,
      });
      log.info('Created rank role', { tier, roleName: role.name });
    }

    // Remove old rank roles
    const allRankRoles = Object.values(config.features.roles.rankRoles).map(r => r.name);
    const oldRankRoles = member.roles.cache.filter(r => allRankRoles.includes(r.name) && r.id !== role.id);

    for (const oldRole of oldRankRoles.values()) {
      await member.roles.remove(oldRole);
      log.info('Removed old rank role', { userId, oldRole: oldRole.name });
    }

    // Add new rank role
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role);
      log.info('Added rank role', { userId, role: role.name, tier });
    }
  } catch (error) {
    log.error('Error updating Discord role', error);
  }
}

/**
 * Post rank changes to Discord
 * @param {Object} client - Discord client
 * @param {Array} rankChanges - Array of rank changes
 */
async function postRankChanges(client, rankChanges) {
  try {
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    if (!channel) {
      return;
    }

    let description = '**Cập nhật rank:**\n\n';

    rankChanges.forEach(change => {
      const oldTier = getRankTier(change.oldRank);
      const newTier = getRankTier(change.newRank);

      let emoji = '📊';
      if (oldTier === 'UNRANKED' || !change.oldRank) {
        emoji = '🎉'; // First time ranked
      } else {
        // Compare tiers
        const tierOrder = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
        const oldIndex = tierOrder.indexOf(oldTier);
        const newIndex = tierOrder.indexOf(newTier);

        if (newIndex > oldIndex) {
          emoji = '⬆️'; // Rank up
        } else if (newIndex < oldIndex) {
          emoji = '⬇️'; // Rank down
        }
      }

      description += `${emoji} <@${change.userId}>: ${change.oldRank || 'Unranked'} → **${change.newRank}**\n`;
    });

    const embed = createInfoEmbed('🔄 Rank Sync', description);
    await channel.send({ embeds: [embed] });

    log.info('Posted rank changes to Discord', { count: rankChanges.length });
  } catch (error) {
    log.error('Error posting rank changes', error);
  }
}

/**
 * API key expiration reminder (for development keys)
 */
async function sendApiKeyReminder(client) {
  try {
    if (!config.app.isDevelopment) {
      return;
    }

    log.warn('Development API key reminder');

    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    if (!channel) {
      return;
    }

    const embed = createInfoEmbed(
      '⚠️ Reminder: Riot API Key',
      '**Development API keys expire every 24 hours!**\n\n' +
      'Please refresh your Riot API key at:\n' +
      'https://developer.riotgames.com/\n\n' +
      'Update the `RIOT_API_KEY` environment variable in Railway dashboard or `.env` file.'
    );

    await channel.send({ embeds: [embed] });
  } catch (error) {
    log.error('Error sending API key reminder', error);
  }
}

module.exports = {
  syncAllRanks,
  syncUserRank,
  updateDiscordRole,
  sendApiKeyReminder,
};
