/**
 * Random Command
 * Randomly assign roles to players in a voice channel
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createErrorEmbed, COLORS } = require('../utils/embedBuilder');
const log = require('../utils/logger');

// League of Legends roles
const LOL_ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('random')
    .setDescription('Randomly assign LoL roles to players in your voice channel'),

  async execute(interaction) {
    const userId = interaction.user.id;

    log.command('random', userId, interaction.guildId);

    try {
      // Get user's voice channel
      const member = await interaction.guild.members.fetch(userId);
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        const embed = createErrorEmbed(
          'Not in Voice Channel',
          'You need to be in a voice channel to use this command!\nJoin a voice channel with your team first.'
        );
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // Get members in voice channel (excluding bots)
      const membersInChannel = voiceChannel.members.filter(m => !m.user.bot);
      const memberCount = membersInChannel.size;

      if (memberCount === 0) {
        const embed = createErrorEmbed(
          'No Players',
          'There are no players in your voice channel!'
        );
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (memberCount > 5) {
        const embed = createErrorEmbed(
          'Too Many Players',
          `There are ${memberCount} players in your voice channel!\nMaximum is 5 players for role assignment.`
        );
        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      // Shuffle roles and assign
      const shuffledRoles = shuffleArray(LOL_ROLES);
      const memberArray = Array.from(membersInChannel.values());
      const shuffledMembers = shuffleArray(memberArray);

      // Create role assignments
      const assignments = shuffledMembers.map((member, index) => ({
        member,
        role: shuffledRoles[index],
      }));

      // Get role emojis
      const roleEmojis = {
        'Top': '🔝',
        'Jungle': '🌲',
        'Mid': '⚔️',
        'ADC': '🏹',
        'Support': '🛡️',
      };

      // Build response
      let assignmentText = '';
      assignments.forEach(({ member, role }) => {
        const emoji = roleEmojis[role] || '🎮';
        assignmentText += `${emoji} **${role}**: <@${member.id}>\n`;
      });

      // Add remaining roles if less than 5 players
      if (memberCount < 5) {
        const usedRoles = assignments.map(a => a.role);
        const remainingRoles = LOL_ROLES.filter(r => !usedRoles.includes(r));

        if (remainingRoles.length > 0) {
          assignmentText += '\n**Unassigned roles:**\n';
          remainingRoles.forEach(role => {
            const emoji = roleEmojis[role] || '🎮';
            assignmentText += `${emoji} ${role}\n`;
          });
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('Random Role Assignment')
        .setColor(COLORS.SUCCESS)
        .setDescription(assignmentText)
        .setFooter({ text: `Voice Channel: ${voiceChannel.name}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      log.info('Random roles assigned', {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        playerCount: memberCount,
      });
    } catch (error) {
      log.error('Error in random command', error);

      const embed = createErrorEmbed(
        'Error',
        'An error occurred while assigning roles.'
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
