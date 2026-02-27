"""VyaparGyan Backend — FastAPI entry point.

Boot:  uvicorn app.main:app --reload
"""

from __future__ import annotations

import uuid
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.exceptions import AppError, app_error_handler, unhandled_error_handler
from app.core.logging import setup_logging, request_id_ctx, get_logger

setup_logging()
logger = get_logger("main")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="AI-powered commerce platform for Bharat retailers",
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
    )

    # --- CORS ---------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Middleware: request ID + timing ------------------------------------
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request_id_ctx.set(rid)
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Response-Time-Ms"] = str(elapsed_ms)
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            elapsed_ms=elapsed_ms,
            request_id=rid,
        )
        return response

    # --- Exception handlers ------------------------------------------------
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    # --- Routes ------------------------------------------------------------
    from app.api.v1.router import api_v1_router
    app.include_router(api_v1_router)

    @app.get("/health", tags=["Health"])
    async def health_check():
        """Root health endpoint."""
        return {
            "status": "healthy",
            "service": settings.app_name,
            "env": settings.app_env,
        }

    logger.info("app_initialized", name=settings.app_name, env=settings.app_env)
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=not settings.is_production,
    )
