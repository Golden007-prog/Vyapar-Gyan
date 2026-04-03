/**
 * Unit Tests for WhatsApp Voice Pipeline
 * Calls exported handleVoiceNote directly.
 * Validates: Requirements 1.2-1.5, 2.1-2.5, 3.1, 3.3, 6.5, 7.1, 7.3, 8.1-8.4, 10.1, 10.2, 11.1, 11.4
 */
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

const mockSendMessage = jest.fn().mockResolvedValue('msg-sid');
jest.mock('../../../services/whatsapp-sender', () => ({ whatsappSender: { sendMessage: (...args: any[]) => mockSendMessage(...args) } }));

jest.mock('../../../utils/config', () => ({ getConfig: jest.fn().mockResolvedValue({ twilioAccountSid: 'AC_TEST_SID', twilioAuthToken: 'test_auth_token', productImagesBucket: 'test-media-bucket' }) }));
jest.mock('../../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../utils/idempotency', () => ({ idempotencyService: { acquireLock: jest.fn().mockResolvedValue(true) } }));

const mockGetUserByPhone = jest.fn();
jest.mock('../../../adapters/dynamodb-adapter', () => ({ getUserByPhone: (...args: any[]) => mockGetUserByPhone(...args), putMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../services/session-service', () => ({ resolveOrCreateSession: jest.fn().mockResolvedValue({ session: { state: 'browsing', createdAt: '2025-01-01T00:00:00Z', lastActivityAt: '2025-01-01T00:00:00Z', expiresAt: Math.floor(Date.now() / 1000) + 86400 }, isNew: false, restoredCart: null }) }));
jest.mock('../../../services/consent-service', () => ({ recordInboundMessage: jest.fn().mockResolvedValue(undefined), handleOptOut: jest.fn().mockResolvedValue(false) }));
jest.mock('../../../repositories/customer-repository', () => ({ CustomerRepository: jest.fn().mockImplementation(() => ({ resolveOrCreate: jest.fn().mockResolvedValue({ id: 'cust-123' }) })) }));

const mockRouteMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../states/router', () => ({ routeMessage: (...args: any[]) => mockRouteMessage(...args) }));

const mockSellerCmd = jest.fn().mockResolvedValue('Stock updated!');
jest.mock('../../../services/whatsapp/seller-copilot', () => ({ handleSellerWhatsAppCommand: (...args: any[]) => mockSellerCmd(...args) }));

const mockTranscribe = jest.fn().mockResolvedValue({ transcript: 'Show stock', detectedLanguage: 'English', confidence: 90, products: [] });
const mockTTS = jest.fn().mockResolvedValue(Buffer.from('fake-tts'));
jest.mock('../../../adapters/gemini-adapter', () => ({ GeminiAdapter: jest.fn().mockImplementation(() => ({ transcribeVoiceNote: (...args: any[]) => mockTranscribe(...args), textToSpeech: (...args: any[]) => mockTTS(...args) })) }));

const mockCountMetric = jest.fn();
const mockLatencyMetric = jest.fn();
jest.mock('../../../core/metrics', () => ({ publishCountMetric: (...args: any[]) => mockCountMetric(...args), publishLatencyMetric: (...args: any[]) => mockLatencyMetric(...args) }));

const mockSignedUrl = jest.fn().mockResolvedValue('https://s3.example.com/presigned-url');
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: (...args: any[]) => mockSignedUrl(...args) }));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;
process.env.MEDIA_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/q';
process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_SID';


import { handler, handleVoiceNote, validateAudio, VOICE_CONFIG, VoiceContext } from '../worker';

const SELLER = { userId: 'seller-001', role: 'seller', sellerStatus: 'approved', displayName: 'Seller', phoneNumber: '91001', cognitoId: 'c1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' };
const CUSTOMER = { userId: 'cust-001', role: 'customer', displayName: 'Customer', phoneNumber: '91002' };

function vc(o: Partial<VoiceContext> = {}): VoiceContext {
  return {
    message: { id: 'wamid.v1', type: 'audio', from: '91001', timestamp: '1700000000', audio: { id: 'mid', url: 'https://api.twilio.com/media/a1', mime_type: 'audio/ogg' } },
    userId: 'seller-001', phoneNumber: '91001', userRole: 'seller', requestId: 'req-1', userProfile: SELLER,
    ...o,
  };
}

function dl(ct = 'audio/ogg', sz = 1024) {
  const b = Buffer.alloc(sz, 0xab);
  mockFetch.mockResolvedValueOnce({ ok: true, headers: { get: (n: string) => n === 'content-type' ? ct : null }, arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
}

function sqsEv(msg: any, from: string): SQSEvent {
  return { Records: [{ messageId: 's1', body: JSON.stringify({ detail: { requestId: 'req-1', payload: { entry: [{ changes: [{ field: 'messages', value: { messages: [{ ...msg, from }], contacts: [{ wa_id: from, profile: { name: 'T' } }] } }] }] } } }), receiptHandle: 'h', attributes: {} as any, messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: 'arn:aws:sqs:us-east-1:1:q', awsRegion: 'us-east-1' }] };
}


describe('Voice Pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    sqsMock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    mockGetUserByPhone.mockResolvedValue(CUSTOMER);
  });

  // ── Audio Download (Req 1.2, 1.4, 1.5) ─────────────────────────────

  describe('Audio download', () => {
    it('downloads with Basic auth header', async () => {
      dl();
      await handleVoiceNote(vc());
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const authHeader = mockFetch.mock.calls[0][1].headers.Authorization as string;
      const decoded = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('AC_TEST_SID:test_auth_token');
    });

    it('sends fallback on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'NF' });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't process") }),
        expect.anything(), expect.anything(),
      );
      expect(mockTranscribe).not.toHaveBeenCalled();
    });

    it('sends fallback on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't process") }),
        expect.anything(), expect.anything(),
      );
    });

    it('sends fallback when no media URL present', async () => {
      await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: {} } }));
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't process") }),
        expect.anything(), expect.anything(),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Audio Validation (Req 2.1-2.5) ──────────────────────────────────

  describe('Audio validation', () => {
    it('accepts all supported MIME types', () => {
      for (const m of VOICE_CONFIG.supportedMimeTypes) {
        expect(validateAudio(m, 1024)).toEqual({ valid: true });
      }
    });

    it('rejects unsupported MIME type', () => {
      expect(validateAudio('audio/wav', 1024)).toEqual({ valid: false, reason: 'unsupported_mime_type' });
    });

    it('rejects files > 16 MB', () => {
      expect(validateAudio('audio/ogg', VOICE_CONFIG.maxAudioSizeBytes + 1)).toEqual({ valid: false, reason: 'file_too_large' });
    });

    it('accepts exactly 16 MB', () => {
      expect(validateAudio('audio/ogg', VOICE_CONFIG.maxAudioSizeBytes)).toEqual({ valid: true });
    });

    it('sends format error message for bad MIME', async () => {
      dl('audio/wav');
      await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/wav' } } }));
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("audio format") }),
        expect.anything(), expect.anything(),
      );
    });

    it('sends size error message for oversized file', async () => {
      const big = Buffer.alloc(VOICE_CONFIG.maxAudioSizeBytes + 100, 0xab);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'audio/ogg' },
        arrayBuffer: () => Promise.resolve(big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength)),
      });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining('too long') }),
        expect.anything(), expect.anything(),
      );
    });
  });


  // ── Gemini Transcription (Req 3.1, 3.3) ─────────────────────────────

  describe('Gemini transcription', () => {
    it('calls transcribeVoiceNote with audio buffer', async () => {
      dl();
      await handleVoiceNote(vc());
      expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), 'auto', []);
    });

    it('sends clarification on empty transcript', async () => {
      dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: '', detectedLanguage: 'English', confidence: 50, products: [] });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't quite understand") }),
        expect.anything(), expect.anything(),
      );
      expect(mockSellerCmd).not.toHaveBeenCalled();
    });

    it('sends clarification on confidence < 30', async () => {
      dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: 'text', detectedLanguage: 'Hindi', confidence: 20, products: [] });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't quite understand") }),
        expect.anything(), expect.anything(),
      );
    });

    it('sends unavailable message on Gemini error', async () => {
      dl();
      mockTranscribe.mockRejectedValueOnce(new Error('timeout'));
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining('temporarily unavailable') }),
        expect.anything(), expect.anything(),
      );
    });
  });

  // ── S3 Storage (Req 1.3, 6.3, 9.1, 9.3) ───────────────────────────

  describe('S3 storage', () => {
    it('stores inbound audio with correct key pattern and tags', async () => {
      dl();
      await handleVoiceNote(vc());
      const c = s3Mock.commandCalls(PutObjectCommand).find(c => (c.args[0].input.Key as string).startsWith('voice/inbound/'));
      expect(c).toBeTruthy();
      expect(c!.args[0].input.Key).toMatch(/^voice\/inbound\/seller-001\/\d+\.ogg$/);
      expect(c!.args[0].input.Tagging).toBe('mediaType=voice&direction=inbound');
    });

    it('continues pipeline if inbound S3 upload fails', async () => {
      dl();
      s3Mock.reset();
      s3Mock.on(PutObjectCommand).rejectsOnce(new Error('S3')).resolves({});
      await handleVoiceNote(vc());
      expect(mockTranscribe).toHaveBeenCalled();
    });
  });

  // ── Metrics (Req 11.1, 11.4) ────────────────────────────────────────

  describe('Metrics', () => {
    it('emits VoiceMessagesReceived on audio message', async () => {
      dl();
      await handleVoiceNote(vc());
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'seller' });
    });

    it('emits VoiceTranscriptionLatency on successful transcription', async () => {
      dl();
      await handleVoiceNote(vc());
      expect(mockLatencyMetric).toHaveBeenCalledWith('VoiceTranscriptionLatency', expect.any(Number), { Channel: 'whatsapp' });
    });

    it('emits VoiceFallbackToText stage=download on download failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('f'));
      await handleVoiceNote(vc());
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'download' });
    });

    it('emits VoiceFallbackToText stage=validation on bad MIME', async () => {
      dl('audio/wav');
      await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/wav' } } }));
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'validation' });
    });

    it('emits VoiceFallbackToText stage=transcription on Gemini error', async () => {
      dl();
      mockTranscribe.mockRejectedValueOnce(new Error('timeout'));
      await handleVoiceNote(vc());
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'transcription' });
    });

    it('emits customer role dimension', async () => {
      dl();
      await handleVoiceNote(vc({ userRole: 'customer', userId: 'cust-001' }));
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'customer' });
    });
  });


  // ── Fallback Chain (Req 8.1-8.4) ────────────────────────────────────

  describe('Fallback chain', () => {
    it('download failure → no transcription, no TTS', async () => {
      mockFetch.mockRejectedValueOnce(new Error('net'));
      await handleVoiceNote(vc());
      expect(mockTranscribe).not.toHaveBeenCalled();
      expect(mockTTS).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('bad MIME → format error, no transcription', async () => {
      dl('audio/flac');
      await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/flac' } } }));
      expect(mockTranscribe).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("audio format") }),
        expect.anything(), expect.anything(),
      );
    });

    it('transcription failure → unavailable, no TTS', async () => {
      dl();
      mockTranscribe.mockRejectedValueOnce(new Error('d'));
      await handleVoiceNote(vc());
      expect(mockTTS).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining('temporarily unavailable') }),
        expect.anything(), expect.anything(),
      );
    });

    it('low confidence → clarification, no TTS', async () => {
      dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: 'unclear', detectedLanguage: 'English', confidence: 5, products: [] });
      await handleVoiceNote(vc());
      expect(mockTTS).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: expect.stringContaining("couldn't quite understand") }),
        expect.anything(), expect.anything(),
      );
    });
  });

  // ── Role-based Routing (Req 10.1, 10.2) ────────────────────────────

  describe('Role-based routing', () => {
    it('customer routes to state router with transcript as text message', async () => {
      mockGetUserByPhone.mockResolvedValue(CUSTOMER);
      dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: 'Buy dal', detectedLanguage: 'Hindi', confidence: 88, products: [] });
      await handleVoiceNote(vc({ userRole: 'customer', userId: 'cust-001', phoneNumber: '91002' }));
      expect(mockRouteMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ type: 'text', text: { body: 'Buy dal' } }),
          requestId: 'req-1',
        }),
      );
      expect(mockSellerCmd).not.toHaveBeenCalled();
    });

    it('customer audio via handler() triggers voice pipeline', async () => {
      mockGetUserByPhone.mockResolvedValue(CUSTOMER);
      dl();
      await handler(sqsEv({ id: 'wamid.cv', type: 'audio', timestamp: '1700000000', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/ogg' } }, '91002'));
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'customer' });
      expect(mockTranscribe).toHaveBeenCalled();
    });

    it('does not route to agent when confidence is low', async () => {
      dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: 'mumble', detectedLanguage: 'English', confidence: 10, products: [] });
      await handleVoiceNote(vc());
      expect(mockRouteMessage).not.toHaveBeenCalled();
      expect(mockSellerCmd).not.toHaveBeenCalled();
    });
  });

  // ── Text Message Preservation (Req 12.1-12.4) ──────────────────────

  describe('Text message preservation', () => {
    it('text messages do not trigger voice pipeline', async () => {
      const event = sqsEv({ id: 'wamid.text-1', type: 'text', timestamp: '1700000000', text: { body: 'Hello world' } }, '91002');
      mockGetUserByPhone.mockResolvedValue(CUSTOMER);
      await handler(event);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockTranscribe).not.toHaveBeenCalled();
      expect(mockTTS).not.toHaveBeenCalled();
      const voiceCalls = s3Mock.commandCalls(PutObjectCommand).filter(c => (c.args[0].input.Key as string)?.startsWith('voice/'));
      expect(voiceCalls).toHaveLength(0);
    });
  });
});
