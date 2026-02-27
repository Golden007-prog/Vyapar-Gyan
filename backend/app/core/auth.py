"""Supabase JWT verification and user context loading.

The Supabase Python SDK is synchronous. We call it from async endpoints;
FastAPI runs sync callables in a threadpool automatically when called from
async deps. We keep load_user_context as a plain sync function.
"""

from __future__ import annotations

from uuid import UUID
from typing import Optional

from fastapi import Header
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import get_settings, Settings
from app.core.exceptions import UnauthorizedError, ForbiddenError
from app.core.logging import get_logger
from app.integrations.supabase_client import get_supabase_admin_client

logger = get_logger("auth")


class AuthenticatedUser(BaseModel):
    auth_user_id: UUID
    profile_id: Optional[UUID] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    display_name: Optional[str] = None
    roles: list[str] = []
    seller_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    is_active: bool = True

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    @property
    def is_seller(self) -> bool:
        return "seller" in self.roles

    @property
    def is_customer(self) -> bool:
        return "customer" in self.roles


def verify_supabase_jwt(token: str, settings: Settings) -> dict:
    """Decode and verify a Supabase-issued JWT (HS256, aud=authenticated)."""
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload
    except JWTError as e:
        logger.warning("jwt_verification_failed", error=str(e))
        raise UnauthorizedError("Invalid or expired token")


def load_user_context(auth_user_id: str) -> AuthenticatedUser:
    """Load full user context from Supabase (sync, uses service_role).

    Queries: user_profiles → user_roles+roles → sellers → customers.
    """
    sb = get_supabase_admin_client()

    # 1. Profile
    profile_resp = (
        sb.table("user_profiles")
        .select("*")
        .eq("auth_user_id", auth_user_id)
        .execute()
    )
    profiles = profile_resp.data or []
    if not profiles:
        raise UnauthorizedError("User profile not found")
    profile = profiles[0]

    if profile.get("deleted_at"):
        raise UnauthorizedError("User profile deactivated")
    if not profile.get("is_active", True):
        raise ForbiddenError("Account is deactivated")

    # 2. Roles via join
    roles_resp = (
        sb.table("user_roles")
        .select("roles(name)")
        .eq("user_profile_id", profile["id"])
        .execute()
    )
    roles: list[str] = []
    for r in roles_resp.data or []:
        role_data = r.get("roles")
        if role_data and isinstance(role_data, dict):
            roles.append(role_data["name"])

    # 3. Seller ID
    seller_id = None
    if "seller" in roles:
        seller_resp = (
            sb.table("sellers")
            .select("id")
            .eq("auth_user_id", auth_user_id)
            .is_("deleted_at", "null")
            .execute()
        )
        sellers = seller_resp.data or []
        if sellers:
            seller_id = sellers[0]["id"]

    # 4. Customer ID
    customer_id = None
    if "customer" in roles:
        customer_resp = (
            sb.table("customers")
            .select("id")
            .eq("auth_user_id", auth_user_id)
            .is_("deleted_at", "null")
            .execute()
        )
        customers = customer_resp.data or []
        if customers:
            customer_id = customers[0]["id"]

    user = AuthenticatedUser(
        auth_user_id=UUID(auth_user_id),
        profile_id=UUID(profile["id"]),
        email=profile.get("email"),
        phone=profile.get("phone"),
        display_name=profile.get("display_name"),
        roles=roles,
        seller_id=UUID(seller_id) if seller_id else None,
        customer_id=UUID(customer_id) if customer_id else None,
        is_active=profile.get("is_active", True),
    )
    logger.info("user_context_loaded", user_id=auth_user_id, roles=roles)
    return user


async def get_current_user(
    authorization: str = Header(..., alias="Authorization"),
) -> AuthenticatedUser:
    """FastAPI dependency — verify JWT and load user context."""
    if not authorization.startswith("Bearer "):
        raise UnauthorizedError("Invalid authorization header format")

    token = authorization[7:]
    settings = get_settings()
    payload = verify_supabase_jwt(token, settings)

    auth_user_id = payload.get("sub")
    if not auth_user_id:
        raise UnauthorizedError("Token missing subject claim")

    return load_user_context(auth_user_id)
