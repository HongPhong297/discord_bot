/**
 * Leaderboard Command
 * View the weekly leaderboard
 */

const { SlashCommandBuilder } = require('discord.js');
const { getLeaderboardEmbed } = require('../features/leaderboard');
const { createErrorEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the weekly leaderboard'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('leaderboard', userId, interaction.guildId);

    await interaction.deferReply();

    try {
      const embed = await getLeaderboardEmbed();
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in leaderboard command', error);

      const embed = createErrorEmbed(
        'Error',
        'An error occurred while fetching the leaderboard.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
