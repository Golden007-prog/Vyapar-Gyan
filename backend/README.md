# VyaparGyan Backend

## Quick Start

```bash
cp .env.example .env
# Fill in Supabase, Redis, Razorpay, WhatsApp credentials

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Docker

```bash
docker-compose up --build
```
