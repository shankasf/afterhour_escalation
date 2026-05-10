import { Injectable, Logger } from '@nestjs/common';
import { EventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type SpanInput = {
  spanId?: string;
  parentSpanId?: string;
  name: string;
  runType?: string;
  status?: string;
  latencyMs?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
};

export type AgentTraceIngestDto = {
  traceId: string;
  externalRunId?: string;
  eventId?: string;
  threadId?: string;
  project?: string;
  title?: string;
  source?: string;
  status?: string;
  latencyMs?: number;
  errorMessage?: string;
  emergencyScore?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
  startedAt?: string;
  endedAt?: string;
  spans?: SpanInput[];
};

type HydratedTrace = Prisma.AgentTraceGetPayload<{
  include: {
    event: true;
    spans: true;
    evaluations: true;
    datasetExamples: true;
  };
}>;

const EVALUATOR_LABELS: Record<string, { name: string; type: string; resources: string }> = {
  triage_correctness: {
    name: 'Emergency triage correctness',
    type: 'code',
    resources: 'event classification and downgrade outcomes',
  },
  trajectory_valid: {
    name: 'Escalation trajectory',
    type: 'code',
    resources: 'LangGraph spans and escalation lifecycle',
  },
  sla_passed: {
    name: 'Acknowledgment SLA',
    type: 'code',
    resources: 'acknowledgment timestamps',
  },
  schema_valid: {
    name: 'Structured output schema',
    type: 'code',
    resources: 'trace metadata and span payloads',
  },
  dialog_progress: {
    name: 'Dialog progress (loop detection)',
    type: 'code',
    resources: 'conversation_log in trace metadata',
  },
};

type DialogTurn = { role?: string; text?: string };

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evaluateDialogProgress(
  turns: DialogTurn[],
): { applicable: boolean; passed: boolean; score: number; feedback: string; metadata: Record<string, unknown> } {
  const assistantTexts = turns
    .filter((t) => t?.role === 'assistant' && typeof t?.text === 'string')
    .map((t) => normalizeForCompare(String(t.text)));

  if (assistantTexts.length < 2) {
    return {
      applicable: false,
      passed: true,
      score: 100,
      feedback: 'Not enough assistant turns to evaluate dialog progression.',
      metadata: { assistantTurns: assistantTexts.length },
    };
  }

  let consecutiveDuplicates = 0;
  let maxStreak = 1;
  let curStreak = 1;
  for (let i = 1; i < assistantTexts.length; i += 1) {
    if (assistantTexts[i] && assistantTexts[i] === assistantTexts[i - 1]) {
      consecutiveDuplicates += 1;
      curStreak += 1;
      if (curStreak > maxStreak) maxStreak = curStreak;
    } else {
      curStreak = 1;
    }
  }

  const totalDup = assistantTexts.length - new Set(assistantTexts).size;
  const looped = maxStreak >= 3 || consecutiveDuplicates >= 2;
  const passed = !looped;
  const score = looped ? Math.max(20, 80 - maxStreak * 10) : 95 - Math.min(30, totalDup * 5);

  return {
    applicable: true,
    passed,
    score,
    feedback: passed
      ? 'Assistant turns progress without consecutive repetition.'
      : `Assistant looped (${maxStreak} consecutive identical replies); the dialog is not progressing.`,
    metadata: {
      assistantTurns: assistantTexts.length,
      consecutiveDuplicates,
      maxStreak,
      totalDuplicates: totalDup,
    },
  };
}

@Injectable()
export class AgentTrackingService {
  private readonly logger = new Logger(AgentTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestTrace(dto: AgentTraceIngestDto): Promise<HydratedTrace> {
    if (!dto.traceId || typeof dto.traceId !== 'string') {
      throw new Error('traceId is required');
    }

    const startedAt = this.dateOr(dto.startedAt, new Date());
    const endedAt = dto.endedAt ? this.dateOr(dto.endedAt, undefined) : undefined;
    const traceStatus = dto.status || (dto.errorMessage ? 'error' : 'success');
    const spans = dto.spans || [];
    const eventId = await this.resolveEventId(dto.eventId);

    const trace = await this.prisma.agentTrace.upsert({
      where: { traceId: dto.traceId },
      create: {
        traceId: dto.traceId,
        externalRunId: dto.externalRunId,
        eventId,
        threadId: dto.threadId || dto.eventId,
        project: dto.project || 'after-hours-agent',
        title: dto.title,
        source: dto.source,
        status: traceStatus,
        runCount: spans.length,
        latencyMs: this.nonNegativeInt(dto.latencyMs),
        errorMessage: dto.errorMessage,
        emergencyScore: this.decimalScore(dto.emergencyScore, 4),
        metadata: this.toJson(dto.metadata),
        tags: this.cleanTags(dto.tags),
        startedAt,
        endedAt,
      },
      update: {
        externalRunId: dto.externalRunId,
        eventId,
        threadId: dto.threadId || dto.eventId,
        project: dto.project || 'after-hours-agent',
        title: dto.title,
        source: dto.source,
        status: traceStatus,
        runCount: spans.length,
        latencyMs: this.nonNegativeInt(dto.latencyMs),
        errorMessage: dto.errorMessage,
        emergencyScore: this.decimalScore(dto.emergencyScore, 4),
        metadata: this.toJson(dto.metadata),
        tags: this.cleanTags(dto.tags),
        startedAt,
        endedAt,
      },
    });

    await this.prisma.agentSpan.deleteMany({ where: { agentTraceId: trace.id } });
    if (spans.length > 0) {
      await this.prisma.agentSpan.createMany({
        data: spans.map((span, index) => {
          const spanStartedAt = this.dateOr(span.startedAt, startedAt);
          const spanEndedAt = span.endedAt ? this.dateOr(span.endedAt, endedAt) : endedAt;
          return {
            agentTraceId: trace.id,
            spanId: `${dto.traceId}:${span.spanId || span.name || index}`.slice(0, 160),
            parentSpanId: span.parentSpanId?.slice(0, 160),
            name: (span.name || `span_${index}`).slice(0, 160),
            runType: span.runType || 'chain',
            status: span.status || traceStatus,
            latencyMs: this.nonNegativeInt(span.latencyMs),
            inputs: this.toJson(span.inputs),
            outputs: this.toJson(span.outputs),
            metadata: this.toJson(span.metadata),
            startedAt: spanStartedAt,
            endedAt: spanEndedAt,
          };
        }),
        skipDuplicates: true,
      });
    }

    const hydrated = await this.findTraceById(trace.id);
    await this.evaluateTrace(hydrated);
    return this.findTraceById(trace.id);
  }

  async getDashboard(startDate?: Date, endDate?: Date) {
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    await this.backfillMissingEventTraces(start, end);

    const traces = await this.prisma.agentTrace.findMany({
      where: { startedAt: { gte: start, lte: end } },
      include: {
        event: true,
        spans: { orderBy: { startedAt: 'asc' } },
        evaluations: true,
        datasetExamples: true,
      },
      orderBy: { startedAt: 'desc' },
      take: 250,
    });

    const allSpans = traces.flatMap((trace) => trace.spans);
    const allEvaluations = traces.flatMap((trace) => trace.evaluations);
    const allDatasetExamples = traces.flatMap((trace) => trace.datasetExamples);
    const latencies = traces
      .map((trace) => trace.latencyMs)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b);
    const traceScores = traces.map((trace) => this.traceScore(trace));
    const qualityScore = this.average(traceScores);
    const errorRate =
      traces.length > 0
        ? (traces.filter((trace) => this.isTraceFailure(trace)).length / traces.length) * 100
        : 0;

    return {
      overview: {
        traceCount: traces.length,
        spanCount: allSpans.length,
        toolRunCount: allSpans.filter((span) => span.runType === 'tool').length,
        llmRunCount: allSpans.filter((span) => span.runType === 'llm').length,
        errorRate: this.round1(errorRate),
        p95LatencyMinutes: this.round1((this.percentile(latencies, 0.95) || 0) / 60000),
        qualityScore: this.round1(qualityScore),
        datasetCandidates: allDatasetExamples.length,
      },
      trendData: this.buildTrend(traces, start, end),
      runTypeData: this.buildRunTypeData(allSpans),
      evaluatorCoverage: this.buildEvaluatorCoverage(allEvaluations),
      evaluatorPie: this.buildEvaluatorPie(traces),
      datasetBreakdown: this.buildDatasetBreakdown(allDatasetExamples),
      traces: traces.map((trace) => this.serializeTrace(trace)),
    };
  }

  async backfillMissingEventTraces(start: Date, end: Date): Promise<number> {
    const events = await this.prisma.event.findMany({
      where: {
        receivedAt: { gte: start, lte: end },
        agentTraces: { none: {} },
      },
      include: { escalationLogs: true },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });

    for (const event of events) {
      try {
        await this.ingestTrace({
          traceId: `event_${event.id}`,
          eventId: event.id,
          threadId: `event_${event.id}`,
          project: 'after-hours-agent',
          title: event.subject || `${event.source} event`,
          source: event.source,
          status: this.traceStatusFromEvent(event.status),
          emergencyScore: event.emergencyScore ? Number(event.emergencyScore) : undefined,
          latencyMs: this.eventLatencyMs(event),
          tags: ['legacy_event_backfill', event.source, event.status],
          startedAt: event.receivedAt.toISOString(),
          endedAt: (event.acknowledgedAt || event.updatedAt || event.receivedAt).toISOString(),
          metadata: {
            source: 'event-backfill',
            eventStatus: event.status,
            aiSummaryPresent: Boolean(event.aiSummary),
          },
          spans: this.legacySpansForEvent(event),
        });
      } catch (error) {
        this.logger.warn(`Failed to backfill agent trace for event ${event.id}: ${error.message}`);
      }
    }

    return events.length;
  }

  private async resolveEventId(eventId: string | undefined): Promise<string | undefined> {
    if (!eventId) return undefined;
    const exists = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    return exists ? eventId : undefined;
  }

  private async findTraceById(id: string): Promise<HydratedTrace> {
    const trace = await this.prisma.agentTrace.findUnique({
      where: { id },
      include: {
        event: true,
        spans: { orderBy: { startedAt: 'asc' } },
        evaluations: true,
        datasetExamples: true,
      },
    });
    if (!trace) throw new Error(`Agent trace ${id} not found`);
    return trace;
  }

  private async evaluateTrace(trace: HydratedTrace): Promise<void> {
    const evaluations = this.evaluate(trace);
    for (const evaluation of evaluations) {
      await this.prisma.agentEvaluation.upsert({
        where: {
          agentTraceId_evaluatorKey: {
            agentTraceId: trace.id,
            evaluatorKey: evaluation.key,
          },
        },
        create: {
          agentTraceId: trace.id,
          eventId: trace.eventId,
          evaluatorKey: evaluation.key,
          evaluatorName: EVALUATOR_LABELS[evaluation.key]?.name || evaluation.key,
          evaluatorType: EVALUATOR_LABELS[evaluation.key]?.type || 'code',
          score: new Prisma.Decimal(evaluation.score),
          passed: evaluation.passed,
          feedback: evaluation.feedback,
          metadata: this.toJson(evaluation.metadata),
        },
        update: {
          eventId: trace.eventId,
          evaluatorName: EVALUATOR_LABELS[evaluation.key]?.name || evaluation.key,
          evaluatorType: EVALUATOR_LABELS[evaluation.key]?.type || 'code',
          score: new Prisma.Decimal(evaluation.score),
          passed: evaluation.passed,
          feedback: evaluation.feedback,
          metadata: this.toJson(evaluation.metadata),
        },
      });
    }

    await this.queueDatasetExamples(trace, evaluations);
  }

  private evaluate(trace: HydratedTrace) {
    const event = trace.event;
    const emergencyScore = Number(trace.emergencyScore ?? event?.emergencyScore ?? 0);
    const status = event?.status;
    const responseMinutes = event ? this.responseMinutes(event) : undefined;
    const schemaPassed = Boolean(trace.eventId && trace.threadId && trace.source && trace.spans.length > 0);
    const trajectoryPassed =
      trace.status !== 'error' &&
      (!event ||
        (emergencyScore >= 0.6
          ? status !== EventStatus.pending && status !== EventStatus.closed
          : status !== EventStatus.escalated && status !== EventStatus.missed));
    const slaPassed =
      responseMinutes === undefined
        ? status !== EventStatus.missed
        : responseMinutes <= 15;
    const triagePassed =
      !event ||
      (status === EventStatus.downgraded && emergencyScore >= 0.6 ? false : true);

    return [
      {
        key: 'triage_correctness',
        score: triagePassed ? (emergencyScore >= 0.8 || emergencyScore <= 0.2 ? 96 : 88) : 35,
        passed: triagePassed,
        feedback: triagePassed
          ? 'Triage score is consistent with the recorded event lifecycle.'
          : 'Emergency classification was later downgraded and should be reviewed.',
        metadata: { emergencyScore, status },
      },
      {
        key: 'trajectory_valid',
        score: trajectoryPassed ? 94 : 40,
        passed: trajectoryPassed,
        feedback: trajectoryPassed
          ? 'Escalation path matches the event priority and terminal status.'
          : 'Escalation path does not match the event priority or trace failed.',
        metadata: { spanCount: trace.spans.length, traceStatus: trace.status, status },
      },
      {
        key: 'sla_passed',
        score: slaPassed ? 95 : 45,
        passed: slaPassed,
        feedback: slaPassed
          ? 'Acknowledgment behavior is within the 15 minute SLA or still active.'
          : 'Acknowledgment missed the 15 minute SLA or the escalation was missed.',
        metadata: { responseMinutes },
      },
      {
        key: 'schema_valid',
        score: schemaPassed ? 100 : 55,
        passed: schemaPassed,
        feedback: schemaPassed
          ? 'Trace includes event, source, thread, and span metadata.'
          : 'Trace is missing required metadata or spans.',
        metadata: {
          hasEventId: Boolean(trace.eventId),
          hasThreadId: Boolean(trace.threadId),
          hasSource: Boolean(trace.source),
          spanCount: trace.spans.length,
        },
      },
      ...this.dialogProgressEvaluation(trace),
    ];
  }

  private dialogProgressEvaluation(trace: HydratedTrace) {
    const meta = (trace.metadata as Record<string, unknown> | null) || {};
    const turns = Array.isArray(meta.conversation_log)
      ? (meta.conversation_log as DialogTurn[])
      : [];
    if (turns.length === 0) return [];
    const result = evaluateDialogProgress(turns);
    if (!result.applicable) return [];
    return [
      {
        key: 'dialog_progress',
        score: result.score,
        passed: result.passed,
        feedback: result.feedback,
        metadata: result.metadata,
      },
    ];
  }

  private async queueDatasetExamples(
    trace: HydratedTrace,
    evaluations: Array<{ key: string; passed: boolean; score: number; feedback: string }>,
  ): Promise<void> {
    const event = trace.event;
    const reasons = new Set<string>();
    if (event?.status === EventStatus.downgraded && Number(event.emergencyScore || 0) >= 0.6) {
      reasons.add('false_positive_triage');
    }
    if (event?.status === EventStatus.missed) {
      reasons.add('missed_escalation_path');
    }
    if (event && this.responseMinutes(event) !== undefined && this.responseMinutes(event)! > 15) {
      reasons.add('sla_breach_case');
    }
    for (const evaluation of evaluations) {
      if (!evaluation.passed || evaluation.score < 80) {
        reasons.add(`${evaluation.key}_failure`);
      }
    }

    for (const reason of reasons) {
      await this.prisma.agentDatasetExample.upsert({
        where: {
          agentTraceId_reason: {
            agentTraceId: trace.id,
            reason,
          },
        },
        create: {
          agentTraceId: trace.id,
          eventId: trace.eventId,
          reason,
          status: 'queued',
          inputs: this.toJson({
            traceId: trace.traceId,
            eventId: trace.eventId,
            source: trace.source,
            subject: event?.subject,
            body: event?.body,
            emergencyScore: Number(trace.emergencyScore ?? event?.emergencyScore ?? 0),
            status: event?.status || trace.status,
          })!,
          expectedOutputs: this.toJson({
            needsHumanReview: true,
            reason,
          }),
          notes: `Queued by online evaluator: ${reason}`,
        },
        update: {
          eventId: trace.eventId,
          inputs: this.toJson({
            traceId: trace.traceId,
            eventId: trace.eventId,
            source: trace.source,
            subject: event?.subject,
            body: event?.body,
            emergencyScore: Number(trace.emergencyScore ?? event?.emergencyScore ?? 0),
            status: event?.status || trace.status,
          })!,
          expectedOutputs: this.toJson({
            needsHumanReview: true,
            reason,
          }),
          notes: `Queued by online evaluator: ${reason}`,
        },
      });
    }
  }

  private serializeTrace(trace: HydratedTrace) {
    return {
      id: trace.id,
      traceId: trace.traceId,
      externalRunId: trace.externalRunId,
      eventId: trace.eventId,
      threadId: trace.threadId,
      title: trace.title || trace.event?.subject || `${trace.source || 'agent'} trace`,
      source: (trace.source || trace.event?.source || 'agent').toUpperCase(),
      status: trace.event ? this.frontendStatus(trace.event.status) : trace.status.toUpperCase(),
      emergencyScore: Math.round(Number(trace.emergencyScore ?? trace.event?.emergencyScore ?? 0) * 100),
      latencyMinutes: this.round1((trace.latencyMs || 0) / 60000),
      runCount: trace.runCount || trace.spans.length,
      evaluatorScore: Math.round(this.traceScore(trace)),
      receivedAt: trace.startedAt.toISOString(),
      tags: trace.tags,
      spans: trace.spans.map((span) => ({
        id: span.id,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        runType: span.runType,
        status: span.status,
        latencyMs: span.latencyMs,
        startedAt: span.startedAt.toISOString(),
        endedAt: span.endedAt?.toISOString(),
      })),
      evaluations: trace.evaluations.map((evaluation) => ({
        key: evaluation.evaluatorKey,
        name: evaluation.evaluatorName,
        type: evaluation.evaluatorType,
        score: Number(evaluation.score),
        passed: evaluation.passed,
        feedback: evaluation.feedback,
      })),
    };
  }

  private buildTrend(traces: HydratedTrace[], start: Date, end: Date) {
    const days = Math.max(1, Math.min(30, Math.ceil((end.getTime() - start.getTime()) / 86400000)));
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      const dayTraces = traces.filter((trace) => trace.startedAt.toISOString().startsWith(key));
      return {
        date: key.slice(5),
        traces: dayTraces.length,
        successful: dayTraces.filter((trace) => !this.isTraceFailure(trace)).length,
        failures: dayTraces.filter((trace) => this.isTraceFailure(trace)).length,
        evalScore: Math.round(this.average(dayTraces.map((trace) => this.traceScore(trace)))),
      };
    });
  }

  private buildRunTypeData(spans: Array<{ runType: string }>) {
    const counts = spans.reduce<Record<string, number>>((acc, span) => {
      const key = span.runType || 'chain';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const colors: Record<string, string> = {
      llm: '#2563eb',
      tool: '#0f766e',
      chain: '#f59e0b',
      evaluator: '#be123c',
      trace: '#6d28d9',
    };
    return Object.entries(counts).map(([name, runs]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      runs,
      color: colors[name] || '#64748b',
    }));
  }

  private buildEvaluatorCoverage(evaluations: Array<{
    evaluatorKey: string;
    evaluatorName: string;
    evaluatorType: string;
    score: Prisma.Decimal;
    passed: boolean;
  }>) {
    const grouped = evaluations.reduce<Record<string, typeof evaluations>>((acc, evaluation) => {
      acc[evaluation.evaluatorKey] = acc[evaluation.evaluatorKey] || [];
      acc[evaluation.evaluatorKey].push(evaluation);
      return acc;
    }, {});
    return Object.entries(EVALUATOR_LABELS).map(([key, label]) => {
      const rows = grouped[key] || [];
      return {
        key,
        name: label.name,
        type: label.type,
        resources: label.resources,
        score: rows.length > 0 ? this.round1(this.average(rows.map((row) => Number(row.score)))) : 0,
        passed: rows.filter((row) => row.passed).length,
        total: rows.length,
      };
    });
  }

  private buildEvaluatorPie(traces: HydratedTrace[]) {
    const passed = traces.filter((trace) => this.traceScore(trace) >= 80).length;
    const review = Math.max(0, traces.length - passed);
    return [
      { name: 'Passed', value: passed, color: '#10b981' },
      { name: 'Needs review', value: review, color: '#f59e0b' },
    ];
  }

  private buildDatasetBreakdown(examples: Array<{ reason: string }>) {
    const counts = examples.reduce<Record<string, number>>((acc, example) => {
      acc[example.reason] = (acc[example.reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).map(([reason, count]) => ({ reason, count }));
  }

  private legacySpansForEvent(event: Prisma.EventGetPayload<{ include: { escalationLogs: true } }>): SpanInput[] {
    const base = event.receivedAt.toISOString();
    const terminalStatus = this.traceStatusFromEvent(event.status);
    const spans: SpanInput[] = [
      {
        spanId: 'intake',
        name: 'intake',
        runType: 'chain',
        status: 'success',
        startedAt: base,
        inputs: { source: event.source, eventId: event.id },
      },
      {
        spanId: 'triage',
        name: 'triage',
        runType: 'llm',
        status: event.status === EventStatus.downgraded ? 'review' : 'success',
        startedAt: base,
        outputs: { emergencyScore: Number(event.emergencyScore || 0), aiSummaryPresent: Boolean(event.aiSummary) },
      },
      {
        spanId: 'after_hours_gate',
        name: 'after_hours_gate',
        runType: 'chain',
        status: 'success',
        startedAt: base,
      },
    ];

    if (Number(event.emergencyScore || 0) >= 0.6 || event.escalationLogs.length > 0) {
      spans.push(
        {
          spanId: 'rotation_planner',
          name: 'rotation_planner',
          runType: 'tool',
          status: 'success',
          startedAt: base,
          outputs: { escalationAttempts: event.escalationLogs.length },
        },
        {
          spanId: 'outreach',
          name: 'outreach',
          runType: 'tool',
          status: event.status === EventStatus.missed ? 'error' : 'success',
          startedAt: base,
          outputs: { escalationAttempts: event.escalationLogs.length },
        },
        {
          spanId: 'wait_for_ack',
          name: 'wait_for_ack',
          runType: 'chain',
          status: event.status === EventStatus.escalated ? 'running' : terminalStatus,
          startedAt: base,
        },
      );
    }

    spans.push({
      spanId: event.status === EventStatus.missed ? 'exhaustion' : 'resolution',
      name: event.status === EventStatus.missed ? 'exhaustion' : 'resolution',
      runType: 'chain',
      status: terminalStatus,
      startedAt: (event.acknowledgedAt || event.updatedAt || event.receivedAt).toISOString(),
    });
    return spans;
  }

  private traceScore(trace: Pick<HydratedTrace, 'evaluations'>): number {
    if (!trace.evaluations.length) return 0;
    return this.average(trace.evaluations.map((evaluation) => Number(evaluation.score)));
  }

  private isTraceFailure(trace: Pick<HydratedTrace, 'status' | 'event'>): boolean {
    return trace.status === 'error' || trace.event?.status === EventStatus.missed;
  }

  private traceStatusFromEvent(status: EventStatus): string {
    if (status === EventStatus.missed) return 'error';
    if (status === EventStatus.escalated) return 'running';
    return 'success';
  }

  private frontendStatus(status: EventStatus): string {
    const map: Record<EventStatus, string> = {
      [EventStatus.pending]: 'NEW',
      [EventStatus.escalated]: 'ESCALATING',
      [EventStatus.acknowledged]: 'ACKNOWLEDGED',
      [EventStatus.downgraded]: 'DOWNGRADED',
      [EventStatus.missed]: 'MISSED',
      [EventStatus.closed]: 'CLOSED',
    };
    return map[status];
  }

  private eventLatencyMs(event: { acknowledgedAt: Date | null; receivedAt: Date; updatedAt: Date }): number | undefined {
    const end = event.acknowledgedAt || event.updatedAt;
    return Math.max(0, end.getTime() - event.receivedAt.getTime());
  }

  private responseMinutes(event: { acknowledgedAt: Date | null; receivedAt: Date }): number | undefined {
    if (!event.acknowledgedAt) return undefined;
    return (event.acknowledgedAt.getTime() - event.receivedAt.getTime()) / 60000;
  }

  private percentile(values: number[], percentile: number): number | undefined {
    if (values.length === 0) return undefined;
    const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * percentile)));
    return values[index];
  }

  private average(values: number[]): number {
    const finite = values.filter((value) => Number.isFinite(value));
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private decimalScore(value: unknown, scale: 2 | 4): Prisma.Decimal | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const max = scale === 4 ? 1 : 100;
    const clamped = Math.min(max, Math.max(0, value));
    return new Prisma.Decimal(clamped);
  }

  private nonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.round(value));
  }

  private dateOr(value: string | undefined, fallback: Date | undefined): Date {
    if (!value) return fallback || new Date();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback || new Date() : parsed;
  }

  private cleanTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) return [];
    return tags
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      .map((tag) => tag.trim().slice(0, 80))
      .slice(0, 20);
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return value as Prisma.InputJsonValue;
  }
}
