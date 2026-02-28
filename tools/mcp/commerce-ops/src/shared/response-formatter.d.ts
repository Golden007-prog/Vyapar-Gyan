export interface SuccessResponse<T = any> {
    success: true;
    data: T;
    timestamp: string;
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
export declare function successResponse<T>(data: T): SuccessResponse<T>;
export declare function errorResponse(code: string, message: string, details?: unknown): ErrorResponse;
//# sourceMappingURL=response-formatter.d.ts.map