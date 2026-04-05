'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserSearch, Users, UserPlus, IndianRupee, ShoppingBag,
  Search, Filter, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  listCustomers,
  type CustomerListItem,
  type CustomerSummary,
} from '@/lib/api-customers';

// Mock data for demo / fallback
const MOCK_CUSTOMERS: CustomerListItem[] = [
  { userId: 'cust-001', name: 'Priya Sharma', phone: '+91 98765 43210', registeredDate: '2025-11-15T10:00:00Z', totalOrders: 24, ltv: 18500, storesVisited: 3, lastActive: '2026-03-10T14:30:00Z', preferredChannel: 'whatsapp' },
  { userId: 'cust-002', name: 'Rahul Verma', phone: '+91 87654 32109', registeredDate: '2025-12-01T08:00:00Z', totalOrders: 15, ltv: 12200, storesVisited: 2, lastActive: '2026-03-09T11:00:00Z', preferredChannel: 'web' },
  { userId: 'cust-003', name: 'Anita Patel', phone: '+91 76543 21098', registeredDate: '2026-01-10T12:00:00Z', totalOrders: 8, ltv: 6800, storesVisited: 1, lastActive: '2026-03-08T09:15:00Z', preferredChannel: 'both' },
  { userId: 'cust-004', name: 'Vikram Singh', phone: '+91 65432 10987', registeredDate: '2026-02-05T16:00:00Z', totalOrders: 31, ltv: 27400, storesVisited: 5, lastActive: '2026-03-10T18:00:00Z', preferredChannel: 'whatsapp' },
  { userId: 'cust-005', name: 'Meera Joshi', phone: '+91 54321 09876', registeredDate: '2026-02-20T09:00:00Z', totalOrders: 5, ltv: 3200, storesVisited: 1, lastActive: '2026-03-07T20:45:00Z', preferredChannel: 'web' },
  { userId: 'cust-006', name: 'Arjun Reddy', phone: '+91 43210 98765', registeredDate: '2026-03-01T11:00:00Z', totalOrders: 2, ltv: 1500, storesVisited: 1, lastActive: '2026-03-10T08:00:00Z', preferredChannel: 'whatsapp' },
  { userId: 'cust-007', name: 'Deepa Gupta', phone: '+91 32109 87654', registeredDate: '2026-03-05T14:00:00Z', totalOrders: 0, ltv: 0, storesVisited: 0, lastActive: '2026-03-05T14:00:00Z', preferredChannel: 'web' },
  { userId: 'cust-008', name: 'Suresh Kumar', phone: '+91 21098 76543', registeredDate: '2025-10-20T07:00:00Z', totalOrders: 42, ltv: 35600, storesVisited: 6, lastActive: '2026-03-10T16:30:00Z', preferredChannel: 'both' },
];

function computeMockSummary(customers: CustomerListItem[]): CustomerSummary {
  const totalLTV = customers.reduce((s, c) => s + c.ltv, 0);
  const totalOrders = customers.reduce((s, c) => s + c.totalOrders, 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return {
    totalCustomers: customers.length,
    newThisMonth: customers.filter((c) => c.registeredDate >= monthStart).length,
    averageLTV: customers.length ? Math.round(totalLTV / customers.length) : 0,
    averageOrdersPerCustomer: customers.length ? Math.round((totalOrders / customers.length) * 10) / 10 : 0,
  };
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [summary, setSummary] = useState<CustomerSummary>({ totalCustomers: 0, newThisMonth: 0, averageLTV: 0, averageOrdersPerCustomer: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState('registeredDate');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [ltvMin, setLtvMin] = useState('');
  const [ltvMax, setLtvMax] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCustomers({
        search: searchQuery || undefined,
        page,
        size: 20,
        sort,
        ltv_min: ltvMin ? parseFloat(ltvMin) : undefined,
        ltv_max: ltvMax ? parseFloat(ltvMax) : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setCustomers(data.customers);
      setSummary(data.summary);
      setTotalPages(data.totalPages);
    } catch {
      // Fallback to mock data
      let filtered = [...MOCK_CUSTOMERS];
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
      }
      if (dateFrom) filtered = filtered.filter((c) => c.registeredDate >= dateFrom);
      if (dateTo) filtered = filtered.filter((c) => c.registeredDate <= dateTo);
      if (ltvMin) filtered = filtered.filter((c) => c.ltv >= parseFloat(ltvMin));
      if (ltvMax) filtered = filtered.filter((c) => c.ltv <= parseFloat(ltvMax));
      filtered.sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'ltv') return b.ltv - a.ltv;
        if (sort === 'orders') return b.totalOrders - a.totalOrders;
        return b.registeredDate.localeCompare(a.registeredDate);
      });
      setCustomers(filtered);
      setSummary(computeMockSummary(MOCK_CUSTOMERS));
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, page, sort, dateFrom, dateTo, ltvMin, ltvMax]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const formatCurrency = (v: number) =>
    v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v}`;

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const channelBadge = (ch: string) => {
    const styles: Record<string, string> = {
      whatsapp: 'bg-green-100 text-green-700',
      web: 'bg-blue-100 text-blue-700',
      both: 'bg-purple-100 text-purple-700',
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[ch] || 'bg-gray-100 text-gray-700'}`}>
        {ch === 'whatsapp' ? 'WhatsApp' : ch === 'both' ? 'Both' : 'Web'}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-sm text-gray-600">Loading customers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Directory</h1>
        <p className="mt-1 text-sm text-gray-500">
          View customer profiles, lifetime value, and cross-pollination metrics.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Users} label="Total Customers" value={String(summary.totalCustomers)} color="indigo" />
        <SummaryCard icon={UserPlus} label="New This Month" value={String(summary.newThisMonth)} color="green" />
        <SummaryCard icon={IndianRupee} label="Avg LTV" value={formatCurrency(summary.averageLTV)} color="amber" />
        <SummaryCard icon={ShoppingBag} label="Avg Orders/Customer" value={String(summary.averageOrdersPerCustomer)} color="blue" />
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="registeredDate">Newest First</option>
            <option value="name">Name A-Z</option>
            <option value="ltv">Highest LTV</option>
            <option value="orders">Most Orders</option>
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm ${showFilters ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            <Filter className="h-4 w-4" /> Filters
          </button>
        </div>
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 rounded-lg border bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Registered From</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Registered To</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Min LTV (₹)</label>
            <input type="number" value={ltvMin} onChange={(e) => { setLtvMin(e.target.value); setPage(1); }}
              placeholder="0" className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Max LTV (₹)</label>
            <input type="number" value={ltvMax} onChange={(e) => { setLtvMax(e.target.value); setPage(1); }}
              placeholder="∞" className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Phone', 'Registered', 'Orders', 'LTV', 'Stores Visited', 'Last Active', 'Channel'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {customers.map((c) => (
                <tr
                  key={c.userId}
                  onClick={() => router.push(`/admin/customers/${c.userId}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-sm font-medium">
                        {c.name.charAt(0)}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{c.phone}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDate(c.registeredDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{c.totalOrders}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(c.ltv)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{c.storesVisited}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDate(c.lastActive)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{channelBadge(c.preferredChannel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {customers.length === 0 && (
          <div className="py-12 text-center">
            <UserSearch className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2 text-sm text-gray-600">No customers found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Summary Card Component ---

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: 'indigo' | 'green' | 'amber' | 'blue';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    blue: 'bg-blue-100 text-blue-600',
  };
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`rounded-full p-2 ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
