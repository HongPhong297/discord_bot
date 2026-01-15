/**
 * Stats Command
 * View personal statistics
 */

const { SlashCommandBuilder } = require('discord.js');
const { getUserStats } = require('../features/leaderboard');
const { createStatsEmbed, createErrorEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View personal statistics')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to view stats for (optional, defaults to yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userId = targetUser.id;

    log.command('stats', interaction.user.id, interaction.guildId, { targetUserId: userId });

    await interaction.deferReply();

    try {
      const stats = await getUserStats(userId);

      const embed = createStatsEmbed(stats.user, stats.allTime);

      // Add weekly stats if available
      if (stats.weekly.gamesPlayed > 0) {
        const weeklyWinRate = stats.weekly.gamesPlayed > 0
          ? Math.round((stats.weekly.gamesWon / stats.weekly.gamesPlayed) * 100)
          : 0;

        embed.addFields(
          { name: '\u200B', value: '**--- This Week ---**', inline: false },
          { name: 'Games', value: `${stats.weekly.gamesPlayed} (${stats.weekly.gamesWon}W-${stats.weekly.gamesPlayed - stats.weekly.gamesWon}L)`, inline: true },
          { name: 'Win Rate', value: `${weeklyWinRate}%`, inline: true },
          { name: 'KDA', value: `${stats.weekly.totalKills}/${stats.weekly.totalDeaths}/${stats.weekly.totalAssists}`, inline: true }
        );
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in stats command', error);

      const embed = createErrorEmbed(
        'Error',
        error.message || 'An error occurred while fetching statistics.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
