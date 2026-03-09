/**
 * WhatsApp Response Sanitizer
 * 
 * Final outbound sanitization layer that ensures no raw system output,
 * debug strings, JSON payloads, XML tags, or internal errors ever reach
 * WhatsApp users via Twilio.
 * 
 * This module is the last gate before Twilio send — every outbound text
 * message MUST pass through sanitizeForWhatsApp().
 */

import { logger } from './logger';

// ── Patterns that should NEVER appear in user-facing messages ──────────

/** Matches JSON objects/arrays (greedy, multiline) */
const JSON_OBJECT_RE = /^\s*[\[{][\s\S]*[\]}]\s*$/;

/** Matches XML/HTML-like tags wrapping content: <tag>...</tag> */
const XML_WRAPPER_RE = /<\/?(?:response|thinking|answer|result|output|error|system|debug|tool_result|function_call|invoke|xml|data|json|code|pre|div|span|p)\b[^>]*>/gi;

/** Matches standalone JSON-like key-value snippets: {"key":"value"} */
const INLINE_JSON_RE = /\{"\w+":\s*"[^"]*"\}/g;

/** Matches common debug/status payloads that Twilio might echo */
const DEBUG_PAYLOAD_RE = /\{"status"\s*:\s*"[^"]*"\}/g;

/** Matches raw error stack traces */
const STACK_TRACE_RE = /^\s*at\s+[\w$.]+\s+\(.*:\d+:\d+\)/gm;

/** Matches internal error prefixes */
const INTERNAL_ERROR_RE = /(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):\s+.+/g;

/** Matches AWS SDK error patterns */
const AWS_ERROR_RE = /(?:AccessDeniedException|ValidationException|ResourceNotFoundException|ConditionalCheckFailedException|ProvisionedThroughputExceededException):\s*.+/g;

/** Matches tool execution artifacts */
const TOOL_ARTIFACT_RE = /Tool execution (?:failed|error|result):\s*.+/gi;

/** Matches XML processing instructions */
const XML_PI_RE = /<\?xml[^?]*\?>/gi;

/** Matches CDATA sections */
const CDATA_RE = /<!\[CDATA\[[\s\S]*?\]\]>/gi;

// ── Fallback messages ──────────────────────────────────────────────────

const SELLER_FALLBACK = "Sorry, I couldn't process that right now. Please try again or rephrase your request.";
const CUSTOMER_FALLBACK = "Sorry, something went wrong on our end. Please try again in a moment.";

// ── Public API ─────────────────────────────────────────────────────────

export type MessageAudience = 'seller' | 'customer';

/**
 * Sanitize a message before sending it to WhatsApp via Twilio.
 * 
 * Strips XML/JSON wrappers, debug output, stack traces, and internal errors.
 * Returns a clean fallback if the message is entirely machine output.
 */
export function sanitizeForWhatsApp(
  text: string,
  audience: MessageAudience = 'customer',
): string {
  if (!text || typeof text !== 'string') {
    return audience === 'seller' ? SELLER_FALLBACK : CUSTOMER_FALLBACK;
  }

  let cleaned = text.trim();

  // 1. Strip XML processing instructions and CDATA
  cleaned = cleaned.replace(XML_PI_RE, '');
  cleaned = cleaned.replace(CDATA_RE, '');

  // 2. Strip XML-like wrapper tags (keep inner content)
  cleaned = cleaned.replace(XML_WRAPPER_RE, '');

  // 3. If the entire message is a JSON object/array, replace with fallback
  if (JSON_OBJECT_RE.test(cleaned)) {
    logger.warn('Blocked raw JSON payload from reaching WhatsApp', {
      originalLength: text.length,
      preview: text.substring(0, 80),
    });
    return audience === 'seller' ? SELLER_FALLBACK : CUSTOMER_FALLBACK;
  }

  // 4. Remove inline JSON snippets like {"status":"received"}
  cleaned = cleaned.replace(DEBUG_PAYLOAD_RE, '');
  cleaned = cleaned.replace(INLINE_JSON_RE, '');

  // 5. Remove stack traces
  cleaned = cleaned.replace(STACK_TRACE_RE, '');

  // 6. Remove internal error messages
  cleaned = cleaned.replace(AWS_ERROR_RE, '');
  cleaned = cleaned.replace(INTERNAL_ERROR_RE, '');
  cleaned = cleaned.replace(TOOL_ARTIFACT_RE, '');

  // 7. Collapse excessive whitespace / blank lines
  cleaned = cleaned
    .split('\n')
    .map(line => line.trimEnd())
    .filter((line, i, arr) => {
      // Remove consecutive blank lines (keep max 1)
      if (line === '' && i > 0 && arr[i - 1] === '') return false;
      return true;
    })
    .join('\n')
    .trim();

  // 8. If nothing meaningful remains, return fallback
  if (!cleaned || cleaned.length < 2) {
    logger.warn('Message was entirely system output, using fallback', {
      originalLength: text.length,
      audience,
    });
    return audience === 'seller' ? SELLER_FALLBACK : CUSTOMER_FALLBACK;
  }

  // 9. Truncate very long messages (WhatsApp limit ~4096 chars)
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '\n\n...message truncated.';
  }

  return cleaned;
}

/**
 * Check if a string looks like raw machine output that should never
 * be sent to a user. Useful for pre-flight checks.
 */
export function isMachineOutput(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (JSON_OBJECT_RE.test(trimmed)) return true;
  if (XML_PI_RE.test(trimmed)) return true;
  if (STACK_TRACE_RE.test(trimmed)) return true;
  if (DEBUG_PAYLOAD_RE.test(trimmed)) return true;
  return false;
}

/**
 * Sanitize text for TTS conversion.
 * Strips WhatsApp formatting markers that don't translate well to speech,
 * then truncates and applies a role-appropriate fallback if needed.
 */
export function sanitizeForTTS(
  text: string,
  audience: MessageAudience = 'customer',
): string {
  // 1. Apply existing sanitizeForWhatsApp rules
  let cleaned = sanitizeForWhatsApp(text, audience);

  // 2. Remove WhatsApp bold markers: *text* → text
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');

  // 3. Remove emoji bullet prefixes: "📋 " → ""
  cleaned = cleaned.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/gmu, '');

  // 4. Remove numbered list formatting: "1. " → ""
  cleaned = cleaned.replace(/^\d+\.\s+/gm, '');

  // 5. Truncate to 500 chars for concise voice replies
  if (cleaned.length > 500) {
    cleaned = cleaned.substring(0, 497) + '...';
  }

  // 6. Fallback if empty or too short
  if (!cleaned || cleaned.length < 2) {
    return audience === 'seller'
      ? "Sorry, I couldn't process that right now. Please try again."
      : "Sorry, something went wrong. Please try again in a moment.";
  }

  return cleaned;
}
