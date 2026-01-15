/**
 * Schedule Command
 * Create and manage game schedules/lobbies
 */

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const { createErrorEmbed, createSuccessEmbed, COLORS } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Mode configurations
 */
const MODES = {
  duo: { name: 'Duo Queue', emoji: '👥', maxPlayers: 2 },
  flex3: { name: 'Flex 3', emoji: '👨‍👩‍👦', maxPlayers: 3 },
  flex5: { name: 'Flex 5', emoji: '👨‍👩‍👧‍👦', maxPlayers: 5 },
  aram: { name: 'ARAM', emoji: '🎲', maxPlayers: 5 },
  custom: { name: 'Custom', emoji: '🎮', maxPlayers: 5 },
};

/**
 * Create schedule embed
 */
function createScheduleEmbed(schedule, users = {}) {
  const mode = MODES[schedule.mode] || { name: schedule.mode, emoji: '🎮' };
  const participantCount = schedule.participants.length;
  const isFull = participantCount >= schedule.maxPlayers;

  // Build participants list
  let participantsText = '';
  if (schedule.participants.length === 0) {
    participantsText = '*Chưa có ai tham gia*';
  } else {
    participantsText = schedule.participants.map((p, i) => {
      const emoji = i === 0 ? '👑' : '✅';
      return `${emoji} <@${p.odId}>`;
    }).join('\n');
  }

  // Add empty slots
  const emptySlots = schedule.maxPlayers - participantCount;
  if (emptySlots > 0) {
    participantsText += '\n' + Array(emptySlots).fill('⬜ *Trống*').join('\n');
  }

  const statusEmoji = isFull ? '🔴' : '🟢';
  const statusText = isFull ? 'ĐẦY' : 'ĐANG MỞ';

  const embed = new EmbedBuilder()
    .setTitle(`${mode.emoji} ${mode.name} - ${schedule.scheduledTime}`)
    .setColor(isFull ? COLORS.ERROR : COLORS.SUCCESS)
    .setDescription(schedule.description || '*Không có mô tả*')
    .addFields(
      { 
        name: `👥 Người chơi (${participantCount}/${schedule.maxPlayers})`, 
        value: participantsText, 
        inline: false 
      },
      { 
        name: '📊 Trạng thái', 
        value: `${statusEmoji} ${statusText}`, 
        inline: true 
      },
      { 
        name: '👤 Người tạo', 
        value: `<@${schedule.creatorId}>`, 
        inline: true 
      }
    )
    .setFooter({ text: `ID: ${schedule.odId}` })
    .setTimestamp(schedule.createdAt);

  return embed;
}

/**
 * Create action buttons
 */
function createScheduleButtons(scheduleId, isFull = false, isCreator = false) {
  const row = new ActionRowBuilder();

  // Join button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_join_${scheduleId}`)
      .setLabel('Tham gia')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅')
      .setDisabled(isFull)
  );

  // Leave button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_leave_${scheduleId}`)
      .setLabel('Rời đi')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🚪')
  );

  // Start button (only for creator when full)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_start_${scheduleId}`)
      .setLabel('Bắt đầu')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🚀')
  );

  // Cancel button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_cancel_${scheduleId}`)
      .setLabel('Hủy')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );

  return row;
}

/**
 * Generate short unique ID
 */
function generateShortId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Tạo và quản lý lịch chơi game')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Tạo lịch chơi mới')
        .addStringOption(option =>
          option
            .setName('mode')
            .setDescription('Chế độ chơi')
            .setRequired(true)
            .addChoices(
              { name: '👥 Duo Queue (2 người)', value: 'duo' },
              { name: '👨‍👩‍👦 Flex 3 (3 người)', value: 'flex3' },
              { name: '👨‍👩‍👧‍👦 Flex 5 (5 người)', value: 'flex5' },
              { name: '🎲 ARAM (5 người)', value: 'aram' },
              { name: '🎮 Custom (5 người)', value: 'custom' }
            )
        )
        .addStringOption(option =>
          option
            .setName('time')
            .setDescription('Thời gian chơi (vd: "20:00", "tối nay", "now")')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('Mô tả thêm (không bắt buộc)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Xem danh sách lịch đang mở')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('my')
        .setDescription('Xem lịch bạn đã tạo hoặc tham gia')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    log.command('schedule', userId, interaction.guildId, { subcommand });

    try {
      switch (subcommand) {
        case 'create':
          await handleCreate(interaction, userId);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'my':
          await handleMy(interaction, userId);
          break;
      }
    } catch (error) {
      log.error('Error in schedule command', error);
      const embed = createErrorEmbed('Lỗi', 'Có lỗi xảy ra. Vui lòng thử lại sau.');
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  },

  // Export for button handler
  createScheduleEmbed,
  createScheduleButtons,
  MODES,
};

/**
 * Handle create subcommand
 */
async function handleCreate(interaction, userId) {
  const mode = interaction.options.getString('mode');
  const time = interaction.options.getString('time');
  const description = interaction.options.getString('description') || '';

  await interaction.deferReply();

  // Check if user already has an open schedule
  const existingSchedule = await db.models.Schedule.findOne({
    creatorId: userId,
    status: 'open',
  });

  if (existingSchedule) {
    const embed = createErrorEmbed(
      'Đã có lịch',
      'Bạn đã có một lịch đang mở. Hãy hủy hoặc đợi lịch cũ kết thúc trước.'
    );
    return await interaction.editReply({ embeds: [embed] });
  }

  const modeConfig = MODES[mode];
  const scheduleId = generateShortId();

  // Set expiry to 6 hours from now
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 6);

  // Create schedule
  const schedule = new db.models.Schedule({
    odId: scheduleId,
    creatorId: userId,
    mode,
    maxPlayers: modeConfig.maxPlayers,
    scheduledTime: time,
    description,
    participants: [{ odId: userId }], // Creator auto-joins
    status: 'open',
    channelId: interaction.channelId,
    expiresAt,
  });

  await schedule.save();
  log.db('insert', 'Schedule', true);

  // Create embed and buttons
  const embed = createScheduleEmbed(schedule);
  const buttons = createScheduleButtons(scheduleId, false, true);

  const message = await interaction.editReply({ 
    embeds: [embed], 
    components: [buttons] 
  });

  // Save message ID for later updates
  schedule.messageId = message.id;
  await schedule.save();

  log.info('Schedule created', { scheduleId, mode, time, creatorId: userId });
}

/**
 * Handle list subcommand
 */
async function handleList(interaction) {
  await interaction.deferReply();

  const schedules = await db.models.Schedule.find({
    status: 'open',
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 }).limit(10);

  if (schedules.length === 0) {
    const embed = createErrorEmbed(
      'Không có lịch',
      'Hiện không có lịch nào đang mở.\nDùng `/schedule create` để tạo lịch mới!'
    );
    return await interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📅 Danh sách lịch đang mở')
    .setColor(COLORS.INFO)
    .setTimestamp();

  for (const schedule of schedules) {
    const modeConfig = MODES[schedule.mode] || { emoji: '🎮', name: schedule.mode };
    const participantCount = schedule.participants.length;
    const statusEmoji = participantCount >= schedule.maxPlayers ? '🔴' : '🟢';

    embed.addFields({
      name: `${modeConfig.emoji} ${modeConfig.name} - ${schedule.scheduledTime}`,
      value: `${statusEmoji} ${participantCount}/${schedule.maxPlayers} người | Tạo bởi <@${schedule.creatorId}>\nID: \`${schedule.odId}\``,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle my subcommand
 */
async function handleMy(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

  const schedules = await db.models.Schedule.find({
    $or: [
      { creatorId: userId },
      { 'participants.odId': userId },
    ],
    status: { $in: ['open', 'full'] },
  }).sort({ createdAt: -1 }).limit(5);

  if (schedules.length === 0) {
    const embed = createErrorEmbed(
      'Không có lịch',
      'Bạn chưa tạo hoặc tham gia lịch nào.\nDùng `/schedule create` để tạo lịch mới!'
    );
    return await interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📅 Lịch của bạn')
    .setColor(COLORS.INFO)
    .setTimestamp();

  for (const schedule of schedules) {
    const modeConfig = MODES[schedule.mode] || { emoji: '🎮', name: schedule.mode };
    const participantCount = schedule.participants.length;
    const isCreator = schedule.creatorId === userId;
    const roleText = isCreator ? '(Người tạo)' : '(Tham gia)';

    embed.addFields({
      name: `${modeConfig.emoji} ${modeConfig.name} - ${schedule.scheduledTime} ${roleText}`,
      value: `${participantCount}/${schedule.maxPlayers} người\nID: \`${schedule.odId}\``,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
