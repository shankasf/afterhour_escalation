import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
    Search,
    Download,
    Mail,
    Phone,
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    Clock,
    CheckCircle,
    XCircle,
    ArrowUpRight,
    Filter,
    Inbox,
    Zap,
    RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import { Event, PaginatedResponse } from '../types';
import { formatDateTime, formatRelative } from '../lib/utils';
import { logger } from '../utils/logger';

const statusConfig: Record<string, { color: string; bg: string; icon: React.ElementType }> = {
    NEW: { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', icon: Inbox },
    ESCALATING: { color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: Zap },
    ACKNOWLEDGED: { color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: CheckCircle },
    RESOLVED: { color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200', icon: CheckCircle },
    EXPIRED: { color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: XCircle },
    DOWNGRADED: { color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: ArrowUpRight },
};

const statusTabs = [
    { value: '', label: 'All', count: 0 },
    { value: 'NEW', label: 'New', count: 0 },
    { value: 'ESCALATING', label: 'Escalating', count: 0 },
    { value: 'ACKNOWLEDGED', label: 'Acknowledged', count: 0 },
    { value: 'RESOLVED', label: 'Resolved', count: 0 },
    { value: 'DOWNGRADED', label: 'Downgraded', count: 0 },
];

export default function Events() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const limit = 12;

    const { data, isLoading, refetch } = useQuery<PaginatedResponse<Event>>({
        queryKey: ['events', page, search, statusFilter, sourceFilter],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
            });
            if (search) params.append('search', search);
            if (statusFilter) params.append('status', statusFilter);
            if (sourceFilter) params.append('source', sourceFilter);

            const res = await api.get(`/events?${params}`);
            return res.data;
        },
    });

    const handleExport = async () => {
        try {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (statusFilter) params.append('status', statusFilter);
            if (sourceFilter) params.append('source', sourceFilter);

            const res = await api.get(`/events/export?${params}`, {
                responseType: 'blob',
            });

            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `events-${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            logger.error('Export failed', { error: String((error as Error)?.message ?? error) });
        }
    };

    const getStatusConfig = (status: string) => {
        return statusConfig[status] || statusConfig.NEW;
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Events</h1>
                    <p className="text-gray-500 text-sm">Manage and track escalation events</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => refetch()}
                        className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="w-4 h-4 text-gray-600" />
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </button>
                </div>
            </div>

            {/* Search & Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* Search */}
                    <div className="flex-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search by subject, sender, or content..."
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                        </div>
                    </div>

                    {/* Source Filter */}
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <select
                            value={sourceFilter}
                            onChange={(e) => {
                                setSourceFilter(e.target.value);
                                setPage(1);
                            }}
                            className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-sm"
                        >
                            <option value="">All Sources</option>
                            <option value="EMAIL">Email</option>
                            <option value="CHAT">Chat</option>
                        </select>
                    </div>
                </div>

                {/* Status Tabs */}
                <div className="mt-4 flex flex-wrap gap-2">
                    {statusTabs.map((tab) => (
                        <button
                            key={tab.value}
                            onClick={() => {
                                setStatusFilter(tab.value);
                                setPage(1);
                            }}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                statusFilter === tab.value
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results Info */}
            {data && (
                <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>
                        Showing {data.data?.length || 0} of {data.total} events
                    </span>
                </div>
            )}

            {/* Events Grid */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                </div>
            ) : !data?.data || data.data.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Inbox className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">No events found</h3>
                    <p className="text-gray-500">Try adjusting your search or filters</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {data.data.map((event) => {
                        const config = getStatusConfig(event.status);
                        const StatusIcon = config.icon;

                        return (
                            <Link
                                key={event.id}
                                to={`/events/${event.id}`}
                                className="block bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all group"
                            >
                                <div className="p-5">
                                    <div className="flex items-start gap-4">
                                        {/* Source Icon */}
                                        <div
                                            className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
                                                event.source === 'EMAIL'
                                                    ? 'bg-blue-100 text-blue-600'
                                                    : 'bg-green-100 text-green-600'
                                            }`}
                                        >
                                            {event.source === 'EMAIL' ? (
                                                <Mail className="w-6 h-6" />
                                            ) : (
                                                <Phone className="w-6 h-6" />
                                            )}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                                                        {event.subject || 'No subject'}
                                                    </h3>
                                                    <p className="text-sm text-gray-500 mt-0.5">
                                                        {event.senderEmail || event.senderPhone || 'Unknown sender'}
                                                    </p>
                                                </div>

                                                {/* Status Badge */}
                                                <div
                                                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config.bg} ${config.color}`}
                                                >
                                                    <StatusIcon className="w-4 h-4" />
                                                    <span className="text-sm font-medium">{event.status}</span>
                                                </div>
                                            </div>

                                            {/* Meta Info */}
                                            <div className="flex items-center gap-4 mt-3">
                                                {event.isEmergency && (
                                                    <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-md">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Emergency
                                                    </span>
                                                )}
                                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                                    <Clock className="w-3 h-3" />
                                                    {formatRelative(event.createdAt)}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {formatDateTime(event.createdAt)}
                                                </span>
                                                {event.emergencyScore > 0 && (
                                                    <span className="text-xs text-gray-400">
                                                        Score: {(event.emergencyScore * 100).toFixed(0)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Arrow */}
                                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <ArrowUpRight className="w-5 h-5 text-gray-400" />
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {data && data.totalPages > 1 && (
                <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4">
                    <p className="text-sm text-gray-500">
                        Page {page} of {data.totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Previous
                        </button>

                        {/* Page Numbers */}
                        <div className="hidden sm:flex items-center gap-1">
                            {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
                                let pageNum;
                                if (data.totalPages <= 5) {
                                    pageNum = i + 1;
                                } else if (page <= 3) {
                                    pageNum = i + 1;
                                } else if (page >= data.totalPages - 2) {
                                    pageNum = data.totalPages - 4 + i;
                                } else {
                                    pageNum = page - 2 + i;
                                }
                                return (
                                    <button
                                        key={pageNum}
                                        onClick={() => setPage(pageNum)}
                                        className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                                            page === pageNum
                                                ? 'bg-blue-600 text-white'
                                                : 'hover:bg-gray-100 text-gray-600'
                                        }`}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                            disabled={page === data.totalPages}
                            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
