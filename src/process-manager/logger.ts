/**
 * Simple logger for process manager
 * Replace with your own logger if needed
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(category: string, message: string, data?: Record<string, unknown>, error?: Error): void;
  info(category: string, message: string, data?: Record<string, unknown>): void;
  warn(category: string, message: string, data?: Record<string, unknown>, error?: Error): void;
  error(category: string, message: string, data?: Record<string, unknown>, error?: Error): void;
  success(category: string, message: string, data?: Record<string, unknown>): void;
}

const formatData = (data?: Record<string, unknown>): string => {
  if (!data || Object.keys(data).length === 0) return '';
  return ' ' + JSON.stringify(data);
};

const formatError = (error?: Error): string => {
  if (!error) return '';
  return ` [${error.message}]`;
};

const defaultLogger: Logger = {
  debug(category, message, data, error) {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] [${category}] ${message}${formatData(data)}${formatError(error)}`);
    }
  },
  info(category, message, data) {
    console.log(`[INFO] [${category}] ${message}${formatData(data)}`);
  },
  warn(category, message, data, error) {
    console.warn(`[WARN] [${category}] ${message}${formatData(data)}${formatError(error)}`);
  },
  error(category, message, data, error) {
    console.error(`[ERROR] [${category}] ${message}${formatData(data)}${formatError(error)}`);
  },
  success(category, message, data) {
    console.log(`[OK] [${category}] ${message}${formatData(data)}`);
  }
};

// Allow users to replace the logger
let currentLogger: Logger = defaultLogger;

export const logger: Logger = {
  debug(category, message, data, error) {
    currentLogger.debug(category, message, data, error);
  },
  info(category, message, data) {
    currentLogger.info(category, message, data);
  },
  warn(category, message, data, error) {
    currentLogger.warn(category, message, data, error);
  },
  error(category, message, data, error) {
    currentLogger.error(category, message, data, error);
  },
  success(category, message, data) {
    currentLogger.success(category, message, data);
  }
};

export function setLogger(customLogger: Logger): void {
  currentLogger = customLogger === logger ? defaultLogger : customLogger;
}

export function getLogger(): Logger {
  return currentLogger;
}
