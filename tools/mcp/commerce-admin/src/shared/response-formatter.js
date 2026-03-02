/**
 * Standard response formatting for MCP tools.
 * Provides consistent success and error response structures.
 */
/**
 * Creates a success response with ISO 8601 timestamp.
 */
export function successResponse(data) {
    return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
    };
}
/**
 * Creates an error response with ISO 8601 timestamp.
 */
export function errorResponse(code, message, details) {
    return {
        success: false,
        error: {
            code,
            message,
            details,
        },
        timestamp: new Date().toISOString(),
    };
}
//# sourceMappingURL=response-formatter.js.map