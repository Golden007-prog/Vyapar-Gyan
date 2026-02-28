export declare class MCPError extends Error {
    code: string;
    details?: unknown | undefined;
    constructor(message: string, code?: string, details?: unknown | undefined);
}
export declare function handleAWSError(error: unknown): MCPError;
export declare function logError(context: string, error: unknown): void;
//# sourceMappingURL=error-handler.d.ts.map