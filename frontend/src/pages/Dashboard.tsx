import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
    AlertTriangle,
    CheckCircle,
    Clock,
    Phone,
    Mail,
    TrendingUp,
    Users,
    Activity,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api';
import { useSocket } from '../contexts/SocketContext';
import { Event, DashboardStats, DailyMetric } from '../types';
import { formatRelative, getStatusColor } from '../lib/utils';

export default function Dashboard() {
    const { socket } = useSocket();
    const [recentEvents, setRecentEvents] = useState<Event[]>([]);

    const { data: stats, refetch: refetchStats } = useQuery<DashboardStats>({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const res = await api.get('/metrics/dashboard');
            return res.data;
        },
    });

    const { data: metrics } = useQuery<DailyMetric[]>({
        queryKey: ['weekly-metrics'],
        queryFn: async () => {
            const res = await api.get('/metrics/weekly');
            return res.data;
        },
    });

    const { data: events } = useQuery<Event[]>({
        queryKey: ['recent-events'],
        queryFn: async () => {
            const res = await api.get('/events?limit=5&status=NEW,ESCALATING');
            return res.data.data;
        },
    });

    useEffect(() => {
        if (events) {
            setRecentEvents(events);
        }
    }, [events]);

    useEffect(() => {
        if (!socket) return;

        socket.on('event:created', (event: Event) => {
            setRecentEvents((prev) => [event, ...prev.slice(0, 4)]);
            refetchStats();
        });

        socket.on('event:updated', (event: Event) => {
            setRecentEvents((prev) =>
                prev.map((e) => (e.id === event.id ? event : e))
            );
            refetchStats();
        });

        return () => {
            socket.off('event:created');
            socket.off('event:updated');
        };
    }, [socket, refetchStats]);

    const statCards = [
        {
            label: 'Active Events',
            value: stats?.activeEvents ?? 0,
            icon: AlertTriangle,
            color: 'text-orange-600',
            bgColor: 'bg-orange-100',
        },
        {
            label: "Today's Events",
            value: stats?.todayEvents ?? 0,
            icon: Mail,
            color: 'text-blue-600',
            bgColor: 'bg-blue-100',
        },
        {
            label: 'Acknowledged Today',
            value: stats?.acknowledgedToday ?? 0,
            icon: CheckCircle,
            color: 'text-green-600',
            bgColor: 'bg-green-100',
        },
        {
            label: 'Avg ACK Time',
            value: stats?.avgAckTimeMinutes ? `${stats.avgAckTimeMinutes}m` : 'N/A',
            icon: Clock,
            color: 'text-purple-600',
            bgColor: 'bg-purple-100',
        },
    ];

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-500">After-hours escalation overview</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {statCards.map((stat) => (
                    <div key={stat.label} className="card">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500">{stat.label}</p>
                                <p className="text-3xl font-bold mt-1">{stat.value}</p>
                            </div>
                            <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                                <stat.icon className={`w-6 h-6 ${stat.color}`} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* On-Call & SLA */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Current On-Call */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-4">
                        <Users className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">Current On-Call</h2>
                    </div>
                    {stats?.currentOnCall ? (
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                                <Phone className="w-6 h-6 text-primary-600" />
                            </div>
                            <div>
                                <p className="font-medium">{stats.currentOnCall.name}</p>
                                <p className="text-sm text-gray-500">{stats.currentOnCall.phone}</p>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-500">No on-call assigned</p>
                    )}
                </div>

                {/* SLA Status */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-4">
                        <Activity className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">SLA Status</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${(stats?.slaBreaches ?? 0) === 0 ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                            {(stats?.slaBreaches ?? 0) === 0 ? (
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            ) : (
                                <AlertTriangle className="w-6 h-6 text-red-600" />
                            )}
                        </div>
                        <div>
                            <p className="font-medium">
                                {(stats?.slaBreaches ?? 0) === 0 ? 'All Clear' : `${stats?.slaBreaches} Breaches`}
                            </p>
                            <p className="text-sm text-gray-500">Today's SLA compliance</p>
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="card">
                    <div className="flex items-center gap-3 mb-4">
                        <TrendingUp className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-semibold">Quick Actions</h2>
                    </div>
                    <div className="space-y-2">
                        <Link
                            to="/events"
                            className="block w-full text-center btn-primary"
                        >
                            View All Events
                        </Link>
                        <Link
                            to="/rotation"
                            className="block w-full text-center btn-secondary"
                        >
                            Manage Rotation
                        </Link>
                    </div>
                </div>
            </div>

            {/* Charts & Recent Events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Trend */}
                <div className="card">
                    <h2 className="text-lg font-semibold mb-4">Weekly Trend</h2>
                    {metrics && metrics.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={metrics}>
                                <XAxis dataKey="date" fontSize={12} tickLine={false} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip />
                                <Line
                                    type="monotone"
                                    dataKey="totalEvents"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    dot={false}
                                    name="Total"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="emergencyEvents"
                                    stroke="#ef4444"
                                    strokeWidth={2}
                                    dot={false}
                                    name="Emergency"
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-[250px] flex items-center justify-center text-gray-400">
                            No data available
                        </div>
                    )}
                </div>

                {/* Recent Events */}
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold">Recent Events</h2>
                        <Link to="/events" className="text-sm text-primary-600 hover:underline">
                            View all
                        </Link>
                    </div>
                    {recentEvents.length > 0 ? (
                        <div className="space-y-3">
                            {recentEvents.map((event) => (
                                <Link
                                    key={event.id}
                                    to={`/events/${event.id}`}
                                    className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">
                                                {event.subject || 'No subject'}
                                            </p>
                                            <p className="text-sm text-gray-500 truncate">
                                                {event.senderEmail || event.senderPhone || 'Unknown sender'}
                                            </p>
                                        </div>
                                        <span className={`badge ${getStatusColor(event.status)}`}>
                                            {event.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                                        <span>{formatRelative(event.createdAt)}</span>
                                        {event.isEmergency && (
                                            <span className="badge-emergency">Emergency</span>
                                        )}
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-gray-400">
                            No recent events
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
