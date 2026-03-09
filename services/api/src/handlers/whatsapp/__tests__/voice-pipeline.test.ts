/**
 * Unit Tests for WhatsApp Voice Pipeline
 * Calls exported handleVoiceNote directly (avoids dynamic import() in Jest).
 * Validates: Requirements 1.2-1.5, 2.1-2.5, 3.1, 3.3, 6.5, 7.1, 7.3, 8.1-8.4, 10.1, 10.2, 11.1, 11.4
 */
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { SQSEvent } from 'aws-lambda';
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);
const cwMock = mockClient(CloudWatchClient);
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
  return { message: { id: 'wamid.v1', type: 'audio', from: '91001', timestamp: '1700000000', audio: { id: 'mid', url: 'https://api.twilio.com/media/a1', mime_type: 'audio/ogg' } }, userId: 'seller-001', phoneNumber: '91001', userRole: 'seller', requestId: 'req-1', userProfile: SELLER, ...o };
}
function dl(ct = 'audio/ogg', sz = 1024) {
  const b = Buffer.alloc(sz, 0xab);
  mockFetch.mockResolvedValueOnce({ ok: true, headers: { get: (n: string) => n === 'content-type' ? ct : null }, arrayBuffer: () => Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) });
}
function sqsEv(msg: any, from: string): SQSEvent {
  return { Records: [{ messageId: 's1', body: JSON.stringify({ detail: { requestId: 'req-1', payload: { entry: [{ changes: [{ field: 'messages', value: { messages: [{ ...msg, from }], contacts: [{ wa_id: from, profile: { name: 'T' } }] } }] }] } } }), receiptHandle: 'h', attributes: {} as any, messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: 'arn:aws:sqs:us-east-1:1:q', awsRegion: 'us-east-1' }] };
}
describe('Voice Pipeline', () => {
  beforeEach(() => { jest.clearAllMocks(); s3Mock.reset(); sqsMock.reset(); cwMock.reset(); s3Mock.on(PutObjectCommand).resolves({}); cwMock.on(PutMetricDataCommand).resolves({}); mockGetUserByPhone.mockResolvedValue(CUSTOMER); });

  describe('Audio download (Req 1.2, 1.4, 1.5)', () => {
    it('downloads with Basic auth', async () => {
      dl(); await handleVoiceNote(vc());
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const decoded = Buffer.from((mockFetch.mock.calls[0][1].headers.Authorization as string).replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe('AC_TEST_SID:test_auth_token');
    });
    it('fallback on non-200', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'NF' });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("couldn't process") }), expect.anything(), expect.anything());
      expect(mockTranscribe).not.toHaveBeenCalled();
    });
    it('fallback on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("couldn't process") }), expect.anything(), expect.anything());
    });
    it('fallback when no media URL', async () => {
      await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: {} } }));
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("couldn't process") }), expect.anything(), expect.anything());
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Audio validation (Req 2.1-2.5)', () => {
    it('accepts supported MIME types', () => { for (const m of VOICE_CONFIG.supportedMimeTypes) expect(validateAudio(m, 1024)).toEqual({ valid: true }); });
    it('rejects unsupported MIME', () => { expect(validateAudio('audio/wav', 1024)).toEqual({ valid: false, reason: 'unsupported_mime_type' }); });
    it('rejects > 16 MB', () => { expect(validateAudio('audio/ogg', VOICE_CONFIG.maxAudioSizeBytes + 1)).toEqual({ valid: false, reason: 'file_too_large' }); });
    it('accepts exactly 16 MB', () => { expect(validateAudio('audio/ogg', VOICE_CONFIG.maxAudioSizeBytes)).toEqual({ valid: true }); });
    it('sends format error for bad MIME', async () => {
      dl('audio/wav'); await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/wav' } } }));
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("audio format") }), expect.anything(), expect.anything());
    });
    it('sends size error for oversized', async () => {
      const big = Buffer.alloc(VOICE_CONFIG.maxAudioSizeBytes + 100, 0xab);
      mockFetch.mockResolvedValueOnce({ ok: true, headers: { get: () => 'audio/ogg' }, arrayBuffer: () => Promise.resolve(big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength)) });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining('too long') }), expect.anything(), expect.anything());
    });
  });

  describe('Gemini transcription (Req 3.1, 3.3)', () => {
    it('transcribes and routes to copilot', async () => {
      dl(); mockTranscribe.mockResolvedValueOnce({ transcript: 'Check rice', detectedLanguage: 'English', confidence: 92, products: [] });
      await handleVoiceNote(vc());
      expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Buffer), 'auto', []);
      expect(mockSellerCmd).toHaveBeenCalledWith(expect.objectContaining({ message: 'Check rice' }));
    });
    it('clarification on empty transcript', async () => {
      dl(); mockTranscribe.mockResolvedValueOnce({ transcript: '', detectedLanguage: 'English', confidence: 50, products: [] });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("couldn't quite understand") }), expect.anything(), expect.anything());
      expect(mockSellerCmd).not.toHaveBeenCalled();
    });
    it('clarification on confidence < 30', async () => {
      dl(); mockTranscribe.mockResolvedValueOnce({ transcript: 'text', detectedLanguage: 'Hindi', confidence: 20, products: [] });
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("couldn't quite understand") }), expect.anything(), expect.anything());
    });
    it('unavailable on Gemini error', async () => {
      dl(); mockTranscribe.mockRejectedValueOnce(new Error('timeout'));
      await handleVoiceNote(vc());
      expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining('temporarily unavailable') }), expect.anything(), expect.anything());
    });
  });

  describe('Gemini TTS (Req 6.5, 8.2)', () => {
    it('passes detected language to TTS', async () => {
      dl(); mockTranscribe.mockResolvedValueOnce({ transcript: 'Stock', detectedLanguage: 'Hindi', confidence: 95, products: [] });
      await handleVoiceNote(vc());
      expect(mockTTS).toHaveBeenCalledWith(expect.any(String), 'Hindi');
    });
    it('falls back to text on TTS failure', async () => {
      dl(); mockSellerCmd.mockResolvedValueOnce('50 units'); mockTTS.mockRejectedValueOnce(new Error('fail'));
      await handleVoiceNote(vc());
      expect(mockSendMessage.mock.calls.some((c: any[]) => c[1]?.type === 'text' && c[1]?.text?.includes('50 units'))).toBe(true);
      expect(mockSendMessage.mock.calls.find((c: any[]) => c[1]?.type === 'audio')).toBeUndefined();
    });
  });
  describe('S3 storage (Req 1.3, 6.3, 9.1, 9.3)', () => {
    it('stores inbound with correct key and tags', async () => {
      dl(); await handleVoiceNote(vc());
      const c = s3Mock.commandCalls(PutObjectCommand).find(c => (c.args[0].input.Key as string).startsWith('voice/inbound/'));
      expect(c).toBeTruthy(); expect(c!.args[0].input.Key).toMatch(/^voice\/inbound\/seller-001\/\d+\.ogg$/);
      expect(c!.args[0].input.Tagging).toBe('mediaType=voice&direction=inbound');
    });
    it('stores outbound with correct key and tags', async () => {
      dl(); await handleVoiceNote(vc());
      const c = s3Mock.commandCalls(PutObjectCommand).find(c => (c.args[0].input.Key as string).startsWith('voice/outbound/'));
      expect(c).toBeTruthy(); expect(c!.args[0].input.Key).toMatch(/^voice\/outbound\/seller-001\/\d+\.ogg$/);
      expect(c!.args[0].input.Tagging).toBe('mediaType=voice&direction=outbound');
    });
    it('generates pre-signed URL with 10-min expiry', async () => {
      dl(); await handleVoiceNote(vc());
      expect(mockSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: expect.objectContaining({ Bucket: 'test-media-bucket', Key: expect.stringMatching(/^voice\/outbound\//) }) }), { expiresIn: 600 });
    });
    it('continues if inbound S3 fails', async () => {
      dl(); s3Mock.reset(); s3Mock.on(PutObjectCommand).rejectsOnce(new Error('S3')).resolves({});
      await handleVoiceNote(vc());
      expect(mockTranscribe).toHaveBeenCalled();
    });
  });

  describe('Twilio delivery (Req 7.1, 7.3)', () => {
    it('sends audio message with mediaUrl', async () => {
      dl(); await handleVoiceNote(vc());
      const c = mockSendMessage.mock.calls.find((c: any[]) => c[1]?.type === 'audio');
      expect(c).toBeTruthy();
      expect(c![1]).toEqual(expect.objectContaining({ type: 'audio', mediaUrl: expect.stringContaining('presigned-url'), fallbackText: expect.any(String) }));
    });
    it('falls back to text on send failure', async () => {
      dl(); mockSendMessage.mockRejectedValueOnce(new Error('5xx')).mockResolvedValueOnce('ok');
      await handleVoiceNote(vc());
      expect(mockSendMessage.mock.calls.filter((c: any[]) => c[1]?.type === 'text').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Fallback chain (Req 8.1-8.4)', () => {
    it('download fail sends resend msg', async () => { mockFetch.mockRejectedValueOnce(new Error('net')); await handleVoiceNote(vc()); expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining('try sending it again') }), expect.anything(), expect.anything()); });
    it('bad MIME sends format msg', async () => { dl('audio/flac'); await handleVoiceNote(vc({ message: { id: 'w', type: 'audio', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/flac' } } })); expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining("audio format") }), expect.anything(), expect.anything()); });
    it('transcription down sends unavailable', async () => { dl(); mockTranscribe.mockRejectedValueOnce(new Error('d')); await handleVoiceNote(vc()); expect(mockSendMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: expect.stringContaining('temporarily unavailable') }), expect.anything(), expect.anything()); });
    it('TTS fail sends agent text', async () => { dl(); mockSellerCmd.mockResolvedValueOnce('Your orders'); mockTTS.mockRejectedValueOnce(new Error('t')); await handleVoiceNote(vc()); expect(mockSendMessage.mock.calls.some((c: any[]) => c[1]?.type === 'text' && c[1]?.text?.includes('Your orders'))).toBe(true); });
    it('S3 outbound fail sends agent text', async () => { dl(); mockSellerCmd.mockResolvedValueOnce('Price updated'); s3Mock.reset(); s3Mock.on(PutObjectCommand).resolvesOnce({}).rejectsOnce(new Error('s3')); await handleVoiceNote(vc()); expect(mockSendMessage.mock.calls.some((c: any[]) => c[1]?.type === 'text' && c[1]?.text?.includes('Price updated'))).toBe(true); });
  });

  describe('Metrics (Req 11.1, 11.4)', () => {
    it('emits VoiceMessagesReceived', async () => { dl(); await handleVoiceNote(vc()); expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'seller' }); });
    it('emits VoiceTranscriptionLatency', async () => { dl(); await handleVoiceNote(vc()); expect(mockLatencyMetric).toHaveBeenCalledWith('VoiceTranscriptionLatency', expect.any(Number), { Channel: 'whatsapp' }); });
    it('emits VoiceTTSLatency', async () => { dl(); await handleVoiceNote(vc()); expect(mockLatencyMetric).toHaveBeenCalledWith('VoiceTTSLatency', expect.any(Number), { Channel: 'whatsapp' }); });
    it('emits VoicePipelineE2ELatency', async () => { dl(); await handleVoiceNote(vc()); expect(mockLatencyMetric).toHaveBeenCalledWith('VoicePipelineE2ELatency', expect.any(Number), { Channel: 'whatsapp' }); });
    it('emits fallback stage=download', async () => { mockFetch.mockRejectedValueOnce(new Error('f')); await handleVoiceNote(vc()); expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'download' }); });
    it('emits fallback stage=tts', async () => { dl(); mockTTS.mockRejectedValueOnce(new Error('f')); await handleVoiceNote(vc()); expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'tts' }); });
    it('emits fallback stage=delivery', async () => { dl(); mockSendMessage.mockRejectedValueOnce(new Error('5xx')).mockResolvedValueOnce('ok'); await handleVoiceNote(vc()); expect(mockCountMetric).toHaveBeenCalledWith('VoiceFallbackToText', 1, { Stage: 'delivery' }); });
    it('emits customer role', async () => { dl(); await handleVoiceNote(vc({ userRole: 'customer', userId: 'cust-001' })); expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'customer' }); });
  });

  describe('Role-based routing (Req 10.1, 10.2)', () => {
    it('seller routes to copilot', async () => {
      dl(); mockTranscribe.mockResolvedValueOnce({ transcript: 'Update price 500', detectedLanguage: 'English', confidence: 95, products: [] });
      await handleVoiceNote(vc({ userRole: 'seller' }));
      expect(mockSellerCmd).toHaveBeenCalledWith(expect.objectContaining({ message: 'Update price 500', phoneNumber: '91001', requestId: 'req-1' }));
      expect(mockRouteMessage).not.toHaveBeenCalled();
    });
    it('customer routes to state router', async () => {
      mockGetUserByPhone.mockResolvedValue(CUSTOMER); dl();
      mockTranscribe.mockResolvedValueOnce({ transcript: 'Buy dal', detectedLanguage: 'Hindi', confidence: 88, products: [] });
      await handleVoiceNote(vc({ userRole: 'customer', userId: 'cust-001', phoneNumber: '91002' }));
      expect(mockRouteMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ type: 'text', text: { body: 'Buy dal' } }), requestId: 'req-1' }));
      expect(mockSellerCmd).not.toHaveBeenCalled();
    });
    it('customer audio via handler()', async () => {
      mockGetUserByPhone.mockResolvedValue(CUSTOMER); dl();
      await handler(sqsEv({ id: 'wamid.cv', type: 'audio', timestamp: '1700000000', audio: { url: 'https://api.twilio.com/media/a', mime_type: 'audio/ogg' } }, '91002'));
      expect(mockCountMetric).toHaveBeenCalledWith('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: 'customer' });
      expect(mockTranscribe).toHaveBeenCalled();
    });
  });
});