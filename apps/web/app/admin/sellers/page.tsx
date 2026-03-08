'use client';

import { useEffect, useState } from 'react';
import { Users, Phone, Calendar, IndianRupee, Check, X, Search, Filter, Clock } from 'lucide-react';

interface Seller {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  joinDate: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  totalRevenue: number;
  totalOrders: number;
  productsCount: number;
}

type StatusFilter = 'all' | 'pending' | 'active' | 'suspended' | 'rejected';

export default function SellersManagementPage() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadSellers();
  }, []);

  const loadSellers = async () => {
    try {
      // Mock data for now - replace with actual API call
      // const data = await api.get<{ sellers: Seller[] }>('/api/admin/sellers');
      const mockSellers: Seller[] = [
        {
          id: 'seller-dragon-001',
          businessName: 'Dragon Store',
          ownerName: 'Dragon Store Owner',
          phone: '+91 89270 49085',
          email: 'owner@dragonstore.com',
          joinDate: '2025-11-10',
          status: 'active',
          totalRevenue: 520000,
          totalOrders: 312,
          productsCount: 127,
        },
        {
          id: 'seller-1',
          businessName: 'Sharma Electronics',
          ownerName: 'Rajesh Sharma',
          phone: '+91 98765 43210',
          email: 'rajesh@sharma-electronics.com',
          joinDate: '2026-01-15',
          status: 'active',
          totalRevenue: 450000,
          totalOrders: 234,
          productsCount: 45,
        },
        {
          id: 'seller-2',
          businessName: 'Verma Traders',
          ownerName: 'Amit Verma',
          phone: '+91 98765 43211',
          email: 'amit@vermatraders.com',
          joinDate: '2026-03-06',
          status: 'pending',
          totalRevenue: 0,
          totalOrders: 0,
          productsCount: 0,
        },
        {
          id: 'seller-3',
          businessName: 'Patel Groceries',
          ownerName: 'Suresh Patel',
          phone: '+91 98765 43212',
          email: 'suresh@patelgroceries.com',
          joinDate: '2025-12-20',
          status: 'active',
          totalRevenue: 380000,
          totalOrders: 567,
          productsCount: 89,
        },
        {
          id: 'seller-4',
          businessName: 'Kumar Fashion Hub',
          ownerName: 'Priya Kumar',
          phone: '+91 98765 43213',
          email: 'priya@kumarfashion.com',
          joinDate: '2026-03-05',
          status: 'pending',
          totalRevenue: 0,
          totalOrders: 0,
          productsCount: 0,
        },
        {
          id: 'seller-5',
          businessName: 'Singh Hardware',
          ownerName: 'Manpreet Singh',
          phone: '+91 98765 43214',
          email: 'manpreet@singhhardware.com',
          joinDate: '2026-02-10',
          status: 'active',
          totalRevenue: 285000,
          totalOrders: 145,
          productsCount: 67,
        },
        {
          id: 'seller-6',
          businessName: 'Gupta Textiles',
          ownerName: 'Neha Gupta',
          phone: '+91 98765 43215',
          email: 'neha@guptatextiles.com',
          joinDate: '2026-01-28',
          status: 'active',
          totalRevenue: 240000,
          totalOrders: 198,
          productsCount: 52,
        },
        {
          id: 'seller-7',
          businessName: 'Reddy Mobiles',
          ownerName: 'Srinivas Reddy',
          phone: '+91 98765 43216',
          email: 'srinivas@reddymobiles.com',
          joinDate: '2026-03-07',
          status: 'pending',
          totalRevenue: 0,
          totalOrders: 0,
          productsCount: 0,
        },
        {
          id: 'seller-8',
          businessName: 'Joshi Pharmacy',
          ownerName: 'Dr. Anil Joshi',
          phone: '+91 98765 43217',
          email: 'anil@joshipharma.com',
          joinDate: '2026-02-01',
          status: 'suspended',
          totalRevenue: 125000,
          totalOrders: 89,
          productsCount: 34,
        },
      ];
      setSellers(mockSellers);
    } catch (error) {
      console.error('Failed to load sellers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (sellerId: string) => {
    setActionLoading(sellerId);
    try {
      // await api.put(`/api/admin/sellers/${sellerId}/approve`);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setSellers((prev) =>
        prev.map((seller) =>
          seller.id === sellerId ? { ...seller, status: 'active' as const } : seller
        )
      );
    } catch (error) {
      console.error('Failed to approve seller:', error);
      alert('Failed to approve seller. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (sellerId: string) => {
    if (!confirm('Are you sure you want to reject this seller application?')) {
      return;
    }

    setActionLoading(sellerId);
    try {
      // await api.put(`/api/admin/sellers/${sellerId}/reject`);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setSellers((prev) =>
        prev.map((seller) =>
          seller.id === sellerId ? { ...seller, status: 'rejected' as const } : seller
        )
      );
    } catch (error) {
      console.error('Failed to reject seller:', error);
      alert('Failed to reject seller. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: Seller['status']) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      active: 'bg-green-100 text-green-800',
      suspended: 'bg-red-100 text-red-800',
      rejected: 'bg-gray-100 text-gray-800',
    };

    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const filteredSellers = sellers.filter((seller) => {
    const matchesStatus = statusFilter === 'all' || seller.status === statusFilter;
    const matchesSearch =
      searchQuery === '' ||
      seller.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seller.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      seller.phone.includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600">Loading sellers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Seller Management</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review, approve, and manage all sellers on the platform
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-indigo-100 p-2">
              <Users className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Sellers</p>
              <p className="text-2xl font-bold text-gray-900">{sellers.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-100 p-2">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending Approval</p>
              <p className="text-2xl font-bold text-gray-900">
                {sellers.filter((s) => s.status === 'pending').length}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-green-100 p-2">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active Sellers</p>
              <p className="text-2xl font-bold text-gray-900">
                {sellers.filter((s) => s.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-red-100 p-2">
              <X className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Suspended</p>
              <p className="text-2xl font-bold text-gray-900">
                {sellers.filter((s) => s.status === 'suspended').length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search sellers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-64"
          />
        </div>
      </div>

      {/* Sellers table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Business Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Owner / Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Join Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Revenue
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredSellers.map((seller) => (
                <tr key={seller.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <Users className="h-5 w-5 text-indigo-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {seller.businessName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {seller.productsCount} products
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{seller.ownerName}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {seller.phone}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Calendar className="h-4 w-4" />
                      {new Date(seller.joinDate).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(seller.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                      <IndianRupee className="h-4 w-4" />
                      {seller.totalRevenue > 0
                        ? `${(seller.totalRevenue / 1000).toFixed(0)}K`
                        : '—'}
                    </div>
                    {seller.totalOrders > 0 && (
                      <div className="text-xs text-gray-500">
                        {seller.totalOrders} orders
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {seller.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(seller.id)}
                          disabled={actionLoading === seller.id}
                          className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Check className="h-4 w-4" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(seller.id)}
                          disabled={actionLoading === seller.id}
                          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <X className="h-4 w-4" />
                          Reject
                        </button>
                      </div>
                    ) : (
                      <button className="text-indigo-600 hover:text-indigo-900 font-medium">
                        View Details →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredSellers.length === 0 && (
          <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">No sellers found</p>
          </div>
        )}
      </div>
    </div>
  );
}
