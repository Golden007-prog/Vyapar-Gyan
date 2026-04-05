/**
 * Tests for Seller Copilot Handler
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 * - Home menu display on first seller message
 * - Stock check via Gemini intent extraction + SellerStockIndex
 * - "menu"/"home" navigation back to copilot home
 * - "No matching products found" for invalid queries
 * - Stock response contains product name, quantity, last restock date
 */

// ── Mocks ──────────────────────────────────────────────────────────────

const mockDocClientSend = jest.fn();
const mockGeminiGenerateContent = jest.fn();
const mockBedrockCopilot = jest.fn().mockResolvedValue('Bedrock response');

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockDocClientSend(...args),
    }),
  },
  QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'QueryCommand' })),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ tableName: 'test-table' }),
  getVoicePipelineConfig: jest.fn().mockResolvedValue({ geminiApiKey: 'test-key' }),
}));

jest.mock('../../../adapters/gemini-adapter', () => ({
  GeminiAdapter: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: (...args: unknown[]) => mockGeminiGenerateContent(...args),
      }),
    }),
  })),
}));

jest.mock('../../../services/whatsapp/seller-copilot', () => ({
  handleSellerWhatsAppCommand: (...args: unknown[]) => mockBedrockCopilot(...args),
}));

// Must set TABLE_NAME before importing the module
process.env.TABLE_NAME = 'test-table';

import { handleSellerCopilotMessage, type SellerCopilotContext } from '../seller-copilot';

// ── Helpers ────────────────────────────────────────────────────────────

function makeContext(message: string, sellerId = 'seller-001'): SellerCopilotContext {
  return {
    user: {
      id: sellerId,
      email: 'test@vyapargyan.com',
      phoneNumber: '919876543210',
      role: 'seller',
      cognitoId: 'cog-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    message,
    phoneNumber: '919876543210',
    requestId: 'req-test-001',
  };
}

const SAMPLE_PRODUCTS = [
  {
    id: 'prod-1',
    name: 'Amul Butter 500g',
    price: 290,
    stockQuantity: 25,
    sellerId: 'seller-001',
    categoryId: 'dairy',
    stockAddedDate: '2024-06-15T00:00:00.000Z',
    isActive: true,
  },
  {
    id: 'prod-2',
    name: 'Tata Salt 1kg',
    price: 28,
    stockQuantity: 100,
    sellerId: 'seller-001',
    categoryId: 'grocery',
    stockAddedDate: '2024-07-01T00:00:00.000Z',
    isActive: true,
  },
  {
    id: 'prod-3',
    name: 'Maggi Noodles 4-pack',
    price: 56,
    stockQuantity: 0,
    sellerId: 'seller-001',
    categoryId: 'grocery',
    stockAddedDate: '2024-05-20T00:00:00.000Z',
    isActive: true,
  },
];

function mockProductsQuery(products = SAMPLE_PRODUCTS) {
  mockDocClientSend.mockResolvedValue({ Items: products });
}

function mockGeminiExtraction(productName: string | null) {
  mockGeminiGenerateContent.mockResolvedValue({
    response: {
      text: () => JSON.stringify({ productName, action: 'check_stock' }),
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Seller Copilot Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Requirement 3.1: Home menu on first seller message', () => {
    it('displays home menu on first message from a new seller', async () => {
      // Use a unique seller ID to ensure no cached state
      const ctx = makeContext('hello', 'seller-new-001');
      const response = await handleSellerCopilotMessage(ctx);

      expect(response).toContain('VyaparGyan Seller Copilot');
      expect(response).toContain('Check stock');
      expect(response).toContain('Configure trend alerts');
      expect(response).toContain('Review pending campaigns');
      expect(response).toContain('Quick inventory summary');
    });

    it('includes all 4 menu options with numbers', async () => {
      const ctx = makeContext('hi', 'seller-new-002');
      const response = await handleSellerCopilotMessage(ctx);

      expect(response).toMatch(/1.*Check stock/);
      expect(response).toMatch(/2.*Configure trend alerts/);
      expect(response).toMatch(/3.*Review pending campaigns/);
      expect(response).toMatch(/4.*Quick inventory summary/);
    });
  });

  describe('Requirement 3.2: Stock check with Gemini intent extraction', () => {
    it('enters stock check mode when seller selects option 1', async () => {
      // First message → home menu
      const ctx = makeContext('hi', 'seller-stock-001');
      await handleSellerCopilotMessage(ctx);

      // Select option 1
      const ctx2 = makeContext('1', 'seller-stock-001');
      const response = await handleSellerCopilotMessage(ctx2);

      expect(response).toContain('What product would you like to check');
    });

    it('uses Gemini to extract product intent and returns stock info', async () => {
      // Setup: enter stock check mode
      const ctx1 = makeContext('hi', 'seller-stock-002');
      await handleSellerCopilotMessage(ctx1);
      const ctx2 = makeContext('1', 'seller-stock-002');
      await handleSellerCopilotMessage(ctx2);

      // Query with natural language
      mockGeminiExtraction('Amul Butter');
      mockProductsQuery();

      const ctx3 = makeContext('how much Amul Butter left?', 'seller-stock-002');
      const response = await handleSellerCopilotMessage(ctx3);

      expect(response).toContain('Amul Butter 500g');
      expect(response).toContain('25');
    });

    it('handles stock query from home state with natural language', async () => {
      // First message → home menu
      const ctx1 = makeContext('hi', 'seller-stock-003');
      await handleSellerCopilotMessage(ctx1);

      // Natural language stock query from home
      mockGeminiExtraction('Tata Salt');
      mockProductsQuery();

      const ctx2 = makeContext('check stock of Tata Salt', 'seller-stock-003');
      const response = await handleSellerCopilotMessage(ctx2);

      expect(response).toContain('Tata Salt 1kg');
      expect(response).toContain('100');
    });
  });

  describe('Requirement 3.3: Stock response contains required fields', () => {
    it('returns product name, stock quantity, and last restock date', async () => {
      const ctx1 = makeContext('hi', 'seller-fields-001');
      await handleSellerCopilotMessage(ctx1);
      const ctx2 = makeContext('1', 'seller-fields-001');
      await handleSellerCopilotMessage(ctx2);

      mockGeminiExtraction('Amul Butter');
      mockProductsQuery();

      const ctx3 = makeContext('Amul Butter', 'seller-fields-001');
      const response = await handleSellerCopilotMessage(ctx3);

      // Product name
      expect(response).toContain('Amul Butter 500g');
      // Stock quantity
      expect(response).toMatch(/Stock.*25/);
      // Last restock date
      expect(response).toMatch(/Last restock/);
      // Price
      expect(response).toContain('290');
    });
  });

  describe('Requirement 3.4: No matching products found', () => {
    it('responds with "No matching products found" for invalid queries', async () => {
      const ctx1 = makeContext('hi', 'seller-notfound-001');
      await handleSellerCopilotMessage(ctx1);
      const ctx2 = makeContext('1', 'seller-notfound-001');
      await handleSellerCopilotMessage(ctx2);

      mockGeminiExtraction('Nonexistent Product XYZ');
      mockProductsQuery();

      const ctx3 = makeContext('Nonexistent Product XYZ', 'seller-notfound-001');
      const response = await handleSellerCopilotMessage(ctx3);

      expect(response).toContain("couldn't find");
    });

    it('responds when seller has no products', async () => {
      const ctx1 = makeContext('hi', 'seller-empty-001');
      await handleSellerCopilotMessage(ctx1);
      const ctx2 = makeContext('1', 'seller-empty-001');
      await handleSellerCopilotMessage(ctx2);

      mockGeminiExtraction('Amul Butter');
      mockDocClientSend.mockResolvedValue({ Items: [] });

      const ctx3 = makeContext('Amul Butter', 'seller-empty-001');
      const response = await handleSellerCopilotMessage(ctx3);

      expect(response).toContain("don't have any products");
    });
  });

  describe('Requirement 3.5: "menu" or "home" returns to copilot home', () => {
    it('"menu" returns to home from stock check state', async () => {
      const ctx1 = makeContext('hi', 'seller-menu-001');
      await handleSellerCopilotMessage(ctx1);
      const ctx2 = makeContext('1', 'seller-menu-001');
      await handleSellerCopilotMessage(ctx2);

      // Now in stock_check state, type "menu"
      const ctx3 = makeContext('menu', 'seller-menu-001');
      const response = await handleSellerCopilotMessage(ctx3);

      expect(response).toContain('VyaparGyan Seller Copilot');
      expect(response).toContain('Check stock');
    });

    it('"home" returns to home from any state', async () => {
      const ctx1 = makeContext('hi', 'seller-home-001');
      await handleSellerCopilotMessage(ctx1);

      const ctx2 = makeContext('home', 'seller-home-001');
      const response = await handleSellerCopilotMessage(ctx2);

      expect(response).toContain('VyaparGyan Seller Copilot');
    });

    it('"back" returns to home menu', async () => {
      const ctx1 = makeContext('hi', 'seller-back-001');
      await handleSellerCopilotMessage(ctx1);

      const ctx2 = makeContext('back', 'seller-back-001');
      const response = await handleSellerCopilotMessage(ctx2);

      expect(response).toContain('VyaparGyan Seller Copilot');
    });
  });

  describe('Quick inventory summary', () => {
    it('returns inventory summary with totals and low stock items', async () => {
      const ctx1 = makeContext('hi', 'seller-summary-001');
      await handleSellerCopilotMessage(ctx1);

      mockProductsQuery();

      const ctx2 = makeContext('4', 'seller-summary-001');
      const response = await handleSellerCopilotMessage(ctx2);

      expect(response).toContain('Inventory Summary');
      expect(response).toContain('Total products: 3');
      expect(response).toContain('Out of stock');
      expect(response).toContain('Maggi Noodles');
    });
  });

  describe('Delegation to Bedrock copilot', () => {
    it('delegates non-stock commands to Bedrock copilot', async () => {
      const ctx1 = makeContext('hi', 'seller-delegate-001');
      await handleSellerCopilotMessage(ctx1);

      const ctx2 = makeContext('update Tata Salt price to 30', 'seller-delegate-001');
      await handleSellerCopilotMessage(ctx2);

      expect(mockBedrockCopilot).toHaveBeenCalled();
    });
  });
});
