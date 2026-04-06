import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../utils/logger';
import { getBasicConfig } from '../../utils/config';

/**
 * Request body schema
 */
interface GenerateUploadUrlRequest {
  fileName: string;
  fileType: string;
}

/**
 * Generate Upload URL Handler
 * 
 * Generates a presigned S3 URL for sellers to upload inventory files directly to S3.
 * This enables client-side uploads without routing through API Gateway.
 * 
 * The uploaded file will trigger the inventory-upload-handler Lambda via S3 event notification.
 * 
 * Request Body:
 * - fileName: Name of the file to upload (e.g., "inventory.csv", "khata-book.jpg")
 * - fileType: MIME type of the file (e.g., "text/csv", "image/jpeg")
 * 
 * Response:
 * - uploadUrl: Presigned S3 URL for PUT request
 * - key: S3 object key where file will be stored
 * - expiresIn: URL expiration time in seconds (900 = 15 minutes)
 * 
 * S3 Key Format:
 * sellers/{sellerId}/inventory/{fileName}
 * 
 * This format is CRITICAL for Phase 2 pipeline integration:
 * - The inventory-upload-handler expects this prefix pattern
 * - S3 event notifications are configured to trigger on this prefix
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Generate upload URL request received', {
    requestId,
    path: event.path,
  });

  try {
    // Extract seller ID from JWT token (set by API Gateway authorizer)
    const sellerId = extractSellerIdFromEvent(event);
    
    if (!sellerId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Seller ID not found in token',
        }),
      };
    }

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Request body is required',
        }),
      };
    }

    const requestBody: GenerateUploadUrlRequest = JSON.parse(event.body);

    // Validate request body
    if (!requestBody.fileName || !requestBody.fileType) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'fileName and fileType are required',
        }),
      };
    }

    // Validate file type (CSV or images only)
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/heic',
      'image/heif',
    ];

    if (!allowedTypes.includes(requestBody.fileType.toLowerCase())) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: `File type ${requestBody.fileType} is not supported. Allowed types: CSV, JPEG, PNG, HEIC`,
        }),
      };
    }

    // Sanitize file name (remove path traversal attempts)
    const sanitizedFileName = requestBody.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Generate S3 key following Phase 2 pipeline convention
    // CRITICAL: This prefix pattern is required for S3 event notification routing
    const s3Key = `sellers/${sellerId}/inventory/${sanitizedFileName}`;

    logger.info('Generating presigned URL', {
      sellerId,
      fileName: sanitizedFileName,
      fileType: requestBody.fileType,
      s3Key,
    });

    // Get configuration
    const config = getBasicConfig();

    // Create S3 client
    const s3Client = new S3Client({});

    // Generate presigned URL for PUT operation
    const command = new PutObjectCommand({
      Bucket: config.documentsBucket,
      Key: s3Key,
      ContentType: requestBody.fileType,
      Metadata: {
        sellerId,
        uploadedBy: sellerId,
        originalFileName: requestBody.fileName,
      },
    });

    // URL expires in 15 minutes (900 seconds)
    const expiresIn = 900;
    const uploadUrl = await getSignedUrl(s3Client as any, command, { expiresIn });

    logger.info('Presigned URL generated successfully', {
      sellerId,
      s3Key,
      expiresIn,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        uploadUrl,
        key: s3Key,
        bucket: config.documentsBucket,
        expiresIn,
        message: 'Upload URL generated successfully. Use PUT request to upload file.',
      }),
    };
  } catch (error) {
    logger.error('Failed to generate upload URL', {
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
        message: 'Failed to generate upload URL',
      }),
    };
  }
};

/**
 * Extract seller ID from API Gateway event
 * The seller ID should be in the JWT token claims, set by the authorizer
 */
function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  // Check authorizer context first
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    // For JWT authorizer, claims are in authorizer.claims
    const claims = authorizerContext.claims || authorizerContext;
    
    // Try to get seller ID from custom attribute
    if (claims['custom:userId']) {
      return claims['custom:userId'];
    }
    
    // Fallback to sub (Cognito user ID)
    if (claims.sub) {
      return claims.sub;
    }
  }

  // Fallback: try to extract from headers (for testing)
  const userIdHeader = event.headers['x-user-id'] || event.headers['X-User-Id'];
  if (userIdHeader) {
    return userIdHeader;
  }

  return null;
}
