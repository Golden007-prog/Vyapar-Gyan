"""WhatsApp Cloud API integration client."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("whatsapp")

WA_API_BASE = "https://graph.facebook.com/v21.0"


class WhatsAppClient:
    """Sends messages via Meta WhatsApp Cloud API."""

    def __init__(self):
        settings = get_settings()
        self._phone_number_id = settings.whatsapp_phone_number_id
        self._access_token = settings.whatsapp_access_token
        self._base_url = f"{WA_API_BASE}/{self._phone_number_id}/messages"
        self._headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }

    async def send_text(self, to: str, body: str) -> dict:
        """Send a plain text message."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": body},
        }
        return await self._send(payload)

    async def send_template(
        self, to: str, template_name: str, language: str = "en", components: list | None = None
    ) -> dict:
        """Send a template message."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                "components": components or [],
            },
        }
        return await self._send(payload)

    async def send_interactive_list(
        self, to: str, header: str, body: str, button_text: str, sections: list[dict]
    ) -> dict:
        """Send an interactive list message (for product browsing)."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "header": {"type": "text", "text": header},
                "body": {"text": body},
                "action": {"button": button_text, "sections": sections},
            },
        }
        return await self._send(payload)

    async def send_interactive_buttons(
        self, to: str, body: str, buttons: list[dict]
    ) -> dict:
        """Send interactive reply buttons (max 3)."""
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": body},
                "action": {"buttons": buttons[:3]},
            },
        }
        return await self._send(payload)

    async def _send(self, payload: dict) -> dict:
        """Send message via WhatsApp Cloud API."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    self._base_url,
                    json=payload,
                    headers=self._headers,
                    timeout=30.0,
                )
                resp.raise_for_status()
                result = resp.json()
                logger.info(
                    "whatsapp_message_sent",
                    to=payload.get("to"),
                    type=payload.get("type"),
                    wa_message_id=result.get("messages", [{}])[0].get("id"),
                )
                return result
            except httpx.HTTPStatusError as e:
                logger.error("whatsapp_send_failed", status=e.response.status_code, body=e.response.text)
                raise
            except Exception as e:
                logger.error("whatsapp_send_error", error=str(e))
                raise


_client: WhatsAppClient | None = None


def get_whatsapp_client() -> WhatsAppClient:
    global _client
    if _client is None:
        _client = WhatsAppClient()
    return _client
