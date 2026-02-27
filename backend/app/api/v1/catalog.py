"""Catalog endpoints — public, no auth required.

Real implementation backed by catalog_service.
"""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Query

from app.schemas.common import success_response, paginated_response
from app.services.catalog_service import list_categories, list_products, get_product_detail
from app.core.logging import get_logger

logger = get_logger("catalog_api")

router = APIRouter()


@router.get("/categories")
async def get_categories():
    """List active categories as a hierarchical tree."""
    categories = list_categories()
    return success_response(data=categories)


@router.get("/products")
async def browse_products(
    category_id: UUID | None = None,
    seller_id: UUID | None = None,
    search: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    sort: str = Query("newest", pattern="^(price_asc|price_desc|newest)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """Browse active products with optional filters + pagination."""
    items, total = list_products(
        category_id=str(category_id) if category_id else None,
        seller_id=str(seller_id) if seller_id else None,
        search=search,
        min_price=min_price,
        max_price=max_price,
        sort=sort,
        page=page,
        per_page=per_page,
    )
    return paginated_response(data=items, total=total, page=page, per_page=per_page)


@router.get("/products/{product_id}")
async def get_product(product_id: UUID):
    """Full product detail with all images, seller info, and available stock."""
    product = get_product_detail(str(product_id))
    return success_response(data=product)
