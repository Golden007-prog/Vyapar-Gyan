"""Admin endpoints: seller management, categories, analytics, disputes."""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Depends, Query

from app.core.auth import AuthenticatedUser
from app.core.rbac import require_admin
from app.schemas.common import success_response

router = APIRouter()


# --- Seller Management ---

@router.get("/sellers")
async def list_sellers(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: AuthenticatedUser = Depends(require_admin),
):
    """List all sellers with optional status filter."""
    # TODO: Implement via seller_service
    return success_response(data=[])


@router.patch("/sellers/{seller_id}/approve")
async def approve_seller(seller_id: UUID, user: AuthenticatedUser = Depends(require_admin)):
    """Approve a pending seller. Sets status=active, is_verified=true, creates seller role."""
    # TODO: Implement via seller_service + notification_service + audit_service
    return success_response(data={"message": f"Seller {seller_id} approved"})


@router.patch("/sellers/{seller_id}/reject")
async def reject_seller(seller_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_admin)):
    """Reject a pending seller with reason."""
    return success_response(data={"message": f"Seller {seller_id} rejected"})


@router.patch("/sellers/{seller_id}/suspend")
async def suspend_seller(seller_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_admin)):
    """Suspend an active seller with reason."""
    return success_response(data={"message": f"Seller {seller_id} suspended"})


# --- Category CRUD ---

@router.get("/categories")
async def list_categories(user: AuthenticatedUser = Depends(require_admin)):
    """List all categories (including inactive) for admin."""
    return success_response(data=[])


@router.post("/categories")
async def create_category(body: dict, user: AuthenticatedUser = Depends(require_admin)):
    """Create a new category."""
    return success_response(data={"message": "Category created"})


@router.put("/categories/{category_id}")
async def update_category(category_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_admin)):
    """Update a category."""
    return success_response(data={"message": f"Category {category_id} updated"})


@router.delete("/categories/{category_id}")
async def delete_category(category_id: UUID, user: AuthenticatedUser = Depends(require_admin)):
    """Soft-delete a category. Fails if products reference it."""
    return success_response(data={"message": f"Category {category_id} deleted"})


# --- Analytics (from existing views) ---

@router.get("/dashboard")
async def admin_dashboard(user: AuthenticatedUser = Depends(require_admin)):
    """Platform KPIs from v_admin_dashboard view."""
    return success_response(data={})


@router.get("/gmv")
async def admin_gmv(user: AuthenticatedUser = Depends(require_admin)):
    """Daily GMV from v_admin_gmv view."""
    return success_response(data=[])


@router.get("/sellers/performance")
async def seller_performance(user: AuthenticatedUser = Depends(require_admin)):
    """Seller performance from v_admin_seller_performance view."""
    return success_response(data=[])


@router.get("/products/top")
async def top_products(user: AuthenticatedUser = Depends(require_admin)):
    """Top products from v_admin_top_products view."""
    return success_response(data=[])


@router.get("/products/low-stock")
async def low_stock(user: AuthenticatedUser = Depends(require_admin)):
    """Low stock products from v_admin_low_stock view."""
    return success_response(data=[])


@router.get("/payments/stats")
async def payment_stats(user: AuthenticatedUser = Depends(require_admin)):
    """Payment statistics from v_admin_payment_stats view."""
    return success_response(data=[])


@router.get("/disputes/summary")
async def disputes_summary(user: AuthenticatedUser = Depends(require_admin)):
    """Dispute summary from v_admin_dispute_summary view."""
    return success_response(data=[])


# --- Dispute Management ---

@router.get("/disputes")
async def list_disputes(
    status: str | None = None,
    page: int = Query(1, ge=1),
    user: AuthenticatedUser = Depends(require_admin),
):
    """List all disputes with optional filters."""
    return success_response(data=[])


@router.patch("/disputes/{dispute_id}")
async def update_dispute(dispute_id: UUID, body: dict, user: AuthenticatedUser = Depends(require_admin)):
    """Update dispute status/resolution."""
    return success_response(data={"message": f"Dispute {dispute_id} updated"})
