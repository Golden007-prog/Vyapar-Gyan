"""Auth endpoints — login proxied to Supabase GoTrue, JWT verification, /me."""

from __future__ import annotations

from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.rbac import require_admin, require_seller, require_customer
from app.schemas.common import success_response
from app.integrations.supabase_client import get_supabase_admin_client
from app.core.logging import get_logger

logger = get_logger("auth_api")

router = APIRouter()


# --- Request schemas -------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


# --- Endpoints -------------------------------------------------------------

@router.post("/login")
async def login(body: LoginRequest):
    """Sign in via Supabase GoTrue — returns access + refresh tokens."""
    sb = get_supabase_admin_client()
    try:
        resp = sb.auth.sign_in_with_password({"email": body.email, "password": body.password})
        session = resp.session
        user = resp.user
        return success_response(data={
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_in": session.expires_in,
            "user": {
                "id": str(user.id),
                "email": user.email,
                "phone": user.phone,
            },
        })
    except Exception as e:
        logger.warning("login_failed", error=str(e))
        from app.core.exceptions import UnauthorizedError
        raise UnauthorizedError("Invalid email or password")


@router.post("/refresh")
async def refresh(body: RefreshRequest):
    """Refresh an access token."""
    sb = get_supabase_admin_client()
    try:
        resp = sb.auth.refresh_session(body.refresh_token)
        session = resp.session
        return success_response(data={
            "access_token": session.access_token,
            "refresh_token": session.refresh_token,
            "expires_in": session.expires_in,
        })
    except Exception as e:
        logger.warning("token_refresh_failed", error=str(e))
        from app.core.exceptions import UnauthorizedError
        raise UnauthorizedError("Invalid or expired refresh token")


@router.get("/me")
async def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    """Return the current user's profile, roles, and linked entity IDs."""
    return success_response(data=user.model_dump(mode="json"))


@router.post("/logout")
async def logout(user: AuthenticatedUser = Depends(get_current_user)):
    """Logout — client should discard tokens."""
    return success_response(data={"message": "Logged out — discard tokens on client"})


# --- RBAC test routes (protected) -----------------------------------------

@router.get("/test/admin")
async def test_admin(user: AuthenticatedUser = Depends(require_admin)):
    """Test: only admin can access."""
    return success_response(data={"message": "Admin access confirmed", "user_id": str(user.auth_user_id)})


@router.get("/test/seller")
async def test_seller(user: AuthenticatedUser = Depends(require_seller)):
    """Test: only seller can access."""
    return success_response(data={"message": "Seller access confirmed", "seller_id": str(user.seller_id)})


@router.get("/test/customer")
async def test_customer(user: AuthenticatedUser = Depends(require_customer)):
    """Test: only customer can access."""
    return success_response(data={"message": "Customer access confirmed", "customer_id": str(user.customer_id)})
