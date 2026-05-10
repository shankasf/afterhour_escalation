# After-Hours Escalation System

AI-driven on-call escalation for property management. Watches email and Dialpad,
scores urgency with an LLM, and pages on-call staff via Twilio voice + SMS until
someone acknowledges. Includes in-browser WebRTC voice (OpenAI Realtime) and a
full agent-tracking / evaluation layer for trace observability.

## Architecture

- High-level diagrams: [docs/architecture/HLD.md](docs/architecture/HLD.md)
- Module / ERD / sequence detail: [docs/architecture/LLD.md](docs/architecture/LLD.md)

```
Frontend (React, :5175)  ──┐
                           ├── Backend (NestJS, :3004) ── PostgreSQL :5434, Redis :6379
AI Service (FastAPI, :8083)┘
                ↑                 ↑
        IMAP/SMTP, Dialpad,  internal x-api-key
        Twilio, OpenAI
```

## Stack

| Layer    | Tech                                                                 |
|----------|----------------------------------------------------------------------|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, Socket.io, WebRTC           |
| Backend  | NestJS 10, Prisma, PostgreSQL, Bull (Redis), Socket.io               |
| AI       | FastAPI, Pydantic, OpenAI Agents SDK, LangGraph, OpenAI Realtime API |
| External | Twilio (voice/SMS), Dialpad (inbound), Microsoft 365, LangSmith      |

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

## How It Works

1. **Email poller** fetches IMAP every 30s, dedupes via `ProcessedEmailUid`.
2. **Triage agent** scores urgency 0–1 and extracts context.
3. If score ≥ threshold and inside coverage window (00:00–07:00 ET), backend
   builds an escalation ladder from on-call rotation + fixed contacts.
4. **Twilio** places a call (DTMF “1” to ack) and an SMS (reply `ACK`) per level.
5. No ack within timeout → next level. All levels exhausted → `AdminAlert`.
6. Live dashboard streams logs and status via WebSocket.

Dialpad inbound calls follow the same path, starting from the voicemail
analyzer agent. Browser-initiated WebRTC calls use the same graph but tunnel
audio through the OpenAI Realtime API via the FastAPI signaling server.

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

## LangGraph Flow

The AI service is a single `StateGraph` (`ai-service/graph/graph.py`) over an
`IncidentState`, checkpointed in Postgres. The thread id is the event id, so
every inbound webhook (Twilio DTMF, SMS reply, customer chat message,
WebRTC `call_accepted`/`hangup`) resumes the same graph from where it parked.

**Three entry shapes feed one graph:**
- **Email** — `email_poller` (IMAP, 30s) → `post_event(kind=email_received)`
- **Customer chat** — widget WS → `post_event(kind=customer_chat_*)` — runs a
  conversational `customer_chat_dialog` loop before joining the escalation path
- **Manual / API** — `POST /escalate/orchestrated` from backend Bull jobs

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

    done -- "stop escalation" --> tell_done["tell customer:<br/>tech is on it"]
    exhausted -- "alert admin" --> tell_done

    tell_blocked --> END_a([end])
    tell_done --> END_done([end])

    classDef terminal fill:#eee,stroke:#888,stroke-dasharray:3 3;
    classDef park fill:#fff4d6,stroke:#c79100;
    classDef llm fill:#e8f1ff,stroke:#1d4ed8;
    classDef tech fill:#fde2e2,stroke:#b91c1c;
    classDef cust fill:#dcfce7,stroke:#15803d;
    class START,END_chat,END_closed,END_a,END_done terminal;
    class park park;
    class triage,interpret,chat llm;
    class planner,outreach,park,interpret,wait_cb,done,exhausted,next_tech tech;
    class chat,tell_blocked,tell_done cust;
```

The graph pauses at **wait for tech reply** (`interrupt_before` in code) until
a webhook (Twilio DTMF, SMS reply, or WebRTC accept) wakes it up.

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
