/**
 * Help Command
 * Display bot commands and usage information
 */

const { SlashCommandBuilder } = require('discord.js');
const { createHelpEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display all available commands and usage information'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('help', userId, interaction.guildId);

    try {
      const embed = createHelpEmbed();
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in help command', error);
      await interaction.reply({
        content: 'An error occurred while displaying help information.',
        ephemeral: true,
      });
    }
  },
};
