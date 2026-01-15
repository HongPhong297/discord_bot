/**
 * Riot API Service
 * Wrapper for Riot Games API with rate limiting and error handling
 */

const axios = require('axios');
const { config } = require('../config/config');
const log = require('../utils/logger');

/**
 * Rate limiter class
 */
class RateLimiter {
  constructor() {
    this.requestQueue = [];
    this.requestsInLastSecond = [];
    this.requestsInLast2Minutes = [];
  }

  /**
   * Check if we can make a request now
   */
  canMakeRequest() {
    const now = Date.now();

    // Clean old requests
    this.requestsInLastSecond = this.requestsInLastSecond.filter(
      time => now - time < 1000
    );
    this.requestsInLast2Minutes = this.requestsInLast2Minutes.filter(
      time => now - time < 120000
    );

    // Check limits
    const withinSecondLimit = this.requestsInLastSecond.length < config.riot.rateLimit.requestsPerSecond;
    const within2MinLimit = this.requestsInLast2Minutes.length < config.riot.rateLimit.requestsPer2Minutes;

    return withinSecondLimit && within2MinLimit;
  }

  /**
   * Record a request
   */
  recordRequest() {
    const now = Date.now();
    this.requestsInLastSecond.push(now);
    this.requestsInLast2Minutes.push(now);
  }

  /**
   * Wait until we can make a request
   */
  async waitForSlot() {
    while (!this.canMakeRequest()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.recordRequest();
  }
}

const rateLimiter = new RateLimiter();

/**
 * Base API client with retry logic
 */
class RiotApiClient {
  constructor() {
    this.baseUrls = {
      asia: 'https://asia.api.riotgames.com',
      vn2: 'https://vn2.api.riotgames.com',
    };
    this.maxRetries = 3;
  }

  /**
   * Make HTTP request with rate limiting and retry
   */
  async request(url, region = 'vn2', retryCount = 0) {
    // Wait for rate limit slot
    await rateLimiter.waitForSlot();

    const startTime = Date.now();

    try {
      const response = await axios.get(url, {
        headers: {
          'X-Riot-Token': config.riot.apiKey,
        },
        timeout: 10000, // 10 second timeout
      });

      const duration = Date.now() - startTime;
      log.api('Riot API', url, response.status, duration);

      // Check rate limit headers
      if (response.headers['x-app-rate-limit-count']) {
        const remaining = response.headers['x-app-rate-limit-count'];
        log.debug('Rate limit status', { remaining, url });
      }

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error.response) {
        const { status } = error.response;
        log.api('Riot API', url, status, duration);

        // Handle specific status codes
        switch (status) {
          case 401:
          case 403:
            log.error('Riot API authentication failed - check API key', {
              status,
              url,
            });
            throw new Error('Riot API authentication failed');

          case 404:
            // Not found is sometimes expected (e.g., no active game)
            log.debug('Riot API resource not found', { url });
            return null;

          case 429:
            // Rate limited
            const retryAfter = parseInt(error.response.headers['retry-after'] || '2', 10);
            log.rateLimit('Riot API', 0, Date.now() / 1000 + retryAfter);

            if (retryCount < this.maxRetries) {
              log.warn(`Rate limited, retrying in ${retryAfter}s...`, { retryCount });
              await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
              return this.request(url, region, retryCount + 1);
            }
            throw new Error('Rate limit exceeded');

          case 500:
          case 502:
          case 503:
          case 504:
            // Server errors - retry with exponential backoff
            if (retryCount < this.maxRetries) {
              const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
              log.warn(`Riot API server error, retrying in ${delay}ms...`, {
                status,
                retryCount,
              });
              await new Promise(resolve => setTimeout(resolve, delay));
              return this.request(url, region, retryCount + 1);
            }
            throw new Error(`Riot API server error: ${status}`);

          default:
            log.error('Riot API request failed', {
              status,
              url,
              error: error.response.data,
            });
            throw error;
        }
      }

      // Network error or timeout
      log.error('Riot API network error', { url, error: error.message });
      throw error;
    }
  }

  /**
   * Build URL for API endpoint
   */
  buildUrl(endpoint, region = 'vn2', isRegional = false) {
    const baseUrl = isRegional ? this.baseUrls.asia : this.baseUrls[region];
    return `${baseUrl}${endpoint}`;
  }
}

const apiClient = new RiotApiClient();

/**
 * Riot API methods
 */
const riotApi = {
  /**
   * Get account by Riot ID (GameName#TagLine)
   */
  async getAccountByRiotId(gameName, tagLine) {
    const url = apiClient.buildUrl(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      'asia',
      true
    );
    return apiClient.request(url, 'asia');
  },

  /**
   * Get summoner by PUUID
   */
  async getSummonerByPuuid(puuid, region = 'vn2') {
    const url = apiClient.buildUrl(
      `/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      region
    );
    return apiClient.request(url, region);
  },

  /**
   * Get ranked stats for summoner by Summoner ID (legacy)
   */
  async getRankedStats(summonerId, region = 'vn2') {
    const url = apiClient.buildUrl(
      `/lol/league/v4/entries/by-summoner/${summonerId}`,
      region
    );
    return apiClient.request(url, region);
  },

  /**
   * Get ranked stats by PUUID (NEW - preferred method)
   */
  async getRankedStatsByPuuid(puuid, region = 'vn2') {
    const url = apiClient.buildUrl(
      `/lol/league/v4/entries/by-puuid/${puuid}`,
      region
    );
    return apiClient.request(url, region);
  },

  /**
   * Get match IDs by PUUID
   */
  async getMatchIdsByPuuid(puuid, count = 20, start = 0) {
    const url = apiClient.buildUrl(
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`,
      'asia',
      true
    );
    return apiClient.request(url, 'asia');
  },

  /**
   * Get match details by match ID
   */
  async getMatchById(matchId) {
    const url = apiClient.buildUrl(
      `/lol/match/v5/matches/${matchId}`,
      'asia',
      true
    );
    return apiClient.request(url, 'asia');
  },

  /**
   * Get recent matches for a player
   * Returns array of match objects with full details
   */
  async getRecentMatches(puuid, count = 5) {
    try {
      const matchIds = await this.getMatchIdsByPuuid(puuid, count);
      if (!matchIds || matchIds.length === 0) {
        return [];
      }

      const matches = await Promise.all(
        matchIds.map(matchId => this.getMatchById(matchId))
      );

      return matches.filter(match => match !== null);
    } catch (error) {
      log.error('Error fetching recent matches', error);
      throw error;
    }
  },

  /**
   * Get player stats from a specific match
   */
  getPlayerStatsFromMatch(match, puuid) {
    if (!match || !match.info || !match.info.participants) {
      return null;
    }

    const participant = match.info.participants.find(p => p.puuid === puuid);
    if (!participant) {
      return null;
    }

    return {
      championName: participant.championName,
      championId: participant.championId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      kda: participant.deaths === 0
        ? (participant.kills + participant.assists)
        : ((participant.kills + participant.assists) / participant.deaths),
      totalDamageDealt: participant.totalDamageDealt,
      totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
      totalDamageTaken: participant.totalDamageTaken,
      goldEarned: participant.goldEarned,
      visionScore: participant.visionScore,
      win: participant.win,
      teamId: participant.teamId,
    };
  },

  /**
   * Calculate win rate from recent matches
   */
  async calculateWinRate(puuid, gamesCount = 20) {
    try {
      const matches = await this.getRecentMatches(puuid, gamesCount);
      if (matches.length === 0) {
        return { winRate: 0, wins: 0, losses: 0, total: 0 };
      }

      let wins = 0;
      for (const match of matches) {
        const stats = this.getPlayerStatsFromMatch(match, puuid);
        if (stats && stats.win) {
          wins++;
        }
      }

      const total = matches.length;
      const losses = total - wins;
      const winRate = (wins / total) * 100;

      return {
        winRate: Math.round(winRate * 10) / 10, // Round to 1 decimal
        wins,
        losses,
        total,
      };
    } catch (error) {
      log.error('Error calculating win rate', error);
      return { winRate: 0, wins: 0, losses: 0, total: 0 };
    }
  },

  /**
   * Get average KDA from recent matches
   */
  async calculateAverageKDA(puuid, gamesCount = 20) {
    try {
      const matches = await this.getRecentMatches(puuid, gamesCount);
      if (matches.length === 0) {
        return { kda: 0, avgKills: 0, avgDeaths: 0, avgAssists: 0 };
      }

      let totalKills = 0;
      let totalDeaths = 0;
      let totalAssists = 0;

      for (const match of matches) {
        const stats = this.getPlayerStatsFromMatch(match, puuid);
        if (stats) {
          totalKills += stats.kills;
          totalDeaths += stats.deaths;
          totalAssists += stats.assists;
        }
      }

      const count = matches.length;
      const avgKills = totalKills / count;
      const avgDeaths = totalDeaths / count;
      const avgAssists = totalAssists / count;
      const kda = avgDeaths === 0 ? (avgKills + avgAssists) : ((avgKills + avgAssists) / avgDeaths);

      return {
        kda: Math.round(kda * 100) / 100,
        avgKills: Math.round(avgKills * 10) / 10,
        avgDeaths: Math.round(avgDeaths * 10) / 10,
        avgAssists: Math.round(avgAssists * 10) / 10,
      };
    } catch (error) {
      log.error('Error calculating average KDA', error);
      return { kda: 0, avgKills: 0, avgDeaths: 0, avgAssists: 0 };
    }
  },
};

module.exports = riotApi;
