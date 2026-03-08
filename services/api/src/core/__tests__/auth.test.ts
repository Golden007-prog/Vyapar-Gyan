import { extractUserId, extractUserRole, extractOptionalUserId, UnauthorizedError } from '../auth';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/** Helper to build a minimal event with JWT claims */
function makeEvent(overrides: Partial<{
  jwtClaims: Record<string, unknown>;
  headers: Record<string, string>;
}>): APIGatewayProxyEventV2 {
  const event: any = {
    headers: overrides.headers ?? {},
    requestContext: {},
  };

  if (overrides.jwtClaims) {
    event.requestContext.authorizer = {
      jwt: { claims: overrides.jwtClaims },
    };
  }

  return event as APIGatewayProxyEventV2;
}

describe('extractUserId', () => {
  it('returns sub from JWT claims when present', () => {
    const event = makeEvent({ jwtClaims: { sub: 'jwt-user-123' } });
    expect(extractUserId(event)).toBe('jwt-user-123');
  });

  it('falls back to x-user-id header when no JWT', () => {
    const event = makeEvent({ headers: { 'x-user-id': 'header-user-456' } });
    expect(extractUserId(event)).toBe('header-user-456');
  });

  it('prefers JWT over header when both present', () => {
    const event = makeEvent({
      jwtClaims: { sub: 'jwt-user-123' },
      headers: { 'x-user-id': 'header-user-456' },
    });
    expect(extractUserId(event)).toBe('jwt-user-123');
  });

  it('handles case-insensitive X-User-Id header', () => {
    const event = makeEvent({ headers: { 'X-User-Id': 'header-user-789' } });
    expect(extractUserId(event)).toBe('header-user-789');
  });

  it('throws UnauthorizedError when no auth source exists', () => {
    const event = makeEvent({});
    expect(() => extractUserId(event)).toThrow(UnauthorizedError);
    expect(() => extractUserId(event)).toThrow('No valid authentication found');
  });

  it('throws when JWT claims exist but sub is missing', () => {
    const event = makeEvent({ jwtClaims: { email: 'test@example.com' } });
    expect(() => extractUserId(event)).toThrow(UnauthorizedError);
  });
});

describe('extractUserRole', () => {
  it('returns role from cognito:groups claim', () => {
    const event = makeEvent({ jwtClaims: { 'cognito:groups': 'Sellers' } });
    expect(extractUserRole(event)).toBe('sellers');
  });

  it('returns first group when multiple groups present', () => {
    const event = makeEvent({ jwtClaims: { 'cognito:groups': 'Admins Sellers' } });
    expect(extractUserRole(event)).toBe('admins');
  });

  it('handles bracket-wrapped groups format', () => {
    const event = makeEvent({ jwtClaims: { 'cognito:groups': '[Customers]' } });
    expect(extractUserRole(event)).toBe('customers');
  });

  it('falls back to custom:role claim', () => {
    const event = makeEvent({ jwtClaims: { sub: 'u1', 'custom:role': 'seller' } });
    expect(extractUserRole(event)).toBe('seller');
  });

  it('falls back to x-user-role header', () => {
    const event = makeEvent({ headers: { 'x-user-role': 'admin' } });
    expect(extractUserRole(event)).toBe('admin');
  });

  it('returns null when no role source exists', () => {
    const event = makeEvent({});
    expect(extractUserRole(event)).toBeNull();
  });
});

describe('extractOptionalUserId', () => {
  it('returns userId when authenticated', () => {
    const event = makeEvent({ jwtClaims: { sub: 'user-1' } });
    expect(extractOptionalUserId(event)).toBe('user-1');
  });

  it('returns null when unauthenticated', () => {
    const event = makeEvent({});
    expect(extractOptionalUserId(event)).toBeNull();
  });
});
