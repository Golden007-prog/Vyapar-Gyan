# Part H — Auth & RBAC Implementation Design

## JWT Verification Flow

```
Request with Authorization: Bearer <supabase_jwt>
    │
    ├─ 1. Extract token from header
    ├─ 2. Decode JWT using Supabase JWT secret (HS256)
    │      - Verify exp, iss, aud claims
    │      - Extract sub (auth.users.id)
    ├─ 3. Load user context (cached in Redis, TTL 5min)
    │      - Query user_profiles WHERE auth_user_id = sub
    │      - Query user_roles + roles WHERE user_profile_id = profile.id
    │      - Query sellers WHERE auth_user_id = sub (if seller role)
    │      - Query customers WHERE auth_user_id = sub (if customer role)
    ├─ 4. Build AuthenticatedUser object
    └─ Return user or raise 401/403
```

## AuthenticatedUser Model

```python
class AuthenticatedUser:
    auth_user_id: UUID          # from JWT sub
    profile_id: UUID            # user_profiles.id
    email: str | None
    phone: str | None
    display_name: str | None
    roles: list[str]            # ["admin", "seller", "customer"]
    seller_id: UUID | None      # sellers.id if role=seller
    customer_id: UUID | None    # customers.id if role=customer
    is_active: bool
```

## FastAPI Dependencies

### `get_current_user` — Base auth dependency

```python
async def get_current_user(
    authorization: str = Header(...),
    redis: Redis = Depends(get_redis),
    db: AsyncClient = Depends(get_supabase)
) -> AuthenticatedUser:
    token = authorization.replace("Bearer ", "")
    payload = verify_supabase_jwt(token)  # decode + verify
    user_id = payload["sub"]

    # Check Redis cache
    cached = await redis.get(f"user:{user_id}")
    if cached:
        return AuthenticatedUser.parse_raw(cached)

    # Load from DB
    user = await load_user_context(db, user_id)
    await redis.setex(f"user:{user_id}", 300, user.json())
    return user
```

### `require_roles(*roles)` — Role gate

```python
def require_roles(*required_roles: str):
    async def dependency(user: AuthenticatedUser = Depends(get_current_user)):
        if not any(r in user.roles for r in required_roles):
            raise ForbiddenError(f"Requires role: {required_roles}")
        return user
    return dependency

# Usage:
@router.get("/admin/dashboard")
async def admin_dashboard(user = Depends(require_roles("admin"))):
    ...
```

### `require_seller` — Seller scope

```python
async def require_seller(user = Depends(get_current_user)) -> AuthenticatedUser:
    if "seller" not in user.roles or not user.seller_id:
        raise ForbiddenError("Seller access required")
    return user
```

### `require_seller_owns_product` — Ownership check

```python
def require_seller_owns_resource(resource_type: str):
    async def dependency(
        resource_id: UUID,  # from path param
        user: AuthenticatedUser = Depends(require_seller),
        db = Depends(get_supabase)
    ):
        # For products: check tenant_id = user.seller_id
        # For orders: check seller_id = user.seller_id
        owner = await verify_ownership(db, resource_type, resource_id, user.seller_id)
        if not owner:
            raise ForbiddenError("Not the owner of this resource")
        return user
    return dependency
```

### Admin Bypass

Admin role users bypass all ownership checks but still go through JWT verification. The `is_admin()` function in Supabase RLS handles the DB-level bypass. At application level:

```python
async def admin_or_seller_owner(resource_id, user=Depends(get_current_user)):
    if "admin" in user.roles:
        return user  # Admin bypass
    if "seller" not in user.roles or not user.seller_id:
        raise ForbiddenError()
    # Verify ownership...
```

## WhatsApp/Webhook Auth (No JWT)

For WhatsApp webhooks and Razorpay webhooks, JWT is not used. Instead:

- **WhatsApp**: Verify `X-Hub-Signature-256` using WhatsApp app secret
- **Razorpay**: Verify `X-Razorpay-Signature` using webhook secret
- **Internal service calls**: Use Supabase service_role key for DB operations
