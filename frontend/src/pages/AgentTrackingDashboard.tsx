import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    BarChart3,
    Bot,
    CheckCircle,
    CircleDot,
    ClipboardCheck,
    Clock,
    Code2,
    Database,
    ExternalLink,
    FileText,
    Filter,
    FlaskConical,
    GitBranch,
    GitCompare,
    Layers3,
    ListChecks,
    MessageSquare,
    RefreshCw,
    Route,
    ShieldCheck,
    Sparkles,
    Tags,
    Target,
    TerminalSquare,
    TestTube2,
    Timer,
    TrendingDown,
    TrendingUp,
    Webhook,
    Workflow,
    Wrench,
    Zap,
} from 'lucide-react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import api from '../lib/api';
import { ComprehensiveMetrics } from '../types';
import { formatRelative } from '../lib/utils';
import { useSocket } from '../contexts/SocketContext';

const OBSERVABILITY_ICON =
    'https://mintcdn.com/langchain-5e9cc07a/nQm-sjd_MByLhgeW/images/brand/observability-icon-dark.png?fit=max&auto=format&n=nQm-sjd_MByLhgeW&q=85&s=ccbc183bca2a5e4ca78d30149e3836cc';
const EVALUATION_ICON =
    'https://mintcdn.com/langchain-5e9cc07a/nQm-sjd_MByLhgeW/images/brand/evaluation-icon-dark.png?fit=max&auto=format&n=nQm-sjd_MByLhgeW&q=85&s=4918f932fff73a33d6a24e2fcf68f6a4';

type DateRange = '7d' | '30d' | '90d';
type DashboardTab = 'observability' | 'evaluation' | 'setup';

interface TraceRow {
    id: string;
    traceId: string;
    eventId?: string;
    threadId: string;
    title: string;
    source: string;
    status: string;
    emergencyScore: number;
    latencyMinutes: number;
    runCount: number;
    evaluatorScore: number;
    receivedAt: string;
    tags: string[];
    spans?: TraceSpan[];
    evaluations?: TraceEvaluation[];
}

interface TraceSpan {
    id: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    runType: string;
    status: string;
    latencyMs?: number;
    startedAt: string;
    endedAt?: string;
}

interface TraceEvaluation {
    key: string;
    name: string;
    type: string;
    score: number;
    passed: boolean;
    feedback?: string;
}

interface TrendRow {
    date: string;
    traces: number;
    successful: number;
    failures: number;
    evalScore: number;
}

interface EvaluatorCoverage {
    key: string;
    name: string;
    type: string;
    resources: string;
    score: number;
    passed: number;
    total: number;
}

interface DatasetBreakdown {
    reason: string;
    count: number;
}

interface AgentTrackingDashboardData {
    overview: {
        traceCount: number;
        spanCount: number;
        toolRunCount: number;
        llmRunCount: number;
        errorRate: number;
        p95LatencyMinutes: number;
        qualityScore: number;
        datasetCandidates: number;
    };
    trendData: TrendRow[];
    runTypeData: Array<{ name: string; runs: number; color: string }>;
    evaluatorCoverage: EvaluatorCoverage[];
    evaluatorPie: Array<{ name: string; value: number; color: string }>;
    datasetBreakdown: DatasetBreakdown[];
    traces: TraceRow[];
}

function getDateRangeStart(range: DateRange) {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return startDate;
}

function formatPercent(value: number) {
    if (!Number.isFinite(value)) return '0%';
    return `${Math.round(value * 10) / 10}%`;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatLatencyMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0ms';
    if (minutes < 1) return `${Math.round(minutes * 60000)}ms`;
    if (minutes < 60) return `${Math.round(minutes * 10) / 10}m`;
    return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.min(max, Math.max(min, value));
}

function getScoreColor(score: number) {
    if (score >= 90) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (score >= 75) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-rose-700 bg-rose-50 border-rose-200';
}

function getStatusTone(status: string) {
    if (status === 'ACKNOWLEDGED' || status === 'DOWNGRADED' || status === 'RESOLVED' || status === 'CLOSED') {
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    }
    if (status === 'ESCALATING' || status === 'NEW') {
        return 'text-amber-700 bg-amber-50 border-amber-200';
    }
    return 'text-rose-700 bg-rose-50 border-rose-200';
}

function getSpanIcon(runType: string, status: string) {
    if (status === 'error' || status === 'failed') return AlertTriangle;
    if (runType === 'llm') return Bot;
    if (runType === 'tool') return Wrench;
    if (runType === 'evaluator') return ClipboardCheck;
    return Workflow;
}

function EmptyMetricsState() {
    return (
        <div className="flex items-center justify-center h-96">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
                <p className="mt-4 text-sm text-gray-500">Loading agent quality metrics</p>
            </div>
        </div>
    );
}

function StatCard({
    title,
    value,
    detail,
    icon: Icon,
    tone,
    trend,
}: {
    title: string;
    value: string;
    detail: string;
    icon: React.ElementType;
    tone: string;
    trend?: 'up' | 'down' | 'neutral';
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-[126px]">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-950">{value}</p>
                </div>
                <div className={`p-2 rounded-lg ${tone}`}>
                    <Icon className="w-5 h-5" />
                </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs text-gray-500">
                {trend === 'up' ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                ) : trend === 'down' ? (
                    <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                ) : (
                    <CircleDot className="w-3.5 h-3.5 text-gray-400" />
                )}
                <span>{detail}</span>
            </div>
        </div>
    );
}

function ProductCard({
    icon,
    title,
    description,
    status,
    statusTone,
    children,
}: {
    icon: string;
    title: string;
    description: string;
    status: string;
    statusTone: string;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                    <img src={icon} alt="" className="w-12 h-12 rounded-lg bg-gray-950 p-2 object-contain" />
                    <div>
                        <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
                        <p className="mt-1 text-sm text-gray-500 max-w-xl">{description}</p>
                    </div>
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${statusTone}`}>
                    <CircleDot className="w-3 h-3" />
                    {status}
                </span>
            </div>
            <div className="mt-5">{children}</div>
        </div>
    );
}

function SectionHeader({
    title,
    eyebrow,
    action,
}: {
    title: string;
    eyebrow?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-4 mb-4">
            <div>
                {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{eyebrow}</p>}
                <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
            </div>
            {action}
        </div>
    );
}

function StepPill({ done, label }: { done: boolean; label: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
                done ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
        >
            {done ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {label}
        </span>
    );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
    return (
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${clamp(value)}%` }} />
        </div>
    );
}

function TraceTimeline({ selectedTrace }: { selectedTrace?: TraceRow }) {
    const traceNodes = selectedTrace?.spans?.length
        ? selectedTrace.spans.map((span) => ({
              name: span.name,
              type: span.runType,
              status: span.status,
              icon: getSpanIcon(span.runType, span.status),
          }))
        : [
              { name: 'intake', type: 'root', status: 'passed', icon: FileText },
              { name: 'triage', type: 'llm', status: selectedTrace?.emergencyScore && selectedTrace.emergencyScore >= 60 ? 'review' : 'passed', icon: Bot },
              { name: 'after_hours_gate', type: 'chain', status: 'passed', icon: Filter },
              { name: 'rotation_planner', type: 'tool', status: 'passed', icon: Route },
              { name: 'outreach', type: 'tool', status: selectedTrace?.status === 'MISSED' ? 'failed' : 'passed', icon: MessageSquare },
              { name: 'wait_for_ack', type: 'chain', status: selectedTrace?.status === 'ESCALATING' ? 'running' : 'passed', icon: Timer },
              {
                  name: selectedTrace?.status === 'MISSED' ? 'exhaustion' : 'resolution',
                  type: 'chain',
                  status: selectedTrace?.status === 'MISSED' ? 'failed' : 'passed',
                  icon: selectedTrace?.status === 'MISSED' ? AlertTriangle : CheckCircle,
              },
          ];

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <SectionHeader
                eyebrow="Trace Explorer"
                title={selectedTrace ? selectedTrace.title : 'LangGraph execution path'}
                action={
                    selectedTrace && (
                        <span className="text-xs text-gray-500">
                            {selectedTrace.traceId} / {selectedTrace.threadId}
                        </span>
                    )
                }
            />
            <div className="overflow-x-auto pb-2">
                <div className="min-w-[860px] flex items-center gap-2">
                    {traceNodes.map((node, index) => {
                        const Icon = node.icon;
                            const tone =
                            node.status === 'failed' || node.status === 'error'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : node.status === 'running'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : node.status === 'review' || node.status === 'blocked'
                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700';
                        return (
                            <div key={node.name} className="flex items-center gap-2">
                                <div className={`w-[116px] rounded-lg border p-3 ${tone}`}>
                                    <div className="flex items-center justify-between">
                                        <Icon className="w-4 h-4" />
                                        <span className="text-[10px] uppercase font-semibold">{node.type}</span>
                                    </div>
                                    <p className="mt-2 text-xs font-semibold truncate">{node.name}</p>
                                </div>
                                {index < traceNodes.length - 1 && <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Root trace</p>
                    <p className="mt-1 font-semibold text-gray-900">{selectedTrace?.traceId || 'after-hours-agent'}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Runs / spans</p>
                    <p className="mt-1 font-semibold text-gray-900">{selectedTrace?.runCount || 7}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Latency</p>
                    <p className="mt-1 font-semibold text-gray-900">{formatLatencyMinutes(selectedTrace?.latencyMinutes || 0)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Evaluator score</p>
                    <p className="mt-1 font-semibold text-gray-900">{selectedTrace?.evaluatorScore || 0}%</p>
                </div>
            </div>
        </div>
    );
}

function RecentTraceTable({
    traces,
    selectedTraceId,
    onSelectTrace,
}: {
    traces: TraceRow[];
    selectedTraceId?: string;
    onSelectTrace: (traceId: string) => void;
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <SectionHeader eyebrow="Production Traces" title="Recent agent requests" />
            {traces.length === 0 ? (
                <div className="text-center py-10">
                    <Workflow className="w-10 h-10 text-gray-300 mx-auto" />
                    <p className="mt-3 text-sm text-gray-500">No recent traces in this period</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px]">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                                <th className="pb-3 font-medium">Trace</th>
                                <th className="pb-3 font-medium">Status</th>
                                <th className="pb-3 font-medium">Score</th>
                                <th className="pb-3 font-medium">Runs</th>
                                <th className="pb-3 font-medium">Latency</th>
                                <th className="pb-3 font-medium">Tags</th>
                                <th className="pb-3 font-medium">Received</th>
                            </tr>
                        </thead>
                        <tbody>
                            {traces.map((trace) => (
                                <tr
                                    key={trace.id}
                                    onClick={() => onSelectTrace(trace.id)}
                                    className={`border-b border-gray-100 last:border-0 cursor-pointer ${
                                        selectedTraceId === trace.id ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                                    }`}
                                >
                                    <td className="py-3 pr-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-gray-900 text-white flex items-center justify-center">
                                                <GitBranch className="w-4 h-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-medium text-gray-950 truncate max-w-[260px]">{trace.title}</p>
                                                <p className="text-xs text-gray-500">{trace.traceId}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-3 pr-4">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${getStatusTone(trace.status)}`}>
                                            {trace.status}
                                        </span>
                                    </td>
                                    <td className="py-3 pr-4">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${getScoreColor(trace.evaluatorScore)}`}>
                                            {trace.evaluatorScore}%
                                        </span>
                                    </td>
                                    <td className="py-3 pr-4 text-sm text-gray-700">{trace.runCount}</td>
                                    <td className="py-3 pr-4 text-sm text-gray-700">{formatLatencyMinutes(trace.latencyMinutes)}</td>
                                    <td className="py-3 pr-4">
                                        <div className="flex flex-wrap gap-1">
                                            {trace.tags.slice(0, 3).map((tag) => (
                                                <span key={tag} className="px-2 py-0.5 rounded-md bg-gray-100 text-[11px] text-gray-600">
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="py-3 text-sm text-gray-500">{formatRelative(trace.receivedAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function EvaluatorMatrix({ evaluators }: { evaluators: EvaluatorCoverage[] }) {
    const rows = evaluators.map((evaluator) => ({
        name: evaluator.name,
        type: evaluator.type,
        feedbackKey: evaluator.key,
        score: evaluator.score,
        resources: evaluator.resources,
        icon:
            evaluator.key === 'triage_correctness'
                ? Bot
                : evaluator.key === 'trajectory_valid'
                  ? GitCompare
                  : evaluator.key === 'sla_passed'
                    ? Timer
                    : Code2,
    }));

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <SectionHeader eyebrow="Evaluators" title="Workspace evaluator coverage" />
            <div className="space-y-3">
                {rows.map(({ name, type, feedbackKey, score, resources, icon: Icon }) => (
                    <div key={feedbackKey} className="rounded-lg border border-gray-100 p-3">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="p-2 rounded-lg bg-gray-50 text-gray-600">
                                    <Icon className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-950 truncate">{name}</p>
                                    <p className="text-xs text-gray-500">{type} / {feedbackKey}</p>
                                </div>
                            </div>
                            <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-medium ${getScoreColor(score)}`}>
                                {Math.round(score)}%
                            </span>
                        </div>
                        <div className="mt-3">
                            <ProgressBar value={score} color={score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-amber-500' : 'bg-rose-500'} />
                            <p className="mt-2 text-xs text-gray-500">{resources}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface AgentTrackingDashboardProps {
    defaultTab?: DashboardTab;
    lockedTab?: DashboardTab;
}

export default function AgentTrackingDashboard({
    defaultTab = 'observability',
    lockedTab,
}: AgentTrackingDashboardProps = {}) {
    const { connected } = useSocket();
    const [dateRange, setDateRange] = useState<DateRange>('30d');
    const [activeTab, setActiveTab] = useState<DashboardTab>(defaultTab);
    const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>();
    const visibleTab = lockedTab || activeTab;
    const pageCopy = lockedTab === 'observability'
        ? {
            badge: 'Agent Tracking',
            title: 'Agent Observability',
            description: 'Trace volume, execution paths, latency, errors, tool calls, and production feedback for the after-hours escalation agent.',
        }
        : lockedTab === 'evaluation'
          ? {
              badge: 'Agent Tracking',
              title: 'Agent Evaluation',
              description: 'Offline experiments, online evaluator scores, dataset curation, and quality gates for the after-hours escalation agent.',
          }
          : {
              badge: 'Agent Tracking',
              title: 'Agent Tracking Dashboard',
              description: 'Observe production behavior and evaluate quality for the after-hours escalation agent.',
          };

    const { data: metrics, refetch: refetchMetrics, isLoading: metricsLoading } = useQuery<ComprehensiveMetrics>({
        queryKey: ['agent-tracking-dashboard-metrics', dateRange],
        queryFn: async () => {
            const startDate = getDateRangeStart(dateRange);
            const res = await api.get(`/metrics/comprehensive?startDate=${startDate.toISOString()}`);
            return res.data;
        },
        refetchInterval: 30000,
    });

    const { data: tracking, refetch: refetchTracking, isLoading: trackingLoading } = useQuery<AgentTrackingDashboardData>({
        queryKey: ['agent-tracking-dashboard', dateRange],
        queryFn: async () => {
            const startDate = getDateRangeStart(dateRange);
            const res = await api.get(`/agent-tracking/dashboard?startDate=${startDate.toISOString()}`);
            return res.data;
        },
        refetchInterval: 30000,
    });

    const refreshAll = () => {
        refetchMetrics();
        refetchTracking();
    };

    const derived = useMemo(() => {
        if (!metrics || !tracking) return null;

        const evaluatorScore = (key: string, fallback: number) => {
            const evaluator = tracking.evaluatorCoverage.find((row) => row.key === key);
            return evaluator && evaluator.total > 0 ? evaluator.score : fallback;
        };
        const traceCount = tracking.overview.traceCount;
        const toolRunCount =
            tracking.overview.toolRunCount ||
            metrics.communicationMetrics.totalCallsMade + metrics.communicationMetrics.totalSmsSent;
        const errorRate = tracking.overview.errorRate;
        const precisionScore = clamp(evaluatorScore('triage_correctness', 100 - metrics.aiMetrics.falsePositiveRate));
        const slaScore = clamp(evaluatorScore('sla_passed', metrics.responseTimeMetrics.slaComplianceRate));
        const escalationScore = clamp(evaluatorScore('trajectory_valid', metrics.escalationMetrics.escalationSuccessRate));
        const formatScore = clamp(evaluatorScore('schema_valid', traceCount > 0 ? (metrics.aiMetrics.aiSummariesGenerated / traceCount) * 100 : 0));
        const onlineQualityScore = clamp(tracking.overview.qualityScore || (precisionScore + slaScore + escalationScore + formatScore) / 4);
        const datasetCandidates = tracking.overview.datasetCandidates;
        const datasetCount = (reason: string) => tracking.datasetBreakdown.find((row) => row.reason === reason)?.count || 0;
        const trendData: TrendRow[] = tracking.trendData;
        const evaluatorPie = tracking.evaluatorPie;
        const runTypeData = tracking.runTypeData.length > 0
            ? tracking.runTypeData
            : [
                  { name: 'LLM', runs: tracking.overview.llmRunCount, color: '#2563eb' },
                  { name: 'Tools', runs: toolRunCount, color: '#0f766e' },
                  { name: 'Feedback', runs: datasetCandidates, color: '#be123c' },
              ];

        return {
            traceCount,
            toolRunCount,
            llmRunCount: tracking.overview.llmRunCount,
            errorRate,
            precisionScore,
            slaScore,
            escalationScore,
            formatScore,
            onlineQualityScore,
            datasetCandidates,
            datasetCount,
            trendData,
            evaluatorPie,
            runTypeData,
        };
    }, [metrics, tracking]);

    const traces = useMemo<TraceRow[]>(() => {
        return tracking?.traces || [];
    }, [tracking]);

    const selectedTrace = traces.find((trace) => trace.id === selectedTraceId) || traces[0];

    if (metricsLoading || trackingLoading || !metrics || !tracking || !derived) {
        return <EmptyMetricsState />;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-900 text-white text-xs font-medium">
                            <Workflow className="w-3.5 h-3.5" />
                            {pageCopy.badge}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            connected ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}>
                            <Activity className="w-3.5 h-3.5" />
                            {connected ? 'Live socket' : 'Socket offline'}
                        </span>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-950">{pageCopy.title}</h1>
                    <p className="text-sm text-gray-500">{pageCopy.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        {(['7d', '30d', '90d'] as const).map((range) => (
                            <button
                                key={range}
                                onClick={() => setDateRange(range)}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                                    dateRange === range ? 'bg-white shadow-sm text-blue-700' : 'text-gray-600 hover:text-gray-950'
                                }`}
                            >
                                {range === '7d' ? '7 days' : range === '30d' ? '30 days' : '90 days'}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={refreshAll}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium hover:bg-gray-50"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <ProductCard
                    icon={OBSERVABILITY_ICON}
                    title="Observability"
                    description="Detailed tracing and aggregate trend metrics for agent reasoning, tool calls, errors, latency, and production feedback."
                    status={derived.traceCount > 0 ? 'Receiving events' : 'Waiting for traces'}
                    statusTone={derived.traceCount > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}
                >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <p className="text-xs text-gray-500">Projects</p>
                            <p className="mt-1 font-semibold text-gray-950">after-hours-agent</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Trace metadata</p>
                            <p className="mt-1 font-semibold text-gray-950">env, event, source</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Run types</p>
                            <p className="mt-1 font-semibold text-gray-950">llm, tool, chain</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Retention action</p>
                            <p className="mt-1 font-semibold text-gray-950">Dataset curation</p>
                        </div>
                    </div>
                </ProductCard>

                <ProductCard
                    icon={EVALUATION_ICON}
                    title="Evaluation"
                    description="Offline experiments and online evaluators for triage accuracy, escalation path quality, schema validity, and SLA behavior."
                    status={derived.datasetCandidates > 0 ? 'Feedback loop active' : 'Baseline ready'}
                    statusTone={derived.datasetCandidates > 0 ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}
                >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <p className="text-xs text-gray-500">Datasets</p>
                            <p className="mt-1 font-semibold text-gray-950">{formatNumber(derived.datasetCandidates)} candidates</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Online score</p>
                            <p className="mt-1 font-semibold text-gray-950">{Math.round(derived.onlineQualityScore)}%</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Evaluators</p>
                            <p className="mt-1 font-semibold text-gray-950">{tracking.evaluatorCoverage.length} configured</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Experiment target</p>
                            <p className="mt-1 font-semibold text-gray-950">LangGraph flow</p>
                        </div>
                    </div>
                </ProductCard>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                <StatCard
                    title="Traces"
                    value={formatNumber(derived.traceCount)}
                    detail={`${formatNumber(derived.llmRunCount)} LLM runs`}
                    icon={Layers3}
                    tone="bg-blue-50 text-blue-700"
                    trend="neutral"
                />
                <StatCard
                    title="Run Errors"
                    value={formatPercent(derived.errorRate)}
                    detail={`${metrics.escalationMetrics.missedEscalations} missed escalations`}
                    icon={AlertTriangle}
                    tone="bg-rose-50 text-rose-700"
                    trend={derived.errorRate > 0 ? 'up' : 'neutral'}
                />
                <StatCard
                    title="P95 Latency"
                    value={formatLatencyMinutes(metrics.responseTimeMetrics.p95ResponseTimeMinutes)}
                    detail={`${formatPercent(metrics.responseTimeMetrics.slaComplianceRate)} SLA pass`}
                    icon={Clock}
                    tone="bg-amber-50 text-amber-700"
                    trend={metrics.responseTimeMetrics.p95ResponseTimeMinutes > 15 ? 'up' : 'down'}
                />
                <StatCard
                    title="Tool Runs"
                    value={formatNumber(derived.toolRunCount)}
                    detail={`${metrics.communicationMetrics.callAnswerRate}% call answer rate`}
                    icon={Wrench}
                    tone="bg-teal-50 text-teal-700"
                    trend="neutral"
                />
                <StatCard
                    title="Quality Score"
                    value={`${Math.round(derived.onlineQualityScore)}%`}
                    detail={`${formatPercent(derived.precisionScore)} triage evaluator`}
                    icon={ShieldCheck}
                    tone="bg-emerald-50 text-emerald-700"
                    trend={derived.onlineQualityScore >= 85 ? 'up' : 'down'}
                />
                <StatCard
                    title="Dataset Queue"
                    value={formatNumber(derived.datasetCandidates)}
                    detail="failed, downgraded, or slow traces"
                    icon={Database}
                    tone="bg-violet-50 text-violet-700"
                    trend={derived.datasetCandidates > 0 ? 'up' : 'neutral'}
                />
            </div>

            {!lockedTab && <div className="flex flex-wrap gap-2">
                {([
                    { key: 'observability', label: 'Observability', icon: BarChart3 },
                    { key: 'evaluation', label: 'Evaluation', icon: TestTube2 },
                    { key: 'setup', label: 'Setup & Alerts', icon: TerminalSquare },
                ] as Array<{ key: DashboardTab; label: string; icon: React.ElementType }>).map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            visibleTab === key ? 'bg-gray-900 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                ))}
            </div>}

            {visibleTab === 'observability' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
                            <SectionHeader eyebrow="Monitoring" title="Trace volume, failures, and evaluator trend" />
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={derived.trendData}>
                                    <defs>
                                        <linearGradient id="traceFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="failFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                                            <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                                    <YAxis tickLine={false} axisLine={false} fontSize={11} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#111827',
                                            border: 'none',
                                            borderRadius: '8px',
                                            color: '#fff',
                                        }}
                                    />
                                    <Area type="monotone" dataKey="traces" stroke="#2563eb" strokeWidth={2} fill="url(#traceFill)" name="Traces" />
                                    <Area type="monotone" dataKey="failures" stroke="#e11d48" strokeWidth={2} fill="url(#failFill)" name="Failures" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <SectionHeader eyebrow="Run Mix" title="Run type breakdown" />
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={derived.runTypeData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                                    <YAxis tickLine={false} axisLine={false} fontSize={11} />
                                    <Tooltip />
                                    <Bar dataKey="runs" radius={[6, 6, 0, 0]}>
                                        {derived.runTypeData.map((entry) => (
                                            <Cell key={entry.name} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 2xl:grid-cols-5 gap-6">
                        <div className="2xl:col-span-3">
                            <TraceTimeline selectedTrace={selectedTrace} />
                        </div>
                        <div className="2xl:col-span-2">
                            <div className="bg-white rounded-xl border border-gray-200 p-5 h-full">
                                <SectionHeader eyebrow="Trace Enrichment" title="Tags and metadata coverage" />
                                <div className="space-y-4">
                                    {[
                                        { label: 'session_id / thread_id', value: traces.length > 0 ? 100 : 0, icon: MessageSquare },
                                        { label: 'environment', value: 100, icon: Tags },
                                        { label: 'event_id', value: traces.length > 0 ? 100 : 0, icon: FileText },
                                        { label: 'source and priority', value: metrics.aiMetrics.totalEventsProcessed > 0 ? 92 : 0, icon: Target },
                                    ].map(({ label, value, icon: Icon }) => (
                                        <div key={label}>
                                            <div className="flex items-center justify-between text-sm mb-2">
                                                <span className="inline-flex items-center gap-2 text-gray-700">
                                                    <Icon className="w-4 h-4 text-gray-400" />
                                                    {label}
                                                </span>
                                                <span className="font-semibold text-gray-950">{value}%</span>
                                            </div>
                                            <ProgressBar value={value} color={value >= 90 ? 'bg-emerald-500' : 'bg-amber-500'} />
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4">
                                    <div className="flex gap-3">
                                        <Sparkles className="w-5 h-5 text-blue-700 shrink-0" />
                                        <div>
                                            <p className="text-sm font-semibold text-blue-950">Polly-ready trace context</p>
                                            <p className="mt-1 text-sm text-blue-800">
                                                Recent traces include event, source, emergency, and lifecycle context for assistant-level investigation.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <RecentTraceTable traces={traces} selectedTraceId={selectedTrace?.id} onSelectTrace={setSelectedTraceId} />
                </div>
            )}

            {visibleTab === 'evaluation' && (
                <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6">
                    <div className="2xl:col-span-2 space-y-6">
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <SectionHeader eyebrow="Experiments" title="Offline and online quality results" />
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {[
                                    {
                                        name: 'Production online evals',
                                        icon: Activity,
                                        score: derived.onlineQualityScore,
                                        caption: `${formatNumber(derived.traceCount)} traces sampled`,
                                    },
                                    {
                                        name: 'Triage regression suite',
                                        icon: FlaskConical,
                                        score: derived.precisionScore,
                                        caption: `${formatNumber(derived.datasetCandidates)} new examples queued`,
                                    },
                                    {
                                        name: 'Escalation path backtest',
                                        icon: GitCompare,
                                        score: derived.escalationScore,
                                        caption: `${formatNumber(metrics.escalationMetrics.totalEscalations)} historic escalations`,
                                    },
                                ].map(({ name, icon: Icon, score, caption }) => (
                                    <div key={name} className="rounded-lg border border-gray-100 p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="p-2 rounded-lg bg-gray-50 text-gray-700">
                                                <Icon className="w-5 h-5" />
                                            </div>
                                            <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${getScoreColor(score)}`}>
                                                {Math.round(score)}%
                                            </span>
                                        </div>
                                        <p className="mt-4 font-semibold text-gray-950">{name}</p>
                                        <p className="mt-1 text-sm text-gray-500">{caption}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-6">
                                <ResponsiveContainer width="100%" height={250}>
                                    <AreaChart data={derived.trendData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                                        <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                                        <YAxis tickLine={false} axisLine={false} fontSize={11} domain={[0, 100]} />
                                        <Tooltip />
                                        <Area type="monotone" dataKey="evalScore" stroke="#0f766e" strokeWidth={2} fill="#ccfbf1" name="Eval score" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <SectionHeader eyebrow="Datasets" title="Production traces ready for curation" />
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {[
                                    {
                                        label: 'False-positive triage',
                                        value: derived.datasetCount('false_positive_triage'),
                                        detail: 'downgraded emergency classifications',
                                        icon: Target,
                                        color: 'bg-blue-50 text-blue-700',
                                    },
                                    {
                                        label: 'Missed escalation paths',
                                        value: derived.datasetCount('missed_escalation_path'),
                                        detail: 'unacknowledged or exhausted paths',
                                        icon: AlertTriangle,
                                        color: 'bg-rose-50 text-rose-700',
                                    },
                                    {
                                        label: 'SLA breach cases',
                                        value: derived.datasetCount('sla_breach_case'),
                                        detail: 'slow acknowledgment examples',
                                        icon: Clock,
                                        color: 'bg-amber-50 text-amber-700',
                                    },
                                ].map(({ label, value, detail, icon: Icon, color }) => (
                                    <div key={label} className="rounded-lg border border-gray-100 p-4">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <p className="mt-4 text-2xl font-bold text-gray-950">{formatNumber(value)}</p>
                                        <p className="mt-1 text-sm font-semibold text-gray-900">{label}</p>
                                        <p className="text-xs text-gray-500">{detail}</p>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-5 rounded-lg border border-gray-100 p-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    <StepPill done label="Production trace" />
                                    <ArrowRight className="w-4 h-4 text-gray-300" />
                                    <StepPill done={derived.datasetCandidates > 0} label="Dataset example" />
                                    <ArrowRight className="w-4 h-4 text-gray-300" />
                                    <StepPill done label="Evaluator score" />
                                    <ArrowRight className="w-4 h-4 text-gray-300" />
                                    <StepPill done={derived.onlineQualityScore >= 80} label="Regression gate" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <EvaluatorMatrix evaluators={tracking.evaluatorCoverage} />
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                            <SectionHeader eyebrow="Score Mix" title="Online evaluator distribution" />
                            <ResponsiveContainer width="100%" height={210}>
                                <PieChart>
                                    <Pie data={derived.evaluatorPie} dataKey="value" innerRadius={54} outerRadius={78} paddingAngle={4}>
                                        {derived.evaluatorPie.map((entry) => (
                                            <Cell key={entry.name} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="flex justify-center gap-4">
                                {derived.evaluatorPie.map((entry) => (
                                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                                        <span className="text-gray-600">{entry.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {visibleTab === 'setup' && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
                        <SectionHeader eyebrow="Implementation" title="Tracing and evaluation readiness" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                {
                                    title: 'Enable agent tracing',
                                    status: 'Service key configured',
                                    icon: TerminalSquare,
                                    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                    lines: ['TRACING_ENABLED=true', 'SERVICE_KEY=<configured>', 'PROJECT=after-hours-agent'],
                                },
                                {
                                    title: 'Annotate trace metadata',
                                    status: 'Dashboard model ready',
                                    icon: Tags,
                                    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                    lines: ['event_id, source, emergency_score', 'session_id or thread_id', 'environment, release, graph_version'],
                                },
                                {
                                    title: 'Attach online evaluators',
                                    status: 'Evaluator plan ready',
                                    icon: ClipboardCheck,
                                    tone: 'bg-blue-50 text-blue-700 border-blue-200',
                                    lines: ['triage_correctness', 'trajectory_valid', 'schema_valid, sla_passed'],
                                },
                                {
                                    title: 'Configure project alerts',
                                    status: 'Thresholds drafted',
                                    icon: Webhook,
                                    tone: 'bg-violet-50 text-violet-700 border-violet-200',
                                    lines: ['error rate > 5% over 5m', 'p95 latency > 15m', 'quality score < 80%'],
                                },
                            ].map(({ title, status, icon: Icon, tone, lines }) => (
                                <div key={title} className="rounded-lg border border-gray-100 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg border ${tone}`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-950">{title}</p>
                                                <p className="text-xs text-gray-500">{status}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-4 rounded-lg bg-gray-950 p-3">
                                        {lines.map((line) => (
                                            <p key={line} className="font-mono text-xs text-gray-100 leading-6">{line}</p>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <SectionHeader eyebrow="Reference Map" title="Tracking coverage" />
                        <div className="space-y-3">
                            {[
                                { label: 'Observability concepts', icon: Workflow, href: 'https://docs.langchain.com/langsmith/observability-concepts' },
                                { label: 'Tracing quickstart', icon: Zap, href: 'https://docs.langchain.com/langsmith/observability-quickstart' },
                                { label: 'Dashboards', icon: BarChart3, href: 'https://docs.langchain.com/langsmith/dashboards' },
                                { label: 'Alerts', icon: AlertCircle, href: 'https://docs.langchain.com/langsmith/alerts' },
                                { label: 'Evaluation concepts', icon: ListChecks, href: 'https://docs.langchain.com/langsmith/evaluation-concepts' },
                                { label: 'Evaluation quickstart', icon: TestTube2, href: 'https://docs.langchain.com/langsmith/evaluation-quickstart' },
                            ].map(({ label, icon: Icon, href }) => (
                                <a
                                    key={label}
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50"
                                >
                                    <span className="flex items-center gap-3 text-sm font-medium text-gray-800">
                                        <Icon className="w-4 h-4 text-gray-400" />
                                        {label}
                                    </span>
                                    <ExternalLink className="w-4 h-4 text-gray-400" />
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
