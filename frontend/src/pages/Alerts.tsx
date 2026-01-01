import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    AlertTriangle,
    CheckCircle,
    Bell,
    Server,
    Database,
    Mail,
    Phone,
    RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import { AdminAlert, HealthStatus } from '../types';
import { formatDateTime, formatRelative } from '../lib/utils';

export default function Alerts() {
    const queryClient = useQueryClient();

    const { data: alerts } = useQuery<AdminAlert[]>({
        queryKey: ['alerts'],
        queryFn: async () => {
            const res = await api.get('/alerts');
            return res.data;
        },
    });

    const { data: health, refetch: refetchHealth, isFetching: isHealthLoading } = useQuery<HealthStatus>({
        queryKey: ['health'],
        queryFn: async () => {
            const res = await api.get('/health');
            return res.data;
        },
        refetchInterval: 30000,
    });

    const acknowledgeMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.patch(`/alerts/${id}/acknowledge`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['alerts'] });
        },
    });

    const getAlertIcon = (type: string) => {
        switch (type) {
            case 'ESCALATION_FAILURE':
                return <Phone className="w-5 h-5 text-red-600" />;
            case 'SLA_BREACH':
                return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
            case 'SYSTEM_ERROR':
                return <Server className="w-5 h-5 text-red-600" />;
            case 'CONFIGURATION_ERROR':
                return <AlertTriangle className="w-5 h-5 text-orange-600" />;
            default:
                return <Bell className="w-5 h-5 text-gray-600" />;
        }
    };

    const unacknowledgedAlerts = alerts?.filter(a => !a.acknowledged) || [];
    const acknowledgedAlerts = alerts?.filter(a => a.acknowledged) || [];

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Alerts & Health</h1>
                <p className="text-gray-500">System status and admin notifications</p>
            </div>

            {/* System Health */}
            <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">System Health</h2>
                    <button
                        onClick={() => refetchHealth()}
                        disabled={isHealthLoading}
                        className="btn-secondary flex items-center gap-2 text-sm"
                    >
                        <RefreshCw className={`w-4 h-4 ${isHealthLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <HealthCard
                        label="Database"
                        status={health?.services.database}
                        icon={<Database className="w-5 h-5" />}
                    />
                    <HealthCard
                        label="AI Service"
                        status={health?.services.aiService}
                        icon={<Server className="w-5 h-5" />}
                    />
                    <HealthCard
                        label="Email Poller"
                        status={health?.services.emailPoller}
                        icon={<Mail className="w-5 h-5" />}
                    />
                    <HealthCard
                        label="Twilio"
                        status={health?.services.twilio}
                        icon={<Phone className="w-5 h-5" />}
                    />
                </div>

                {health && (
                    <p className="text-xs text-gray-400 mt-4">
                        Last checked: {formatDateTime(health.timestamp)}
                    </p>
                )}
            </div>

            {/* Active Alerts */}
            <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-4">
                    Active Alerts
                    {unacknowledgedAlerts.length > 0 && (
                        <span className="ml-2 badge badge-emergency">{unacknowledgedAlerts.length}</span>
                    )}
                </h2>

                {unacknowledgedAlerts.length === 0 ? (
                    <div className="py-8 text-center">
                        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                        <p className="text-gray-500">No active alerts</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {unacknowledgedAlerts.map(alert => (
                            <div key={alert.id} className="p-4 bg-red-50 border border-red-100 rounded-lg">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3">
                                        {getAlertIcon(alert.type)}
                                        <div>
                                            <p className="font-medium text-gray-900">{alert.title}</p>
                                            <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                                            <p className="text-xs text-gray-400 mt-2">
                                                {formatRelative(alert.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => acknowledgeMutation.mutate(alert.id)}
                                        disabled={acknowledgeMutation.isPending}
                                        className="btn-secondary text-sm"
                                    >
                                        Acknowledge
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Alert History */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4">Alert History</h2>

                {acknowledgedAlerts.length === 0 ? (
                    <p className="text-gray-500">No alert history</p>
                ) : (
                    <div className="space-y-2">
                        {acknowledgedAlerts.slice(0, 10).map(alert => (
                            <div key={alert.id} className="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    {getAlertIcon(alert.type)}
                                    <div>
                                        <p className="font-medium text-sm">{alert.title}</p>
                                        <p className="text-xs text-gray-500">
                                            {formatDateTime(alert.createdAt)}
                                        </p>
                                    </div>
                                </div>
                                <span className="badge bg-green-100 text-green-600">Acknowledged</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function HealthCard({
    label,
    status,
    icon,
}: {
    label: string;
    status?: boolean;
    icon: React.ReactNode;
}) {
    const isHealthy = status === true;
    const isUnknown = status === undefined;

    return (
        <div className={`p-4 rounded-lg border ${isUnknown
                ? 'bg-gray-50 border-gray-200'
                : isHealthy
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
            }`}>
            <div className="flex items-center gap-2 mb-2">
                <span className={isUnknown ? 'text-gray-400' : isHealthy ? 'text-green-600' : 'text-red-600'}>
                    {icon}
                </span>
                <span className="text-sm font-medium">{label}</span>
            </div>
            <p className={`text-sm ${isUnknown ? 'text-gray-500' : isHealthy ? 'text-green-600' : 'text-red-600'
                }`}>
                {isUnknown ? 'Unknown' : isHealthy ? 'Healthy' : 'Unhealthy'}
            </p>
        </div>
    );
}
