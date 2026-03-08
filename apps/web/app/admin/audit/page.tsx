'use client';

import { useState, useCallback } from 'react';
import {
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  FileText,
  Calendar,
  User,
  RefreshCw,
} from 'lucide-react';
import { queryAuditLogs, type AuditLog, type QueryAuditLogsParams } from '@/lib/api-admin';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

const RESOURCE_TYPES = ['SELLER', 'ORDER', 'PRODUCT', 'APPROVAL', 'CAMPAIGN', 'USER'] as const;
const ACTION_TYPES = ['create', 'update', 'delete', 'approve', 'reject', 'execute'] as const;

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actorId, setActorId] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = useCallback(
    async (cursor?: string) => {
      // Need at least actorId or resourceType to query
      if (!actorId && !resourceType) {
        setError('Please provide an Actor ID or select a Resource Type to search.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params: QueryAuditLogsParams = { limit: 25 };
        if (actorId) params.actorId = actorId;
        if (resourceType) {
          params.resourceType = resourceType;
          // Use a wildcard-style resourceId when only type is provided
          params.resourceId = '*';
        }
        if (startDate) params.startDate = new Date(startDate).toISOString();
        if (endDate) params.endDate = new Date(endDate + 'T23:59:59').toISOString();
        if (cursor) params.cursor = cursor;

        const data = await queryAuditLogs(params);

        // Client-side filter by action type since backend doesn't support it directly
        let filtered = data.auditLogs;
        if (actionTypeFilter) {
          filtered = filtered.filter((log) => log.actionType.includes(actionTypeFilter));
        }

        if (cursor) {
          setLogs((prev) => [...prev, ...filtered]);
        } else {
          setLogs(filtered);
        }
        setNextCursor(data.nextCursor);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load audit logs';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [actorId, resourceType, actionTypeFilter, startDate, endDate],
  );

  const handleSearch = () => {
    setExpandedRow(null);
    fetchLogs();
  };

  const handleLoadMore = () => {
    if (nextCursor) fetchLogs(nextCursor);
  };

  const toggleRow = (auditId: string) => {
    setExpandedRow((prev) => (prev === auditId ? null : auditId));
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes('approve')) return 'bg-green-100 text-green-800';
    if (action.includes('reject')) return 'bg-red-100 text-red-800';
    if (action.includes('create')) return 'bg-blue-100 text-blue-800';
    if (action.includes('delete')) return 'bg-red-100 text-red-800';
    if (action.includes('update') || action.includes('edit')) return 'bg-yellow-100 text-yellow-800';
    if (action.includes('execute') || action.includes('send')) return 'bg-purple-100 text-purple-800';
    return 'bg-gray-100 text-gray-800';
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-indigo-100 text-indigo-800';
      case 'seller': return 'bg-emerald-100 text-emerald-800';
      case 'system': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="mt-1 text-sm text-gray-600">
          Search and inspect platform activity across all actors and resources
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* Actor ID */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Actor ID</label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="User ID..."
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                className="w-full rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Resource Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Resource Type</label>
            <select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Types</option>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Action Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
            <select
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Actions</option>
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 pl-8 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actor
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Resource
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading && logs.length === 0 && (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRowSkeleton key={i} columns={5} />
                ))
              )}
              {logs.map((log) => (
                <AuditRow
                  key={log.auditId}
                  log={log}
                  expanded={expandedRow === log.auditId}
                  onToggle={() => toggleRow(log.auditId)}
                  getActionBadgeColor={getActionBadgeColor}
                  getRoleBadgeColor={getRoleBadgeColor}
                />
              ))}
            </tbody>
          </table>
        </div>

        {logs.length === 0 && !loading && (
          <div className="text-center py-16">
            <FileText className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {error ? 'No results found' : 'Use the filters above to search audit logs'}
            </p>
          </div>
        )}

        {/* Load more */}
        {nextCursor && (
          <div className="border-t px-4 py-3 text-center">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

interface AuditRowProps {
  log: AuditLog;
  expanded: boolean;
  onToggle: () => void;
  getActionBadgeColor: (action: string) => string;
  getRoleBadgeColor: (role: string) => string;
}

function AuditRow({ log, expanded, onToggle, getActionBadgeColor, getRoleBadgeColor }: AuditRowProps) {
  const hasDetails = log.oldValues || log.newValues;

  return (
    <>
      <tr
        className={`hover:bg-gray-50 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={hasDetails ? onToggle : undefined}
      >
        <td className="px-4 py-3 text-center">
          {hasDetails && (
            expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-400 mx-auto" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400 mx-auto" />
            )
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
          {new Date(log.createdAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(log.actorRole)}`}>
              {log.actorRole}
            </span>
            <span className="text-sm text-gray-700 font-mono truncate max-w-[140px]" title={log.actorId}>
              {log.actorId.slice(0, 8)}…
            </span>
          </div>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getActionBadgeColor(log.actionType)}`}>
            {log.actionType}
          </span>
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-sm text-gray-900">{log.resourceType}</span>
          <span className="text-sm text-gray-400 ml-1 font-mono" title={log.resourceId}>
            {log.resourceId.length > 12 ? `${log.resourceId.slice(0, 12)}…` : log.resourceId}
          </span>
        </td>
      </tr>

      {/* Expanded diff row */}
      {expanded && hasDetails && (
        <tr>
          <td colSpan={5} className="bg-gray-50 px-6 py-4">
            <DiffView oldValues={log.oldValues} newValues={log.newValues} />
          </td>
        </tr>
      )}
    </>
  );
}

function DiffView({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  // Collect all keys from both objects
  const allKeys = Array.from(
    new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]),
  ).sort();

  if (allKeys.length === 0) {
    return <p className="text-sm text-gray-500 italic">No value changes recorded</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Old values */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Previous Values</h4>
        {oldValues ? (
          <pre className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-900 overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {JSON.stringify(oldValues, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-gray-400 italic">No previous values (new resource)</p>
        )}
      </div>

      {/* New values */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">New Values</h4>
        {newValues ? (
          <pre className="rounded-md bg-green-50 border border-green-200 p-3 text-xs text-green-900 overflow-auto max-h-64 whitespace-pre-wrap break-all">
            {JSON.stringify(newValues, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-gray-400 italic">No new values (deleted resource)</p>
        )}
      </div>
    </div>
  );
}
