/**
 * Error handling and AWS error mapping.
 * Maps AWS SDK errors to MCP error codes.
 */
/**
 * Custom MCP error class.
 */
export declare class MCPError extends Error {
    code: string;
    details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
/**
 * Maps AWS SDK errors to MCP error codes.
 */
export declare function handleAWSError(error: unknown): MCPError;
/**
 * Logs errors to stderr with context.
 * Redacts sensitive information including AWS credentials, session tokens, and internal paths.
 */
export declare function logError(context: string, error: unknown): void;
//# sourceMappingURL=error-handler.d.ts.map