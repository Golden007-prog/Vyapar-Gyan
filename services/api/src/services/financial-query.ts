/**
 * Financial Query Service
 *
 * Provides voice-activated financial reports for sellers via WhatsApp.
 * Extracts financial intent from transcribed voice notes, executes
 * DynamoDB queries, and formats multilingual responses.
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GeminiAdapter } from '../adapters/gemini-adapter';
import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────

export type FinancialIntent =
  | 'daily_sales'
  | 'weekly_revenue'
  | 'monthly_revenue'
  | 'best_sellers'
  | 'pending_orders'
  | 'stock_summary'
  | 'unknown';

export type SupportedLanguage = 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'bn' | 'gu' | 'kn';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'];

export const VALID_INTENTS: FinancialIntent[] = [
  'daily_sales', 'weekly_revenue', 'monthly_revenue',
  'best_sellers', 'pending_orders', 'stock_summary',
];

export interface TimeRange {
  type: 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';
  startDate: string | null;
  endDate: string | null;
}

export interface FinancialIntentResult {
  intent: FinancialIntent;
  timeRange: TimeRange;
  language: SupportedLanguage;
  confidence: number;
}

export interface QueryResult {
  [key: string]: unknown;
}

// ── DynamoDB Client ────────────────────────────────────────────────────

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

async function resolveTableName(): Promise<string> {
  const envTable = process.env.TABLE_NAME;
  if (envTable) return envTable;
  const { getConfig } = await import('../utils/config.js');
  const cfg = await getConfig();
  return cfg.tableName;
}

// ── Multilingual Response Templates ────────────────────────────────────

export const RESPONSE_TEMPLATES: Record<string, Record<SupportedLanguage, string>> = {
  daily_sales: {
    en: "Today's sales: ₹{amount} from {count} orders",
    hi: "आज की बिक्री: ₹{amount} ({count} ऑर्डर)",
    ta: "இன்றைய விற்பனை: ₹{amount} ({count} ஆர்டர்கள்)",
    te: "ఈ రోజు అమ్మకాలు: ₹{amount} ({count} ఆర్డర్లు)",
    mr: "आजची विक्री: ₹{amount} ({count} ऑर्डर)",
    bn: "আজকের বিক্রি: ₹{amount} ({count}টি অর্ডার)",
    gu: "આજનું વેચાણ: ₹{amount} ({count} ઓર્ડર)",
    kn: "ಇಂದಿನ ಮಾರಾಟ: ₹{amount} ({count} ಆರ್ಡರ್‌ಗಳು)",
  },
  weekly_revenue: {
    en: "This week's revenue: ₹{amount} from {count} orders (avg ₹{avg}/order)",
    hi: "इस हफ्ते की आय: ₹{amount} ({count} ऑर्डर, औसत ₹{avg})",
    ta: "இந்த வார வருவாய்: ₹{amount} ({count} ஆர்டர்கள், சராசரி ₹{avg})",
    te: "ఈ వారం ఆదాయం: ₹{amount} ({count} ఆర్డర్లు, సగటు ₹{avg})",
    mr: "या आठवड्याचे उत्पन्न: ₹{amount} ({count} ऑर्डर, सरासरी ₹{avg})",
    bn: "এই সপ্তাহের আয়: ₹{amount} ({count}টি অর্ডার, গড় ₹{avg})",
    gu: "આ અઠવાડિયાની આવક: ₹{amount} ({count} ઓર્ડર, સરેરાશ ₹{avg})",
    kn: "ಈ ವಾರದ ಆದಾಯ: ₹{amount} ({count} ಆರ್ಡರ್‌ಗಳು, ಸರಾಸರಿ ₹{avg})",
  },
  monthly_revenue: {
    en: "Monthly revenue: ₹{amount} from {count} orders (commission: ₹{commission}, net: ₹{net})",
    hi: "मासिक आय: ₹{amount} ({count} ऑर्डर, कमीशन: ₹{commission}, शुद्ध: ₹{net})",
    ta: "மாத வருவாய்: ₹{amount} ({count} ஆர்டர்கள், கமிஷன்: ₹{commission}, நிகர: ₹{net})",
    te: "నెలవారీ ఆదాయం: ₹{amount} ({count} ఆర్డర్లు, కమీషన్: ₹{commission}, నికర: ₹{net})",
    mr: "मासिक उत्पन्न: ₹{amount} ({count} ऑर्डर, कमिशन: ₹{commission}, निव्वळ: ₹{net})",
    bn: "মাসিক আয়: ₹{amount} ({count}টি অর্ডার, কমিশন: ₹{commission}, নিট: ₹{net})",
    gu: "માસિક આવક: ₹{amount} ({count} ઓર્ડર, કમિશન: ₹{commission}, ચોખ્ખી: ₹{net})",
    kn: "ಮಾಸಿಕ ಆದಾಯ: ₹{amount} ({count} ಆರ್ಡರ್‌ಗಳು, ಕಮಿಷನ್: ₹{commission}, ನಿವ್ವಳ: ₹{net})",
  },
  best_sellers: {
    en: "Top sellers:\n{products}",
    hi: "सबसे ज़्यादा बिकने वाले:\n{products}",
    ta: "அதிகம் விற்பனையானவை:\n{products}",
    te: "అత్యధికంగా అమ్ముడైనవి:\n{products}",
    mr: "सर्वाधिक विक्री:\n{products}",
    bn: "সবচেয়ে বেশি বিক্রি:\n{products}",
    gu: "સૌથી વધુ વેચાણ:\n{products}",
    kn: "ಅತಿ ಹೆಚ್ಚು ಮಾರಾಟ:\n{products}",
  },
  pending_orders: {
    en: "Pending orders: {count} orders worth ₹{amount}",
    hi: "लंबित ऑर्डर: {count} ऑर्डर, कुल ₹{amount}",
    ta: "நிலுவை ஆர்டர்கள்: {count} ஆர்டர்கள், மொத்தம் ₹{amount}",
    te: "పెండింగ్ ఆర్డర్లు: {count} ఆర్డర్లు, మొత్తం ₹{amount}",
    mr: "प्रलंबित ऑर्डर: {count} ऑर्डर, एकूण ₹{amount}",
    bn: "মুলতুবি অর্ডার: {count}টি অর্ডার, মোট ₹{amount}",
    gu: "બાકી ઓર્ડર: {count} ઓર્ડર, કુલ ₹{amount}",
    kn: "ಬಾಕಿ ಆರ್ಡರ್‌ಗಳು: {count} ಆರ್ಡರ್‌ಗಳು, ಒಟ್ಟು ₹{amount}",
  },
  stock_summary: {
    en: "Stock summary: {totalProducts} products, {lowStock} low stock, {outOfStock} out of stock (value: ₹{totalValue})",
    hi: "स्टॉक सारांश: {totalProducts} उत्पाद, {lowStock} कम स्टॉक, {outOfStock} स्टॉक खत्म (मूल्य: ₹{totalValue})",
    ta: "இருப்பு சுருக்கம்: {totalProducts} பொருட்கள், {lowStock} குறைந்த இருப்பு, {outOfStock} இருப்பில்லை (மதிப்பு: ₹{totalValue})",
    te: "స్టాక్ సారాంశం: {totalProducts} ఉత్పత్తులు, {lowStock} తక్కువ స్టాక్, {outOfStock} స్టాక్ లేదు (విలువ: ₹{totalValue})",
    mr: "स्टॉक सारांश: {totalProducts} उत्पादने, {lowStock} कमी स्टॉक, {outOfStock} स्टॉक संपला (मूल्य: ₹{totalValue})",
    bn: "স্টক সারসংক্ষেপ: {totalProducts}টি পণ্য, {lowStock}টি কম স্টক, {outOfStock}টি স্টক নেই (মূল্য: ₹{totalValue})",
    gu: "સ્ટોક સારાંશ: {totalProducts} ઉત્પાદનો, {lowStock} ઓછો સ્ટોક, {outOfStock} સ્ટોક ખતમ (મૂલ્ય: ₹{totalValue})",
    kn: "ಸ್ಟಾಕ್ ಸಾರಾಂಶ: {totalProducts} ಉತ್ಪನ್ನಗಳು, {lowStock} ಕಡಿಮೆ ಸ್ಟಾಕ್, {outOfStock} ಸ್ಟಾಕ್ ಇಲ್ಲ (ಮೌಲ್ಯ: ₹{totalValue})",
  },
  unknown: {
    en: "I couldn't understand that. Try asking about sales, orders, or stock.",
    hi: "मैं समझ नहीं पाया। बिक्री, ऑर्डर या स्टॉक के बारे में पूछें।",
    ta: "புரியவில்லை. விற்பனை, ஆர்டர்கள் அல்லது இருப்பு பற்றி கேளுங்கள்.",
    te: "అర్థం కాలేదు. అమ్మకాలు, ఆర్డర్లు లేదా స్టాక్ గురించి అడగండి.",
    mr: "मला समजले नाही. विक्री, ऑर्डर किंवा स्टॉक बद्दल विचारा.",
    bn: "বুঝতে পারলাম না। বিক্রি, অর্ডার বা স্টক সম্পর্কে জিজ্ঞাসা করুন।",
    gu: "સમજાયું નહીં. વેચાણ, ઓર્ડર અથવા સ્ટોક વિશે પૂછો.",
    kn: "ಅರ್ಥವಾಗಲಿಲ್ಲ. ಮಾರಾಟ, ಆರ್ಡರ್‌ಗಳು ಅಥವಾ ಸ್ಟಾಕ್ ಬಗ್ಗೆ ಕೇಳಿ.",
  },
};

// ── Language name mapping (for TTS) ────────────────────────────────────

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  kn: 'Kannada',
};

// ── Intent Extraction ──────────────────────────────────────────────────

/**
 * Extract financial query intent from transcribed text using Gemini.
 *
 * Requirement 22.2: Extract financial query intent and detected language.
 */
export async function extractFinancialIntent(
  gemini: GeminiAdapter,
  transcribedText: string,
  detectedLanguage: string,
): Promise<FinancialIntentResult> {
  try {
    const client = await (gemini as any).getClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You are a financial query parser for an Indian marketplace seller.
Extract the financial query intent from this transcribed voice message.

Return JSON only, no markdown:
{
  "intent": "daily_sales" | "weekly_revenue" | "monthly_revenue" | "best_sellers" | "pending_orders" | "stock_summary" | "unknown",
  "timeRange": {
    "type": "today" | "this_week" | "this_month" | "last_month" | "custom",
    "startDate": null,
    "endDate": null
  },
  "language": "en" | "hi" | "ta" | "te" | "mr" | "bn" | "gu" | "kn",
  "confidence": 0.0-1.0
}

Transcription: "${transcribedText}"
Detected language: "${detectedLanguage}"`;

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

    const intent: FinancialIntent = VALID_INTENTS.includes(parsed.intent)
      ? parsed.intent
      : 'unknown';

    const language: SupportedLanguage = SUPPORTED_LANGUAGES.includes(parsed.language)
      ? parsed.language
      : 'en';

    return {
      intent,
      timeRange: {
        type: parsed.timeRange?.type || 'today',
        startDate: parsed.timeRange?.startDate || null,
        endDate: parsed.timeRange?.endDate || null,
      },
      language,
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    };
  } catch (error) {
    logger.error('Financial intent extraction failed', error, {
      transcribedText: transcribedText.substring(0, 100),
    });
    return {
      intent: 'unknown',
      timeRange: { type: 'today', startDate: null, endDate: null },
      language: 'en',
      confidence: 0,
    };
  }
}

// ── Date Helpers ───────────────────────────────────────────────────────

function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// ── DynamoDB Query Functions ───────────────────────────────────────────

async function queryDailySales(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();
  const todayStart = startOfDay();
  const now = new Date().toISOString();

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    IndexName: 'SellerOrdersIndex',
    KeyConditionExpression: 'sellerId = :sid AND createdAt BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':sid': sellerId,
      ':start': todayStart,
      ':end': now,
    },
  }));

  const orders = result.Items || [];
  const totalAmount = orders.reduce((sum, o) => sum + ((o.subtotal as number) || 0), 0);
  return { amount: totalAmount, count: orders.length };
}

async function queryWeeklyRevenue(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();
  const weekStart = startOfWeek();
  const now = new Date().toISOString();

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    IndexName: 'SellerOrdersIndex',
    KeyConditionExpression: 'sellerId = :sid AND createdAt BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':sid': sellerId,
      ':start': weekStart,
      ':end': now,
    },
  }));

  const orders = result.Items || [];
  const totalAmount = orders.reduce((sum, o) => sum + ((o.subtotal as number) || 0), 0);
  const avg = orders.length > 0 ? Math.round(totalAmount / orders.length) : 0;
  return { amount: totalAmount, count: orders.length, avg };
}

async function queryMonthlyRevenue(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();
  const { year, month } = currentYearMonth();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const result = await docClient.send(new GetCommand({
    TableName: table,
    Key: {
      PK: `SELLER#${sellerId}`,
      SK: `METRICS#${monthStr}`,
    },
  }));

  const metrics = result.Item;
  if (!metrics) {
    return { amount: 0, count: 0, commission: 0, net: 0 };
  }

  return {
    amount: (metrics.totalRevenue as number) || 0,
    count: (metrics.totalOrders as number) || 0,
    commission: (metrics.totalCommission as number) || 0,
    net: (metrics.netRevenue as number) || 0,
  };
}

async function queryBestSellers(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();
  const weekStart = startOfWeek();
  const now = new Date().toISOString();

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    IndexName: 'SellerOrdersIndex',
    KeyConditionExpression: 'sellerId = :sid AND createdAt BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':sid': sellerId,
      ':start': weekStart,
      ':end': now,
    },
  }));

  // Aggregate by productId
  const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const order of result.Items || []) {
    const items = (order.items as Array<{ productId: string; name: string; price: number; quantity: number }>) || [];
    for (const item of items) {
      const existing = productMap.get(item.productId) || { name: item.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity || 1;
      existing.revenue += (item.price || 0) * (item.quantity || 1);
      productMap.set(item.productId, existing);
    }
  }

  // Sort by quantity descending, take top 5
  const sorted = Array.from(productMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const productsText = sorted.length > 0
    ? sorted.map((p, i) => `${i + 1}. ${p.name} — ${p.quantity} sold (₹${p.revenue.toLocaleString('en-IN')})`).join('\n')
    : 'No sales data available';

  return { products: productsText };
}

async function queryPendingOrders(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    IndexName: 'SellerOrdersIndex',
    KeyConditionExpression: 'sellerId = :sid',
    FilterExpression: '#status = :pending',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':sid': sellerId,
      ':pending': 'pending',
    },
    ScanIndexForward: false,
  }));

  const orders = result.Items || [];
  const totalValue = orders.reduce((sum, o) => sum + ((o.subtotal as number) || 0), 0);
  return { count: orders.length, amount: totalValue };
}

async function queryStockSummary(sellerId: string, _timeRange: TimeRange): Promise<QueryResult> {
  const table = await resolveTableName();

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    IndexName: 'SellerStockIndex',
    KeyConditionExpression: 'sellerId = :sid',
    FilterExpression: 'isActive = :active',
    ExpressionAttributeValues: {
      ':sid': sellerId,
      ':active': true,
    },
  }));

  const products = result.Items || [];
  const totalProducts = products.length;
  const lowStock = products.filter(p => (p.stockQuantity as number) > 0 && (p.stockQuantity as number) <= 5).length;
  const outOfStock = products.filter(p => (p.stockQuantity as number) === 0).length;
  const totalValue = products.reduce(
    (sum, p) => sum + ((p.price as number) || 0) * ((p.stockQuantity as number) || 0), 0,
  );

  return { totalProducts, lowStock, outOfStock, totalValue };
}

// ── Query Map ──────────────────────────────────────────────────────────

/**
 * Maps each financial intent to its DynamoDB query function.
 *
 * Requirement 22.3: Execute the corresponding DynamoDB query against seller data.
 */
export const QUERY_MAP: Record<string, (sellerId: string, timeRange: TimeRange) => Promise<QueryResult>> = {
  daily_sales: queryDailySales,
  weekly_revenue: queryWeeklyRevenue,
  monthly_revenue: queryMonthlyRevenue,
  best_sellers: queryBestSellers,
  pending_orders: queryPendingOrders,
  stock_summary: queryStockSummary,
};

// ── Response Formatting ────────────────────────────────────────────────

/**
 * Format a financial query result using the appropriate language template.
 *
 * Requirement 22.4: Format response in the seller's spoken language.
 * Requirement 22.6: Support 8 Indian languages.
 */
export function formatFinancialResponse(
  intent: FinancialIntent,
  language: SupportedLanguage,
  queryResult: QueryResult,
): string {
  const templates = RESPONSE_TEMPLATES[intent];
  if (!templates) {
    return RESPONSE_TEMPLATES.unknown![language] || RESPONSE_TEMPLATES.unknown!.en;
  }

  const template = templates[language] || templates.en;

  // Replace all {key} placeholders with values from queryResult
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = queryResult[key];
    if (value === undefined || value === null) return '0';
    if (typeof value === 'number') {
      return value.toLocaleString('en-IN');
    }
    return String(value);
  });
}

// ── Main Pipeline Function ─────────────────────────────────────────────

/**
 * Execute the full financial query pipeline:
 * 1. Extract intent from transcribed text
 * 2. Execute DynamoDB query
 * 3. Format response in detected language
 *
 * Returns the formatted text response and the detected language for TTS.
 *
 * Requirements: 22.2, 22.3, 22.4, 22.7
 */
export async function executeFinancialQuery(
  gemini: GeminiAdapter,
  sellerId: string,
  transcribedText: string,
  detectedLanguage: string,
): Promise<{ text: string; language: SupportedLanguage; intent: FinancialIntent }> {
  // Step 1: Extract intent
  const intentResult = await extractFinancialIntent(gemini, transcribedText, detectedLanguage);

  logger.info('Financial intent extracted', {
    sellerId,
    intent: intentResult.intent,
    language: intentResult.language,
    confidence: intentResult.confidence,
  });

  // Step 2: Handle unknown intent (Requirement 22.7)
  if (intentResult.intent === 'unknown' || intentResult.confidence < 0.3) {
    const unknownMsg = RESPONSE_TEMPLATES.unknown![intentResult.language] || RESPONSE_TEMPLATES.unknown!.en;
    return { text: unknownMsg, language: intentResult.language, intent: 'unknown' };
  }

  // Step 3: Execute DynamoDB query
  const queryFn = QUERY_MAP[intentResult.intent];
  if (!queryFn) {
    const unknownMsg = RESPONSE_TEMPLATES.unknown![intentResult.language] || RESPONSE_TEMPLATES.unknown!.en;
    return { text: unknownMsg, language: intentResult.language, intent: 'unknown' };
  }

  const queryResult = await queryFn(sellerId, intentResult.timeRange);

  // Step 4: Format response
  const text = formatFinancialResponse(intentResult.intent, intentResult.language, queryResult);

  return { text, language: intentResult.language, intent: intentResult.intent };
}

/**
 * Check if a transcribed text looks like a financial query.
 * Used as a quick pre-filter before calling the full Gemini extraction.
 */
export function isLikelyFinancialQuery(text: string): boolean {
  const lower = text.toLowerCase();
  const financialKeywords = [
    // English
    'sales', 'revenue', 'income', 'earning', 'profit', 'order', 'pending',
    'stock', 'inventory', 'best seller', 'top seller', 'how much', 'total',
    'today', 'this week', 'this month', 'monthly', 'weekly', 'daily',
    // Hindi / Hinglish
    'bikri', 'bechna', 'kamai', 'aaj', 'hafta', 'mahina', 'kitna', 'kitni',
    'order', 'pending', 'stock', 'maal', 'paisa', 'rupee', 'rupay',
    'बिक्री', 'कमाई', 'आज', 'हफ्ता', 'महीना', 'कितना', 'कितनी',
    'ऑर्डर', 'पेंडिंग', 'स्टॉक', 'माल', 'पैसा', 'रुपया',
  ];

  return financialKeywords.some(kw => lower.includes(kw));
}
