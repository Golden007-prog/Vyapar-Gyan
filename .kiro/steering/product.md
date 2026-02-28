# Product Overview

VyaparGyan is an AI-powered commerce platform for local Indian retailers. It enables sellers to manage products and orders via web dashboard while customers browse and purchase through WhatsApp.

## Core Personas

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes
- **Seller**: Local retailers managing products, inventory, and fulfilling orders
- **Customer**: End users browsing and ordering primarily via WhatsApp

## Key Features

- Seller onboarding with document verification and admin approval
- Product catalog management with image uploads and inventory tracking
- WhatsApp-based customer commerce (browsing, ordering, payment)
- Order lifecycle management with payment integration (Razorpay)
- Admin controls for moderation, analytics, and dispute resolution
- AI assistance for catalog extraction, voice transcription, and multilingual support

## Architecture

- **Backend**: FastAPI on Python with Supabase (PostgreSQL + Auth + Storage)
- **Customer Channel**: WhatsApp Cloud API for conversational commerce
- **Payments**: Razorpay integration with webhook handling
- **AI**: Google Gemini for voice transcription, image analysis, multilingual support

## Design Philosophy

- Production-grade, event-driven architecture
- Role-based access control (RBAC) with JWT authentication
- Structured logging with request IDs for observability
- API-first design with clear separation of concerns
- AI features are assistive and optional, not autonomous
