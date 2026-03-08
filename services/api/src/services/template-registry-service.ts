/**
 * Template Registry Service
 *
 * Manages pre-approved WhatsApp message templates stored in DynamoDB
 * (PK: TEMPLATE#{templateSid}, SK: METADATA). Templates are required
 * for outbound messages sent outside the 24-hour service window.
 *
 * Responsibilities:
 * - Retrieve template by SID
 * - Validate message parameters against the template's Zod-compatible schema
 * - List templates with optional category filter
 */

import { z } from 'zod';
import { logger } from '../utils/logger';
import {
  getTemplate as dbGetTemplate,
  scanTemplates,
  type TemplateRegistry,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Zod schema from a stored parameterSchema object.
 *
 * The parameterSchema is stored as a plain JSON object describing required
 * string parameters, e.g. `{ "name": "string", "amount": "string" }`.
 * This converts it into a Zod object schema for runtime validation.
 */
function buildZodSchema(
  parameterSchema: Record<string, unknown>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, typeDef] of Object.entries(parameterSchema)) {
    if (typeDef === 'string') {
      shape[key] = z.string().min(1);
    } else if (typeDef === 'number') {
      shape[key] = z.number();
    } else if (typeDef === 'boolean') {
      shape[key] = z.boolean();
    } else {
      // Default to string for unknown types
      shape[key] = z.string();
    }
  }

  return z.object(shape);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a template by its Twilio SID.
 * Returns null if the template does not exist.
 */
export async function getTemplate(
  templateSid: string,
): Promise<TemplateRegistry | null> {
  const tpl = await dbGetTemplate(templateSid);
  if (!tpl) {
    logger.warn('Template not found', { templateSid });
  }
  return tpl;
}

/**
 * Validate parameters against a template's parameterSchema.
 *
 * Fetches the template, builds a Zod schema from its parameterSchema,
 * and validates the provided params object.
 */
export async function validateParameters(
  templateSid: string,
  params: Record<string, unknown>,
): Promise<ValidationResult> {
  const tpl = await dbGetTemplate(templateSid);

  if (!tpl) {
    return { valid: false, errors: [`Template ${templateSid} not found`] };
  }

  if (!tpl.parameterSchema || Object.keys(tpl.parameterSchema).length === 0) {
    // Template has no required parameters — always valid
    return { valid: true };
  }

  try {
    const schema = buildZodSchema(tpl.parameterSchema);
    schema.parse(params);
    logger.debug('Template parameters validated', { templateSid });
    return { valid: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors = err.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`,
      );
      logger.warn('Template parameter validation failed', {
        templateSid,
        errors,
      });
      return { valid: false, errors };
    }
    throw err;
  }
}

/**
 * List all templates, optionally filtered by category.
 * Templates are a small, bounded dataset so a scan is acceptable.
 */
export async function listTemplates(
  category?: TemplateRegistry['category'],
): Promise<TemplateRegistry[]> {
  const templates = await scanTemplates(category);
  logger.debug('Templates listed', {
    category: category ?? 'all',
    count: templates.length,
  });
  return templates;
}
