# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Discord bot for an internal League of Legends server with Vietnamese-speaking users. The bot provides:
- **Post-game analysis** with AI-generated trash talk, automatic MVP/Feeder awards and role assignments
- **Server leaderboards** tracking multiple performance metrics weekly
- **Betting system** with virtual currency (manual trigger)
- **Rank-role synchronization** auto-updating Discord roles based on League rank

Target audience: Internal friend group, humorous and casual tone.

**Note**: Live game tracking is NOT implemented due to Riot API limitations (Spectator-v5 being deactivated for privacy reasons).

## Tech Stack

- **Runtime**: Node.js 18+
- **Discord**: discord.js v14+
- **Riot API**: axios for HTTP requests (Match-v5, Summoner-v4, League-v4)
  - **Note**: Spectator-v4/v5 NOT used (deprecated/deactivated by Riot for privacy)
- **AI**: Cerebras API for Vietnamese text generation
- **Database**: MongoDB (storing user links, match history, betting data, virtual currency)
- **Hosting**: Railway (recommended), Render, or VPS

## Setup Commands

```bash
# Install dependencies
npm install

# Development mode (with auto-reload)
npm run dev

# Production mode
npm start

# Run tests (if implemented)
npm test
```

## Environment Variables

Required in `.env` file:
- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Discord application ID
- `RIOT_API_KEY` - Riot Games API key
- `OPENAI_API_KEY` or `GEMINI_API_KEY` - LLM API key
- `MONGODB_URI` - MongoDB connection string
- `TRACKED_CHANNEL_ID` - Discord channel ID for notifications
- `GUILD_ID` - Discord server ID

See `.env.example` for template.

## Project Structure

```
discord_bot/
├── src/
│   ├── commands/           # Discord slash commands
│   │   ├── bet.js         # /bet command for wagering
│   │   ├── openbet.js     # /openbet to manually open betting
│   │   ├── random.js      # /random for role assignment
│   │   ├── link.js        # /link to connect Riot account
│   │   ├── unlink.js      # /unlink to disconnect account
│   │   ├── refresh.js     # /refresh to check for new matches
│   │   ├── leaderboard.js # /leaderboard to view rankings
│   │   ├── stats.js       # /stats to view personal stats
│   │   ├── balance.js     # /balance to check coins
│   │   └── help.js        # /help command
│   ├── features/          # Core bot features
│   │   ├── postGameAnalysis.js # "Tòa Án Tối Cao" - Match analysis
│   │   ├── leaderboard.js      # Weekly ranking calculations
│   │   ├── betting.js          # Betting logic and payouts
│   │   └── rankSync.js         # Auto role updates
│   ├── services/          # External service integrations
│   │   ├── riotApi.js     # Riot API wrapper with rate limiting
│   │   ├── aiService.js   # OpenAI/Gemini integration
│   │   └── database.js    # MongoDB operations
│   ├── utils/
│   │   ├── embedBuilder.js # Discord embed templates
│   │   ├── calculator.js   # KDA, MVP score calculations
│   │   ├── logger.js       # Winston logger
│   │   └── scheduler.js    # Cron jobs for periodic tasks
│   ├── config/
│   │   └── config.js      # Load environment variables
│   └── index.js           # Main entry point
├── .env                   # Environment variables (not committed)
├── .env.example          # Template for environment variables
├── .gitignore            # Git ignore rules
├── package.json          # Node.js dependencies
├── package-lock.json     # Locked dependency versions
├── README.md             # Project documentation
├── CLAUDE.md             # This file
└── railway.json          # Railway deployment config (optional)
```

## Architecture

### Riot API Limitations & Why No Live Tracking

**IMPORTANT**: This bot does NOT implement live game tracking due to Riot API changes:
- **Spectator-v4** was deprecated in April 2024
- **Spectator-v5** is being deactivated for player privacy/anonymity
- **Live Client Data API** only works locally, not for remote tracking

**Workaround**: Users manually trigger match refresh using `/refresh` command after completing games.

### 1. Post-Game Analysis ("Tòa Án Tối Cao")

**File**: `src/features/postGameAnalysis.js`

**Flow**:
1. **Trigger**: User runs `/refresh` or automatic cron job (every 5-10 minutes) checks for new matches
2. For each linked user, query Match-v5 API for recent matches (last 5 games)
3. Check if match already processed (compare matchId with database)
4. If new match found with 2+ Discord members:
   - Fetch full match data including all participant stats
   - Calculate MVP: Highest score using formula `(Kills + Assists) / Deaths * (DMG% + TankDMG%)`
   - Identify "Tạ Tấn": Lowest KDA or 10+ deaths
   - **Generate AI trash talk** for each Discord member's performance
   - Create match summary embed with awards
   - Assign "Cục Tạ Vàng" role to feeder
   - Schedule role removal after 24 hours
5. Save match data to database to avoid reprocessing

**AI Trash Talk Integration**:
- After match completes, generate personalized roasts for each player
- Prompt includes: Champion, KDA, Win/Loss, Damage dealt, Damage taken
- Example: "Yasuo 2/10/3 thua trận! {name} nghĩ mình là Faker nhưng thực tế là Feeder! 🤡"

**Role Assignment**:
- Uses Discord's Role API to add/remove roles
- Store scheduled role removals in database with timestamp
- Cron job checks every hour for expired role assignments

### 2. Leaderboard System

**Files**: `src/features/leaderboard.js`, `src/commands/leaderboard.js`

**Categories**:
- **Top "Thần Đồng"**: Highest ranked player (by tier/division)
- **Top "Máy Đếm Số"**: Most deaths in a week
- **Top "Sát Thủ"**: Most kills in a week
- **Top "Cày Cuốc"**: Most games played in a week

**Implementation**:
- Weekly cron job (Sunday midnight) aggregates stats from matches collection
- Stores results in `leaderboard` collection with week identifier
- `/leaderboard` command displays current week's standings
- Historical data retained for trend analysis

### 3. Betting System

**Files**: `src/features/betting.js`, `src/commands/bet.js`, `src/commands/openbet.js`

**Flow (Player Self-Announce)**:

1. **Before game**: Player runs `/openbet` (no champion parameter needed)
   - Bot creates betting window with 5-minute countdown
   - Displays player's recent stats (overall, not champion-specific)
   - Shows betting options with dynamic odds

2. **Betting window (5 minutes)**:
   - Other users place bets using `/bet [option] [amount]`
   - Options: "win", "loss", "kda>3", "deaths>7", "time>30"
   - Bets are locked once placed (no cancel)

3. **Window closes**: After 5 minutes, no more bets accepted

4. **Player enters game**: Plays League of Legends normally (any champion, any queue)

5. **After game**:
   - Player or cron job triggers `/refresh`
   - Bot searches for new matches within 40 minutes of bet opening
   - Verifies match belongs to betting player

6. **Payout**:
   - Calculate results based on actual performance
   - Distribute winnings, deduct losses
   - Post results to channel

**Edge Cases Handling**:
- **No game within 10 minutes**: Cancel bets, refund all coins, penalize opener 50 coins
- **Remake/dodge (< 5 min game)**: Cancel bets, refund all coins, no penalty
- **Multiple bets open**: Users specify target with `/bet @user [option] [amount]`
- **Opener in multi-member match**: Only count opener's performance for bet results

**Currency System**:
- Each user starts with 1000 coins
- Coins can be spent on:
  - Bets (main usage)
  - Temporary nickname color changes (future feature)
  - 5-minute mute privileges (future feature)
- Stored in `users.currency` field

**Odds Calculation**:
- Dynamic odds based on player's last 20 games performance
- Example calculation:
  - 45% win rate → Win: x2.2, Loss: x1.6
  - Average 3.5 KDA → KDA>3.0: x1.8
  - Average 6 deaths → Deaths>7: x2.0
- House edge: 5% on all bets to prevent inflation

### 4. Rank-Role Sync

**File**: `src/features/rankSync.js`

**Flow**:
1. Cron job runs every 6 hours
2. For each linked user, query League-v4 API for current rank
3. Map rank to Discord role:
   - Challenger/Grandmaster/Master → Đỏ (Red)
   - Diamond → Xanh Ngọc (Turquoise)
   - Platinum → Xanh Lam (Blue)
   - Gold → Vàng (Gold)
   - Silver → Bạc (Silver)
   - Bronze → Đồng (Bronze)
   - Iron → Xám (Gray)
4. Update user's role if changed

## Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  discordId: String,        // Discord user ID
  riotPuuid: String,        // Riot account PUUID
  summonerName: String,     // Display name
  region: String,           // "VN2", "NA1", etc.
  currency: Number,         // Virtual coins (default: 1000)
  linkedAt: Date,
  lastRankSync: Date
}
```

### Matches Collection
```javascript
{
  _id: ObjectId,
  matchId: String,          // Riot match ID
  participants: [{
    discordId: String,
    championName: String,
    kills: Number,
    deaths: Number,
    assists: Number,
    totalDamageDealt: Number,
    totalDamageTaken: Number,
    win: Boolean
  }],
  mvp: String,              // Discord ID of MVP
  feeder: String,           // Discord ID of feeder
  gameDuration: Number,     // Seconds
  timestamp: Date
}
```

### Bets Collection
```javascript
{
  _id: ObjectId,
  userId: String,           // Discord ID
  matchId: String,
  betType: String,          // "win", "mvp_kda", "duration"
  betOption: String,        // "yes", "no", ">3.0", etc.
  amount: Number,
  odds: Number,
  result: String,           // "pending", "won", "lost"
  payout: Number,
  createdAt: Date
}
```

### Leaderboard Collection
```javascript
{
  _id: ObjectId,
  userId: String,
  week: String,             // ISO week "2024-W52"
  totalKills: Number,
  totalDeaths: Number,
  totalAssists: Number,
  gamesPlayed: Number,
  highestRank: String,      // "DIAMOND_II"
  updatedAt: Date
}
```

## Riot API Integration

### Rate Limiting

**Development Key (Free)**:
- **20 requests/second**
- **100 requests/2 minutes**
- Automatically resets every 24 hours (manual refresh required)
- Rate limits enforced per region (VN2, NA1, EUW, etc.)

**Production Key (Free but requires application)**:
- Higher rate limits (varies by project)
- No 24-hour expiration
- Requires: Working demo, website, Terms of Service, Privacy Policy
- Application review time: 1-3 weeks

**Rate Limit Strategy for This Bot**:
- Estimated usage: ~10 users × 3 games/day = 30 Match API calls/day
- Development key provides 72,000 calls/day → More than sufficient
- Use request queue with exponential backoff for 429 errors

### Key Endpoints

**Summoner-v4** (`/lol/summoner/v4/summoners/by-puuid/{puuid}`):
- Get summoner details by PUUID
- Used after account linking via `/link` command

**Match-v5** (`/lol/match/v5/matches/{matchId}`):
- Get detailed match data after game completes
- Includes all participant stats (KDA, damage, gold, CS, vision score, etc.)
- Use `match-v5/matches/by-puuid/{puuid}/ids?start=0&count=20` to get recent match IDs

**League-v4** (`/lol/league/v4/entries/by-summoner/{summonerId}`):
- Get current ranked status (tier, division, LP)
- Returns array with solo/duo and flex queue ranks
- Used for rank-role sync every 6 hours

**Account-v1** (`/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`):
- Get account PUUID by Riot ID (GameName#TagLine)
- Used for initial account linking

### Error Handling
- **401**: Invalid API key → Log error, alert admin, halt bot
- **403**: Forbidden (expired key) → Alert admin to refresh key
- **404**: Resource not found → Skip and continue (normal for missing data)
- **429**: Rate limit exceeded → Queue request, retry with exponential backoff (2s, 4s, 8s, 16s)
- **500/503**: Riot server issues → Retry up to 3 times, then skip and log error

## AI Integration

### Provider: OpenAI or Gemini

**OpenAI Setup**:
```javascript
const response = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [
    { role: "system", content: "You are a toxic Vietnamese LoL commentator..." },
    { role: "user", content: `Player ${name} picked ${champ}. Win rate: ${wr}%. Recent: ${record}.` }
  ],
  max_tokens: 100,
  temperature: 0.9
});
```

**Gemini Setup**:
```javascript
const result = await model.generateContent([
  "You are a toxic Vietnamese LoL commentator...",
  `Player ${name} picked ${champ}. Win rate: ${wr}%. Recent: ${record}.`
]);
```

### Prompt Engineering

**System Prompt (Post-Game Roasting)**:
> "You are a humorous Vietnamese League of Legends commentator with a toxic but playful style. Generate ONE short sentence (max 30 words) in Vietnamese that roasts the player based on their match performance. Be creative and funny, not genuinely mean. Use Vietnamese slang and emojis."

**Input Template for Winners**:
> "Player '{summonerName}' played {championName} and WON. KDA: {kills}/{deaths}/{assists}. Damage dealt: {damage}. Rank: {rank}."

**Input Template for Losers**:
> "Player '{summonerName}' played {championName} and LOST. KDA: {kills}/{deaths}/{assists}. Damage dealt: {damage}. Rank: {rank}."

**Output Examples**:
- Win: "🎉 {name} {champion} {kda} thắng trận! Cuối cùng cũng carry được 1 ván, tưởng ghost vĩnh viễn rồi! 💪"
- Loss: "💀 {name} {champion} {kda} thua trận! {deaths} deaths nhưng vẫn blame team, classic! 🤡"
- Feeder: "🚨 {name} cho {champion} ăn buffet 10 mạng! Địch cảm ơn đã donate gold! 🎁"

### Fallback Templates
If AI API fails, use random template based on performance:
- Win: "{name} {champ} {kda} thắng trận! Lucky game! 🎉"
- Loss: "{name} {champ} {kda} thua rồi! Next game nhé! 😢"
- Feeder: "{name} {champ} feed {deaths} mạng! Reported! 🤡"

## Critical Files Reference

- **`src/index.js`**: Main entry point, registers slash commands, initializes event handlers, starts cron jobs
- **`src/features/postGameAnalysis.js`**: Match detection, post-game processing, MVP/feeder calculation, AI roasting, role assignment
- **`src/features/betting.js`**: Betting logic, odds calculation, payout distribution, bet window management
- **`src/features/leaderboard.js`**: Weekly stat aggregation, ranking calculations
- **`src/features/rankSync.js`**: Periodic rank checking, Discord role updates
- **`src/services/riotApi.js`**: All Riot API calls with rate limiting and error handling
- **`src/services/aiService.js`**: LLM integration for generating Vietnamese post-game trash talk
- **`src/services/database.js`**: MongoDB connection and common queries
- **`src/utils/calculator.js`**: Formulas for MVP score, KDA, performance metrics
- **`src/utils/logger.js`**: Winston logger for debugging and monitoring
- **`src/commands/refresh.js`**: Manual trigger to check for new completed matches
- **`src/commands/openbet.js`**: Manual trigger to open betting window before game (no champion param)

## Testing & Verification

### Manual Testing Flow
1. **Setup**: Link your Riot account with `/link [GameName#TagLine]`
2. **Play a Match**: Complete a League of Legends game (at least 2 Discord members in same match)
3. **Refresh**: Run `/refresh` to manually check for new completed matches
4. **Verify Post-Game Analysis**:
   - Check that match summary embed appears in channel
   - Verify AI-generated trash talk for each player
   - Confirm MVP and "Tạ Tấn" awards are correct
   - Check "Cục Tạ Vàng" role is assigned to feeder
5. **Betting Flow**:
   - Before next game, run `/openbet @player [champion]` to open betting
   - Other users place bets with `/bet win 100` or `/bet loss 50`
   - After game, verify payouts are calculated correctly
6. **Leaderboard**: Use `/leaderboard` to view current week's standings
7. **Rank Sync**: Wait for cron job (6 hours) or manually trigger, verify role color updates
8. **Role Removal**: Wait 24 hours, verify "Cục Tạ Vàng" role is auto-removed

### Database Verification
```javascript
// Check linked users
db.users.find({})

// Check recent matches
db.matches.find({}).sort({ timestamp: -1 }).limit(10)

// Check active bets
db.bets.find({ result: "pending" })

// Check leaderboard for current week
db.leaderboard.find({ week: "2024-W52" })
```

### Discord Role Verification
- Check "Cục Tạ Vàng" role is assigned to feeder
- Verify role is auto-removed after 24 hours
- Confirm rank-based color roles update correctly

## Deployment to Railway

### Prerequisites
1. Railway account (sign up at railway.app)
2. MongoDB Atlas account (free tier) or Railway MongoDB plugin
3. All API keys ready (Discord, Riot, OpenAI/Gemini)

### Step-by-Step Deployment

**1. Prepare MongoDB**
```bash
# Option A: MongoDB Atlas (Recommended)
# - Create free cluster at mongodb.com/cloud/atlas
# - Get connection string: mongodb+srv://<user>:<password>@cluster.mongodb.net/discord_lol_bot

# Option B: Railway MongoDB Plugin
# - Add MongoDB plugin in Railway dashboard
# - Copy MONGODB_URL from plugin
```

**2. Initialize Git Repository**
```bash
git init
git add .
git commit -m "Initial commit"
```

**3. Deploy to Railway**
```bash
# Option A: Railway CLI
npm install -g @railway/cli
railway login
railway init
railway up

# Option B: GitHub Integration
# - Push code to GitHub
# - Connect repository in Railway dashboard
# - Railway auto-deploys on push
```

**4. Configure Environment Variables in Railway Dashboard**

Go to your project → Variables tab and add:
```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_app_id
RIOT_API_KEY=your_riot_api_key
OPENAI_API_KEY=your_openai_key (or GEMINI_API_KEY)
MONGODB_URI=your_mongodb_connection_string
TRACKED_CHANNEL_ID=your_discord_channel_id
GUILD_ID=your_discord_server_id
NODE_ENV=production
```

**5. Verify Deployment**
- Check logs in Railway dashboard
- Look for "Bot is ready!" message
- Test `/help` command in Discord

### Railway Configuration

**railway.json** (optional, for custom settings):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node src/index.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Important Notes

**Free Tier Limits**:
- Railway free tier: $5 credit/month (~500 hours runtime)
- MongoDB Atlas free tier: 512MB storage (sufficient for 100+ users)
- Riot API dev key: Resets every 24 hours (set reminder to refresh)

**Monitoring**:
- Check Railway logs for errors
- Set up uptime monitoring (optional): UptimeRobot, BetterStack
- Monitor MongoDB storage usage

**Riot API Key Refresh**:
```bash
# Dev key expires every 24 hours
# Update via Railway dashboard Variables tab
# Or use Railway CLI:
railway variables --set RIOT_API_KEY=new_key_here
```

**Troubleshooting**:
- Bot not responding: Check Discord token validity
- API errors: Verify Riot API key not expired
- Database errors: Check MongoDB connection string
- Deployment fails: Check Railway logs for error details

### Cost Optimization

**To stay within Railway free tier**:
1. Use Railway's "sleep mode" during inactive hours (if available)
2. Optimize cron jobs (use 10-minute intervals instead of 5-minute)
3. Consider upgrading to hobby plan ($5/month) if needed

**Alternative Free Hosting** (if Railway credits run out):
- Render.com (free tier with 750 hours/month)
- Fly.io (free tier available)
- Self-hosted VPS (Oracle Cloud free tier)
