# Implementation Plan: WhatsApp Voice Pipeline

## Overview

Add end-to-end voice note support to the WhatsApp commerce channel. The implementation layers voice processing onto the existing Twilio webhook → EventBridge → SQS → worker architecture. Each stage has a graceful text fallback. The work proceeds bottom-up: shared utilities and adapters first, then the orchestrator in the worker, then infrastructure, and finally wiring and integration tests.

## Tasks

- [x] 1. Add `sanitizeForTTS` function to the WhatsApp sanitizer
  - [x] 1.1 Implement `sanitizeForTTS` in `services/api/src/utils/whatsapp-sanitizer.ts`
    - Add `sanitizeForTTS(text: string, audience: MessageAudience): string` that calls existing `sanitizeForWhatsApp`, then strips bold markers (`*text*`), emoji bullet prefixes, numbered-list formatting, truncates to 500 chars, and returns a role-appropriate fallback if result is empty or < 2 chars
    - Export the new function alongside existing exports
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.2 Write property test P7: TTS sanitization removes all machine artifacts and WhatsApp formatting
    - **Property 7: TTS sanitization removes all machine artifacts and WhatsApp formatting**
    - Create `services/api/src/handlers/whatsapp/__tests__/voice-pipeline.property.test.ts`
    - Use `fast-check` to generate strings with injected JSON, XML, bold markers, emoji bullets, numbered lists
    - Assert output contains none of these patterns
    - **Validates: Requirements 5.1, 5.2**

  - [x] 1.3 Write property test P8: TTS sanitization output is bounded and non-empty
    - **Property 8: TTS sanitization output is bounded and non-empty**
    - For any input string, assert output length ≤ 500 and length ≥ 2 (fallback guarantees minimum)
    - **Validates: Requirements 5.3, 5.4**

  - [x] 1.4 Write unit tests for `sanitizeForTTS` in `services/api/src/utils/__tests__/whatsapp-sanitizer.test.ts`
    - Test bold marker removal, emoji prefix removal, numbered list removal, truncation at 500 chars, empty-input fallback for seller and customer audiences
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Extend Gemini adapter with TTS method and confidence scoring
  - [x] 2.1 Update `transcribeVoiceNote` to return confidence score in `services/api/src/adapters/gemini-adapter.ts`
    - Modify the existing `VoiceTranscription` interface to add `confidence: number` (0-100)
    - Update the Gemini prompt to request a confidence score and parse it from the response
    - Ensure backward compatibility with existing callers (media-processing-worker)
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 2.2 Add `textToSpeech` method to `GeminiAdapter` in `services/api/src/adapters/gemini-adapter.ts`
    - Implement `async textToSpeech(text: string, language: string, voiceStyle?: string): Promise<Buffer>` that calls Gemini's multimodal generation with TTS output config
    - Return OGG/Opus audio buffer
    - Throw on failure so caller can handle fallback
    - _Requirements: 6.1, 6.2, 6.6_

  - [x] 2.3 Write property test P4: Transcription result always contains required fields with valid ranges
    - **Property 4: Transcription result always contains required fields with valid ranges**
    - Generate random Gemini-like JSON responses, verify parsed `TranscriptionResult` has `transcript` (string), `detectedLanguage` (string), `confidence` (0-100)
    - **Validates: Requirements 3.2**

  - [x] 2.4 Write unit tests for TTS method in `services/api/src/adapters/__tests__/gemini-adapter.test.ts`
    - Test successful audio generation, language passthrough, API failure throwing
    - _Requirements: 6.1, 6.2, 6.6_

- [x] 3. Checkpoint — Ensure sanitizer and adapter tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add `AudioMessage` type to WhatsApp sender
  - [x] 4.1 Extend `OutboundMessage` union with `AudioMessage` in `services/api/src/services/whatsapp-sender.ts`
    - Add `AudioMessage` interface: `{ type: 'audio'; mediaUrl: string; fallbackText: string }`
    - Add `AudioMessage` to the `OutboundMessage` union type
    - Update `sendWithRetry` to pass `mediaUrl` to `this.client.messages.create` when message type is `audio`
    - Update `formatMessageBody` to handle `audio` type (return fallbackText as body)
    - Update `sanitizeOutbound` to sanitize `fallbackText` for audio messages
    - Persist outbound audio messages with `messageType: 'audio'` including `mediaUrl` and `fallbackText` in content
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 4.2 Write property test P10: Audio outbound messages are persisted with correct messageType
    - **Property 10: Audio outbound messages are persisted with correct messageType**
    - Generate audio message payloads, verify persisted record has `messageType: 'audio'` with session ID, media URL, and S3 key
    - **Validates: Requirements 7.2**

- [x] 5. Implement audio validation and voice orchestrator in WhatsApp worker
  - [x] 5.1 Add `validateAudio` helper and `VOICE_CONFIG` constants to `services/api/src/handlers/whatsapp/worker.ts`
    - Define `VOICE_CONFIG` with `maxAudioSizeBytes` (16 MB), `supportedMimeTypes` array, `maxTTSTextLength` (500), `presignedUrlExpirySeconds` (600), S3 prefix patterns
    - Implement `validateAudio(mimeType: string, sizeBytes: number): { valid: boolean; reason?: string }` that checks MIME type against supported list and size against 16 MB limit
    - Add `VoiceContext` interface with `message`, `userId`, `phoneNumber`, `userRole`, `requestId`, `userProfile?`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Write property test P1: Audio validation accepts exactly the supported formats and sizes
    - **Property 1: Audio validation accepts exactly the supported formats and sizes**
    - Generate random MIME types and file sizes, verify `validateAudio` returns `valid: true` iff MIME is in supported list AND size ≤ 16 MB
    - **Validates: Requirements 2.1, 2.2**

  - [x] 5.3 Refactor `handleVoiceNote` for full voice round-trip pipeline in `services/api/src/handlers/whatsapp/worker.ts`
    - Accept `VoiceContext` with `userRole` and `requestId`
    - Step 1: Download audio from Twilio (existing `downloadTwilioMedia`), fallback on failure
    - Step 2: Validate MIME type and size via `validateAudio`, send specific error text on failure
    - Step 3: Store inbound audio in S3 under `voice/inbound/{userId}/{timestamp}.ogg` with tags `{ mediaType: 'voice', direction: 'inbound' }`
    - Step 4: Transcribe via `geminiAdapter.transcribeVoiceNote`, check confidence ≥ 30 and non-empty transcript, fallback on low confidence
    - Step 5: Route transcript — if seller, call `handleSellerWhatsAppCommand`; if customer, construct text message and route through `routeMessage`
    - Step 6: Tag agent reply with `sourceChannel: 'voice'`
    - Step 7: Sanitize reply via `sanitizeForTTS(agentReply, userRole)`
    - Step 8: Generate TTS audio via `geminiAdapter.textToSpeech`, fallback to text on failure
    - Step 9: Store outbound audio in S3 under `voice/outbound/{userId}/{timestamp}.ogg` with tags, generate pre-signed URL (10 min expiry)
    - Step 10: Send voice reply via `whatsappSender.sendMessage` with `AudioMessage`, fallback to text on failure
    - Emit metrics at each stage: `VoiceMessagesReceived`, `VoiceTranscriptionLatency`, `VoiceTTSLatency`, `VoicePipelineE2ELatency`, `VoiceFallbackToText`
    - Log structured entries at each stage with userId, requestId
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 3.1, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.5, 6.3, 6.4, 6.5, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.3, 9.4, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4_

  - [x] 5.4 Update `handleSellerMessage` to route audio messages to voice pipeline in `services/api/src/handlers/whatsapp/worker.ts`
    - When `message.type === 'audio'`, call `handleVoiceNote` with `userRole: 'seller'`, `requestId`, and `userProfile` instead of extracting `message.text.body`
    - _Requirements: 4.1, 10.1_

  - [x] 5.5 Update `handleCustomerMessage` to pass `requestId` and `userRole: 'customer'` to `handleVoiceNote` in `services/api/src/handlers/whatsapp/worker.ts`
    - Modify the existing audio branch in `handleCustomerMessage` to call the refactored `handleVoiceNote` with full `VoiceContext` instead of the current SQS-offload pattern
    - _Requirements: 4.2, 10.2_

  - [x] 5.6 Write property test P3: Low-confidence or empty transcripts trigger clarification
    - **Property 3: Low-confidence or empty transcripts trigger clarification, not agent routing**
    - Generate transcription results with confidence 0-29 or empty transcript, verify agent pipeline is never called and a clarification text is sent
    - **Validates: Requirements 3.3**

  - [x] 5.7 Write property test P5: Voice transcripts routed to correct agent pipeline based on role
    - **Property 5: Voice transcripts are routed to the correct agent pipeline based on user role**
    - Generate random roles (`seller`/`customer`) with valid transcripts, verify seller → Copilot and customer → State Router
    - **Validates: Requirements 4.1, 4.2, 10.1, 10.2**

  - [x] 5.8 Write property test P6: Voice-originated replies tagged with sourceChannel voice
    - **Property 6: Voice-originated replies are tagged with sourceChannel voice**
    - Generate voice-originated and text-originated messages, verify only voice-originated replies carry `sourceChannel: 'voice'`
    - **Validates: Requirements 4.4**

  - [x] 5.9 Write property test P9: Sanitization audience matches sender role
    - **Property 9: Sanitization audience matches sender role**
    - Generate random roles, verify `sanitizeForTTS` is called with matching audience parameter
    - **Validates: Requirements 10.3**

  - [x] 5.10 Write property test P2: S3 key pattern correctness for voice media
    - **Property 2: S3 key pattern correctness for voice media**
    - Generate random userIds and directions, verify S3 key matches `voice/{direction}/{userId}/{timestamp}.ogg`
    - **Validates: Requirements 1.3, 6.3, 9.1**

  - [x] 5.11 Write property test P11: S3 voice objects tagged with mediaType and direction
    - **Property 11: S3 voice objects are tagged with mediaType and direction**
    - Generate random directions and store operations, verify tags include `mediaType: 'voice'` and correct `direction`
    - **Validates: Requirements 9.3**

- [x] 6. Checkpoint — Ensure worker and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add S3 lifecycle rule for voice media cleanup
  - [x] 7.1 Add `voice/` prefix lifecycle rule to `infra/cdk/lib/stacks/storage-stack.ts`
    - Add a new lifecycle rule with id `expire-voice-media`, prefix `voice/`, expiration 1 day
    - Add to the existing `productImagesBucket` lifecycle rules
    - _Requirements: 9.2_

- [x] 8. Webhook and text preservation verification
  - [x] 8.1 Write property test P12: Webhook audio detection round-trip
    - **Property 12: Webhook audio detection round-trip**
    - Generate Twilio payloads with random `MediaContentType0` values, verify `audio/` prefix → `type: 'audio'` with `audio.url`, non-audio → type is not `audio`
    - **Validates: Requirements 1.1**

  - [x] 8.2 Write property test P13: Text message processing unchanged by voice pipeline
    - **Property 13: Text message processing is unchanged by voice pipeline addition**
    - Generate text-type messages, verify they never trigger voice processing logic (no audio download, no transcription, no TTS)
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

  - [x] 8.3 Write unit tests for voice pipeline in `services/api/src/handlers/whatsapp/__tests__/voice-pipeline.test.ts`
    - Test audio download success/failure with auth header, validation rejection for bad MIME and oversized files
    - Test Gemini transcription success, empty response, timeout handling
    - Test Gemini TTS success, language passthrough, failure fallback to text
    - Test S3 inbound/outbound upload with correct keys and tags, pre-signed URL generation
    - Test Twilio media send with mediaUrl, retry on 5xx, fallback to text
    - Test full fallback chain: each stage failure triggers correct fallback message
    - Test metrics emission with correct names and dimensions
    - Test seller voice routing to copilot and customer voice routing to state router
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 6.5, 7.1, 7.3, 8.1, 8.2, 8.3, 8.4, 10.1, 10.2, 11.1, 11.4_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses TypeScript throughout, matching the existing codebase
- Property tests use `fast-check` with minimum 100 iterations per property
- All 13 correctness properties from the design are covered as individual sub-tasks
- The existing `handleVoiceNote` in worker.ts currently offloads to the media-processing-worker via SQS — the refactored version processes inline for lower latency
- The existing `media-processing-worker.ts` continues to handle customer-only voice-to-cart flows independently
- Twilio adapter already supports `mediaUrl` parameter — no adapter changes needed
- Webhook handler already detects `audio/` MIME types — no webhook changes needed
