/**
 * AI Service
 * Integration with Cerebras AI for generating trash talk
 */

const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const { config } = require('../config/config');
const log = require('../utils/logger');

// Initialize Cerebras client
const client = new Cerebras({
  apiKey: config.ai.cerebras.apiKey,
});

/**
 * System prompt for post-game trash talk
 */
const SYSTEM_PROMPT = `You are a humorous Vietnamese League of Legends commentator with a toxic but playful style.
Generate ONE short sentence (max 30 words) in Vietnamese that roasts the player based on their match performance.
Be creative and funny, not genuinely mean. Use Vietnamese slang and emojis appropriately.`;

/**
 * Fallback templates if AI fails
 */
const FALLBACK_TEMPLATES = {
  win: [
    '{name} {champion} {kda} thắng trận! Cuối cùng cũng carry được 1 ván! 🎉',
    '{name} {champion} {kda} WIN! Lucky game, tiếp tục phát huy! 💪',
    'GG {name}! {champion} {kda} thắng rồi, team cảm ơn đã không ghost! 🙏',
  ],
  loss: [
    '{name} {champion} {kda} thua trận! Next game nhé bro! 😢',
    '{name} {champion} {kda} LOSE! Unlucky, blame team đi! 🤡',
    '{champion} {kda} thua rồi {name} ơi! Đừng buồn, còn nhiều game nữa mà! 💔',
  ],
  feeder: [
    '{name} cho {champion} ăn buffet {deaths} mạng! Địch cảm ơn! 🎁',
    '{name} {champion} feed {deaths} deaths! Reported! 🤡',
    '{champion} {kda}? {name} nghĩ mình đang chơi ARAM à? {deaths} mạng! 💀',
  ],
};

/**
 * Generate with Cerebras
 */
async function generateWithCerebras(userPrompt) {
  try {
    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model: config.ai.cerebras.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: config.ai.cerebras.maxTokens,
      temperature: config.ai.cerebras.temperature,
    });

    const duration = Date.now() - startTime;
    log.api('Cerebras', 'chat.completions', 200, duration);

    return response.choices[0].message.content;
  } catch (error) {
    log.error('Cerebras API error', error);
    throw error;
  }
}

/**
 * Generate trash talk using AI
 */
async function generateTrashTalk(playerData) {
  const { name, champion, kills, deaths, assists, win, damage, rank } = playerData;
  const kda = `${kills}/${deaths}/${assists}`;

  try {
    // Build user prompt
    const userPrompt = win
      ? `Player '${name}' played ${champion} and WON. KDA: ${kda}. Damage dealt: ${damage}. Rank: ${rank}.`
      : `Player '${name}' played ${champion} and LOST. KDA: ${kda}. Damage dealt: ${damage}. Rank: ${rank}.`;

    log.debug('Generating AI trash talk', { name, champion, kda, win });

    const result = await generateWithCerebras(userPrompt);

    if (result && result.trim().length > 0) {
      log.info('AI trash talk generated', { name, champion, provider: 'cerebras' });
      return result.trim();
    }

    throw new Error('Empty AI response');

  } catch (error) {
    log.error('AI generation failed, using fallback template', error);
    return getFallbackTemplate(playerData);
  }
}

/**
 * Get fallback template
 */
function getFallbackTemplate(playerData) {
  const { name, champion, kills, deaths, assists, win } = playerData;
  const kda = `${kills}/${deaths}/${assists}`;

  let category;
  if (deaths >= 10) {
    category = 'feeder';
  } else if (win) {
    category = 'win';
  } else {
    category = 'loss';
  }

  const templates = FALLBACK_TEMPLATES[category];
  const template = templates[Math.floor(Math.random() * templates.length)];

  return template
    .replace('{name}', name)
    .replace('{champion}', champion)
    .replace('{kda}', kda)
    .replace('{deaths}', deaths);
}

/**
 * Generate trash talk for multiple players
 */
async function generateMultipleTrashTalks(playersData) {
  const results = [];

  for (const playerData of playersData) {
    try {
      const trashTalk = await generateTrashTalk(playerData);
      results.push({
        discordId: playerData.discordId,
        name: playerData.name,
        trashTalk,
      });

      // Add small delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      log.error(`Failed to generate trash talk for ${playerData.name}`, error);
      results.push({
        discordId: playerData.discordId,
        name: playerData.name,
        trashTalk: getFallbackTemplate(playerData),
      });
    }
  }

  return results;
}

/**
 * Generate betting announcement text
 */
async function generateBettingAnnouncement(playerData) {
  const { name, rank, winRate, recentRecord, avgKDA } = playerData;

  try {
    const userPrompt = `Player '${name}' is about to start a game. Rank: ${rank}. Win rate: ${winRate}%. Recent record: ${recentRecord}. Average KDA: ${avgKDA}. Generate a short, funny Vietnamese announcement to encourage betting.`;

    log.debug('Generating betting announcement', { name, rank, winRate });

    const result = await generateWithCerebras(userPrompt);

    if (result && result.trim().length > 0) {
      return result.trim();
    }

    throw new Error('Empty AI response');

  } catch (error) {
    log.error('Failed to generate betting announcement', error);
    // Fallback
    return `🎲 ${name} vừa mở cược! Win rate ${winRate}%, ae vào đặt cược đi! 💰`;
  }
}

/**
 * Test AI connection
 */
async function testConnection() {
  try {
    const testData = {
      name: 'TestPlayer',
      champion: 'Yasuo',
      kills: 5,
      deaths: 7,
      assists: 3,
      win: false,
      damage: 15000,
      rank: 'Gold III',
    };

    const result = await generateTrashTalk(testData);
    log.info('AI service test successful', { provider: 'cerebras', result });
    return true;
  } catch (error) {
    log.error('AI service test failed', error);
    return false;
  }
}

module.exports = {
  generateTrashTalk,
  generateMultipleTrashTalks,
  generateBettingAnnouncement,
  testConnection,
};
