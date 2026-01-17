/**
 * Scheduler Module
 * Cron jobs for periodic tasks
 */

const cron = require('node-cron');
const { config } = require('../config/config');
const log = require('./logger');

/**
 * Scheduler class to manage cron jobs
 */
class Scheduler {
  constructor() {
    this.jobs = [];
  }

  /**
   * Schedule a job
   * @param {string} name - Job name
   * @param {string} cronExpression - Cron expression
   * @param {Function} task - Task function
   */
  schedule(name, cronExpression, task) {
    try {
      const job = cron.schedule(cronExpression, async () => {
        log.info(`Running scheduled task: ${name}`);
        try {
          await task();
          log.info(`Completed scheduled task: ${name}`);
        } catch (error) {
          log.error(`Error in scheduled task: ${name}`, error);
        }
      });

      this.jobs.push({ name, job });
      log.info(`Scheduled job: ${name}`, { cronExpression });

      return job;
    } catch (error) {
      log.error(`Failed to schedule job: ${name}`, error);
      throw error;
    }
  }

  /**
   * Stop a specific job
   * @param {string} name - Job name
   */
  stop(name) {
    const jobIndex = this.jobs.findIndex(j => j.name === name);
    if (jobIndex !== -1) {
      this.jobs[jobIndex].job.stop();
      this.jobs.splice(jobIndex, 1);
      log.info(`Stopped scheduled job: ${name}`);
    }
  }

  /**
   * Stop all jobs
   */
  stopAll() {
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      log.info(`Stopped job: ${name}`);
    });
    this.jobs = [];
  }

  /**
   * Get all active jobs
   */
  getJobs() {
    return this.jobs.map(({ name }) => name);
  }
}

const scheduler = new Scheduler();

/**
 * Initialize scheduled tasks
 * This will be called from the main bot file
 */
function initializeScheduledTasks(handlers) {
  log.info('Initializing scheduled tasks...');

  // Auto-refresh matches (every 10 minutes)
  // Check for new completed matches
  scheduler.schedule(
    'auto-refresh-matches',
    `*/${config.features.postGame.autoRefreshInterval} * * * *`,
    handlers.autoRefreshMatches
  );

  // Rank sync (every 6 hours)
  // Update Discord roles based on League rank
  scheduler.schedule(
    'rank-sync',
    '0 */6 * * *',
    handlers.rankSync
  );

  // Role cleanup (every hour)
  // Remove expired temporary roles (like "Cục Tạ Vàng")
  scheduler.schedule(
    'role-cleanup',
    '0 * * * *',
    handlers.roleCleanup
  );

  // Bet window cleanup (every 5 minutes)
  // Cancel expired betting windows
  scheduler.schedule(
    'bet-window-cleanup',
    '*/5 * * * *',
    handlers.betWindowCleanup
  );

  // Weekly leaderboard reset (Sunday at midnight)
  scheduler.schedule(
    'weekly-leaderboard-reset',
    '0 0 * * 0',
    handlers.weeklyLeaderboardReset
  );

  // Daily reminder to refresh Riot API key (at 8 AM)
  // Development keys expire every 24 hours
  // DISABLED: Production API key obtained - no longer expires every 24h
  // if (config.app.isDevelopment) {
  //   scheduler.schedule(
  //     'api-key-reminder',
  //     '0 8 * * *',
  //     handlers.apiKeyReminder
  //   );
  // }

  log.info('Scheduled tasks initialized', {
    jobs: scheduler.getJobs(),
  });
}

/**
 * Shutdown scheduler
 */
function shutdown() {
  log.info('Shutting down scheduler...');
  scheduler.stopAll();
}

/**
 * Start all scheduled jobs
 * @param {Object} client - Discord client
 */
function startAllJobs(client) {
  // Import features here to avoid circular dependencies
  const { checkForNewMatches, cleanupExpiredRoles } = require('../features/postGameAnalysis');
  const { syncAllRanks, sendApiKeyReminder } = require('../features/rankSync');
  const { cleanupExpiredWindows } = require('../features/betting');
  const { resetWeeklyLeaderboard } = require('../features/leaderboard');

  const handlers = {
    autoRefreshMatches: () => checkForNewMatches(client),
    rankSync: () => syncAllRanks(client),
    roleCleanup: () => cleanupExpiredRoles(client),
    betWindowCleanup: () => cleanupExpiredWindows(client),
    weeklyLeaderboardReset: () => resetWeeklyLeaderboard(client),
    apiKeyReminder: () => sendApiKeyReminder(client),
  };

  initializeScheduledTasks(handlers);
}

/**
 * Stop all scheduled jobs
 */
function stopAllJobs() {
  shutdown();
}

module.exports = {
  scheduler,
  initializeScheduledTasks,
  shutdown,
  startAllJobs,
  stopAllJobs,
};
