/**
 * Post-Game Analysis Feature
 * Analyzes completed matches and posts results to Discord
 */

const db = require('../services/database');
const riotApi = require('../services/riotApi');
const aiService = require('../services/aiService');
const { findMVPAndFeeder, calculateKDA } = require('../utils/calculator');
const { createMatchAnalysisEmbed } = require('../utils/embedBuilder');
const log = require('../utils/logger');
const { config } = require('../config/config');

/**
 * Check for new matches for all linked users
 * @param {Object} client - Discord client
 */
async function checkForNewMatches(client) {
  try {
    log.info('Checking for new matches...');

    // Get all linked users
    const users = await db.models.User.find({});
    if (users.length === 0) {
      log.info('No linked users found');
      return;
    }

    // Track processed matches in this session to avoid duplicate API calls
    const processedMatches = new Set();
    let newMatchesProcessed = 0;

    // Check each user's recent matches
    for (const user of users) {
      try {
        // Get recent matches with type filter from config (ranked only by default)
        const matchType = config.features.postGame.matchType || null;
        const recentMatchIds = await riotApi.getMatchIdsByPuuid(user.riotPuuid, 5, 0, user.region || config.riot.region, matchType);
        if (!recentMatchIds || recentMatchIds.length === 0) {
          continue;
        }

        // Check if matches are already processed
        for (const matchId of recentMatchIds) {
          // Skip if already checked in this session
          if (processedMatches.has(matchId)) {
            continue;
          }
          processedMatches.add(matchId);

          try {
            // First, check if match already exists in DB
            const existingMatch = await db.models.Match.findOne({ matchId });
            
            if (existingMatch) {
              // Match already exists - check if it's fully processed
              if (existingMatch.participants && existingMatch.participants.length > 0) {
                log.debug(`Match ${matchId} already fully processed, skipping`);
                continue;
              }
              
              // Match exists but not fully processed (stuck in processing state)
              // Check if it's been stuck for too long (> 5 minutes)
              if (existingMatch.claimedAt) {
                const ageMinutes = (Date.now() - new Date(existingMatch.claimedAt).getTime()) / (1000 * 60);
                if (ageMinutes < 5) {
                  log.debug(`Match ${matchId} is being processed by another instance, skipping`);
                  continue;
                }
                // Stuck too long, delete and reprocess
                log.warn(`Match ${matchId} stuck for ${ageMinutes.toFixed(1)} min, cleaning up`);
                await db.models.Match.deleteOne({ matchId });
              } else {
                // Has no claimedAt but also no participants - clean up
                log.warn(`Match ${matchId} has incomplete data, cleaning up`);
                await db.models.Match.deleteOne({ matchId });
              }
            }

            // STEP 1: Get full match data from Riot API FIRST (before claiming)
            const matchData = await riotApi.getMatchById(matchId);
            if (!matchData) {
              log.warn(`Failed to get match data for ${matchId}`);
              continue;
            }

            // STEP 2: Check Discord members in match
            const discordParticipants = await getDiscordParticipants(matchData);
            
            // Skip if no Discord members at all
            if (discordParticipants.length === 0) {
              log.debug(`Match ${matchId} has no Discord members, skipping`);
              continue;
            }

            // STEP 3: Now try to claim the match atomically (with timestamp since we have it)
            const claimResult = await db.models.Match.findOneAndUpdate(
              { matchId },
              { 
                $setOnInsert: { 
                  matchId, 
                  processing: true,
                  claimedAt: new Date(),
                  timestamp: new Date(matchData.info.gameCreation),
                }
              },
              { upsert: true, new: true }
            );

            // If document already had participants, someone else processed it
            if (claimResult.participants && claimResult.participants.length > 0) {
              log.debug(`Match ${matchId} was already processed by another instance, skipping`);
              continue;
            }

            log.info(`Claimed match ${matchId} for processing`);

            // STEP 4: Handle based on number of Discord members
            if (discordParticipants.length >= config.features.postGame.minPlayersRequired) {
              // Multi-player game: Full analysis + leaderboard update (inside processMatch)
              await processMatch(client, matchData, discordParticipants);
              newMatchesProcessed++;
            } else {
              // Solo game: Update leaderboard only, no analysis posted
              await updateLeaderboardStats(discordParticipants);
              log.info(`Updated leaderboard stats for solo player`);
              
              // Mark match as processed without full analysis
              await db.models.Match.findOneAndUpdate(
                { matchId },
                {
                  $set: {
                    participants: discordParticipants.map(p => ({
                      discordId: p.discordId,
                      puuid: p.puuid,
                      summonerName: p.summonerName,
                      championName: p.championName,
                      kills: p.kills,
                      deaths: p.deaths,
                      assists: p.assists,
                      win: p.win,
                    })),
                    gameDuration: matchData.info.gameDuration,
                    gameMode: matchData.info.gameMode,
                    queueId: matchData.info.queueId,
                    timestamp: new Date(matchData.info.gameCreation),
                    processing: false,
                    processedAt: new Date(),
                    soloGame: true, // Mark as solo game (no analysis posted)
                  },
                  $unset: { claimedAt: 1 },
                }
              );
              log.info(`Match ${matchId} processed as solo game (leaderboard only, no analysis posted)`);
            }

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));

          } catch (matchError) {
            log.error(`Error processing match ${matchId}`, matchError);
            // Clean up failed claim to allow retry
            await db.models.Match.deleteOne({ matchId, processing: true }).catch(() => {});
          }
        }
      } catch (error) {
        log.error(`Error checking matches for user ${user.discordId}`, error);
      }
    }

    log.info(`Finished checking for new matches. New matches processed: ${newMatchesProcessed}`);
  } catch (error) {
    log.error('Error in checkForNewMatches', error);
  }
}

/**
 * Get Discord members who participated in a match
 * Uses batch query instead of N+1 queries for better performance
 * @param {Object} matchData - Riot API match data
 * @returns {Array} Array of Discord participants
 */
async function getDiscordParticipants(matchData) {
  const participants = matchData.info.participants;
  
  // Extract all PUUIDs from the match (10 players)
  const puuids = participants.map(p => p.puuid);
  
  log.debug(`Searching for ${puuids.length} PUUIDs in database...`);
  
  // Single batch query instead of 10 individual queries
  const linkedUsers = await db.models.User.find({ 
    riotPuuid: { $in: puuids } 
  });
  
  log.info(`Found ${linkedUsers.length} linked Discord users in this match`);
  
  // Log which users were found for debugging
  linkedUsers.forEach(user => {
    log.debug(`  Found: ${user.summonerName} (Discord: ${user.discordId}, PUUID: ${user.riotPuuid?.substring(0, 20)}...)`);
  });
  
  // Create a map for O(1) lookup
  const userMap = new Map();
  linkedUsers.forEach(user => {
    userMap.set(user.riotPuuid, user);
  });
  
  // Match participants with their Discord accounts
  const discordParticipants = [];
  for (const participant of participants) {
    const user = userMap.get(participant.puuid);
    if (user) {
      discordParticipants.push({
        ...participant,
        discordId: user.discordId,
        summonerName: user.summonerName,
      });
    }
  }

  return discordParticipants;
}

/**
 * Process a match (analyze, generate AI, post to Discord)
 * @param {Object} client - Discord client
 * @param {Object} matchData - Riot API match data
 * @param {Array} discordParticipants - Participants who are in Discord
 */
async function processMatch(client, matchData, discordParticipants) {
  try {
    const matchId = matchData.metadata.matchId;
    log.match(matchId, discordParticipants.length, 'analyzing');

    // Extract match info
    const { info } = matchData;
    const gameDuration = info.gameDuration;
    const gameMode = info.gameMode;
    const queueId = info.queueId;

    // Calculate team stats
    const teams = {};
    info.participants.forEach(p => {
      if (!teams[p.teamId]) {
        teams[p.teamId] = {
          totalDamage: 0,
          totalDamageTaken: 0,
        };
      }
      teams[p.teamId].totalDamage += p.totalDamageDealtToChampions || 0;
      teams[p.teamId].totalDamageTaken += p.totalDamageTaken || 0;
    });

    // Prepare participant data
    const participants = discordParticipants.map(p => {
      const kda = calculateKDA(p.kills, p.deaths, p.assists);
      return {
        discordId: p.discordId,
        puuid: p.puuid,
        summonerName: p.summonerName,
        championName: p.championName,
        championId: p.championId,
        teamId: p.teamId,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        kda,
        totalDamageDealt: p.totalDamageDealt,
        totalDamageDealtToChampions: p.totalDamageDealtToChampions,
        totalDamageTaken: p.totalDamageTaken,
        goldEarned: p.goldEarned,
        visionScore: p.visionScore,
        win: p.win,
      };
    });

    // Find MVP and Feeder
    const { mvp, mvpData, feeder, feederData } = findMVPAndFeeder(participants);

    // Generate AI trash talk for each participant
    const trashTalkPromises = participants.map(async (p) => {
      const user = await db.models.User.findOne({ discordId: p.discordId });
      const rank = user?.currentRank?.tier || 'UNRANKED';

      return aiService.generateTrashTalk({
        discordId: p.discordId,
        name: p.summonerName,
        champion: p.championName,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        win: p.win,
        damage: p.totalDamageDealtToChampions,
        rank,
      });
    });

    const trashTalks = await Promise.all(trashTalkPromises);

    // Save match to database
    // Update the claimed document (from atomic claim) with full match data
    const savedMatch = await db.models.Match.findOneAndUpdate(
      { matchId },
      {
        $set: {
          participants,
          mvp,
          feeder,
          gameDuration,
          gameMode,
          queueId,
          timestamp: new Date(info.gameCreation),
          processing: false, // Mark as fully processed
          processedAt: new Date(),
        },
        $unset: {
          claimedAt: 1, // Remove temporary claim field
        },
      },
      { upsert: true, new: true }
    );
    log.info(`Match ${matchId} saved to database`, {
      docId: savedMatch._id?.toString(),
      processing: savedMatch.processing,
      participantsCount: savedMatch.participants?.length,
    });

    // Update leaderboard stats
    await updateLeaderboardStats(participants);

    // Assign roles
    if (feeder) {
      await assignFeederRole(client, feeder, matchId);
    }

    // Post to Discord
    // Pass teams object so each participant's damage % is calculated relative to their own team
    await postMatchAnalysis(client, {
      matchId,
      participants,
      mvpData,
      feederData,
      gameDuration,
      result: participants[0].win ? 'win' : 'loss',
      teams, // Pass full teams object instead of single totalTeamDamage
    }, trashTalks);

    // Settle any related bets
    // Pass gameCreation timestamp so bet timing is calculated correctly
    const gameStartTime = new Date(info.gameCreation);
    await settleBetsForMatch(client, matchId, participants, gameStartTime);

    log.match(matchId, discordParticipants.length, 'completed');
  } catch (error) {
    log.error('Error processing match', error);
    throw error;
  }
}

/**
 * Update leaderboard stats for participants
 * @param {Array} participants - Match participants
 */
async function updateLeaderboardStats(participants) {
  const currentWeek = db.utils.getCurrentWeek();

  for (const p of participants) {
    try {
      const user = await db.models.User.findOne({ discordId: p.discordId });
      if (!user) continue;

      // Find or create leaderboard entry
      let leaderboard = await db.models.Leaderboard.findOne({
        userId: p.discordId,
        week: currentWeek,
      });

      if (!leaderboard) {
        leaderboard = new db.models.Leaderboard({
          userId: p.discordId,
          week: currentWeek,
        });
      }

      // Update stats
      leaderboard.totalKills += p.kills;
      leaderboard.totalDeaths += p.deaths;
      leaderboard.totalAssists += p.assists;
      leaderboard.gamesPlayed += 1;
      if (p.win) {
        leaderboard.gamesWon += 1;
      }

      // Update highest rank
      if (user.currentRank && user.currentRank.tier) {
        const rankString = `${user.currentRank.tier}_${user.currentRank.division}`;
        leaderboard.highestRank = rankString;
      }

      await leaderboard.save();
      log.db('update', 'Leaderboard', true);
    } catch (error) {
      log.error(`Error updating leaderboard for ${p.discordId}`, error);
    }
  }
}

/**
 * Assign feeder role to player
 * @param {Object} client - Discord client
 * @param {string} discordId - Discord user ID
 * @param {string} matchId - Match ID
 */
async function assignFeederRole(client, discordId, matchId) {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    const member = await guild.members.fetch(discordId);

    // Find or create "Cục Tạ Vàng" role
    let role = guild.roles.cache.find(r => r.name === config.features.roles.feederRoleName);

    if (!role) {
      role = await guild.roles.create({
        name: config.features.roles.feederRoleName,
        color: config.features.roles.feederRoleColor,
        reason: 'Auto-created feeder role',
      });
      log.info('Created feeder role', { roleName: role.name });
    }

    // Assign role
    await member.roles.add(role);
    log.info('Assigned feeder role', { discordId, matchId });

    // Schedule role removal
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + config.features.roles.feederRoleDuration);

    const roleAssignment = new db.models.RoleAssignment({
      userId: discordId,
      roleId: role.id,
      roleName: role.name,
      expiresAt,
      matchId,
      reason: 'Feeder in match',
    });

    await roleAssignment.save();
    log.db('insert', 'RoleAssignment', true);
  } catch (error) {
    log.error('Error assigning feeder role', error);
  }
}

/**
 * Post match analysis to Discord channel
 * @param {Object} client - Discord client
 * @param {Object} matchData - Processed match data
 * @param {Array} trashTalks - AI generated trash talks
 */
async function postMatchAnalysis(client, matchData, trashTalks) {
  try {
    const channel = await client.channels.fetch(config.discord.trackedChannelId);
    if (!channel) {
      log.error('Tracked channel not found', { channelId: config.discord.trackedChannelId });
      return;
    }

    const embed = createMatchAnalysisEmbed(matchData, trashTalks);
    await channel.send({ embeds: [embed] });

    log.info('Posted match analysis to Discord', { matchId: matchData.matchId });
  } catch (error) {
    log.error('Error posting match analysis to Discord', error);
  }
}

/**
 * Settle bets related to a match
 * @param {Object} client - Discord client
 * @param {string} matchId - Match ID
 * @param {Array} participants - Match participants
 * @param {Date} gameStartTime - When the game started (from Riot API gameCreation)
 */
async function settleBetsForMatch(client, matchId, participants, gameStartTime) {
  try {
    // Check if there are any open bet windows for participants
    for (const participant of participants) {
      const betWindow = await db.models.BetWindow.findOne({
        userId: participant.discordId,
        status: 'closed',
        matchId: { $exists: false },
      }).sort({ openedAt: -1 });

      if (!betWindow) continue;

      // Check if game STARTED within time window (maxGameStartWindow minutes after bet opened)
      // Using gameStartTime (when player entered game) instead of current time
      // This fixes the bug where long games would exceed the time window
      const timeSinceBetOpened = (gameStartTime - betWindow.openedAt) / (1000 * 60); // minutes
      const maxStartWindow = config.features.betting.maxGameStartWindow || 40; // Fallback to 40

      log.debug('Checking bet window timing', {
        matchId,
        participantId: participant.discordId,
        betOpenedAt: betWindow.openedAt,
        gameStartTime,
        timeSinceBetOpened: timeSinceBetOpened.toFixed(2),
        maxGameStartWindow: maxStartWindow,
      });

      if (timeSinceBetOpened >= 0 && timeSinceBetOpened <= maxStartWindow) {
        // This is the match for this bet window
        betWindow.matchId = matchId;
        betWindow.status = 'matched';
        await betWindow.save();

        // Import betting module to settle bets
        const betting = require('./betting');
        await betting.settleBets(client, betWindow._id, participant, matchId);
        
        log.info('Settled bets for participant', {
          matchId,
          participantId: participant.discordId,
          timeSinceBetOpened: timeSinceBetOpened.toFixed(2),
        });
      } else {
        log.debug('Bet window timing mismatch', {
          matchId,
          participantId: participant.discordId,
          reason: timeSinceBetOpened < 0 ? 'game started before bet' : 'exceeded wait time',
        });
      }
    }
  } catch (error) {
    log.error('Error settling bets for match', error);
  }
}

/**
 * Cleanup expired role assignments
 */
async function cleanupExpiredRoles(client) {
  try {
    log.info('Cleaning up expired role assignments...');

    const expiredAssignments = await db.models.RoleAssignment.find({
      expiresAt: { $lte: new Date() },
    });

    const guild = await client.guilds.fetch(config.discord.guildId);

    for (const assignment of expiredAssignments) {
      try {
        const member = await guild.members.fetch(assignment.userId);
        const role = guild.roles.cache.get(assignment.roleId);

        if (member && role) {
          await member.roles.remove(role);
          log.info('Removed expired role', {
            userId: assignment.userId,
            roleName: assignment.roleName,
          });
        }

        // Delete assignment record
        await db.models.RoleAssignment.deleteOne({ _id: assignment._id });
      } catch (error) {
        log.error(`Error removing role for ${assignment.userId}`, error);
      }
    }

    log.info(`Cleaned up ${expiredAssignments.length} expired role assignments`);
  } catch (error) {
    log.error('Error in cleanupExpiredRoles', error);
  }
}

/**
 * Check for new matches for a specific user
 * @param {Object} client - Discord client
 * @param {string} discordId - Discord user ID to check
 * @returns {Object} Result with counts and any errors
 */
async function checkMatchesForUser(client, discordId) {
  const result = {
    checked: 0,
    newMatches: 0,
    skippedAlreadyProcessed: 0,
    skippedNotEnoughPlayers: 0,
    errors: [],
    debugInfo: [], // For debugging
  };

  try {
    log.info(`Checking matches for user ${discordId}...`);

    const user = await db.models.User.findOne({ discordId });
    if (!user) {
      result.errors.push('User not linked');
      return result;
    }

    log.info(`Found user: ${user.summonerName}, PUUID: ${user.riotPuuid?.substring(0, 20)}...`);
    result.debugInfo.push(`User: ${user.summonerName}`);

    // Get recent matches with type filter from config (ranked only by default)
    const matchType = config.features.postGame.matchType || null;
    const recentMatchIds = await riotApi.getMatchIdsByPuuid(user.riotPuuid, 5, 0, user.region || config.riot.region, matchType);
    if (!recentMatchIds || recentMatchIds.length === 0) {
      log.info(`No recent ${matchType || 'any'} matches found for user ${discordId}`);
      result.debugInfo.push(`No ${matchType || 'any'} matches from Riot API`);
      return result;
    }

    log.info(`Found ${recentMatchIds.length} recent matches: ${recentMatchIds.join(', ')}`);
    result.checked = recentMatchIds.length;

    for (const matchId of recentMatchIds) {
      try {
        // Check if match already exists in DB
        const existingMatch = await db.models.Match.findOne({ matchId });
        if (existingMatch) {
          log.info(`Match ${matchId} status: processing=${existingMatch.processing}, participantsCount=${existingMatch.participants?.length || 0}`);
          
          // Match already fully processed - has participants
          if (existingMatch.participants && existingMatch.participants.length > 0) {
            result.skippedAlreadyProcessed++;
            result.debugInfo.push(`${matchId.slice(-8)}: already processed`);
            continue;
          }
          
          // Match exists but not fully processed (stuck in processing state)
          // Check if it's been stuck for too long (> 5 minutes)
          if (existingMatch.claimedAt) {
            const ageMinutes = (Date.now() - new Date(existingMatch.claimedAt).getTime()) / (1000 * 60);
            if (ageMinutes < 5) {
              log.debug(`Match ${matchId} is being processed by another instance (${ageMinutes.toFixed(1)}m ago), skipping`);
              result.skippedAlreadyProcessed++;
              result.debugInfo.push(`${matchId.slice(-8)}: processing (${ageMinutes.toFixed(1)}m ago)`);
              continue;
            }
            // Stuck too long, delete and reprocess
            log.warn(`Match ${matchId} stuck for ${ageMinutes.toFixed(1)} min, cleaning up`);
            await db.models.Match.deleteOne({ matchId });
          } else {
            // Has no claimedAt but also no participants - clean up (bug from previous version)
            log.warn(`Match ${matchId} has incomplete data (empty participants, no claimedAt), cleaning up`);
            await db.models.Match.deleteOne({ matchId });
          }
        }

        // STEP 1: Get full match data from Riot API FIRST (before claiming)
        // This way we know the timestamp before trying to save
        const matchData = await riotApi.getMatchById(matchId);
        if (!matchData) {
          result.errors.push(`Failed to fetch match data for ${matchId.slice(-8)}`);
          continue;
        }

        log.info(`Got match data: ${matchData.info.participants.length} participants, queue: ${matchData.info.queueId}`);

        // STEP 2: Check Discord members in match
        const discordParticipants = await getDiscordParticipants(matchData);
        log.info(`Found ${discordParticipants.length} Discord members in match ${matchId}`);
        
        // Log which Discord members were found
        if (discordParticipants.length > 0) {
          discordParticipants.forEach(p => {
            log.info(`  - ${p.summonerName} (${p.discordId}): ${p.championName}`);
          });
        }

        // Skip if no Discord members at all
        if (discordParticipants.length === 0) {
          log.info(`Match ${matchId} has no Discord members, skipping`);
          result.skippedNotEnoughPlayers++;
          result.debugInfo.push(`${matchId.slice(-8)}: no Discord members`);
          continue;
        }

        // STEP 3: Now try to claim the match atomically (with timestamp since we have it)
        // Use findOneAndUpdate with $setOnInsert for atomic claim
        const claimResult = await db.models.Match.findOneAndUpdate(
          { matchId },
          { 
            $setOnInsert: { 
              matchId, 
              processing: true,
              claimedAt: new Date(),
              timestamp: new Date(matchData.info.gameCreation), // Include timestamp!
            }
          },
          { upsert: true, new: true }
        );

        // If document already had participants, someone else processed it
        if (claimResult.participants && claimResult.participants.length > 0) {
          log.debug(`Match ${matchId} was already processed by another instance, skipping`);
          result.skippedAlreadyProcessed++;
          continue;
        }

        log.info(`Claimed match ${matchId} for processing`);

        // STEP 4: Handle based on number of Discord members
        if (discordParticipants.length >= config.features.postGame.minPlayersRequired) {
          // Multi-player game: Full analysis + leaderboard update (inside processMatch)
          log.info(`Processing match ${matchId} with ${discordParticipants.length} Discord members...`);
          await processMatch(client, matchData, discordParticipants);
          result.newMatches++;
          result.debugInfo.push(`${matchId.slice(-8)}: posted!`);
        } else {
          // Solo game: Update leaderboard only, no analysis posted
          await updateLeaderboardStats(discordParticipants);
          log.info(`Updated leaderboard stats for solo player`);
          
          // Mark match as processed without full analysis
          await db.models.Match.findOneAndUpdate(
            { matchId },
            {
              $set: {
                participants: discordParticipants.map(p => ({
                  discordId: p.discordId,
                  puuid: p.puuid,
                  summonerName: p.summonerName,
                  championName: p.championName,
                  kills: p.kills,
                  deaths: p.deaths,
                  assists: p.assists,
                  win: p.win,
                })),
                gameDuration: matchData.info.gameDuration,
                gameMode: matchData.info.gameMode,
                queueId: matchData.info.queueId,
                timestamp: new Date(matchData.info.gameCreation),
                processing: false,
                processedAt: new Date(),
                soloGame: true, // Mark as solo game (no analysis posted)
              },
              $unset: { claimedAt: 1 },
            }
          );
          result.debugInfo.push(`${matchId.slice(-8)}: solo game (leaderboard only)`);
          log.info(`Match ${matchId} processed as solo game (leaderboard only)`);
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (matchError) {
        log.error(`Error processing match ${matchId}`, matchError);
        result.errors.push(`Error: ${matchError.message}`);
        await db.models.Match.deleteOne({ matchId, processing: true }).catch(() => {});
      }
    }

    log.info(`Finished checking matches for user ${discordId}. New: ${result.newMatches}, Skipped: ${result.skippedAlreadyProcessed}`);
    return result;

  } catch (error) {
    log.error(`Error in checkMatchesForUser for ${discordId}`, error);
    result.errors.push(error.message);
    return result;
  }
}

module.exports = {
  checkForNewMatches,
  checkMatchesForUser,
  processMatch,
  cleanupExpiredRoles,
};
