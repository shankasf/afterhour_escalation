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
    Clock,
    XCircle,
    PhoneCall,
    PhoneOff,
    PhoneMissed,
    CheckCircle2,
    Circle,
    AlertCircle,
    Send,
} from 'lucide-react';
import api from '../lib/api';
import { Event, EscalationLog } from '../types';
import { formatDateTime, getStatusColor } from '../lib/utils';

// Call status configuration
const callStatusConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
    not_called: { label: 'Not Called', color: 'text-gray-500', bgColor: 'bg-gray-100', icon: Circle },
    initiated: { label: 'Calling...', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: PhoneCall },
    ringing: { label: 'Ringing', color: 'text-yellow-600', bgColor: 'bg-yellow-100', icon: PhoneCall },
    in_progress: { label: 'In Progress', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: PhoneCall },
    answered: { label: 'Answered', color: 'text-green-600', bgColor: 'bg-green-100', icon: CheckCircle2 },
    completed: { label: 'Completed', color: 'text-green-600', bgColor: 'bg-green-100', icon: CheckCircle2 },
    no_answer: { label: 'No Answer', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: PhoneMissed },
    busy: { label: 'Busy', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: PhoneOff },
    failed: { label: 'Failed', color: 'text-red-600', bgColor: 'bg-red-100', icon: XCircle },
    cancelled: { label: 'Cancelled', color: 'text-gray-500', bgColor: 'bg-gray-100', icon: XCircle },
};

// SMS status configuration
const smsStatusConfig: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
    not_sent: { label: 'Not Sent', color: 'text-gray-500', bgColor: 'bg-gray-100', icon: Circle },
    queued: { label: 'Queued', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: Clock },
    sent: { label: 'Sent', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: Send },
    delivered: { label: 'Delivered', color: 'text-green-600', bgColor: 'bg-green-100', icon: CheckCircle2 },
    undelivered: { label: 'Undelivered', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: AlertCircle },
    failed: { label: 'Failed', color: 'text-red-600', bgColor: 'bg-red-100', icon: XCircle },
};

function EscalationTimelineItem({ log, isLast }: { log: EscalationLog; isLast: boolean }) {
    const callConfig = callStatusConfig[log.callStatus] || callStatusConfig.not_called;
    const smsConfig = smsStatusConfig[log.smsStatus] || smsStatusConfig.not_sent;
    const CallIcon = callConfig.icon;
    const SmsIcon = smsConfig.icon;

    // Determine timeline dot color based on acknowledgment status
    const getDotColor = () => {
        if (log.acknowledgmentReceived) return 'bg-green-500 border-green-500';
        if (log.callStatus === 'failed' || log.smsStatus === 'failed') return 'bg-red-500 border-red-500';
        if (log.callStatus === 'no_answer' || log.callStatus === 'busy') return 'bg-orange-500 border-orange-500';
        if (log.callStatus === 'completed' || log.callStatus === 'answered') return 'bg-blue-500 border-blue-500';
        return 'bg-gray-400 border-gray-400';
    };

    // Calculate time since created
    const getTimeSince = () => {
        const created = new Date(log.createdAt);
        const now = new Date();
        const diffMs = now.getTime() - created.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    };

    // Use contact's user info first (escalation contacts), fall back to direct user
    const contactName = log.contact?.user?.name || log.user?.name || 'Unknown Contact';
    const contactPhone = log.contact?.user?.phoneNumber || log.user?.phoneNumber || 'No phone';

    return (
        <div className={`relative pl-8 pb-6 ${!isLast ? 'border-l-2 border-gray-200 ml-2' : 'ml-2'}`}>
            {/* Timeline dot */}
            <div className={`absolute -left-2 top-0 w-4 h-4 rounded-full border-2 ${getDotColor()}`}>
                {log.acknowledgmentReceived && (
                    <CheckCircle className="w-3 h-3 text-white absolute -top-0.5 -left-0.5" />
                )}
            </div>

            {/* Content card */}
            <div className={`rounded-lg border p-4 ${log.acknowledgmentReceived ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${log.acknowledgmentReceived ? 'bg-green-100' : 'bg-gray-100'}`}>
                            <User className={`w-5 h-5 ${log.acknowledgmentReceived ? 'text-green-600' : 'text-gray-500'}`} />
                        </div>
                        <div>
                            <p className="font-semibold text-gray-900">{contactName}</p>
                            <p className="text-sm text-gray-500">{contactPhone}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            Attempt #{log.attemptNumber}
                        </span>
                    </div>
                </div>

                {/* Status Grid */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                    {/* Call Status */}
                    <div className={`rounded-lg p-3 ${callConfig.bgColor}`}>
                        <div className="flex items-center gap-2 mb-1">
                            <Phone className="w-4 h-4 text-gray-500" />
                            <span className="text-xs font-medium text-gray-600 uppercase">Voice Call</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CallIcon className={`w-4 h-4 ${callConfig.color}`} />
                            <span className={`text-sm font-medium ${callConfig.color}`}>{callConfig.label}</span>
                        </div>
                        {log.callSid && (
                            <p className="text-xs text-gray-400 mt-1 truncate" title={log.callSid}>
                                SID: {log.callSid.substring(0, 20)}...
                            </p>
                        )}
                    </div>

                    {/* SMS Status */}
                    <div className={`rounded-lg p-3 ${smsConfig.bgColor}`}>
                        <div className="flex items-center gap-2 mb-1">
                            <MessageSquare className="w-4 h-4 text-gray-500" />
                            <span className="text-xs font-medium text-gray-600 uppercase">SMS</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <SmsIcon className={`w-4 h-4 ${smsConfig.color}`} />
                            <span className={`text-sm font-medium ${smsConfig.color}`}>{smsConfig.label}</span>
                        </div>
                        {log.smsSid && (
                            <p className="text-xs text-gray-400 mt-1 truncate" title={log.smsSid}>
                                SID: {log.smsSid.substring(0, 20)}...
                            </p>
                        )}
                    </div>
                </div>

                {/* Acknowledgment Badge */}
                {log.acknowledgmentReceived && (
                    <div className="flex items-center gap-2 p-2 bg-green-100 rounded-lg mb-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        <div>
                            <span className="text-sm font-medium text-green-700">Acknowledged</span>
                            {log.acknowledgedAt && (
                                <span className="text-xs text-green-600 ml-2">
                                    at {formatDateTime(log.acknowledgedAt)}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {log.errorMessage && (
                    <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg mb-3">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-red-700">{log.errorMessage}</p>
                    </div>
                )}

                {/* Footer with timestamp */}
                <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDateTime(log.createdAt)}</span>
                    </div>
                    <span>{getTimeSince()}</span>
                </div>
            </div>
        </div>
    );
}

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
                            <div className="text-center py-8">
                                <Circle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                <p className="text-gray-500">No escalation attempts yet</p>
                            </div>
                        ) : (
                            <div className="space-y-0">
                                {event.escalationLogs.map((log, index) => (
                                    <EscalationTimelineItem
                                        key={log.id}
                                        log={log}
                                        isLast={index === event.escalationLogs.length - 1}
                                    />
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
