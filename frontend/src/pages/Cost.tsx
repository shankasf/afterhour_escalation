import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Activity,
    Cpu,
    DollarSign,
    Gauge,
    RefreshCw,
    Sparkles,
    Timer,
    TrendingUp,
    Volume2,
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

type WindowOpt = '1h' | '24h' | '7d' | '30d' | '90d';

interface CostSummary {
    window: string;
    start: string;
    end: string;
    calls: number;
    total_cost_usd: number;
    tokens_in: number;
    cached_tokens: number;
    tokens_out: number;
    audio_tokens_in: number;
    audio_cached_tokens: number;
    audio_tokens_out: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
    cache_hit_rate: number;
}

interface CostByModelItem {
    model: string;
    calls: number;
    total_cost_usd: number;
    tokens_in: number;
    tokens_out: number;
    audio_tokens_in: number;
    audio_tokens_out: number;
}

interface CostByAgentItem {
    agent: string;
    calls: number;
    total_cost_usd: number;
    avg_latency_ms: number;
}

interface CostTimeseriesPoint {
    ts: string;
    calls: number;
    total_cost_usd: number;
}

interface CostCallRow {
    id: string;
    run_id: string;
    agent?: string | null;
    model: string;
    tokens_in: number;
    tokens_out: number;
    audio_tokens_in: number;
    audio_tokens_out: number;
    cost_usd: number;
    latency_ms?: number | null;
    created_at: string;
}

const WINDOWS: { key: WindowOpt; label: string }[] = [
    { key: '1h', label: '1H' },
    { key: '24h', label: '24H' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
];

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#ec4899', '#0ea5e9'];

const fmtUsd = (v: number) =>
    v >= 100 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
const fmtInt = (v: number) => v.toLocaleString();
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

async function fetchJson<T>(path: string): Promise<T> {
    const { data } = await api.get<T>(path);
    return data;
}

export default function Cost() {
    const [window, setWindow] = useState<WindowOpt>('24h');
    const [bucket, setBucket] = useState<'hour' | 'day'>(window === '7d' || window === '30d' || window === '90d' ? 'day' : 'hour');

    const summaryQ = useQuery({
        queryKey: ['cost-summary', window],
        queryFn: () => fetchJson<CostSummary>(`/cost/summary?window=${window}`),
        refetchInterval: 30_000,
    });
    const byModelQ = useQuery({
        queryKey: ['cost-by-model', window],
        queryFn: () => fetchJson<{ items: CostByModelItem[] }>(`/cost/by-model?window=${window}`),
        refetchInterval: 60_000,
    });
    const byAgentQ = useQuery({
        queryKey: ['cost-by-agent', window],
        queryFn: () => fetchJson<{ items: CostByAgentItem[] }>(`/cost/by-agent?window=${window}`),
        refetchInterval: 60_000,
    });
    const tsQ = useQuery({
        queryKey: ['cost-timeseries', window, bucket],
        queryFn: () => fetchJson<{ points: CostTimeseriesPoint[] }>(`/cost/timeseries?window=${window}&bucket=${bucket}`),
        refetchInterval: 60_000,
    });
    const topQ = useQuery({
        queryKey: ['cost-top-calls', window],
        queryFn: () => fetchJson<{ items: CostCallRow[] }>(`/cost/top-calls?window=${window}&limit=20`),
        refetchInterval: 60_000,
    });
    const recentQ = useQuery({
        queryKey: ['cost-recent'],
        queryFn: () => fetchJson<{ items: CostCallRow[] }>(`/cost/recent?limit=50`),
        refetchInterval: 15_000,
    });

    const summary = summaryQ.data;
    const tsPoints = tsQ.data?.points ?? [];
    const byModel = byModelQ.data?.items ?? [];
    const byAgent = byAgentQ.data?.items ?? [];
    const topCalls = topQ.data?.items ?? [];
    const recent = recentQ.data?.items ?? [];

    const tsChart = useMemo(
        () => tsPoints.map((p) => ({
            label: new Date(p.ts).toLocaleString([], bucket === 'day' ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit' }),
            calls: p.calls,
            cost: Number(p.total_cost_usd.toFixed(4)),
        })),
        [tsPoints, bucket],
    );

    const refetchAll = () => {
        summaryQ.refetch();
        byModelQ.refetch();
        byAgentQ.refetch();
        tsQ.refetch();
        topQ.refetch();
        recentQ.refetch();
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
                        <DollarSign className="h-6 w-6 text-emerald-600" />
                        AI Cost Transparency
                    </h1>
                    <p className="text-sm text-slate-600 mt-1">
                        Every LLM call billed to your OpenAI account, priced against the live LangSmith model-price map.
                        Updates every 15–30 seconds.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                        {WINDOWS.map((w) => (
                            <button
                                key={w.key}
                                onClick={() => {
                                    setWindow(w.key);
                                    setBucket(w.key === '7d' || w.key === '30d' || w.key === '90d' ? 'day' : 'hour');
                                }}
                                className={`px-3 py-1.5 text-xs font-medium rounded ${
                                    window === w.key
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-700 hover:bg-slate-100'
                                }`}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={refetchAll}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </button>
                </div>
            </header>

            {/* Hero cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <KpiCard
                    icon={<DollarSign className="h-5 w-5" />}
                    label="Total spend"
                    value={fmtUsd(summary?.total_cost_usd ?? 0)}
                    sub={`${fmtInt(summary?.calls ?? 0)} calls`}
                    tone="emerald"
                />
                <KpiCard
                    icon={<Cpu className="h-5 w-5" />}
                    label="Text tokens"
                    value={fmtInt((summary?.tokens_in ?? 0) + (summary?.tokens_out ?? 0))}
                    sub={`in ${fmtInt(summary?.tokens_in ?? 0)} · out ${fmtInt(summary?.tokens_out ?? 0)}`}
                    tone="indigo"
                />
                <KpiCard
                    icon={<Volume2 className="h-5 w-5" />}
                    label="Audio tokens"
                    value={fmtInt((summary?.audio_tokens_in ?? 0) + (summary?.audio_tokens_out ?? 0))}
                    sub={`in ${fmtInt(summary?.audio_tokens_in ?? 0)} · out ${fmtInt(summary?.audio_tokens_out ?? 0)}`}
                    tone="amber"
                />
                <KpiCard
                    icon={<Sparkles className="h-5 w-5" />}
                    label="Cache hit rate"
                    value={fmtPct(summary?.cache_hit_rate ?? 0)}
                    sub={`P95 latency ${summary?.p95_latency_ms ?? 0}ms`}
                    tone="violet"
                />
            </div>

            {/* Spend over time */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-indigo-600" />
                        Spend over time ({bucket})
                    </h2>
                    <span className="text-xs text-slate-500">{tsChart.length} buckets</span>
                </div>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={tsChart}>
                            <defs>
                                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                            <Tooltip formatter={(v: number) => fmtUsd(v)} />
                            <Area type="monotone" dataKey="cost" stroke="#6366f1" fill="url(#costGrad)" strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </section>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-emerald-600" />
                        Spend by model
                    </h2>
                    {byModel.length === 0 ? (
                        <EmptyState />
                    ) : (
                        <>
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={byModel.map((m) => ({ name: m.model, value: Number(m.total_cost_usd.toFixed(4)) }))}
                                            dataKey="value"
                                            outerRadius={80}
                                            innerRadius={45}
                                            paddingAngle={2}
                                            label={(d) => d.name}
                                            labelLine={false}
                                        >
                                            {byModel.map((_, i) => (
                                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(v: number) => fmtUsd(v)} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <table className="w-full mt-3 text-sm">
                                <thead>
                                    <tr className="text-xs uppercase text-slate-500">
                                        <th className="text-left font-medium pb-1">Model</th>
                                        <th className="text-right font-medium pb-1">Calls</th>
                                        <th className="text-right font-medium pb-1">Tokens (in/out)</th>
                                        <th className="text-right font-medium pb-1">Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {byModel.map((m, i) => (
                                        <tr key={m.model} className="border-t border-slate-100">
                                            <td className="py-1.5 text-slate-900">
                                                <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                                {m.model}
                                            </td>
                                            <td className="py-1.5 text-right text-slate-600">{fmtInt(m.calls)}</td>
                                            <td className="py-1.5 text-right text-slate-600">{fmtInt(m.tokens_in)} / {fmtInt(m.tokens_out)}</td>
                                            <td className="py-1.5 text-right font-medium text-slate-900">{fmtUsd(m.total_cost_usd)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5">
                    <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-indigo-600" />
                        Spend by agent
                    </h2>
                    {byAgent.length === 0 ? (
                        <EmptyState />
                    ) : (
                        <div className="h-72">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={byAgent.map((a) => ({ ...a, costRounded: Number(a.total_cost_usd.toFixed(4)) }))} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                                    <YAxis dataKey="agent" type="category" tick={{ fontSize: 11 }} width={120} />
                                    <Tooltip formatter={(v: number) => fmtUsd(v)} />
                                    <Bar dataKey="costRounded" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </section>
            </div>

            {/* Top expensive calls */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Top {topCalls.length} most expensive calls
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                                <th className="text-left font-medium py-2">When</th>
                                <th className="text-left font-medium py-2">Agent</th>
                                <th className="text-left font-medium py-2">Model</th>
                                <th className="text-right font-medium py-2">Tok in</th>
                                <th className="text-right font-medium py-2">Tok out</th>
                                <th className="text-right font-medium py-2">Audio in/out</th>
                                <th className="text-right font-medium py-2">Latency</th>
                                <th className="text-right font-medium py-2">Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topCalls.length === 0 ? (
                                <tr><td colSpan={8} className="py-6 text-center text-slate-500">No calls in this window</td></tr>
                            ) : topCalls.map((c) => (
                                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-2 text-slate-700">{new Date(c.created_at).toLocaleString()}</td>
                                    <td className="py-2 text-slate-700">{c.agent ?? '—'}</td>
                                    <td className="py-2 text-slate-700 font-mono text-xs">{c.model}</td>
                                    <td className="py-2 text-right text-slate-600">{fmtInt(c.tokens_in)}</td>
                                    <td className="py-2 text-right text-slate-600">{fmtInt(c.tokens_out)}</td>
                                    <td className="py-2 text-right text-slate-600">{fmtInt(c.audio_tokens_in)} / {fmtInt(c.audio_tokens_out)}</td>
                                    <td className="py-2 text-right text-slate-600 inline-flex items-center gap-1 justify-end"><Timer className="h-3 w-3" /> {c.latency_ms ?? '—'}ms</td>
                                    <td className="py-2 text-right font-medium text-emerald-700">{fmtUsd(c.cost_usd)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Live tail */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-500" />
                    Live feed — last {recent.length} calls
                </h2>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="text-xs uppercase text-slate-500 border-b border-slate-200">
                                <th className="text-left font-medium py-2">When</th>
                                <th className="text-left font-medium py-2">Agent</th>
                                <th className="text-left font-medium py-2">Model</th>
                                <th className="text-right font-medium py-2">Tokens</th>
                                <th className="text-right font-medium py-2">Latency</th>
                                <th className="text-right font-medium py-2">Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recent.length === 0 ? (
                                <tr><td colSpan={6} className="py-6 text-center text-slate-500">No calls yet</td></tr>
                            ) : recent.map((c) => (
                                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-1.5 text-slate-700 text-xs">{new Date(c.created_at).toLocaleTimeString()}</td>
                                    <td className="py-1.5 text-slate-700">{c.agent ?? '—'}</td>
                                    <td className="py-1.5 text-slate-700 font-mono text-xs">{c.model}</td>
                                    <td className="py-1.5 text-right text-slate-600">{fmtInt(c.tokens_in + c.tokens_out)}</td>
                                    <td className="py-1.5 text-right text-slate-600">{c.latency_ms ?? '—'}ms</td>
                                    <td className="py-1.5 text-right font-medium text-slate-900">{fmtUsd(c.cost_usd)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: 'emerald' | 'indigo' | 'amber' | 'violet' }) {
    const toneCls: Record<typeof tone, string> = {
        emerald: 'bg-emerald-50 text-emerald-700',
        indigo: 'bg-indigo-50 text-indigo-700',
        amber: 'bg-amber-50 text-amber-700',
        violet: 'bg-violet-50 text-violet-700',
    } as const;
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">{label}</span>
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${toneCls[tone]}`}>{icon}</span>
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-900">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{sub}</div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="py-10 text-center text-sm text-slate-500">
            No data for this window yet. Make some LLM calls and check back.
        </div>
    );
}
