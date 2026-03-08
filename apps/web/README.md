# VyaparGyan Web Dashboard

Next.js 14 web application for Admin and Seller dashboards with role-based access control.

## Features

- **Role-Based Routing**: Middleware enforces access control based on Cognito JWT groups
- **Admin Portal**: Seller approvals, platform analytics, dispute resolution
- **Seller Dashboard**: Inventory management, AI insights, campaign tracking
- **AWS Cognito Integration**: Secure authentication with User Pools
- **Responsive Design**: Mobile-first UI with Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm package manager
- AWS Cognito User Pool configured (ID: `ap-south-1_jeKcCOzvw`)

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.local.example .env.local

# Update .env.local with your Cognito App Client ID
```

### Development

```bash
# Run development server
pnpm dev

# Open http://localhost:3000
```

### Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

## Project Structure

```
apps/web/
├── app/
│   ├── admin/              # Admin portal pages
│   │   ├── layout.tsx      # Admin layout with sidebar
│   │   └── page.tsx        # Admin dashboard
│   ├── seller/             # Seller dashboard pages
│   │   ├── layout.tsx      # Seller layout with sidebar
│   │   ├── page.tsx        # Seller overview
│   │   ├── insights/       # AI insights page
│   │   ├── inventory/      # Inventory management
│   │   └── campaigns/      # Campaign tracking
│   ├── login/              # Login page
│   ├── unauthorized/       # Access denied page
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Global styles
├── lib/
│   └── amplify-config.ts   # AWS Amplify configuration
├── middleware.ts           # Route protection middleware
└── package.json
```

## Authentication Flow

1. User visits protected route (e.g., `/seller`)
2. Middleware checks for `idToken` cookie or `Authorization` header
3. JWT token is decoded and validated
4. User's Cognito groups are extracted from token claims
5. Access is granted/denied based on route and user role
6. Unauthorized users are redirected to `/login` or `/unauthorized`

## Role Mapping

- **Admin**: Access to `/admin/*` routes
- **Seller**: Access to `/seller/*` routes
- **Customer**: No web dashboard access (WhatsApp only)

## Environment Variables

See `.env.local.example` for required configuration:

- `NEXT_PUBLIC_COGNITO_USER_POOL_ID`: Cognito User Pool ID
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`: Cognito App Client ID
- `NEXT_PUBLIC_AWS_REGION`: AWS region (ap-south-1)
- `NEXT_PUBLIC_API_URL`: Backend API endpoint

## TODO

- [ ] Implement actual Cognito authentication in login page
- [ ] Add JWT signature verification in middleware
- [ ] Connect to backend API for real data
- [ ] Implement file upload for Khata books
- [ ] Add real-time chat interface
- [ ] Implement campaign approval workflow
- [ ] Add analytics charts and visualizations
