/**
 * Debug Command
 * Helps debug issues with match detection and user linking
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const riotApi = require('../services/riotApi');
const { createErrorEmbed, createInfoEmbed, COLORS } = require('../utils/embedBuilder');
const log = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Debug tool for troubleshooting')
    .addSubcommand(subcommand =>
      subcommand
        .setName('link')
        .setDescription('Check your account link status')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('matches')
        .setDescription('Check your recent matches and Discord members')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('users')
        .setDescription('List all linked users (admin)')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    log.command('debug', userId, interaction.guildId, { subcommand });

    await interaction.deferReply({ ephemeral: true });

    try {
      switch (subcommand) {
        case 'link':
          await debugLink(interaction, userId);
          break;
        case 'matches':
          await debugMatches(interaction, userId);
          break;
        case 'users':
          await debugUsers(interaction);
          break;
      }
    } catch (error) {
      log.error('Error in debug command', error);
      const embed = createErrorEmbed('Error', error.message);
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

async function debugLink(interaction, userId) {
  const user = await db.models.User.findOne({ discordId: userId });

  if (!user) {
    const embed = createErrorEmbed(
      'Not Linked',
      'Your Discord account is not linked to any Riot account.\nUse `/link GameName#Tag` to connect.'
    );
    return await interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('🔗 Account Link Status')
    .setColor(COLORS.SUCCESS)
    .addFields(
      { name: 'Discord ID', value: user.discordId, inline: true },
      { name: 'Summoner Name', value: user.summonerName || 'N/A', inline: true },
      { name: 'Region', value: user.region || 'N/A', inline: true },
      { name: 'PUUID', value: `\`${user.riotPuuid?.substring(0, 30)}...\``, inline: false },
      { name: 'Linked At', value: user.linkedAt?.toISOString() || 'N/A', inline: true },
      { name: 'Currency', value: `${user.currency || 0} coins`, inline: true },
    )
    .setTimestamp();

  // Try to verify PUUID with Riot API
  try {
    const matchIds = await riotApi.getMatchIdsByPuuid(user.riotPuuid, 1);
    if (matchIds && matchIds.length > 0) {
      embed.addFields({ name: '✅ Riot API Status', value: 'PUUID is valid and working', inline: false });
    } else {
      embed.addFields({ name: '⚠️ Riot API Status', value: 'No recent matches found (may be normal)', inline: false });
    }
  } catch (error) {
    embed.addFields({ name: '❌ Riot API Status', value: `Error: ${error.message}`, inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function debugMatches(interaction, userId) {
  const user = await db.models.User.findOne({ discordId: userId });

  if (!user) {
    const embed = createErrorEmbed('Not Linked', 'Use `/link` first.');
    return await interaction.editReply({ embeds: [embed] });
  }

  // Get recent match IDs
  const matchIds = await riotApi.getMatchIdsByPuuid(user.riotPuuid, 3);
  
  if (!matchIds || matchIds.length === 0) {
    const embed = createInfoEmbed('No Matches', 'No recent matches found from Riot API.');
    return await interaction.editReply({ embeds: [embed] });
  }

  let description = `Found **${matchIds.length}** recent matches:\n\n`;

  for (const matchId of matchIds) {
    description += `**Match:** \`${matchId}\`\n`;

    // Check if in DB
    const dbMatch = await db.models.Match.findOne({ matchId });
    if (dbMatch) {
      description += `  📁 DB Status: ${dbMatch.processing ? '⏳ Processing' : '✅ Processed'}\n`;
      if (dbMatch.participants) {
        description += `  👥 Participants: ${dbMatch.participants.length}\n`;
      }
    } else {
      description += `  📁 DB Status: Not in database\n`;
    }

    // Get full match data and check Discord members
    try {
      const matchData = await riotApi.getMatchById(matchId);
      if (matchData) {
        const participants = matchData.info.participants;
        const puuids = participants.map(p => p.puuid);
        
        // Find linked users
        const linkedUsers = await db.models.User.find({ riotPuuid: { $in: puuids } });
        
        description += `  🎮 Total players: ${participants.length}\n`;
        description += `  🔗 Discord members: **${linkedUsers.length}**\n`;
        
        if (linkedUsers.length > 0) {
          linkedUsers.forEach(u => {
            description += `     • ${u.summonerName} (<@${u.discordId}>)\n`;
          });
        }

        if (linkedUsers.length < 2) {
          description += `  ⚠️ Need 2+ Discord members to post!\n`;
        }
      }
    } catch (error) {
      description += `  ❌ Error fetching: ${error.message}\n`;
    }

    description += '\n';
  }

  const embed = new EmbedBuilder()
    .setTitle('🔍 Match Debug Info')
    .setColor(COLORS.INFO)
    .setDescription(description)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function debugUsers(interaction) {
  const users = await db.models.User.find({}).limit(20);

  if (users.length === 0) {
    const embed = createInfoEmbed('No Users', 'No linked users found.');
    return await interaction.editReply({ embeds: [embed] });
  }

  let description = `**${users.length}** linked users:\n\n`;

  users.forEach((user, index) => {
    description += `${index + 1}. <@${user.discordId}> - ${user.summonerName}\n`;
    description += `   PUUID: \`${user.riotPuuid?.substring(0, 20)}...\`\n`;
  });

  const embed = new EmbedBuilder()
    .setTitle('👥 Linked Users')
    .setColor(COLORS.INFO)
    .setDescription(description)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
