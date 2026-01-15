/**
 * Discord LOL Bot - Main Entry Point
 * A Discord bot for League of Legends server with post-game analysis, betting, and leaderboards
 */

const { Client, Collection, GatewayIntentBits, Events, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load configuration first (validates env vars)
const { config } = require('./config/config');
const log = require('./utils/logger');
const db = require('./services/database');
const scheduler = require('./utils/scheduler');

/**
 * Initialize Discord client with required intents
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// Collection to store commands
client.commands = new Collection();

/**
 * Load all commands from the commands directory
 */
function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      log.info(`Loaded command: /${command.data.name}`);
    } else {
      log.warn(`Command at ${filePath} is missing required "data" or "execute" property.`);
    }
  }

  log.info(`Loaded ${client.commands.size} commands`);
}

/**
 * Handle interaction events (slash commands and buttons)
 */
client.on(Events.InteractionCreate, async interaction => {
  // Handle button interactions
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  // Only handle slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    log.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    log.error(`Error executing command /${interaction.commandName}`, error);

    const errorMessage = 'There was an error executing this command!';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

/**
 * Handle button interactions for schedules
 */
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  
  // Only handle schedule buttons
  if (!customId.startsWith('schedule_')) return;

  const [, action, scheduleId] = customId.split('_');
  const userId = interaction.user.id;

  log.info('Button interaction', { action, scheduleId, userId });

  try {
    const schedule = await db.models.Schedule.findOne({ odId: scheduleId });

    if (!schedule) {
      return await interaction.reply({ 
        content: '❌ Lịch này không tồn tại hoặc đã hết hạn.', 
        ephemeral: true 
      });
    }

    const scheduleCommand = require('./commands/schedule');
    let updated = false;
    let replyMessage = '';

    switch (action) {
      case 'join':
        // Check if already joined
        if (schedule.participants.some(p => p.odId === userId)) {
          return await interaction.reply({ 
            content: '⚠️ Bạn đã tham gia lịch này rồi!', 
            ephemeral: true 
          });
        }

        // Check if full
        if (schedule.participants.length >= schedule.maxPlayers) {
          return await interaction.reply({ 
            content: '❌ Lịch đã đầy!', 
            ephemeral: true 
          });
        }

        // Add participant
        schedule.participants.push({ odId: userId });
        if (schedule.participants.length >= schedule.maxPlayers) {
          schedule.status = 'full';
        }
        updated = true;
        replyMessage = '✅ Bạn đã tham gia lịch!';
        break;

      case 'leave':
        // Check if creator trying to leave
        if (schedule.creatorId === userId) {
          return await interaction.reply({ 
            content: '⚠️ Bạn là người tạo lịch. Dùng nút "Hủy" để hủy lịch.', 
            ephemeral: true 
          });
        }

        // Check if in the schedule
        const participantIndex = schedule.participants.findIndex(p => p.odId === userId);
        if (participantIndex === -1) {
          return await interaction.reply({ 
            content: '⚠️ Bạn chưa tham gia lịch này!', 
            ephemeral: true 
          });
        }

        // Remove participant
        schedule.participants.splice(participantIndex, 1);
        schedule.status = 'open';
        updated = true;
        replyMessage = '🚪 Bạn đã rời khỏi lịch.';
        break;

      case 'start':
        // Only creator can start
        if (schedule.creatorId !== userId) {
          return await interaction.reply({ 
            content: '❌ Chỉ người tạo lịch mới có thể bắt đầu!', 
            ephemeral: true 
          });
        }

        schedule.status = 'started';
        updated = true;
        
        // Mention all participants
        const mentions = schedule.participants.map(p => `<@${p.odId}>`).join(' ');
        replyMessage = `🚀 **LET'S GO!** ${mentions}\n\nLịch đã bắt đầu! Chúc các bạn có trận đấu vui vẻ!`;
        break;

      case 'cancel':
        // Only creator can cancel
        if (schedule.creatorId !== userId) {
          return await interaction.reply({ 
            content: '❌ Chỉ người tạo lịch mới có thể hủy!', 
            ephemeral: true 
          });
        }

        schedule.status = 'cancelled';
        updated = true;
        replyMessage = '❌ Lịch đã bị hủy.';
        break;
    }

    if (updated) {
      await schedule.save();

      // Update the embed
      const embed = scheduleCommand.createScheduleEmbed(schedule);
      const isFull = schedule.participants.length >= schedule.maxPlayers;
      const isEnded = ['started', 'cancelled'].includes(schedule.status);

      if (isEnded) {
        // Remove buttons when schedule ends
        await interaction.update({ embeds: [embed], components: [] });
      } else {
        const buttons = scheduleCommand.createScheduleButtons(scheduleId, isFull);
        await interaction.update({ embeds: [embed], components: [buttons] });
      }

      // Send reply if not just updating
      if (replyMessage && action !== 'join' && action !== 'leave') {
        await interaction.followUp({ content: replyMessage });
      } else if (replyMessage) {
        await interaction.followUp({ content: replyMessage, ephemeral: true });
      }
    }

  } catch (error) {
    log.error('Error handling button interaction', error);
    await interaction.reply({ 
      content: '❌ Có lỗi xảy ra. Vui lòng thử lại.', 
      ephemeral: true 
    }).catch(() => {});
  }
}

/**
 * Handle client ready event
 */
client.once(Events.ClientReady, async readyClient => {
  log.info(`Bot is ready! Logged in as ${readyClient.user.tag}`);
  log.info(`Serving ${readyClient.guilds.cache.size} guild(s)`);

  // Start scheduled tasks
  scheduler.startAllJobs(client);
  log.info('Scheduled tasks started');

  // Log startup info
  log.info('Discord LOL Bot initialized', {
    environment: config.app.environment,
    guildId: config.discord.guildId,
    trackedChannelId: config.discord.trackedChannelId,
  });
});

/**
 * Handle errors
 */
client.on(Events.Error, error => {
  log.error('Discord client error', error);
});

client.on(Events.Warn, warning => {
  log.warn('Discord client warning', { warning });
});

/**
 * Handle process signals for graceful shutdown
 */
async function gracefulShutdown(signal) {
  log.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    // Stop scheduled tasks
    scheduler.stopAllJobs();
    log.info('Scheduled tasks stopped');

    // Disconnect from Discord
    client.destroy();
    log.info('Discord client disconnected');

    // Disconnect from database
    await db.disconnect();
    log.info('Database disconnected');

    process.exit(0);
  } catch (error) {
    log.error('Error during graceful shutdown', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Handle unhandled rejections
 */
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', error => {
  log.error('Uncaught Exception', error);
  process.exit(1);
});

/**
 * Main startup function
 */
async function main() {
  try {
    log.info('Starting Discord LOL Bot...');

    // Connect to database
    await db.connect();

    // Load commands
    loadCommands();

    // Login to Discord
    await client.login(config.discord.token);
  } catch (error) {
    log.error('Failed to start bot', error);
    process.exit(1);
  }
}

// Start the bot
main();
