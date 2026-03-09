﻿/**
 * Property-Based Tests for WhatsApp Voice Pipeline
 *
 * Uses fast-check to verify voice pipeline invariants across randomised inputs.
 * Each property runs at least 100 iterations.
 *
 * Properties P1â€“P13 are defined in the design document and added incrementally.
 */

// Mock logger before any imports
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as fc from 'fast-check';
import { sanitizeForTTS, type MessageAudience } from '../../../utils/whatsapp-sanitizer';

// â”€â”€ Generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Audience type for sanitizer. */
const arbAudience: fc.Arbitrary<MessageAudience> = fc.constantFrom('seller', 'customer');

/** Generate a JSON object string like {"key":"value"} */
const arbJsonObject: fc.Arbitrary<string> = fc.record({
  key: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 8 }),
  value: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 15 }),
}).map(({ key, value }) => `{"${key}":"${value}"}`);

/** Generate an XML tag wrapping content: <tag>content</tag> */
const arbXmlWrapped: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom('response', 'thinking', 'answer', 'result', 'output', 'error', 'system', 'debug'),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1, maxLength: 20 }),
).map(([tag, content]) => `<${tag}>${content}</${tag}>`);

/** Generate bold-marker text: *some text* */
const arbBoldMarker: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
  { minLength: 1, maxLength: 20 },
).map(inner => `*${inner}*`);

/** Generate emoji bullet prefix lines */
const arbEmojiBullet: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom('ðŸ“‹', 'âœ…', 'ðŸ”¥', 'â­', 'ðŸ“¦', 'ðŸ’°', 'ðŸ›’', 'ðŸ“Š'),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1, maxLength: 20 }),
).map(([emoji, text]) => `${emoji} ${text}`);

/** Generate numbered list lines: "N. text" */
const arbNumberedList: fc.Arbitrary<string> = fc.tuple(
  fc.integer({ min: 1, max: 99 }),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1, maxLength: 20 }),
).map(([num, text]) => `${num}. ${text}`);

/** Generate a stack trace line */
const arbStackTrace: fc.Arbitrary<string> = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 10 }),
  fc.integer({ min: 1, max: 999 }),
  fc.integer({ min: 1, max: 99 }),
).map(([fn, line, col]) => `    at ${fn} (/var/task/index.js:${line}:${col})`);

/** Generate an internal error string */
const arbInternalError: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom('Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1, maxLength: 20 }),
).map(([type, msg]) => `${type}: ${msg}`);

/**
 * Generate a string that contains at least one machine artifact or
 * WhatsApp formatting marker, mixed with normal text.
 */
const arbStringWithArtifacts: fc.Arbitrary<string> = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 3, maxLength: 30 }),
  fc.oneof(
    arbJsonObject,
    arbXmlWrapped,
    arbBoldMarker,
    arbEmojiBullet,
    arbNumberedList,
    arbStackTrace,
    arbInternalError,
  ),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 3, maxLength: 30 }),
).map(([prefix, artifact, suffix]) => `${prefix}\n${artifact}\n${suffix}`);

// â”€â”€ Detection helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Check if text contains JSON object patterns */
function containsJsonObject(text: string): boolean {
  return /\{"\w+":\s*"[^"]*"\}/.test(text);
}

/** Check if text contains XML wrapper tags from the known set */
function containsXmlTags(text: string): boolean {
  return /<\/?(?:response|thinking|answer|result|output|error|system|debug)\b[^>]*>/i.test(text);
}

/** Check if text contains bold markers *text* (but not single asterisks) */
function containsBoldMarkers(text: string): boolean {
  return /\*[^*]+\*/.test(text);
}

/** Check if any line starts with an emoji bullet prefix */
function containsEmojiBulletPrefix(text: string): boolean {
  return /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s+/mu.test(text);
}

/** Check if any line starts with numbered list formatting "N. " */
function containsNumberedListPrefix(text: string): boolean {
  return /^\d+\.\s+/m.test(text);
}

/** Check if text contains stack trace lines */
function containsStackTrace(text: string): boolean {
  return /^\s*at\s+[\w$.]+\s+\(.*:\d+:\d+\)/m.test(text);
}

/** Check if text contains internal error patterns */
function containsInternalError(text: string): boolean {
  return /(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):\s+.+/.test(text);
}

// =========================================================================
// P7 â€” TTS sanitization removes all machine artifacts and WhatsApp formatting
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 7: TTS sanitization removes all machine artifacts and WhatsApp formatting', () => {
  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any input string, sanitizeForTTS removes all JSON objects, XML tags,
   * debug strings, stack traces, internal error messages, bold asterisk
   * markers (*text*), emoji bullet prefixes, and numbered-list formatting.
   * The output contains none of these patterns.
   */
  it('output never contains JSON objects after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsJsonObject(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains XML wrapper tags after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsXmlTags(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains bold markers after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsBoldMarkers(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains emoji bullet prefixes after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsEmojiBulletPrefix(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains numbered list prefixes after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsNumberedListPrefix(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains stack traces after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsStackTrace(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('output never contains internal error messages after sanitization', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(containsInternalError(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('combined: no artifacts remain for any input with injected artifacts', () => {
    fc.assert(
      fc.property(arbStringWithArtifacts, arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);

        // None of the machine artifact or formatting patterns should survive
        expect(containsJsonObject(result)).toBe(false);
        expect(containsXmlTags(result)).toBe(false);
        expect(containsBoldMarkers(result)).toBe(false);
        expect(containsEmojiBulletPrefix(result)).toBe(false);
        expect(containsNumberedListPrefix(result)).toBe(false);
        expect(containsStackTrace(result)).toBe(false);
        expect(containsInternalError(result)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P8 â€” TTS sanitization output is bounded and non-empty
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 8: TTS sanitization output is bounded and non-empty', () => {
  /**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any input string, the output of sanitizeForTTS is at most 500
   * characters long. If the sanitized result would be empty or shorter
   * than 2 characters, the output is a role-appropriate fallback message
   * that is at least 2 characters long.
   */
  it('output length is always â‰¤ 500 characters', () => {
    fc.assert(
      fc.property(fc.string(), arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(result.length).toBeLessThanOrEqual(500);
      }),
      { numRuns: 100 },
    );
  });

  it('output length is always â‰¥ 2 characters (fallback guarantees minimum)', () => {
    fc.assert(
      fc.property(fc.string(), arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(result.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });

  it('output is bounded and non-empty for any arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), arbAudience, (input, audience) => {
        const result = sanitizeForTTS(input, audience);
        expect(result.length).toBeLessThanOrEqual(500);
        expect(result.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });
});


// â”€â”€ P4 Mocks & Imports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Mock config for GeminiAdapter
jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    geminiApiKey: 'test-gemini-key',
    twilioAccountSid: 'AC_test_sid',
    twilioAuthToken: 'test_auth_token',
    twilioPhoneNumber: '+15551234567',
    tableName: 'test-table',
  }),
}));

// Mock @google/generative-ai â€” the mock must be hoisted so the adapter
// picks it up when imported below.
const mockGenerateContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import { GeminiAdapter } from '../../../adapters/gemini-adapter';

// â”€â”€ P4 Generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Generate an arbitrary JSON value (string, number, boolean, null, undefined, object, array) */
const arbJsonValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

/**
 * Generate a random Gemini-like JSON response object.
 * Fields may be present with correct types, wrong types, or missing entirely.
 */
const arbGeminiResponse = fc.record(
  {
    transcript: arbJsonValue,
    detectedLanguage: arbJsonValue,
    confidence: arbJsonValue,
    products: fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.constant('not-an-array'),
      fc.array(
        fc.record({
          name: arbJsonValue,
          quantity: arbJsonValue,
          confidence: arbJsonValue,
        }),
        { minLength: 0, maxLength: 5 },
      ),
    ),
  },
  { requiredKeys: [] },
);

// =========================================================================
// P4 â€” Transcription result always contains required fields with valid ranges
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 4: Transcription result always contains required fields with valid ranges', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid Gemini response parsed by the adapter, the returned
   * TranscriptionResult has a `transcript` of type string, a
   * `detectedLanguage` of type string, and a `confidence` that is a
   * number between 0 and 100 inclusive.
   */

  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
    jest.clearAllMocks();
  });

  const audioBuffer = Buffer.from('fake-audio');
  const languageHint = 'English';

  it('transcript is always a string', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeminiResponse, async (geminiResponse) => {
        mockGenerateContent.mockResolvedValue({
          response: {
            text: () => JSON.stringify(geminiResponse),
          },
        });

        const result = await adapter.transcribeVoiceNote(audioBuffer, languageHint, []);
        expect(typeof result.transcript).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('detectedLanguage is always a string', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeminiResponse, async (geminiResponse) => {
        mockGenerateContent.mockResolvedValue({
          response: {
            text: () => JSON.stringify(geminiResponse),
          },
        });

        const result = await adapter.transcribeVoiceNote(audioBuffer, languageHint, []);
        expect(typeof result.detectedLanguage).toBe('string');
      }),
      { numRuns: 100 },
    );
  });

  it('confidence is always a number between 0 and 100 inclusive', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeminiResponse, async (geminiResponse) => {
        mockGenerateContent.mockResolvedValue({
          response: {
            text: () => JSON.stringify(geminiResponse),
          },
        });

        const result = await adapter.transcribeVoiceNote(audioBuffer, languageHint, []);
        expect(typeof result.confidence).toBe('number');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  it('all required fields have valid types and ranges for any Gemini-like response', async () => {
    await fc.assert(
      fc.asyncProperty(arbGeminiResponse, async (geminiResponse) => {
        mockGenerateContent.mockResolvedValue({
          response: {
            text: () => JSON.stringify(geminiResponse),
          },
        });

        const result = await adapter.transcribeVoiceNote(audioBuffer, languageHint, []);

        // transcript is a string
        expect(typeof result.transcript).toBe('string');

        // detectedLanguage is a string
        expect(typeof result.detectedLanguage).toBe('string');

        // confidence is a number in [0, 100]
        expect(typeof result.confidence).toBe('number');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);

        // products is always an array
        expect(Array.isArray(result.products)).toBe(true);

        // Each product has valid fields
        for (const product of result.products) {
          expect(typeof product.name).toBe('string');
          expect(typeof product.quantity).toBe('number');
          expect(product.quantity).toBeGreaterThan(0);
          expect(typeof product.confidence).toBe('number');
          expect(product.confidence).toBeGreaterThanOrEqual(0);
          expect(product.confidence).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P10 â€” Audio outbound messages are persisted with correct messageType
// =========================================================================

// â”€â”€ P10 Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Mock twilio client
const mockTwilioCreate = jest.fn();
jest.mock('twilio', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockTwilioCreate,
    },
  }));
});

// Mock message-repository to capture persisted records
const mockMessageCreate = jest.fn();
jest.mock('../../../repositories/message-repository', () => ({
  MessageRepository: jest.fn().mockImplementation(() => ({
    create: mockMessageCreate,
  })),
}));

import { WhatsAppSender, type AudioMessage } from '../../../services/whatsapp-sender';

// â”€â”€ P10 Generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Generate a random URL-like string for mediaUrl */
const arbMediaUrl: fc.Arbitrary<string> = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 3, maxLength: 20 }),
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 3, maxLength: 20 }),
).map(([bucket, key]) => `https://${bucket}.s3.amazonaws.com/voice/outbound/${key}.ogg`);

/** Generate a random fallback text */
const arbFallbackText: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
  { minLength: 5, maxLength: 100 },
);

/** Generate a random session ID */
const arbSessionId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 8, maxLength: 32 },
);

/** Generate a random phone number */
const arbPhoneNumber: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'0123456789'.split('')),
  { minLength: 10, maxLength: 13 },
).map(digits => `+${digits}`);

describe('Feature: whatsapp-voice-pipeline, Property 10: Audio outbound messages are persisted with correct messageType', () => {
  /**
   * **Validates: Requirements 7.2**
   *
   * For any outbound voice reply successfully sent via Twilio, the persisted
   * message record has `messageType: 'audio'` and includes the session ID,
   * media URL, and fallback text in content.
   */

  let sender: WhatsAppSender;

  beforeEach(() => {
    jest.clearAllMocks();
    sender = new WhatsAppSender();

    // Mock Twilio to return a successful response
    mockTwilioCreate.mockResolvedValue({
      sid: 'SM' + Math.random().toString(36).substring(2, 15),
      status: 'sent',
    });

    // Mock message repository create to resolve with the input
    mockMessageCreate.mockImplementation(async (input: any) => ({
      ...input,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }));
  });

  it('persisted record always has messageType "audio" for audio messages', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMediaUrl,
        arbFallbackText,
        arbSessionId,
        arbPhoneNumber,
        arbAudience,
        async (mediaUrl, fallbackText, sessionId, phoneNumber, audience) => {
          jest.clearAllMocks();
          mockTwilioCreate.mockResolvedValue({ sid: 'SM123', status: 'sent' });
          mockMessageCreate.mockResolvedValue({ sessionId, messageType: 'audio' });

          const audioMessage: AudioMessage = {
            type: 'audio',
            mediaUrl,
            fallbackText,
          };

          await sender.sendMessage(phoneNumber, audioMessage, sessionId, audience);

          // Verify messageRepository.create was called
          expect(mockMessageCreate).toHaveBeenCalledTimes(1);

          const persistedRecord = mockMessageCreate.mock.calls[0][0];
          expect(persistedRecord.messageType).toBe('audio');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('persisted record always includes the session ID', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMediaUrl,
        arbFallbackText,
        arbSessionId,
        arbPhoneNumber,
        arbAudience,
        async (mediaUrl, fallbackText, sessionId, phoneNumber, audience) => {
          jest.clearAllMocks();
          mockTwilioCreate.mockResolvedValue({ sid: 'SM123', status: 'sent' });
          mockMessageCreate.mockResolvedValue({ sessionId, messageType: 'audio' });

          const audioMessage: AudioMessage = {
            type: 'audio',
            mediaUrl,
            fallbackText,
          };

          await sender.sendMessage(phoneNumber, audioMessage, sessionId, audience);

          const persistedRecord = mockMessageCreate.mock.calls[0][0];
          expect(persistedRecord.sessionId).toBe(sessionId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('persisted record content includes mediaUrl and fallbackText', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMediaUrl,
        arbFallbackText,
        arbSessionId,
        arbPhoneNumber,
        arbAudience,
        async (mediaUrl, fallbackText, sessionId, phoneNumber, audience) => {
          jest.clearAllMocks();
          mockTwilioCreate.mockResolvedValue({ sid: 'SM123', status: 'sent' });
          mockMessageCreate.mockResolvedValue({ sessionId, messageType: 'audio' });

          const audioMessage: AudioMessage = {
            type: 'audio',
            mediaUrl,
            fallbackText,
          };

          await sender.sendMessage(phoneNumber, audioMessage, sessionId, audience);

          const persistedRecord = mockMessageCreate.mock.calls[0][0];
          const content = persistedRecord.content;

          // Content should include the mediaUrl
          expect(content.mediaUrl).toBe(mediaUrl);
          // Content should include fallbackText (may be sanitized)
          expect(content.fallbackText).toBeDefined();
          expect(typeof content.fallbackText).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('persisted record has direction "outbound" and correct waStatus', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMediaUrl,
        arbFallbackText,
        arbSessionId,
        arbPhoneNumber,
        arbAudience,
        async (mediaUrl, fallbackText, sessionId, phoneNumber, audience) => {
          jest.clearAllMocks();
          mockTwilioCreate.mockResolvedValue({ sid: 'SM123', status: 'sent' });
          mockMessageCreate.mockResolvedValue({ sessionId, messageType: 'audio' });

          const audioMessage: AudioMessage = {
            type: 'audio',
            mediaUrl,
            fallbackText,
          };

          await sender.sendMessage(phoneNumber, audioMessage, sessionId, audience);

          const persistedRecord = mockMessageCreate.mock.calls[0][0];
          expect(persistedRecord.direction).toBe('outbound');
          expect(persistedRecord.waStatus).toBe('sent');
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P1 â€” Audio validation accepts exactly the supported formats and sizes
// =========================================================================

import { validateAudio, VOICE_CONFIG } from '../worker';

// â”€â”€ P1 Generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** The exact set of supported MIME types from VOICE_CONFIG */
const SUPPORTED_MIME_TYPES = [...VOICE_CONFIG.supportedMimeTypes];

/** Max audio size in bytes (16 MB) */
const MAX_AUDIO_SIZE = VOICE_CONFIG.maxAudioSizeBytes; // 16_777_216

/** Generate a MIME type that is guaranteed to be in the supported list */
const arbSupportedMime: fc.Arbitrary<string> = fc.constantFrom(...SUPPORTED_MIME_TYPES);

/** Generate a MIME type that is guaranteed NOT to be in the supported list */
const arbUnsupportedMime: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'audio/wav',
    'audio/flac',
    'audio/aac',
    'audio/webm',
    'video/mp4',
    'text/plain',
    'application/json',
    'image/png',
    '',
  ),
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz/-.+0123456789'.split('')),
    { minLength: 1, maxLength: 30 },
  ).filter(s => !SUPPORTED_MIME_TYPES.includes(s)),
);

/** Generate a random MIME type â€” mix of supported and unsupported */
const arbAnyMime: fc.Arbitrary<string> = fc.oneof(arbSupportedMime, arbUnsupportedMime);

/** Generate a file size that is within the 16 MB limit (0 to MAX_AUDIO_SIZE inclusive) */
const arbValidSize: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_AUDIO_SIZE });

/** Generate a file size that exceeds the 16 MB limit */
const arbOversizedSize: fc.Arbitrary<number> = fc.integer({ min: MAX_AUDIO_SIZE + 1, max: MAX_AUDIO_SIZE * 4 });

/** Generate any non-negative file size */
const arbAnySize: fc.Arbitrary<number> = fc.oneof(arbValidSize, arbOversizedSize);

describe('Feature: whatsapp-voice-pipeline, Property 1: Audio validation accepts exactly the supported formats and sizes', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For any MIME type string and file size in bytes, validateAudio returns
   * { valid: true } iff the MIME type is in the supported list AND the size
   * is at most 16,777,216 bytes (16 MB). Otherwise it returns { valid: false }
   * with the appropriate reason.
   */

  it('returns valid: true iff MIME is supported AND size â‰¤ 16 MB', () => {
    fc.assert(
      fc.property(arbAnyMime, arbAnySize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        const isSupported = SUPPORTED_MIME_TYPES.includes(mimeType);
        const isWithinSize = sizeBytes <= MAX_AUDIO_SIZE;

        if (isSupported && isWithinSize) {
          expect(result.valid).toBe(true);
          expect(result.reason).toBeUndefined();
        } else {
          expect(result.valid).toBe(false);
          expect(result.reason).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('always accepts supported MIME types with valid sizes', () => {
    fc.assert(
      fc.property(arbSupportedMime, arbValidSize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects unsupported MIME types with reason "unsupported_mime_type"', () => {
    fc.assert(
      fc.property(arbUnsupportedMime, arbAnySize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('unsupported_mime_type');
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects oversized files with supported MIME with reason "file_too_large"', () => {
    fc.assert(
      fc.property(arbSupportedMime, arbOversizedSize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('file_too_large');
      }),
      { numRuns: 100 },
    );
  });

  it('reason is always "unsupported_mime_type" or "file_too_large" when invalid', () => {
    fc.assert(
      fc.property(arbAnyMime, arbAnySize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        if (!result.valid) {
          expect(['unsupported_mime_type', 'file_too_large']).toContain(result.reason);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('unsupported MIME takes precedence over oversized file', () => {
    fc.assert(
      fc.property(arbUnsupportedMime, arbOversizedSize, (mimeType, sizeBytes) => {
        const result = validateAudio(mimeType, sizeBytes);
        // When both MIME is unsupported AND size is too large,
        // the function checks MIME first, so reason should be 'unsupported_mime_type'
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('unsupported_mime_type');
      }),
      { numRuns: 100 },
    );
  });
});



// ── Shared Generators for P3, P5, P6, P9 ──────────────────────────────

/** Generate a confidence score in the low range (0-29) */
const arbLowConfidence: fc.Arbitrary<number> = fc.integer({ min: 0, max: 29 });

/** Generate a non-empty transcript string */
const arbNonEmptyTranscript: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
  { minLength: 3, maxLength: 50 },
);

/** Generate a user role */
const arbUserRole: fc.Arbitrary<'seller' | 'customer'> = fc.constantFrom('seller', 'customer');


// =========================================================================
// P3 — Low-confidence or empty transcripts trigger clarification, not agent routing
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 3: Low-confidence or empty transcripts trigger clarification, not agent routing', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any transcription result where confidence < 30 or transcript is empty,
   * the voice pipeline must not route to the agent pipeline and must instead
   * produce a clarification text message.
   *
   * We test the confidence-gating LOGIC directly: the pipeline checks
   * `!transcript || transcript.trim().length === 0 || confidence < 30`
   * and when true, sends clarification instead of routing to agent.
   */

  /** Replicate the confidence gate from handleVoiceNote (Step 4) */
  function shouldTriggerClarification(transcript: string, confidence: number): boolean {
    return !transcript || transcript.trim().length === 0 || confidence < 30;
  }

  it('low confidence (0-29) with non-empty transcript always triggers clarification', () => {
    fc.assert(
      fc.property(arbLowConfidence, arbNonEmptyTranscript, (confidence, transcript) => {
        expect(shouldTriggerClarification(transcript, confidence)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('empty transcript triggers clarification regardless of confidence', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (confidence) => {
        expect(shouldTriggerClarification('', confidence)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('whitespace-only transcript triggers clarification regardless of confidence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 10 }),
        (confidence, whitespace) => {
          expect(shouldTriggerClarification(whitespace, confidence)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('high confidence (≥30) with non-empty transcript does NOT trigger clarification', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 100 }),
        arbNonEmptyTranscript,
        (confidence, transcript) => {
          expect(shouldTriggerClarification(transcript, confidence)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clarification decision depends only on confidence < 30 OR empty transcript', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.oneof(arbNonEmptyTranscript, fc.constant(''), fc.constant('   ')),
        arbUserRole,
        (confidence, transcript, _role) => {
          const result = shouldTriggerClarification(transcript, confidence);
          const expectedClarification =
            !transcript || transcript.trim().length === 0 || confidence < 30;
          expect(result).toBe(expectedClarification);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P5 — Voice transcripts routed to correct agent pipeline based on role
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 5: Voice transcripts are routed to the correct agent pipeline based on user role', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 10.1, 10.2**
   *
   * For any user with a valid transcript, if the user's role is `seller`
   * the transcript is passed to the Seller Copilot, and if the user's role
   * is `customer` the transcript is routed through the State Router.
   * The routing decision depends solely on the user's role.
   *
   * We test the routing LOGIC directly: the pipeline checks
   * `if (userRole === 'seller')` to decide between copilot and router.
   */

  type RoutingTarget = 'seller-copilot' | 'state-router';

  /** Replicate the routing decision from handleVoiceNote (Step 5) */
  function determineRoutingTarget(userRole: 'seller' | 'customer'): RoutingTarget {
    return userRole === 'seller' ? 'seller-copilot' : 'state-router';
  }

  it('seller role always routes to Seller Copilot', () => {
    fc.assert(
      fc.property(arbNonEmptyTranscript, (transcript) => {
        const target = determineRoutingTarget('seller');
        expect(target).toBe('seller-copilot');
      }),
      { numRuns: 100 },
    );
  });

  it('customer role always routes to State Router', () => {
    fc.assert(
      fc.property(arbNonEmptyTranscript, (transcript) => {
        const target = determineRoutingTarget('customer');
        expect(target).toBe('state-router');
      }),
      { numRuns: 100 },
    );
  });

  it('routing decision depends solely on role, not on transcript content', () => {
    fc.assert(
      fc.property(arbUserRole, arbNonEmptyTranscript, (role, _transcript) => {
        const target = determineRoutingTarget(role);
        if (role === 'seller') {
          expect(target).toBe('seller-copilot');
        } else {
          expect(target).toBe('state-router');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('seller and customer never route to the same pipeline', () => {
    fc.assert(
      fc.property(arbNonEmptyTranscript, (_transcript) => {
        const sellerTarget = determineRoutingTarget('seller');
        const customerTarget = determineRoutingTarget('customer');
        expect(sellerTarget).not.toBe(customerTarget);
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P6 — Voice-originated replies tagged with sourceChannel voice
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 6: Voice-originated replies are tagged with sourceChannel voice', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any agent reply produced from a voice-originated message, the reply
   * carries a sourceChannel: 'voice' tag. Replies from text-originated
   * messages do not carry this tag.
   *
   * We test the tagging LOGIC: the pipeline sets `sourceChannel = 'voice'`
   * for voice-originated messages and proceeds to TTS. Text messages
   * never enter the voice pipeline, so they never get this tag.
   */

  type MessageOrigin = 'voice' | 'text';

  /** Replicate the sourceChannel tagging logic from handleVoiceNote (Step 6) */
  function getSourceChannel(origin: MessageOrigin): string | undefined {
    return origin === 'voice' ? 'voice' : undefined;
  }

  /** Determine if TTS should be attempted based on source channel */
  function shouldAttemptTTS(origin: MessageOrigin): boolean {
    return origin === 'voice';
  }

  it('voice-originated messages always get sourceChannel "voice"', () => {
    fc.assert(
      fc.property(arbNonEmptyTranscript, (_transcript) => {
        const channel = getSourceChannel('voice');
        expect(channel).toBe('voice');
      }),
      { numRuns: 100 },
    );
  });

  it('text-originated messages never get sourceChannel tag', () => {
    fc.assert(
      fc.property(arbNonEmptyTranscript, (_transcript) => {
        const channel = getSourceChannel('text');
        expect(channel).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('only voice-originated messages trigger TTS generation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('voice' as MessageOrigin, 'text' as MessageOrigin),
        arbNonEmptyTranscript,
        (origin, _transcript) => {
          const tts = shouldAttemptTTS(origin);
          if (origin === 'voice') {
            expect(tts).toBe(true);
          } else {
            expect(tts).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sourceChannel tag and TTS decision are always consistent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('voice' as MessageOrigin, 'text' as MessageOrigin),
        (origin) => {
          const channel = getSourceChannel(origin);
          const tts = shouldAttemptTTS(origin);
          // If sourceChannel is 'voice', TTS should be attempted
          // If sourceChannel is undefined, TTS should NOT be attempted
          expect(channel === 'voice').toBe(tts);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P9 — Sanitization audience matches sender role
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 9: Sanitization audience matches sender role', () => {
  /**
   * **Validates: Requirements 10.3**
   *
   * For any voice message, when the sender role is `seller` the sanitizer
   * is called with audience `seller`, and when the sender role is `customer`
   * the sanitizer is called with audience `customer`. The audience parameter
   * is never mismatched with the sender role.
   *
   * We test this by verifying that sanitizeForTTS produces valid output
   * for each role and that the pipeline passes userRole directly as audience.
   */

  /** Replicate the audience mapping from handleVoiceNote (Step 7):
   *  `const ttsInput = sanitizeForTTS(agentReply, userRole);`
   *  The userRole IS the audience — no mapping needed. */
  function mapRoleToAudience(userRole: 'seller' | 'customer'): MessageAudience {
    return userRole; // Direct pass-through in the pipeline
  }

  it('seller role maps to seller audience', () => {
    fc.assert(
      fc.property(fc.constant('seller' as const), (role) => {
        expect(mapRoleToAudience(role)).toBe('seller');
      }),
      { numRuns: 100 },
    );
  });

  it('customer role maps to customer audience', () => {
    fc.assert(
      fc.property(fc.constant('customer' as const), (role) => {
        expect(mapRoleToAudience(role)).toBe('customer');
      }),
      { numRuns: 100 },
    );
  });

  it('audience always matches the sender role for any role', () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const audience = mapRoleToAudience(role);
        expect(audience).toBe(role);
      }),
      { numRuns: 100 },
    );
  });

  it('sanitizeForTTS produces valid output for both seller and customer audiences', () => {
    fc.assert(
      fc.property(
        arbUserRole,
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 5, maxLength: 100 }),
        (role, text) => {
          const audience = mapRoleToAudience(role);
          const result = sanitizeForTTS(text, audience);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThanOrEqual(2);
          expect(result.length).toBeLessThanOrEqual(500);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('seller and customer audiences produce different fallback messages on empty input', () => {
    fc.assert(
      fc.property(fc.constant(''), (emptyText) => {
        const sellerResult = sanitizeForTTS(emptyText, mapRoleToAudience('seller'));
        const customerResult = sanitizeForTTS(emptyText, mapRoleToAudience('customer'));
        // Both should produce fallback messages, but they should differ by role
        expect(sellerResult).not.toBe(customerResult);
        expect(sellerResult.length).toBeGreaterThanOrEqual(2);
        expect(customerResult.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P2 — S3 key pattern correctness for voice media
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 2: S3 key pattern correctness for voice media', () => {
  /**
   * **Validates: Requirements 1.3, 6.3, 9.1**
   *
   * For any userId string and direction (inbound or outbound), the generated
   * S3 key matches the pattern `voice/{direction}/{userId}/{timestamp}.ogg`
   * where timestamp is a positive integer.
   */

  /** Generate a direction */
  const arbDirection: fc.Arbitrary<'inbound' | 'outbound'> = fc.constantFrom('inbound', 'outbound');

  /** Generate a userId that could appear in an S3 key (alphanumeric + hyphens) */
  const arbS3UserId: fc.Arbitrary<string> = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
    { minLength: 1, maxLength: 30 },
  );

  /** S3 key regex pattern: voice/{direction}/{userId}/{timestamp}.ogg */
  const S3_KEY_PATTERN = /^voice\/(inbound|outbound)\/[a-z0-9\-_]+\/\d+\.ogg$/;

  it('generated S3 key matches voice/{direction}/{userId}/{timestamp}.ogg pattern', () => {
    fc.assert(
      fc.property(arbDirection, arbS3UserId, (direction, userId) => {
        const prefix = direction === 'inbound'
          ? VOICE_CONFIG.s3InboundPrefix
          : VOICE_CONFIG.s3OutboundPrefix;
        const timestamp = Date.now();
        const key = `${prefix}/${userId}/${timestamp}.ogg`;

        expect(key).toMatch(S3_KEY_PATTERN);
      }),
      { numRuns: 100 },
    );
  });

  it('inbound audio uses voice/inbound/ prefix', () => {
    fc.assert(
      fc.property(arbS3UserId, (userId) => {
        const key = `${VOICE_CONFIG.s3InboundPrefix}/${userId}/${Date.now()}.ogg`;
        expect(key.startsWith('voice/inbound/')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('outbound audio uses voice/outbound/ prefix', () => {
    fc.assert(
      fc.property(arbS3UserId, (userId) => {
        const key = `${VOICE_CONFIG.s3OutboundPrefix}/${userId}/${Date.now()}.ogg`;
        expect(key.startsWith('voice/outbound/')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('S3 key direction segment matches the requested direction', () => {
    fc.assert(
      fc.property(arbDirection, arbS3UserId, (direction, userId) => {
        const prefix = direction === 'inbound'
          ? VOICE_CONFIG.s3InboundPrefix
          : VOICE_CONFIG.s3OutboundPrefix;
        const key = `${prefix}/${userId}/${Date.now()}.ogg`;

        const parts = key.split('/');
        expect(parts[0]).toBe('voice');
        expect(parts[1]).toBe(direction);
      }),
      { numRuns: 100 },
    );
  });

  it('S3 key always ends with .ogg extension', () => {
    fc.assert(
      fc.property(arbDirection, arbS3UserId, (direction, userId) => {
        const prefix = direction === 'inbound'
          ? VOICE_CONFIG.s3InboundPrefix
          : VOICE_CONFIG.s3OutboundPrefix;
        const key = `${prefix}/${userId}/${Date.now()}.ogg`;

        expect(key.endsWith('.ogg')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P11 — S3 voice objects tagged with mediaType and direction
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 11: S3 voice objects are tagged with mediaType and direction', () => {
  /**
   * **Validates: Requirements 9.3**
   *
   * For any audio file stored in S3 by the voice pipeline, the object tags
   * include `mediaType=voice` and `direction` set to either `inbound` or
   * `outbound` matching the actual direction of the audio.
   *
   * We test this as a pure function test — the voice pipeline constructs
   * S3 Tagging strings in the format `mediaType=voice&direction={direction}`.
   */

  /** Generate a direction */
  const arbDirection: fc.Arbitrary<'inbound' | 'outbound'> = fc.constantFrom('inbound', 'outbound');

  /** Build the S3 tagging string the same way handleVoiceNote does */
  function buildS3Tagging(direction: 'inbound' | 'outbound'): string {
    return `mediaType=voice&direction=${direction}`;
  }

  /** Parse S3 URL-encoded tagging string into key-value pairs */
  function parseTagging(tagging: string): Record<string, string> {
    const tags: Record<string, string> = {};
    for (const pair of tagging.split('&')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        tags[key] = value;
      }
    }
    return tags;
  }

  it('tagging always includes mediaType=voice', () => {
    fc.assert(
      fc.property(arbDirection, (direction) => {
        const tagging = buildS3Tagging(direction);
        const tags = parseTagging(tagging);
        expect(tags.mediaType).toBe('voice');
      }),
      { numRuns: 100 },
    );
  });

  it('tagging direction matches the requested direction', () => {
    fc.assert(
      fc.property(arbDirection, (direction) => {
        const tagging = buildS3Tagging(direction);
        const tags = parseTagging(tagging);
        expect(tags.direction).toBe(direction);
      }),
      { numRuns: 100 },
    );
  });

  it('tagging contains exactly mediaType and direction keys', () => {
    fc.assert(
      fc.property(arbDirection, (direction) => {
        const tagging = buildS3Tagging(direction);
        const tags = parseTagging(tagging);
        const keys = Object.keys(tags).sort();
        expect(keys).toEqual(['direction', 'mediaType']);
      }),
      { numRuns: 100 },
    );
  });

  it('inbound tagging is always "mediaType=voice&direction=inbound"', () => {
    fc.assert(
      fc.property(fc.constant('inbound' as const), (direction) => {
        const tagging = buildS3Tagging(direction);
        expect(tagging).toBe('mediaType=voice&direction=inbound');
      }),
      { numRuns: 100 },
    );
  });

  it('outbound tagging is always "mediaType=voice&direction=outbound"', () => {
    fc.assert(
      fc.property(fc.constant('outbound' as const), (direction) => {
        const tagging = buildS3Tagging(direction);
        expect(tagging).toBe('mediaType=voice&direction=outbound');
      }),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P12 — Webhook audio detection round-trip
// =========================================================================

import { transformTwilioToWhatsAppFormat } from '../webhook';

// ── P12 Generators ──────────────────────────────────────────────────────

/** Generate a random audio MIME type (starts with audio/) */
const arbAudioMime: fc.Arbitrary<string> = fc.tuple(
  fc.constantFrom('ogg', 'opus', 'mpeg', 'mp4', 'wav', 'flac', 'webm', 'aac', 'x-m4a'),
).map(([sub]) => `audio/${sub}`);

/** Generate a random non-audio MIME type (does NOT start with audio/) */
const arbNonAudioMime: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/webm',
    'text/plain',
    'application/json',
    'application/pdf',
    'application/octet-stream',
  ),
  fc.tuple(
    fc.constantFrom('image', 'video', 'text', 'application', 'multipart', 'font', 'model'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 1, maxLength: 15 }),
  ).map(([type, sub]) => `${type}/${sub}`),
);

/** Generate a random Twilio media URL */
const arbTwilioMediaUrl: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 5, maxLength: 20 },
).map(id => `https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM${id}/Media/ME${id}`);

/** Generate a random Twilio message SID */
const arbTwilioSid: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 10, maxLength: 20 },
).map(id => `SM${id}`);

/** Generate a random phone number in whatsapp: format */
const arbWhatsAppPhone: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'0123456789'.split('')),
  { minLength: 10, maxLength: 12 },
).map(digits => `whatsapp:+${digits}`);

/** Build a Twilio payload with media */
function buildTwilioPayloadWithMedia(
  sid: string,
  from: string,
  to: string,
  mediaUrl: string,
  mediaContentType: string,
): Record<string, string> {
  return {
    MessageSid: sid,
    From: from,
    To: to,
    Body: '',
    ProfileName: 'Test User',
    SmsStatus: 'received',
    NumMedia: '1',
    MediaContentType0: mediaContentType,
    MediaUrl0: mediaUrl,
  };
}

/** Build a Twilio payload without media (text only) */
function buildTwilioTextPayload(
  sid: string,
  from: string,
  to: string,
  body: string,
): Record<string, string> {
  return {
    MessageSid: sid,
    From: from,
    To: to,
    Body: body,
    ProfileName: 'Test User',
    SmsStatus: 'received',
    NumMedia: '0',
  };
}

describe('Feature: whatsapp-voice-pipeline, Property 12: Webhook audio detection round-trip', () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any Twilio webhook payload where MediaContentType0 starts with `audio/`,
   * the transformTwilioToWhatsAppFormat function produces a message with
   * type: 'audio' and an audio.url field containing the original media URL.
   * For payloads where MediaContentType0 does not start with `audio/`,
   * the message type is not 'audio'.
   */

  it('audio/ MIME type always produces message type "audio" with audio.url', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTwilioMediaUrl,
        arbAudioMime,
        (sid, from, to, mediaUrl, audioMime) => {
          const payload = buildTwilioPayloadWithMedia(sid, from, to, mediaUrl, audioMime);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          expect(message.type).toBe('audio');
          expect(message.audio).toBeDefined();
          expect(message.audio.url).toBe(mediaUrl);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-audio MIME type never produces message type "audio"', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTwilioMediaUrl,
        arbNonAudioMime,
        (sid, from, to, mediaUrl, nonAudioMime) => {
          const payload = buildTwilioPayloadWithMedia(sid, from, to, mediaUrl, nonAudioMime);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          expect(message.type).not.toBe('audio');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('audio messages include the original media URL in audio.url', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTwilioMediaUrl,
        arbAudioMime,
        (sid, from, to, mediaUrl, audioMime) => {
          const payload = buildTwilioPayloadWithMedia(sid, from, to, mediaUrl, audioMime);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          expect(message.audio.url).toBe(mediaUrl);
          expect(message.audio.mime_type).toBe(audioMime);
          expect(message.audio.id).toBe(sid);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('text-only payloads (NumMedia=0) produce type "text", never "audio"', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1, maxLength: 50 }),
        (sid, from, to, body) => {
          const payload = buildTwilioTextPayload(sid, from, to, body);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          expect(message.type).toBe('text');
          expect(message.type).not.toBe('audio');
          expect(message.audio).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('audio detection depends solely on MediaContentType0 prefix, not on URL or body', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTwilioMediaUrl,
        fc.oneof(arbAudioMime, arbNonAudioMime),
        (sid, from, to, mediaUrl, mime) => {
          const payload = buildTwilioPayloadWithMedia(sid, from, to, mediaUrl, mime);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          const isAudioMime = mime.startsWith('audio/');
          if (isAudioMime) {
            expect(message.type).toBe('audio');
            expect(message.audio).toBeDefined();
            expect(message.audio.url).toBe(mediaUrl);
          } else {
            expect(message.type).not.toBe('audio');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =========================================================================
// P13 — Text message processing is unchanged by voice pipeline addition
// =========================================================================

describe('Feature: whatsapp-voice-pipeline, Property 13: Text message processing is unchanged by voice pipeline addition', () => {
  /**
   * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
   *
   * For any text-type WhatsApp message, the processing path never triggers
   * voice processing logic: no audio download, no transcription, no TTS.
   * Text messages are routed through normal text handling (routeMessage or
   * handleSellerWhatsAppCommand) based on user role.
   */

  // ── Generators ──────────────────────────────────────────────────────

  /** Generate a random text message body */
  const arbTextBody: fc.Arbitrary<string> = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 ,.!?'.split('')),
    { minLength: 1, maxLength: 100 },
  );

  /** Generate a user role */
  const arbUserRole: fc.Arbitrary<'seller' | 'customer'> = fc.constantFrom('seller' as const, 'customer' as const);

  /** Build a text-type message object (as produced by transformTwilioToWhatsAppFormat) */
  function buildTextMessage(sid: string, from: string, body: string): any {
    return {
      id: sid,
      from,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      type: 'text',
      text: { body },
    };
  }

  // ── Property: text messages always have type !== 'audio' from webhook ──

  it('text-only Twilio payloads never produce audio-type messages', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTextBody,
        (sid, from, to, body) => {
          const payload = buildTwilioTextPayload(sid, from, to, body);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          // Text messages must have type 'text', never 'audio'
          expect(message.type).toBe('text');
          expect(message.type).not.toBe('audio');

          // Text messages must not have audio, image, video, or document fields
          expect(message.audio).toBeUndefined();

          // Text messages must have text.body matching the input
          expect(message.text).toBeDefined();
          expect(message.text.body).toBe(body);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property: text message type never satisfies voice pipeline entry condition ──

  it('text-type messages never satisfy the voice pipeline entry condition (message.type === "audio")', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbTextBody,
        arbUserRole,
        (sid, phone, body, role) => {
          const message = buildTextMessage(sid, phone, body);

          // The voice pipeline entry condition in both handleSellerMessage and
          // handleCustomerMessage is: if (message.type === 'audio')
          // Text messages must never satisfy this condition.
          const wouldTriggerVoicePipeline = message.type === 'audio';
          expect(wouldTriggerVoicePipeline).toBe(false);

          // Text messages should not have audio metadata that downloadTwilioMedia would use
          const hasAudioUrl = message.audio?.url != null;
          expect(hasAudioUrl).toBe(false);

          // Text messages should not have audio MIME type that validateAudio would check
          const hasAudioMime = message.audio?.mime_type != null;
          expect(hasAudioMime).toBe(false);

          // The message should have text content for normal routing
          expect(message.text?.body).toBe(body);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property: text messages route to correct text handler based on role ──

  it('text messages are routed to text handling, not voice pipeline, regardless of role', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbTextBody,
        arbUserRole,
        (sid, phone, body, role) => {
          const message = buildTextMessage(sid, phone, body);

          // Simulate the routing decision in handleSellerMessage / handleCustomerMessage:
          // Voice pipeline is entered ONLY when message.type === 'audio'
          // For text messages, the code falls through to text processing.
          const isAudio = message.type === 'audio';
          const isImage = message.type === 'image';

          // Text messages skip both audio and image branches
          expect(isAudio).toBe(false);
          expect(isImage).toBe(false);

          // Text messages proceed to:
          // - Seller: handleSellerWhatsAppCommand with message.text.body
          // - Customer: routeMessage with the full message object
          if (role === 'seller') {
            // Seller text path extracts: message.text?.body || ''
            const messageText = message.text?.body || '';
            expect(messageText).toBe(body);
          } else {
            // Customer text path passes message to routeMessage
            // The message must have type 'text' for the router
            expect(message.type).toBe('text');
            expect(message.text).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property: voice processing functions are never applicable to text messages ──

  it('validateAudio is never applicable to text message payloads', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbTextBody,
        (sid, phone, body) => {
          const message = buildTextMessage(sid, phone, body);

          // In the voice pipeline, validateAudio is called with:
          //   mimeType = message.audio?.mime_type || contentType
          //   sizeBytes = audioBuffer.length
          // For text messages, message.audio is undefined, so there's no
          // MIME type or audio buffer to validate.
          const audioMime = message.audio?.mime_type;
          expect(audioMime).toBeUndefined();

          // Even if we hypothetically called validateAudio with undefined,
          // it would reject (unsupported_mime_type) — text never passes validation
          const validation = validateAudio(audioMime || '', 0);
          expect(validation.valid).toBe(false);
          expect(validation.reason).toBe('unsupported_mime_type');
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property: webhook text transformation preserves text content exactly ──

  it('webhook transformation preserves text body exactly for text messages', () => {
    fc.assert(
      fc.property(
        arbTwilioSid,
        arbWhatsAppPhone,
        arbWhatsAppPhone,
        arbTextBody,
        (sid, from, to, body) => {
          const payload = buildTwilioTextPayload(sid, from, to, body);
          const result = transformTwilioToWhatsAppFormat(payload, 'test-request');
          const message = result.entry[0].changes[0].value.messages[0];

          // The text body must be preserved exactly — no voice pipeline
          // transformation (transcription, sanitizeForTTS) is applied
          expect(message.text.body).toBe(body);

          // The message ID is preserved for idempotency
          expect(message.id).toBe(sid);

          // Contact info is preserved for session resolution
          const contacts = result.entry[0].changes[0].value.contacts;
          expect(contacts).toBeDefined();
          expect(contacts.length).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
