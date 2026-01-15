# Discord LOL Bot 🎮

A feature-rich Discord bot for internal League of Legends servers with Vietnamese-speaking users. Provides post-game analysis with AI-generated trash talk, betting system, leaderboards, and rank synchronization.

## ✨ Features

- **🏆 Post-Game Analysis**: Automatic match detection with AI-generated Vietnamese trash talk
- **💰 Betting System**: Virtual currency betting on match outcomes with dynamic odds
- **📊 Leaderboards**: Weekly rankings across multiple categories (kills, deaths, games played, rank)
- **🎭 Role Management**: Automatic Discord role updates based on League rank, MVP/Feeder awards
- **🤖 AI Integration**: OpenAI or Google Gemini for personalized roasting

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Riot Games API Key ([Riot Developer Portal](https://developer.riotgames.com/))
- OpenAI API Key ([OpenAI Platform](https://platform.openai.com/)) or Gemini API Key
- MongoDB instance (local or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd discord_bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

4. **Deploy slash commands**
   ```bash
   npm run deploy-commands
   ```

5. **Start the bot**
   ```bash
   # Development mode (with auto-reload)
   npm run dev

   # Production mode
   npm start
   ```

## 🔧 Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
GUILD_ID=your_server_id
TRACKED_CHANNEL_ID=your_channel_id

# Riot API
RIOT_API_KEY=your_riot_key

# AI (choose one)
OPENAI_API_KEY=your_openai_key
# GEMINI_API_KEY=your_gemini_key

# Database
MONGODB_URI=mongodb://localhost:27017/discord_lol_bot

# Environment
NODE_ENV=development
```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" tab and create a bot
4. Enable these Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent
5. Go to "OAuth2" → "URL Generator"
6. Select scopes: `bot`, `applications.commands`
7. Select permissions: `Manage Roles`, `Send Messages`, `Embed Links`, `Read Message History`
8. Use generated URL to invite bot to your server

## 📖 Usage

### User Commands

| Command | Description |
|---------|-------------|
| `/link [GameName#Tag]` | Link your Riot account |
| `/unlink` | Unlink your Riot account |
| `/refresh` | Check for new completed matches |
| `/openbet` | Open betting window before your game |
| `/bet [option] [amount]` | Place a bet on ongoing match |
| `/balance` | Check your coin balance |
| `/leaderboard` | View weekly rankings |
| `/stats [@user]` | View personal statistics |
| `/random` | Randomly assign roles for 5v5 custom |
| `/help` | Show all available commands |

### Typical Workflow

1. **Link Account**: `/link YourName#VN2`
2. **Before Game**: `/openbet` (opens 5-minute betting window)
3. **Others Bet**: `/bet win 100` or `/bet loss 50`
4. **Play Game**: Play League of Legends normally
5. **After Game**: `/refresh` (bot analyzes match and settles bets)
6. **View Stats**: `/leaderboard` to see weekly rankings

## 🏗️ Project Structure

```
discord_bot/
├── src/
│   ├── commands/          # Slash command handlers
│   ├── features/          # Core bot features
│   ├── services/          # External API integrations
│   ├── utils/             # Utility functions
│   ├── config/            # Configuration
│   └── index.js           # Entry point
├── .env                   # Environment variables
├── package.json           # Dependencies
└── README.md             # This file
```

## 🚢 Deployment

### Deploy to Railway

1. **Create Railway account** at [railway.app](https://railway.app)

2. **Connect GitHub repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

3. **Deploy on Railway**
   - Connect GitHub repository in Railway dashboard
   - Add MongoDB plugin or use MongoDB Atlas
   - Configure environment variables in Railway dashboard
   - Deploy automatically on push

4. **Set environment variables** in Railway dashboard

See `CLAUDE.md` for detailed deployment instructions.

## 🛠️ Development

### Run in Development Mode

```bash
npm run dev
```

Uses nodemon for auto-reload on file changes.

### Deploy Slash Commands

After modifying commands:

```bash
npm run deploy-commands
```

### Database Schema

- **Users**: Discord ID, Riot PUUID, summoner name, currency, linked date
- **Matches**: Match ID, participants, MVP, feeder, stats, timestamp
- **Bets**: User ID, match ID, bet type, amount, odds, result
- **Leaderboard**: User ID, week, kills, deaths, games, rank

## 📊 API Rate Limits

### Riot API (Development Key)
- 20 requests/second
- 100 requests/2 minutes
- **Note**: Development keys expire every 24 hours

### Estimated Usage
- ~10 users × 3 games/day = 30 API calls/day
- Well within free tier limits

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This bot is not endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

## 🆘 Support

For detailed documentation, see `CLAUDE.md`.

For issues or questions, please open an issue on GitHub.

## 🎯 Roadmap

- [ ] Implement post-game analysis
- [ ] Add betting system
- [ ] Create leaderboard feature
- [ ] Add rank-role sync
- [ ] Implement AI trash talk
- [ ] Add shop system (nickname colors, mute privileges)
- [ ] Support multiple languages
- [ ] Add match history visualization
- [ ] Implement tournament mode

---

Made with ❤️ for the League of Legends community
