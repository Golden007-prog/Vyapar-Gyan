# Part J — Suggested Next Coding Sequence

## Sprint 1 (Days 1–3): Foundation + Auth

| #   | Task                                        | Est | Output                                            |
| --- | ------------------------------------------- | --- | ------------------------------------------------- |
| 1   | FastAPI scaffold + config + health endpoint | 2h  | `app/main.py`, `app/core/config.py`               |
| 2   | Supabase client integration                 | 1h  | `app/integrations/supabase_client.py`             |
| 3   | Redis client setup                          | 1h  | `app/core/config.py` additions                    |
| 4   | Exception handlers + response format        | 1h  | `app/core/exceptions.py`, `app/schemas/common.py` |
| 5   | Structured logging                          | 1h  | `app/core/logging.py`                             |
| 6   | JWT verification middleware                 | 2h  | `app/core/auth.py`                                |
| 7   | RBAC dependencies                           | 2h  | `app/core/rbac.py`                                |
| 8   | Auth endpoints (login/refresh/me/logout)    | 2h  | `app/api/v1/auth.py`                              |
| 9   | Docker Compose (FastAPI + Redis)            | 1h  | `docker-compose.yml`, `Dockerfile`                |

## Sprint 2 (Days 4–6): Core APIs

| #   | Task                       | Est | Output                                                     |
| --- | -------------------------- | --- | ---------------------------------------------------------- |
| 10  | Category CRUD (admin)      | 2h  | `app/api/v1/admin.py`, `app/services/catalog_service.py`   |
| 11  | Product CRUD (seller)      | 3h  | `app/api/v1/seller.py`, `app/services/seller_service.py`   |
| 12  | Product image upload       | 2h  | Supabase Storage integration                               |
| 13  | Inventory management       | 2h  | `app/services/order_service.py`                            |
| 14  | Catalog browse (public)    | 2h  | `app/api/v1/catalog.py`, `app/services/catalog_service.py` |
| 15  | Seller profile + documents | 2h  | `app/api/v1/seller.py` additions                           |

## Sprint 3 (Days 7–9): Orders + Payments

| #   | Task                                    | Est | Output                                                                   |
| --- | --------------------------------------- | --- | ------------------------------------------------------------------------ |
| 16  | Order creation with stock reservation   | 4h  | `app/services/order_service.py`                                          |
| 17  | Seller order accept/reject              | 2h  | `app/api/v1/seller.py` additions                                         |
| 18  | Razorpay client + payment link creation | 3h  | `app/integrations/razorpay_client.py`, `app/services/payment_service.py` |
| 19  | Razorpay webhook handler                | 3h  | `app/api/v1/payments.py`                                                 |
| 20  | Order status lifecycle                  | 2h  | `app/services/order_service.py` additions                                |

## Sprint 4 (Days 10–12): WhatsApp

| #   | Task                                               | Est | Output                                |
| --- | -------------------------------------------------- | --- | ------------------------------------- |
| 21  | WhatsApp webhook receiver + signature verification | 2h  | `app/api/v1/whatsapp.py`              |
| 22  | WhatsApp Cloud API client (send messages)          | 2h  | `app/integrations/whatsapp_client.py` |
| 23  | Session engine + state machine                     | 4h  | `app/services/whatsapp_service.py`    |
| 24  | Message handlers (browsing, ordering, payment)     | 4h  | `app/services/whatsapp_service.py`    |
| 25  | Session cleanup worker                             | 1h  | `app/workers/session_cleanup.py`      |

## Sprint 5 (Days 13–14): Polish

| #   | Task                                  | Est | Output                                 |
| --- | ------------------------------------- | --- | -------------------------------------- |
| 26  | Notification service                  | 2h  | `app/services/notification_service.py` |
| 27  | Admin analytics APIs (existing views) | 2h  | `app/api/v1/admin.py` additions        |
| 28  | Seller dashboard APIs                 | 2h  | `app/api/v1/seller.py` additions       |
| 29  | Audit trail integration               | 2h  | All services                           |
| 30  | Rate limiting + security hardening    | 2h  | Middleware                             |

## Critical Path

```
Auth (1-8) → Products (10-13) → Orders (16-20) → WhatsApp (21-25)
                                      ↓
                              Payments (18-19) ← depends on Razorpay API keys
```

**Blocking external dependencies**:

- Supabase project URL + service_role key
- Razorpay API key + secret + webhook secret
- Meta WhatsApp Business API access + phone number ID + verify token
- Supabase Storage bucket creation (product-images, seller-documents)
