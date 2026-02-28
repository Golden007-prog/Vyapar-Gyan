export class MCPError extends Error {
  constructor(
    message: string,
    public code: string = "INTERNAL_ERROR",
    public details?: unknown
  ) {
    super(message);
    this.name = "MCPError";
  }
}

export function handleAWSError(error: unknown): MCPError {
  if (error instanceof Error) {
    const awsError = error as any;
    
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

export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, error instanceof Error ? error.message : error);
}
