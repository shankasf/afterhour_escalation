# LLD — After-Hours Escalation

## Modules

```mermaid
flowchart LR
    subgraph Backend[Backend NestJS]
        auth --> users
        events --> escalation --> acknowledgment
        escalation --> rotation
        alerts
        metrics
        settings
        ws[WebSocket Gateway]
    end

    subgraph AI[AI Service FastAPI]
        poller[email_poller] --> triage[email_triage]
        dialpad_route[dialpad route] --> vm[voicemail_analyzer]
        triage --> orch[escalation_orchestrator]
        vm --> orch
        orch --> twilio[twilio_service]
    end

    AI -->|x-internal-key| Backend
    Backend --> Prisma --> DB[(Postgres)]
    Backend --> ws
```

## Schema

```mermaid
erDiagram
    User ||--o{ OnCallRotation : "on-call"
    User ||--o{ EscalationContact : "ladder"
    Event ||--o{ EscalationLog : "attempts"
    Event ||--o{ Acknowledgment : "ack"
    Event ||--o{ AdminAlert : "alerts"
    EscalationContact ||--o{ EscalationLog : "targeted"

    User { uuid id string email string phone enum role }
    Event { uuid id enum source string subject float emergencyScore enum status }
    EscalationLog { uuid id int attempt enum callStatus enum smsStatus bool ackReceived }
    OnCallRotation { uuid id date startDate date endDate uuid primaryUserId uuid secondaryUserId }
    EscalationContact { uuid id int position enum type bool isActive }
    Acknowledgment { uuid id enum method datetime acknowledgedAt }
    AdminAlert { uuid id enum alertType bool resolved }
```

## Event lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> escalated
    pending --> downgraded
    escalated --> acknowledged
    escalated --> missed
    acknowledged --> [*]
    missed --> [*]
    downgraded --> [*]
```

## Key files

| Concern             | Path                                                        |
|---------------------|-------------------------------------------------------------|
| Backend entry       | `backend/src/main.ts`                                       |
| Prisma schema       | `backend/prisma/schema.prisma`                              |
| Escalation logic    | `backend/src/escalation/escalation.service.ts`              |
| WebSocket gateway   | `backend/src/websocket/websocket.gateway.ts`                |
| AI entry            | `ai-service/main.py`                                        |
| Email poller        | `ai-service/services/email_poller.py`                       |
| Triage agent        | `ai-service/ah_agents/email_triage_agent.py`                |
| Orchestrator        | `ai-service/ah_agents/escalation_orchestrator.py`           |
| Twilio              | `ai-service/services/twilio_service.py`                     |
| Frontend root       | `frontend/src/App.tsx`                                      |
