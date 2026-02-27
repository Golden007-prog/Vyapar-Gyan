"""Payment endpoints: create link, webhook, status."""

from __future__ import annotations

from uuid import UUID
from fastapi import APIRouter, Request, Depends, Response

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.security import verify_razorpay_signature
from app.core.logging import get_logger
from app.schemas.common import success_response

logger = get_logger("payments")

router = APIRouter()


@router.post("/create-link")
async def create_payment_link(body: dict, user: AuthenticatedUser = Depends(get_current_user)):
    """Create a Razorpay payment link for an order.

    Request: { "order_id": "uuid" }
    Returns: { "payment_link_url": "...", "payment_link_id": "..." }
    """
    # TODO: Implement via payment_service
    # 1. Validate order exists and belongs to user
    # 2. Check no existing payment for order
    # 3. Create Razorpay payment link
    # 4. Store in payments table
    # 5. Return link URL
    return success_response(data={"message": "Payment link creation — implement via payment_service"})


@router.post("/webhook")
async def payment_webhook(request: Request):
    """Razorpay webhook for payment status updates.

    NO JWT auth — uses Razorpay signature verification.
    Always returns 200 to acknowledge receipt.
    """
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    try:
        verify_razorpay_signature(body, signature)
    except Exception:
        logger.warning("razorpay_invalid_signature")
        return Response(content="Invalid signature", status_code=401)

    payload = await request.json()
    event = payload.get("event", "")

    logger.info("razorpay_webhook", event=event, event_id=payload.get("event_id"))

    # TODO: Implement event handling
    # payment_link.paid → update payment + order + stock
    # payment.captured → same (backup)
    # payment.failed → update payment status
    # refund.processed → update payment + order

    return Response(content="OK", status_code=200)


@router.get("/{order_id}/status")
async def payment_status(order_id: UUID, user: AuthenticatedUser = Depends(get_current_user)):
    """Get payment status for an order."""
    # TODO: Query payments by order_id, verify user has access
    return success_response(data={})
