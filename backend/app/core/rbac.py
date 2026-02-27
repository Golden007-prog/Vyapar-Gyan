"""Role-based access control dependencies for FastAPI."""

from __future__ import annotations

from uuid import UUID
from typing import Callable

from fastapi import Depends

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.exceptions import ForbiddenError


def require_roles(*required_roles: str) -> Callable:
    """Dependency factory: require user to have at least one of the specified roles."""

    async def dependency(
        user: AuthenticatedUser = Depends(get_current_user),
    ) -> AuthenticatedUser:
        if not any(role in user.roles for role in required_roles):
            raise ForbiddenError(
                f"Requires one of roles: {', '.join(required_roles)}"
            )
        return user

    return dependency


async def require_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """Require admin role."""
    if not user.is_admin:
        raise ForbiddenError("Admin access required")
    return user


async def require_seller(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """Require seller role and active seller profile."""
    if not user.is_seller or not user.seller_id:
        raise ForbiddenError("Seller access required")
    return user


async def require_customer(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """Require customer role and active customer profile."""
    if not user.is_customer or not user.customer_id:
        raise ForbiddenError("Customer access required")
    return user


def require_seller_owns(resource_type: str) -> Callable:
    """Dependency factory: verify seller owns the resource.

    Usage:
        @router.put("/products/{product_id}")
        async def update(product_id: UUID, user=Depends(require_seller_owns("product"))):
    """

    async def dependency(
        user: AuthenticatedUser = Depends(require_seller),
    ) -> AuthenticatedUser:
        # Ownership check is done at the service layer using user.seller_id
        # This dependency ensures the user is a seller
        # The actual resource ownership is validated in the repository/service
        return user

    return dependency


async def admin_or_seller(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """Allow admin or seller access."""
    if not user.is_admin and not user.is_seller:
        raise ForbiddenError("Admin or seller access required")
    return user
