/**
 * Unlink Command
 * Unlinks a Discord account from a Riot account
 */

const { SlashCommandBuilder } = require('discord.js');
const db = require('../services/database');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink your Discord account from your Riot account'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('unlink', userId, interaction.guildId);

    await interaction.deferReply({ ephemeral: true });

    try {
      // Check if user is linked
      const user = await db.models.User.findOne({ discordId: userId });
      if (!user) {
        const embed = createErrorEmbed(
          'Not Linked',
          'Your Discord account is not linked to any Riot account.\nUse `/link` to connect your account.'
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      const summonerName = user.summonerName;

      // Delete user
      await db.models.User.deleteOne({ discordId: userId });
      log.db('delete', 'User', true);

      // Note: We keep the user's matches and leaderboard data for historical purposes
      // Only the account link is removed

      const embed = createSuccessEmbed(
        'Account Unlinked',
        `Successfully unlinked from **${summonerName}**.
        
Your match history and leaderboard stats are preserved.
Use \`/link\` to connect a new account.`
      );

      log.info('User unlinked account', { userId, summonerName });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in unlink command', error);

      const embed = createErrorEmbed(
        'Error',
        'An error occurred while unlinking your account. Please try again later.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
