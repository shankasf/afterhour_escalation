After-Hours Escalation System
============================

An after-hours escalation system for property/maintenance operations.

It ingests urgent requests from:
- Email (IMAP poller)
- Dialpad inbound calls (missed calls + voicemails)

It triages them using a multi-agent AI system (OpenAI Agents SDK) and escalates to the on-call ladder via:
- Twilio outbound voice calls
- Twilio SMS (also used for inbound ACK replies)

Key constraints (by design)
---------------------------

- Model lock: All AI agents use `gpt-5.2` (environment overrides are ignored if different).
- Dialpad is inbound voice only.
- Twilio is outbound voice + SMS (SMS replies are inbound for acknowledgments; inbound voice calls are rejected).
- Intended coverage window: 12:00 AM – 7:00 AM US/Eastern (America/New_York). The AI orchestrator can block escalations outside the window unless forced.

Table of Contents
-----------------

- [High-Level Architecture](#high-level-architecture)
- [Core Flows](#core-flows)
    - [Email Intake](#email-intake)
    - [Dialpad Inbound Calls + Voicemail](#dialpad-inbound-calls--voicemail)
    - [Escalation + Acknowledgment](#escalation--acknowledgment)
- [Services & Ports](#services--ports)
- [Configuration](#configuration)
    - [Shared](#shared)
    - [AI Service (FastAPI)](#ai-service-fastapi)
    - [Backend (NestJS)](#backend-nestjs)
    - [Twilio & Dialpad Webhook URLs](#twilio--dialpad-webhook-urls)
- [Running Locally](#running-locally)
    - [Docker Compose (recommended)](#docker-compose-recommended)
    - [Dev Mode (3 terminals)](#dev-mode-3-terminals)
- [Troubleshooting](#troubleshooting)

High-Level Architecture
-----------------------

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                    React + TypeScript + Tailwind                         │
│                         (Port 5175/80)                                   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│                      NestJS + Prisma + PostgreSQL                        │
│                          (Port 3004)                                     │
│                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  Events  │ │Escalation│ │ Rotation │ │   Auth   │ │  Alerts  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           AI SERVICE                                     │
│                FastAPI + Python + OpenAI Agents SDK                       │
│                          (Port 8083)                                     │
│                                                                          │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Classify │ │ Orchestrator  │ │  Voice   │ │   SMS    │ │  Email   │   │
│  │  Route   │ │ (multi-agent) │ │  Agent   │ │  Agent   │ │  Poller  │   │
│  └──────────┘ └──────────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  PostgreSQL │      │    Redis    │      │   Twilio    │
│  (Database) │      │   (Queue)   │      │ (Voice/SMS) │
└─────────────┘      └─────────────┘      └─────────────┘
```
Notes:
- Redis is included in `docker-compose.yml` for legacy/future use, but current backend/ai-service codepaths do not require Redis for core functionality.

Core Flows
----------

Email Intake
~~~~~~~~~~~

1. AI Service polls IMAP (default interval: 30 seconds).
2. New unread emails are triaged by the Email Triage agent (Agents SDK).
3. If the score meets threshold, AI Service creates an event in the backend (`/api/events/email`) using `x-internal-key`.
4. AI Service triggers the backend internal escalation start endpoint (`/api/escalation/start/:eventId`).
5. Backend escalates via Twilio (call + SMS) until acknowledged.

Dialpad Inbound Calls + Voicemail
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Dialpad is the system’s inbound phone entrypoint.

1. Dialpad sends call-event webhooks to AI Service (`POST /dialpad`).
2. AI Service parses the call state. For inbound calls, these states are actionable:
    - `missed`
    - `voicemail`
    - `voicemail_uploaded`
    - `transcription`
3. AI Service runs the multi-agent orchestrator on the voicemail transcription (if present).
4. AI Service posts a Dialpad event to the backend dashboard (`POST /api/events/dialpad`) using `x-internal-key`.

Escalation + Acknowledgment
~~~~~~~~~~~~~~~~~~~~~~~~~~

Escalation is executed by the backend’s ladder, using the AI Service as a “delivery + content generation” helper.

1. Backend selects the next contact (rotation + fixed contacts) and calls the AI Service (`POST /escalate`).
2. AI Service:
    - Generates a voice script (Voice AI agent) and an SMS message.
    - Places a Twilio outbound call and sends a Twilio SMS in parallel.
3. Acknowledgment options:
    - Voice: press `1` during the call (DTMF gather).
    - SMS: reply with `ACK`.
    - Optional: `DOWNGRADE` to mark a false alarm/non-emergency.
4. AI Service posts call/SMS status callbacks to backend internal endpoints for tracking.

Services & Ports
----------------

- Frontend (Vite build served via Nginx): `http://localhost:5175`
- Backend (NestJS): `http://localhost:3004`
  - Swagger: `http://localhost:3004/api/docs`
- AI Service (FastAPI): `http://localhost:8083`

Configuration
-------------

Shared
~~~~~~

- `INTERNAL_API_KEY`
  - Used for service-to-service calls.
  - Backend expects this key on internal endpoints.
  - AI Service uses it when posting to backend.

AI Service (FastAPI)
~~~~~~~~~~~~~~~~~~~

Required:

- `OPENAI_API_KEY`
- `BACKEND_URL` (e.g. `http://localhost:3004` or `http://backend:3004` in Docker)

Model behavior:

- `OPENAI_MODEL` exists but the AI agents are locked to `gpt-5.2` in code.

Twilio (outbound voice + SMS):

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WEBHOOK_URL` (public base URL where Twilio can reach `/twilio/*`)

Dialpad (inbound voice):

- `DIALPAD_API_KEY` (optional; only needed if you also fetch details via Dialpad API)
- `DIALPAD_WEBHOOK_SECRET` (recommended; used to verify JWT-encoded webhooks)

Email (IMAP/SMTP):

- `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_ENCRYPTION`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_ENCRYPTION`
- `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `ADMIN_EMAIL`

Backend (NestJS)
~~~~~~~~~~~~~~~

Required:

- `DATABASE_URL`
- `JWT_SECRET`
- `AI_SERVICE_URL` (e.g. `http://localhost:8083` or `http://ai-service:8083` in Docker)
- `INTERNAL_API_KEY`

Twilio is configured in the backend environment as well so the backend can render correct webhook URLs and track escalations.

Twilio & Dialpad Webhook URLs
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Twilio

- Voice (TwiML): `POST {TWILIO_WEBHOOK_URL}/voice`
- Voice gather (DTMF): `POST {TWILIO_WEBHOOK_URL}/voice/gather`
- Voice status callbacks: `POST {TWILIO_WEBHOOK_URL}/voice/status`
- SMS inbound (ACK replies): `POST {TWILIO_WEBHOOK_URL}/sms`
- SMS status callbacks: `POST {TWILIO_WEBHOOK_URL}/sms/status`

Dialpad

- Call event webhook: `POST http(s)://<ai-service-host>/dialpad`

Running Locally
---------------

Prerequisites
~~~~~~~~~~~~~

- Node.js 18+ (20+ recommended)
- Python 3.11+ (3.12 works)
- Docker + Docker Compose (recommended)

Docker Compose (recommended)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

1. Create your environment file:

```bash
cp .env.example .env
```

2. Start everything:

```bash
docker compose up -d --build
```

3. Backend API docs:

```text
http://localhost:3004/api/docs
```

Dev Mode (3 terminals)
~~~~~~~~~~~~~~~~~~~~~~

Terminal 1 (backend):

```bash
cd backend
npm install
npm run start:dev
```

Terminal 2 (ai-service):

```bash
cd ai-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8083
```

Terminal 3 (frontend):

```bash
cd frontend
npm install
npm run dev
```

Troubleshooting
---------------

AI service says “OpenAI API key not configured”
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Set `OPENAI_API_KEY` and restart the AI service.
- Without it, the system uses fallback/template behavior for some outputs.

Twilio calls/SMS are “simulated”
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Confirm `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` are set for the AI service.
- If credentials are missing, Twilio sending is disabled and the code returns simulated SIDs.

Dialpad webhook verification failing
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Set `DIALPAD_WEBHOOK_SECRET` to match the Dialpad event subscription secret.
- Dialpad webhooks are expected to arrive as JWT tokens.

Backend returns 401 on internal calls
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

- Ensure both backend and AI service share the same `INTERNAL_API_KEY`.
- Internal endpoints are protected with `x-internal-key`.

Where to look for logs
~~~~~~~~~~~~~~~~~~~~~~

- AI service logs: `logs/ai-service/`
- Backend logs: `logs/backend/`

### Quick Deploy

```bash
# Create .env file with your configuration
cp .env.example .env

# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f

# Check service status
docker compose ps
```

### Production Deployment with Caddy (HTTPS)

1. **Configure Caddy** (`/etc/caddy/Caddyfile`):
```
your-domain.com {
    # Frontend
    handle {
        reverse_proxy localhost:5175
    }
    
    # Backend API
    handle /api/* {
        reverse_proxy localhost:3004
    }
    
    # Twilio Webhooks
    handle /twilio/* {
        reverse_proxy localhost:8083
    }
}
```

2. **Set webhook URLs in .env:**
```env
WEBHOOK_BASE_URL=https://your-domain.com
TWILIO_WEBHOOK_URL=https://your-domain.com/twilio
```

3. **Deploy:**
```bash
docker compose up -d --build
sudo systemctl reload caddy
```

### Container Architecture

| Container | Port | Description |
|-----------|------|-------------|
| `escalation-frontend` | 5175:80 | React app served via Nginx |
| `escalation-backend` | 3004:3004 | NestJS API server |
| `escalation-ai-service` | 8083:8083 | FastAPI AI/Twilio service |
| `escalation-postgres` | 5434:5432 | PostgreSQL database |
| `escalation-redis` | 6380:6379 | Redis for queues |

## ⚙️ Configuration

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secure-jwt-secret

# OpenAI (Required for AI classification)
OPENAI_API_KEY=sk-your-openai-api-key
# Note: the AI service enforces gpt-5.2 (env overrides are ignored if different)
OPENAI_MODEL=gpt-5.2

# Twilio (Required for voice/SMS)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WEBHOOK_URL=https://your-domain.com/twilio

# Email (Gmail - REQUIRED)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

### Optional Environment Variables

```env
# Dialpad Integration
DIALPAD_API_KEY=your-dialpad-api-key
DIALPAD_WEBHOOK_SECRET=your-webhook-secret

# Emergency Detection (AI service uses 0.0-1.0 scoring)
EMERGENCY_SCORE_THRESHOLD=0.6

# Admin Notifications
ADMIN_EMAIL=admin@example.com
EMAIL_FROM_ADDRESS=escalations@your-domain.com
EMAIL_FROM_NAME=After-Hours Escalation System
```

## 📚 API Documentation

### Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User authentication |
| `GET` | `/api/auth/me` | Get current user |
| `GET` | `/api/events` | List events (filterable) |
| `GET` | `/api/events/:id` | Get event details |
| `POST` | `/api/events/:id/acknowledge` | Acknowledge event |
| `POST` | `/api/events/:id/resolve` | Resolve event |
| `GET` | `/api/rotation` | Get current rotation |
| `POST` | `/api/rotation` | Update rotation |
| `GET` | `/api/escalation/contacts` | List escalation contacts |
| `GET` | `/api/metrics/dashboard` | Dashboard metrics |
| `GET` | `/api/metrics/weekly` | Weekly statistics |
| `GET` | `/api/alerts` | List admin alerts |
| `GET` | `/api/health` | Health check |

### AI Service Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/classify` | Classify email for emergency |
| `POST` | `/escalate` | Initiate escalation (call + SMS) |
| `POST` | `/twilio/voice` | Twilio voice webhook |
| `POST` | `/twilio/voice/gather` | DTMF input handler |
| `POST` | `/twilio/sms` | Incoming SMS handler |
| `GET` | `/health` | Health check |

### Interactive Documentation

- **Swagger UI**: http://localhost:3004/api/docs
- **AI Service Docs**: http://localhost:8083/docs

## 🔄 Escalation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        EVENT RECEIVED                                │
│                   (Email or Dialpad webhook)                         │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AI CLASSIFICATION                                │
│     gpt-5.2 analyzes content and assigns emergency score (0.0-1.0)    │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    Score >= threshold               Score < threshold
   ┌───────────────┐              ┌───────────────┐
   │   EMERGENCY   │              │  NON-URGENT   │
   │  Escalation   │              │ Email-only    │
   └───────┬───────┘              │ notification  │
           │                      └───────────────┘
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ESCALATION LADDER                                 │
│                                                                      │
│   Contact 1 ──▶ Contact 2 ──▶ Contact 3 ──▶ ... ──▶ Contact 6       │
│   (90s wait)   (90s wait)    (90s wait)           (Admin Alert)      │
│                                                                      │
│   Each contact receives:                                             │
│   • Phone call with AI-generated voice message                       │
│   • SMS with event details and ACK instructions                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ACKNOWLEDGMENT                                   │
│                                                                      │
│   • Press 1 during call (DTMF)                                       │
│   • Reply "ACK" to SMS                                               │
│   • Click acknowledge in dashboard                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 📊 Dashboard Features

### Home Page
- Active events count
- Today's escalations statistics
- Current on-call status
- Recent events list

### Events Page
- Filterable event list (status, date range, source)
- Event details modal
- Acknowledge/resolve actions
- CSV export

### Rotation Page
- Current on-call schedule
- Primary and secondary contacts
- Easy rotation updates

### Alerts Page
- System health alerts
- Failed escalation notifications
- SLA breach warnings

### Settings Page
- Emergency threshold configuration
- Keyword management
- Integration settings

## 🔌 Integrations

### Twilio Setup

1. Create account at https://www.twilio.com
2. Purchase a phone number with Voice + SMS capabilities
3. Configure webhooks in Twilio Console:

| Webhook | URL |
|---------|-----|
| Voice URL | `https://your-domain.com/twilio/voice` |
| Voice Status | `https://your-domain.com/twilio/voice/status` |
| SMS URL | `https://your-domain.com/twilio/sms` |
| SMS Status | `https://your-domain.com/twilio/sms/status` |

> **Note**: Trial accounts can only call verified phone numbers. Upgrade to production for full functionality.

### Gmail Setup (Primary Email Provider)

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate an App Password**:
   - Go to [Google Account → Security → App Passwords](https://myaccount.google.com/apppasswords)
   - Select "Mail" and "Windows Computer" (or your device type)
   - Copy the generated 16-character password
3. **Configure IMAP/SMTP** in `.env`:
```env
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-16-char-app-password

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
```
4. **Test the connection** (optional):
```bash
openssl s_client -connect imap.gmail.com:993
```

### Dialpad Setup (Optional)

1. Get API key from Dialpad admin console
2. Configure webhook URL for missed calls/voicemails
3. Set in `.env`:
```env
DIALPAD_API_KEY=your-api-key
DIALPAD_WEBHOOK_SECRET=your-webhook-secret
```

## 🔐 Default Credentials

After running database seed:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | admin123 |

### Seeded Users

| Name | Role | Phone |
|------|------|-------|
| Primary On-Call | On-Call (Primary) | +15555550101 |
| Secondary On-Call | On-Call (Secondary) | +15555550102 |
| Fixed Contact 1 | Fixed Contact | - |
| Fixed Contact 2 | Fixed Contact | - |
| Fixed Contact 3 | Fixed Contact | - |

## 🔧 Troubleshooting

### Twilio Calls Not Working

1. **Check webhook accessibility**:
```bash
curl -I https://your-domain.com/twilio/voice
```

2. **Verify phone number format** (must be E.164):
```
+1234567890  ✓
1234567890   ✗
(123) 456-7890  ✗
```

3. **Check Twilio console** for error logs

4. **Trial account limitation**: Only verified numbers can receive calls

### Email Not Polling

1. **Verify Gmail App Password**:
   - Must be 16 characters (no spaces)
   - Generated from Account → Security → App Passwords
   - 2FA must be enabled on the account

2. **Test IMAP connection**:
```bash
openssl s_client -connect imap.gmail.com:993
```

3. **Check logs** for IMAP errors:
```bash
docker logs escalation-ai-service | grep -i imap
```

4. **Common issues**:
   - Using regular password instead of app password
   - 2FA not enabled
   - "Allow less secure apps" setting (for older Gmail accounts)

### AI Classification Issues

1. **Verify OpenAI API key**:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

2. **Check AI service health**:
```bash
curl http://localhost:8083/health
```

### Database Connection Issues

1. **Check PostgreSQL status**:
```bash
docker exec -it escalation-postgres pg_isready
```

2. **Run migrations**:
```bash
cd backend && npx prisma migrate deploy
```

### Container Issues

```bash
# View all container logs
docker compose logs -f

# Restart all services
docker compose restart

# Rebuild and restart
docker compose up -d --build --force-recreate
```

## 📝 Development

### Project Structure

```
afterhours_escalation/
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── contexts/       # React contexts
│   │   └── lib/            # Utilities
│   └── Dockerfile
├── backend/                # NestJS backend
│   ├── src/
│   │   ├── auth/           # Authentication
│   │   ├── events/         # Event management
│   │   ├── escalation/     # Escalation logic
│   │   ├── rotation/       # On-call rotation
│   │   └── websocket/      # Real-time updates
│   ├── prisma/             # Database schema
│   └── Dockerfile
├── ai-service/             # FastAPI AI service
│   ├── agents/             # AI agents
│   ├── routes/             # API routes
│   ├── services/           # External services
│   └── Dockerfile
├── docker-compose.yml
└── package.json
```

### Running Tests

```bash
# Backend tests
cd backend && npm test

# AI service tests
cd ai-service && pytest

# Frontend tests
cd frontend && npm test
```

### Database Management

```bash
# Generate Prisma client
cd backend && npx prisma generate

# Create migration
npx prisma migrate dev --name your_migration_name

# Apply migrations
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio

# Seed database
npx prisma db seed
```

## 📄 License

Proprietary - All rights reserved

## 👥 Support

For issues or questions, contact the development team or open an issue on GitHub.

---

Made with ❤️ for reliable after-hours emergency response
