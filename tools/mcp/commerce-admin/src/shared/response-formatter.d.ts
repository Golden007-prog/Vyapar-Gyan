/**
 * Standard response formatting for MCP tools.
 * Provides consistent success and error response structures.
 */
/**
 * Success response structure.
 */
export interface SuccessResponse<T> {
    success: true;
    data: T;
    timestamp: string;
}
/**
 * Error response structure.
 */
export interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
    timestamp: string;
}
/**
 * Creates a success response with ISO 8601 timestamp.
 */
export declare function successResponse<T>(data: T): SuccessResponse<T>;
/**
 * Creates an error response with ISO 8601 timestamp.
 */
export declare function errorResponse(code: string, message: string, details?: unknown): ErrorResponse;
//# sourceMappingURL=response-formatter.d.ts.map