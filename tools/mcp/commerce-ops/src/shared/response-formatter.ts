export interface Warning {
  code: string;
  message: string;
  details?: unknown;
}

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp: string;
  warnings?: Warning[];
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type MCPResponse<T = any> = SuccessResponse<T> | ErrorResponse;

export function successResponse<T>(data: T): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function partialSuccessResponse<T>(data: T, warnings: Warning[]): SuccessResponse<T> {
  return {
    success: true,
    data,
    warnings,
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(code: string, message: string, details?: unknown): ErrorResponse {
  return {
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  };
}
