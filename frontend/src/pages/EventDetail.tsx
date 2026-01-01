import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Mail,
    Phone,
    AlertTriangle,
    CheckCircle,
    User,
    MessageSquare,
} from 'lucide-react';
import api from '../lib/api';
import { Event } from '../types';
import { formatDateTime, getStatusColor, getCallStatusColor, getSmsStatusColor } from '../lib/utils';

export default function EventDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: event, isLoading } = useQuery<Event>({
        queryKey: ['event', id],
        queryFn: async () => {
            const res = await api.get(`/events/${id}`);
            return res.data;
        },
        enabled: !!id,
    });

    const acknowledgeMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/acknowledgment/${id}/acknowledge`, {
                method: 'WEB',
                notes: 'Acknowledged via dashboard',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['event', id] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
        },
    });

    const resolveMutation = useMutation({
        mutationFn: async () => {
            await api.patch(`/events/${id}`, { status: 'RESOLVED' });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['event', id] });
            queryClient.invalidateQueries({ queryKey: ['events'] });
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
        );
    }

    if (!event) {
        return (
            <div className="text-center py-12">
                <p className="text-gray-500">Event not found</p>
                <button onClick={() => navigate('/events')} className="btn-primary mt-4">
                    Back to Events
                </button>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="mb-8">
                <button
                    onClick={() => navigate('/events')}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Events
                </button>

                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <span className={`badge ${getStatusColor(event.status)}`}>
                                {event.status}
                            </span>
                            {event.isEmergency && (
                                <span className="badge badge-emergency">
                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                    Emergency
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            {event.subject || 'No Subject'}
                        </h1>
                        <p className="text-gray-500 mt-1">
                            Created {formatDateTime(event.createdAt)}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        {event.status === 'ESCALATING' && (
                            <button
                                onClick={() => acknowledgeMutation.mutate()}
                                disabled={acknowledgeMutation.isPending}
                                className="btn-primary flex items-center gap-2"
                            >
                                <CheckCircle className="w-4 h-4" />
                                Acknowledge
                            </button>
                        )}
                        {event.status === 'ACKNOWLEDGED' && (
                            <button
                                onClick={() => resolveMutation.mutate()}
                                disabled={resolveMutation.isPending}
                                className="btn-secondary flex items-center gap-2"
                            >
                                <CheckCircle className="w-4 h-4" />
                                Mark Resolved
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Event Details */}
                    <div className="card">
                        <h2 className="text-lg font-semibold mb-4">Event Details</h2>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <p className="text-sm text-gray-500">Source</p>
                                <div className="flex items-center gap-2 mt-1">
                                    {event.source === 'EMAIL' ? (
                                        <Mail className="w-4 h-4 text-blue-600" />
                                    ) : (
                                        <Phone className="w-4 h-4 text-green-600" />
                                    )}
                                    <span className="font-medium">{event.source}</span>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm text-gray-500">Emergency Score</p>
                                <p className="font-medium mt-1">{event.emergencyScore}/100</p>
                            </div>

                            <div>
                                <p className="text-sm text-gray-500">Sender</p>
                                <p className="font-medium mt-1">
                                    {event.senderEmail || event.senderPhone || 'Unknown'}
                                </p>
                            </div>

                            {event.acknowledgedAt && (
                                <div>
                                    <p className="text-sm text-gray-500">Acknowledged</p>
                                    <p className="font-medium mt-1">
                                        {formatDateTime(event.acknowledgedAt)}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div>
                            <p className="text-sm text-gray-500 mb-2">Message Body</p>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                                    {event.body}
                                </pre>
                            </div>
                        </div>

                        {event.classificationReason && (
                            <div className="mt-4">
                                <p className="text-sm text-gray-500 mb-2">Classification Reason</p>
                                <p className="text-sm text-gray-700">{event.classificationReason}</p>
                            </div>
                        )}
                    </div>

                    {/* Escalation Timeline */}
                    <div className="card">
                        <h2 className="text-lg font-semibold mb-4">Escalation Timeline</h2>

                        {event.escalationLogs.length === 0 ? (
                            <p className="text-gray-500">No escalation attempts yet</p>
                        ) : (
                            <div className="space-y-4">
                                {event.escalationLogs.map((log) => (
                                    <div key={log.id} className="relative pl-6 pb-4 border-l-2 border-gray-200 last:border-0 last:pb-0">
                                        <div className="absolute -left-2 top-0 w-4 h-4 rounded-full bg-white border-2 border-primary-500"></div>

                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="font-medium">{log.contactName}</p>
                                                <p className="text-sm text-gray-500">{log.contactPhone}</p>
                                            </div>
                                            <span className="text-sm text-gray-400">
                                                Step {log.escalationStep}
                                            </span>
                                        </div>

                                        <div className="flex gap-4 mt-2">
                                            <div className="flex items-center gap-1">
                                                <Phone className="w-4 h-4 text-gray-400" />
                                                <span className={`text-sm ${getCallStatusColor(log.callStatus)}`}>
                                                    {log.callStatus}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <MessageSquare className="w-4 h-4 text-gray-400" />
                                                <span className={`text-sm ${getSmsStatusColor(log.smsStatus)}`}>
                                                    {log.smsStatus}
                                                </span>
                                            </div>
                                        </div>

                                        <p className="text-xs text-gray-400 mt-2">
                                            Started {formatDateTime(log.startedAt)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Acknowledged By */}
                    {event.acknowledgedBy && (
                        <div className="card">
                            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                                Acknowledged By
                            </h3>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                    <User className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="font-medium">{event.acknowledgedBy.name}</p>
                                    <p className="text-sm text-gray-500">{event.acknowledgedBy.email}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Stats */}
                    <div className="card">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                            Quick Stats
                        </h3>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-600">Escalation Attempts</span>
                                <span className="font-medium">{event.escalationLogs.length}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-600">Emergency Score</span>
                                <span className={`font-medium ${event.emergencyScore >= 80 ? 'text-red-600' : event.emergencyScore >= 50 ? 'text-yellow-600' : 'text-green-600'}`}>
                                    {event.emergencyScore}/100
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
