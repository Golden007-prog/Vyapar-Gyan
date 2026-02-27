"""Custom exception hierarchy and FastAPI exception handlers."""

from __future__ import annotations

from typing import Any
from fastapi import Request
from fastapi.responses import JSONResponse


# --- Base Exceptions ---

class AppError(Exception):
    """Base application error."""

    def __init__(
        self,
        message: str = "An error occurred",
        code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: dict[str, Any] | None = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class NotFoundError(AppError):
    def __init__(self, resource: str = "Resource", resource_id: str = ""):
        super().__init__(
            message=f"{resource} not found" + (f": {resource_id}" if resource_id else ""),
            code="NOT_FOUND",
            status_code=404,
        )


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Authentication required"):
        super().__init__(message=message, code="UNAUTHORIZED", status_code=401)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Access denied"):
        super().__init__(message=message, code="FORBIDDEN", status_code=403)


class ValidationError(AppError):
    def __init__(self, message: str = "Validation failed", details: dict | None = None):
        super().__init__(
            message=message, code="VALIDATION_ERROR", status_code=422, details=details
        )


class ConflictError(AppError):
    def __init__(self, message: str = "Resource conflict"):
        super().__init__(message=message, code="CONFLICT", status_code=409)


class InsufficientStockError(AppError):
    def __init__(self, product_id: str, available: int, requested: int):
        super().__init__(
            message=f"Insufficient stock for product {product_id}",
            code="INSUFFICIENT_STOCK",
            status_code=400,
            details={"product_id": product_id, "available": available, "requested": requested},
        )


class PaymentError(AppError):
    def __init__(self, message: str = "Payment processing failed", details: dict | None = None):
        super().__init__(
            message=message, code="PAYMENT_ERROR", status_code=502, details=details
        )


class WebhookVerificationError(AppError):
    def __init__(self, provider: str = "unknown"):
        super().__init__(
            message=f"Webhook signature verification failed for {provider}",
            code="WEBHOOK_VERIFICATION_FAILED",
            status_code=401,
        )


class RateLimitError(AppError):
    def __init__(self):
        super().__init__(
            message="Rate limit exceeded", code="RATE_LIMITED", status_code=429
        )


# --- Exception Handlers ---

async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            },
            "meta": {},
        },
    )


async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
                "details": {},
            },
            "meta": {},
        },
    )
