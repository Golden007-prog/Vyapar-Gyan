"""Webhook signature verification for WhatsApp and Razorpay."""

from __future__ import annotations

import hashlib
import hmac

from app.core.config import get_settings
from app.core.exceptions import WebhookVerificationError
from app.core.logging import get_logger

logger = get_logger("security")


def verify_whatsapp_signature(payload_body: bytes, signature_header: str) -> None:
    """Verify Meta WhatsApp webhook X-Hub-Signature-256.

    Raises WebhookVerificationError if signature does not match.
    If whatsapp_app_secret is empty (dev mode), verification is skipped with a warning.
    """
    settings = get_settings()

    if not settings.whatsapp_app_secret:
        logger.warning("whatsapp_signature_verification_skipped", reason="no app secret configured")
        return

    expected = hmac.new(
        settings.whatsapp_app_secret.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()

    received = signature_header.replace("sha256=", "") if signature_header else ""

    if not hmac.compare_digest(expected, received):
        raise WebhookVerificationError("whatsapp")


def verify_razorpay_signature(payload_body: bytes, signature_header: str) -> None:
    """Verify Razorpay webhook X-Razorpay-Signature."""
    settings = get_settings()

    if not settings.razorpay_webhook_secret:
        logger.warning("razorpay_signature_verification_skipped", reason="no webhook secret configured")
        return

    expected = hmac.new(
        settings.razorpay_webhook_secret.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature_header or ""):
        raise WebhookVerificationError("razorpay")
