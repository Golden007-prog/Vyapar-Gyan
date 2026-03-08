import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { logger } from '../../utils/logger';

/**
 * System Health Status
 */
interface SystemHealth {
  services: Array<{
    name: string;
    status: 'operational' | 'degraded' | 'down';
    lastChecked: string;
    responseTime?: number;
  }>;
  overallStatus: 'operational' | 'degraded' | 'down';
}

/**
 * Get System Health Handler
 * 
 * Returns the operational status of external services and integrations.
 * 
 * Services monitored:
 * - Twilio (WhatsApp messaging)
 * - Razorpay (Payments)
 * - Google Gemini (AI/OCR)
 * - xAI Grok (Market trends)
 * - Amazon Bedrock (AI orchestration)
 * 
 * Authorization: Requires valid JWT token with admin role
 * 
 * Note: For MVP, returns mock operational status. In production, implement:
 * - Health check endpoints for each service
 * - CloudWatch metrics and alarms
 * - Automated status page updates
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get system health request received', {
    requestId,
    path: event.path,
  });

  try {
    // Extract user role from JWT token
    const userRole = extractUserRoleFromEvent(event);
    
    if (userRole !== 'admin') {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Forbidden',
          message: 'Admin access required',
        }),
      };
    }

    logger.info('Checking system health');

    // Fetch system health status
    const health = await checkSystemHealth();

    logger.info('System health retrieved successfully', {
      overallStatus: health.overallStatus,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        health,
        checkedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    logger.error('Failed to get system health', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to retrieve system health',
      }),
    };
  }
};

/**
 * Extract user role from API Gateway event
 */
function extractUserRoleFromEvent(event: APIGatewayProxyEvent): string | null {
  // Check authorizer context first
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    const claims = authorizerContext.claims || authorizerContext;
    
    // Check Cognito groups
    if (claims['cognito:groups']) {
      const groups = claims['cognito:groups'];
      if (typeof groups === 'string' && groups.includes('admin')) {
        return 'admin';
      }
      if (Array.isArray(groups) && groups.includes('admin')) {
        return 'admin';
      }
    }
    
    // Check custom role attribute
    if (claims['custom:role']) {
      return claims['custom:role'];
    }
  }

  // Fallback: try to extract from headers (for testing)
  const roleHeader = event.headers['x-user-role'] || event.headers['X-User-Role'];
  if (roleHeader) {
    return roleHeader;
  }

  return null;
}

/**
 * Check system health for all external services
 * 
 * For MVP, returns mock operational status.
 * In production, implement actual health checks:
 * - Twilio: GET /v1/Accounts/{AccountSid}.json
 * - Razorpay: GET /v1/payments (with test key)
 * - Gemini: Test API call with small prompt
 * - Grok: Test API call with small prompt
 * - Bedrock: DescribeAgent API call
 */
async function checkSystemHealth(): Promise<SystemHealth> {
  const now = new Date().toISOString();
  
  // For MVP, return operational status for all services
  const services = [
    {
      name: 'Twilio (WhatsApp)',
      status: 'operational' as const,
      lastChecked: now,
      responseTime: 120,
    },
    {
      name: 'Razorpay (Payments)',
      status: 'operational' as const,
      lastChecked: now,
      responseTime: 95,
    },
    {
      name: 'Google Gemini (AI/OCR)',
      status: 'operational' as const,
      lastChecked: now,
      responseTime: 450,
    },
    {
      name: 'xAI Grok (Market Trends)',
      status: 'operational' as const,
      lastChecked: now,
      responseTime: 380,
    },
    {
      name: 'Amazon Bedrock (AI Orchestration)',
      status: 'operational' as const,
      lastChecked: now,
      responseTime: 210,
    },
  ];

  // Determine overall status
  const hasDown = services.some(s => (s.status as string) === 'down');
  const hasDegraded = services.some(s => (s.status as string) === 'degraded');
  
  let overallStatus: 'operational' | 'degraded' | 'down' = 'operational';
  if (hasDown) {
    overallStatus = 'down';
  } else if (hasDegraded) {
    overallStatus = 'degraded';
  }

  return {
    services,
    overallStatus,
  };
}
