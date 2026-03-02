/**
 * Error handling and AWS error mapping.
 * Maps AWS SDK errors to MCP error codes and provides structured logging with redaction.
 */
/**
 * Custom MCP error class with code and details properties.
 */
export class MCPError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "MCPError";
    }
}
/**
 * Maps AWS SDK errors to MCP error codes.
 * Handles common AWS exceptions and provides appropriate error codes.
 */
export function handleAWSError(error) {
    if (error && typeof error === "object" && "name" in error) {
        const awsError = error;
        switch (awsError.name) {
            case "ResourceNotFoundException":
                return new MCPError("NOT_FOUND", "The requested resource was not found", { awsError: awsError.name });
            case "ValidationException":
                return new MCPError("VALIDATION_ERROR", awsError.message || "Validation failed", { awsError: awsError.name });
            case "AccessDeniedException":
            case "UnrecognizedClientException":
                return new MCPError("ACCESS_DENIED", "Access denied or invalid credentials", { awsError: awsError.name });
            default:
                return new MCPError("AWS_ERROR", awsError.message || "AWS operation failed", { awsError: awsError.name });
        }
    }
    return new MCPError("UNKNOWN_ERROR", error instanceof Error ? error.message : "An unknown error occurred", { error });
}
/**
 * Logs errors to stderr with structured context.
 * Redacts sensitive information including AWS credentials, session tokens, and internal paths.
 */
export function logError(context, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Redact sensitive information
    const sanitized = errorMessage
        // AWS Access Key IDs (AKIA...)
        .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]")
        // AWS Secret Access Keys (40 character base64)
        .replace(/[A-Za-z0-9+/]{40}/g, "[REDACTED_SECRET]")
        // AWS Session Tokens (longer base64 strings)
        .replace(/FwoGZXIvYXdzE[A-Za-z0-9+/=]{100,}/g, "[REDACTED_SESSION_TOKEN]")
        // Internal file system paths (Windows and Unix)
        .replace(/[A-Z]:\\[\w\\.-]+/g, "[REDACTED_PATH]")
        .replace(/\/[\w\/.-]+\/[\w\/.-]+/g, "[REDACTED_PATH]")
        // Generic secrets and tokens
        .replace(/token[=:]\s*[A-Za-z0-9+/=_-]{20,}/gi, "token=[REDACTED_TOKEN]")
        .replace(/secret[=:]\s*[A-Za-z0-9+/=_-]{20,}/gi, "secret=[REDACTED_SECRET]");
    console.error(`[${context}] Error:`, sanitized);
}
//# sourceMappingURL=error-handler.js.map