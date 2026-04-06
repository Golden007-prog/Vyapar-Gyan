import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch utility that automatically adds authentication headers
 * @param endpoint - API endpoint (e.g., '/insights' or '/insights/123')
 * @param options - Standard fetch options
 * @returns Parsed JSON response
 */
export async function fetchWithAuth<T = any>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    // Get the current user's session and extract the JWT token
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new ApiError('No authentication token available', 401);
    }

    // Extract user sub (Cognito user ID) for x-user-id header fallback
    // This is needed for routes that don't have a JWT authorizer configured
    const userSub = session.tokens?.idToken?.payload?.sub as string | undefined;

    // Construct the full URL
    const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    // Build headers — include x-user-id for seller routes without JWT authorizer
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (userSub) {
      headers['x-user-id'] = userSub;
    }

    // Make the authenticated request
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    });

    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.message || `Request failed with status ${response.status}`,
        response.status,
        errorData
      );
    }

    // Parse and return JSON response
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      500
    );
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: <T = any>(endpoint: string) => 
    fetchWithAuth<T>(endpoint, { method: 'GET' }),

  post: <T = any>(endpoint: string, data?: any) =>
    fetchWithAuth<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = any>(endpoint: string, data?: any) =>
    fetchWithAuth<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T = any>(endpoint: string, data?: any) =>
    fetchWithAuth<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = any>(endpoint: string) =>
    fetchWithAuth<T>(endpoint, { method: 'DELETE' }),
};
