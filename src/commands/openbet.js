/**
 * Openbet Command
 * Opens a betting window before entering a game
 */

const { SlashCommandBuilder } = require('discord.js');
const db = require('../services/database');
const { openBettingWindow } = require('../features/betting');
const { createSuccessEmbed, createErrorEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('openbet')
    .setDescription('Open a betting window before entering a game'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('openbet', userId, interaction.guildId);

    await interaction.deferReply();

    try {
      // Check if user is linked
      const user = await db.models.User.findOne({ discordId: userId });
      if (!user) {
        const embed = createErrorEmbed(
          'Not Linked',
          'Your Discord account is not linked to any Riot account.\nUse `/link` to connect your account first.'
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Open betting window
      const result = await openBettingWindow(interaction.client, userId, interaction);

      const embed = createSuccessEmbed(
        'Betting Window Opened',
        `Betting is now open for **${config.features.betting.bettingWindowDuration}** minutes!

Other users can bet on your next game using \`/bet\`.

**Your recent stats:**
- Odds have been calculated based on your last 20 games.

Good luck!`
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in openbet command', error);

      const embed = createErrorEmbed(
        'Error',
        error.message || 'An error occurred while opening the betting window.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
