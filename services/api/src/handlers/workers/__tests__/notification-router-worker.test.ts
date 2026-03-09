import type { EventBridgeEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the handler
// ---------------------------------------------------------------------------

jest.mock('../../../adapters/dynamodb-adapter', () => {
  const getUserProfile = jest.fn();
  const putMessage = jest.fn().mockResolvedValue(undefined);
  return { getUserProfile, putMessage };
});

jest.mock('../../../services/consent-service', () => {
  const checkSendPermission = jest.fn();
  return { checkSendPermission };
});

jest.mock('../../../adapters/twilio-adapter', () => {
  const sendWhatsAppMessage = jest.fn().mockResolvedValue({
    messageId: 'SM999',
    status: 'queued',
    dateCreated: new Date(),
    statusCallbackConfigured: false,
  });
  return { twilioAdapter: { sendWhatsAppMessage } };
});

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { handler } from '../notification-router-worker';

const dbMod = jest.requireMock('../../../adapters/dynamodb-adapter') as any;
const consentMod = jest.requireMock('../../../services/consent-service') as any;
const twilioMod = jest.requireMock('../../../adapters/twilio-adapter') as any;

const mockGetUserProfile = dbMod.getUserProfile as jest.Mock;
const mockPutMessage = dbMod.putMessage as jest.Mock;
const mockCheckSendPermission = consentMod.checkSendPermission as jest.Mock;
const mockSendWA = twilioMod.twilioAdapter.sendWhatsAppMessage as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DetailOverrides {
  userId?: string;
  messageId?: string;
  channel?: 'web' | 'whatsapp';
  sellerId?: string;
  content?: string;
  messageType?: string;
  createdAt?: string;
}

function makeEvent(overrides: DetailOverrides = {}): EventBridgeEvent<'CustomerMessageSent', any> {
  return {
    version: '0',
    id: 'evt-1',
    source: 'vyapargyan.chat',
    account: '123456789012',
    time: '2025-01-15T10:00:00Z',
    region: 'ap-south-1',
    resources: [],
    'detail-type': 'CustomerMessageSent',
    detail: {
      userId: 'cust-1',
      messageId: 'msg-1',
      channel: 'web',
      sellerId: 'seller-1',
      content: 'Hello, is this available?',
      messageType: 'text',
      createdAt: '2025-01-15T10:00:00Z',
      ...overrides,
    },
  };
}

const SELLER_PROFILE_BASE = {
  userId: 'seller-1',
  role: 'seller' as const,
  displayName: 'Test Seller',
  phoneNumber: '+919876543210',
  phoneVerificationStatus: 'verified' as const,
  whatsappConnected: true,
  cognitoId: 'cog-seller',
  status: 'active' as const,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Notification Router Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckSendPermission.mockResolvedValue({ allowed: true, requiresTemplate: false });
  });

  it('routes web message to WhatsApp when seller prefers whatsapp and service window is active', async () => {
    mockGetUserProfile.mockResolvedValue({ ...SELLER_PROFILE_BASE, preferredChannel: 'whatsapp' });

    await handler(makeEvent({ channel: 'web' }));

    // Message stored in seller THREAD
    expect(mockPutMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        direction: 'inbound',
        channel: 'web',
        senderRole: 'customer',
      }),
    );

    // Consent checked for the seller
    expect(mockCheckSendPermission).toHaveBeenCalledWith('seller-1', 'transactional');

    // WhatsApp message sent
    expect(mockSendWA).toHaveBeenCalledWith(
      '+919876543210',
      expect.stringContaining('Hello, is this available?'),
    );
  });

  it('routes WhatsApp message to web (stores in THREAD only) when seller prefers web', async () => {
    mockGetUserProfile.mockResolvedValue({ ...SELLER_PROFILE_BASE, preferredChannel: 'web' });

    await handler(makeEvent({ channel: 'whatsapp' }));

    // Message stored in seller THREAD
    expect(mockPutMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'seller-1', channel: 'whatsapp' }),
    );

    // No WhatsApp delivery — seller prefers web
    expect(mockSendWA).not.toHaveBeenCalled();
  });

  it('blocks WhatsApp delivery when consent service denies permission', async () => {
    mockGetUserProfile.mockResolvedValue({ ...SELLER_PROFILE_BASE, preferredChannel: 'whatsapp' });
    mockCheckSendPermission.mockResolvedValue({ allowed: false, reason: 'opted_out' });

    await handler(makeEvent());

    // Message still stored in THREAD
    expect(mockPutMessage).toHaveBeenCalled();

    // WhatsApp NOT sent because consent denied
    expect(mockSendWA).not.toHaveBeenCalled();
  });

  it('resolves channel preference from seller profile and defaults to web', async () => {
    // Profile with no preferredChannel set → defaults to 'web'
    mockGetUserProfile.mockResolvedValue({ ...SELLER_PROFILE_BASE, preferredChannel: undefined });

    await handler(makeEvent());

    expect(mockPutMessage).toHaveBeenCalled();
    expect(mockSendWA).not.toHaveBeenCalled();
  });

  it('skips routing when no sellerId is provided', async () => {
    await handler(makeEvent({ sellerId: undefined }));

    expect(mockGetUserProfile).not.toHaveBeenCalled();
    expect(mockPutMessage).not.toHaveBeenCalled();
    expect(mockSendWA).not.toHaveBeenCalled();
  });
});
