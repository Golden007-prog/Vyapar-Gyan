'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, User, Phone, Calendar, ShoppingBag, IndianRupee,
  Store, MessageSquare, Heart, Globe,
} from 'lucide-react';
import {
  getCustomerDetail,
  type CustomerDetail,
  type OrderSummary,
  type ChatMessage,
  type FavoriteStore,
} from '@/lib/api-customers';

// Mock detail for demo / fallback
const MOCK_DETAIL: CustomerDetail = {
  userId: 'cust-001',
  name: 'Priya Sharma',
  phone: '+91 98765 43210',
  registeredDate: '2025-11-15T10:00:00Z',
  totalOrders: 24,
  ltv: 18500,
  storesVisited: 3,
  lastActive: '2026-03-10T14:30:00Z',
  preferredChannel: 'whatsapp',
  orders: [
    { orderId: 'VG-20260310-0012', sellerId: 'seller-dragon-001', totalAmount: 1250, status: 'DELIVERED', createdAt: '2026-03-10T10:00:00Z' },
    { orderId: 'VG-20260305-0045', sellerId: 'seller-1', totalAmount: 890, status: 'DELIVERED', createdAt: '2026-03-05T14:00:00Z' },
    { orderId: 'VG-20260228-0078', sellerId: 'seller-dragon-001', totalAmount: 2100, status: 'DELIVERED', createdAt: '2026-02-28T09:00:00Z' },
    { orderId: 'VG-20260220-0091', sellerId: 'seller-3', totalAmount: 560, status: 'CANCELLED', createdAt: '2026-02-20T16:00:00Z' },
  ],
  chatHistory: [
    { messageId: 'msg-1', content: 'Hi, do you have Amul Butter?', channel: 'whatsapp', senderRole: 'customer', createdAt: '2026-03-10T14:00:00Z' },
    { messageId: 'msg-2', content: 'Yes! Amul Butter 500g is available at ₹280.', channel: 'system', senderRole: 'system', createdAt: '2026-03-10T14:00:05Z' },
    { messageId: 'msg-3', content: 'Add 2 to cart', channel: 'whatsapp', senderRole: 'customer', createdAt: '2026-03-10T14:01:00Z' },
  ],
  favoriteStores: [
    { sellerId: 'seller-dragon-001', storeName: 'Dragon Store', addedAt: '2025-12-01T10:00:00Z' },
    { sellerId: 'seller-3', storeName: 'Patel Groceries', addedAt: '2026-01-15T08:00:00Z' },
  ],
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'orders' | 'chat' | 'favorites'>('orders');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getCustomerDetail(customerId);
        setCustomer(data.customer);
      } catch {
        // Fallback to mock
        setCustomer({ ...MOCK_DETAIL, userId: customerId });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [customerId]);

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatDateTime = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const formatCurrency = (v: number) => `₹${v.toLocaleString('en-IN')}`;

  const channelLabel = (ch: string) => {
    if (ch === 'whatsapp') return 'WhatsApp';
    if (ch === 'both') return 'Web + WhatsApp';
    return 'Web';
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      DELIVERED: 'bg-green-100 text-green-700',
      PAID: 'bg-blue-100 text-blue-700',
      PROCESSING: 'bg-yellow-100 text-yellow-700',
      PENDING_PAYMENT: 'bg-orange-100 text-orange-700',
      CANCELLED: 'bg-red-100 text-red-700',
      SHIPPED: 'bg-indigo-100 text-indigo-700',
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  const channelIcon = (ch: string) => {
    if (ch === 'whatsapp') return <span className="text-green-600 text-xs">WA</span>;
    if (ch === 'web') return <Globe className="h-3 w-3 text-blue-500" />;
    return <span className="text-gray-400 text-xs">SYS</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <User className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-2 text-gray-600">Customer not found</p>
        <button onClick={() => router.push('/admin/customers')} className="mt-4 text-indigo-600 hover:underline text-sm">
          ← Back to directory
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/admin/customers')}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Customer Directory
      </button>

      {/* Profile Header */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xl font-bold">
              {customer.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{customer.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {customer.phone}</span>
                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Joined {formatDate(customer.registeredDate)}</span>
                <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {channelLabel(customer.preferredChannel)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatItem icon={ShoppingBag} label="Total Orders" value={String(customer.totalOrders)} />
          <StatItem icon={IndianRupee} label="Lifetime Value" value={formatCurrency(customer.ltv)} />
          <StatItem icon={Store} label="Stores Visited" value={String(customer.storesVisited)} />
          <StatItem icon={Calendar} label="Last Active" value={formatDate(customer.lastActive)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            { key: 'orders', label: 'Order History', icon: ShoppingBag, count: customer.orders.length },
            { key: 'chat', label: 'Chat History', icon: MessageSquare, count: customer.chatHistory.length },
            { key: 'favorites', label: 'Favorite Stores', icon: Heart, count: customer.favoriteStores.length },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tab.count}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'orders' && <OrdersTab orders={customer.orders} formatCurrency={formatCurrency} formatDate={formatDate} statusBadge={statusBadge} />}
      {activeTab === 'chat' && <ChatTab messages={customer.chatHistory} formatDateTime={formatDateTime} channelIcon={channelIcon} />}
      {activeTab === 'favorites' && <FavoritesTab favorites={customer.favoriteStores} formatDate={formatDate} />}
    </div>
  );
}

// --- Sub-components ---

function StatItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-gray-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function OrdersTab({ orders, formatCurrency, formatDate, statusBadge }: {
  orders: OrderSummary[];
  formatCurrency: (v: number) => string;
  formatDate: (iso: string) => string;
  statusBadge: (s: string) => React.ReactNode;
}) {
  if (orders.length === 0) {
    return <EmptyTab icon={ShoppingBag} message="No orders yet" />;
  }
  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {['Order ID', 'Seller', 'Amount', 'Status', 'Date'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {orders.map((o) => (
            <tr key={o.orderId} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-indigo-600">{o.orderId}</td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{o.sellerId}</td>
              <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(o.totalAmount)}</td>
              <td className="whitespace-nowrap px-4 py-3">{statusBadge(o.status)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDate(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChatTab({ messages, formatDateTime, channelIcon }: {
  messages: ChatMessage[];
  formatDateTime: (iso: string) => string;
  channelIcon: (ch: string) => React.ReactNode;
}) {
  if (messages.length === 0) {
    return <EmptyTab icon={MessageSquare} message="No chat history" />;
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div
          key={m.messageId}
          className={`flex gap-3 rounded-lg border p-3 ${
            m.senderRole === 'customer' ? 'bg-white' : 'bg-gray-50'
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">{channelIcon(m.channel)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium capitalize">{m.senderRole}</span>
              <span>·</span>
              <span>{formatDateTime(m.createdAt)}</span>
            </div>
            <p className="mt-1 text-sm text-gray-800">
              {typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FavoritesTab({ favorites, formatDate }: {
  favorites: FavoriteStore[];
  formatDate: (iso: string) => string;
}) {
  if (favorites.length === 0) {
    return <EmptyTab icon={Heart} message="No favorite stores" />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {favorites.map((f) => (
        <div key={f.sellerId} className="flex items-center gap-3 rounded-lg border bg-white p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-100 text-pink-600">
            <Heart className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{f.storeName}</p>
            <p className="text-xs text-gray-500">Added {formatDate(f.addedAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyTab({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="mx-auto h-10 w-10 text-gray-300" />
      <p className="mt-2 text-sm text-gray-500">{message}</p>
    </div>
  );
}
