/**
 * Error handling and AWS error mapping.
 * Maps AWS SDK errors to MCP error codes and provides structured logging with redaction.
 */
/**
 * Custom MCP error class with code and details properties.
 */
export declare class MCPError extends Error {
    code: string;
    details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
/**
 * Maps AWS SDK errors to MCP error codes.
 * Handles common AWS exceptions and provides appropriate error codes.
 */
export declare function handleAWSError(error: unknown): MCPError;
/**
 * Logs errors to stderr with structured context.
 * Redacts sensitive information including AWS credentials, session tokens, and internal paths.
 */
export declare function logError(context: string, error: unknown): void;
//# sourceMappingURL=error-handler.d.ts.map