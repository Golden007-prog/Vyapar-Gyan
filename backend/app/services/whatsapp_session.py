"""WhatsApp session manager — upserts sessions and customers in Supabase."""

from __future__ import annotations

from typing import Any
from datetime import datetime, timezone

from app.integrations.supabase_client import get_supabase_admin_client
from app.core.logging import get_logger

logger = get_logger("wa_session")


def find_or_create_customer(phone: str, wa_id: str, profile_name: str | None = None) -> dict:
    """Find existing customer by phone or create a new one.

    Returns the customer record dict.
    """
    sb = get_supabase_admin_client()

    # Try to find by phone
    resp = sb.table("customers").select("*").eq("phone_number", phone).execute()
    customers = resp.data or []

    if customers:
        customer = customers[0]
        # Update whatsapp_verified if not already
        if not customer.get("whatsapp_verified"):
            sb.table("customers").update({
                "whatsapp_verified": True,
                "whatsapp_id": wa_id,
            }).eq("id", customer["id"]).execute()
            customer["whatsapp_verified"] = True
        logger.info("customer_found", customer_id=customer["id"], phone=phone)
        return customer

    # Create new customer
    new_customer = {
        "phone_number": phone,
        "whatsapp_id": wa_id,
        "name": profile_name or f"Customer {phone[-4:]}",
        "whatsapp_verified": True,
    }
    resp = sb.table("customers").insert(new_customer).execute()
    customer = resp.data[0]
    logger.info("customer_created", customer_id=customer["id"], phone=phone)
    return customer


def get_or_create_session(customer_id: str, phone: str) -> dict:
    """Find active session for customer or create a new one.

    Active = session_state NOT 'closed' AND updated within 24h.
    Returns the session record dict.
    """
    sb = get_supabase_admin_client()

    # Find most recent non-closed session
    resp = (
        sb.table("whatsapp_sessions")
        .select("*")
        .eq("customer_id", customer_id)
        .neq("session_state", "closed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    sessions = resp.data or []

    if sessions:
        session = sessions[0]
        # Check if session is still within 24h window
        updated_str = session.get("updated_at") or session.get("created_at")
        if updated_str:
            try:
                updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                age_hours = (now - updated_at).total_seconds() / 3600
                if age_hours > 24:
                    # Expire old session
                    sb.table("whatsapp_sessions").update({
                        "session_state": "closed",
                    }).eq("id", session["id"]).execute()
                    logger.info("session_expired", session_id=session["id"], age_hours=round(age_hours, 1))
                else:
                    # Touch and reuse
                    sb.table("whatsapp_sessions").update({
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", session["id"]).execute()
                    logger.info("session_resumed", session_id=session["id"], state=session["session_state"])
                    return session
            except (ValueError, TypeError):
                pass

    # Create new session
    new_session = {
        "customer_id": customer_id,
        "phone_number": phone,
        "session_state": "greeting",
        "conversation_state": {},
    }
    resp = sb.table("whatsapp_sessions").insert(new_session).execute()
    session = resp.data[0]
    logger.info("session_created", session_id=session["id"], phone=phone)
    return session


def update_session_state(session_id: str, new_state: str, conversation_state: dict | None = None) -> None:
    """Update session state and optionally the conversation_state JSONB."""
    sb = get_supabase_admin_client()
    update: dict[str, Any] = {
        "session_state": new_state,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if conversation_state is not None:
        update["conversation_state"] = conversation_state
    sb.table("whatsapp_sessions").update(update).eq("id", session_id).execute()
    logger.info("session_state_updated", session_id=session_id, new_state=new_state)


def store_message(
    session_id: str,
    direction: str,
    message_type: str,
    content: str | dict,
    wa_message_id: str | None = None,
    wa_status: str | None = None,
) -> dict:
    """Insert a message into whatsapp_messages."""
    sb = get_supabase_admin_client()
    message = {
        "session_id": session_id,
        "direction": direction,
        "message_type": message_type,
        "content": content if isinstance(content, str) else str(content),
        "wa_message_id": wa_message_id,
        "wa_status": wa_status or ("received" if direction == "inbound" else "sent"),
    }
    resp = sb.table("whatsapp_messages").insert(message).execute()
    record = resp.data[0]
    logger.info(
        "message_stored",
        message_id=record["id"],
        session_id=session_id,
        direction=direction,
    )
    return record


def update_message_status(wa_message_id: str, new_status: str) -> None:
    """Update wa_status on a message by its wa_message_id."""
    sb = get_supabase_admin_client()
    sb.table("whatsapp_messages").update({
        "wa_status": new_status,
    }).eq("wa_message_id", wa_message_id).execute()
