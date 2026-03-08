'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  XCircle,
  MessageSquare,
  Eye,
  TrendingUp,
  Sparkles,
  Clock,
  AlertCircle,
} from 'lucide-react';
// System health uses pre-seeded mock data for demo

type ServiceStatus = 'operational' | 'degraded' | 'down';

interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  lastChecked: string;
  uptime: number;
  responseTime?: number;
  errorRate?: number;
}

interface ErrorLog {
  id: string;
  timestamp: string;
  service: string;
  errorType: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface SystemHealth {
  services: ServiceHealth[];
  recentErrors: ErrorLog[];
  systemMetrics: {
    totalAPIRequests: number;
    averageResponseTime: number;
    errorRate: number;
    activeWebhooks: number;
  };
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    loadSystemHealth();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadSystemHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSystemHealth = async () => {
    try {
      // Mock data for now - replace with actual API call
      // const data = await api.get<SystemHealth>('/api/admin/system/health');
      const mockHealth: SystemHealth = {
        services: [
          {
            name: 'Twilio WhatsApp',
            status: 'operational',
            lastChecked: new Date().toISOString(),
            uptime: 99.8,
            responseTime: 245,
            errorRate: 0.2,
          },
          {
            name: 'Gemini Vision OCR',
            status: 'operational',
            lastChecked: new Date().toISOString(),
            uptime: 99.5,
            responseTime: 1850,
            errorRate: 0.5,
          },
          {
            name: 'Grok Market Analysis',
            status: 'degraded',
            lastChecked: new Date().toISOString(),
            uptime: 97.2,
            responseTime: 3200,
            errorRate: 2.8,
          },
          {
            name: 'Bedrock Orchestration',
            status: 'operational',
            lastChecked: new Date().toISOString(),
            uptime: 99.9,
            responseTime: 890,
            errorRate: 0.1,
          },
          {
            name: 'Razorpay Payments',
            status: 'operational',
            lastChecked: new Date().toISOString(),
            uptime: 99.95,
            responseTime: 320,
            errorRate: 0.05,
          },
          {
            name: 'DynamoDB',
            status: 'operational',
            lastChecked: new Date().toISOString(),
            uptime: 100,
            responseTime: 12,
            errorRate: 0,
          },
        ],
        recentErrors: [
          {
            id: '1',
            timestamp: '2026-03-07T01:45:00Z',
            service: 'Grok Market Analysis',
            errorType: 'Rate Limit Exceeded',
            message: 'API rate limit exceeded for market trend analysis',
            severity: 'medium',
          },
          {
            id: '2',
            timestamp: '2026-03-07T01:30:00Z',
            service: 'Razorpay Payments',
            errorType: 'Webhook Delivery Failed',
            message: 'Failed to deliver payment confirmation webhook (retry scheduled)',
            severity: 'low',
          },
          {
            id: '3',
            timestamp: '2026-03-07T01:15:00Z',
            service: 'Twilio WhatsApp',
            errorType: 'Message Delivery Failed',
            message: 'WhatsApp message bounced - invalid phone number',
            severity: 'low',
          },
          {
            id: '4',
            timestamp: '2026-03-07T00:50:00Z',
            service: 'Gemini Vision OCR',
            errorType: 'Processing Timeout',
            message: 'OCR processing timeout for Khata book image (file too large)',
            severity: 'medium',
          },
          {
            id: '5',
            timestamp: '2026-03-07T00:20:00Z',
            service: 'Razorpay Payments',
            errorType: 'Commission Split Failed',
            message: 'Failed to split commission for order #12345 (insufficient balance)',
            severity: 'high',
          },
        ],
        systemMetrics: {
          totalAPIRequests: 45678,
          averageResponseTime: 245,
          errorRate: 0.8,
          activeWebhooks: 3,
        },
      };
      setHealth(mockHealth);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to load system health:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: ServiceStatus) => {
    switch (status) {
      case 'operational':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'down':
        return <XCircle className="h-5 w-5 text-red-600" />;
    }
  };

  const getStatusBadge = (status: ServiceStatus) => {
    const styles = {
      operational: 'bg-green-100 text-green-800',
      degraded: 'bg-yellow-100 text-yellow-800',
      down: 'bg-red-100 text-red-800',
    };

    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
      >
        {getStatusIcon(status)}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getSeverityBadge = (severity: ErrorLog['severity']) => {
    const styles = {
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
    };

    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[severity]}`}
      >
        {severity.charAt(0).toUpperCase() + severity.slice(1)}
      </span>
    );
  };

  const getServiceIcon = (serviceName: string) => {
    if (serviceName.includes('WhatsApp') || serviceName.includes('Twilio')) {
      return <MessageSquare className="h-5 w-5" />;
    }
    if (serviceName.includes('Gemini') || serviceName.includes('OCR')) {
      return <Eye className="h-5 w-5" />;
    }
    if (serviceName.includes('Grok') || serviceName.includes('Market')) {
      return <TrendingUp className="h-5 w-5" />;
    }
    if (serviceName.includes('Bedrock')) {
      return <Sparkles className="h-5 w-5" />;
    }
    return <Activity className="h-5 w-5" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600">Loading system health...</p>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Failed to load system health data</p>
      </div>
    );
  }

  const operationalCount = health.services.filter((s) => s.status === 'operational').length;
  const degradedCount = health.services.filter((s) => s.status === 'degraded').length;
  const downCount = health.services.filter((s) => s.status === 'down').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health & AI Monitor</h1>
          <p className="mt-1 text-sm text-gray-600">
            Real-time monitoring of external APIs and AI services
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={loadSystemHealth}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Refresh Now
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
      </div>

      {/* Overall status */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Overall System Status</h2>
            <p className="mt-1 text-sm text-gray-600">
              {operationalCount} operational, {degradedCount} degraded, {downCount} down
            </p>
          </div>
          <div className="flex items-center gap-2">
            {downCount > 0 ? (
              <div className="flex items-center gap-2 rounded-full bg-red-100 px-4 py-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <span className="text-sm font-medium text-red-800">System Issues</span>
              </div>
            ) : degradedCount > 0 ? (
              <div className="flex items-center gap-2 rounded-full bg-yellow-100 px-4 py-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">Partial Outage</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-green-100 px-4 py-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-green-800">All Systems Operational</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* System metrics */}
      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">API Requests</p>
              <p className="text-2xl font-bold text-gray-900">
                {health.systemMetrics.totalAPIRequests.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">Last 24 hours</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-green-100 p-2">
              <Clock className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Avg Response Time</p>
              <p className="text-2xl font-bold text-gray-900">
                {health.systemMetrics.averageResponseTime}ms
              </p>
              <p className="text-xs text-gray-500">Across all services</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Error Rate</p>
              <p className="text-2xl font-bold text-gray-900">
                {health.systemMetrics.errorRate}%
              </p>
              <p className="text-xs text-gray-500">Last 24 hours</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-purple-100 p-2">
              <MessageSquare className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active Webhooks</p>
              <p className="text-2xl font-bold text-gray-900">
                {health.systemMetrics.activeWebhooks}
              </p>
              <p className="text-xs text-gray-500">Currently listening</p>
            </div>
          </div>
        </div>
      </div>

      {/* Service status cards */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">External Services & AI APIs</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {health.services.map((service) => (
            <div
              key={service.name}
              className="rounded-lg border bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-full p-2 ${
                      service.status === 'operational'
                        ? 'bg-green-100'
                        : service.status === 'degraded'
                        ? 'bg-yellow-100'
                        : 'bg-red-100'
                    }`}
                  >
                    {getServiceIcon(service.name)}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{service.name}</h3>
                    <p className="text-xs text-gray-500">
                      Checked {new Date(service.lastChecked).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                {getStatusBadge(service.status)}
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Uptime</span>
                  <span className="font-medium text-gray-900">{service.uptime}%</span>
                </div>
                {service.responseTime && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Response Time</span>
                    <span className="font-medium text-gray-900">{service.responseTime}ms</span>
                  </div>
                )}
                {service.errorRate !== undefined && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Error Rate</span>
                    <span
                      className={`font-medium ${
                        service.errorRate > 2 ? 'text-red-600' : 'text-gray-900'
                      }`}
                    >
                      {service.errorRate}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent errors */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Error Logs</h2>
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Service
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Error Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Message
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Severity
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {health.recentErrors.map((error) => (
                  <tr key={error.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(error.timestamp).toLocaleString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getServiceIcon(error.service)}
                        <span className="text-sm font-medium text-gray-900">
                          {error.service}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {error.errorType}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 max-w-md">
                      {error.message}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getSeverityBadge(error.severity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {health.recentErrors.length === 0 && (
            <div className="text-center py-12">
              <CheckCircle className="mx-auto h-12 w-12 text-green-400" />
              <p className="mt-2 text-sm text-gray-600">No recent errors</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
