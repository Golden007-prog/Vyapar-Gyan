'use client';

import { useEffect, useState } from 'react';
import { Package, Clock, CheckCircle, XCircle, IndianRupee } from 'lucide-react';

interface Order {
  id: string;
  customerId: string;
  status: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  commissionAmount: number;
  sellerAmount: number;
  shippingAddress: {
    name: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
  };
  createdAt: string;
  updatedAt: string;
}

type FilterStatus = 'all' | 'pending' | 'confirmed' | 'processing' | 'delivered' | 'cancelled';

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-blue-100 text-blue-800', icon: CheckCircle },
  processing: { label: 'Processing', color: 'bg-purple-100 text-purple-800', icon: Package },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');

  useEffect(() => {
    loadOrders();
  }, [filter]);

  const loadOrders = () => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      const demo: Order[] = [
        {
          id: 'ord-20260307-001',
          customerId: 'cust-demo-001',
          status: 'confirmed',
          items: [
            { productId: 'p-001', name: 'Amul Butter 500g', price: 280, quantity: 2 },
            { productId: 'p-006', name: 'Aashirvaad Atta 5kg', price: 320, quantity: 1 },
          ],
          subtotal: 880,
          commissionAmount: 88,
          sellerAmount: 792,
          shippingAddress: { name: 'Demo Customer', phone: '+917001124396', addressLine1: 'MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date(Date.now() - 1800000).toISOString(),
        },
        {
          id: 'ord-20260306-002',
          customerId: 'cust-002',
          status: 'delivered',
          items: [
            { productId: 'p-003', name: 'USB-C Cable 1m', price: 149, quantity: 3 },
          ],
          subtotal: 447,
          commissionAmount: 45,
          sellerAmount: 402,
          shippingAddress: { name: 'Priya Sharma', phone: '+919876543210', addressLine1: 'Linking Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 43200000).toISOString(),
        },
        {
          id: 'ord-20260305-003',
          customerId: 'cust-003',
          status: 'pending',
          items: [
            { productId: 'p-002', name: 'Surf Excel 1kg', price: 199, quantity: 2 },
            { productId: 'p-005', name: 'Vim Dishwash Bar', price: 35, quantity: 5 },
          ],
          subtotal: 573,
          commissionAmount: 57,
          sellerAmount: 516,
          shippingAddress: { name: 'Rahul Verma', phone: '+918765432100', addressLine1: 'Station Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
          createdAt: new Date(Date.now() - 172800000).toISOString(),
          updatedAt: new Date(Date.now() - 172800000).toISOString(),
        },
        {
          id: 'ord-20260304-004',
          customerId: 'cust-004',
          status: 'cancelled',
          items: [
            { productId: 'p-004', name: 'Winter Jacket (L)', price: 1200, quantity: 1 },
          ],
          subtotal: 1200,
          commissionAmount: 120,
          sellerAmount: 1080,
          shippingAddress: { name: 'Anita Desai', phone: '+919988776655', addressLine1: 'FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004' },
          createdAt: new Date(Date.now() - 345600000).toISOString(),
          updatedAt: new Date(Date.now() - 259200000).toISOString(),
        },
      ];
      const filtered = filter === 'all' ? demo : demo.filter(o => o.status === filter);
      setOrders(filtered);
      setLoading(false);
    }, 400);
  };

  const fetchOrders = loadOrders;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPhone = (phone: string) => {
    // Format phone number for display (e.g., +91 98765 43210)
    if (phone.startsWith('91') && phone.length === 12) {
      return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
    }
    return phone;
  };

  const filteredOrders = orders;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track and manage your customer orders
          </p>
        </div>
        <button
          onClick={fetchOrders}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {(['all', 'pending', 'confirmed', 'processing', 'delivered', 'cancelled'] as FilterStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === status
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50 border'
            }`}
          >
            {status === 'all' ? 'All Orders' : statusConfig[status as keyof typeof statusConfig]?.label || status}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
            <p className="mt-2 text-sm text-gray-500">Loading orders...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-lg bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredOrders.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No orders found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filter === 'all' 
              ? 'You haven\'t received any orders yet.' 
              : `No ${filter} orders at the moment.`}
          </p>
        </div>
      )}

      {/* Orders Table */}
      {!loading && !error && filteredOrders.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Order ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Items
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredOrders.map((order) => {
                  const StatusIcon = statusConfig[order.status as keyof typeof statusConfig]?.icon || Package;
                  const statusStyle = statusConfig[order.status as keyof typeof statusConfig]?.color || 'bg-gray-100 text-gray-800';
                  
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">
                          #{order.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {formatDate(order.createdAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {order.shippingAddress.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {formatPhone(order.shippingAddress.phone)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                        </div>
                        <div className="text-xs text-gray-500">
                          {order.items.map(item => `${item.quantity}x ${item.name}`).join(', ').slice(0, 40)}
                          {order.items.map(item => `${item.quantity}x ${item.name}`).join(', ').length > 40 ? '...' : ''}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusConfig[order.status as keyof typeof statusConfig]?.label || order.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center text-sm font-medium text-gray-900">
                          <IndianRupee className="h-4 w-4" />
                          {order.sellerAmount.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Total: ₹{order.subtotal.toFixed(2)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
