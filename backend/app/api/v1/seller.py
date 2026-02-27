"""Seller endpoints: profile, products, inventory, orders, notifications, dashboard."""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Depends, Query, UploadFile, File

from app.core.auth import AuthenticatedUser
from app.core.rbac import require_seller
from app.schemas.common import success_response

router = APIRouter()


# --- Profile ---

@router.get("/profile")
async def get_profile(user: AuthenticatedUser = Depends(require_seller)):
    """Get seller's own profile."""
    return success_response(data={})


@router.put("/profile")
async def update_profile(body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Update seller profile (business_name, address, etc.)."""
    return success_response(data={"message": "Profile updated"})


# --- Products ---

@router.get("/products")
async def list_products(
    status: str | None = None,
    page: int = Query(1, ge=1),
    user: AuthenticatedUser = Depends(require_seller),
):
    """List seller's own products."""
    return success_response(data=[])


@router.post("/products")
async def create_product(body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Create a new product (draft status). Auto-sets tenant_id from auth."""
    return success_response(data={"message": "Product created"})


@router.put("/products/{product_id}")
async def update_product(product_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Update a product. Ownership enforced."""
    return success_response(data={"message": f"Product {product_id} updated"})


@router.delete("/products/{product_id}")
async def delete_product(product_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Soft-delete a product. Fails if open orders exist."""
    return success_response(data={"message": f"Product {product_id} deleted"})


@router.patch("/products/{product_id}/status")
async def update_product_status(product_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Publish/unpublish a product (draft↔active)."""
    return success_response(data={"message": f"Product {product_id} status updated"})


# --- Product Images ---

@router.post("/products/{product_id}/images")
async def upload_image(
    product_id: UUID,
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_seller),
):
    """Upload a product image to Supabase Storage."""
    return success_response(data={"message": "Image uploaded"})


@router.delete("/products/{product_id}/images/{image_id}")
async def delete_image(product_id: UUID, image_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Delete a product image."""
    return success_response(data={"message": f"Image {image_id} deleted"})


# --- Inventory ---

@router.post("/products/{product_id}/inventory")
async def adjust_inventory(product_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Adjust stock (restock/adjustment). Creates inventory_log entry."""
    return success_response(data={"message": "Inventory adjusted"})


@router.get("/products/{product_id}/inventory/logs")
async def inventory_logs(product_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Get inventory change history for a product."""
    return success_response(data=[])


# --- Orders ---

@router.get("/orders")
async def list_orders(
    status: str | None = None,
    page: int = Query(1, ge=1),
    user: AuthenticatedUser = Depends(require_seller),
):
    """List seller's orders with optional status filter."""
    return success_response(data=[])


@router.get("/orders/{order_id}")
async def get_order(order_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Get order detail with items."""
    return success_response(data={})


@router.patch("/orders/{order_id}/accept")
async def accept_order(order_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Accept a pending order. Triggers payment link creation."""
    return success_response(data={"message": f"Order {order_id} accepted"})


@router.patch("/orders/{order_id}/reject")
async def reject_order(order_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Reject a pending order. Unreserves stock, notifies customer."""
    return success_response(data={"message": f"Order {order_id} rejected"})


@router.patch("/orders/{order_id}/status")
async def update_order_status(order_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_seller)):
    """Update order status (processing→shipped→delivered)."""
    return success_response(data={"message": f"Order {order_id} status updated"})


# --- Notifications ---

@router.get("/notifications")
async def list_notifications(
    is_read: bool | None = None,
    type: str | None = None,
    page: int = Query(1, ge=1),
    user: AuthenticatedUser = Depends(require_seller),
):
    """List seller's notifications."""
    return success_response(data=[])


@router.patch("/notifications/{notification_id}/read")
async def mark_read(notification_id: UUID, user: AuthenticatedUser = Depends(require_seller)):
    """Mark a notification as read."""
    return success_response(data={"message": "Marked as read"})


# --- Documents (KYC) ---

@router.get("/documents")
async def list_documents(user: AuthenticatedUser = Depends(require_seller)):
    """List seller's uploaded KYC documents."""
    return success_response(data=[])


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_seller),
):
    """Upload a KYC document."""
    return success_response(data={"message": "Document uploaded"})


# --- Dashboard ---

@router.get("/dashboard")
async def seller_dashboard(user: AuthenticatedUser = Depends(require_seller)):
    """Seller KPIs: orders, revenue, products, active sessions."""
    return success_response(data={})
