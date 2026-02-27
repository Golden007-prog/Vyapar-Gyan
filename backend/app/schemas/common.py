"""Shared response schemas and pagination."""

from __future__ import annotations

from typing import Any, Generic, Optional, TypeVar
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationMeta(BaseModel):
    page: int = 1
    per_page: int = 20
    total: int = 0
    request_id: str = ""


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    error: Optional[dict[str, Any]] = None
    meta: PaginationMeta = Field(default_factory=PaginationMeta)


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.per_page


def success_response(
    data: Any = None,
    meta: dict | None = None,
) -> dict:
    response = {"success": True, "data": data, "error": None, "meta": meta or {}}
    return response


def paginated_response(
    data: list,
    total: int,
    page: int,
    per_page: int,
    request_id: str = "",
) -> dict:
    return {
        "success": True,
        "data": data,
        "error": None,
        "meta": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "request_id": request_id,
        },
    }
