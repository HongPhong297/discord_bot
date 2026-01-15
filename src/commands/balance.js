/**
 * Balance Command
 * Check your coin balance and betting stats
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const { getBalance } = require('../features/betting');
const { createErrorEmbed, COLORS } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your coin balance and betting statistics'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('balance', userId, interaction.guildId);

    await interaction.deferReply({ ephemeral: true });

    try {
      const balance = await getBalance(userId);

      // Calculate profit/loss
      const profit = balance.totalWon - balance.totalWagered;
      const profitEmoji = profit >= 0 ? '+' : '';
      const profitColor = profit >= 0 ? 'green' : 'red';

      const embed = new EmbedBuilder()
        .setTitle('Your Balance')
        .setColor(COLORS.INFO)
        .setDescription(`<@${userId}>`)
        .addFields(
          { name: 'Current Balance', value: `${balance.currency} coins`, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: 'Total Bets', value: `${balance.totalBets}`, inline: true },
          { name: 'Won', value: `${balance.wonBets}`, inline: true },
          { name: 'Lost', value: `${balance.lostBets}`, inline: true },
          { name: 'Win Rate', value: `${balance.winRate}%`, inline: true },
          { name: 'Total Wagered', value: `${balance.totalWagered} coins`, inline: true },
          { name: 'Total Won', value: `${balance.totalWon} coins`, inline: true },
          { name: 'Net Profit', value: `${profitEmoji}${profit} coins`, inline: false }
        )
        .setFooter({ text: 'Use /bet to place bets on games!' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in balance command', error);

      const embed = createErrorEmbed(
        'Error',
        error.message || 'An error occurred while checking your balance.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
