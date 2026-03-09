/**
 * Safe Name Resolution
 * 
 * Ensures customer/seller display names never contain "undefined", "null",
 * "Unknown", or other placeholder values that would look broken in
 * outbound WhatsApp messages.
 */

const INVALID_NAMES = new Set([
  'undefined',
  'null',
  'unknown',
  'none',
  '',
  'n/a',
  'na',
]);

/**
 * Return a clean display name or empty string if the name is invalid.
 * 
 * Usage in templates:
 *   `Namaste${name ? ` ${name}` : ''}!`
 *   → "Namaste Priya!" or "Namaste!"
 */
export function safeName(name: string | undefined | null): string {
  if (name == null) return '';
  const trimmed = name.trim();
  if (INVALID_NAMES.has(trimmed.toLowerCase())) return '';
  // Guard against names that are just whitespace or special chars
  if (trimmed.length < 1) return '';
  return trimmed;
}
