/**
 * Link Command
 * Links a Discord account to a Riot account
 */

const { SlashCommandBuilder } = require('discord.js');
const db = require('../services/database');
const riotApi = require('../services/riotApi');
const { createAccountLinkedEmbed, createErrorEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Riot account')
    .addStringOption(option =>
      option
        .setName('riot_id')
        .setDescription('Your Riot ID (format: GameName#TagLine)')
        .setRequired(true)
    ),

  async execute(interaction) {
    const riotId = interaction.options.getString('riot_id');
    const userId = interaction.user.id;

    log.command('link', userId, interaction.guildId, { riotId });

    await interaction.deferReply();

    try {
      // Parse Riot ID
      const parts = riotId.split('#');
      if (parts.length !== 2) {
        const embed = createErrorEmbed(
          'Invalid Riot ID',
          'Please use the format: `GameName#TagLine`\nExample: `/link Faker#KR1`'
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      const [gameName, tagLine] = parts;

      // Check if user is already linked
      const existingUser = await db.models.User.findOne({ discordId: userId });
      if (existingUser) {
        const embed = createErrorEmbed(
          'Already Linked',
          `You are already linked to **${existingUser.summonerName}**.
Use \`/unlink\` first to link a different account.`
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Get account from Riot API
      const account = await riotApi.getAccountByRiotId(gameName, tagLine);
      if (!account) {
        const embed = createErrorEmbed(
          'Account Not Found',
          `Could not find Riot account: **${riotId}**
Please check the spelling and try again.`
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Check if this Riot account is already linked to another Discord user
      const existingRiotLink = await db.models.User.findOne({ riotPuuid: account.puuid });
      if (existingRiotLink) {
        const embed = createErrorEmbed(
          'Account Already Linked',
          `This Riot account is already linked to another Discord user.`
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Get summoner data for rank info (optional - don't fail if this doesn't work)
      let currentRank = null;
      
      try {
        // Use getRankedStatsByPuuid which handles summoner lookup internally
        const rankedStats = await riotApi.getRankedStatsByPuuid(account.puuid, config.riot.region);
        
        log.debug('Ranked stats received', { rankedStats });
        
        if (rankedStats && rankedStats.length > 0) {
          const soloQueue = rankedStats.find(r => r.queueType === 'RANKED_SOLO_5x5');
          const flexQueue = rankedStats.find(r => r.queueType === 'RANKED_FLEX_SR');
          const rankData = soloQueue || flexQueue || rankedStats[0];
          
          currentRank = {
            tier: rankData.tier,
            division: rankData.rank,
            lp: rankData.leaguePoints,
            queueType: rankData.queueType,
          };
          
          log.info('Rank data found', { currentRank });
        } else {
          log.info('No ranked data found - user is unranked');
        }
      } catch (rankError) {
        // Log but don't fail - rank is optional
        log.warn('Could not fetch rank data, continuing without it', { 
          error: rankError.message 
        });
      }

      // Create new user
      const newUser = new db.models.User({
        discordId: userId,
        riotPuuid: account.puuid,
        summonerName: `${account.gameName}#${account.tagLine}`,
        gameName: account.gameName,
        tagLine: account.tagLine,
        region: config.riot.region,
        currency: config.features.betting.initialCoins,
        currentRank,
      });

      await newUser.save();
      log.db('insert', 'User', true);

      // Send success message
      const embed = createAccountLinkedEmbed({
        discordId: userId,
        summonerName: `${account.gameName}#${account.tagLine}`,
        rank: currentRank ? `${currentRank.tier} ${currentRank.division}` : 'Unranked',
        currency: config.features.betting.initialCoins,
      });

      log.info('User linked account', {
        userId,
        riotPuuid: account.puuid,
        summonerName: `${account.gameName}#${account.tagLine}`,
        rank: currentRank ? `${currentRank.tier} ${currentRank.division}` : 'Unranked',
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error('Error in link command', error);

      const embed = createErrorEmbed(
        'Error',
        'An error occurred while linking your account. Please try again later.'
      );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
