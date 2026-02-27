"""API v1 router — aggregates all sub-routers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, admin, seller, catalog, orders, whatsapp, payments

api_v1_router = APIRouter(prefix="/api/v1")

# Health sub-route at /api/v1/health
@api_v1_router.get("/health", tags=["Health"])
async def api_health():
    """API v1 health check."""
    return {"status": "healthy", "api_version": "v1"}

api_v1_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_v1_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_v1_router.include_router(seller.router, prefix="/seller", tags=["Seller"])
api_v1_router.include_router(catalog.router, prefix="/catalog", tags=["Catalog"])
api_v1_router.include_router(orders.router, prefix="/orders", tags=["Orders"])
api_v1_router.include_router(whatsapp.router, prefix="/whatsapp", tags=["WhatsApp"])
api_v1_router.include_router(payments.router, prefix="/payments", tags=["Payments"])
