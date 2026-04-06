import { fetchWithAuth } from './api-client';

export interface DashboardMetrics {
  totalSales: string;
  totalSalesChange?: string;
  totalSalesTrend?: 'up' | 'down';
  activeProducts: string;
  activeProductsChange?: string;
  activeCampaigns: string;
  activeCampaignsChange?: string;
  monthlyRevenue: string;
  monthlyRevenueChange?: string;
  monthlyRevenueTrend?: 'up' | 'down';
}

/**
 * Fetch seller dashboard metrics from the backend API.
 * Returns real metrics when available; caller should fall back to demo data on error.
 */
export async function fetchSellerDashboard(): Promise<DashboardMetrics> {
  return fetchWithAuth<DashboardMetrics>('/api/v1/seller/dashboard');
}
