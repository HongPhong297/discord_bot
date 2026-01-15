/**
 * Logger Module
 * Winston-based logging utility with file and console transports
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { config } = require('../config/config');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom format for console output with colors
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    // Add metadata if exists
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }

    return log;
  })
);

/**
 * Format for file output (JSON)
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Create logger instance
 */
const logger = winston.createLogger({
  level: config.app.logLevel,
  defaultMeta: { service: 'discord-lol-bot' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],

  // Handle exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: fileFormat,
    }),
  ],

  // Handle promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: fileFormat,
    }),
  ],
});

/**
 * Logger wrapper with additional utility methods
 */
const log = {
  /**
   * Log info message
   */
  info: (message, meta = {}) => {
    logger.info(message, meta);
  },

  /**
   * Log error message
   */
  error: (message, error = null) => {
    if (error instanceof Error) {
      logger.error(message, {
        error: error.message,
        stack: error.stack,
      });
    } else {
      logger.error(message, error ? { error } : {});
    }
  },

  /**
   * Log warning message
   */
  warn: (message, meta = {}) => {
    logger.warn(message, meta);
  },

  /**
   * Log debug message
   */
  debug: (message, meta = {}) => {
    logger.debug(message, meta);
  },

  /**
   * Log Discord command execution
   */
  command: (commandName, userId, guildId, options = {}) => {
    logger.info(`Command executed: /${commandName}`, {
      userId,
      guildId,
      options,
      type: 'command',
    });
  },

  /**
   * Log API call (Riot, OpenAI, etc.)
   */
  api: (service, endpoint, status, duration = null) => {
    const meta = {
      service,
      endpoint,
      status,
      type: 'api',
    };

    if (duration !== null) {
      meta.duration = `${duration}ms`;
    }

    if (status >= 200 && status < 300) {
      logger.info(`API call: ${service} ${endpoint}`, meta);
    } else if (status >= 400) {
      logger.warn(`API call failed: ${service} ${endpoint}`, meta);
    }
  },

  /**
   * Log rate limit info
   */
  rateLimit: (service, remaining, reset) => {
    logger.warn(`Rate limit warning: ${service}`, {
      remaining,
      resetAt: new Date(reset * 1000).toISOString(),
      type: 'rate-limit',
    });
  },

  /**
   * Log database operation
   */
  db: (operation, collection, success = true, error = null) => {
    const meta = {
      operation,
      collection,
      type: 'database',
    };

    if (success) {
      logger.debug(`DB operation: ${operation} on ${collection}`, meta);
    } else {
      logger.error(`DB operation failed: ${operation} on ${collection}`, {
        ...meta,
        error: error ? error.message : 'Unknown error',
      });
    }
  },

  /**
   * Log match analysis
   */
  match: (matchId, playersCount, result) => {
    logger.info(`Match analyzed: ${matchId}`, {
      matchId,
      playersCount,
      result,
      type: 'match',
    });
  },

  /**
   * Log betting activity
   */
  bet: (action, userId, amount = null, option = null) => {
    const meta = {
      action,
      userId,
      type: 'betting',
    };

    if (amount !== null) meta.amount = amount;
    if (option !== null) meta.option = option;

    logger.info(`Betting: ${action}`, meta);
  },
};

// Log startup info
if (config.app.isDevelopment) {
  logger.info('Logger initialized in DEVELOPMENT mode', {
    level: config.app.logLevel,
    logsDir,
  });
} else {
  logger.info('Logger initialized in PRODUCTION mode', {
    level: config.app.logLevel,
  });
}

module.exports = log;
