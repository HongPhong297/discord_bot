/**
 * Calculator Utilities
 * Formulas for KDA, MVP score, betting odds, and other calculations
 */

/**
 * Calculate KDA ratio
 * @param {number} kills
 * @param {number} deaths
 * @param {number} assists
 * @returns {number} KDA ratio
 */
function calculateKDA(kills, deaths, assists) {
  if (deaths === 0) {
    return kills + assists; // Perfect KDA
  }
  return (kills + assists) / deaths;
}

/**
 * Calculate MVP score for a player
 * Formula: (K + A) / D * (DMG% + TankDMG%) * Win multiplier
 *
 * @param {Object} player - Player stats
 * @param {Object} teamStats - Aggregated team stats
 * @returns {number} MVP score (0-100)
 */
function calculateMVPScore(player, teamStats) {
  const {
    kills,
    deaths,
    assists,
    totalDamageDealtToChampions,
    totalDamageTaken,
    win,
  } = player;

  // Base KDA score
  const kda = calculateKDA(kills, deaths, assists);

  // Damage contribution to team
  const damagePercent = teamStats.totalDamage > 0
    ? (totalDamageDealtToChampions / teamStats.totalDamage)
    : 0;

  // Tank contribution (damage absorbed)
  const tankPercent = teamStats.totalDamageTaken > 0
    ? (totalDamageTaken / teamStats.totalDamageTaken)
    : 0;

  // Combined performance score
  let score = kda * (damagePercent * 0.6 + tankPercent * 0.4);

  // Win bonus
  if (win) {
    score *= 1.2;
  }

  // Normalize to 0-100 scale
  score = Math.min(score * 10, 100);

  return Math.round(score * 10) / 10; // Round to 1 decimal
}

/**
 * Find MVP and Feeder in a match
 * @param {Array} participants - Array of player stats
 * @returns {Object} { mvp, feeder }
 */
function findMVPAndFeeder(participants) {
  if (!participants || participants.length === 0) {
    return { mvp: null, feeder: null };
  }

  // Calculate team stats for each team
  const teams = {};
  participants.forEach(p => {
    if (!teams[p.teamId]) {
      teams[p.teamId] = {
        totalDamage: 0,
        totalDamageTaken: 0,
      };
    }
    teams[p.teamId].totalDamage += p.totalDamageDealtToChampions || 0;
    teams[p.teamId].totalDamageTaken += p.totalDamageTaken || 0;
  });

  // Calculate MVP scores
  const playersWithScores = participants
    .filter(p => p.discordId) // Only Discord members
    .map(p => ({
      ...p,
      kda: calculateKDA(p.kills, p.deaths, p.assists),
      mvpScore: calculateMVPScore(p, teams[p.teamId]),
    }));

  if (playersWithScores.length === 0) {
    return { mvp: null, feeder: null };
  }

  // Find MVP (highest score)
  const mvp = playersWithScores.reduce((max, p) =>
    p.mvpScore > max.mvpScore ? p : max
  );

  // Find Feeder (lowest KDA or 10+ deaths)
  const feeder = playersWithScores.reduce((worst, p) => {
    // Prioritize players with 10+ deaths
    if (p.deaths >= 10 && worst.deaths < 10) return p;
    if (worst.deaths >= 10 && p.deaths < 10) return worst;

    // Otherwise, lowest KDA
    return p.kda < worst.kda ? p : worst;
  });

  return {
    mvp: mvp.discordId,
    mvpData: mvp,
    feeder: feeder.discordId,
    feederData: feeder,
  };
}

/**
 * Calculate dynamic betting odds based on player performance
 * @param {Object} stats - Player recent stats
 * @returns {Object} Odds for different bet types
 */
function calculateBettingOdds(stats) {
  const { winRate, avgKDA, avgDeaths } = stats;

  // Base odds calculation
  // Higher win rate = lower win odds, higher loss odds
  const winOdds = winRate > 50
    ? 1.5 + (100 - winRate) / 50 // 1.5 - 2.5x
    : 2.0 + (50 - winRate) / 25;  // 2.0 - 4.0x

  const lossOdds = winRate > 50
    ? 2.0 + (winRate - 50) / 25   // 2.0 - 4.0x
    : 1.5 + winRate / 50;         // 1.5 - 2.5x

  // KDA-based odds
  const kdaThreshold = 3.0;
  const kdaOdds = avgKDA > kdaThreshold
    ? 1.6 + (5.0 - avgKDA) / 2    // Good KDA = lower odds
    : 2.2 + (kdaThreshold - avgKDA) / 2; // Bad KDA = higher odds

  // Deaths-based odds
  const deathThreshold = 7;
  const deathOdds = avgDeaths > deathThreshold
    ? 1.8 + (avgDeaths - deathThreshold) / 3 // Often dies = lower odds
    : 2.5 + (deathThreshold - avgDeaths) / 3; // Rarely dies = higher odds

  // Game duration odds (relatively static)
  const timeOdds = 1.8;

  // Apply house edge (reduce odds by 5%)
  const houseEdge = 0.95;

  return {
    win: Math.round(winOdds * houseEdge * 10) / 10,
    loss: Math.round(lossOdds * houseEdge * 10) / 10,
    'kda>3': Math.round(kdaOdds * houseEdge * 10) / 10,
    'deaths>7': Math.round(deathOdds * houseEdge * 10) / 10,
    'time>30': Math.round(timeOdds * houseEdge * 10) / 10,
  };
}

/**
 * Calculate bet payout
 * @param {number} amount - Bet amount
 * @param {number} odds - Betting odds
 * @returns {number} Payout amount (including original bet)
 */
function calculatePayout(amount, odds) {
  return Math.floor(amount * odds);
}

/**
 * Evaluate bet result
 * @param {string} betType - Type of bet
 * @param {Object} matchStats - Player's match statistics
 * @returns {boolean} True if bet won, false if lost
 */
function evaluateBet(betType, matchStats) {
  const { win, kda, deaths, gameDuration } = matchStats;

  switch (betType) {
    case 'win':
      return win === true;

    case 'loss':
      return win === false;

    case 'kda>3':
      return kda > 3.0;

    case 'deaths>7':
      return deaths > 7;

    case 'time>30':
      return gameDuration > 30 * 60; // Convert to seconds

    default:
      return false;
  }
}

/**
 * Format KDA for display
 * @param {number} kills
 * @param {number} deaths
 * @param {number} assists
 * @returns {string} Formatted KDA string
 */
function formatKDA(kills, deaths, assists) {
  return `${kills}/${deaths}/${assists}`;
}

/**
 * Format KDA ratio for display
 * @param {number} kda
 * @returns {string} Formatted KDA ratio
 */
function formatKDARatio(kda) {
  if (kda === Infinity || kda > 100) {
    return 'Perfect';
  }
  return kda.toFixed(2);
}

/**
 * Format game duration
 * @param {number} seconds
 * @returns {string} Formatted duration (MM:SS)
 */
function formatGameDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format large numbers (damage, gold, etc.)
 * @param {number} num
 * @returns {string} Formatted number with commas
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Calculate percentage
 * @param {number} value
 * @param {number} total
 * @returns {number} Percentage (0-100)
 */
function calculatePercentage(value, total) {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Get rank tier from rank string
 * @param {string} rank - e.g., "DIAMOND II"
 * @returns {string} Tier only, e.g., "DIAMOND"
 */
function getRankTier(rank) {
  if (!rank) return 'UNRANKED';
  return rank.split(' ')[0] || 'UNRANKED';
}

/**
 * Compare ranks (for leaderboard sorting)
 * @param {string} rankA - e.g., "DIAMOND II"
 * @param {string} rankB - e.g., "GOLD I"
 * @returns {number} -1 if A > B, 1 if B > A, 0 if equal
 */
function compareRanks(rankA, rankB) {
  const tierOrder = {
    'CHALLENGER': 9,
    'GRANDMASTER': 8,
    'MASTER': 7,
    'DIAMOND': 6,
    'PLATINUM': 5,
    'GOLD': 4,
    'SILVER': 3,
    'BRONZE': 2,
    'IRON': 1,
    'UNRANKED': 0,
  };

  const divisionOrder = {
    'I': 4,
    'II': 3,
    'III': 2,
    'IV': 1,
  };

  const [tierA, divA] = (rankA || 'UNRANKED').split(' ');
  const [tierB, divB] = (rankB || 'UNRANKED').split(' ');

  const tierAVal = tierOrder[tierA] || 0;
  const tierBVal = tierOrder[tierB] || 0;

  if (tierAVal !== tierBVal) {
    return tierBVal - tierAVal; // Higher tier first
  }

  // Same tier, compare divisions
  const divAVal = divisionOrder[divA] || 0;
  const divBVal = divisionOrder[divB] || 0;

  return divBVal - divAVal; // Higher division first
}

module.exports = {
  calculateKDA,
  calculateMVPScore,
  findMVPAndFeeder,
  calculateBettingOdds,
  calculatePayout,
  evaluateBet,
  formatKDA,
  formatKDARatio,
  formatGameDuration,
  formatNumber,
  calculatePercentage,
  getRankTier,
  compareRanks,
};
