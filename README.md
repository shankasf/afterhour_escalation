# After-Hours Escalation System

AI-driven on-call escalation for property management. Watches email and Dialpad,
scores urgency with an LLM, and pages on-call staff via Twilio voice + SMS until
someone acknowledges. Includes in-browser WebRTC voice (OpenAI Realtime) and a
full agent-tracking / evaluation layer for trace observability.

## Architecture

- High-level diagrams: [docs/architecture/HLD.md](docs/architecture/HLD.md)
- Module / ERD / sequence detail: [docs/architecture/LLD.md](docs/architecture/LLD.md)

### End-to-end picture (one diagram)

Inputs come in from the left, run through the AI service's LangGraph state machine in
the middle, and turn into outbound calls/SMS or admin alerts on the right. Everything
in **blue** is an LLM step; everything in **orange** is a paused state waiting for a
webhook.

```mermaid
flowchart LR
    subgraph IN["INPUTS"]
        E["Email<br/>IMAP poll (30s)"]
        C["Customer chat<br/>(widget WS)"]
        D["Dialpad voicemail"]
        T["Twilio webhooks<br/>(DTMF / SMS reply)"]
        W["WebRTC<br/>browser call"]
    end

    subgraph AI["AI SERVICE  (FastAPI + LangGraph)"]
        direction TB
        EV["post_event<br/>(one entry per channel)"] --> G["LangGraph StateGraph<br/>checkpointed in Postgres"]
        G --> SG["Sub-graphs (LLM):<br/>triage · voice_script · sms ·<br/>voicemail · orchestrator"]
    end

    subgraph BE["BACKEND  (NestJS + Prisma)"]
        API["REST + Socket.io"]
        DB[("PostgreSQL")]
        Q[("Redis / Bull")]
    end

    subgraph OUT["OUTPUTS"]
        TW["Twilio call + SMS<br/>to on-call tech"]
        CUST["Customer status<br/>message back"]
        ADM["AdminAlert<br/>(ladder exhausted)"]
        UI["Live dashboard<br/>+ agent-tracking traces"]
    end

    E --> EV
    C --> EV
    D --> EV
    T -.->|resume thread| G
    W -.->|resume thread| G

    SG --> API
    API --- DB
    API --- Q
    API --> TW
    API --> CUST
    API --> ADM
    G --> UI

    classDef llm fill:#e8f1ff,stroke:#1d4ed8;
    classDef wait fill:#fff4d6,stroke:#c79100;
    class SG llm;
    class T,W wait;
```

## Stack & frameworks

| Layer        | What we use                                                                 |
|--------------|-----------------------------------------------------------------------------|
| Frontend     | React 18, Vite, TypeScript, TailwindCSS, Socket.io client, WebRTC           |
| Backend API  | NestJS 10, Prisma, PostgreSQL, Bull (Redis), Socket.io                      |
| AI service   | FastAPI, Pydantic                                                           |
| **Agents**   | **LangGraph** (`StateGraph` + Postgres checkpointer + sub-graphs)           |
| **LLM**      | **LangChain** (`langchain-openai`) + **OpenAI Python SDK** for chat models  |
| **Realtime** | **OpenAI Realtime API** (`gpt-realtime`) over WebSocket for browser voice   |
| **Tracing**  | **LangSmith** (auto-wired when `LANGSMITH_TRACING=true`)                    |
| External     | Twilio (voice/SMS), Dialpad (inbound), Microsoft 365, IMAP/SMTP             |

There is **no separate "agent framework"** — every agent is a LangGraph node or
sub-graph. The older `ah_agents/*.py` files are thin façades that just call into
the corresponding LangGraph sub-graph. The previous OpenAI Agents SDK code
(`head_agent.py`, `agent_tools.py`, `Runner`-based handoffs) has been removed;
the only OpenAI dependency is the chat-completions client used inside
LangGraph nodes (`graph/openai_client.py`) and the Realtime API used by the
WebRTC bridge (`webrtc/`).

## Quick Start

```bash
cp .env.example .env          # fill in credentials
cd backend && npm i && npx prisma generate && npx prisma db push
cd ../ai-service && pip install -r requirements.txt
cd ../frontend && npm i

# run all three under PM2
pm2 start ecosystem.config.js
```

Or build/run with Docker (backend + frontend ship `Dockerfile`s — Node 20 +
Prisma migrate for the API, multi-stage Vite build → nginx 1.27 for the SPA).

Access:
- UI: http://localhost:5175
- Backend API docs: http://localhost:3004/api/docs
- AI service docs: http://localhost:8083/docs

## Required Configuration

```env
DATABASE_URL=postgresql://user:pass@host:5434/db
JWT_SECRET=...
INTERNAL_API_KEY=...
OPENAI_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
IMAP_USER=...   IMAP_PASSWORD=...
SMTP_USER=...   SMTP_PASSWORD=...
DIALPAD_WEBHOOK_SECRET=...
EMERGENCY_SCORE_THRESHOLD=0.6
ACKNOWLEDGMENT_TIMEOUT_SECONDS=120
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=after-hours-agent
LANGSMITH_API_KEY=...
```

Full list: `.env.example`.

## How It Works (plain English)

1. **Something comes in** — an email, a customer chat, a voicemail, or a browser call.
2. **Triage (LLM)** reads it and gives an urgency score 0–1 plus a short summary.
3. **Gate** checks: are we in the after-hours window? Is the score high enough?
   - No → tell the customer we'll handle it in the morning, end.
   - Yes → continue.
4. **Build the ladder** — list of techs to page, in order (primary, secondary, fallback).
5. **Reach out** — LLM writes a 35–50 word voice script + a ≤160-char SMS, Twilio dials
   and texts the first tech.
6. **Park & wait** — the graph pauses (`interrupt_before`) until a webhook wakes it:
   DTMF "1", reply "ACK", a callback request, or the 120-second timer fires.
7. **Interpret reply (LLM)** — classifies as `ack` / `decline` / `callback` / `no_answer`.
   Ack → resolved. No-answer → next tech. List exhausted → `AdminAlert`.
8. **Tell the customer** — status-tailored message back ("tech accepted", "still trying",
   "escalating to backup").
9. **Trace everything** — every LLM call emits a trace + spans to the
   `/agent-tracking` module and (if enabled) LangSmith.

Dialpad voicemails join at step 2 via the **voicemail** sub-graph. Browser-initiated
calls use the OpenAI Realtime API over WebSocket and resume the same LangGraph thread
when the user accepts/hangs up.

## Agent Tracking & Evaluation

Every LLM call (triage, SMS, voice script, WebRTC realtime session) emits a
**trace** with hierarchical **spans** to the backend `/agent-tracking` module,
which scores them against five online evaluators and queues interesting cases
for offline review.

| Table                    | Purpose                                                       |
|--------------------------|---------------------------------------------------------------|
| `agent_traces`           | One row per agent run (event_id, run_type, emergency_score)   |
| `agent_spans`            | LLM / tool / network spans nested under a trace               |
| `agent_evaluations`      | Online evaluator scores (pass/fail + reason)                  |
| `agent_dataset_examples` | Queued examples for fine-tuning / regression sets             |

**Evaluators:** `triage_correctness`, `trajectory_valid`, `sla_passed`,
`schema_valid`, `dialog_progress`.

**Frontend** — `/agent-tracking` dashboard (3 tabs):
- **Observability**: trace volume, run-type breakdown, recent traces table.
- **Evaluation**: evaluator coverage matrix, dataset queue, online/offline scores.
- **Setup**: implementation checklist + LangSmith links.

The AI service publishes via `ai-service/services/agent_tracking.py` →
`POST /agent-tracking/traces` (best-effort, retried). LangSmith mirroring is
enabled when `LANGSMITH_TRACING=true`.

## The Agentic System (LangGraph)

The AI service is a single `StateGraph` (`ai-service/graph/graph.py`) over an
`IncidentState`, checkpointed in Postgres. The thread id is the event id, so
every inbound webhook (Twilio DTMF, SMS reply, customer chat message,
WebRTC `call_accepted`/`hangup`) resumes the same graph from where it parked.

**Three entry shapes feed one graph:**
- **Email** — `email_poller` (IMAP, 30s) → `post_event(kind=email_received)`
- **Customer chat** — widget WS → `post_event(kind=customer_chat_*)` — runs a
  conversational `customer_chat_dialog` loop before joining the escalation path
- **Manual / API** — `POST /escalate/orchestrated` from backend Bull jobs

### Main flow (one graph, one diagram)

Green = talks to **customer**. Red = pages **technician**. Blue = LLM call.
Amber = graph pauses here.

```mermaid
flowchart TD
    START([start]) --> intake

    intake -. "chat" .-> chat["chat with customer"]
    intake -. "email" .-> triage

    chat -- "ask next" --> chat
    chat -. "escalate" .-> triage
    chat -. "no need" .-> END_chat([end])

    triage["triage<br/>score 0–1"] --> gate{after hours?}

    gate -. "no, score low" .-> END_closed([end])
    gate -. "no, score high" .-> planner["build tech list"]
    gate -. "yes" .-> tell_blocked["tell customer:<br/>we'll handle AM"]

    planner --> outreach

    outreach["call/SMS tech<br/>at level N"]
    outreach -. "list done" .-> exhausted["no one acked"]
    outreach -- "page sent" --> park

    park["wait for tech reply"] -->|webhook| interpret["read tech reply"]

    interpret -. "ack" .-> done["tech took it"]
    interpret -. "call me back" .-> wait_cb["wait for tech<br/>to ring back"]
    interpret -. "no / silent" .-> next_tech[/"next level"/]
    next_tech --> outreach

    wait_cb --> park

    done -- "stop escalation" --> tell_ack["tell customer:<br/>tech accepted,<br/>follow-up coming"]
    exhausted -- "alert admin" --> tell_exh["tell customer:<br/>couldn't reach tech,<br/>escalating to backup"]

    tell_blocked --> END_a([end])
    tell_ack --> END_ack([end])
    tell_exh --> END_exh([end])

    classDef terminal fill:#eee,stroke:#888,stroke-dasharray:3 3;
    classDef park fill:#fff4d6,stroke:#c79100;
    classDef llm fill:#e8f1ff,stroke:#1d4ed8;
    classDef tech fill:#fde2e2,stroke:#b91c1c;
    classDef cust fill:#dcfce7,stroke:#15803d;
    class START,END_chat,END_closed,END_a,END_ack,END_exh terminal;
    class park park;
    class triage,interpret,chat llm;
    class planner,outreach,park,interpret,wait_cb,done,exhausted,next_tech tech;
    class chat,tell_blocked,tell_ack,tell_exh cust;
```

The graph pauses at **wait for tech reply** (`interrupt_before` in code) until
a webhook (Twilio DTMF, SMS reply, or WebRTC accept) wakes it up.

### Sub-graphs (the "agents")

Each LLM step is its own compiled `StateGraph` in `ai-service/graph/subgraphs/`.
The main graph calls them; they can also be called directly from REST routes.
The orchestrator below is the one that fans out voice-script + SMS generation
in parallel:

```mermaid
flowchart LR
    IN[event in:<br/>email · chat · manual] --> TR["triage<br/>(LLM)"]
    TR --> Q{escalate?<br/>score ≥ 0.6<br/>or chat}
    Q -- no --> AS["assemble<br/>output"]
    Q -- yes --> GEN
    subgraph GEN["generate_content (parallel)"]
        VS["voice_script<br/>(LLM, ≤400 chars)"]
        SM["sms<br/>(LLM, ≤160 chars)"]
    end
    GEN --> AS
    AS --> OUT["{should_escalate,<br/>triage, content,<br/>after_hours, notes}"]

    classDef llm fill:#e8f1ff,stroke:#1d4ed8;
    class TR,VS,SM llm;
```

| Sub-graph         | File                                  | Job                                                       |
|-------------------|---------------------------------------|-----------------------------------------------------------|
| `triage_graph`    | `graph/subgraphs/triage.py`           | Score email urgency 0–1, extract context                  |
| `voice_script_graph` | `graph/subgraphs/voice_script.py`  | 35–50 word voice script (call or voicemail mode)          |
| `sms_graph`       | `graph/subgraphs/sms.py`              | ≤160-char SMS to the on-call tech                         |
| `voicemail_graph` | `graph/subgraphs/voicemail.py`        | Score + summarize a Dialpad voicemail                     |
| `orchestrator_graph` | `graph/subgraphs/orchestrator.py`  | Triage + parallel fan-out + after-hours gate (diagram above) |

All five share the same callback stack (`graph/callbacks.py`) for structured
logs, cost tracking, and LangSmith traces — so a single run shows up as one
parent trace with child spans per sub-graph.

### Node responsibilities

| Node                     | What it actually does (from the source)                                                          |
|--------------------------|--------------------------------------------------------------------------------------------------|
| `intake`                 | Normalizes payload; sets `source` from `channel_event.kind` (`customer_chat*` / `email_received`).|
| `customer_chat_dialog`   | Two-way LLM chat; when LLM marks `done=true`, runs **one-shot triage from transcript**.          |
| `triage`                 | LLM → `{decision, priority, emergency_score, is_safety_critical}`. Score ≥0.5 = escalate, 0.3–0.5 = monitor, <0.3 = ignore. |
| `after_hours_gate`       | `services.after_hours.should_escalate_now`: outside coverage → `after_hours_blocked`; in window but not escalating → `closed`; else → `outreach`. |
| `rotation_planner`       | Builds ladder: rotation (primary/secondary) + fixed-level fallback contacts.                     |
| `outreach`               | Generates 35–50 word voice script (LLM), `start_escalation`, `log_escalation_attempt`, `dispatch_call`, sets `awaiting=ack`, +120s deadline. |
| `wait_for_ack`           | **Park.** `interrupt_before` halts the graph until an external webhook resumes the thread.        |
| `response_interpreter`   | LLM classifies responder reply → `ack` / `decline` / `callback` / `no_answer` / `unknown`. Timeout/empty input short-circuits to `no_answer`. |
| `callback_handler`       | Sets `awaiting=callback`, deadline +10 min.                                                       |
| `customer_callback`      | Sets `awaiting=callback`, deadline +15 min, parks back at `wait_for_ack`.                         |
| `resolution`             | `stop_escalation('acknowledged_by_responder')`, status → `resolved`.                              |
| `exhaustion`             | `stop_escalation('ladder_exhausted')`, status → `exhausted` (backend may create `AdminAlert`).    |
| `customer_status_update` | Sends a status-tailored message back to the customer (only if `raw.session_token` is set).        |

### State at a glance

`IncidentState` (`ai-service/graph/state.py`) carries the run: `event_id`,
`source`, `triage`, `ladder`, `cursor`, `attempts[]`, `conversation_log[]`,
`awaiting` (`ack`/`callback`), `awaiting_deadline`, and `status` (the field
every conditional edge keys off).

### Lifecycle

```mermaid
flowchart LR
    A[FastAPI startup<br/>main.py lifespan] --> B[init_graph]
    B --> C{DATABASE_URL?}
    C -- yes --> D[AsyncPostgresSaver<br/>+ setup]
    C -- no --> E[MemorySaver]
    D --> F[build_graph<br/>StateGraph.compile<br/>interrupt_before=wait_for_ack]
    E --> F
    F --> G[get_graph used by<br/>/classify/orchestrated<br/>/escalate/orchestrated<br/>/twilio/* /dialpad /chat webhooks]
    G --> H[FastAPI shutdown] --> I[close_graph]
```

## Project Layout

```
backend/      NestJS API + Prisma schema (backend/prisma/schema.prisma)
  └── src/agent-tracking/   traces, spans, evaluators, dataset queue
ai-service/   FastAPI agents, email/Twilio/Dialpad services
  ├── graph/        LangGraph StateGraph + nodes
  ├── webrtc/       Socket.io signaling, OpenAI Realtime bridge
  └── services/agent_tracking.py   trace publisher
frontend/     React dashboard (Live, Events, Metrics, Rotation, Settings,
              Agent Tracking)
docs/         HLD/LLD architecture
ecosystem.config.js   PM2 process definitions
backend/Dockerfile, frontend/Dockerfile   container builds
```

## Code Flow — how the files connect

Three services talk to each other; inside `ai-service` everything funnels into
one LangGraph `StateGraph`. The chain below is the **import / call** chain — read
top to bottom, each line names the file that does the work.

### Cross-service flow

```mermaid
flowchart LR
    subgraph CW["customer-widget/"]
        WJS["index.html<br/>+ widget.ts"]
    end
    subgraph FE["frontend/"]
        FUI["pages/Live · Events ·<br/>AgentTracking · Rotation"]
    end
    subgraph BE["backend/ (NestJS)"]
        BAPI["REST controllers<br/>(escalation · events · acks)"]
        BWS["customer-chat.gateway<br/>signaling.gateway"]
        BAI["ai-service.client.ts<br/>(HTTP → ai-service)"]
        BDB[("Prisma → PostgreSQL")]
        BQ[("Bull / Redis")]
    end
    subgraph AI["ai-service/ (FastAPI)"]
        AROUTE["routes/<br/>classify · escalate · email · graph"]
        AAG["ah_agents/<br/>(façades)"]
        AGR["graph/graph.py<br/>(StateGraph)"]
        AWR["webrtc/<br/>signaling + media_session"]
    end
    subgraph EXT["External"]
        TW["Twilio"]
        OAI["OpenAI<br/>(chat + realtime)"]
        IMAP["IMAP / SMTP"]
    end

    WJS -- "WS" --> BWS
    FUI -- "REST + Socket.io" --> BAPI
    BWS --> BAI
    BAPI --> BAI
    BAI -- "POST /escalate/orchestrated<br/>POST /classify/orchestrated" --> AROUTE
    AROUTE --> AAG
    AAG --> AGR
    AGR --> AROUTE
    AROUTE -- "POST /escalation/* · /events · /acks" --> BAPI
    BAPI --> BDB
    BAPI --> BQ
    BAPI --> TW
    AGR --> OAI
    AWR --> OAI
    BAPI -- "trigger" --> IMAP
```

**Plain English:** the **frontend** and **customer-widget** only talk to the
**backend**. The backend persists everything to Postgres and uses Bull jobs to
call the **ai-service** for any LLM work. The ai-service runs LangGraph,
publishes results back to the backend, and the backend dispatches Twilio. No
service skips the backend — it's the source of truth.

### Inside `ai-service/` — file-by-file call chain

```
                       ┌───────────────────────────────────────────┐
inbound HTTP/WS  ─────▶│  routes/*.py  (FastAPI handlers)          │
                       │  classify.py  escalate.py  email.py       │
                       │  graph.py     eval.py      cost.py        │
                       └────────────┬──────────────────────────────┘
                                    │ instantiate / call
                                    ▼
                       ┌───────────────────────────────────────────┐
                       │  ah_agents/*.py  (thin façades)           │
                       │  EmailTriageAgent · VoiceAIAgent · …      │
                       │  EscalationOrchestrator                   │
                       └────────────┬──────────────────────────────┘
                                    │ ainvoke(...)
                                    ▼
                       ┌───────────────────────────────────────────┐
                       │  graph/subgraphs/*.py                     │
                       │  triage · voice_script · sms ·            │
                       │  voicemail · orchestrator                 │
                       └────────────┬──────────────────────────────┘
                                    │
                                    ▼ (full incident flow)
                       ┌───────────────────────────────────────────┐
                       │  graph/graph.py  (top-level StateGraph)   │
                       │   intake → triage → after_hours_gate →    │
                       │   rotation_planner → outreach → ⏸ wait    │
                       │   → response_interpreter → resolution …   │
                       └────────────┬──────────────────────────────┘
                                    │ each node
                                    ▼
                       ┌───────────────────────────────────────────┐
                       │  graph/nodes/*.py                         │
                       │  – use graph/llm.py / openai_client.py    │
                       │    for LLM calls                          │
                       │  – use ah_agents/queries/* for DB writes  │
                       │  – emit traces via                        │
                       │    services/agent_tracking.py             │
                       └───────────────────────────────────────────┘
```

Key wiring rules:

- **Routes never call LLMs directly.** They call a façade or `graph_app.ainvoke`.
- **Façades in `ah_agents/`** exist only so legacy callers (routes, email poller)
  keep working — each one is ~50 lines that `await some_subgraph.ainvoke(...)`.
- **Sub-graphs in `graph/subgraphs/`** own all prompt construction. They share
  one chat-model factory (`graph/llm.py`) and one callback stack
  (`graph/callbacks.py`) so every run is traced consistently.
- **Nodes in `graph/nodes/`** are the building blocks of the main incident
  graph. They write to the backend through `ah_agents/queries/*`, which are
  plain async functions decorated with the local `@tool` wrapper.
- **State lives in Postgres** via `AsyncPostgresSaver` (`graph/graph.py`); the
  thread_id is always `event_id`, so any webhook can resume the exact same run.

### Concrete walk-through: customer emails at 2 AM

1. `services/email_poller.py` (30 s loop, IMAP) finds a new message.
2. It calls `EmailTriageAgent.classify(...)` (`ah_agents/email_triage_agent.py`).
3. That façade `ainvoke`s `triage_graph` (`graph/subgraphs/triage.py`), which
   uses `graph/llm.py` → OpenAI chat completions, returns
   `{emergency_score, summary, …}`.
4. If the score crosses `EMERGENCY_SCORE_THRESHOLD`, the poller POSTs to the
   backend `POST /events/email` (internal-key auth). NestJS persists the event
   in Postgres and queues a Bull job.
5. The Bull worker (backend) calls `ai-service.client.ts` →
   `POST /escalate/orchestrated` (`ai-service/routes/escalate.py`).
6. The route delegates to `EscalationOrchestrator.process_event` →
   `orchestrator_graph` (`graph/subgraphs/orchestrator.py`), which fans out
   `voice_script_graph` + `sms_graph` in parallel.
7. The route returns the generated content; backend dials Twilio via its
   `escalation` module. The graph is now parked at `wait_for_ack`
   (`graph/nodes/wait_for_ack.py`, `interrupt_before`).
8. Tech presses **1** on the phone → Twilio webhook → backend → ai-service
   `routes/escalate.py` → resumes the same `event_id` thread → graph runs
   `response_interpreter` → `resolution` → posts `acknowledged` back to the
   backend → backend stops the Bull retries → frontend updates via Socket.io.
9. Every LLM call published a trace + spans to `POST /agent-tracking/traces`
   (`services/agent_tracking.py`), surfaced in the `/agent-tracking` UI.

### What each `ah_agents/*.py` file actually does

These are the "agent" files most people open first. They look like agents
because of their class names, but **none of them contain LLM calls anymore** —
every one of them is a thin façade over either a LangGraph sub-graph or a
plain HTTP call to the backend. The file is small on purpose: it preserves
the legacy class shape so existing routes keep working.

| File                          | Has LLM? | What it actually does                                                                                                                              | Calls into                              |
|-------------------------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------|
| `email_triage_agent.py`       | yes (delegated) | `EmailTriageAgent.classify(subject, body, sender_domain)` → scores email urgency 0–1, extracts location/equipment/safety flag.              | `graph/subgraphs/triage.py`             |
| `voice_agent.py`              | yes (delegated) | `VoiceAIAgent.generate_message(...)` writes the 35–50 word phone script; `generate_voicemail_script(...)` writes the shorter voicemail version. | `graph/subgraphs/voice_script.py`       |
| `sms_agent.py`                | yes (delegated) | `SmsAgent.generate_message(...)` writes the ≤160-char SMS sent to the on-call tech.                                                          | `graph/subgraphs/sms.py`                |
| `voicemail_analyzer_agent.py` | yes (delegated) | `VoicemailAnalyzerAgent.analyze(transcription, from_number)` scores a Dialpad voicemail + pulls context (location, equipment, callback #). | `graph/subgraphs/voicemail.py`          |
| `escalation_orchestrator.py`  | yes (delegated) | `EscalationOrchestrator.process_event(...)` runs triage → after-hours gate → parallel voice + SMS generation. The main entry from REST.    | `graph/subgraphs/orchestrator.py`       |
| **`ack_monitor_agent.py`**    | **no**   | Handles **tech acknowledgments**: `is_acknowledgment(msg)` keyword-checks an SMS body; `process_sms_ack` / `process_voice_ack` / `process_downgrade` resolve phone → user, find the active escalation, record the ACK, and downgrade if asked. Used by Twilio SMS + DTMF webhooks. | `ah_agents/queries/acknowledgment.py`   |
| **`escalation_agent.py`**     | **no**   | Backend-only ops: `get_escalation_ladder()` fetches the ladder, `start_escalation(event_id)` kicks off the Bull job on the backend. Used by routes that need to trigger escalation without re-running triage. | `ah_agents/queries/escalation.py`       |
| `queries/acknowledgment.py`   | no       | The actual HTTP calls to backend: `lookup_user_by_phone`, `find_active_escalation_for_user`, `record_internal_ack`, `downgrade_latest_owned_event`, `is_ack_message`. Each function is also exposed as a LangChain `BaseTool` via `.as_tool`. | NestJS REST (`backend/...`)             |
| `queries/escalation.py`       | no       | The actual HTTP calls for escalation ops: `get_current_rotation`, `get_escalation_contact`, `get_escalation_ladder`, `start_escalation`, `log_escalation_attempt`, `check_event_status`, `stop_escalation`. | NestJS REST (`backend/...`)             |
| `queries/__init__.py`         | no       | Defines the local `@tool` decorator that makes each query function callable both as a plain async function *and* as a LangChain `BaseTool` (via `.as_tool`).                                          | — (utility)                              |
| `__init__.py`                 | no       | Re-exports the wrapper classes + module functions + enums so callers can write `from ah_agents import EmailTriageAgent`.                                                                              | — (barrel)                               |

**Rule of thumb:**

- File names ending in `_agent.py` → call out to a LangGraph sub-graph
  (LLM work) or to the backend (ops work).
- `queries/*.py` → pure HTTP wrappers. No prompts, no scoring, no LLM.
- The "agent" abstraction is **only kept for backward compatibility** with
  routes/services that were written before the LangGraph migration. New
  code should call sub-graphs directly via
  `from graph.subgraphs import triage_graph` (etc.).

### Concrete walk-through: customer chat → escalation

1. Widget connects to `backend/src/customer-chat/customer-chat.gateway` (Socket.io).
2. Backend forwards each turn to `ai-service` (`routes/graph.py` →
   `post_event(kind=customer_chat_*)`).
3. Main `graph_app` runs `intake → customer_chat_dialog` (LLM dialog loop in
   `graph/nodes/customer_chat_dialog.py`).
4. When the dialog node returns `done=true`, the same graph falls through to
   `triage → after_hours_gate → …`, identical to the email path.
5. Customer-facing replies are sent back via
   `graph/nodes/customer_status_update.py` → backend → widget.

## API Surface (selected)

| Method | Path                              | Auth         |
|--------|-----------------------------------|--------------|
| POST   | `/auth/login`                     | public       |
| GET    | `/events`, `/events/:id`          | JWT          |
| POST   | `/events/email`, `/events/dialpad`| internal-key |
| POST   | `/escalation/start/:eventId`      | internal-key |
| POST   | `/acknowledgments`                | JWT          |
| POST   | `/internal/logs/batch`            | internal-key |
| POST   | `/classify/orchestrated` (AI)     | internal-key |
| POST   | `/escalate/orchestrated` (AI)     | internal-key |
| POST   | `/dialpad`, `/twilio/*` (AI)      | signed       |
| GET    | `/agent-tracking/dashboard`       | JWT          |
| POST   | `/agent-tracking/traces`          | internal-key |
| POST   | `/agent-tracking/backfill`        | JWT          |
| WS     | `/socket.io` (signaling) (AI)     | JWT          |

See [LLD.md §3](docs/architecture/LLD.md) for the full list.

## Logs

```bash
./logs.sh backend -f
./logs.sh ai -f
./logs.sh frontend -f
```

## License

Proprietary.
