# Tech Stack

## Backend Framework

- **FastAPI** (0.115.0+) - Modern async Python web framework
- **Uvicorn** - ASGI server with auto-reload in development
- **Pydantic** (2.9.0+) - Data validation and settings management

## Core Dependencies

- **Supabase** (2.9.0+) - PostgreSQL database, authentication (GoTrue), and file storage
- **httpx** - Async HTTP client for external API calls
- **python-jose** - JWT token handling
- **structlog** - Structured logging with context
- **tenacity** - Retry logic with exponential backoff

## External Integrations

- **WhatsApp Cloud API** - Meta's WhatsApp Business Platform for messaging
- **Razorpay** - Payment gateway for UPI, cards, wallets, net banking
- **Google Gemini** - AI for voice transcription, image analysis, multilingual support

## Development Tools

- **Docker** - Containerization with docker-compose for local development
- **Python 3.11+** - Required Python version

## Common Commands

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env with Supabase, Razorpay, WhatsApp credentials

# Run development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Run with Docker
docker-compose up --build
```

### Testing

```bash
# Run tests (when test suite exists)
pytest

# Type checking
mypy app/

# Linting
ruff check app/
```

## Configuration

- Environment variables loaded via `pydantic-settings` from `.env` file
- Configuration centralized in `app/core/config.py`
- Settings cached with `@lru_cache` for performance
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`
- Optional: WhatsApp and Razorpay credentials (can be added later)

## API Documentation

- Swagger UI: `http://localhost:8000/docs` (development only)
- ReDoc: `http://localhost:8000/redoc` (development only)
- Disabled in production for security

## MCP Servers

Three local MCP servers provide read-only access to platform data:

- **commerce-ops-mcp** - Orders, payments, inventory, WhatsApp sessions, logs
- **commerce-catalog-mcp** - Products, categories, stock levels, media
- **commerce-admin-mcp** - Seller approvals, disputes, audit logs, analytics

Install all: `cd tools/mcp && ./install-all.sh`

Requires AWS credentials configured with profile `kiro-mcp` and DynamoDB read permissions.
