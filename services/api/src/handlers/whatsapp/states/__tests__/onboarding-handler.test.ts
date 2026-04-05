/**
 * Unit tests for Onboarding Handler
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMessage = jest.fn().mockResolvedValue('msg-sid-1');

jest.mock('../../../../services/whatsapp-sender', () => ({
  whatsappSender: { sendMessage: (...args: unknown[]) => mockSendMessage(...args) },
}));

jest.mock('../../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  onboardingHandler,
  buildRegistrationLink,
  buildWelcomeMessage,
  buildReminderMessage,
} from '../onboarding-handler';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Onboarding Handler', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('buildRegistrationLink', () => {
    it('includes ref=whatsapp and phone query params', () => {
      const link = buildRegistrationLink('+919876543210');
      expect(link).toContain('/register?ref=whatsapp&phone=');
      expect(link).toContain(encodeURIComponent('+919876543210'));
    });

    it('URL-encodes the phone number', () => {
      const link = buildRegistrationLink('+919876543210');
      // The "+" should be encoded as %2B
      expect(link).toContain('%2B919876543210');
    });

    it('works with a plain 10-digit number', () => {
      const link = buildRegistrationLink('9876543210');
      expect(link).toContain('phone=9876543210');
    });
  });

  describe('buildWelcomeMessage', () => {
    it('contains platform description', () => {
      const msg = buildWelcomeMessage('+919876543210');
      expect(msg).toContain('VyaparGyan');
      expect(msg).toContain('marketplace');
    });

    it('contains registration link with correct phone', () => {
      const msg = buildWelcomeMessage('+919876543210');
      expect(msg).toContain('/register?ref=whatsapp&phone=');
      expect(msg).toContain(encodeURIComponent('+919876543210'));
    });
  });

  describe('buildReminderMessage', () => {
    it('is shorter than the welcome message', () => {
      const welcome = buildWelcomeMessage('+919876543210');
      const reminder = buildReminderMessage('+919876543210');
      expect(reminder.length).toBeLessThan(welcome.length);
    });

    it('contains registration link', () => {
      const msg = buildReminderMessage('+919876543210');
      expect(msg).toContain('/register?ref=whatsapp&phone=');
    });
  });

  describe('onboardingHandler', () => {
    it('sends full welcome message when welcomeSent is false', async () => {
      await onboardingHandler({
        phoneNumber: '+919876543210',
        welcomeSent: false,
        sessionId: 'sess-1',
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const [phone, message, sessionId] = mockSendMessage.mock.calls[0];
      expect(phone).toBe('+919876543210');
      expect(message.type).toBe('text');
      expect(message.text).toContain('VyaparGyan');
      expect(message.text).toContain('marketplace');
      expect(sessionId).toBe('sess-1');
    });

    it('sends shorter reminder when welcomeSent is true', async () => {
      await onboardingHandler({
        phoneNumber: '+919876543210',
        welcomeSent: true,
        sessionId: 'sess-2',
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const [, message] = mockSendMessage.mock.calls[0];
      expect(message.text).toContain('haven\'t registered');
      expect(message.text).not.toContain('marketplace');
    });
  });
});
