"""Supabase client wrapper for server-side operations.

Uses the synchronous Supabase Python SDK. All DB calls are sync
but run inside FastAPI async endpoints via threadpool automatically.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import create_client, Client

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("supabase")


@lru_cache
def get_supabase_admin_client() -> Client:
    """Supabase client with service_role key — bypasses RLS.

    Use for: webhook processing, background jobs, admin queries, seed scripts.
    """
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    logger.info("supabase_admin_client_initialized", url=settings.supabase_url)
    return client


@lru_cache
def get_supabase_anon_client() -> Client:
    """Supabase client with anon key — respects RLS.

    Use for: public catalog queries where RLS SELECT policies handle visibility.
    """
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    logger.info("supabase_anon_client_initialized")
    return client
