/**
 * Authentication Utilities
 *
 * Centralized auth extraction for Lambda handlers. Supports dual-auth during
 * migration: JWT claims (new path) with x-user-id header fallback (legacy path).
 *
 * New routes use Cognito JWT authorizer from day one. Existing routes get
 * dual-auth support — Lambda checks JWT first, falls back to headers.
 * The header fallback will be removed after frontend migration to Cognito tokens.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/**
 * Error thrown when no valid authentication is found on the request.
 */
export class UnauthorizedError extends Error {
  public readonly statusCode = 401;

  constructor(message = 'No valid authentication found') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Extract the authenticated user ID from the request.
 *
 * Resolution order:
 *  1. JWT claims — `event.requestContext.authorizer.jwt.claims.sub`
 *  2. Legacy header — `x-user-id` (removed after migration)
 *
 * @throws {UnauthorizedError} if neither source provides a user ID
 */
export function extractUserId(event: APIGatewayProxyEventV2): string {
  // 1. Try JWT authorizer claims (new path)
  const jwtClaims = (event.requestContext as any)?.authorizer?.jwt?.claims;
  if (jwtClaims?.sub) {
    return jwtClaims.sub as string;
  }

  // 2. Fallback to header (legacy path — remove after migration)
  const headerUserId =
    event.headers?.['x-user-id'] || event.headers?.['X-User-Id'];
  if (headerUserId) {
    return headerUserId;
  }

  throw new UnauthorizedError();
}

/**
 * Extract user role from JWT claims or legacy header.
 *
 * Resolution order:
 *  1. JWT claims — `cognito:groups` (first group) or `custom:role`
 *  2. Legacy header — `x-user-role`
 *
 * Returns null if no role can be determined.
 */
export function extractUserRole(event: APIGatewayProxyEventV2): string | null {
  // 1. Try JWT authorizer claims
  const jwtClaims = (event.requestContext as any)?.authorizer?.jwt?.claims;
  if (jwtClaims) {
    // Cognito groups come as a space-separated string in JWT
    const groups = jwtClaims['cognito:groups'];
    if (groups) {
      // Groups may be a string like "[admin]" or "admin seller"
      const parsed = typeof groups === 'string'
        ? groups.replace(/[\[\]]/g, '').split(/[\s,]+/).filter(Boolean)
        : Array.isArray(groups) ? groups : [];
      if (parsed.length > 0) {
        return parsed[0].toLowerCase();
      }
    }

    // Fallback to custom:role attribute
    if (jwtClaims['custom:role']) {
      return (jwtClaims['custom:role'] as string).toLowerCase();
    }
  }

  // 2. Fallback to header (legacy path)
  const roleHeader =
    event.headers?.['x-user-role'] || event.headers?.['X-User-Role'];
  return roleHeader?.toLowerCase() ?? null;
}

/**
 * Try to extract user ID without throwing. Returns null if unauthenticated.
 * Useful for optional-auth routes (e.g. catalog browsing).
 */
export function extractOptionalUserId(event: APIGatewayProxyEventV2): string | null {
  try {
    return extractUserId(event);
  } catch {
    return null;
  }
}
