# High-Level Design — After-Hours Escalation System

This document describes the system at a component level: the major services, the
external integrations they talk to, and how data flows between them. For module-,
class-, and table-level detail see [LLD.md](./LLD.md).

## 1. System Context

```mermaid
flowchart LR
    subgraph Users
        OnCall[On-call Engineer]
        Admin[Admin / Operator]
        Caller[External Caller]
        Sender[External Email Sender]
    end

    subgraph Platform[After-Hours Escalation Platform]
        FE[Frontend<br/>React + Vite<br/>:5175]
        BE[Backend API<br/>NestJS<br/>:3004]
        AI[AI Service<br/>FastAPI<br/>:8083]
        DB[(PostgreSQL<br/>:5434)]
        RDS[(Redis<br/>:6379)]
    end

    subgraph External[External Services]
        Twilio[Twilio<br/>Voice + SMS]
        Dialpad[Dialpad<br/>Inbound Calls + VM]
        M365[Microsoft 365<br/>IMAP + SMTP]
        OAI[OpenAI / Claude<br/>LLM APIs]
    end

    Admin -->|HTTPS| FE
    OnCall -->|HTTPS| FE
    FE <-->|REST + WebSocket| BE

    Sender -->|Email| M365
    Caller -->|PSTN| Dialpad

    AI <-->|IMAP/SMTP| M365
    AI <-->|REST| Twilio
    Dialpad -->|Webhook| AI
    Twilio -->|Status Webhooks| AI
    AI -->|LLM calls| OAI

    AI <-->|Internal HTTP<br/>x-internal-key| BE
    BE <--> DB
    BE <--> RDS

    Twilio -->|Voice + SMS| OnCall
    OnCall -->|DTMF / SMS reply| Twilio
```

## 2. Component Responsibilities

```mermaid
flowchart TB
    subgraph FE[Frontend - React]
        FEPages[Pages<br/>Login · Live · Events · EventDetail<br/>Metrics · Rotation · Alerts · Settings]
        FECtx[Contexts<br/>AuthContext · SocketContext]
    end

    subgraph BE[Backend - NestJS]
        BEHttp[HTTP Controllers<br/>auth · users · events · escalation<br/>acknowledgment · rotation · alerts<br/>settings · metrics · health]
        BEInt[Internal Controllers<br/>escalation.internal · logs · email-tracking]
        BEWs[WebSocket Gateway<br/>Socket.io rooms]
        BESvc[Domain Services<br/>EscalationService · EventsService<br/>AcknowledgmentService · RotationService<br/>MetricsService · AlertsService]
        BEPrisma[Prisma ORM]
    end

    subgraph AI[AI Service - FastAPI]
        AIRoutes[Routers<br/>classify · escalate · dialpad<br/>email · twilio_webhooks · health]
        AIAgents[Agents<br/>head · email_triage · voicemail_analyzer<br/>escalation_orchestrator · voice · sms<br/>escalation · ack_monitor · dialpad]
        AISvc[Services<br/>email_poller · email_service<br/>email_uid_tracker · twilio_service<br/>dialpad_service · voice_audio_store]
    end

    DB[(PostgreSQL)]
    RDS[(Redis<br/>Bull queue)]

    FE <--> BEHttp
    FE <-->|Socket.io| BEWs
    BEHttp --> BESvc
    BEInt --> BESvc
    BESvc --> BEPrisma
    BEPrisma --> DB
    BESvc --> RDS
    BESvc --> BEWs

    AIRoutes --> AIAgents
    AIRoutes --> AISvc
    AIAgents --> AISvc
    AISvc -->|REST<br/>x-internal-key| BEInt
```

## 3. Primary Data Flows

### 3.1 Inbound Email → Escalation → Acknowledgment

```mermaid
sequenceDiagram
    autonumber
    participant Sender
    participant M365 as Microsoft 365 (IMAP)
    participant Poller as email_poller
    participant Triage as email_triage_agent
    participant BE as Backend
    participant Orch as escalation_orchestrator
    participant Twilio
    participant OnCall as On-call Engineer
    participant FE as Live Dashboard

    Sender->>M365: Send email
    loop every 30s
        Poller->>M365: IMAP fetch unseen UIDs
        Poller->>BE: GET /email-tracking/processed-uids
        Poller->>Triage: classify(email)
        Triage-->>Poller: emergencyScore, context
        Poller->>BE: POST /events/email
        BE->>BE: persist Event (status=pending)
        BE-->>FE: ws emit event:new
        Poller->>BE: POST /email-tracking/mark-processed
    end
    Poller->>Orch: orchestrate(eventId)
    Orch->>BE: POST /escalation/start/:eventId
    BE->>BE: build ladder (rotation + contacts)
    loop ladder levels
        BE->>Twilio: place call + send SMS
        BE-->>FE: ws emit escalation:update
        Twilio->>OnCall: Voice + SMS
        OnCall->>Twilio: DTMF / SMS reply
        Twilio->>AI: POST /twilio/{call,sms}-status
        AI->>BE: POST /acknowledgment
        BE->>BE: Event.status = acknowledged
        BE-->>FE: ws emit acknowledgment:received
    end
```

### 3.2 Inbound Dialpad Call / Voicemail → Escalation

```mermaid
sequenceDiagram
    autonumber
    participant Caller
    participant Dialpad
    participant AI as AI Service
    participant VM as voicemail_analyzer
    participant BE as Backend
    participant Twilio
    participant OnCall

    Caller->>Dialpad: Inbound call (after hours)
    Dialpad->>Dialpad: Voicemail + transcribe
    Dialpad->>AI: POST /dialpad (signed webhook)
    AI->>VM: analyze(transcription)
    VM-->>AI: emergencyScore, reasoning
    AI->>BE: POST /events/dialpad
    BE->>BE: Event(source=dialpad, vm url + text)
    AI->>BE: POST /escalation/start/:eventId
    BE->>Twilio: ladder calls + SMS
    Twilio->>OnCall: ring + text
    OnCall->>Twilio: ack
    Twilio->>AI: status webhook
    AI->>BE: POST /acknowledgment
```

### 3.3 Live Dashboard Streaming

```mermaid
sequenceDiagram
    participant FE as Frontend (Live page)
    participant WS as Backend WS Gateway
    participant BE as Backend Services
    participant AI as AI Service Logger

    FE->>WS: connect (JWT)
    FE->>WS: subscribe(room)
    BE-->>WS: emit event:* / escalation:* / call:* / sms:*
    WS-->>FE: push updates
    AI->>BE: POST /internal/logs/batch (x-api-key)
    BE-->>WS: emit log:new
    WS-->>FE: push live log line
```

## 4. Deployment View

```mermaid
flowchart LR
    subgraph Host[Single Host - PM2 ecosystem.config.js]
        FEProc[frontend<br/>vite preview :5175]
        BEProc[backend<br/>node dist/main.js :3004]
        AIProc[ai-service<br/>uvicorn main:app :8083]
    end

    subgraph Data[Data Tier]
        PG[(PostgreSQL :5434)]
        RD[(Redis :6379)]
    end

    Internet((Internet))
    Internet -->|nginx reverse proxy| FEProc
    Internet -->|webhooks| AIProc
    FEProc --> BEProc
    BEProc --> PG
    BEProc --> RD
    AIProc --> BEProc
```

## 5. Cross-Cutting Concerns

| Concern         | Mechanism |
|-----------------|-----------|
| AuthN (UI)      | JWT (Passport `jwt` strategy), tokens in `localStorage` |
| AuthZ (UI)      | `RolesGuard` + `@Roles(...)` (admin / on_call / viewer) |
| AuthN (svc-svc) | `x-internal-key` / `INTERNAL_API_KEY` between AI service ↔ backend |
| Webhooks        | Twilio status callbacks, Dialpad signed JWT |
| Realtime        | Socket.io rooms emitted from domain services |
| Background work | Redis + Bull queue (escalation timers) |
| Process mgmt    | PM2 (`ecosystem.config.js`) |
| Observability   | Backend `/health`, `SystemHealthLog`, `AdminAlert`, log streaming to FE |
