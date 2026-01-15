/**
 * Embed Builder
 * Templates for Discord embeds
 */

const { EmbedBuilder } = require('discord.js');
const {
  formatKDA,
  formatKDARatio,
  formatGameDuration,
  formatNumber,
  calculatePercentage,
} = require('./calculator');

/**
 * Colors for different situations
 */
const COLORS = {
  SUCCESS: 0x00FF00, // Green
  ERROR: 0xFF0000,   // Red
  WARNING: 0xFFAA00, // Orange
  INFO: 0x0099FF,    // Blue
  MVP: 0xFFD700,     // Gold
  FEEDER: 0x808080,  // Gray
  WIN: 0x00AA00,     // Dark Green
  LOSS: 0xAA0000,    // Dark Red
};

/**
 * Create post-game analysis embed
 */
function createMatchAnalysisEmbed(matchData, trashTalks) {
  const { matchId, participants, mvpData, feederData, gameDuration, result, teams } = matchData;

  const embed = new EmbedBuilder()
    .setTitle('🏆 TÒA ÁN TỐI CAO - PHÂN TÍCH TRẬN ĐẤU')
    .setColor(result === 'win' ? COLORS.WIN : COLORS.LOSS)
    .setDescription(`**Match ID**: ${matchId}\n**Kết quả**: ${result === 'win' ? '✅ THẮNG' : '❌ THUA'}\n**Thời gian**: ${formatGameDuration(gameDuration)}`)
    .setTimestamp();

  // Add participants
  let participantsText = '';
  participants.forEach((p, index) => {
    const kda = formatKDA(p.kills, p.deaths, p.assists);
    const kdaRatio = formatKDARatio(p.kda);
    
    // Calculate damage % relative to the participant's own team
    // This correctly handles cross-team scenarios (e.g., 2 Discord members on opposing teams)
    const teamDamage = teams && teams[p.teamId] ? teams[p.teamId].totalDamage : 0;
    const dmgPercent = calculatePercentage(p.totalDamageDealtToChampions, teamDamage);

    participantsText += `\n**${index + 1}. <@${p.discordId}>** - ${p.championName}\n`;
    participantsText += `   KDA: ${kda} (${kdaRatio})\n`;
    participantsText += `   💥 Damage: ${formatNumber(p.totalDamageDealtToChampions)} (${dmgPercent}%)\n`;

    // Add trash talk
    const trashTalk = trashTalks.find(t => t.discordId === p.discordId);
    if (trashTalk) {
      participantsText += `   🤖 ${trashTalk.trashTalk}\n`;
    }
  });

  embed.addFields({ name: '👥 THÀNH VIÊN', value: participantsText || 'Không có dữ liệu' });

  // Add MVP
  if (mvpData) {
    const mvpText = `🎉 <@${mvpData.discordId}> (${mvpData.championName})\n` +
      `KDA: ${formatKDA(mvpData.kills, mvpData.deaths, mvpData.assists)}\n` +
      `MVP Score: ${mvpData.mvpScore}/100`;
    embed.addFields({ name: '👑 MVP', value: mvpText, inline: true });
  }

  // Add Feeder
  if (feederData) {
    const feederText = `💀 <@${feederData.discordId}> (${feederData.championName})\n` +
      `KDA: ${formatKDA(feederData.kills, feederData.deaths, feederData.assists)}\n` +
      `${feederData.deaths} deaths!`;
    embed.addFields({ name: '🤡 TẠ TẤN', value: feederText, inline: true });
  }

  return embed;
}

/**
 * Create betting window open embed
 */
function createBettingWindowEmbed(userData, odds, windowDuration = 5) {
  const { discordId, stats, announcement } = userData;

  const embed = new EmbedBuilder()
    .setTitle('🎲 CƯỢC MỞ RỒI! 🎲')
    .setColor(COLORS.WARNING)
    .setDescription(`<@${discordId}> vừa mở cửa sổ cược!\n⏰ Thời gian: **${windowDuration} phút**`)
    .setTimestamp();

  // Stats
  if (stats) {
    const statsText = `- Win rate: **${stats.winRate}%** (${stats.wins}W-${stats.losses}L)\n` +
      `- KDA trung bình: **${stats.avgKDA}**\n` +
      `- Rank: **${stats.rank || 'Unranked'}**`;
    embed.addFields({ name: '📊 Stats gần đây', value: statsText });
  }

  // Odds
  const oddsText = `🟢 **THẮNG**: x${odds.win}\n` +
    `🔴 **THUA**: x${odds.loss}\n` +
    `⚡ **KDA > 3.0**: x${odds['kda>3']}\n` +
    `💀 **Chết > 7 lần**: x${odds['deaths>7']}\n` +
    `⏱️ **Game > 30 phút**: x${odds['time>30']}`;
  embed.addFields({ name: '🎰 Tỷ lệ cược', value: oddsText });

  // AI announcement (if available)
  if (announcement) {
    embed.addFields({ name: '📢 Lời nhận xét', value: announcement });
  }

  // Instructions
  embed.addFields({
    name: '❓ Cách đặt cược',
    value: 'Dùng lệnh: `/bet [tùy chọn] [số tiền]`\nVí dụ: `/bet win 100`',
  });

  return embed;
}

/**
 * Create betting results embed
 */
function createBettingResultsEmbed(results) {
  const { matchId, totalBets, winners, losers } = results;

  const embed = new EmbedBuilder()
    .setTitle('💰 KẾT QUẢ CƯỢC')
    .setColor(COLORS.INFO)
    .setDescription(`**Match ID**: ${matchId}\n**Tổng số cược**: ${totalBets}`)
    .setTimestamp();

  // Winners
  if (winners && winners.length > 0) {
    const winnersText = winners.map(w =>
      `✅ <@${w.userId}> cược **${w.betType}** → +${w.payout} coins`
    ).join('\n');
    embed.addFields({ name: '🎉 Người thắng cược', value: winnersText });
  }

  // Losers
  if (losers && losers.length > 0) {
    const losersText = losers.map(l =>
      `❌ <@${l.userId}> cược **${l.betType}** → -${l.amount} coins`
    ).join('\n');
    embed.addFields({ name: '😢 Người thua cược', value: losersText });
  }

  return embed;
}

/**
 * Create leaderboard embed
 */
function createLeaderboardEmbed(week, categories) {
  const embed = new EmbedBuilder()
    .setTitle('📊 BẢNG XẾP HẠNG')
    .setColor(COLORS.INFO)
    .setDescription(`**Tuần**: ${week}`)
    .setTimestamp();

  // Add each category
  Object.entries(categories).forEach(([categoryName, players]) => {
    if (players && players.length > 0) {
      const text = players.slice(0, 5).map((p, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        return `${medal} <@${p.userId}> - ${p.value}`;
      }).join('\n');

      embed.addFields({ name: categoryName, value: text || 'Chưa có dữ liệu', inline: true });
    }
  });

  return embed;
}

/**
 * Create account linked embed
 */
function createAccountLinkedEmbed(userData) {
  const { discordId, summonerName, rank, currency } = userData;

  const embed = new EmbedBuilder()
    .setTitle('✅ Liên kết thành công!')
    .setColor(COLORS.SUCCESS)
    .setDescription(`<@${discordId}> đã liên kết tài khoản Riot!`)
    .addFields(
      { name: 'Summoner Name', value: summonerName, inline: true },
      { name: 'Rank', value: rank || 'Unranked', inline: true },
      { name: 'Coins', value: `${currency} 💰`, inline: true }
    )
    .setTimestamp();

  return embed;
}

/**
 * Create error embed
 */
function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setColor(COLORS.ERROR)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create success embed
 */
function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setColor(COLORS.SUCCESS)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create info embed
 */
function createInfoEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setColor(COLORS.INFO)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create stats embed
 */
function createStatsEmbed(userData, matchStats) {
  const { discordId, summonerName, rank, currency } = userData;
  const { totalGames, wins, losses, avgKDA, totalKills, totalDeaths, totalAssists } = matchStats;

  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle(`📊 Stats - ${summonerName}`)
    .setColor(COLORS.INFO)
    .setDescription(`<@${discordId}>`)
    .addFields(
      { name: 'Rank', value: rank || 'Unranked', inline: true },
      { name: 'Coins', value: `${currency} 💰`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: 'Games', value: `${totalGames} (${wins}W-${losses}L)`, inline: true },
      { name: 'Win Rate', value: `${winRate}%`, inline: true },
      { name: 'KDA', value: `${avgKDA}`, inline: true },
      { name: 'Total Kills', value: `${totalKills}`, inline: true },
      { name: 'Total Deaths', value: `${totalDeaths}`, inline: true },
      { name: 'Total Assists', value: `${totalAssists}`, inline: true }
    )
    .setTimestamp();

  return embed;
}

/**
 * Create help embed
 */
function createHelpEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('📚 DANH SÁCH LỆNH BOT')
    .setColor(COLORS.INFO)
    .setDescription('Hướng dẫn sử dụng Discord LOL Bot')
    .addFields(
      {
        name: '⚙️ SETUP',
        value: '`/link [GameName#Tag]` - Liên kết tài khoản Riot\n`/unlink` - Hủy liên kết',
      },
      {
        name: '🎮 GAME',
        value: '`/refresh` - Kiểm tra match mới (sau khi chơi xong)',
      },
      {
        name: '📅 LỊCH THI ĐẤU',
        value: '`/schedule create` - Tạo lịch chơi (Duo/Flex/ARAM)\n`/schedule list` - Xem lịch đang mở\n`/schedule my` - Xem lịch của bạn',
      },
      {
        name: '🎲 CƯỢC',
        value: '`/openbet` - Mở cửa cược\n`/bet [option] [amount]` - Đặt cược\n`/balance` - Xem số coins',
      },
      {
        name: '📊 THỐNG KÊ',
        value: '`/leaderboard` - Xem bảng xếp hạng\n`/stats [@user]` - Xem stats cá nhân',
      },
      {
        name: '🎲 GIẢI TRÍ',
        value: '`/random` - Random vị trí cho team (trong voice)',
      }
    )
    .setFooter({ text: 'Discord LOL Bot - Made with ❤️' })
    .setTimestamp();

  return embed;
}

module.exports = {
  createMatchAnalysisEmbed,
  createBettingWindowEmbed,
  createBettingResultsEmbed,
  createLeaderboardEmbed,
  createAccountLinkedEmbed,
  createErrorEmbed,
  createSuccessEmbed,
  createInfoEmbed,
  createStatsEmbed,
  createHelpEmbed,
  COLORS,
};
