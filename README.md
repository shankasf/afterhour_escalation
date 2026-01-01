# 🚨 After-Hours Escalation System

A comprehensive after-hours maintenance escalation system that ingests service requests from email and missed calls/voicemails, evaluates whether they constitute emergencies using AI, and escalates to on-call staff via phone and SMS until someone acknowledges.

![License](https://img.shields.io/badge/license-Proprietary-red)
![Node](https://img.shields.io/badge/node-20+-green)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![Docker](https://img.shields.io/badge/docker-ready-blue)

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Docker Deployment](#-docker-deployment)
- [Configuration](#-configuration)
- [API Documentation](#-api-documentation)
- [Escalation Flow](#-escalation-flow)
- [Dashboard Features](#-dashboard-features)
- [Integrations](#-integrations)
- [Troubleshooting](#-troubleshooting)

## 🚀 Features

### Core Capabilities
- **Multi-channel Intake**: Email (Gmail IMAP), Dialpad voicemail/missed calls
- **AI-Powered Classification**: GPT-4o based emergency scoring with intelligent context extraction
- **Smart Escalation**: Automated phone + SMS escalation with configurable ladder
- **On-Call Rotation**: Weekly rotation management with primary/secondary contacts
- **Real-time Dashboard**: Live event tracking with WebSocket updates
- **SLA Monitoring**: Track acknowledgment times and compliance metrics
- **Admin Alerts**: Email + SMS notifications for failures and SLA breaches

### Escalation Features
- Simultaneous call + SMS delivery for maximum reach
- DTMF acknowledgment (press 1 to acknowledge)
- SMS reply acknowledgment ("ACK" keyword)
- Configurable timeout between escalation levels
- Automatic escalation to next contact on no response
- Admin alerts when all contacts exhausted

## 🏗️ Architecture

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
│                      FastAPI + Python + OpenAI                           │
│                          (Port 8083)                                     │
│                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Classify │ │Escalation│ │  Voice   │ │   SMS    │ │  Email   │       │
│  │  Agent   │ │  Agent   │ │  Agent   │ │  Agent   │ │  Triage  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
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

## 📦 Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Recharts |
| **Backend** | NestJS 10, Prisma ORM, PostgreSQL 15 |
| **AI Service** | FastAPI, Python 3.11, OpenAI GPT-4o |
| **Queue** | Redis 7, BullMQ |
| **Telephony** | Twilio (Voice + SMS), Dialpad (optional) |
| **Email** | Gmail IMAP/SMTP |
| **Deployment** | Docker, Docker Compose, Nginx |

## 🛠️ Quick Start

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (recommended)

### Local Development Setup

1. **Clone the repository:**
```bash
git clone https://github.com/shankasf/afterhour_escalation.git
cd afterhour_escalation
```

2. **Install dependencies:**
```bash
# Root dependencies
npm install

# Frontend
cd frontend && npm install && cd ..

# Backend
cd backend && npm install && cd ..

# AI Service
cd ai-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Start infrastructure:**
```bash
docker compose up -d postgres redis
```

5. **Run database migrations:**
```bash
cd backend
npx prisma migrate deploy
npx prisma db seed
cd ..
```

6. **Start all services:**
```bash
npm run dev
```

Services will be available at:
- Frontend: http://localhost:5175
- Backend: http://localhost:3004
- AI Service: http://localhost:8083
- API Docs: http://localhost:3004/api/docs

## 🐳 Docker Deployment

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
OPENAI_MODEL=gpt-4o

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

# Emergency Detection
EMERGENCY_THRESHOLD=80

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
│         GPT-4o analyzes content and assigns emergency score          │
│                        (0-100 scale)                                 │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
     Score >= 80                      Score < 80
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
| Jordan | On-Call (Primary) | +18453884267 |
| Christina | On-Call (Secondary) | +16508552762 |
| Matt Mehler | Fixed Contact | - |
| Karina Blondet | Fixed Contact | - |
| Katelyn Badger | Fixed Contact | - |

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
