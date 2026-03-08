// AI Insights Types
export interface AIInsight {
  id: string;
  sellerId: string;
  insightType: 'DEAD_STOCK_DISCOUNT' | 'PRICE_INCREASE' | 'RESTOCK_ALERT' | 'DEMAND_FORECAST';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  title: string;
  description: string;
  affectedProducts: string[]; // Product IDs
  productCount: number;
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  estimatedImpact: string; // e.g., "+₹12,000 revenue recovery"
  marketResearch?: {
    source: 'GROK' | 'GEMINI';
    summary: string;
    confidence: number;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

// API Response Types
export interface InsightsListResponse {
  insights: AIInsight[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InsightApprovalResponse {
  success: boolean;
  insight: AIInsight;
  campaignId?: string;
  message: string;
}

// UI-specific types
export type InsightCardType = 'discount' | 'price_increase' | 'restock';

export interface InsightCardConfig {
  icon: any;
  color: string;
  bgColor: string;
  textColor: string;
  iconColor: string;
}
