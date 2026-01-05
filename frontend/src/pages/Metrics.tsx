import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Brain,
    MessageSquare,
    Clock,
    TrendingUp,
    TrendingDown,
    PhoneCall,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Users,
    BarChart3,
    Activity,
    Zap,
    Target,
    Award,
    DollarSign,
    Calendar,
    RefreshCw,
} from 'lucide-react';
import {
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    AreaChart,
    Area,
} from 'recharts';
import api from '../lib/api';
import { useSocket } from '../contexts/SocketContext';
import { ComprehensiveMetrics, Event } from '../types';

interface LiveActivity {
    id: string;
    type: 'event' | 'escalation' | 'acknowledgment' | 'call' | 'sms';
    message: string;
    timestamp: Date;
    status: 'success' | 'warning' | 'error' | 'info';
}

function MetricCard({
    title,
    value,
    subtitle,
    icon: Icon,
    trend,
    trendValue,
    color = 'blue',
}: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
    color?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan';
}) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600 border-blue-200',
        green: 'bg-green-50 text-green-600 border-green-200',
        orange: 'bg-orange-50 text-orange-600 border-orange-200',
        red: 'bg-red-50 text-red-600 border-red-200',
        purple: 'bg-purple-50 text-purple-600 border-purple-200',
        cyan: 'bg-cyan-50 text-cyan-600 border-cyan-200',
    };

    const iconBgClasses = {
        blue: 'bg-blue-100',
        green: 'bg-green-100',
        orange: 'bg-orange-100',
        red: 'bg-red-100',
        purple: 'bg-purple-100',
        cyan: 'bg-cyan-100',
    };

    return (
        <div className={`rounded-xl border p-4 ${colorClasses[color]} transition-all hover:shadow-md`}>
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <p className="text-xs font-medium opacity-75 uppercase tracking-wide">{title}</p>
                    <p className="text-2xl font-bold mt-1">{value}</p>
                    {subtitle && <p className="text-xs opacity-60 mt-1">{subtitle}</p>}
                </div>
                <div className={`p-2 rounded-lg ${iconBgClasses[color]}`}>
                    <Icon className="w-5 h-5" />
                </div>
            </div>
            {trend && trendValue && (
                <div className="flex items-center gap-1 mt-2 text-xs">
                    {trend === 'up' ? (
                        <TrendingUp className="w-3 h-3 text-green-500" />
                    ) : trend === 'down' ? (
                        <TrendingDown className="w-3 h-3 text-red-500" />
                    ) : null}
                    <span className={trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : ''}>
                        {trendValue}
                    </span>
                </div>
            )}
        </div>
    );
}

function ProgressBar({ value, max, color = 'blue' }: { value: number; max: number; color?: string }) {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    const colorClasses: Record<string, string> = {
        blue: 'bg-blue-500',
        green: 'bg-green-500',
        orange: 'bg-orange-500',
        red: 'bg-red-500',
        purple: 'bg-purple-500',
    };

    return (
        <div className="w-full bg-gray-200 rounded-full h-2">
            <div
                className={`h-2 rounded-full transition-all ${colorClasses[color] || colorClasses.blue}`}
                style={{ width: `${Math.min(percentage, 100)}%` }}
            />
        </div>
    );
}

export default function Metrics() {
    const { socket } = useSocket();
    const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
    const [liveActivities, setLiveActivities] = useState<LiveActivity[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    const { data: metrics, refetch, isLoading } = useQuery<ComprehensiveMetrics>({
        queryKey: ['comprehensive-metrics', dateRange],
        queryFn: async () => {
            const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const res = await api.get(`/metrics/comprehensive?startDate=${startDate.toISOString()}`);
            setLastUpdated(new Date());
            return res.data;
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    // Listen for real-time events
    useEffect(() => {
        if (!socket) return;

        const addActivity = (activity: LiveActivity) => {
            setLiveActivities((prev) => [activity, ...prev.slice(0, 19)]);
        };

        socket.on('event:created', (event: Event) => {
            addActivity({
                id: event.id,
                type: 'event',
                message: `New ${event.source?.toLowerCase() || 'event'}: ${event.subject || 'No subject'}`,
                timestamp: new Date(),
                status: 'info',
            });
            refetch();
        });

        socket.on('event:updated', (event: Event) => {
            const statusMessages: Record<string, { message: string; status: LiveActivity['status'] }> = {
                acknowledged: { message: `Event acknowledged: ${event.subject}`, status: 'success' },
                escalated: { message: `Escalation started: ${event.subject}`, status: 'warning' },
                missed: { message: `Event missed: ${event.subject}`, status: 'error' },
                downgraded: { message: `Non-emergency: ${event.subject}`, status: 'info' },
            };
            const info = statusMessages[event.status?.toLowerCase()] || { message: `Event updated: ${event.subject}`, status: 'info' as const };
            addActivity({
                id: event.id + '-' + Date.now(),
                type: 'event',
                message: info.message,
                timestamp: new Date(),
                status: info.status,
            });
            refetch();
        });

        socket.on('escalation:call', (data: { eventId: string; status: string; contact: string }) => {
            addActivity({
                id: data.eventId + '-call-' + Date.now(),
                type: 'call',
                message: `Call ${data.status} to ${data.contact}`,
                timestamp: new Date(),
                status: data.status === 'answered' ? 'success' : data.status === 'failed' ? 'error' : 'warning',
            });
        });

        socket.on('escalation:sms', (data: { eventId: string; status: string; contact: string }) => {
            addActivity({
                id: data.eventId + '-sms-' + Date.now(),
                type: 'sms',
                message: `SMS ${data.status} to ${data.contact}`,
                timestamp: new Date(),
                status: data.status === 'delivered' ? 'success' : data.status === 'failed' ? 'error' : 'info',
            });
        });

        return () => {
            socket.off('event:created');
            socket.off('event:updated');
            socket.off('escalation:call');
            socket.off('escalation:sms');
        };
    }, [socket, refetch]);

    if (isLoading || !metrics) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    const hourlyData = Object.entries(metrics.businessImpactMetrics.timeSlotDistribution).map(([hour, count]) => ({
        hour: hour.split(':')[0],
        events: count,
    }));

    const sourceData = [
        { name: 'Email', value: metrics.sourceMetrics.emailEvents, color: '#3b82f6' },
        { name: 'Phone', value: metrics.sourceMetrics.dialpadEvents, color: '#10b981' },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
                    <p className="text-gray-500 text-sm">AI-powered insights and real-time metrics</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Activity className="w-4 h-4 text-green-500 animate-pulse" />
                        <span>Live</span>
                        <span className="text-gray-400">|</span>
                        <span>Updated {lastUpdated.toLocaleTimeString()}</span>
                    </div>
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        {(['7d', '30d', '90d'] as const).map((range) => (
                            <button
                                key={range}
                                onClick={() => setDateRange(range)}
                                className={`px-3 py-1 text-sm rounded-md transition-all ${
                                    dateRange === range
                                        ? 'bg-white shadow text-blue-600 font-medium'
                                        : 'text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => refetch()}
                        className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4 text-gray-600" />
                    </button>
                </div>
            </div>

            {/* AI Performance Section */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl p-6 text-white">
                <div className="flex items-center gap-2 mb-4">
                    <Brain className="w-6 h-6" />
                    <h2 className="text-lg font-semibold">AI Performance</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">Events Processed</p>
                        <p className="text-2xl font-bold">{metrics.aiMetrics.totalEventsProcessed}</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">AI Summaries</p>
                        <p className="text-2xl font-bold">{metrics.aiMetrics.aiSummariesGenerated}</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">Emergency Rate</p>
                        <p className="text-2xl font-bold">{metrics.aiMetrics.emergencyDetectionRate}%</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">False Positive Rate</p>
                        <p className="text-2xl font-bold">{metrics.aiMetrics.falsePositiveRate}%</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">Avg Score</p>
                        <p className="text-2xl font-bold">{(metrics.aiMetrics.avgEmergencyScore * 100).toFixed(0)}%</p>
                    </div>
                    <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
                        <p className="text-xs opacity-75">High Confidence</p>
                        <p className="text-2xl font-bold">{metrics.aiMetrics.highConfidenceClassifications}</p>
                    </div>
                </div>
            </div>

            {/* Main Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                <MetricCard
                    title="Escalation Success"
                    value={`${metrics.escalationMetrics.escalationSuccessRate}%`}
                    subtitle={`${metrics.escalationMetrics.successfulEscalations} of ${metrics.escalationMetrics.totalEscalations}`}
                    icon={Target}
                    color="green"
                />
                <MetricCard
                    title="First Contact Resolution"
                    value={`${metrics.escalationMetrics.firstContactResolutionRate}%`}
                    subtitle="Resolved on first try"
                    icon={Award}
                    color="purple"
                />
                <MetricCard
                    title="SLA Compliance"
                    value={`${metrics.responseTimeMetrics.slaComplianceRate}%`}
                    subtitle={`${metrics.responseTimeMetrics.slaBreaches} breaches`}
                    icon={CheckCircle}
                    color={metrics.responseTimeMetrics.slaComplianceRate >= 90 ? 'green' : 'orange'}
                />
                <MetricCard
                    title="Avg Response Time"
                    value={`${metrics.responseTimeMetrics.avgResponseTimeMinutes}m`}
                    subtitle={`Median: ${metrics.responseTimeMetrics.medianResponseTimeMinutes}m`}
                    icon={Clock}
                    color="blue"
                />
                <MetricCard
                    title="Potential Sales Saved"
                    value={metrics.businessImpactMetrics.potentialSalesSaved}
                    subtitle="After-hours handled"
                    icon={DollarSign}
                    color="green"
                />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Event Trend */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">Event Trend</h3>
                        <div className="flex items-center gap-2 text-sm">
                            {metrics.trendMetrics.weekOverWeekChange !== 0 && (
                                <span
                                    className={`flex items-center gap-1 ${
                                        metrics.trendMetrics.weekOverWeekChange > 0 ? 'text-red-500' : 'text-green-500'
                                    }`}
                                >
                                    {metrics.trendMetrics.weekOverWeekChange > 0 ? (
                                        <TrendingUp className="w-4 h-4" />
                                    ) : (
                                        <TrendingDown className="w-4 h-4" />
                                    )}
                                    {Math.abs(metrics.trendMetrics.weekOverWeekChange)}% WoW
                                </span>
                            )}
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={metrics.trendMetrics.dailyEventTrend}>
                            <defs>
                                <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1f2937',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: 'white',
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="count"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                fill="url(#colorEvents)"
                                name="Events"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Source Distribution */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Event Sources</h3>
                    <ResponsiveContainer width="100%" height={150}>
                        <PieChart>
                            <Pie
                                data={sourceData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={60}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {sourceData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-2">
                        {sourceData.map((item) => (
                            <div key={item.name} className="flex items-center gap-2 text-sm">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                                <span className="text-gray-600">
                                    {item.name} ({item.value})
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Communication & Escalation Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <PhoneCall className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Calls Made</p>
                            <p className="text-xl font-bold">{metrics.communicationMetrics.totalCallsMade}</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Answer Rate</span>
                            <span className="font-medium">{metrics.communicationMetrics.callAnswerRate}%</span>
                        </div>
                        <ProgressBar value={metrics.communicationMetrics.callAnswerRate} max={100} color="blue" />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <MessageSquare className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">SMS Sent</p>
                            <p className="text-xl font-bold">{metrics.communicationMetrics.totalSmsSent}</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Delivery Rate</span>
                            <span className="font-medium">{metrics.communicationMetrics.smsDeliveryRate}%</span>
                        </div>
                        <ProgressBar value={metrics.communicationMetrics.smsDeliveryRate} max={100} color="green" />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-orange-100 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Missed Events</p>
                            <p className="text-xl font-bold">{metrics.escalationMetrics.missedEscalations}</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">In Progress</span>
                            <span className="font-medium">{metrics.escalationMetrics.escalationsInProgress}</span>
                        </div>
                        <ProgressBar
                            value={metrics.escalationMetrics.escalationsInProgress}
                            max={Math.max(metrics.escalationMetrics.totalEscalations, 1)}
                            color="orange"
                        />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <Zap className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">Avg Escalation Depth</p>
                            <p className="text-xl font-bold">{metrics.escalationMetrics.avgEscalationDepth}</p>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Voicemails</span>
                            <span className="font-medium">{metrics.communicationMetrics.voicemailsReceived}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hourly Distribution & Live Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Hourly Distribution */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">Hourly Distribution</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Calendar className="w-4 h-4" />
                            <span>Peak: {metrics.trendMetrics.peakHour}:00 on {metrics.trendMetrics.peakDay}</span>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={hourlyData}>
                            <XAxis dataKey="hour" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis fontSize={10} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#1f2937',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: 'white',
                                }}
                            />
                            <Bar dataKey="events" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Live Activity Feed */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">Live Activity</h3>
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="text-xs text-gray-500">Real-time</span>
                        </div>
                    </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {liveActivities.length === 0 ? (
                            <p className="text-center text-gray-400 py-8 text-sm">Waiting for activity...</p>
                        ) : (
                            liveActivities.map((activity) => (
                                <div
                                    key={activity.id}
                                    className={`flex items-start gap-3 p-2 rounded-lg text-sm ${
                                        activity.status === 'success'
                                            ? 'bg-green-50'
                                            : activity.status === 'error'
                                            ? 'bg-red-50'
                                            : activity.status === 'warning'
                                            ? 'bg-orange-50'
                                            : 'bg-gray-50'
                                    }`}
                                >
                                    {activity.status === 'success' ? (
                                        <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" />
                                    ) : activity.status === 'error' ? (
                                        <XCircle className="w-4 h-4 text-red-500 mt-0.5" />
                                    ) : activity.status === 'warning' ? (
                                        <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5" />
                                    ) : (
                                        <Activity className="w-4 h-4 text-blue-500 mt-0.5" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate text-gray-700">{activity.message}</p>
                                        <p className="text-xs text-gray-400">
                                            {activity.timestamp.toLocaleTimeString()}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Contact Performance */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-gray-400" />
                        <h3 className="font-semibold text-gray-900">Contact Performance</h3>
                        {metrics.contactPerformance.length > 0 && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                {metrics.contactPerformance.length} contacts
                            </span>
                        )}
                    </div>
                </div>
                {metrics.contactPerformance.length === 0 ? (
                    <div className="text-center py-8">
                        <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-500">No escalation contact data for this period</p>
                        <p className="text-xs text-gray-400 mt-1">Contact performance will appear once escalations occur</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-xs text-gray-500 border-b">
                                    <th className="pb-3 font-medium">Contact</th>
                                    <th className="pb-3 font-medium text-center">Escalations</th>
                                    <th className="pb-3 font-medium text-center">Acknowledged</th>
                                    <th className="pb-3 font-medium text-center">Response Rate</th>
                                    <th className="pb-3 font-medium text-center">Avg Response Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {metrics.contactPerformance.map((contact, i) => (
                                    <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                                        <td className="py-3">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                                    contact.responseRate >= 80
                                                        ? 'bg-green-100'
                                                        : contact.responseRate >= 50
                                                        ? 'bg-orange-100'
                                                        : 'bg-red-100'
                                                }`}>
                                                    <span className={`text-sm font-medium ${
                                                        contact.responseRate >= 80
                                                            ? 'text-green-600'
                                                            : contact.responseRate >= 50
                                                            ? 'text-orange-600'
                                                            : 'text-red-600'
                                                    }`}>
                                                        {contact.contactName.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="font-medium text-gray-900">{contact.contactName}</span>
                                                    {contact.contactPhone && (
                                                        <p className="text-xs text-gray-400">{contact.contactPhone}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3 text-center">
                                            <span className="font-semibold text-gray-900">{contact.totalAssigned}</span>
                                        </td>
                                        <td className="py-3 text-center">
                                            <span className="text-gray-700">{contact.acknowledged}</span>
                                            <span className="text-gray-400 text-xs ml-1">
                                                / {contact.totalAssigned}
                                            </span>
                                        </td>
                                        <td className="py-3 text-center">
                                            <span
                                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                                                    contact.responseRate >= 80
                                                        ? 'bg-green-100 text-green-700'
                                                        : contact.responseRate >= 50
                                                        ? 'bg-orange-100 text-orange-700'
                                                        : 'bg-red-100 text-red-700'
                                                }`}
                                            >
                                                {contact.responseRate.toFixed(0)}%
                                            </span>
                                        </td>
                                        <td className="py-3 text-center">
                                            {contact.avgResponseTimeMinutes > 0 ? (
                                                <span className={`text-sm font-medium ${
                                                    contact.avgResponseTimeMinutes <= 5
                                                        ? 'text-green-600'
                                                        : contact.avgResponseTimeMinutes <= 15
                                                        ? 'text-orange-600'
                                                        : 'text-red-600'
                                                }`}>
                                                    {contact.avgResponseTimeMinutes.toFixed(1)}m
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Response Time Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <MetricCard
                    title="Fastest Response"
                    value={`${metrics.responseTimeMetrics.fastestResponseMinutes}m`}
                    icon={Zap}
                    color="green"
                />
                <MetricCard
                    title="Median Response"
                    value={`${metrics.responseTimeMetrics.medianResponseTimeMinutes}m`}
                    icon={BarChart3}
                    color="blue"
                />
                <MetricCard
                    title="Average Response"
                    value={`${metrics.responseTimeMetrics.avgResponseTimeMinutes}m`}
                    icon={Clock}
                    color="purple"
                />
                <MetricCard
                    title="95th Percentile"
                    value={`${metrics.responseTimeMetrics.p95ResponseTimeMinutes}m`}
                    icon={TrendingUp}
                    color="orange"
                />
                <MetricCard
                    title="Slowest Response"
                    value={`${metrics.responseTimeMetrics.slowestResponseMinutes}m`}
                    icon={AlertTriangle}
                    color="red"
                />
            </div>
        </div>
    );
}
