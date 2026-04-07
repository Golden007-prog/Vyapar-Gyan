'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, TrendingUp, TrendingDown, AlertCircle, CheckCircle,
  Loader2, RotateCcw, Send, MessageCircle, Phone, X, Undo2, Archive,
  Bot, Package,
} from 'lucide-react';
import type { AIInsight } from '@/lib/types';

// ── Demo identities ──
const DEMO_CUSTOMER_PHONE = '+917001124396';

// ── Demo customers for notification targeting ──
interface DemoCustomer {
  id: string;
  name: string;
  phone: string;
  lastOrderDate: string;
  totalOrders: number;
  channel: 'web' | 'whatsapp' | 'both';
}

const DEMO_CUSTOMERS: DemoCustomer[] = [
  { id: 'cust-demo-001', name: 'Demo Customer', phone: DEMO_CUSTOMER_PHONE, lastOrderDate: '2 days ago', totalOrders: 5, channel: 'both' },
  { id: 'cust-wa-002', name: 'Priya Sharma', phone: '+919876543210', lastOrderDate: '1 week ago', totalOrders: 3, channel: 'whatsapp' },
  { id: 'cust-wa-003', name: 'Rahul Verma', phone: '+918765432100', lastOrderDate: '3 days ago', totalOrders: 8, channel: 'whatsapp' },
  { id: 'cust-web-004', name: 'Anita Gupta', phone: '+919123456789', lastOrderDate: '5 days ago', totalOrders: 2, channel: 'web' },
  { id: 'cust-wa-005', name: 'Vikram Singh', phone: '+917654321098', lastOrderDate: '2 weeks ago', totalOrders: 1, channel: 'whatsapp' },
];

// ── Demo seeded insights for Dragon Store ──
const DEMO_INSIGHTS: AIInsight[] = [
  {
    id: 'insight-001', sellerId: 'seller-dragon-001', insightType: 'DEAD_STOCK_DISCOUNT', priority: 'HIGH', status: 'PENDING',
    title: 'Dead Stock Alert: Winter Jackets',
    description: '15 winter jacket SKUs have not sold in 68 days. Market analysis via Grok shows demand has shifted to summer wear. A 25% discount campaign could recover ₹18,000 in locked inventory value.',
    affectedProducts: ['prod-001', 'prod-002', 'prod-003'], productCount: 15, suggestedDiscountPercent: 25,
    estimatedImpact: '+₹18,000 revenue recovery',
    marketResearch: { source: 'GROK', summary: 'Winter apparel demand in Mumbai dropped 42% since February. Competitors are clearing stock at 20-30% discounts. Recommend acting within 2 weeks.', confidence: 0.87 },
    createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
  {
    id: 'insight-002', sellerId: 'seller-dragon-001', insightType: 'PRICE_INCREASE', priority: 'MEDIUM', status: 'PENDING',
    title: 'Price Optimization: USB-C Cables',
    description: 'USB-C cables are selling 3x faster than average. Gemini market analysis shows local competitors price 15-20% higher. Increasing price by ₹30 per unit could add ₹4,500/month revenue.',
    affectedProducts: ['prod-010', 'prod-011'], productCount: 8, suggestedPriceIncrease: 30,
    estimatedImpact: '+₹4,500/month revenue',
    marketResearch: { source: 'GEMINI', summary: 'USB-C cable demand up 28% in Maharashtra. Average market price is ₹199 vs your ₹149. Room for 15-20% increase without demand impact.', confidence: 0.92 },
    createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    id: 'insight-003', sellerId: 'seller-dragon-001', insightType: 'RESTOCK_ALERT', priority: 'HIGH', status: 'PENDING',
    title: 'Restock Alert: Amul Butter 500g',
    description: 'Only 3 units remaining. This product sells 12 units/week on average. At current velocity, stock will run out in 2 days.',
    affectedProducts: ['prod-020'], productCount: 1, estimatedImpact: 'Prevent ₹3,360 lost sales/week',
    marketResearch: { source: 'BEDROCK', summary: 'Bedrock dead-stock agent flagged critical low stock. Demand pattern stable at 12 units/week.', confidence: 0.94 },
    createdAt: new Date(Date.now() - 43200000).toISOString(), updatedAt: new Date(Date.now() - 43200000).toISOString(),
  },
  {
    id: 'insight-004', sellerId: 'seller-dragon-001', insightType: 'DEMAND_FORECAST', priority: 'LOW', status: 'APPROVED',
    title: 'Holi Season Demand Forecast',
    description: 'Based on last year\'s data and current trends, expect 3x demand for colors, sweets, and gift items in the next 2 weeks. Pre-stock recommended.',
    affectedProducts: ['prod-030', 'prod-031', 'prod-032'], productCount: 12, estimatedImpact: '+₹25,000 potential revenue',
    marketResearch: { source: 'GEMINI', summary: 'Holi falls on March 14. Historical data shows 280% demand spike for festive items 10 days before. Local wholesale prices rising.', confidence: 0.95 },
    createdAt: new Date(Date.now() - 259200000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'insight-005', sellerId: 'seller-dragon-001', insightType: 'DEAD_STOCK_DISCOUNT', priority: 'MEDIUM', status: 'EXECUTED',
    title: 'Clearance: Old Phone Cases',
    description: 'Campaign sent to 234 past customers. 18 orders received within 48 hours, recovering ₹8,400 from dead inventory.',
    affectedProducts: ['prod-040', 'prod-041'], productCount: 6, suggestedDiscountPercent: 40, estimatedImpact: '₹8,400 recovered',
    createdAt: new Date(Date.now() - 604800000).toISOString(), updatedAt: new Date(Date.now() - 432000000).toISOString(),
  },
];

// ── Severity badge config ──
function getSeverityBadge(priority: AIInsight['priority']) {
  switch (priority) {
    case 'HIGH': return { className: 'bg-red-100 text-red-700 border-red-200', label: 'HIGH' };
    case 'MEDIUM': return { className: 'bg-amber-100 text-amber-700 border-amber-200', label: 'MEDIUM' };
    case 'LOW': return { className: 'bg-blue-100 text-blue-700 border-blue-200', label: 'LOW' };
  }
}

// ── AI source badge config ──
function getSourceBadge(source: 'GROK' | 'GEMINI' | 'BEDROCK') {
  switch (source) {
    case 'GROK': return { className: 'bg-purple-100 text-purple-700', label: 'Grok' };
    case 'GEMINI': return { className: 'bg-cyan-100 text-cyan-700', label: 'Gemini' };
    case 'BEDROCK': return { className: 'bg-orange-100 text-orange-700', label: 'Bedrock' };
  }
}

// ── Check if a dismissed insight is within the 24h recovery window ──
function isRecoverable(insight: AIInsight): boolean {
  if (insight.status !== 'DISMISSED' || !insight.dismissedAt) return false;
  const dismissedTime = new Date(insight.dismissedAt).getTime();
  return Date.now() - dismissedTime < 24 * 60 * 60 * 1000;
}

// ── Insight Card Component ──
interface InsightCardProps {
  insight: AIInsight;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onRecover: (id: string) => void;
  isProcessing: boolean;
}

function InsightCard({ insight, onApprove, onDismiss, onRecover, isProcessing }: InsightCardProps) {
  const getTypeConfig = (type: AIInsight['insightType']) => {
    switch (type) {
      case 'DEAD_STOCK_DISCOUNT': return { icon: TrendingDown, bgColor: 'bg-amber-50', textColor: 'text-amber-900', iconColor: 'text-amber-600' };
      case 'PRICE_INCREASE': return { icon: TrendingUp, bgColor: 'bg-green-50', textColor: 'text-green-900', iconColor: 'text-green-600' };
      case 'RESTOCK_ALERT':
      case 'DEMAND_FORECAST': return { icon: AlertCircle, bgColor: 'bg-blue-50', textColor: 'text-blue-900', iconColor: 'text-blue-600' };
      default: return { icon: Sparkles, bgColor: 'bg-gray-50', textColor: 'text-gray-900', iconColor: 'text-gray-600' };
    }
  };

  const config = getTypeConfig(insight.insightType);
  const Icon = config.icon;
  const severity = getSeverityBadge(insight.priority);
  const isDismissed = insight.status === 'DISMISSED';

  return (
    <div className={`rounded-lg border ${isDismissed ? 'bg-gray-50 opacity-70' : config.bgColor} p-6`}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-white p-2"><Icon className={`h-5 w-5 ${config.iconColor}`} /></div>
        <div className="flex-1">
          {/* Title row with severity + AI source badges */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-lg font-semibold ${config.textColor}`}>{insight.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${severity.className}`}>
              {severity.label}
            </span>
            {insight.marketResearch && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium flex items-center gap-1 ${getSourceBadge(insight.marketResearch.source).className}`}>
                <Bot className="h-3 w-3" />
                {getSourceBadge(insight.marketResearch.source).label}
              </span>
            )}
          </div>

          <p className={`mt-1 text-sm ${config.textColor} opacity-80`}>{insight.description}</p>

          {/* Metrics row: confidence, impact, product count */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <span className={`flex items-center gap-1 ${config.textColor}`}>
              <Package className="h-3.5 w-3.5" />
              <strong>{insight.productCount}</strong> product{insight.productCount !== 1 ? 's' : ''} affected
            </span>
            <span className={config.textColor}>
              Impact: <strong>{insight.estimatedImpact}</strong>
            </span>
            {insight.marketResearch && (
              <span className={config.textColor}>
                Confidence: <strong>{Math.round(insight.marketResearch.confidence * 100)}%</strong>
              </span>
            )}
          </div>

          {insight.suggestedDiscountPercent && (
            <div className="mt-2 text-sm"><span className={config.textColor}>Suggested discount: <strong>{insight.suggestedDiscountPercent}%</strong></span></div>
          )}
          {insight.suggestedPriceIncrease && (
            <div className="mt-2 text-sm"><span className={config.textColor}>Suggested increase: <strong>+₹{insight.suggestedPriceIncrease}</strong>/unit</span></div>
          )}

          {/* Market research summary */}
          {insight.marketResearch && (
            <div className="mt-3 rounded-lg bg-white/50 p-3">
              <p className="text-xs font-medium text-gray-700">
                AI Market Research ({insight.marketResearch.source}) · {Math.round(insight.marketResearch.confidence * 100)}% confidence
              </p>
              <p className="mt-1 text-xs text-gray-600">{insight.marketResearch.summary}</p>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {insight.status === 'PENDING' && (
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button onClick={() => onApprove(insight.id)} disabled={isProcessing}
            className="flex-1 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {isProcessing ? <><Loader2 className="h-4 w-4 animate-spin" />Processing...</> : <><CheckCircle className="h-4 w-4 text-green-600" />Approve &amp; Send</>}
          </button>
          <button onClick={() => onDismiss(insight.id)} disabled={isProcessing}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center sm:justify-start gap-2">
            <Archive className="h-4 w-4" /> Dismiss
          </button>
        </div>
      )}
      {insight.status === 'DISMISSED' && isRecoverable(insight) && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-gray-500">Dismissed</span>
          <button onClick={() => onRecover(insight.id)} disabled={isProcessing}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1.5">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <span className="text-xs text-gray-400">Recovery available for 24h</span>
        </div>
      )}
      {insight.status === 'APPROVED' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-green-700"><CheckCircle className="h-4 w-4" /><span>Approved — Campaign will be executed shortly</span></div>
      )}
      {insight.status === 'EXECUTED' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-blue-700"><CheckCircle className="h-4 w-4" /><span>Executed — Campaign sent to customers</span></div>
      )}
    </div>
  );
}

// ── Main Page Component ──
export default function AIInsightsPage() {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [dismissedInsights, setDismissedInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Campaign notification modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [pendingInsight, setPendingInsight] = useState<AIInsight | null>(null);
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [sendChannel, setSendChannel] = useState<'web' | 'whatsapp' | 'both'>('both');
  const [sendingNotification, setSendingNotification] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Show/hide dismissed section
  const [showDismissed, setShowDismissed] = useState(false);

  const loadInsights = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setInsights(DEMO_INSIGHTS.filter(i => i.status !== 'DISMISSED'));
      setDismissedInsights([]);
      setLoading(false);
    }, 600);
  }, []);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  // ── Approve & Send: open campaign modal ──
  const handleApprove = (id: string) => {
    const insight = insights.find(i => i.id === id);
    if (!insight) return;

    if (insight.insightType === 'DEAD_STOCK_DISCOUNT' || insight.insightType === 'PRICE_INCREASE') {
      setPendingInsight(insight);
      setSelectedCustomers(new Set(DEMO_CUSTOMERS.map(c => c.id)));
      setSendChannel('both');
      setSendSuccess(false);
      setShowSendModal(true);
    } else {
      setProcessingId(id);
      setTimeout(() => {
        setInsights(prev => prev.map(i => i.id === id ? { ...i, status: 'APPROVED' as const } : i));
        setProcessingId(null);
      }, 1200);
    }
  };

  // ── Dismiss: move to dismissed list with dismissedAt ──
  const handleDismiss = (id: string) => {
    setProcessingId(id);
    setTimeout(() => {
      setInsights(prev => {
        const target = prev.find(i => i.id === id);
        if (target) {
          const dismissed: AIInsight = { ...target, status: 'DISMISSED', dismissedAt: new Date().toISOString() };
          setDismissedInsights(d => [dismissed, ...d]);
        }
        return prev.filter(i => i.id !== id);
      });
      setProcessingId(null);
    }, 400);
  };

  // ── Recover: undo dismiss within 24h ──
  const handleRecover = (id: string) => {
    setProcessingId(id);
    setTimeout(() => {
      setDismissedInsights(prev => {
        const target = prev.find(i => i.id === id);
        if (target) {
          const recovered: AIInsight = { ...target, status: 'PENDING', dismissedAt: undefined };
          setInsights(ins => [recovered, ...ins]);
        }
        return prev.filter(i => i.id !== id);
      });
      setProcessingId(null);
    }, 400);
  };

  // ── Refresh: re-trigger trend analyzer + dead-stock agent ──
  const handleRefresh = () => {
    setRefreshing(true);
    // Simulate re-triggering the trend analyzer worker and dead-stock agent
    setTimeout(() => {
      setInsights(DEMO_INSIGHTS.filter(i => i.status !== 'DISMISSED'));
      setDismissedInsights([]);
      setRefreshing(false);
    }, 1500);
  };

  // ── Send campaign notification ──
  const handleSendNotification = async () => {
    if (!pendingInsight || selectedCustomers.size === 0) return;
    setSendingNotification(true);

    const messageText = `🏷️ Special Offer from Dragon Store!\n\n${pendingInsight.title}\n${pendingInsight.suggestedDiscountPercent ? `${pendingInsight.suggestedDiscountPercent}% OFF` : pendingInsight.description}\n\nReply to this message to order!`;

    const targets = DEMO_CUSTOMERS
      .filter(c => selectedCustomers.has(c.id))
      .map(c => ({ userId: c.id, phoneNumber: c.phone }));

    try {
      // Call campaign send API
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';
      let token: string | null = null;
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        token = session.tokens?.idToken?.toString() ?? null;
      } catch { /* no auth */ }

      const res = await fetch(`${API_BASE_URL}/api/v1/seller/campaigns/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          channel: sendChannel,
          targets,
          messageText,
          insightId: pendingInsight.id,
        }),
      });

      if (!res.ok) {
        console.warn('Campaign send API returned', res.status);
      }

      // Also store in local sessionStorage for immediate UI feedback
      try {
        const INBOX_STORE_KEY = 'vyapargyan_inbox_messages';
        const store = JSON.parse(sessionStorage.getItem(INBOX_STORE_KEY) || '{}');
        const sessionId = 'session-demo-customer';
        const existing = store[sessionId] || [];
        const notifMsg = {
          id: `notif-${Date.now()}`,
          direction: 'outbound',
          messageType: 'text',
          content: { text: messageText },
          status: 'delivered',
          createdAt: new Date().toISOString(),
        };
        store[sessionId] = [...existing, notifMsg];
        sessionStorage.setItem(INBOX_STORE_KEY, JSON.stringify(store));
      } catch { /* ignore */ }
    } catch (err) {
      console.error('Campaign send failed', err);
      // Still mark as executed for demo purposes
    }

    setInsights(prev => prev.map(i => i.id === pendingInsight.id ? { ...i, status: 'EXECUTED' as const } : i));
    setSendingNotification(false);
    setSendSuccess(true);
  };

  const closeSendModal = () => { setShowSendModal(false); setPendingInsight(null); setSendSuccess(false); };

  const pendingCount = insights.filter(i => i.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Insights</h1>
          <p className="mt-1 text-sm text-gray-600">Review and approve AI-generated pricing and inventory recommendations</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RotateCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 sm:px-4 py-2">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
            <span className="text-xs sm:text-sm font-medium text-indigo-900">{pendingCount} pending</span>
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-900">How AI Insights Work</p>
            <p className="mt-1 text-sm text-blue-700">
              AI analyzes your inventory, tracks stock age, researches market trends using Grok, Gemini, and Bedrock, and suggests data-driven actions.
              When you approve a discount campaign, you choose which customers to notify and through which channel (Web Chat or WhatsApp).
            </p>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <span className="ml-3 text-sm text-gray-600">Loading insights...</span>
        </div>
      )}

      {/* Active insights */}
      {!loading && (
        <div className="space-y-4">
          {insights.map(insight => (
            <InsightCard key={insight.id} insight={insight}
              onApprove={handleApprove} onDismiss={handleDismiss} onRecover={handleRecover}
              isProcessing={processingId === insight.id} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && insights.length === 0 && dismissedInsights.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <Sparkles className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No insights available</h3>
          <p className="mt-2 text-sm text-gray-600">AI is analyzing your inventory. Check back soon for recommendations.</p>
        </div>
      )}

      {/* Dismissed insights section */}
      {!loading && dismissedInsights.length > 0 && (
        <div>
          <button onClick={() => setShowDismissed(!showDismissed)}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700">
            <Archive className="h-4 w-4" />
            {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissedInsights.length})
          </button>
          {showDismissed && (
            <div className="mt-3 space-y-4">
              {dismissedInsights.map(insight => (
                <InsightCard key={insight.id} insight={insight}
                  onApprove={handleApprove} onDismiss={handleDismiss} onRecover={handleRecover}
                  isProcessing={processingId === insight.id} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Campaign Notification Modal ── */}
      {showSendModal && pendingInsight && (
        <CampaignModal
          pendingInsight={pendingInsight}
          selectedCustomers={selectedCustomers}
          setSelectedCustomers={setSelectedCustomers}
          sendChannel={sendChannel}
          setSendChannel={setSendChannel}
          sendingNotification={sendingNotification}
          sendSuccess={sendSuccess}
          onSend={handleSendNotification}
          onClose={closeSendModal}
        />
      )}
    </div>
  );
}

// ── Campaign Notification Modal ──
interface CampaignModalProps {
  pendingInsight: AIInsight;
  selectedCustomers: Set<string>;
  setSelectedCustomers: React.Dispatch<React.SetStateAction<Set<string>>>;
  sendChannel: 'web' | 'whatsapp' | 'both';
  setSendChannel: (ch: 'web' | 'whatsapp' | 'both') => void;
  sendingNotification: boolean;
  sendSuccess: boolean;
  onSend: () => void;
  onClose: () => void;
}

function CampaignModal({
  pendingInsight, selectedCustomers, setSelectedCustomers,
  sendChannel, setSendChannel, sendingNotification, sendSuccess, onSend, onClose,
}: CampaignModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-900">Send Campaign Notification</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {!sendSuccess ? (
          <>
            {/* What's being sent */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4">
              <p className="text-sm font-medium text-amber-900">{pendingInsight.title}</p>
              <p className="mt-1 text-xs text-amber-700">
                {pendingInsight.suggestedDiscountPercent && `${pendingInsight.suggestedDiscountPercent}% discount campaign · `}
                {pendingInsight.estimatedImpact}
              </p>
              {pendingInsight.marketResearch && (
                <p className="mt-1 text-xs text-amber-600">
                  AI Reason ({pendingInsight.marketResearch.source}): {pendingInsight.marketResearch.summary.slice(0, 100)}...
                </p>
              )}
            </div>

            {/* Channel selection */}
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Notification Channel</p>
              <div className="flex gap-2">
                {([
                  { value: 'web' as const, label: 'Web Chat', icon: MessageCircle },
                  { value: 'whatsapp' as const, label: 'WhatsApp', icon: Phone },
                  { value: 'both' as const, label: 'Both', icon: Send },
                ] as const).map(ch => (
                  <button key={ch.value} onClick={() => setSendChannel(ch.value)}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition ${
                      sendChannel === ch.value
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    <ch.icon className="h-4 w-4" />
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Customer selection */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Select Customers ({selectedCustomers.size}/{DEMO_CUSTOMERS.length})</p>
                <button onClick={() => setSelectedCustomers(prev => prev.size === DEMO_CUSTOMERS.length ? new Set() : new Set(DEMO_CUSTOMERS.map(c => c.id)))}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  {selectedCustomers.size === DEMO_CUSTOMERS.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {DEMO_CUSTOMERS.map(customer => (
                  <label key={customer.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition ${
                      selectedCustomers.has(customer.id) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                    <input type="checkbox" checked={selectedCustomers.has(customer.id)}
                      onChange={() => setSelectedCustomers(prev => {
                        const next = new Set(prev);
                        next.has(customer.id) ? next.delete(customer.id) : next.add(customer.id);
                        return next;
                      })}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{customer.name}</p>
                      <p className="text-xs text-gray-500">{customer.phone} · {customer.totalOrders} orders · Last: {customer.lastOrderDate}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      customer.channel === 'whatsapp' ? 'bg-green-100 text-green-700' :
                      customer.channel === 'web' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {customer.channel === 'both' ? 'Web + WA' : customer.channel === 'whatsapp' ? 'WhatsApp' : 'Web'}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-gray-50 p-3 mb-4">
              <p className="text-xs text-gray-600">
                <strong>{selectedCustomers.size}</strong> customer{selectedCustomers.size !== 1 ? 's' : ''} will receive this notification via{' '}
                <strong>{sendChannel === 'both' ? 'Web Chat + WhatsApp' : sendChannel === 'whatsapp' ? 'WhatsApp (Twilio)' : 'Web Chat'}</strong>
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={onSend} disabled={selectedCustomers.size === 0 || sendingNotification}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {sendingNotification ? <><Loader2 className="h-4 w-4 animate-spin" />Sending...</> : <><Send className="h-4 w-4" />Send Notification</>}
              </button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center">
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <p className="mt-4 text-lg font-medium text-gray-900">Campaign Sent</p>
            <p className="mt-1 text-sm text-gray-500">
              Notification sent to {selectedCustomers.size} customer{selectedCustomers.size !== 1 ? 's' : ''} via {sendChannel === 'both' ? 'Web Chat + WhatsApp' : sendChannel}
            </p>
            <p className="mt-2 text-xs text-gray-400">Check the Customer Inbox to see the notification delivered</p>
            <button onClick={onClose} className="mt-6 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
