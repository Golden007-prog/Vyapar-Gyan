"""Application configuration loaded from environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """All configuration for VyaparGyan backend.

    Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY
    Optional: everything else has sane defaults for local dev.
    """

    # --- App ---
    app_name: str = "VyaparGyan"
    app_env: str = "development"
    app_debug: bool = False
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    log_level: str = "INFO"

    # --- Supabase (required) ---
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    supabase_anon_key: str

    # --- WhatsApp Cloud API (optional for initial boot) ---
    whatsapp_phone_number_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_verify_token: str = "vyapargyan_verify_token"
    whatsapp_app_secret: str = ""

    # --- Razorpay (optional for initial boot) ---
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
