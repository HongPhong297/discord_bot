/**
 * Deploy Commands Script
 * Registers slash commands with Discord
 *
 * Usage: npm run deploy-commands
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const { config } = require('./config/config');

// Collect all commands
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('Loading commands...');

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON());
    console.log(`  - /${command.data.name}`);
  } else {
    console.warn(`  [WARNING] The command at ${file} is missing required properties.`);
  }
}

console.log(`\nTotal: ${commands.length} commands\n`);

// Create REST client
const rest = new REST({ version: '10' }).setToken(config.discord.token);

/**
 * Deploy commands to Discord
 */
async function deployCommands() {
  try {
    console.log('Started refreshing application (/) commands...');

    // Deploy to specific guild (faster, for development)
    if (config.discord.guildId) {
      console.log(`Deploying to guild: ${config.discord.guildId}`);

      const data = await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commands }
      );

      console.log(`Successfully reloaded ${data.length} guild commands.`);
    }

    // For global deployment (takes up to 1 hour to propagate)
    // Uncomment this block if you want to deploy globally
    /*
    console.log('Deploying global commands...');
    const globalData = await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commands }
    );
    console.log(`Successfully reloaded ${globalData.length} global commands.`);
    */

    console.log('\nDone! Commands are ready to use.');
    console.log('\nNote: Guild commands update instantly.');
    console.log('Global commands may take up to 1 hour to propagate.');
  } catch (error) {
    console.error('Error deploying commands:', error);
    process.exit(1);
  }
}

// Run deployment
deployCommands();
