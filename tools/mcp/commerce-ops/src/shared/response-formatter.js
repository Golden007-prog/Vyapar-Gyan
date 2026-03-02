export function successResponse(data) {
    return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
    };
}
export function partialSuccessResponse(data, warnings) {
    return {
        success: true,
        data,
        warnings,
        timestamp: new Date().toISOString(),
    };
}
export function errorResponse(code, message, details) {
    return {
        success: false,
        error: { code, message, details },
        timestamp: new Date().toISOString(),
    };
}
//# sourceMappingURL=response-formatter.js.map