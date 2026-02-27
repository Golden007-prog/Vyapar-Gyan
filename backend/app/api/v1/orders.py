"""Order endpoints: create order, track order."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.auth import AuthenticatedUser, get_current_user
from app.schemas.common import success_response

router = APIRouter()


@router.post("")
async def create_order(body: dict, user: AuthenticatedUser = Depends(get_current_user)):
    """Create order with items. Validates stock, reserves inventory, notifies seller.

    Can be called by customers (web) or system (WhatsApp flow via service_role).
    """
    # TODO: Implement via order_service with transactional stock reservation
    return success_response(data={"message": "Order created"})


@router.get("/{order_number}/track")
async def track_order(order_number: str):
    """Track order by order_number. Public (phone-based verification in future)."""
    # TODO: Query orders by order_number, return status + items + timeline
    return success_response(data={})
