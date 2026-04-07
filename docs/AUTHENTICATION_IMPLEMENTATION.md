# Authentication & API Integration Implementation

## Overview

Successfully implemented AWS Cognito authentication and backend API integration for the VyaparGyan web dashboard.

## Components Implemented

### 1. API Client Utility (`lib/api-client.ts`)

A reusable utility for making authenticated API requests:

- **`fetchWithAuth()`**: Automatically retrieves JWT access token from Amplify session
- **Error Handling**: Custom `ApiError` class with status codes and error data
- **Convenience Methods**: `api.get()`, `api.post()`, `api.put()`, `api.patch()`, `api.delete()`
- **Authorization Header**: Automatically adds `Bearer ${token}` to all requests
- **Base URL**: Configurable via `NEXT_PUBLIC_API_URL` environment variable

### 2. Login Page (`app/login/page.tsx`)

Full Cognito authentication implementation:

- **AWS Amplify Integration**: Uses `signIn()` and `fetchAuthSession()` from `aws-amplify/auth`
- **Role-Based Redirect**: 
  - Admin users → `/admin`
  - Seller users → `/seller/insights`
  - Respects `?redirect` query parameter
- **Error Handling**: Specific messages for:
  - Invalid credentials (`NotAuthorizedException`)
  - Unconfirmed accounts (`UserNotConfirmedException`)
  - Password reset required (`PasswordResetRequiredException`)
  - Rate limiting (`TooManyRequestsException`)
- **Session Management**: Stores ID token in secure cookie for middleware

### 3. AI Insights Page (`app/seller/insights/page.tsx`)

Connected to backend API with full CRUD operations:

- **Data Fetching**: Loads insights from `GET /insights?status=PENDING,APPROVED`
- **Approval Workflow**: `PUT /insights/{id}/approve` triggers campaign execution
- **Rejection**: `PUT /insights/{id}/reject` removes insight from feed
- **Loading States**: Spinner during initial load and action processing
- **Error Handling**: Retry button and user-friendly error messages
- **Optimistic Updates**: UI updates immediately on approval/rejection
- **Rich Data Display**: Shows market research, discount percentages, impact estimates

### 4. Type Definitions (`lib/types.ts`)

TypeScript interfaces for type safety:

- **`AIInsight`**: Complete insight data structure
- **`InsightsListResponse`**: Paginated API response
- **`InsightApprovalResponse`**: Approval action result
- **UI Types**: Card configurations and display types

## Authentication Flow

```
1. User enters email/password → Login Page
2. Amplify signIn() → AWS Cognito User Pool
3. Cognito returns tokens → fetchAuthSession()
4. Extract cognito:groups from ID token
5. Store ID token in cookie
6. Redirect based on role (admin/seller)
7. Middleware validates token on protected routes
8. API calls use access token from session
```

## API Integration Flow

```
1. Component mounts → configureAmplify()
2. useEffect triggers fetchInsights()
3. fetchWithAuth() → fetchAuthSession() → get access token
4. Add Authorization header → fetch API
5. Parse JSON response → update state
6. User clicks "Approve" → handleApprove()
7. PUT /insights/{id}/approve with auth
8. Optimistic UI update → show success
```

## Environment Variables Required

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-south-1_jeKcCOzvw
NEXT_PUBLIC_COGNITO_CLIENT_ID=<your-app-client-id>
NEXT_PUBLIC_AWS_REGION=ap-south-1
NEXT_PUBLIC_API_URL=https://api.vyapargyan.com
```

## Key Features

1. **Automatic Token Management**: Amplify handles token refresh automatically
2. **Type Safety**: Full TypeScript support with proper interfaces
3. **Error Boundaries**: Graceful error handling with user feedback
4. **Loading States**: Visual feedback during async operations
5. **Optimistic Updates**: Immediate UI response for better UX
6. **Role-Based Access**: Middleware enforces authorization
7. **Secure Cookies**: HttpOnly, Secure, SameSite=Strict flags

## Next Steps

1. Deploy API Gateway and get actual endpoint URL
2. Create Cognito App Client and update environment variables
3. Implement backend endpoints:
   - `GET /insights` - List insights for seller
   - `PUT /insights/{id}/approve` - Approve and trigger campaign
   - `PUT /insights/{id}/reject` - Reject insight
4. Add toast notifications for better user feedback
5. Implement real-time updates (WebSocket or polling)
6. Add pagination for large insight lists
7. Implement insight detail modal with full product list

## Testing

To test locally:

1. Install dependencies: `pnpm install`
2. Copy `.env.local.example` to `.env.local`
3. Update with your Cognito credentials
4. Run dev server: `pnpm dev`
5. Navigate to `http://localhost:3000/login`
6. Sign in with Cognito user credentials
7. View insights at `/seller/insights`

## Security Considerations

- ID tokens stored in secure cookies (not localStorage)
- Access tokens retrieved fresh for each API call
- Middleware validates tokens server-side
- HTTPS required in production
- CORS configured on API Gateway
- Rate limiting on authentication endpoints
