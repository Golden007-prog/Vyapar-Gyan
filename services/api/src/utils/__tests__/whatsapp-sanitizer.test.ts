// Mock the logger to avoid AsyncLocalStorage issues in tests
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { sanitizeForWhatsApp, isMachineOutput } from '../whatsapp-sanitizer';

describe('sanitizeForWhatsApp', () => {
  // ── A. Raw system/debug output must never reach WhatsApp ──────────

  it('blocks raw JSON status payloads like {"status":"received"}', () => {
    const result = sanitizeForWhatsApp('{"status":"received"}');
    expect(result).not.toContain('{');
    expect(result).not.toContain('status');
    expect(result).not.toContain('received');
  });

  it('blocks full JSON object payloads', () => {
    const result = sanitizeForWhatsApp('{"error":"something broke","code":500}');
    expect(result).not.toContain('{');
    expect(result).not.toContain('error');
  });

  it('strips <response>...</response> XML wrapper tags', () => {
    const result = sanitizeForWhatsApp('<response>Hello there</response>');
    expect(result).toBe('Hello there');
    expect(result).not.toContain('<response>');
    expect(result).not.toContain('</response>');
  });

  it('strips <thinking>...</thinking> tags', () => {
    const result = sanitizeForWhatsApp('<thinking>internal reasoning</thinking>The answer is 42');
    expect(result).not.toContain('<thinking>');
    expect(result).toContain('The answer is 42');
  });

  it('strips <answer> tags', () => {
    const result = sanitizeForWhatsApp('<answer>Your stock is 100 units</answer>');
    expect(result).toBe('Your stock is 100 units');
  });

  it('strips inline JSON debug snippets from mixed text', () => {
    const result = sanitizeForWhatsApp('Processing complete {"status":"received"} done');
    expect(result).not.toContain('{"status"');
    expect(result).toContain('Processing complete');
  });

  it('strips stack traces', () => {
    const input = 'Something went wrong\n    at Object.handler (/var/task/index.js:42:15)\n    at Runtime.handleOnce (file.js:1:1)';
    const result = sanitizeForWhatsApp(input);
    expect(result).not.toContain('at Object.handler');
    expect(result).not.toContain('/var/task');
  });

  it('strips AWS SDK error messages', () => {
    const result = sanitizeForWhatsApp('ConditionalCheckFailedException: The conditional request failed');
    expect(result).not.toContain('ConditionalCheckFailedException');
  });

  it('strips tool execution artifacts', () => {
    const result = sanitizeForWhatsApp('Tool execution failed: TypeError: Cannot read property');
    expect(result).not.toContain('Tool execution failed');
  });

  it('strips XML processing instructions', () => {
    const result = sanitizeForWhatsApp('<?xml version="1.0"?><Response></Response>');
    expect(result).not.toContain('<?xml');
  });

  // ── E. Response formatting rules ──────────────────────────────────

  it('passes through clean plain text unchanged', () => {
    const msg = 'Tata Salt 1kg is in stock.\nAvailable quantity: 100 units\nPrice: ₹25 each.';
    expect(sanitizeForWhatsApp(msg)).toBe(msg);
  });

  it('preserves emoji and ₹ symbols', () => {
    const msg = '✅ Updated Amul Butter from ₹55 to ₹60';
    expect(sanitizeForWhatsApp(msg)).toBe(msg);
  });

  it('truncates very long messages', () => {
    const longMsg = 'A'.repeat(5000);
    const result = sanitizeForWhatsApp(longMsg);
    expect(result.length).toBeLessThan(4100);
    expect(result).toContain('...message truncated');
  });

  it('collapses excessive blank lines', () => {
    const result = sanitizeForWhatsApp('Line 1\n\n\n\n\nLine 2');
    expect(result).toBe('Line 1\n\nLine 2');
  });

  // ── F. Graceful fallback behavior ─────────────────────────────────

  it('returns seller fallback for empty string', () => {
    const result = sanitizeForWhatsApp('', 'seller');
    expect(result).toContain('try again');
  });

  it('returns customer fallback for null/undefined', () => {
    const result = sanitizeForWhatsApp(null as any, 'customer');
    expect(result).toContain('something went wrong');
  });

  it('returns fallback when entire message is machine output', () => {
    const result = sanitizeForWhatsApp('[{"id":"123","status":"ok"}]');
    expect(result).not.toContain('[');
    expect(result).toContain('try again');
  });

  // ── Audience-specific fallbacks ───────────────────────────────────

  it('uses seller-appropriate fallback', () => {
    const result = sanitizeForWhatsApp('{"error":"boom"}', 'seller');
    expect(result).toContain('try again');
    expect(result).toContain('rephrase');
  });

  it('uses customer-appropriate fallback', () => {
    const result = sanitizeForWhatsApp('{"error":"boom"}', 'customer');
    expect(result).toContain('something went wrong');
  });
});

describe('isMachineOutput', () => {
  it('detects JSON objects', () => {
    expect(isMachineOutput('{"status":"received"}')).toBe(true);
  });

  it('detects JSON arrays', () => {
    expect(isMachineOutput('[{"id":1}]')).toBe(true);
  });

  it('does not flag normal text', () => {
    expect(isMachineOutput('Tata Salt is in stock')).toBe(false);
  });

  it('detects stack traces', () => {
    expect(isMachineOutput('    at Object.handler (/var/task/index.js:42:15)')).toBe(true);
  });
});


// ── sanitizeForTTS unit tests ───────────────────────────────────────────

import { sanitizeForTTS } from '../whatsapp-sanitizer';

describe('sanitizeForTTS', () => {
  // ── 5.2: WhatsApp formatting removal ──────────────────────────────

  it('removes bold markers: *bold text* → bold text', () => {
    expect(sanitizeForTTS('Here is *bold text* for you')).toBe('Here is bold text for you');
  });

  it('removes emoji bullet prefixes', () => {
    const input = '📋 Item list\n✅ Done';
    const result = sanitizeForTTS(input);
    expect(result).not.toMatch(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/mu);
    expect(result).toContain('Item list');
    expect(result).toContain('Done');
  });

  it('removes numbered list formatting', () => {
    const input = '1. First item\n2. Second item\n3. Third item';
    const result = sanitizeForTTS(input);
    expect(result).not.toMatch(/^\d+\.\s/m);
    expect(result).toContain('First item');
    expect(result).toContain('Second item');
    expect(result).toContain('Third item');
  });

  // ── 5.3: Truncation at 500 chars ─────────────────────────────────

  it('truncates input longer than 500 chars to 497 + "..."', () => {
    const longInput = 'A'.repeat(600);
    const result = sanitizeForTTS(longInput);
    expect(result.length).toBe(500);
    expect(result.endsWith('...')).toBe(true);
    expect(result.substring(0, 497)).toBe('A'.repeat(497));
  });

  it('does not truncate input at exactly 500 chars', () => {
    const input = 'B'.repeat(500);
    const result = sanitizeForTTS(input);
    expect(result).toBe(input);
  });

  // ── 5.4: Empty-input fallback ─────────────────────────────────────

  it('returns customer fallback for empty string', () => {
    const result = sanitizeForTTS('', 'customer');
    // Empty input hits sanitizeForWhatsApp first, which returns its own fallback
    expect(result).toBe("Sorry, something went wrong on our end. Please try again in a moment.");
  });

  it('returns seller fallback for empty string', () => {
    const result = sanitizeForTTS('', 'seller');
    // Empty input hits sanitizeForWhatsApp first, which returns its own fallback
    expect(result).toBe("Sorry, I couldn't process that right now. Please try again or rephrase your request.");
  });

  it('returns fallback when input becomes empty after sanitization (e.g., only JSON)', () => {
    const result = sanitizeForTTS('{"status":"received"}', 'customer');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result).not.toContain('{');
  });

  it('returns fallback when sanitized result is shorter than 2 chars', () => {
    // A single character is < 2 chars after sanitizeForWhatsApp, so it triggers the WhatsApp fallback
    const result = sanitizeForTTS('x', 'seller');
    expect(result).toBe("Sorry, I couldn't process that right now. Please try again or rephrase your request.");
  });

  // ── 5.5: Audience defaults to customer ────────────────────────────

  it('defaults audience to customer when not specified', () => {
    const result = sanitizeForTTS('');
    // Default audience is 'customer', fallback comes from sanitizeForWhatsApp
    expect(result).toBe("Sorry, something went wrong on our end. Please try again in a moment.");
  });

  // ── 5.1: Machine artifact removal (inherited from sanitizeForWhatsApp) ──

  it('strips JSON objects before TTS-specific processing', () => {
    const result = sanitizeForTTS('Your order is ready {"orderId":"123"} enjoy!');
    expect(result).not.toContain('{');
    expect(result).toContain('Your order is ready');
  });

  it('strips XML tags before TTS-specific processing', () => {
    const result = sanitizeForTTS('<response>Hello from the system</response>');
    expect(result).toBe('Hello from the system');
  });

  // ── Combined formatting removal ───────────────────────────────────

  it('handles combined bold, emoji, and numbered list formatting', () => {
    const input = '📋 *Shopping List*\n1. Tata Salt\n2. Amul Butter';
    const result = sanitizeForTTS(input);
    expect(result).not.toContain('*');
    expect(result).not.toMatch(/^\d+\.\s/m);
    expect(result).toContain('Tata Salt');
    expect(result).toContain('Amul Butter');
  });
});
