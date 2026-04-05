/**
 * Phone Number Normalization Utility
 *
 * Normalizes Indian phone numbers to a canonical 10-digit format.
 * Handles various input formats: +91, 91 prefix, leading 0, spaces, dashes, parentheses.
 * International numbers (non-Indian) are returned with their country code as-is.
 *
 * @module phone-normalize
 */

/**
 * Normalize an Indian phone number to its canonical 10-digit form.
 *
 * Rules:
 * - Strip all spaces, dashes, parentheses
 * - Strip "+91" prefix → 10 digits
 * - Strip "91" prefix if result is 12 digits → 10 digits
 * - Strip leading "0" if result is 11 digits → 10 digits
 * - Validate result is exactly 10 digits starting with 6-9
 * - International numbers (with "+" prefix and non-91 country code): return with country code as-is
 *
 * @throws {Error} If the phone number cannot be normalized to a valid format
 */
export function normalizeIndianPhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error(`Invalid phone input: empty or non-string value`);
  }

  // Step 1: Strip whitespace, dashes, parentheses
  let cleaned = raw.replace(/[\s\-\(\)]/g, '');

  if (cleaned.length === 0) {
    throw new Error(`Invalid phone input: "${raw}" contains no digits`);
  }

  // Step 2: Handle international numbers with "+" prefix (non-Indian)
  if (cleaned.startsWith('+') && !cleaned.startsWith('+91')) {
    // International number — validate it has digits after the "+"
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits) || digits.length < 4) {
      throw new Error(`Invalid international phone number: "${raw}"`);
    }
    return cleaned; // Return with country code as-is
  }

  // Step 3: Strip "+91" prefix
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  }
  // Step 4: Strip "91" prefix if 12 digits (91 + 10-digit number)
  else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2);
  }
  // Step 5: Strip leading "0" if 11 digits (0 + 10-digit number)
  else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  // Step 6: Validate — exactly 10 digits starting with 6-9
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    throw new Error(
      `Invalid Indian phone number: "${raw}" (normalized to "${cleaned}" which is not a valid 10-digit number starting with 6-9)`,
    );
  }

  return cleaned;
}
