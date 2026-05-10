-- Agent observability and evaluation persistence.
-- These tables back the admin Agent Observability and Agent Evaluation pages.

CREATE TABLE "agent_traces" (
    "id" TEXT NOT NULL,
    "trace_id" VARCHAR(160) NOT NULL,
    "external_run_id" VARCHAR(160),
    "event_id" TEXT,
    "thread_id" VARCHAR(160),
    "project" VARCHAR(120) NOT NULL DEFAULT 'after-hours-agent',
    "title" VARCHAR(500),
    "source" VARCHAR(80),
    "status" VARCHAR(80) NOT NULL DEFAULT 'success',
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "error_message" TEXT,
    "emergency_score" DECIMAL(5,4),
    "metadata" JSONB,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_traces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_spans" (
    "id" TEXT NOT NULL,
    "agent_trace_id" TEXT NOT NULL,
    "span_id" VARCHAR(160) NOT NULL,
    "parent_span_id" VARCHAR(160),
    "name" VARCHAR(160) NOT NULL,
    "run_type" VARCHAR(60) NOT NULL DEFAULT 'chain',
    "status" VARCHAR(80) NOT NULL DEFAULT 'success',
    "latency_ms" INTEGER,
    "inputs" JSONB,
    "outputs" JSONB,
    "metadata" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "agent_spans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_evaluations" (
    "id" TEXT NOT NULL,
    "agent_trace_id" TEXT NOT NULL,
    "event_id" TEXT,
    "evaluator_key" VARCHAR(120) NOT NULL,
    "evaluator_name" VARCHAR(200) NOT NULL,
    "evaluator_type" VARCHAR(60) NOT NULL DEFAULT 'code',
    "score" DECIMAL(5,2) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "feedback" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_dataset_examples" (
    "id" TEXT NOT NULL,
    "agent_trace_id" TEXT NOT NULL,
    "event_id" TEXT,
    "reason" VARCHAR(120) NOT NULL,
    "status" VARCHAR(60) NOT NULL DEFAULT 'queued',
    "inputs" JSONB NOT NULL,
    "expected_outputs" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_dataset_examples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_traces_trace_id_key" ON "agent_traces"("trace_id");
CREATE INDEX "agent_traces_event_id_idx" ON "agent_traces"("event_id");
CREATE INDEX "agent_traces_thread_id_idx" ON "agent_traces"("thread_id");
CREATE INDEX "agent_traces_started_at_idx" ON "agent_traces"("started_at");
CREATE INDEX "agent_traces_status_idx" ON "agent_traces"("status");

CREATE UNIQUE INDEX "agent_spans_span_id_key" ON "agent_spans"("span_id");
CREATE INDEX "agent_spans_agent_trace_id_idx" ON "agent_spans"("agent_trace_id");
CREATE INDEX "agent_spans_run_type_idx" ON "agent_spans"("run_type");
CREATE INDEX "agent_spans_status_idx" ON "agent_spans"("status");

CREATE UNIQUE INDEX "agent_evaluations_agent_trace_id_evaluator_key_key" ON "agent_evaluations"("agent_trace_id", "evaluator_key");
CREATE INDEX "agent_evaluations_event_id_idx" ON "agent_evaluations"("event_id");
CREATE INDEX "agent_evaluations_evaluator_key_idx" ON "agent_evaluations"("evaluator_key");
CREATE INDEX "agent_evaluations_created_at_idx" ON "agent_evaluations"("created_at");

CREATE UNIQUE INDEX "agent_dataset_examples_agent_trace_id_reason_key" ON "agent_dataset_examples"("agent_trace_id", "reason");
CREATE INDEX "agent_dataset_examples_event_id_idx" ON "agent_dataset_examples"("event_id");
CREATE INDEX "agent_dataset_examples_reason_idx" ON "agent_dataset_examples"("reason");
CREATE INDEX "agent_dataset_examples_status_idx" ON "agent_dataset_examples"("status");

ALTER TABLE "agent_traces"
    ADD CONSTRAINT "agent_traces_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_spans"
    ADD CONSTRAINT "agent_spans_agent_trace_id_fkey"
    FOREIGN KEY ("agent_trace_id") REFERENCES "agent_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_evaluations"
    ADD CONSTRAINT "agent_evaluations_agent_trace_id_fkey"
    FOREIGN KEY ("agent_trace_id") REFERENCES "agent_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_evaluations"
    ADD CONSTRAINT "agent_evaluations_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_dataset_examples"
    ADD CONSTRAINT "agent_dataset_examples_agent_trace_id_fkey"
    FOREIGN KEY ("agent_trace_id") REFERENCES "agent_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_dataset_examples"
    ADD CONSTRAINT "agent_dataset_examples_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
