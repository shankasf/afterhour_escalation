# Low-Level Design — After-Hours Escalation System

Module-, route-, and table-level detail. Pair with [HLD.md](./HLD.md) for the
component-level picture.

## 1. Backend (NestJS) Module Map

```mermaid
flowchart TB
    AppModule --> Auth
    AppModule --> Users
    AppModule --> Events
    AppModule --> Escalation
    AppModule --> Acknowledgment
    AppModule --> Rotation
    AppModule --> Alerts
    AppModule --> Settings
    AppModule --> Metrics
    AppModule --> Health
    AppModule --> Logs
    AppModule --> EmailTracking[Email-Tracking]
    AppModule --> AIClient[AI-Service Client]
    AppModule --> WS[WebSocket Gateway]
    AppModule --> Prisma[Prisma Module]

    Auth -->|JwtStrategy<br/>RolesGuard| Users
    Events --> Prisma
    Events --> WS
    Escalation --> Prisma
    Escalation --> WS
    Escalation --> AIClient
    Escalation --> Acknowledgment
    Escalation --> Rotation
    Acknowledgment --> Prisma
    Acknowledgment --> WS
    Rotation --> Prisma
    Alerts --> Prisma
    Alerts --> WS
    Metrics --> Prisma
    Logs --> WS
    EmailTracking --> Prisma
```

## 2. AI Service (FastAPI) Module Map

```mermaid
flowchart TB
    Main[main.py / FastAPI app] --> R1[routes/health]
    Main --> R2[routes/classify]
    Main --> R3[routes/escalate]
    Main --> R4[routes/dialpad]
    Main --> R5[routes/email]
    Main --> R6[routes/twilio_webhooks]

    R2 --> A1[email_triage_agent]
    R2 --> A2[escalation_orchestrator]
    R3 --> A3[voice_agent]
    R3 --> A4[sms_agent]
    R3 --> A5[escalation_agent]
    R4 --> A6[voicemail_analyzer_agent]
    R4 --> A7[dialpad_agent]
    R6 --> A8[ack_monitor_agent]

    subgraph Services
        S1[email_poller]
        S2[email_service<br/>IMAP/SMTP]
        S3[email_uid_tracker]
        S4[twilio_service]
        S5[dialpad_service]
        S6[http_client<br/>backend calls]
        S7[websocket_log_handler]
        S8[voice_audio_store]
    end

    S1 --> S2
    S1 --> S3
    S1 --> A1
    S1 --> S6
    A2 --> S6
    A3 --> S4
    A4 --> S4
    A5 --> S4
    A5 --> S6
    A8 --> S6
    R4 --> S5

    Container[container.py<br/>DI container] -.provides.-> Services
    Container -.provides.-> A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8
```

## 3. HTTP API Surface (selected)

| Service  | Method + Path                            | Purpose                                      | Auth         |
|----------|------------------------------------------|----------------------------------------------|--------------|
| Backend  | `POST /auth/login`                       | Issue JWT                                    | public       |
| Backend  | `GET  /auth/me`                          | Current user                                 | JWT          |
| Backend  | `GET  /events`                           | List events (filter, paginate)               | JWT          |
| Backend  | `POST /events/email`                     | AI service creates email event               | internal-key |
| Backend  | `POST /events/dialpad`                   | AI service creates Dialpad event             | internal-key |
| Backend  | `GET  /escalation/active`                | Active escalations                           | JWT          |
| Backend  | `POST /escalation/:eventId/start`        | Start ladder (manual)                        | JWT (admin)  |
| Backend  | `POST /escalation/start/:eventId`        | Start ladder (AI service)                    | internal-key |
| Backend  | `POST /escalation/call-status`           | Twilio call status relay                     | internal-key |
| Backend  | `POST /escalation/sms-status`            | Twilio SMS status relay                      | internal-key |
| Backend  | `POST /acknowledgments`                  | User-side ack                                | JWT          |
| Backend  | `POST /acknowledgment`                   | AI-service-side ack                          | internal-key |
| Backend  | `GET  /rotation/current`                 | Current on-call                              | JWT          |
| Backend  | `GET  /metrics/dashboard`                | KPIs                                         | JWT          |
| Backend  | `POST /internal/logs/batch`              | AI service log ingest                        | internal-key |
| AI svc   | `POST /classify/orchestrated`            | Multi-agent triage                           | internal-key |
| AI svc   | `POST /escalate/orchestrated`            | Run escalation ladder                        | internal-key |
| AI svc   | `POST /dialpad`                          | Dialpad webhook                              | signed JWT   |
| AI svc   | `POST /twilio/call-status`               | Twilio call webhook                          | Twilio sig   |
| AI svc   | `POST /twilio/sms-status`                | Twilio SMS webhook                           | Twilio sig   |

## 4. Database Schema (ERD)

```mermaid
erDiagram
    User ||--o{ OnCallRotation : "primary/secondary"
    User ||--o{ EscalationContact : "has"
    User ||--o{ EscalationLog : "attempted"
    User ||--o{ Acknowledgment : "ack-by"
    User ||--o{ Event : "acknowledged-by"

    Event ||--o{ EscalationLog : "produces"
    Event ||--o{ Acknowledgment : "receives"
    Event ||--o{ AdminAlert : "raises"

    EscalationContact ||--o{ EscalationLog : "targeted"

    User {
        uuid id PK
        string email
        string name
        string phoneNumber
        enum role "admin|on_call|viewer"
        bool isActive
        string passwordHash
    }

    Event {
        uuid id PK
        enum source "email|dialpad"
        string subject
        text body
        string senderEmail
        string senderDomain
        string senderPhone
        float emergencyScore
        text aiSummary
        json extractedContext
        enum status "pending|escalated|acknowledged|downgraded|missed|closed"
        datetime receivedAt
        text voicemailTranscription
        string voicemailUrl
        json escalationLadderSnapshot
    }

    EscalationLog {
        uuid id PK
        uuid eventId FK
        uuid contactId FK
        uuid userId FK
        int attemptNumber
        string callSid
        enum callStatus
        string smsSid
        enum smsStatus
        bool acknowledgmentReceived
        datetime acknowledgedAt
        text errorMessage
    }

    OnCallRotation {
        uuid id PK
        datetime startDate
        datetime endDate
        uuid primaryUserId FK
        uuid secondaryUserId FK
    }

    EscalationContact {
        uuid id PK
        uuid userId FK
        int position
        enum contactType "primary|secondary|fixed"
        bool isActive
    }

    Acknowledgment {
        uuid id PK
        uuid eventId FK
        uuid userId FK
        enum method "sms|call"
        datetime acknowledgedAt
        text notes
        text downgradeReason
    }

    AdminAlert {
        uuid id PK
        uuid eventId FK
        enum alertType
        text message
        json details
        bool resolved
        datetime resolvedAt
        uuid resolvedBy
    }

    SystemSetting { string key PK string value text description }
    EmergencyKeyword { uuid id PK string keyword int weight string category bool isNegative bool isActive }
    DailyMetric { date date PK int totalEvents int emailEvents int dialpadEvents int escalatedEvents int acknowledgedEvents int missedEvents float avgResponseTimeSeconds float slaComplianceRate }
    SystemHealthLog { uuid id PK string service string status int responseTimeMs text errorMessage datetime checkedAt }
    EmailPollingStatus { uuid id PK datetime lastPollAt datetime lastSuccessAt int messagesProcessed int errorsCount text lastError string status }
    ProcessedEmailUid { string uid PK datetime processedAt }
    EscalationLadderConfig { uuid id PK int level string role uuid userId int timeoutSeconds bool isRotation bool isActive }
```

## 5. Event State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: Event created
    pending --> escalated: ladder started
    pending --> downgraded: AI score < threshold
    escalated --> acknowledged: SMS reply / DTMF
    escalated --> missed: ladder exhausted
    acknowledged --> closed: resolved
    missed --> closed: admin closes
    downgraded --> closed
    closed --> [*]
```

## 6. Escalation Ladder Algorithm

```mermaid
flowchart TD
    Start([POST /escalation/start/:eventId]) --> Build[Build ladder snapshot:<br/>OnCallRotation.primary →<br/>OnCallRotation.secondary →<br/>EscalationContact.position ASC<br/>+ EscalationLadderConfig fixed contacts]
    Build --> Persist[Persist snapshot to<br/>Event.escalationLadderSnapshot]
    Persist --> Loop{For each level}
    Loop --> Place[Twilio: place call<br/>+ send SMS]
    Place --> Log[Insert EscalationLog<br/>callStatus, smsStatus]
    Log --> Wait[Wait timeoutSeconds<br/>Bull queued job]
    Wait --> Check{Ack received?<br/>callStatus=answered+DTMF<br/>or smsStatus=delivered+reply}
    Check -->|yes| Ack[Mark Event acknowledged<br/>Insert Acknowledgment<br/>Stop ladder]
    Check -->|no| Next{More levels?}
    Next -->|yes| Loop
    Next -->|no| Miss[Mark Event missed<br/>Raise AdminAlert<br/>type=no_acknowledgment]
    Ack --> WS1[ws emit acknowledgment:received]
    Miss --> WS2[ws emit alert:new]
```

## 7. Email Ingestion Pipeline

```mermaid
flowchart LR
    A[email_poller<br/>30s tick] --> B[email_service.fetch_unseen<br/>IMAP last 24h NY tz]
    B --> C[email_uid_tracker<br/>filter processed UIDs]
    C --> D{any new?}
    D -->|no| A
    D -->|yes| E[email_triage_agent<br/>OpenAI / Claude]
    E --> F{score >= threshold<br/>and after-hours?}
    F -->|no| G[backend POST /events/email<br/>status=downgraded]
    F -->|yes| H[backend POST /events/email<br/>status=pending]
    H --> I[escalation_orchestrator]
    I --> J[backend POST /escalation/start/:eventId]
    G --> K[mark UID processed]
    J --> K
```

## 8. Frontend Page → API Map

```mermaid
flowchart LR
    Login[Login.tsx] -->|POST /auth/login| BE
    Live[Live.tsx] -->|GET /escalation/active<br/>+ ws subscribe log,event,escalation,call,sms,ack,metrics| BE
    Events[Events.tsx] -->|GET /events<br/>GET /events/export| BE
    Detail[EventDetail.tsx] -->|GET /events/:id<br/>GET /escalation/:eventId/logs<br/>POST /events/:id/downgrade| BE
    Metrics[Metrics.tsx] -->|GET /metrics/dashboard<br/>GET /metrics/comprehensive<br/>GET /metrics/sla| BE
    Rotation[Rotation.tsx] -->|GET/POST/PUT/DELETE /rotation| BE
    Alerts[Alerts.tsx] -->|GET /alerts<br/>PUT /alerts/:id/resolve| BE
    Settings[Settings.tsx] -->|GET/POST/PUT /settings<br/>GET/POST/PUT/DELETE /settings/keywords| BE

    AuthCtx[AuthContext] -.attaches Bearer JWT.- BE
    SocketCtx[SocketContext] -.io with JWT.- BE
```

## 9. WebSocket Channels

| Event name              | Emitter                          | Consumer (page)            |
|-------------------------|----------------------------------|----------------------------|
| `log:new`               | `LogsController` (AI svc relay)  | Live                       |
| `event:new`             | `EventsService.create*`          | Live, Events               |
| `event:update`          | `EventsService.updateStatus`     | Live, Events, EventDetail  |
| `escalation:update`     | `EscalationService` (each level) | Live, EventDetail          |
| `call:update`           | `EscalationService` (Twilio cb)  | Live                       |
| `sms:update`            | `EscalationService` (Twilio cb)  | Live                       |
| `acknowledgment:received` | `AcknowledgmentService.create` | Live, EventDetail          |
| `alert:new`             | `AlertsService.create`           | Live, Alerts               |
| `health:update`         | `HealthService` periodic         | Live                       |
| `metrics:live`          | `MetricsService` periodic        | Live, Metrics              |

## 10. Auth & Authorization

```mermaid
sequenceDiagram
    participant FE
    participant Auth as AuthController
    participant Users as UsersService
    participant JWT as JwtService
    participant Guard as JwtAuthGuard
    participant Roles as RolesGuard

    FE->>Auth: POST /auth/login {email,password}
    Auth->>Users: findByEmail
    Users-->>Auth: User row
    Auth->>Auth: bcrypt.compare(password, hash)
    Auth->>JWT: sign({sub: user.id, role})
    JWT-->>Auth: token
    Auth-->>FE: {access_token, user}

    FE->>Guard: Authorization: Bearer <jwt>
    Guard->>JWT: verify
    JWT-->>Guard: payload {sub, role}
    Guard->>Roles: check @Roles(admin|on_call|viewer)
    Roles-->>Guard: allow / deny
    Guard-->>FE: 200 / 403
```

## 11. Internal Service-to-Service Auth

```mermaid
flowchart LR
    AI[AI Service]
    BE[Backend]
    AI -->|"x-internal-key: $INTERNAL_API_KEY"| BE
    BE -->|InternalKeyGuard validates header| Handlers[/internal/* + /escalation/start /events/email .../]
```

## 12. File Pointers

| Concern                   | Path                                                            |
|---------------------------|-----------------------------------------------------------------|
| Backend bootstrap         | `backend/src/main.ts`                                           |
| Root module               | `backend/src/app.module.ts`                                     |
| JWT strategy              | `backend/src/auth/jwt.strategy.ts`                              |
| Internal API guard        | `backend/src/common/` (InternalKeyGuard)                        |
| Prisma schema             | `backend/prisma/schema.prisma`                                  |
| Escalation orchestration  | `backend/src/escalation/escalation.service.ts`                  |
| Internal escalation API   | `backend/src/escalation/escalation.internal.controller.ts`      |
| WebSocket gateway         | `backend/src/websocket/websocket.gateway.ts`                    |
| AI svc bootstrap          | `ai-service/main.py`                                            |
| DI container              | `ai-service/container.py`                                       |
| Email poller              | `ai-service/services/email_poller.py`                           |
| IMAP/SMTP                 | `ai-service/services/email_service.py`                          |
| Twilio integration        | `ai-service/services/twilio_service.py`                         |
| Dialpad webhook           | `ai-service/routes/dialpad.py`                                  |
| Triage agent              | `ai-service/ah_agents/email_triage_agent.py`                    |
| Orchestrator              | `ai-service/ah_agents/escalation_orchestrator.py`               |
| Frontend root             | `frontend/src/App.tsx`                                          |
| Auth context              | `frontend/src/contexts/AuthContext.tsx`                         |
| Socket context            | `frontend/src/contexts/SocketContext.tsx`                       |
| PM2 process config        | `ecosystem.config.js`                                           |
