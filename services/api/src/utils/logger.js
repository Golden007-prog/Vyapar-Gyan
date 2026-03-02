"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = exports.LogLevel = void 0;
exports.createLogger = createLogger;
exports.withContext = withContext;
exports.getContext = getContext;
exports.setContext = setContext;
const async_hooks_1 = require("async_hooks");
/**
 * Log levels in order of severity
 */
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};
/**
 * AsyncLocalStorage for context propagation across async operations
 */
const asyncLocalStorage = new async_hooks_1.AsyncLocalStorage();
/**
 * Get the current log level from environment variable
 */
function getCurrentLogLevel() {
    const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
    if (Object.values(LogLevel).includes(level)) {
        return level;
    }
    return LogLevel.INFO;
}
/**
 * Check if a log level should be logged based on current configuration
 */
function shouldLog(level) {
    const currentLevel = getCurrentLogLevel();
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}
/**
 * Format an error object for logging
 */
function formatError(error) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return {
        name: 'UnknownError',
        message: String(error),
    };
}
/**
 * Write a log entry to stdout in JSON format
 */
function writeLog(entry) {
    // CloudWatch Logs automatically captures stdout
    console.log(JSON.stringify(entry));
}
/**
 * Logger class for structured logging
 */
class Logger {
    defaultContext;
    constructor(defaultContext = {}) {
        this.defaultContext = defaultContext;
    }
    /**
     * Create a log entry with the given level and message
     */
    createLogEntry(level, message, context, error) {
        // Get context from AsyncLocalStorage
        const asyncContext = asyncLocalStorage.getStore() || {};
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            requestId: asyncContext.requestId,
            userId: asyncContext.userId,
        };
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
        if (error) {
            entry.error = formatError(error);
        }
        return entry;
    }
    /**
     * Log a debug message
     */
    debug(message, context) {
        if (shouldLog(LogLevel.DEBUG)) {
            const entry = this.createLogEntry(LogLevel.DEBUG, message, context);
            writeLog(entry);
        }
    }
    /**
     * Log an info message
     */
    info(message, context) {
        if (shouldLog(LogLevel.INFO)) {
            const entry = this.createLogEntry(LogLevel.INFO, message, context);
            writeLog(entry);
        }
    }
    /**
     * Log a warning message
     */
    warn(message, context) {
        if (shouldLog(LogLevel.WARN)) {
            const entry = this.createLogEntry(LogLevel.WARN, message, context);
            writeLog(entry);
        }
    }
    /**
     * Log an error message
     */
    error(message, error, context) {
        if (shouldLog(LogLevel.ERROR)) {
            const entry = this.createLogEntry(LogLevel.ERROR, message, context, error);
            writeLog(entry);
        }
    }
    /**
     * Create a child logger with additional default context
     */
    child(additionalContext) {
        return new Logger({
            ...this.defaultContext,
            ...additionalContext,
        });
    }
}
exports.Logger = Logger;
/**
 * Create a logger instance with optional default context
 */
function createLogger(defaultContext = {}) {
    return new Logger(defaultContext);
}
/**
 * Run a function with request context (requestId, userId, etc.)
 * Context is automatically propagated to all log calls within the function
 */
async function withContext(context, fn) {
    return asyncLocalStorage.run(context, fn);
}
/**
 * Get the current context from AsyncLocalStorage
 */
function getContext() {
    return asyncLocalStorage.getStore();
}
/**
 * Set context values in the current AsyncLocalStorage context
 */
function setContext(context) {
    const currentContext = asyncLocalStorage.getStore();
    if (currentContext) {
        Object.assign(currentContext, context);
    }
}
//# sourceMappingURL=logger.js.map