# Project Structure

## Repository Layout

```
├── backend/              # FastAPI application
│   ├── app/
│   │   ├── api/v1/      # API route handlers
│   │   ├── core/        # Core utilities (auth, config, logging, RBAC)
│   │   ├── integrations/# External service clients
│   │   ├── repositories/# Data access layer (future)
│   │   ├── schemas/     # Pydantic models for request/response
│   │   ├── services/    # Business logic layer
│   │   ├── scripts/     # Admin scripts (bootstrap, seeding)
│   │   ├── workers/     # Background workers (future)
│   │   └── main.py      # Application entry point
│   ├── requirements.txt
│   ├── Dockerfile
│   └── docker-compose.yml
├── docs/                # Design and architecture documentation
├── tools/mcp/           # MCP servers for platform data access
└── powers/              # Kiro power definitions
```

## Backend Application Structure

### `app/api/v1/`
API route handlers organized by domain:
- `auth.py` - Authentication endpoints (login, refresh, logout)
- `admin.py` - Admin operations (seller approval, categories, disputes)
- `seller.py` - Seller operations (products, inventory, orders)
- `catalog.py` - Public catalog browsing
- `orders.py` - Order creation and tracking
- `whatsapp.py` - WhatsApp webhook handling
- `payments.py` - Payment webhooks and status
- `router.py` - Aggregates all routers under `/api/v1`

### `app/core/`
Core framework utilities:
- `config.py` - Environment configuration with Pydantic settings
- `auth.py` - JWT verification and user context extraction
- `rbac.py` - Role-based access control dependencies
- `security.py` - Password hashing, token generation
- `exceptions.py` - Custom exceptions and error handlers
- `logging.py` - Structured logging setup with request IDs

### `app/integrations/`
External service clients:
- `supabase_client.py` - Supabase database, auth, and storage client
- `whatsapp_client.py` - WhatsApp Cloud API client
- `razorpay_client.py` - Razorpay payment gateway client

### `app/services/`
Business logic layer:
- `catalog_service.py` - Product and category operations
- `whatsapp_handler.py` - WhatsApp message processing logic
- `whatsapp_session.py` - Session state management

### `app/schemas/`
Pydantic models for validation:
- `common.py` - Shared response formats and base models
- Domain-specific schemas in respective modules

## Code Organization Patterns

### Layered Architecture

```
API Routes (app/api/v1/)
    ↓
Services (app/services/)
    ↓
Integrations (app/integrations/)
    ↓
External APIs (Supabase, WhatsApp, Razorpay)
```

### Dependency Injection

- Use FastAPI's `Depends()` for dependency injection
- Common dependencies in `app/core/rbac.py` (e.g., `require_admin`, `require_seller`)
- Settings injected via `get_settings()` from `app/core/config.py`

### Error Handling

- Custom exceptions in `app/core/exceptions.py`
- Global exception handlers registered in `app/main.py`
- Consistent error response format via `app/schemas/common.py`

### Logging

- Structured logging with `structlog`
- Request ID context propagation via `contextvars`
- Log all requests with method, path, status, elapsed time
- Use `get_logger(__name__)` in each module

## Naming Conventions

### Files and Modules
- Snake case: `catalog_service.py`, `whatsapp_client.py`
- Group related functionality in single files
- Use `__init__.py` for package exports

### Functions and Variables
- Snake case: `get_user_profile()`, `order_id`
- Async functions prefixed with `async def`
- Private functions prefixed with underscore: `_validate_signature()`

### Classes
- Pascal case: `AppError`, `OrderService`, `WhatsAppClient`
- Pydantic models: `UserProfile`, `OrderCreate`, `ProductResponse`

### Constants
- Upper snake case: `MAX_RETRIES`, `DEFAULT_TIMEOUT`
- Defined at module level or in config

## Import Organization

```python
# Standard library
from __future__ import annotations
import uuid
from datetime import datetime

# Third-party
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

# Local application
from app.core.auth import get_current_user
from app.core.rbac import require_seller
from app.services.catalog_service import CatalogService
```

## Documentation Standards

- Docstrings for all public functions and classes
- Type hints for all function parameters and return values
- API endpoint docstrings appear in Swagger UI
- Use `"""Triple quotes"""` for docstrings

## Testing (Future)

- Tests in `backend/tests/` mirroring `app/` structure
- Use `pytest` for test framework
- Fixtures for common test data
- Mock external services (Supabase, WhatsApp, Razorpay)
