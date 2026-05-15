import { useEffect, useState, useRef } from 'react';
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
    AlertTriangle,
    ExternalLink,
    FlaskConical,
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

type EvalTargetKey = 'triage' | 'voice_script' | 'sms' | 'voicemail' | 'orchestrator';

interface EvalTargetSummary {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration_ms: number;
    cost_usd: number;
    judge_mean: number | null;
    langsmith_url: string | null;
}

interface EvalSummary {
    last_run_at: string | null;
    runner: 'pytest' | 'langsmith' | null;
    targets: Record<EvalTargetKey, EvalTargetSummary>;
    total_cost_usd: number;
    total_duration_ms: number;
    langsmith_project: string | null;
    judge_model: string | null;
}

interface ScenarioTriage {
    decision: string;
    priority: string;
    emergency_score: number;
    is_safety_critical: boolean;
    issue_summary?: string;
    location?: string | null;
}

interface ScenarioValidation {
    checks?: Array<[string, string, boolean]>;
    pass?: boolean;
}

interface ScenarioResult {
    name: string;
    turns?: number;
    duration_ms?: number;
    triage?: ScenarioTriage | null;
    gate_status?: string;
    bot_replies?: string[];
    validation?: ScenarioValidation;
    error?: string;
}

interface ScenarioSummary {
    passed: number;
    total: number;
    total_ms: number;
    llm_calls: number;
    tokens_in: number;
    tokens_out: number;
    total_cost_usd: number;
}

interface ScenarioResults {
    results: ScenarioResult[];
    summary: ScenarioSummary | null;
}

const EVAL_TARGET_ORDER: EvalTargetKey[] = ['triage', 'voice_script', 'sms', 'voicemail', 'orchestrator'];

const PRIORITY_CHIP: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-300 border-red-500/40',
    high: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    medium: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    low: 'bg-gray-600/30 text-gray-300 border-gray-600/50',
};

const PRIORITY_TEXT: Record<string, string> = {
    critical: 'text-red-300',
    high: 'text-orange-300',
    medium: 'text-yellow-300',
    low: 'text-gray-400',
};

// Compact USD formatter: chooses precision based on magnitude so tiny costs
// stay readable ($0.0042) and larger ones round sensibly ($12.34).
const formatUsd = (n: number): string => {
    if (!isFinite(n) || n === 0) return '$0.00';
    const abs = Math.abs(n);
    if (abs >= 1) return `$${n.toFixed(2)}`;
    if (abs >= 0.01) return `$${n.toFixed(4)}`;
    // Very small numbers: keep first ~2 significant digits.
    return `$${n.toPrecision(2)}`;
};

const formatRelativeTime = (iso: string | null): string => {
    if (!iso) return 'never';
    const then = new Date(iso).getTime();
    if (!isFinite(then)) return 'unknown';
    const diff = Date.now() - then;
    if (diff < 0) return 'just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
};

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

    // Unified log panel state
    const [activeLogTab, setActiveLogTab] = useState<'backend' | 'ai'>('backend');
    const [backendUnread, setBackendUnread] = useState(0);
    const [aiUnread, setAiUnread] = useState(0);
    type LevelFilter = 'all' | 'info' | 'warn' | 'error' | 'debug';
    const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');

    const { data: escalationData, refetch } = useQuery({
        queryKey: ['active-escalations'],
        queryFn: async () => {
            const res = await api.get('/escalation/active');
            return res.data;
        },
        refetchInterval: 5000,
    });

    const { data: evalSummary } = useQuery<EvalSummary>({
        queryKey: ['eval-summary'],
        queryFn: async () => (await api.get('/eval/summary')).data,
        refetchInterval: 30000,
    });

    const { data: evalScenarios, isPending: scenariosPending } = useQuery<ScenarioResults>({
        queryKey: ['eval-scenarios'],
        queryFn: async () => (await api.get('/eval/scenarios')).data,
        refetchInterval: 30000,
    });

    const [evalSubTab, setEvalSubTab] = useState<'unit' | 'scenarios'>('unit');
    const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

    // Use ref to avoid stale closures in socket handlers
    const refetchRef = useRef(refetch);
    const isPausedRef = useRef(isPaused);
    const activeLogTabRef = useRef(activeLogTab);
    useEffect(() => { refetchRef.current = refetch; }, [refetch]);
    useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
    useEffect(() => { activeLogTabRef.current = activeLogTab; }, [activeLogTab]);

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

    // WebSocket listeners - use refs to avoid stale closures and prevent memory leaks
    useEffect(() => {
        if (!socket) return;

        const handleLog = (log: LiveLogEntry) => {
            if (isPausedRef.current) return;
            const processed = { ...log, timestamp: new Date(log.timestamp) };
            if (log.source === 'ai-service') {
                setAiLogs(prev => [...prev.slice(-99), processed]);
                if (activeLogTabRef.current !== 'ai') setAiUnread(n => n + 1);
            } else {
                setBackendLogs(prev => [...prev.slice(-99), processed]);
                if (activeLogTabRef.current !== 'backend') setBackendUnread(n => n + 1);
            }
        };

        const bumpBackendUnread = () => {
            if (activeLogTabRef.current !== 'backend') setBackendUnread(n => n + 1);
        };

        const handleEscalationUpdate = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `esc-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: data.status === 'missed' ? 'error' : 'warn',
                    category: 'escalation',
                    message: `Escalation: ${data.contactName || data.status}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        const handleCallUpdate = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `call-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: ['answered', 'completed'].includes(data.status) ? 'info' : 'warn',
                    category: 'call',
                    message: `Call ${data.status}: ${data.contactName || 'Unknown'}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        const handleSmsUpdate = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `sms-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: data.status === 'delivered' ? 'info' : 'warn',
                    category: 'sms',
                    message: `SMS ${data.status}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        const handleEventNew = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `evt-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'event',
                    message: `New: ${data.subject?.substring(0, 50) || 'Event'}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        const handleEventUpdate = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `evtu-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'event',
                    message: `Event: ${data.status}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        const handleAckReceived = (data: any) => {
            if (!isPausedRef.current) {
                setBackendLogs(prev => [...prev.slice(-99), {
                    id: `ack-${Date.now()}`,
                    timestamp: new Date(),
                    source: 'backend',
                    level: 'info',
                    category: 'escalation',
                    message: `ACK via ${data.method?.toUpperCase()}`,
                }]);
                bumpBackendUnread();
            }
            refetchRef.current();
        };

        socket.on('log:new', handleLog);
        socket.on('escalation:update', handleEscalationUpdate);
        socket.on('call:update', handleCallUpdate);
        socket.on('sms:update', handleSmsUpdate);
        socket.on('event:new', handleEventNew);
        socket.on('event:update', handleEventUpdate);
        socket.on('acknowledgment:received', handleAckReceived);

        return () => {
            socket.off('log:new', handleLog);
            socket.off('escalation:update', handleEscalationUpdate);
            socket.off('call:update', handleCallUpdate);
            socket.off('sms:update', handleSmsUpdate);
            socket.off('event:new', handleEventNew);
            socket.off('event:update', handleEventUpdate);
            socket.off('acknowledgment:received', handleAckReceived);
        };
    }, [socket]);

    const selectedEscalationData = escalationData?.escalations?.find(
        (e: ActiveEscalation) => e.eventId === selectedEscalation
    );

    // Tab switching: reset unread for the tab being opened, and reset level filter
    const selectLogTab = (tab: 'backend' | 'ai') => {
        setActiveLogTab(tab);
        setLevelFilter('all');
        if (tab === 'backend') setBackendUnread(0);
        else setAiUnread(0);
    };

    const activeLogs = activeLogTab === 'backend' ? backendLogs : aiLogs;
    const filteredLogs = levelFilter === 'all'
        ? activeLogs
        : activeLogs.filter(l => l.level === levelFilter);
    const isAiTab = activeLogTab === 'ai';

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

            {/* Eval Status panel — two subtabs: Unit Evals + Scenarios */}
            {(() => {
                const hasData = !!evalSummary?.last_run_at;
                const targets = evalSummary?.targets;
                const anyWarning = hasData && targets
                    ? EVAL_TARGET_ORDER.some(k => {
                        const t = targets[k];
                        if (!t || t.total === 0) return false;
                        return (t.failed / t.total) > 0.05;
                    })
                    : false;

                // Roll up unit-eval pass/total across all sub-graphs for the tab pill.
                const unitPassed = hasData && targets
                    ? EVAL_TARGET_ORDER.reduce((acc, k) => acc + (targets[k]?.passed ?? 0), 0)
                    : 0;
                const unitTotal = hasData && targets
                    ? EVAL_TARGET_ORDER.reduce((acc, k) => acc + (targets[k]?.total ?? 0), 0)
                    : 0;

                const scenSummary = evalScenarios?.summary || null;
                const scenPassed = scenSummary?.passed ?? 0;
                const scenTotal = scenSummary?.total ?? (evalScenarios?.results?.length ?? 0);

                // Combined cost across both runs for the right-side cost pill.
                const combinedCost = (evalSummary?.total_cost_usd || 0) + (scenSummary?.total_cost_usd || 0);

                // Prefer the most recent of the two timestamps for the header age.
                // EvalSummary has last_run_at; scenarios don't, so fall back to it.
                const headerTime = evalSummary?.last_run_at ?? null;

                return (
                    <div className="mb-5 bg-gray-800/50 rounded-lg border border-gray-700/50">
                        {/* Section header */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/50">
                            <div className="flex items-center gap-2 min-w-0">
                                <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
                                <span className="text-sm font-semibold text-white">Eval Status</span>
                                {anyWarning && (
                                    <span
                                        className="w-2 h-2 rounded-full bg-yellow-400"
                                        title="One or more targets have >5% fail rate"
                                        aria-label="Warning: failing targets"
                                    />
                                )}
                                <span className="text-[11px] text-gray-500">
                                    {headerTime ? formatRelativeTime(headerTime) : 'no runs yet'}
                                </span>
                                {evalSummary?.runner && (
                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400 border border-gray-700">
                                        {evalSummary.runner}
                                    </span>
                                )}
                            </div>
                            {(hasData || combinedCost > 0) && (
                                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800/70 border border-slate-700 text-slate-300 shrink-0">
                                    {formatUsd(combinedCost)}
                                </span>
                            )}
                        </div>

                        {/* Subtab bar — matches Backend/AI Service tab styling */}
                        <div className="flex items-center gap-1 px-2 border-b border-gray-700/50" role="tablist" aria-label="Eval subtabs">
                            {([
                                {
                                    key: 'unit' as const,
                                    label: 'Unit Evals',
                                    Icon: FlaskConical,
                                    passed: unitPassed,
                                    total: unitTotal,
                                    activeColor: 'text-cyan-400',
                                    activeBorder: 'border-cyan-400',
                                },
                                {
                                    key: 'scenarios' as const,
                                    label: 'Scenarios',
                                    Icon: MessageSquare,
                                    passed: scenPassed,
                                    total: scenTotal,
                                    activeColor: 'text-cyan-400',
                                    activeBorder: 'border-cyan-400',
                                },
                            ]).map(({ key, label, Icon, passed, total, activeColor, activeBorder }) => {
                                const isActive = evalSubTab === key;
                                const pillTone =
                                    total === 0 ? 'text-gray-500 bg-gray-800/70' :
                                    passed === total ? 'text-green-300 bg-green-500/15 border border-green-500/30' :
                                    passed / total >= 0.8 ? 'text-yellow-300 bg-yellow-500/15 border border-yellow-500/30' :
                                    'text-red-300 bg-red-500/15 border border-red-500/30';
                                return (
                                    <button
                                        key={key}
                                        role="tab"
                                        aria-selected={isActive}
                                        onClick={() => setEvalSubTab(key)}
                                        className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                                            isActive
                                                ? `${activeColor} ${activeBorder}`
                                                : 'text-gray-500 border-transparent hover:text-gray-300'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        <span className="font-medium">{label}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${pillTone}`}>
                                            {total === 0 ? '—' : `${passed}/${total}`}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Subtab content */}
                        {evalSubTab === 'unit' ? (
                            !hasData ? (
                                <div className="px-4 py-3 flex items-start gap-3">
                                    <FlaskConical className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                                    <div className="text-xs text-gray-400">
                                        No eval data yet — run
                                        <code className="ml-1 px-1.5 py-0.5 rounded bg-gray-900/70 border border-gray-700 text-cyan-300 font-mono text-[11px]">
                                            python -m tests.evals.langsmith_runner --target all
                                        </code>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3" role="tabpanel">
                                    {EVAL_TARGET_ORDER.map(key => {
                                        const t = targets?.[key];
                                        const total = t?.total ?? 0;
                                        const passed = t?.passed ?? 0;
                                        const failed = t?.failed ?? 0;
                                        const passRate = total > 0 ? passed / total : 0;
                                        const tone =
                                            total === 0 ? 'text-gray-500' :
                                            passRate >= 0.95 ? 'text-green-400' :
                                            passRate >= 0.80 ? 'text-yellow-400' :
                                            'text-red-400';
                                        const StatusIcon =
                                            total === 0 ? FlaskConical :
                                            passRate >= 0.95 ? CheckCircle :
                                            passRate >= 0.80 ? AlertTriangle :
                                            XCircle;
                                        const url = t?.langsmith_url || null;
                                        const judge = t?.judge_mean;
                                        const cost = t?.cost_usd ?? 0;
                                        const dur = t?.duration_ms ?? 0;

                                        const cardInner = (
                                            <>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] uppercase tracking-wide text-gray-500 truncate">
                                                        {key.replace('_', ' ')}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        <StatusIcon className={`w-3 h-3 ${tone}`} />
                                                        {url && <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-cyan-400 transition-colors" />}
                                                    </div>
                                                </div>
                                                <p className={`text-lg font-bold leading-tight ${tone}`}>
                                                    {total === 0 ? '—' : `${passed}/${total}`}
                                                    {failed > 0 && (
                                                        <span className="ml-1 text-[10px] font-normal text-red-400/80">
                                                            ({failed} fail)
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-[10px] text-gray-500 mt-1 truncate">
                                                    {judge != null ? (
                                                        <>judge: <span className="text-gray-300">{judge.toFixed(1)}/5</span></>
                                                    ) : (
                                                        <span className="text-gray-600">no judge</span>
                                                    )}
                                                    {cost > 0 && (
                                                        <> · <span className="font-mono text-slate-300">{formatUsd(cost)}</span></>
                                                    )}
                                                </p>
                                                <p className="text-[10px] text-gray-600 mt-0.5 font-mono">
                                                    {dur > 0 ? `${dur}ms` : '—'}
                                                </p>
                                            </>
                                        );

                                        const baseCls = "group block bg-gray-900/40 rounded-md p-2.5 border border-gray-700/50 transition-colors";
                                        return url ? (
                                            <a
                                                key={key}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={`${baseCls} hover:border-cyan-700/60 hover:bg-gray-900/70 cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-500`}
                                                aria-label={`Open ${key} evaluation in LangSmith`}
                                            >
                                                {cardInner}
                                            </a>
                                        ) : (
                                            <div key={key} className={baseCls}>
                                                {cardInner}
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            /* Scenarios subtab */
                            <div role="tabpanel">
                                {scenariosPending ? (
                                    <div className="p-3 space-y-2">
                                        {[0, 1, 2, 3].map(i => (
                                            <div key={i} className="h-8 bg-gray-900/40 rounded-md border border-gray-700/30 animate-pulse" />
                                        ))}
                                    </div>
                                ) : !evalScenarios?.results || evalScenarios.results.length === 0 ? (
                                    <div className="px-4 py-3 flex items-start gap-3">
                                        <MessageSquare className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                                        <div className="text-xs text-gray-400">
                                            No scenario tests yet — run
                                            <code className="ml-1 px-1.5 py-0.5 rounded bg-gray-900/70 border border-gray-700 text-cyan-300 font-mono text-[11px]">
                                                python -m tests.evals.scenario_test_customer_chat
                                            </code>
                                        </div>
                                    </div>
                                ) : (
                                    <ul className="divide-y divide-gray-700/40">
                                        {evalScenarios.results.map(r => {
                                            const passed = r.validation?.pass === true;
                                            const hasError = !!r.error;
                                            const StatusIcon = hasError ? AlertTriangle : passed ? CheckCircle : XCircle;
                                            const statusTone = hasError ? 'text-yellow-400' : passed ? 'text-green-400' : 'text-red-400';
                                            const triage = r.triage || null;
                                            const priority = triage?.priority?.toLowerCase() || '';
                                            const priorityChip = priority ? PRIORITY_CHIP[priority] || PRIORITY_CHIP.low : '';
                                            const scoreTone = priority ? PRIORITY_TEXT[priority] || 'text-gray-300' : 'text-gray-300';
                                            const score = triage?.emergency_score;
                                            const isExpanded = expandedScenario === r.name;
                                            const isOutreach = (r.gate_status || '') === 'outreach';
                                            const lastBotReply = r.bot_replies && r.bot_replies.length > 0
                                                ? r.bot_replies[r.bot_replies.length - 1]
                                                : null;

                                            return (
                                                <li key={r.name}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedScenario(isExpanded ? null : r.name)}
                                                        aria-expanded={isExpanded}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-900/40 focus:outline-none focus:bg-gray-900/40 transition-colors"
                                                    >
                                                        {/* Pass/fail icon */}
                                                        <StatusIcon className={`w-4 h-4 shrink-0 ${statusTone}`} />

                                                        {/* Scenario name — mono, truncate on narrow */}
                                                        <span
                                                            className="font-mono text-xs text-slate-200 truncate min-w-0 sm:w-64 sm:shrink-0"
                                                            title={r.name}
                                                        >
                                                            {r.name}
                                                        </span>

                                                        {/* Priority + SAFETY chips */}
                                                        <div className="hidden sm:flex items-center gap-1 shrink-0">
                                                            {triage && priority && (
                                                                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${priorityChip}`}>
                                                                    {priority}
                                                                </span>
                                                            )}
                                                            {triage?.is_safety_critical && (
                                                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border bg-red-500/25 text-red-200 border-red-500/50 font-semibold">
                                                                    SAFETY
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Score */}
                                                        {triage && typeof score === 'number' && (
                                                            <span className={`hidden md:inline font-mono text-[11px] shrink-0 ${scoreTone}`}>
                                                                score: {score.toFixed(2)}
                                                            </span>
                                                        )}

                                                        {/* Right-aligned details */}
                                                        <span className="flex-1" />
                                                        <span className="font-mono text-[11px] text-gray-400 shrink-0 text-right">
                                                            {hasError ? (
                                                                <span className="text-yellow-400">error</span>
                                                            ) : isOutreach && r.turns != null && r.duration_ms != null ? (
                                                                <>
                                                                    {r.turns} {r.turns === 1 ? 'turn' : 'turns'} · {(r.duration_ms / 1000).toFixed(1)}s
                                                                </>
                                                            ) : r.gate_status ? (
                                                                <span className="text-gray-500">→{r.gate_status}</span>
                                                            ) : (
                                                                <span className="text-gray-600">—</span>
                                                            )}
                                                        </span>
                                                    </button>

                                                    {/* Expanded detail */}
                                                    {isExpanded && (
                                                        <div className="px-3 pb-3 pl-9 space-y-2 bg-gray-900/30">
                                                            {r.error && (
                                                                <div className="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                                                                    {r.error}
                                                                </div>
                                                            )}
                                                            {triage?.issue_summary && (
                                                                <p className="text-[11px] italic text-gray-400 leading-relaxed">
                                                                    {triage.issue_summary}
                                                                    {triage.location && (
                                                                        <span className="not-italic text-gray-500"> · {triage.location}</span>
                                                                    )}
                                                                </p>
                                                            )}
                                                            {r.validation?.checks && r.validation.checks.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {r.validation.checks.map(([name, , ok], idx) => (
                                                                        <span
                                                                            key={`${name}-${idx}`}
                                                                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                                                                ok
                                                                                    ? 'bg-green-500/15 text-green-300 border-green-500/30'
                                                                                    : 'bg-red-500/15 text-red-300 border-red-500/30'
                                                                            }`}
                                                                        >
                                                                            {ok ? '✓' : '✗'} {name}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {lastBotReply && (
                                                                <p className="text-[11px] text-gray-400 leading-relaxed flex items-start gap-1.5">
                                                                    <MessageSquare className="w-3 h-3 mt-0.5 text-gray-500 shrink-0" />
                                                                    <span className="italic truncate">{lastBotReply}</span>
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Unified System Logs panel — Backend / AI Service tabs */}
            <div className={`rounded-lg border ${isAiTab ? 'border-cyan-800/50 bg-cyan-950/20' : 'border-green-800/50 bg-green-950/20'} transition-colors`}>
                {/* Header row: title + clear */}
                <div className={`flex items-center justify-between px-4 pt-3 pb-2 border-b ${isAiTab ? 'border-cyan-800/30' : 'border-green-800/30'}`}>
                    <div className="flex items-center gap-2">
                        <Activity className={`w-4 h-4 ${isAiTab ? 'text-cyan-400' : 'text-green-400'}`} />
                        <span className="text-sm font-semibold text-white">System Logs</span>
                    </div>
                    <button
                        onClick={() => {
                            if (activeLogTab === 'backend') setBackendLogs([]);
                            else setAiLogs([]);
                        }}
                        className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                        aria-label={`Clear ${activeLogTab === 'backend' ? 'backend' : 'AI service'} logs`}
                    >
                        Clear
                    </button>
                </div>

                {/* Tab bar */}
                <div className={`flex items-center gap-1 px-2 border-b ${isAiTab ? 'border-cyan-800/30' : 'border-green-800/30'}`} role="tablist">
                    {([
                        { key: 'backend' as const, label: 'Backend', Icon: Server, count: backendLogs.length, unread: backendUnread, activeColor: 'text-green-400', activeBorder: 'border-green-400' },
                        { key: 'ai' as const, label: 'AI Service', Icon: Bot, count: aiLogs.length, unread: aiUnread, activeColor: 'text-cyan-400', activeBorder: 'border-cyan-400' },
                    ]).map(({ key, label, Icon, count, unread, activeColor, activeBorder }) => {
                        const isActive = activeLogTab === key;
                        return (
                            <button
                                key={key}
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => selectLogTab(key)}
                                className={`flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                                    isActive
                                        ? `${activeColor} ${activeBorder}`
                                        : 'text-gray-500 border-transparent hover:text-gray-300'
                                }`}
                            >
                                <Icon className="w-4 h-4" />
                                <span className="font-medium">{label}</span>
                                {isActive ? (
                                    <span className="text-[10px] text-gray-400 bg-gray-700/70 px-1.5 py-0.5 rounded-full">
                                        {count}
                                    </span>
                                ) : unread > 0 ? (
                                    <span className="text-[10px] text-yellow-300 bg-yellow-500/20 border border-yellow-500/40 px-1.5 py-0.5 rounded-full font-semibold">
                                        {unread}
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-gray-600 bg-gray-800/70 px-1.5 py-0.5 rounded-full">
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Filter chip row */}
                <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-800/60">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">Filter</span>
                    {(['all', 'info', 'warn', 'error', 'debug'] as LevelFilter[]).map(lvl => {
                        const active = levelFilter === lvl;
                        const baseLevelColor =
                            lvl === 'error' ? 'text-red-300' :
                            lvl === 'warn' ? 'text-yellow-300' :
                            lvl === 'debug' ? 'text-gray-400' :
                            lvl === 'info' ? (isAiTab ? 'text-cyan-300' : 'text-green-300') :
                            'text-gray-300';
                        return (
                            <button
                                key={lvl}
                                onClick={() => setLevelFilter(lvl)}
                                aria-pressed={active}
                                className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
                                    active
                                        ? `${baseLevelColor} bg-gray-700/70 border-gray-600`
                                        : 'text-gray-500 bg-transparent border-gray-700/60 hover:text-gray-300 hover:border-gray-600'
                                }`}
                            >
                                {lvl}
                            </button>
                        );
                    })}
                    {levelFilter !== 'all' && (
                        <span className="ml-2 text-[10px] text-gray-500">
                            showing {filteredLogs.length} of {activeLogs.length}
                        </span>
                    )}
                </div>

                {/* Log content */}
                <div className="h-[500px] overflow-y-auto font-mono text-sm" role="tabpanel">
                    {filteredLogs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-600">
                            <div className="text-center">
                                {isAiTab ? (
                                    <Bot className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                ) : (
                                    <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                )}
                                <p>
                                    {activeLogs.length === 0
                                        ? `Waiting for ${isAiTab ? 'AI service' : 'backend'} logs...`
                                        : `No ${levelFilter} logs in view`}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className={`divide-y ${isAiTab ? 'divide-cyan-900/30' : 'divide-green-900/30'}`}>
                            {filteredLogs.map(log => {
                                const details = log.details || {};
                                const costUsd = typeof details.cost_usd === 'number' ? details.cost_usd : null;
                                const cumUsd = typeof details.cost_total_usd === 'number' ? details.cost_total_usd : null;
                                const hasMeta = isAiTab && (
                                    details.node || details.run_id || details.latency_ms ||
                                    details.model || details.tokens_in != null || details.tokens_out != null ||
                                    (costUsd != null && costUsd > 0) || (cumUsd != null && cumUsd > 0)
                                );
                                return (
                                    <div
                                        key={log.id}
                                        className={`px-4 py-2 transition-colors ${isAiTab ? 'hover:bg-cyan-900/20' : 'hover:bg-green-900/20'}`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <span className="text-gray-500 shrink-0 w-20">
                                                {new Date(log.timestamp).toLocaleTimeString('en-US', {
                                                    hour12: false,
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                })}
                                            </span>
                                            <span className={`shrink-0 w-14 text-xs uppercase ${
                                                log.level === 'error' ? 'text-red-400' :
                                                log.level === 'warn' ? 'text-yellow-400' :
                                                log.level === 'debug' ? 'text-gray-500' :
                                                isAiTab ? 'text-cyan-400' : 'text-green-400'
                                            }`}>
                                                {log.level}
                                            </span>
                                            <span className="flex-1 text-gray-300 break-all">
                                                {log.message}
                                            </span>
                                        </div>
                                        {hasMeta && (
                                            <div className="flex flex-wrap items-center gap-1.5 mt-1 ml-[9rem] text-[10px] text-gray-500">
                                                {details.node && (
                                                    <span className="px-1.5 py-0.5 rounded bg-cyan-900/30 border border-cyan-800/40 text-cyan-300">
                                                        node: {String(details.node)}
                                                    </span>
                                                )}
                                                {details.latency_ms != null && (
                                                    <span className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700">
                                                        lat: {Number(details.latency_ms)}ms
                                                    </span>
                                                )}
                                                {details.model && (
                                                    <span className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700">
                                                        model: {String(details.model)}
                                                    </span>
                                                )}
                                                {details.tokens_in != null && (
                                                    <span className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700">
                                                        in: {Number(details.tokens_in)}
                                                    </span>
                                                )}
                                                {details.tokens_out != null && (
                                                    <span className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700">
                                                        out: {Number(details.tokens_out)}
                                                    </span>
                                                )}
                                                {costUsd != null && costUsd > 0 && (
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700 text-slate-300 font-mono">
                                                        cost: {formatUsd(costUsd)}
                                                    </span>
                                                )}
                                                {cumUsd != null && cumUsd > 0 && (
                                                    <span className="px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-800/50 text-amber-300 font-mono">
                                                        cum: {formatUsd(cumUsd)}
                                                    </span>
                                                )}
                                                {details.run_id && (
                                                    <span className="px-1.5 py-0.5 rounded bg-gray-800/70 border border-gray-700 truncate max-w-[14rem]">
                                                        run: {String(details.run_id).slice(0, 12)}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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
