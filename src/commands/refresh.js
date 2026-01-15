/**
 * Refresh Command
 * Manually checks for new matches after completing a game
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../services/database');
const { checkForNewMatches, checkMatchesForUser } = require('../features/postGameAnalysis');
const { createSuccessEmbed, createErrorEmbed, createInfoEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Check for new completed matches')
    .addBooleanOption(option =>
      option
        .setName('all')
        .setDescription('Check all linked users (admin only, slower)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const checkAll = interaction.options.getBoolean('all') || false;

    log.command('refresh', userId, interaction.guildId, { checkAll });

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

      if (checkAll) {
        // Check all users (old behavior) - for admins/when needed
        const loadingEmbed = createInfoEmbed(
          'Checking all users...',
          'Scanning all linked users for new matches. This may take a while...'
        );
        await interaction.editReply({ embeds: [loadingEmbed] });

        await checkForNewMatches(interaction.client);

        const embed = createSuccessEmbed(
          'Refresh Complete (All Users)',
          'Finished checking all linked users for new matches.\nIf any new matches were found with 2+ Discord members, they have been posted.'
        );
        await interaction.editReply({ embeds: [embed] });

      } else {
        // Check only the caller's matches (new default behavior)
        const loadingEmbed = createInfoEmbed(
          'Checking your matches...',
          `Scanning your recent matches, <@${userId}>. This may take a moment...`
        );
        await interaction.editReply({ embeds: [loadingEmbed] });

        const result = await checkMatchesForUser(interaction.client, userId);

        // Build result message
        let description = `Checked **${result.checked}** recent matches.\n`;
        
        if (result.newMatches > 0) {
          description += `\n✅ **${result.newMatches}** new match(es) with 2+ Discord members found and posted!`;
        } else {
          description += '\nNo new matches with 2+ Discord members found.';
          
          // Show why no matches were posted
          if (result.skippedAlreadyProcessed > 0) {
            description += `\n• ${result.skippedAlreadyProcessed} already processed`;
          }
          if (result.skippedNotEnoughPlayers > 0) {
            description += `\n• ${result.skippedNotEnoughPlayers} had < 2 Discord members`;
          }
        }

        // Show debug info if available
        if (result.debugInfo && result.debugInfo.length > 0) {
          description += '\n\n**Match details:**\n';
          result.debugInfo.forEach(info => {
            description += `• ${info}\n`;
          });
        }

        if (result.errors.length > 0) {
          description += `\n\n⚠️ **${result.errors.length}** error(s) occurred:`;
          // Show first 3 errors max
          result.errors.slice(0, 3).forEach(err => {
            description += `\n• ${err}`;
          });
          if (result.errors.length > 3) {
            description += `\n• ... and ${result.errors.length - 3} more`;
          }
        }

        description += '\n\n💡 *Tip: Use `/refresh all:True` to check all linked users.*';

        const embed = result.errors.length > 0 && result.newMatches === 0
          ? createErrorEmbed('Refresh Complete (with errors)', description)
          : createSuccessEmbed('Refresh Complete', description);

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      log.error('Error in refresh command', error);

      const embed = createErrorEmbed(
        'Error',
        'An error occurred while checking for matches. Please try again later.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
