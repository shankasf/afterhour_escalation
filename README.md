# After-Hours Escalation System

AI-driven on-call escalation for property management. Watches email and Dialpad,
scores urgency with an LLM, and pages on-call staff via Twilio voice + SMS until
someone acknowledges.

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

| Layer    | Tech                                                   |
|----------|--------------------------------------------------------|
| Frontend | React 18, Vite, TypeScript, TailwindCSS, Socket.io     |
| Backend  | NestJS 10, Prisma, PostgreSQL, Bull (Redis), Socket.io |
| AI       | FastAPI, Pydantic, OpenAI Agents SDK                   |
| External | Twilio (voice/SMS), Dialpad (inbound), Microsoft 365   |

## Quick Start

```bash
cp .env.example .env          # fill in credentials
cd backend && npm i && npx prisma generate && npx prisma db push
cd ../ai-service && pip install -r requirements.txt
cd ../frontend && npm i

# run all three under PM2
pm2 start ecosystem.config.js
```

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
analyzer agent.

## LangGraph Flow

The AI service is a single `StateGraph` (`ai-service/graph/graph.py`) over an
`IncidentState`, checkpointed in Postgres. Solid arrows are unconditional
edges; dashed arrows are conditional routes keyed off `state.status` /
`state.source` / `triage.decision`.

```mermaid
flowchart TD
    START([START]) --> intake
    intake -. source==chat .-> customer_chat_dialog
    intake -. else .-> triage
    customer_chat_dialog -. triage.decision==escalate .-> triage
    customer_chat_dialog -. else .-> END1([END])
    triage --> after_hours_gate
    after_hours_gate -. in window .-> rotation_planner
    after_hours_gate -. after_hours_blocked .-> customer_status_update
    after_hours_gate -. closed .-> END2([END])
    rotation_planner --> outreach
    outreach -. exhausted .-> exhaustion
    outreach -. else .-> wait_for_ack
    wait_for_ack -->|interrupt_before| response_interpreter
    response_interpreter -. acknowledged .-> resolution
    response_interpreter -. awaiting_callback .-> callback_handler
    response_interpreter -. exhausted .-> exhaustion
    response_interpreter -. outreach .-> outreach
    response_interpreter -. else .-> wait_for_ack
    callback_handler --> customer_callback
    customer_callback --> wait_for_ack
    resolution --> customer_status_update
    exhaustion --> customer_status_update
    customer_status_update --> END3([END])

    classDef terminal fill:#eee,stroke:#888,stroke-dasharray:3 3;
    class START,END1,END2,END3 terminal;
```

### Node responsibilities

| Node                     | What it does                                                                 |
|--------------------------|------------------------------------------------------------------------------|
| `intake`                 | Normalizes the inbound event (email / Dialpad / chat) into `IncidentState`.  |
| `triage`                 | LLM scores urgency 0–1, sets `triage.decision = escalate / ignore`.          |
| `customer_chat_dialog`   | Two-way chat turn with the customer; may escalate or end the run.            |
| `after_hours_gate`       | Checks coverage window; routes to ladder, customer update, or close.         |
| `rotation_planner`       | Builds the escalation ladder from on-call rotation + fixed contacts.         |
| `outreach`               | Places Twilio call + SMS for the current ladder level.                       |
| `wait_for_ack`           | `interrupt_before` pause — graph suspends until an ack/callback webhook.     |
| `response_interpreter`   | Reads webhook result; decides ack, callback, retry, advance, or exhaust.     |
| `callback_handler`       | Records an on-call callback promise and schedules the customer callback.     |
| `customer_callback`      | Calls the customer back, then re-enters `wait_for_ack`.                      |
| `resolution`             | Marks incident acknowledged and prepares the closing customer message.       |
| `exhaustion`             | All levels failed — creates `AdminAlert` and prepares failure message.       |
| `customer_status_update` | Sends the final SMS/email to the customer and terminates the run.            |

### Lifecycle

```mermaid
flowchart LR
    A[FastAPI startup<br/>main.py lifespan] --> B[init_graph]
    B --> C{DATABASE_URL?}
    C -- yes --> D[AsyncPostgresSaver<br/>+ setup]
    C -- no --> E[MemorySaver]
    D --> F[build_graph<br/>StateGraph.compile]
    E --> F
    F --> G[get_graph used by<br/>/classify/orchestrated<br/>/escalate/orchestrated<br/>/twilio/* /dialpad webhooks]
    G --> H[FastAPI shutdown] --> I[close_graph]
```

## Project Layout

```
backend/      NestJS API + Prisma schema (backend/prisma/schema.prisma)
ai-service/   FastAPI agents, email/Twilio/Dialpad services
frontend/     React dashboard (Live, Events, Metrics, Rotation, Settings)
docs/         HLD/LLD architecture
ecosystem.config.js   PM2 process definitions
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

See [LLD.md §3](docs/architecture/LLD.md) for the full list.

## Logs

```bash
./logs.sh backend -f
./logs.sh ai -f
./logs.sh frontend -f
```

## License

Proprietary.
