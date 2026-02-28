"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPError = void 0;
exports.handleAWSError = handleAWSError;
exports.logError = logError;
class MCPError extends Error {
    code;
    details;
    constructor(message, code = "INTERNAL_ERROR", details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "MCPError";
    }
}
exports.MCPError = MCPError;
function handleAWSError(error) {
    if (error instanceof Error) {
        const awsError = error;
        if (awsError.name === "ResourceNotFoundException") {
            return new MCPError("Resource not found", "NOT_FOUND", { original: error.message });
        }
        if (awsError.name === "ValidationException") {
            return new MCPError("Invalid request parameters", "VALIDATION_ERROR", { original: error.message });
        }
        if (awsError.name === "AccessDeniedException") {
            return new MCPError("Access denied to AWS resource", "ACCESS_DENIED", { original: error.message });
        }
        return new MCPError(error.message, "AWS_ERROR", { name: awsError.name });
    }
    return new MCPError("Unknown error occurred", "UNKNOWN_ERROR", { error });
}
function logError(context, error) {
    console.error(`[${context}]`, error instanceof Error ? error.message : error);
}
//# sourceMappingURL=error-handler.js.map