/**
 * Get Upload Handler
 *
 * Returns a pre-processed inventory upload record so the frontend
 * can hydrate the Smart CSV Upload / Khata OCR modal at the
 * Mapping/Preview step — skipping the Upload and AI Analysis steps.
 *
 * Route: GET /api/v1/seller/uploads/{uploadId}
 *
 * The record is created by the WhatsApp inventory upload flow
 * (handleInventoryUploadWithDashboard) and stored as UPLOAD#{uploadId}
 * in DynamoDB with a 24-hour TTL.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUpload } from '../../adapters/dynamodb-adapter';
import { logger } from '../../utils/logger';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID,X-User-Id',
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext?.requestId ?? 'unknown';

  // Extract uploadId from path parameters
  const uploadId = event.pathParameters?.uploadId;

  if (!uploadId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Bad Request', message: 'uploadId path parameter is required' }),
    };
  }

  logger.info('Get upload request', { requestId, uploadId });

  try {
    const record = await getUpload(uploadId);

    if (!record) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Not Found',
          message: 'Upload not found or expired. WhatsApp upload links expire after 24 hours.',
        }),
      };
    }

    // Return the upload data for frontend hydration
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        uploadId: record.uploadId,
        sellerId: record.sellerId,
        mediaType: record.mediaType,
        status: record.status,
        productCount: record.productCount,
        products: record.products,
        columnMapping: record.columnMapping ?? null,
        headers: record.headers ?? null,
        csvLines: record.csvLines ?? null,
        errors: record.errors ?? [],
        warnings: record.warnings ?? [],
        createdAt: record.createdAt,
      }),
    };
  } catch (error) {
    logger.error('Failed to fetch upload record', {
      requestId,
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal Server Error', message: 'Failed to fetch upload data' }),
    };
  }
};
