"""Razorpay integration client for payment link creation and webhook handling."""

from __future__ import annotations

from typing import Any

import razorpay

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.exceptions import PaymentError

logger = get_logger("razorpay")


class RazorpayClient:
    """Wrapper around the Razorpay Python SDK."""

    def __init__(self):
        settings = get_settings()
        self._client = razorpay.Client(
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret)
        )
        logger.info("razorpay_client_initialized")

    def create_payment_link(
        self,
        amount_paise: int,
        currency: str,
        description: str,
        customer_phone: str,
        order_id: str,
        callback_url: str,
    ) -> dict[str, Any]:
        """Create a Razorpay payment link.

        Args:
            amount_paise: Amount in paise (INR * 100)
            currency: Currency code (INR)
            description: Payment description
            customer_phone: Customer phone for notifications
            order_id: Internal order ID for reference
            callback_url: URL to redirect after payment

        Returns:
            Dict with payment_link_id, short_url, etc.
        """
        try:
            payload = {
                "amount": amount_paise,
                "currency": currency,
                "description": description,
                "customer": {
                    "contact": customer_phone,
                },
                "notify": {"sms": False, "email": False},
                "callback_url": callback_url,
                "callback_method": "get",
                "reference_id": order_id,
            }

            result = self._client.payment_link.create(payload)
            logger.info(
                "payment_link_created",
                payment_link_id=result.get("id"),
                order_id=order_id,
                amount=amount_paise,
            )
            return result

        except Exception as e:
            logger.error("payment_link_creation_failed", error=str(e), order_id=order_id)
            raise PaymentError(
                message="Failed to create payment link",
                details={"order_id": order_id, "error": str(e)},
            )

    def verify_payment_signature(self, params: dict) -> bool:
        """Verify Razorpay payment signature after checkout.

        Args:
            params: Dict with razorpay_order_id, razorpay_payment_id, razorpay_signature
        """
        try:
            self._client.utility.verify_payment_signature(params)
            return True
        except razorpay.errors.SignatureVerificationError:
            return False

    def fetch_payment(self, payment_id: str) -> dict:
        """Fetch payment details from Razorpay."""
        return self._client.payment.fetch(payment_id)

    def create_refund(self, payment_id: str, amount_paise: int) -> dict:
        """Create a refund for a payment."""
        try:
            return self._client.payment.refund(payment_id, amount_paise)
        except Exception as e:
            logger.error("refund_failed", payment_id=payment_id, error=str(e))
            raise PaymentError(
                message="Refund failed",
                details={"payment_id": payment_id, "error": str(e)},
            )


_client: RazorpayClient | None = None


def get_razorpay_client() -> RazorpayClient:
    global _client
    if _client is None:
        _client = RazorpayClient()
    return _client
