// Middleware is disabled for static export (GitHub Pages).
// Authentication and route protection are handled client-side
// via AWS Amplify / Cognito session checks in each layout/page.
//
// The original middleware provided server-side JWT verification
// and role-based redirects. For the static build, each protected
// layout checks auth state on mount and redirects via next/navigation.

export {};