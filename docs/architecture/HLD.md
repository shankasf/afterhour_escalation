# HLD — After-Hours Escalation

```mermaid
flowchart LR
    User[On-call / Admin]
    Caller[External Caller]
    Sender[Email Sender]

    FE[Frontend<br/>React :5175]
    BE[Backend<br/>NestJS :3004]
    AI[AI Service<br/>FastAPI :8083]
    DB[(PostgreSQL)]

    Twilio
    Dialpad
    M365[M365 IMAP/SMTP]
    LLM[OpenAI]

    User --> FE <--> BE
    Sender --> M365 --> AI
    Caller --> Dialpad --> AI
    AI --> LLM
    AI <--> BE --> DB
    BE --> Twilio --> User
```

**Flow:** email/voicemail → AI scores urgency → backend builds escalation ladder
from on-call rotation → Twilio calls + SMS until DTMF/SMS ack → status streams
to the live dashboard over WebSocket.

See [LLD.md](./LLD.md) for modules and schema.
