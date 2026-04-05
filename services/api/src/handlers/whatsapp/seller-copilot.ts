/**
 * Seller Copilot Handler
 *
 * WhatsApp-based assistant for sellers providing:
 * - Home menu on first message
 * - Stock check via Gemini intent extraction + DynamoDB SellerStockIndex
 * - Campaign review, approval, and dismissal via WhatsApp
 * - Navigation back to home via "menu" / "home"
 * - Delegation to Bedrock-based copilot for other commands
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { GeminiAdapter } from '../../adapters/gemini-adapter';
import { getVoicePipelineConfig } from '../../utils/config';
import {
  findBestMatch,
  formatClarificationMessage,
  formatNotFoundMessage,
  type ProductCandidate,
} from '../../utils/product-matcher';
import { handleSellerWhatsAppCommand as bedrockCopilot } from '../../services/whatsapp/seller-copilot';
import {
  createOrUpdateSchedule,
  disableSchedule,
  getTrendConfig,
  intervalLabel,
  type TrendInterval,
} from '../../services/trend-scheduler';
import {
  getCampaign,
  updateCampaign,
  queryCampaignsBySeller,
  type CampaignRecord,
} from '../../adapters/dynamodb-adapter';

// ── DynamoDB client ────────────────────────────────────────────────────

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const ebClient = new EventBridgeClient({});

async function resolveTableName(): Promise<string> {
  const envTable = process.env.TABLE_NAME;
  if (envTable) return envTable;
  const { getConfig } = await import('../../utils/config.js');
  const cfg = await getConfig();
  return cfg.tableName;
}

// ── Seller session state (in-memory per Lambda invocation) ─────────────
// In production this would be stored in DynamoDB session context.
// For now we use a simple map keyed by sellerId.

type SellerSubState = 'home' | 'stock_check' | 'trend_alerts' | 'trend_interval_select' | 'campaigns' | 'inventory_summary';

const sellerStates = new Map<string, SellerSubState>();

// Cache of pending campaigns shown to each seller (keyed by sellerId).
// Maps 1-based display index → campaignId for command parsing.
const pendingCampaignCache = new Map<string, CampaignRecord[]>();

// ── Home menu ──────────────────────────────────────────────────────────

const HOME_MENU = `🏪 *VyaparGyan Seller Copilot*

Welcome! How can I help you today?

1️⃣ Check stock
2️⃣ Configure trend alerts
3️⃣ Review pending campaigns
4️⃣ Quick inventory summary

💬 Reply with a number or type your request naturally.
Type "menu" or "home" anytime to return here.`;

// ── Public handler ─────────────────────────────────────────────────────

export interface SellerCopilotContext {
  user: {
    id: string;
    email?: string;
    phoneNumber: string;
    role: string;
    cognitoId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  message: string;
  phoneNumber: string;
  requestId: string;
}

/**
 * Main entry point for seller WhatsApp messages.
 *
 * Displays the home menu on first contact, handles "menu"/"home" navigation,
 * routes stock check queries through Gemini intent extraction, and delegates
 * other commands to the existing Bedrock-based copilot.
 */
export async function handleSellerCopilotMessage(
  context: SellerCopilotContext,
): Promise<string> {
  const { user, message, phoneNumber, requestId } = context;
  const sellerId = user.id;
  const text = message.trim();
  const textLower = text.toLowerCase();

  logger.info('Seller copilot handler invoked', {
    requestId,
    sellerId,
    phoneNumber,
    messagePreview: text.substring(0, 60),
  });

  // ── Navigation: "menu" or "home" returns to copilot home ──
  if (isMenuCommand(textLower)) {
    sellerStates.set(sellerId, 'home');
    return HOME_MENU;
  }

  // ── "stop alerts" from any state ──
  if (/^stop\s*alerts?$/i.test(textLower)) {
    return handleStopAlerts(context);
  }

  // ── "trends" or "alerts" from any state → trend config ──
  if (/^(trends?|alerts?)$/i.test(textLower)) {
    sellerStates.set(sellerId, 'trend_interval_select');
    return handleTrendAlertsEntry(context);
  }

  // ── First message or no state → show home menu ──
  const currentState = sellerStates.get(sellerId);
  if (!currentState) {
    sellerStates.set(sellerId, 'home');
    return HOME_MENU;
  }

  // ── Home state: route based on menu selection or natural language ──
  if (currentState === 'home') {
    return handleHomeSelection(context, textLower);
  }

  // ── Stock check sub-state ──
  if (currentState === 'stock_check') {
    return handleStockCheck(context);
  }

  // ── Trend interval selection sub-state ──
  if (currentState === 'trend_interval_select') {
    return handleTrendIntervalSelection(context, textLower);
  }

  // ── Campaign review sub-state ──
  if (currentState === 'campaigns') {
    return handleCampaignCommand(context, textLower);
  }

  // ── Other sub-states: delegate to Bedrock copilot ──
  return delegateToBedrock(context);
}

// ── Menu command detection ─────────────────────────────────────────────

function isMenuCommand(text: string): boolean {
  return /^(menu|home|main menu|go back|back)$/i.test(text.trim());
}

// ── Home selection routing ─────────────────────────────────────────────

async function handleHomeSelection(
  context: SellerCopilotContext,
  textLower: string,
): Promise<string> {
  const sellerId = context.user.id;

  // Numeric menu selection
  if (textLower === '1' || /^check\s*stock$/i.test(textLower)) {
    sellerStates.set(sellerId, 'stock_check');
    return '🔍 What product would you like to check stock for?\n\nType the product name (e.g., "Amul Butter" or "Tata Salt 1kg")';
  }

  if (textLower === '2' || /^(configure\s*)?trend\s*alerts?$/i.test(textLower)) {
    sellerStates.set(sellerId, 'trend_interval_select');
    return handleTrendAlertsEntry(context);
  }

  if (textLower === '3' || /^review\s*(pending\s*)?campaigns?$/i.test(textLower)) {
    sellerStates.set(sellerId, 'campaigns');
    return handleCampaignReviewEntry(context);
  }

  if (textLower === '4' || /^(quick\s*)?inventory\s*summary$/i.test(textLower)) {
    sellerStates.set(sellerId, 'inventory_summary');
    return handleInventorySummary(context);
  }

  // Natural language stock query detection
  if (isStockQuery(textLower)) {
    sellerStates.set(sellerId, 'stock_check');
    return handleStockCheck(context);
  }

  // Fallback: delegate to Bedrock copilot for other natural language
  return delegateToBedrock(context);
}

// ── Stock query detection ──────────────────────────────────────────────

function isStockQuery(text: string): boolean {
  return /\b(stock|qty|quantity|how\s*much|kitna|kitne|left|available|inventory|check)\b/i.test(text)
    && !/\b(trend|alert|campaign|approve|reject|order|price|update)\b/i.test(text);
}

// ── Stock check handler ────────────────────────────────────────────────

/**
 * Handle stock check flow:
 * 1. Use Gemini to extract product intent from natural language
 * 2. Query DynamoDB SellerStockIndex with filter on product name
 * 3. Return product name, stock quantity, last restock date
 */
async function handleStockCheck(
  context: SellerCopilotContext,
): Promise<string> {
  const { user, message, requestId } = context;
  const sellerId = user.id;

  logger.info('Stock check initiated', { requestId, sellerId, query: message });

  try {
    // Step 1: Extract product intent via Gemini
    const productName = await extractProductIntent(message);

    if (!productName) {
      return '🔍 I couldn\'t identify a product from your message.\n\nPlease type the product name you want to check (e.g., "Amul Butter" or "Tata Salt").';
    }

    logger.info('Product intent extracted', { requestId, sellerId, productName });

    // Step 2: Query SellerStockIndex for seller's products
    const products = await querySellerProducts(sellerId);

    if (products.length === 0) {
      sellerStates.set(sellerId, 'home');
      return '📦 You don\'t have any products in your inventory yet.\n\nType "menu" to go back.';
    }

    // Step 3: Fuzzy match against seller's products
    const match = findBestMatch(productName, products);

    if (match.type === 'none') {
      const suggestions = products.slice(0, 3);
      const notFoundMsg = formatNotFoundMessage(productName, suggestions);
      return `📦 ${notFoundMsg}\n\nType another product name or "menu" to go back.`;
    }

    if (match.type === 'multiple' && match.candidates) {
      const clarifyMsg = formatClarificationMessage(productName, match.candidates);
      return `📦 ${clarifyMsg}`;
    }

    // Single match found
    const product = match.product!;
    return formatStockResponse(product);
  } catch (error) {
    logger.error('Stock check failed', {
      requestId,
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Sorry, I couldn\'t check stock right now. Please try again.\n\nType "menu" to go back.';
  }
}

// ── Gemini product intent extraction ───────────────────────────────────

async function extractProductIntent(message: string): Promise<string | null> {
  try {
    // Try to get Gemini API key
    let apiKey: string | undefined;
    try {
      const voiceConfig = await getVoicePipelineConfig();
      apiKey = voiceConfig.geminiApiKey;
    } catch {
      // If voice config not available, try env var
      apiKey = process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
      logger.warn('Gemini API key not available, falling back to raw message');
      return extractProductNameFallback(message);
    }

    const gemini = new GeminiAdapter(apiKey);
    const client = await (gemini as any).getClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Extract the product name from this seller's stock query. Return ONLY valid JSON, no other text.

{
  "productName": string or null,
  "action": "check_stock" | "restock" | "summary"
}

If the message is just a greeting or doesn't mention a product, return {"productName": null, "action": "summary"}.

Message: "${message}"`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Clean markdown fences
    let clean = text.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(clean.trim());
    return typeof parsed.productName === 'string' ? parsed.productName : null;
  } catch (error) {
    logger.warn('Gemini intent extraction failed, using fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return extractProductNameFallback(message);
  }
}

/**
 * Simple fallback: strip common stock-check keywords and return the rest as product name.
 */
function extractProductNameFallback(message: string): string | null {
  const cleaned = message
    .replace(/\b(check|stock|qty|quantity|how\s*much|kitna|kitne|left|available|of|the|is|are|do|we|have|in)\b/gi, '')
    .replace(/[?!.,]/g, '')
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

// ── DynamoDB queries ───────────────────────────────────────────────────

/**
 * Query seller's products from SellerStockIndex GSI.
 * Returns products with name, stock quantity, price, and stock added date.
 */
async function querySellerProducts(sellerId: string): Promise<ProductCandidate[]> {
  const tableName = await resolveTableName();

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'SellerStockIndex',
      KeyConditionExpression: 'sellerId = :sellerId',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':sellerId': sellerId,
        ':active': true,
      },
      ScanIndexForward: false, // Most recently stocked first
      Limit: 200,
    }),
  );

  return (result.Items || []).map(item => ({
    id: (item.id as string) || '',
    name: (item.name as string) || '',
    price: (item.price as number) || 0,
    stockQuantity: (item.stockQuantity as number) || 0,
    categoryId: (item.categoryId as string) ?? '',
    stockAddedDate: item.stockAddedDate as string | undefined,
  }));
}

// ── Quick inventory summary ────────────────────────────────────────────

async function handleInventorySummary(
  context: SellerCopilotContext,
): Promise<string> {
  const { user, requestId } = context;
  const sellerId = user.id;

  try {
    const products = await querySellerProducts(sellerId);

    if (products.length === 0) {
      sellerStates.set(sellerId, 'home');
      return '📦 No products in your inventory yet.\n\nType "menu" to go back.';
    }

    const totalProducts = products.length;
    const totalStock = products.reduce((sum, p) => sum + p.stockQuantity, 0);
    const lowStock = products.filter(p => p.stockQuantity > 0 && p.stockQuantity <= 5);
    const outOfStock = products.filter(p => p.stockQuantity === 0);
    const totalValue = products.reduce((sum, p) => sum + p.price * p.stockQuantity, 0);

    let summary = `📊 *Inventory Summary*\n\n`;
    summary += `📦 Total products: ${totalProducts}\n`;
    summary += `🔢 Total stock units: ${totalStock}\n`;
    summary += `💰 Total inventory value: ₹${totalValue.toLocaleString('en-IN')}\n`;

    if (outOfStock.length > 0) {
      summary += `\n🔴 Out of stock (${outOfStock.length}):\n`;
      outOfStock.slice(0, 5).forEach(p => {
        summary += `  • ${p.name}\n`;
      });
      if (outOfStock.length > 5) summary += `  ... and ${outOfStock.length - 5} more\n`;
    }

    if (lowStock.length > 0) {
      summary += `\n🟡 Low stock (${lowStock.length}):\n`;
      lowStock.slice(0, 5).forEach(p => {
        summary += `  • ${p.name}: ${p.stockQuantity} left\n`;
      });
      if (lowStock.length > 5) summary += `  ... and ${lowStock.length - 5} more\n`;
    }

    summary += '\nType "menu" to go back or a product name to check details.';

    sellerStates.set(sellerId, 'home');
    return summary;
  } catch (error) {
    logger.error('Inventory summary failed', {
      requestId,
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Sorry, I couldn\'t fetch your inventory summary. Please try again.\n\nType "menu" to go back.';
  }
}

// ── Response formatting ────────────────────────────────────────────────

/**
 * Format stock check response with product name, quantity, and last restock date.
 * Requirement 3.3: Return product name, current stock quantity, and last restock date.
 */
export function formatStockResponse(product: ProductCandidate): string {
  const stockDate = product.stockAddedDate
    ? new Date(product.stockAddedDate as string).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'N/A';

  const stockEmoji = product.stockQuantity === 0
    ? '🔴'
    : product.stockQuantity <= 5
      ? '🟡'
      : '🟢';

  return `${stockEmoji} *${product.name}*

📦 Stock: ${product.stockQuantity} units
💰 Price: ₹${product.price}
📅 Last restock: ${stockDate}

Type another product name to check or "menu" to go back.`;
}

// ── Trend alert handlers ───────────────────────────────────────────────

const TREND_INTERVAL_MENU = `📊 *Configure Trend Alerts*

How often would you like to receive market trend insights?

1️⃣ Every 30 minutes
2️⃣ Every 1 hour
3️⃣ Every 8 hours
4️⃣ Every 24 hours

💬 Reply with a number or type the interval (e.g., "30m", "1h", "8h", "24h").
Type "stop alerts" to disable alerts or "menu" to go back.`;

/**
 * Entry point for trend alerts — show interval options and current config.
 */
async function handleTrendAlertsEntry(
  context: SellerCopilotContext,
): Promise<string> {
  const sellerId = context.user.id;

  try {
    const existing = await getTrendConfig(sellerId);
    if (existing?.enabled) {
      return `📊 *Trend Alerts Active*\n\nYou're currently receiving alerts every ${intervalLabel(existing.interval)}.\n\nWant to change the interval?\n\n1️⃣ Every 30 minutes\n2️⃣ Every 1 hour\n3️⃣ Every 8 hours\n4️⃣ Every 24 hours\n\n💬 Reply with a number, or type "stop alerts" to disable.`;
    }
  } catch (err) {
    logger.warn('Failed to fetch existing trend config', {
      sellerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return TREND_INTERVAL_MENU;
}

/**
 * Handle seller's interval selection in the trend_interval_select sub-state.
 */
async function handleTrendIntervalSelection(
  context: SellerCopilotContext,
  textLower: string,
): Promise<string> {
  const sellerId = context.user.id;
  const phoneNumber = context.phoneNumber;

  // Map numeric or text input to interval
  const interval = parseTrendInterval(textLower);

  if (!interval) {
    return '❓ I didn\'t recognize that interval.\n\nPlease reply with:\n1️⃣ 30m\n2️⃣ 1h\n3️⃣ 8h\n4️⃣ 24h\n\nOr type "menu" to go back.';
  }

  try {
    await createOrUpdateSchedule(sellerId, interval, phoneNumber);
    sellerStates.set(sellerId, 'home');
    return `✅ Trend alerts set to every ${intervalLabel(interval)}!\n\nYou'll receive market insights for your product categories at this interval.\n\nType "stop alerts" anytime to disable or "menu" to go back.`;
  } catch (err) {
    logger.error('Failed to create/update trend schedule', {
      sellerId,
      interval,
      error: err instanceof Error ? err.message : String(err),
    });
    sellerStates.set(sellerId, 'home');
    return 'Sorry, I couldn\'t set up your trend alerts right now. Please try again later.\n\nType "menu" to go back.';
  }
}

/**
 * Handle "stop alerts" command — disable the seller's trend schedule.
 */
async function handleStopAlerts(
  context: SellerCopilotContext,
): Promise<string> {
  const sellerId = context.user.id;

  try {
    const existing = await getTrendConfig(sellerId);
    if (!existing?.enabled) {
      sellerStates.set(sellerId, 'home');
      return '📊 You don\'t have any active trend alerts.\n\nType "menu" to go back.';
    }

    await disableSchedule(sellerId);
    sellerStates.set(sellerId, 'home');
    return '🔕 Trend alerts have been disabled.\n\nType "trends" or "alerts" to re-enable anytime, or "menu" to go back.';
  } catch (err) {
    logger.error('Failed to disable trend schedule', {
      sellerId,
      error: err instanceof Error ? err.message : String(err),
    });
    sellerStates.set(sellerId, 'home');
    return 'Sorry, I couldn\'t disable your alerts right now. Please try again.\n\nType "menu" to go back.';
  }
}

/**
 * Parse user input into a TrendInterval.
 * Accepts: "1", "2", "3", "4", "30m", "1h", "8h", "24h",
 *          "30 minutes", "1 hour", "8 hours", "24 hours"
 */
function parseTrendInterval(text: string): TrendInterval | null {
  const t = text.trim().toLowerCase();

  // Numeric menu selection
  if (t === '1') return '30m';
  if (t === '2') return '1h';
  if (t === '3') return '8h';
  if (t === '4') return '24h';

  // Direct interval codes
  if (t === '30m' || t === '30min' || t === '30 min' || t === '30 minutes') return '30m';
  if (t === '1h' || t === '1hr' || t === '1 hour' || t === '1 hr') return '1h';
  if (t === '8h' || t === '8hr' || t === '8 hours' || t === '8 hrs') return '8h';
  if (t === '24h' || t === '24hr' || t === '24 hours' || t === '24 hrs') return '24h';

  return null;
}

// ── Campaign review handlers ───────────────────────────────────────────

/**
 * Parsed campaign command from seller reply.
 * Exported for property-based testing.
 *
 * Requirements: 5.2, 5.3
 */
export interface ParsedCampaignCommand {
  action: 'approve' | 'dismiss';
  index: number; // 1-based index into the displayed campaign list
}

/**
 * Parse a seller's reply into a campaign command.
 *
 * Accepted patterns:
 *   "N"            → approve campaign N  (bare number defaults to approve)
 *   "approve N"    → approve campaign N
 *   "approve #N"   → approve campaign N
 *   "dismiss N"    → dismiss campaign N
 *   "dismiss #N"   → dismiss campaign N
 *
 * Returns null if the input doesn't match any pattern.
 *
 * Requirements: 5.2, 5.3
 */
export function parseCampaignCommand(text: string): ParsedCampaignCommand | null {
  const t = text.trim().toLowerCase();

  // "approve N" or "approve #N"
  const approveMatch = t.match(/^approve\s+#?(\d+)$/);
  if (approveMatch) {
    const idx = parseInt(approveMatch[1], 10);
    if (idx > 0) return { action: 'approve', index: idx };
    return null;
  }

  // "dismiss N" or "dismiss #N"
  const dismissMatch = t.match(/^dismiss\s+#?(\d+)$/);
  if (dismissMatch) {
    const idx = parseInt(dismissMatch[1], 10);
    if (idx > 0) return { action: 'dismiss', index: idx };
    return null;
  }

  // Bare number → approve
  const bareMatch = t.match(/^(\d+)$/);
  if (bareMatch) {
    const idx = parseInt(bareMatch[1], 10);
    if (idx > 0) return { action: 'approve', index: idx };
    return null;
  }

  return null;
}

/**
 * Format a list of pending campaigns as a numbered WhatsApp message.
 * Returns "All caught up! No pending campaigns." for empty lists.
 *
 * Requirements: 5.1, 5.5
 */
export function formatCampaignList(campaigns: CampaignRecord[]): string {
  if (campaigns.length === 0) {
    return 'All caught up! No pending campaigns.';
  }

  let msg = '📢 *Pending Campaigns*\n\n';

  campaigns.forEach((c, i) => {
    const name = c.messageText?.substring(0, 50) || 'Untitled Campaign';
    const products = (c.audienceFilters?.pastPurchasers?.length ?? 0);
    const discount = (c as any).suggestedDiscount ?? 'N/A';
    const impact = c.estimatedReach > 0
      ? `~${c.estimatedReach} customers`
      : 'N/A';

    msg += `*${i + 1}.* ${name}\n`;
    msg += `   📦 Products: ${products > 0 ? products : 'All'}\n`;
    msg += `   🏷️ Discount: ${discount}%\n`;
    msg += `   📈 Reach: ${impact}\n\n`;
  });

  msg += '💬 Reply:\n';
  msg += '  • Number (e.g., "1") or "approve N" to approve\n';
  msg += '  • "dismiss N" to dismiss\n';
  msg += '  • "menu" to go back';

  return msg;
}

/**
 * Entry point for campaign review — fetch pending campaigns and display list.
 *
 * Requirement 5.1, 5.5
 */
async function handleCampaignReviewEntry(
  context: SellerCopilotContext,
): Promise<string> {
  const sellerId = context.user.id;

  try {
    const result = await queryCampaignsBySeller(sellerId, 20);

    // Filter to only draft/scheduled campaigns (pending review)
    const pending = result.campaigns.filter(
      c => c.status === 'draft' || c.status === 'scheduled',
    );

    if (pending.length === 0) {
      sellerStates.set(sellerId, 'home');
      pendingCampaignCache.delete(sellerId);
      return 'All caught up! No pending campaigns.';
    }

    // Cache for command resolution
    pendingCampaignCache.set(sellerId, pending);
    return formatCampaignList(pending);
  } catch (error) {
    logger.error('Failed to fetch pending campaigns', {
      requestId: context.requestId,
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    sellerStates.set(sellerId, 'home');
    return 'Sorry, I couldn\'t fetch your campaigns right now. Please try again.\n\nType "menu" to go back.';
  }
}

/**
 * Handle seller's reply in the campaigns sub-state.
 * Parses approve/dismiss commands and executes the corresponding action.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
async function handleCampaignCommand(
  context: SellerCopilotContext,
  textLower: string,
): Promise<string> {
  const sellerId = context.user.id;

  const cmd = parseCampaignCommand(textLower);
  if (!cmd) {
    return '❓ I didn\'t understand that.\n\nReply with a number to approve, "approve N", or "dismiss N".\nType "menu" to go back.';
  }

  const cached = pendingCampaignCache.get(sellerId);
  if (!cached || cached.length === 0) {
    sellerStates.set(sellerId, 'home');
    return 'No campaigns loaded. Type "3" or "campaigns" to refresh the list.';
  }

  if (cmd.index < 1 || cmd.index > cached.length) {
    return `❓ Invalid number. Please choose between 1 and ${cached.length}.`;
  }

  const campaign = cached[cmd.index - 1];

  if (cmd.action === 'approve') {
    return handleCampaignApproval(context, campaign);
  }

  return handleCampaignDismissal(context, campaign);
}

/**
 * Approve a campaign: publish campaign.approved event on EventBridge
 * and send confirmation message.
 *
 * Requirements: 5.2, 5.4
 */
async function handleCampaignApproval(
  context: SellerCopilotContext,
  campaign: CampaignRecord,
): Promise<string> {
  const sellerId = context.user.id;

  try {
    // Update campaign status to scheduled (approved for execution)
    await updateCampaign(campaign.campaignId, { status: 'scheduled' });

    // Publish campaign.approved event on EventBridge
    const eventBusName = process.env.EVENT_BUS_NAME || 'default';
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapargyan.campaign',
            DetailType: 'campaign.approved',
            Detail: JSON.stringify({
              campaignId: campaign.campaignId,
              sellerId,
              messageText: campaign.messageText,
              audienceFilters: campaign.audienceFilters,
              estimatedReach: campaign.estimatedReach,
              approvedAt: new Date().toISOString(),
              approvedVia: 'whatsapp_copilot',
            }),
            EventBusName: eventBusName,
          },
        ],
      }),
    );

    logger.info('Campaign approved via WhatsApp', {
      requestId: context.requestId,
      sellerId,
      campaignId: campaign.campaignId,
    });

    // Clean up cache
    pendingCampaignCache.delete(sellerId);
    sellerStates.set(sellerId, 'home');

    const name = campaign.messageText?.substring(0, 50) || 'Campaign';
    return `✅ *Campaign Approved!*\n\n📢 ${name}\n📈 Reach: ~${campaign.estimatedReach} customers\n\nThe campaign will be executed shortly.\n\nType "menu" to go back.`;
  } catch (error) {
    logger.error('Campaign approval failed', {
      requestId: context.requestId,
      sellerId,
      campaignId: campaign.campaignId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Sorry, I couldn\'t approve this campaign right now. Please try again.';
  }
}

/**
 * Dismiss a campaign: update status to rejected in DynamoDB.
 *
 * Requirement 5.3
 */
async function handleCampaignDismissal(
  context: SellerCopilotContext,
  campaign: CampaignRecord,
): Promise<string> {
  const sellerId = context.user.id;

  try {
    // Update campaign status to failed (rejected by seller)
    // Note: CampaignRecord status enum uses 'failed' — we treat it as rejected
    await updateCampaign(campaign.campaignId, { status: 'failed' });

    logger.info('Campaign dismissed via WhatsApp', {
      requestId: context.requestId,
      sellerId,
      campaignId: campaign.campaignId,
    });

    // Clean up cache
    pendingCampaignCache.delete(sellerId);
    sellerStates.set(sellerId, 'home');

    const name = campaign.messageText?.substring(0, 50) || 'Campaign';
    return `❌ *Campaign Dismissed*\n\n📢 ${name}\n\nType "menu" to go back.`;
  } catch (error) {
    logger.error('Campaign dismissal failed', {
      requestId: context.requestId,
      sellerId,
      campaignId: campaign.campaignId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'Sorry, I couldn\'t dismiss this campaign right now. Please try again.';
  }
}

// ── Bedrock delegation ─────────────────────────────────────────────────

async function delegateToBedrock(
  context: SellerCopilotContext,
): Promise<string> {
  return bedrockCopilot({
    user: context.user as any,
    message: context.message,
    phoneNumber: context.phoneNumber,
    requestId: context.requestId,
  });
}

/**
 * Re-export for backward compatibility with existing imports.
 */
export { handleSellerCopilotMessage as handleSellerMessage };
