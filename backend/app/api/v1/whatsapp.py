"""WhatsApp webhook — verification, inbound message processing, status updates.

Full pipeline: verify → parse → dedupe → session → handle → respond → persist.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Query, Response

from app.core.security import verify_whatsapp_signature
from app.core.logging import get_logger
from app.services.whatsapp_session import (
    find_or_create_customer,
    get_or_create_session,
    store_message,
    update_message_status,
)
from app.services.whatsapp_handler import handle_message
from app.integrations.whatsapp_client import get_whatsapp_client
from app.core.config import get_settings

logger = get_logger("whatsapp_webhook")

router = APIRouter()


@router.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    """Meta WhatsApp webhook verification challenge."""
    settings = get_settings()
    if hub_mode == "subscribe" and hub_verify_token == settings.whatsapp_verify_token:
        logger.info("whatsapp_webhook_verified")
        return Response(content=hub_challenge, media_type="text/plain")

    logger.warning("whatsapp_webhook_verification_failed", mode=hub_mode)
    return Response(content="Forbidden", status_code=403)


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Receive inbound WhatsApp messages and status updates.

    Always returns 200 OK per Meta requirements — even on errors.
    """
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")

    # 1. Verify signature
    try:
        verify_whatsapp_signature(body, signature)
    except Exception:
        logger.warning("whatsapp_invalid_signature")
        return Response(content="OK", status_code=200)

    payload = await request.json()

    # 2. Parse and route
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})

            # Messages
            for msg in value.get("messages", []):
                contacts = value.get("contacts", [])
                profile_name = contacts[0].get("profile", {}).get("name") if contacts else None
                try:
                    await _process_inbound_message(msg, profile_name)
                except Exception as e:
                    logger.error("inbound_processing_failed", error=str(e), wa_id=msg.get("id"))

            # Status updates
            for status in value.get("statuses", []):
                _process_status_update(status)

    return Response(content="OK", status_code=200)


async def _process_inbound_message(message: dict, profile_name: str | None) -> None:
    """Full inbound pipeline: customer → session → persist → handle → respond → persist."""
    wa_message_id = message.get("id")
    from_phone = message.get("from", "")
    msg_type = message.get("type", "text")

    # Extract text content
    if msg_type == "text":
        text = message.get("text", {}).get("body", "")
    elif msg_type == "interactive":
        interactive = message.get("interactive", {})
        itype = interactive.get("type", "")
        if itype == "list_reply":
            text = interactive.get("list_reply", {}).get("title", "")
        elif itype == "button_reply":
            text = interactive.get("button_reply", {}).get("title", "")
        else:
            text = ""
    elif msg_type == "button":
        text = message.get("button", {}).get("text", "")
    else:
        text = f"[{msg_type} message]"

    logger.info("processing_inbound", wa_message_id=wa_message_id, phone=from_phone, type=msg_type, text_preview=text[:50])

    # 1. Find or create customer
    customer = find_or_create_customer(from_phone, from_phone, profile_name)

    # 2. Get or create session
    session = get_or_create_session(customer["id"], from_phone)

    # 3. Store inbound message
    store_message(
        session_id=session["id"],
        direction="inbound",
        message_type=msg_type,
        content=text,
        wa_message_id=wa_message_id,
    )

    # 4. Handle message → get response
    response = handle_message(session, text, customer)

    # 5. Send response via WhatsApp Cloud API
    wa_client = get_whatsapp_client()
    send_result = None
    try:
        if response.get("type") == "text":
            send_result = await wa_client.send_text(from_phone, response["body"])
        # Future: handle interactive list, buttons, etc.
    except Exception as e:
        logger.error("whatsapp_send_failed", error=str(e), phone=from_phone)
        send_result = None

    # 6. Store outbound message
    outbound_wa_id = None
    if send_result and send_result.get("messages"):
        outbound_wa_id = send_result["messages"][0].get("id")

    store_message(
        session_id=session["id"],
        direction="outbound",
        message_type=response.get("type", "text"),
        content=response.get("body", ""),
        wa_message_id=outbound_wa_id,
        wa_status="sent" if send_result else "failed",
    )


def _process_status_update(status: dict) -> None:
    """Update message delivery status (sent → delivered → read)."""
    wa_message_id = status.get("id")
    new_status = status.get("status", "")

    if wa_message_id and new_status:
        update_message_status(wa_message_id, new_status)
        logger.info("status_updated", wa_message_id=wa_message_id, status=new_status)
