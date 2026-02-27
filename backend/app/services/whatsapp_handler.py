"""WhatsApp message handler — deterministic intent routing and response generation.

Extensible: each state handler is a plain function that returns a response dict.
AI/Gemini integration can be plugged in later by replacing/extending these handlers.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.whatsapp_session import (
    update_session_state,
    store_message,
)
from app.services.catalog_service import list_categories, list_products
from app.integrations.supabase_client import get_supabase_admin_client
from app.core.logging import get_logger

logger = get_logger("wa_handler")

# --- Intent detection (deterministic rules) --------------------------------

GREETING_PATTERNS = re.compile(
    r"^(hi|hello|hey|namaste|namaskar|hola|start|menu|help|shuru|mdd)\b",
    re.IGNORECASE,
)
BROWSE_PATTERNS = re.compile(
    r"(browse|shop|products?|catalog|dekh|dikhao|kya hai|show|buy|kharid|category|categories)",
    re.IGNORECASE,
)
TRACK_PATTERNS = re.compile(
    r"(track|order\s*status|where.*(is|my).*order|VG-\d{8}-\d{4}|mera\s*order|status)",
    re.IGNORECASE,
)
ORDER_NUMBER_RE = re.compile(r"(VG-\d{8}-\d{4})", re.IGNORECASE)


def detect_intent(text: str) -> str:
    """Simple rule-based intent detection. Returns intent string."""
    text = text.strip()
    if GREETING_PATTERNS.match(text):
        return "greeting"
    if TRACK_PATTERNS.search(text):
        return "track_order"
    if BROWSE_PATTERNS.search(text):
        return "browse"
    return "unknown"


# --- Handlers per state/intent --------------------------------------------

def handle_greeting(session: dict, text: str, customer: dict) -> dict:
    """Welcome the customer and show main menu."""
    name = customer.get("name", "").split()[0] or "there"
    update_session_state(session["id"], "browsing")
    return {
        "type": "text",
        "body": (
            f"🙏 Namaste {name}! Welcome to VyaparGyan.\n\n"
            "I can help you with:\n"
            "1️⃣ *Browse products* — type 'shop'\n"
            "2️⃣ *Track your order* — type 'track' or send your order number\n"
            "3️⃣ *Help / Support* — type 'help'\n\n"
            "What would you like to do?"
        ),
    }


def handle_browse(session: dict, text: str, customer: dict) -> dict:
    """Show available categories as a list."""
    categories = list_categories()
    if not categories:
        return {"type": "text", "body": "No categories available right now. Please check back later! 🙏"}

    lines = ["📦 *Product Categories*\n"]
    for i, cat in enumerate(categories, 1):
        child_count = len(cat.get("children", []))
        suffix = f" ({child_count} sub-categories)" if child_count else ""
        lines.append(f"{i}. {cat['name']}{suffix}")

    lines.append("\n👉 Send a category name to see products.")
    lines.append("👉 Or type a product name to search directly.")

    update_session_state(session["id"], "browsing")
    return {"type": "text", "body": "\n".join(lines)}


def handle_category_or_search(session: dict, text: str, customer: dict) -> dict:
    """User typed a category name or product search term — show matching products."""
    # Try matching a category
    categories = list_categories()
    matched_cat = None
    for cat in categories:
        if text.lower().strip() == cat["name"].lower():
            matched_cat = cat
            break
        for child in cat.get("children", []):
            if text.lower().strip() == child["name"].lower():
                matched_cat = child
                break

    if matched_cat:
        products, total = list_products(category_id=matched_cat["id"], per_page=5)
    else:
        # Treat as product search
        products, total = list_products(search=text.strip(), per_page=5)

    if not products:
        return {
            "type": "text",
            "body": f"No products found for '{text}'. Try 'shop' to see all categories.",
        }

    lines = [f"🛍️ *Products* ({total} found)\n"]
    for p in products:
        price = p.get("base_ask_price", 0)
        stock = p.get("available_stock", 0)
        stock_label = "✅ In Stock" if stock > 0 else "❌ Out of Stock"
        lines.append(f"• *{p['name']}* — ₹{price:.0f}\n  {stock_label} | {p.get('seller_name', 'N/A')}")

    if total > 5:
        lines.append(f"\n...and {total - 5} more. Refine your search!")

    lines.append("\n👉 Send a product name for details.")
    return {"type": "text", "body": "\n".join(lines)}


def handle_track_order(session: dict, text: str, customer: dict) -> dict:
    """Look up order by order number."""
    match = ORDER_NUMBER_RE.search(text)
    if not match:
        return {
            "type": "text",
            "body": "📋 Please send your order number (e.g. VG-20260228-0001) to track your order.",
        }

    order_number = match.group(1).upper()
    sb = get_supabase_admin_client()
    resp = (
        sb.table("orders")
        .select("id, order_number, status, total_amount, created_at, sellers(business_name)")
        .eq("order_number", order_number)
        .execute()
    )
    orders = resp.data or []

    if not orders:
        return {
            "type": "text",
            "body": f"❌ Order *{order_number}* not found. Please check the number and try again.",
        }

    order = orders[0]
    status_emoji = {
        "pending": "⏳",
        "confirmed": "✅",
        "processing": "📦",
        "shipped": "🚚",
        "delivered": "🎉",
        "cancelled": "❌",
        "refunded": "💰",
    }
    emoji = status_emoji.get(order["status"], "📋")
    seller = order.get("sellers", {})
    seller_name = seller.get("business_name", "N/A") if seller else "N/A"

    return {
        "type": "text",
        "body": (
            f"📋 *Order {order_number}*\n\n"
            f"Status: {emoji} *{order['status'].upper()}*\n"
            f"Amount: ₹{order.get('total_amount', 0):.0f}\n"
            f"Seller: {seller_name}\n"
            f"Placed: {order.get('created_at', 'N/A')[:10]}\n\n"
            "Need help? Type 'help'"
        ),
    }


def handle_unknown(session: dict, text: str, customer: dict) -> dict:
    """Fallback — try to treat as category/product search, then show help."""
    # Try product/category search first
    products, total = list_products(search=text.strip(), per_page=3)
    if products:
        return handle_category_or_search(session, text, customer)

    return {
        "type": "text",
        "body": (
            "🤔 I didn't understand that. Here's what I can help with:\n\n"
            "• Type *'shop'* to browse products\n"
            "• Type *'track'* + your order number to check status\n"
            "• Type *'hi'* to start over\n"
            "• Type a product name to search"
        ),
    }


# --- Main dispatcher -------------------------------------------------------

def handle_message(session: dict, text: str, customer: dict) -> dict:
    """Route message to the correct handler based on intent and session state.

    Returns a dict with 'type' and 'body' (or 'sections' for interactive list).
    """
    intent = detect_intent(text)
    state = session.get("session_state", "greeting")

    logger.info("handling_message", intent=intent, state=state, text_preview=text[:50])

    if intent == "greeting":
        return handle_greeting(session, text, customer)
    elif intent == "track_order":
        return handle_track_order(session, text, customer)
    elif intent == "browse":
        return handle_browse(session, text, customer)
    else:
        # In browsing state, treat unknown text as category/product search
        if state == "browsing":
            return handle_category_or_search(session, text, customer)
        return handle_unknown(session, text, customer)
