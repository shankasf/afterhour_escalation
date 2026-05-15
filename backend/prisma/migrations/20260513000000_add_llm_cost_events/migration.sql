-- Per-LLM-call cost ledger. One row per ChatCompletion / Realtime audio
-- turn / direct OpenAI SDK call. Backs the admin Cost dashboard.
CREATE TABLE "llm_cost_events" (
    "id" TEXT NOT NULL,
    "run_id" VARCHAR(160) NOT NULL,
    "root_run_id" VARCHAR(160),
    "correlation_id" VARCHAR(160),
    "source" VARCHAR(40) NOT NULL DEFAULT 'langchain',
    "agent" VARCHAR(120),
    "model" VARCHAR(120) NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "audio_tokens_in" INTEGER NOT NULL DEFAULT 0,
    "audio_cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "audio_tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,8) NOT NULL,
    "latency_ms" INTEGER,
    "finish_reason" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_cost_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_cost_events_created_at_idx" ON "llm_cost_events"("created_at");
CREATE INDEX "llm_cost_events_model_created_at_idx" ON "llm_cost_events"("model", "created_at");
CREATE INDEX "llm_cost_events_agent_created_at_idx" ON "llm_cost_events"("agent", "created_at");
CREATE INDEX "llm_cost_events_root_run_id_idx" ON "llm_cost_events"("root_run_id");
CREATE INDEX "llm_cost_events_correlation_id_idx" ON "llm_cost_events"("correlation_id");
