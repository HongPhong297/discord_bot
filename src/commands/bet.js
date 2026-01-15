/**
 * Bet Command
 * Place a bet on a player's upcoming match
 */

const { SlashCommandBuilder } = require('discord.js');
const db = require('../services/database');
const riotApi = require('../services/riotApi');
const { placeBet } = require('../features/betting');
const { calculateBettingOdds, calculatePayout } = require('../utils/calculator');
const { createSuccessEmbed, createErrorEmbed, createInfoEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bet')
    .setDescription('Place a bet on a player\'s upcoming match')
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of bet to place')
        .setRequired(true)
        .addChoices(
          { name: 'Win', value: 'win' },
          { name: 'Loss', value: 'loss' },
          { name: 'KDA > 3.0', value: 'kda>3' },
          { name: 'Deaths > 7', value: 'deaths>7' },
          { name: 'Game > 30 min', value: 'time>30' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Amount of coins to bet')
        .setRequired(true)
        .setMinValue(1)
    )
    .addUserOption(option =>
      option
        .setName('player')
        .setDescription('Player to bet on (optional, defaults to the only open bet)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const betType = interaction.options.getString('type');
    const amount = interaction.options.getInteger('amount');
    const targetUser = interaction.options.getUser('player');

    log.command('bet', userId, interaction.guildId, { betType, amount, targetUser: targetUser?.id });

    await interaction.deferReply({ ephemeral: true });

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

      // Check balance
      if (user.currency < amount) {
        const embed = createErrorEmbed(
          'Insufficient Balance',
          `You don't have enough coins!
          
Your balance: **${user.currency}** coins
Bet amount: **${amount}** coins`
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Find open bet window
      let betWindow;
      if (targetUser) {
        // Specific player
        betWindow = await db.models.BetWindow.findOne({
          userId: targetUser.id,
          status: 'open',
        });

        if (!betWindow) {
          const embed = createErrorEmbed(
            'No Open Bet',
            `<@${targetUser.id}> doesn't have an open betting window.`
          );
          return await interaction.editReply({ embeds: [embed] });
        }
      } else {
        // Find any open bet window
        const openWindows = await db.models.BetWindow.find({ status: 'open' });

        if (openWindows.length === 0) {
          const embed = createErrorEmbed(
            'No Open Bets',
            'There are no open betting windows right now.\nSomeone needs to use `/openbet` before entering a game.'
          );
          return await interaction.editReply({ embeds: [embed] });
        }

        if (openWindows.length > 1) {
          const playerList = openWindows.map(w => `<@${w.userId}>`).join(', ');
          const embed = createErrorEmbed(
            'Multiple Open Bets',
            `There are multiple open betting windows: ${playerList}

Please specify who you want to bet on:
\`/bet type:${betType} amount:${amount} player:@username\``
          );
          return await interaction.editReply({ embeds: [embed] });
        }

        betWindow = openWindows[0];
      }

      // Don't allow betting on yourself
      if (betWindow.userId === userId) {
        const embed = createErrorEmbed(
          'Cannot Bet On Yourself',
          'You cannot place bets on your own games!'
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Get odds for the target player
      const targetDbUser = await db.models.User.findOne({ discordId: betWindow.userId });
      if (!targetDbUser) {
        const embed = createErrorEmbed(
          'Error',
          'Could not find the target player\'s account.'
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Calculate odds
      const winRateData = await riotApi.calculateWinRate(targetDbUser.riotPuuid, 20);
      const kdaData = await riotApi.calculateAverageKDA(targetDbUser.riotPuuid, 20);

      const odds = calculateBettingOdds({
        winRate: winRateData.winRate,
        avgKDA: kdaData.kda,
        avgDeaths: kdaData.avgDeaths,
      });

      const betOdds = odds[betType];
      if (!betOdds) {
        const embed = createErrorEmbed(
          'Invalid Bet Type',
          `The bet type "${betType}" is not valid.`
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Place the bet
      const result = await placeBet(userId, betWindow.userId, betType, amount, betOdds);

      // Calculate potential payout
      const potentialPayout = calculatePayout(amount, betOdds);

      const embed = createSuccessEmbed(
        'Bet Placed!',
        `You bet on <@${betWindow.userId}>'s game!

**Bet details:**
- Type: **${betType}**
- Amount: **${amount}** coins
- Odds: **x${betOdds}**
- Potential payout: **${potentialPayout}** coins

Your new balance: **${user.currency - amount}** coins

Good luck!`
      );

      log.info('Bet placed', {
        userId,
        targetUserId: betWindow.userId,
        betType,
        amount,
        odds: betOdds,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in bet command', error);

      const embed = createErrorEmbed(
        'Error',
        error.message || 'An error occurred while placing your bet.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
