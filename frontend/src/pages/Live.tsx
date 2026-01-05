import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Phone,
    PhoneCall,
    PhoneOff,
    PhoneIncoming,
    MessageSquare,
    CheckCircle,
    XCircle,
    Clock,
    Activity,
    Zap,
    Radio,
    Mail,
    RefreshCw,
    Pause,
    Play,
    Server,
    Bot,
} from 'lucide-react';
import api from '../lib/api';
import { useSocket } from '../contexts/SocketContext';

interface LiveLogEntry {
    id: string;
    timestamp: Date;
    source: 'backend' | 'ai-service' | 'frontend';
    level: 'info' | 'warn' | 'error' | 'debug';
    category: 'event' | 'escalation' | 'call' | 'sms' | 'system' | 'ai';
    message: string;
    details?: Record<string, any>;
}

interface ActiveEscalation {
    eventId: string;
    subject: string;
    source: string;
    emergencyScore: number;
    status: string;
    createdAt: string;
    isActive: boolean;
    currentContact: {
        name: string;
        phone: string;
        attemptNumber: number;
        callStatus: string;
        smsStatus: string;
    } | null;
    totalContacts: number;
    escalationLogs: Array<{
        id: string;
        attemptNumber: number;
        contactName: string;
        callStatus: string;
        smsStatus: string;
        acknowledgmentReceived: boolean;
        createdAt: string;
    }>;
}

interface LiveMetrics {
    activeEscalations: number;
    callsInProgress: number;
    callsAnswered: number;
    callsFailed: number;
    smsDelivered: number;
    smsPending: number;
}

const callStatusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
    not_called: { color: 'text-gray-500', icon: Phone, label: 'Not Called' },
    ringing: { color: 'text-yellow-500', icon: PhoneIncoming, label: 'Ringing' },
    answered: { color: 'text-green-500', icon: PhoneCall, label: 'Answered' },
    busy: { color: 'text-orange-500', icon: PhoneOff, label: 'Busy' },
    no_answer: { color: 'text-red-500', icon: PhoneOff, label: 'No Answer' },
    failed: { color: 'text-red-600', icon: XCircle, label: 'Failed' },
};


export default function Live() {
    const { socket, connected } = useSocket();

    // Separate log arrays
    const [backendLogs, setBackendLogs] = useState<LiveLogEntry[]>([]);
    const [aiLogs, setAiLogs] = useState<LiveLogEntry[]>([]);
    const [selectedEscalation, setSelectedEscalation] = useState<string | null>(null);
    const [isPaused, setIsPaused] = useState(false);

    const { data: escalationData, refetch } = useQuery({
        queryKey: ['active-escalations'],
        queryFn: async () => {
            const res = await api.get('/escalation/active');
            return res.data;
        },
        refetchInterval: 5000,
    });

    const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>({
        activeEscalations: 0,
        callsInProgress: 0,
        callsAnswered: 0,
        callsFailed: 0,
        smsDelivered: 0,
        smsPending: 0,
    });

    // Update metrics
    useEffect(() => {
        if (escalationData?.escalations) {
            const escalations = escalationData.escalations as ActiveEscalation[];
            let callsInProgress = 0, callsAnswered = 0, callsFailed = 0;
            escalations.forEach(e => {
                if (e.currentContact) {
                    if (e.currentContact.callStatus === 'ringing') callsInProgress++;
                    if (e.currentContact.callStatus === 'answered') callsAnswered++;
                    if (['failed', 'no_answer', 'busy'].includes(e.currentContact.callStatus)) callsFailed++;
                }
            });
            setLiveMetrics(prev => ({
                ...prev,
                activeEscalations: escalationData.count || 0,
                callsInProgress,
                callsAnswered,
                callsFailed,
            }));
        }
    }, [escalationData]);

    // Connection logging (no-op, frontendLogs panel removed)
    useEffect(() => {
        // Connection state change logged to console only
    }, [connected]);

    // WebSocket listeners
    useEffect(() => {
        if (!socket) return;

        const handleLog = (log: LiveLogEntry) => {
            if (isPaused) return;
            const processed = { ...log, timestamp: new Date(log.timestamp) };
            if (log.source === 'ai-service') {
                setAiLogs(prev => [...prev.slice(-99), processed]);
            } else {
                setBackendLogs(prev => [...prev.slice(-99), processed]);
            }
        };

        socket.on('log:new', handleLog);

        socket.on('escalation:update', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `esc-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: data.status === 'missed' ? 'error' : 'warn',
                    category: 'escalation',
                    message: `Escalation: ${data.contactName || data.status}`,
                }]);
            }
            refetch();
        });

        socket.on('call:update', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `call-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: ['answered', 'completed'].includes(data.status) ? 'info' : 'warn',
                    category: 'call',
                    message: `Call ${data.status}: ${data.contactName || 'Unknown'}`,
                }]);
            }
            refetch();
        });

        socket.on('sms:update', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `sms-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: data.status === 'delivered' ? 'info' : 'warn',
                    category: 'sms',
                    message: `SMS ${data.status}`,
                }]);
            }
            refetch();
        });

        socket.on('event:new', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `evt-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'event',
                    message: `New: ${data.subject?.substring(0, 50) || 'Event'}`,
                }]);
            }
            refetch();
        });

        socket.on('event:update', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `evtu-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'event',
                    message: `Event: ${data.status}`,
                }]);
            }
            refetch();
        });

        socket.on('acknowledgment:received', (data) => {
            if (!isPaused) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `ack-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'escalation',
                    message: `ACK via ${data.method?.toUpperCase()}`,
                }]);
            }
            refetch();
        });

        return () => {
            socket.off('log:new');
            socket.off('escalation:update');
            socket.off('call:update');
            socket.off('sms:update');
            socket.off('event:new');
            socket.off('event:update');
            socket.off('acknowledgment:received');
        };
    }, [socket, connected, refetch, isPaused]);

    const selectedEscalationData = escalationData?.escalations?.find(
        (e: ActiveEscalation) => e.eventId === selectedEscalation
    );

    return (
        <div className="min-h-screen bg-gray-900 -m-8 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-green-600 rounded-lg">
                        <Radio className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white">Live Operations</h1>
                        <p className="text-gray-500 text-xs">Real-time system monitoring</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                        connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                        {connected ? 'Live' : 'Offline'}
                    </div>
                    <button
                        onClick={() => setIsPaused(!isPaused)}
                        className={`p-2 rounded-lg ${isPaused ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    >
                        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                    <button onClick={() => refetch()} className="p-2 bg-gray-800 text-gray-400 hover:text-white rounded-lg">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-6 gap-3 mb-5">
                {[
                    { label: 'Active', value: liveMetrics.activeEscalations, icon: Zap, color: 'text-orange-400' },
                    { label: 'Ringing', value: liveMetrics.callsInProgress, icon: PhoneIncoming, color: 'text-yellow-400' },
                    { label: 'Answered', value: liveMetrics.callsAnswered, icon: CheckCircle, color: 'text-green-400' },
                    { label: 'Failed', value: liveMetrics.callsFailed, icon: XCircle, color: 'text-red-400' },
                    { label: 'SMS', value: liveMetrics.smsDelivered, icon: MessageSquare, color: 'text-purple-400' },
                    { label: 'Uptime', value: '99.9%', icon: Clock, color: 'text-blue-400' },
                ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-gray-500 uppercase">{label}</span>
                            <Icon className={`w-4 h-4 ${color}`} />
                        </div>
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Active Escalations */}
            {escalationData?.escalations?.length > 0 && (
                <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Activity className="w-4 h-4 text-orange-400" />
                        <span className="text-sm font-semibold text-white">Active Escalations</span>
                        <span className="text-xs text-gray-500">({escalationData.escalations.length})</span>
                    </div>
                    <div className="grid grid-cols-6 gap-2">
                        {escalationData.escalations.slice(0, 6).map((esc: ActiveEscalation) => {
                            const callConfig = esc.currentContact
                                ? callStatusConfig[esc.currentContact.callStatus] || callStatusConfig.not_called
                                : callStatusConfig.not_called;
                            return (
                                <div
                                    key={esc.eventId}
                                    onClick={() => setSelectedEscalation(selectedEscalation === esc.eventId ? null : esc.eventId)}
                                    className={`bg-gray-800 rounded-lg p-3 cursor-pointer border transition-all ${
                                        selectedEscalation === esc.eventId ? 'border-blue-500' : 'border-gray-700 hover:border-gray-600'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        {esc.source === 'email' ? <Mail className="w-3.5 h-3.5 text-blue-400" /> : <Phone className="w-3.5 h-3.5 text-green-400" />}
                                        {esc.isActive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                                    </div>
                                    <p className="text-xs text-white truncate mb-1">{esc.subject || 'No subject'}</p>
                                    {esc.currentContact && (
                                        <p className={`text-[10px] ${callConfig.color}`}>{callConfig.label}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {selectedEscalationData && (
                        <div className="mt-3 bg-gray-800 rounded-lg p-3 border border-blue-500/50">
                            <p className="text-xs text-blue-400 mb-2">{selectedEscalationData.subject}</p>
                            <div className="flex gap-2 flex-wrap">
                                {selectedEscalationData.escalationLogs.map((log: any) => (
                                    <span key={log.id} className={`text-[10px] px-2 py-1 rounded ${
                                        log.acknowledgmentReceived ? 'bg-green-500/20 text-green-400' :
                                        log.callStatus === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300'
                                    }`}>
                                        #{log.attemptNumber} {log.contactName}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Full-Width Backend Logs */}
            <div className="rounded-lg border border-green-800/50 bg-green-950/20 mb-5">
                <div className="flex items-center justify-between px-4 py-3 border-b border-green-800/30">
                    <div className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-green-400" />
                        <span className="font-semibold text-white">Backend Logs</span>
                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">
                            {backendLogs.length} entries
                        </span>
                    </div>
                    <button
                        onClick={() => setBackendLogs([])}
                        className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                        Clear
                    </button>
                </div>
                <div className="h-[300px] overflow-y-auto font-mono text-sm">
                    {backendLogs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-600">
                            <div className="text-center">
                                <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                <p>Waiting for backend logs...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-green-900/30">
                            {backendLogs.map(log => (
                                <div
                                    key={log.id}
                                    className="flex items-start gap-4 px-4 py-2 hover:bg-green-900/20 transition-colors"
                                >
                                    <span className="text-gray-500 shrink-0 w-20">
                                        {new Date(log.timestamp).toLocaleTimeString('en-US', {
                                            hour12: false,
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit'
                                        })}
                                    </span>
                                    <span className={`shrink-0 w-14 text-xs uppercase ${
                                        log.level === 'error' ? 'text-red-400' :
                                        log.level === 'warn' ? 'text-yellow-400' :
                                        log.level === 'debug' ? 'text-gray-500' : 'text-green-400'
                                    }`}>
                                        {log.level}
                                    </span>
                                    <span className="flex-1 text-gray-300 break-all">
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Full-Width AI Service Logs */}
            <div className="rounded-lg border border-cyan-800/50 bg-cyan-950/20">
                <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-800/30">
                    <div className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-cyan-400" />
                        <span className="font-semibold text-white">AI Service Logs</span>
                        <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">
                            {aiLogs.length} entries
                        </span>
                    </div>
                    <button
                        onClick={() => setAiLogs([])}
                        className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                        Clear
                    </button>
                </div>
                <div className="h-[300px] overflow-y-auto font-mono text-sm">
                    {aiLogs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-600">
                            <div className="text-center">
                                <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                <p>Waiting for AI service logs...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-cyan-900/30">
                            {aiLogs.map(log => (
                                <div
                                    key={log.id}
                                    className="flex items-start gap-4 px-4 py-2 hover:bg-cyan-900/20 transition-colors"
                                >
                                    <span className="text-gray-500 shrink-0 w-20">
                                        {new Date(log.timestamp).toLocaleTimeString('en-US', {
                                            hour12: false,
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit'
                                        })}
                                    </span>
                                    <span className={`shrink-0 w-14 text-xs uppercase ${
                                        log.level === 'error' ? 'text-red-400' :
                                        log.level === 'warn' ? 'text-yellow-400' :
                                        log.level === 'debug' ? 'text-gray-500' : 'text-cyan-400'
                                    }`}>
                                        {log.level}
                                    </span>
                                    <span className="flex-1 text-gray-300 break-all">
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Paused indicator */}
            {isPaused && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-yellow-600 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
                    ⏸ Logs Paused
                </div>
            )}
        </div>
    );
}
