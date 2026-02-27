"""Catalog service — queries products and categories from Supabase."""

from __future__ import annotations

from uuid import UUID
from typing import Any

from app.integrations.supabase_client import get_supabase_admin_client
from app.core.exceptions import NotFoundError
from app.core.logging import get_logger

logger = get_logger("catalog_service")


def list_categories() -> list[dict]:
    """Return all active categories ordered by sort_order, with parent→child nesting."""
    sb = get_supabase_admin_client()
    resp = (
        sb.table("categories")
        .select("id, name, slug, description, image_url, parent_id, sort_order")
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .order("sort_order")
        .execute()
    )
    categories = resp.data or []

    # Build tree: top-level categories with nested children
    by_id: dict[str, dict] = {}
    roots: list[dict] = []
    for cat in categories:
        cat["children"] = []
        by_id[cat["id"]] = cat

    for cat in categories:
        parent_id = cat.get("parent_id")
        if parent_id and parent_id in by_id:
            by_id[parent_id]["children"].append(cat)
        else:
            roots.append(cat)

    return roots


def list_products(
    *,
    category_id: str | None = None,
    seller_id: str | None = None,
    search: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 20,
) -> tuple[list[dict], int]:
    """Return paginated active products with filters.

    Returns (items, total_count).
    """
    sb = get_supabase_admin_client()
    offset = (page - 1) * per_page

    # Base query — join seller name + primary image
    query = (
        sb.table("products")
        .select(
            "id, name, description, sku, unit, base_ask_price, stock_quantity, reserved_stock, "
            "status, category_id, created_at, "
            "sellers(id, business_name), "
            "categories(id, name, slug), "
            "product_images(id, image_url, is_primary, sort_order)",
            count="exact",
        )
        .eq("status", "active")
        .is_("deleted_at", "null")
    )

    # Filters
    if category_id:
        query = query.eq("category_id", category_id)
    if seller_id:
        query = query.eq("tenant_id", seller_id)
    if min_price is not None:
        query = query.gte("base_ask_price", min_price)
    if max_price is not None:
        query = query.lte("base_ask_price", max_price)
    if search:
        query = query.ilike("name", f"%{search}%")

    # Sort
    if sort == "price_asc":
        query = query.order("base_ask_price", desc=False)
    elif sort == "price_desc":
        query = query.order("base_ask_price", desc=True)
    else:  # newest
        query = query.order("created_at", desc=True)

    # Pagination
    query = query.range(offset, offset + per_page - 1)

    resp = query.execute()
    items = resp.data or []
    total = resp.count if resp.count is not None else len(items)

    # Flatten: pick primary image URL
    for item in items:
        images = item.pop("product_images", []) or []
        primary = next((img for img in images if img.get("is_primary")), None)
        item["primary_image_url"] = primary["image_url"] if primary else (images[0]["image_url"] if images else None)
        # Flatten seller
        seller = item.pop("sellers", None)
        item["seller_name"] = seller.get("business_name") if seller else None
        item["seller_id"] = seller.get("id") if seller else None
        # Flatten category
        category = item.pop("categories", None)
        item["category_name"] = category.get("name") if category else None
        # Compute available stock
        item["available_stock"] = (item.get("stock_quantity") or 0) - (item.get("reserved_stock") or 0)

    return items, total


def get_product_detail(product_id: str) -> dict:
    """Return full product detail with all images and seller info."""
    sb = get_supabase_admin_client()
    resp = (
        sb.table("products")
        .select(
            "*, "
            "sellers(id, business_name, description, city, state, logo_url), "
            "categories(id, name, slug), "
            "product_images(id, image_url, alt_text, is_primary, sort_order)"
        )
        .eq("id", product_id)
        .eq("status", "active")
        .is_("deleted_at", "null")
        .execute()
    )
    products = resp.data or []
    if not products:
        raise NotFoundError("Product", product_id)

    product = products[0]
    # Sort images
    images = product.get("product_images") or []
    images.sort(key=lambda i: (not i.get("is_primary", False), i.get("sort_order", 0)))
    product["images"] = images
    product.pop("product_images", None)

    product["available_stock"] = (product.get("stock_quantity") or 0) - (product.get("reserved_stock") or 0)

    return product
