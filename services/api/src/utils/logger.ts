import { AsyncLocalStorage } from 'async_hooks';

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/**
 * Context stored in AsyncLocalStorage for request ID propagation
 */
interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: any;
}

/**
 * Structured log entry format
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  context?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

/**
 * AsyncLocalStorage for context propagation across async operations
 */
const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Get the current log level from environment variable
 */
function getCurrentLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
  
  if (Object.values(LogLevel).includes(level as LogLevel)) {
    return level as LogLevel;
  }
  
  return LogLevel.INFO;
}

/**
 * Check if a log level should be logged based on current configuration
 */
function shouldLog(level: LogLevel): boolean {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

/**
 * Format an error object for logging
 */
function formatError(error: Error | unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    const formatted: { message: string; stack?: string; name?: string } = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) {
      formatted.stack = error.stack;
    }
    return formatted;
  }
  
  // For non-Error objects (e.g. Gemini SDK errors), try JSON.stringify for full details
  let message: string;
  if (typeof error === 'string') {
    message = error;
  } else {
    try { message = JSON.stringify(error); } catch { message = String(error); }
  }
  
  return {
    name: (error as any)?.constructor?.name || 'UnknownError',
    message,
  };
}

/**
 * Write a log entry to stdout in JSON format
 */
function writeLog(entry: LogEntry): void {
  // CloudWatch Logs automatically captures stdout
  console.log(JSON.stringify(entry));
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private defaultContext: Record<string, any>;
  
  constructor(defaultContext: Record<string, any> = {}) {
    this.defaultContext = defaultContext;
  }
  
  /**
   * Create a log entry with the given level and message
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error | unknown
  ): LogEntry {
    // Get context from AsyncLocalStorage
    const asyncContext = asyncLocalStorage.getStore() || {};
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    
    // Add optional fields only if they exist
    if (asyncContext.requestId) {
      entry.requestId = asyncContext.requestId;
    }
    if (asyncContext.userId) {
      entry.userId = asyncContext.userId;
    }
    
    // Merge contexts: default -> async -> provided
    const mergedContext = {
      ...this.defaultContext,
      ...asyncContext,
      ...context,
    };
    
    // Remove requestId and userId from context (they're top-level fields)
    delete mergedContext.requestId;
    delete mergedContext.userId;
    
    // Only add context if it has properties
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }
    
    // Add error if provided
    if (error !== undefined) {
      entry.error = formatError(error);
    }
    
    return entry;
  }
  
  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, any>): void {
    if (shouldLog(LogLevel.DEBUG)) {
      const entry = this.createLogEntry(LogLevel.DEBUG, message, context);
      writeLog(entry);
    }
  }
  
  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, any>): void {
    if (shouldLog(LogLevel.INFO)) {
      const entry = this.createLogEntry(LogLevel.INFO, message, context);
      writeLog(entry);
    }
  }
  
  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, any>): void {
    if (shouldLog(LogLevel.WARN)) {
      const entry = this.createLogEntry(LogLevel.WARN, message, context);
      writeLog(entry);
    }
  }
  
  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown, context?: Record<string, any>): void {
    if (shouldLog(LogLevel.ERROR)) {
      const entry = this.createLogEntry(LogLevel.ERROR, message, context, error);
      writeLog(entry);
    }
  }
  
  /**
   * Create a child logger with additional default context
   */
  child(additionalContext: Record<string, any>): Logger {
    return new Logger({
      ...this.defaultContext,
      ...additionalContext,
    });
  }
}

/**
 * Create a logger instance with optional default context
 */
export function createLogger(defaultContext: Record<string, any> = {}): Logger {
  return new Logger(defaultContext);
}

/**
 * Run a function with request context (requestId, userId, etc.)
 * Context is automatically propagated to all log calls within the function
 */
export async function withContext<T>(
  context: LogContext,
  fn: () => Promise<T>
): Promise<T> {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current context from AsyncLocalStorage
 */
export function getContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Set context values in the current AsyncLocalStorage context
 */
export function setContext(context: Partial<LogContext>): void {
  const currentContext = asyncLocalStorage.getStore();
  if (currentContext) {
    Object.assign(currentContext, context);
  }
}

/**
 * Default logger instance for convenience
 */
export const logger = createLogger();
