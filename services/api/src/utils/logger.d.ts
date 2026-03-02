/**
 * Log levels in order of severity
 */
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
}
/**
 * Context stored in AsyncLocalStorage for request ID propagation
 */
interface LogContext {
    requestId?: string;
    userId?: string;
    [key: string]: any;
}
/**
 * Logger class for structured logging
 */
export declare class Logger {
    private defaultContext;
    constructor(defaultContext?: Record<string, any>);
    /**
     * Create a log entry with the given level and message
     */
    private createLogEntry;
    /**
     * Log a debug message
     */
    debug(message: string, context?: Record<string, any>): void;
    /**
     * Log an info message
     */
    info(message: string, context?: Record<string, any>): void;
    /**
     * Log a warning message
     */
    warn(message: string, context?: Record<string, any>): void;
    /**
     * Log an error message
     */
    error(message: string, error?: Error | unknown, context?: Record<string, any>): void;
    /**
     * Create a child logger with additional default context
     */
    child(additionalContext: Record<string, any>): Logger;
}
/**
 * Create a logger instance with optional default context
 */
export declare function createLogger(defaultContext?: Record<string, any>): Logger;
/**
 * Run a function with request context (requestId, userId, etc.)
 * Context is automatically propagated to all log calls within the function
 */
export declare function withContext<T>(context: LogContext, fn: () => Promise<T>): Promise<T>;
/**
 * Get the current context from AsyncLocalStorage
 */
export declare function getContext(): LogContext | undefined;
/**
 * Set context values in the current AsyncLocalStorage context
 */
export declare function setContext(context: Partial<LogContext>): void;
export {};
//# sourceMappingURL=logger.d.ts.map