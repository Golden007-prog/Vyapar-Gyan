"""Structured JSON logging with request correlation IDs."""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar

import structlog

from app.core.config import get_settings

# Context variable for request correlation
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")


def get_request_id() -> str:
    rid = request_id_ctx.get()
    return rid if rid else str(uuid.uuid4())


def setup_logging() -> None:
    settings = get_settings()

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )


def get_logger(name: str = "vyapargyan") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
