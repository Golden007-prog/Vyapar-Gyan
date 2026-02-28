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
export function successResponse<T>(data: T): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an error response with ISO 8601 timestamp.
 */
export function errorResponse(
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
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
