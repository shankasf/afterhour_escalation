# After-Hours Escalation System

A production-grade, AI-powered emergency escalation system designed for property management and maintenance operations. The system automatically monitors communication channels during off-hours, intelligently classifies incoming requests using AI, and escalates urgent issues through a configurable contact ladder until someone acknowledges and takes ownership.

---

## Table of Contents

1. [Glossary of Technical Terms](#glossary-of-technical-terms)
2. [System Overview](#system-overview)
3. [Architecture](#architecture)
   - [High-Level Architecture](#high-level-architecture)
   - [Architectural Principles](#architectural-principles)
   - [Component Details](#component-details)
4. [Core Workflows](#core-workflows)
   - [Email Intake Flow](#email-intake-flow)
   - [Dialpad Inbound Call Flow](#dialpad-inbound-call-flow)
   - [Escalation Flow](#escalation-flow)
   - [Acknowledgment Flow](#acknowledgment-flow)
5. [Technology Stack](#technology-stack)
6. [Project Structure](#project-structure)
7. [Database Schema](#database-schema)
8. [Configuration](#configuration)
9. [Installation & Setup](#installation--setup)
10. [API Reference](#api-reference)
11. [Integrations](#integrations)
12. [Troubleshooting](#troubleshooting)
13. [Development Guide](#development-guide)
14. [Recent Changes](#recent-changes-v110)

---

## Glossary of Technical Terms

Understanding these terms will help you navigate the documentation and codebase effectively.

### General Concepts

| Term | Definition |
|------|------------|
| **Escalation** | The process of progressively contacting people in a predefined order until someone acknowledges an emergency |
| **Escalation Ladder** | An ordered list of contacts to call during an escalation, typically starting with on-call staff and progressing to management |
| **On-Call Rotation** | A schedule that defines who is primarily and secondarily responsible for responding to emergencies during a given time period |
| **Acknowledgment (ACK)** | Confirmation from a contact that they have received the alert and will take ownership of the issue |
| **Triage** | The process of evaluating and prioritizing incoming requests based on urgency |
| **Emergency Score** | A numerical value (0.0 to 1.0) assigned by AI indicating how urgent a request is |
| **Coverage Window** | The time period during which the system actively escalates (default: 12:00 AM - 7:00 AM EST) |

### Technical Terms

| Term | Definition |
|------|------------|
| **API (Application Programming Interface)** | A set of rules that allows different software applications to communicate with each other |
| **REST API** | A standardized way to build web APIs using HTTP methods (GET, POST, PUT, DELETE) |
| **Webhook** | An automated message sent from one application to another when a specific event occurs |
| **JWT (JSON Web Token)** | A compact, URL-safe token format used for securely transmitting information for authentication |
| **WebSocket** | A communication protocol that provides full-duplex (two-way) communication channels over a single TCP connection |
| **IMAP (Internet Message Access Protocol)** | A protocol for retrieving emails from a mail server |
| **SMTP (Simple Mail Transfer Protocol)** | A protocol for sending emails |
| **TwiML (Twilio Markup Language)** | XML-based language used to instruct Twilio on how to handle phone calls |
| **DTMF (Dual-Tone Multi-Frequency)** | The signal generated when you press a phone keypad button (used for "Press 1 to acknowledge") |
| **SID (String Identifier)** | A unique identifier used by Twilio for calls, messages, and other resources |
| **E.164** | International phone number format (e.g., +14155551234) |

### Architecture Terms

| Term | Definition |
|------|------------|
| **Microservices** | An architectural style where an application is composed of small, independent services |
| **Monorepo** | A single repository containing multiple related projects |
| **ORM (Object-Relational Mapping)** | A technique that lets you interact with databases using object-oriented programming |
| **Repository Pattern** | A design pattern that abstracts data access logic, separating it from business logic |
| **Dependency Injection (DI)** | A technique where objects receive their dependencies from external sources rather than creating them |
| **Circuit Breaker** | A design pattern that prevents cascading failures by stopping requests to a failing service |
| **Exponential Backoff** | A strategy where retry delays increase exponentially after each failure |
| **Loose Coupling** | A design principle where components have minimal dependencies on each other |
| **High Cohesion** | A design principle where related functionality is grouped together in a single module |
| **Singleton** | A design pattern that ensures only one instance of a class exists |

### Framework & Library Terms

| Term | Definition |
|------|------------|
| **NestJS** | A progressive Node.js framework for building efficient, scalable server-side applications |
| **FastAPI** | A modern, high-performance Python web framework for building APIs |
| **Prisma** | A next-generation ORM for Node.js and TypeScript |
| **React** | A JavaScript library for building user interfaces |
| **TypeScript** | A typed superset of JavaScript that compiles to plain JavaScript |
| **Pydantic** | A Python library for data validation using type annotations |
| **OpenAI Agents SDK** | A framework for building AI agents that can use tools and make decisions |

### Database Terms

| Term | Definition |
|------|------------|
| **PostgreSQL** | An open-source relational database management system |
| **Migration** | A version-controlled change to a database schema |
| **Schema** | The structure of a database including tables, columns, and relationships |
| **Foreign Key** | A column that references the primary key of another table, creating a relationship |
| **Index** | A data structure that improves the speed of data retrieval operations |
| **UUID (Universally Unique Identifier)** | A 128-bit identifier that is unique across all systems |

---

## System Overview

### What This System Does

The After-Hours Escalation System provides automated emergency response for property management operations during off-hours. It:

1. **Monitors Multiple Channels**: Continuously watches email inboxes and phone systems for incoming requests
2. **Classifies Urgency**: Uses AI to analyze incoming messages and assign an emergency score
3. **Escalates Automatically**: When urgency exceeds a threshold, initiates phone calls and SMS to on-call personnel
4. **Tracks Responses**: Monitors for acknowledgments and progresses through the contact ladder if needed
5. **Provides Visibility**: Offers a real-time dashboard for monitoring active incidents and system health

### Key Design Constraints

| Constraint | Description |
|------------|-------------|
| **AI Model Lock** | All AI agents use `gpt-5.2` exclusively (environment overrides are ignored) |
| **Dialpad = Inbound Only** | Dialpad integration handles missed calls and voicemails; outbound is via Twilio |
| **Twilio = Outbound Only** | Twilio handles outbound voice calls and SMS; inbound SMS is for acknowledgment replies |
| **Coverage Window** | Default: 12:00 AM - 7:00 AM US/Eastern. Escalations outside this window are blocked unless forced |
| **Acknowledgment Timeout** | 120 seconds default wait time before escalating to next contact |

---

## Architecture

### High-Level Architecture

```
                                    ┌─────────────────────────────┐
                                    │        EXTERNAL USERS        │
                                    │   (Tenants, Contractors)     │
                                    └──────────────┬──────────────┘
                                                   │
                        ┌──────────────────────────┼──────────────────────────┐
                        │                          │                          │
                        ▼                          ▼                          ▼
              ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
              │     EMAIL       │       │    DIALPAD      │       │    MANUAL       │
              │   (IMAP Poll)   │       │   (Webhooks)    │       │  (Dashboard)    │
              └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
                       │                         │                         │
                       └─────────────────────────┼─────────────────────────┘
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                     AI SERVICE                                          │
│                            FastAPI + Python + OpenAI Agents SDK                         │
│                                      (Port 8083)                                        │
│                                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │  Email Poller   │  │   Orchestrator  │  │   Triage Agent  │  │  Message Agent  │   │
│  │  (30s interval) │  │  (Multi-Agent)  │  │  (Scoring 0-1)  │  │ (Voice/SMS Gen) │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
│                                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                        │
│  │  Twilio Service │  │ Dialpad Service │  │  HTTP Client    │                        │
│  │ (Calls + SMS)   │  │  (Webhooks)     │  │ (Circuit Break) │                        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                        │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                     BACKEND                                             │
│                            NestJS + Prisma + PostgreSQL                                 │
│                                     (Port 3004)                                         │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                            SERVICE LAYER                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │   Events    │  │ Escalation  │  │  Rotation   │  │   Alerts    │            │   │
│  │  │  Service    │  │ Coordinator │  │  Service    │  │  Service    │            │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │   │
│  │                                                                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │   │
│  │  │   Ladder    │  │   Status    │  │    ACK      │  │  Settings   │            │   │
│  │  │  Builder    │  │  Tracker    │  │  Handler    │  │  Service    │            │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           REPOSITORY LAYER                                       │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │   │
│  │  │  Event Repository│  │Escalation Repo   │  │ Email Tracking   │              │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                        │
│  │   WebSocket     │  │  App Config     │  │    Auth/JWT     │                        │
│  │   Gateway       │  │   Service       │  │    Guards       │                        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                        │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    FRONTEND                                             │
│                          React + TypeScript + TailwindCSS                               │
│                                    (Port 5175)                                          │
│                                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Dashboard  │  │   Events    │  │  Rotation   │  │   Alerts    │  │  Settings   │  │
│  │    Page     │  │    Page     │  │    Page     │  │    Page     │  │    Page     │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   PostgreSQL    │       │     Twilio      │       │     Gmail       │
│   (Database)    │       │  (Voice/SMS)    │       │   (IMAP/SMTP)   │
│   Port 5432     │       │   External API  │       │  External API   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

### Architectural Principles

This system was designed following these core software architecture principles:

#### 1. Separation of Concerns
Each component has a distinct responsibility:
- **AI Service**: Handles all AI/ML operations, external communication (Twilio, email)
- **Backend**: Manages business logic, data persistence, authentication
- **Frontend**: Provides user interface and real-time updates

#### 2. Modularity
The system is broken into small, interchangeable components:
- Backend has 11 distinct NestJS modules (Auth, Events, Escalation, Rotation, etc.)
- AI Service has specialized agents for different tasks (Triage, Voice, SMS)
- Each module can be modified independently

#### 3. Loose Coupling
Components have minimal dependencies on each other:
- **Repository Pattern**: Services don't directly access the database; they use repository interfaces
- **Dependency Injection**: Both NestJS (backend) and Python (AI service) use DI containers
- **HTTP-based Communication**: Services communicate via well-defined REST APIs

#### 4. High Cohesion
Related functionality is grouped together:
- The original `EscalationService` was split into focused components:
  - `LadderBuilderService`: Builds escalation contact lists
  - `StatusTrackerService`: Tracks call/SMS delivery status
  - `AcknowledgmentHandlerService`: Processes acknowledgments
  - `EscalationCoordinatorService`: Orchestrates the workflow

#### 5. Reliability
The system is designed to handle failures gracefully:
- **Circuit Breaker**: Prevents cascading failures when external services are down
- **Exponential Backoff**: Retries failed requests with increasing delays
- **Database-backed Tracking**: Email UIDs stored in database instead of files

#### 6. Flexibility
Configuration is data-driven, not hard-coded:
- **Database Escalation Ladder**: Contact order stored in database, changeable without code deployment
- **Centralized Configuration**: Single source of truth for all settings
- **Feature Flags**: Enable/disable features via environment variables

### Component Details

#### Backend Services (NestJS)

| Service | Responsibility |
|---------|----------------|
| `EventsService` | Creates and manages events from emails/calls |
| `EscalationCoordinatorService` | Orchestrates the escalation workflow |
| `LadderBuilderService` | Constructs the escalation contact ladder |
| `LadderConfigService` | Manages database-driven ladder configuration |
| `StatusTrackerService` | Tracks call/SMS status updates from Twilio |
| `AcknowledgmentHandlerService` | Processes acknowledgments (DTMF, SMS, dashboard) |
| `RotationService` | Manages on-call rotation schedules |
| `AlertsService` | Creates and manages admin alerts |
| `SettingsService` | Manages system configuration |
| `AppConfigService` | Centralized configuration management |

#### Backend Repositories

| Repository | Purpose |
|------------|---------|
| `EventRepository` | Data access for events (findById, create, update) |
| `EscalationRepository` | Data access for escalation logs and contacts |
| `EmailTrackingService` | Tracks processed email UIDs in database |

#### AI Service Components (FastAPI)

All AI agents follow the OpenAI Agents SDK pattern:
```python
from agents import Agent, Runner

agent = Agent(name="...", instructions="...", model="gpt-5.2")
result = await Runner.run(agent, prompt)
```

| Component | Responsibility |
|-----------|----------------|
| `EscalationOrchestrator` | Coordinates multi-agent AI workflow |
| `EmailTriageAgent` | Classifies emails and assigns emergency scores (0-1) |
| `VoiceAIAgent` | Generates voice call scripts (35-50 words) |
| `SmsAgent` | Generates SMS messages (<160 characters) |
| `VoicemailAnalyzerAgent` | Analyzes Dialpad voicemail transcripts |
| `AckMonitorAgent` | Handles acknowledgment processing |
| `DialpadAgent` | Processes Dialpad webhook events |
| `EscalationAgent` | Manages escalation lifecycle |
| `EmailPoller` | Polls IMAP for new emails every 30 seconds |
| `TwilioService` | Makes outbound calls and sends SMS |
| `DialpadService` | Processes incoming Dialpad webhooks |
| `ResilientHttpClient` | HTTP client with retry and circuit breaker |
| `EmailUidTracker` | Database-backed email deduplication |

---

## Core Workflows

### Email Intake Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. EMAIL POLLER (every 30 seconds)                                           │
│    AI Service polls IMAP server for unread emails from last 24 hours         │
│    - Connects to Gmail via IMAP (port 993, SSL)                              │
│    - Filters to NY timezone for consistent date handling                      │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. DEDUPLICATION CHECK                                                        │
│    EmailUidTracker checks if email UID already processed                      │
│    - Queries PostgreSQL database (not file-based)                            │
│    - Prevents duplicate processing on restarts                                │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. AI TRIAGE                                                                  │
│    EmailTriageAgent analyzes email content                                    │
│    - Uses gpt-5.2 with structured output (Pydantic models)                   │
│    - Assigns emergency_score (0.0 to 1.0)                                    │
│    - Extracts context: location, equipment, priority                          │
│    - Falls back to keyword matching if OpenAI unavailable                    │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
                 ▼                                         ▼
    ┌─────────────────────────┐             ┌─────────────────────────┐
    │ Score >= 0.6 (threshold)│             │ Score < 0.6             │
    │ → CREATE EVENT          │             │ → LOG AND SKIP          │
    │ → TRIGGER ESCALATION    │             │   (no action needed)    │
    └────────────┬────────────┘             └─────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. EVENT CREATION                                                             │
│    POST /api/events/email (with x-internal-key header)                        │
│    - Backend creates Event record in PostgreSQL                               │
│    - Stores: subject, body, sender, score, AI summary, extracted context     │
│    - Emits WebSocket event for real-time dashboard update                    │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. ESCALATION START                                                           │
│    POST /api/escalation/start/:eventId                                        │
│    - Backend builds escalation ladder (from database config)                  │
│    - Saves ladder snapshot to event record                                    │
│    - Begins contacting first person in ladder                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Dialpad Inbound Call Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. DIALPAD WEBHOOK                                                            │
│    Dialpad sends POST /dialpad with JWT-encoded payload                       │
│    - Contains: call_id, from_number, state, transcription (if voicemail)     │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. JWT VERIFICATION                                                           │
│    DialpadService verifies webhook signature                                  │
│    - Uses DIALPAD_WEBHOOK_SECRET to validate                                  │
│    - Rejects tampered or invalid webhooks                                     │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. STATE PARSING                                                              │
│    Check call state for actionable events:                                    │
│    - "missed" → Missed call, HIGH priority                                   │
│    - "voicemail" → Voicemail left, analyze transcription                     │
│    - "voicemail_uploaded" → Audio available                                  │
│    - "transcription" → Text transcription ready                              │
│    - Other states (ringing, answered) → Ignored                              │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. AI ANALYSIS (if transcription available)                                   │
│    VoicemailAnalyzerAgent processes transcription                             │
│    - Extracts: issue summary, location, urgency indicators                   │
│    - Dialpad events always escalate (someone called after hours)             │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. EVENT CREATION                                                             │
│    POST /api/events/dialpad (with x-internal-key header)                      │
│    - Creates Event with source=dialpad, status=escalated                      │
│    - Stores: phone number, transcription, voicemail URL                       │
│    - Triggers immediate escalation                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Escalation Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. BUILD ESCALATION LADDER                                                    │
│    LadderBuilderService constructs contact list                               │
│    - Level 1-2: Primary/Secondary from current on-call rotation              │
│    - Level 3+: Fixed contacts from EscalationLadderConfig table              │
│    - Ladder saved to event.escalationLadderSnapshot                          │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. CONTACT CURRENT LEVEL                                                      │
│    EscalationCoordinatorService initiates contact                             │
│    - Creates EscalationLog record (tracks attempts)                           │
│    - Calls AI Service: POST /escalate                                         │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. AI SERVICE GENERATES CONTENT                                               │
│    VoiceAIAgent + SmsAgent create messages                                    │
│                                                                               │
│    Voice Script (35-40 words):                                                │
│    "After-hours emergency received at 2:30 AM. Water leak reported at        │
│    Building A, third floor. Requires immediate attention.                     │
│    Press 1 to acknowledge and take ownership."                                │
│                                                                               │
│    SMS (<160 chars):                                                          │
│    "After-Hours Emergency - Water leak at Building A at 2:30 AM.             │
│    Reply ACK to accept."                                                      │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. TWILIO OUTREACH (parallel)                                                 │
│    TwilioService sends call + SMS simultaneously                              │
│                                                                               │
│    VOICE CALL:                                                                │
│    - Twilio calls contact's phone number                                      │
│    - Plays TwiML-generated voice message                                      │
│    - Listens for DTMF (keypad press "1")                                     │
│    - 30-second timeout to answer                                              │
│                                                                               │
│    SMS:                                                                       │
│    - Sends message with event summary                                         │
│    - Includes "Reply ACK to accept" instruction                              │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. WAIT FOR ACKNOWLEDGMENT                                                    │
│    StatusTrackerService monitors responses                                    │
│    - Timeout: 120 seconds (configurable)                                      │
│    - Receives Twilio status callbacks                                         │
└─────────────────────────────────────┬────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
                    ▼                                   ▼
       ┌────────────────────────┐          ┌────────────────────────┐
       │  ACK RECEIVED          │          │  NO ACK / CALL FAILED  │
       │  → Stop escalation     │          │  → Advance to next     │
       │  → Update event status │          │     contact in ladder  │
       │  → Notify dashboard    │          │  → Repeat from step 2  │
       └────────────────────────┘          └────────────────────────┘
                                                       │
                                                       ▼
                                      ┌────────────────────────────┐
                                      │  ALL CONTACTS EXHAUSTED    │
                                      │  → Create AdminAlert       │
                                      │  → Mark event as "missed"  │
                                      │  → Notify admin via email  │
                                      └────────────────────────────┘
```

### Acknowledgment Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        THREE WAYS TO ACKNOWLEDGE                         │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ OPTION 1: VOICE CALL (DTMF)                                                   │
│                                                                               │
│ 1. Contact answers Twilio call                                                │
│ 2. AI-generated voice message plays                                           │
│ 3. Prompt: "Press 1 to acknowledge and take ownership"                       │
│ 4. Contact presses "1" on phone keypad                                       │
│ 5. Twilio sends webhook: POST /twilio/voice/gather                           │
│ 6. AI Service extracts digits, posts to backend                               │
│ 7. AcknowledgmentHandlerService processes ACK                                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ OPTION 2: SMS REPLY                                                           │
│                                                                               │
│ 1. Contact receives SMS with event details                                    │
│ 2. Contact replies with "ACK" (or "ACKNOWLEDGE")                             │
│ 3. Twilio sends webhook: POST /twilio/sms                                     │
│ 4. AI Service parses reply, matches to event                                  │
│ 5. Posts acknowledgment to backend                                            │
│                                                                               │
│ Optional: Reply "DOWNGRADE" to mark as false alarm                           │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ OPTION 3: DASHBOARD                                                           │
│                                                                               │
│ 1. On-call person logs into web dashboard                                     │
│ 2. Views active event in Events page                                          │
│ 3. Clicks "Acknowledge" button                                                │
│ 4. Frontend sends: POST /api/events/:id/acknowledge                           │
│ 5. Backend processes, updates event status                                    │
│ 6. WebSocket broadcasts update to all connected clients                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend (NestJS)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 18+ | JavaScript runtime |
| **NestJS** | 10.x | Progressive Node.js framework with dependency injection |
| **TypeScript** | 5.x | Type-safe JavaScript superset |
| **Prisma** | 5.x | Next-generation ORM for database access |
| **PostgreSQL** | 15 | Relational database |
| **Socket.io** | 4.x | Real-time WebSocket communication |
| **Passport** | 0.6.x | Authentication middleware |
| **JWT** | - | Token-based authentication |
| **Helmet** | 7.x | Security headers middleware |
| **class-validator** | - | Request validation with decorators |

### AI Service (FastAPI)

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.11+ | Programming language |
| **FastAPI** | 0.100+ | High-performance async web framework |
| **Pydantic** | 2.x | Data validation using Python type hints |
| **OpenAI Agents SDK** | Latest | Multi-agent AI orchestration |
| **httpx** | 0.24+ | Async HTTP client |
| **Twilio SDK** | 8.x | Voice calls and SMS |
| **IMAPLib** | Built-in | Email retrieval |
| **PyJWT** | 2.x | JWT token handling |

### Frontend (React)

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.x | UI component library |
| **TypeScript** | 5.x | Type-safe JavaScript |
| **Vite** | 5.x | Fast build tool and dev server |
| **TailwindCSS** | 3.x | Utility-first CSS framework |
| **React Router** | 6.x | Client-side routing |
| **React Query** | 5.x | Server state management |
| **Socket.io Client** | 4.x | Real-time updates |
| **Axios** | 1.x | HTTP client |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| **Docker** | Containerization |
| **Docker Compose** | Multi-container orchestration |
| **Nginx** | Frontend reverse proxy |
| **Caddy** | HTTPS reverse proxy (production) |

---

## Project Structure

```
afterhours_escalation/
│
├── backend/                           # NestJS Backend Service
│   ├── src/
│   │   ├── common/                    # Shared utilities
│   │   │   ├── config/
│   │   │   │   ├── app-config.module.ts
│   │   │   │   └── app-config.service.ts    # Centralized configuration
│   │   │   ├── repositories/
│   │   │   │   └── base.repository.ts       # Base repository interface
│   │   │   └── types/
│   │   │       └── event.types.ts           # Typed interfaces for JSON fields
│   │   │
│   │   ├── auth/                      # Authentication module
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── jwt.strategy.ts
│   │   │   └── roles.guard.ts
│   │   │
│   │   ├── events/                    # Event management module
│   │   │   ├── repositories/
│   │   │   │   ├── event.repository.interface.ts
│   │   │   │   └── event.repository.ts      # Data access abstraction
│   │   │   ├── events.controller.ts
│   │   │   ├── events.service.ts
│   │   │   └── events.module.ts
│   │   │
│   │   ├── escalation/                # Escalation module (refactored)
│   │   │   ├── repositories/
│   │   │   │   ├── escalation.repository.interface.ts
│   │   │   │   └── escalation.repository.ts
│   │   │   ├── services/
│   │   │   │   ├── ladder-builder.service.ts      # Builds contact ladder
│   │   │   │   ├── ladder-config.service.ts       # DB-driven ladder config
│   │   │   │   ├── status-tracker.service.ts      # Tracks call/SMS status
│   │   │   │   ├── acknowledgment-handler.service.ts
│   │   │   │   └── escalation-coordinator.service.ts  # Main orchestrator
│   │   │   ├── escalation.controller.ts
│   │   │   ├── escalation.service.ts          # Legacy (backward compat)
│   │   │   └── escalation.module.ts
│   │   │
│   │   ├── email-tracking/            # Email UID tracking (database-backed)
│   │   │   ├── email-tracking.controller.ts
│   │   │   ├── email-tracking.service.ts
│   │   │   └── email-tracking.module.ts
│   │   │
│   │   ├── rotation/                  # On-call rotation module
│   │   ├── alerts/                    # Admin alerts module
│   │   ├── settings/                  # System settings module
│   │   ├── metrics/                   # Dashboard metrics module
│   │   ├── health/                    # Health check module
│   │   ├── websocket/                 # WebSocket gateway
│   │   ├── ai-service/                # AI service HTTP client
│   │   ├── prisma/                    # Prisma service
│   │   │
│   │   ├── app.module.ts              # Root module
│   │   └── main.ts                    # Application entry point
│   │
│   ├── prisma/
│   │   └── schema.prisma              # Database schema definition
│   │
│   ├── package.json
│   └── Dockerfile
│
├── ai-service/                        # FastAPI AI Service
│   ├── ah_agents/                     # AI Agents (OpenAI Agents SDK pattern)
│   │   ├── __init__.py                # Public exports
│   │   ├── email_triage_agent.py      # Email classification (AI + keyword fallback)
│   │   ├── voice_agent.py             # Voice script generation
│   │   ├── sms_agent.py               # SMS message generation
│   │   ├── voicemail_analyzer_agent.py # Voicemail transcript analysis
│   │   ├── ack_monitor_agent.py       # Acknowledgment handling
│   │   ├── dialpad_agent.py           # Dialpad event processing
│   │   ├── escalation_agent.py        # Escalation management
│   │   ├── escalation_orchestrator.py # Multi-agent coordinator
│   │   └── agent_tools.py             # @function_tool decorated tools
│   │
│   ├── services/                      # External service integrations
│   │   ├── twilio_service.py          # Twilio calls/SMS
│   │   ├── email_service.py           # IMAP/SMTP operations
│   │   ├── email_poller.py            # Background email polling
│   │   ├── email_uid_tracker.py       # Database-backed UID tracking
│   │   ├── dialpad_service.py         # Dialpad webhook handling
│   │   ├── http_client.py             # Resilient HTTP with circuit breaker
│   │   └── after_hours.py             # Coverage window logic
│   │
│   ├── routes/                        # API route handlers
│   │   ├── classify.py                # Classification endpoints
│   │   ├── escalate.py                # Escalation endpoints
│   │   ├── dialpad.py                 # Dialpad webhooks
│   │   ├── twilio_webhooks.py         # Twilio webhooks
│   │   ├── email.py                   # Email endpoints
│   │   └── health.py                  # Health check
│   │
│   ├── container.py                   # Dependency injection container
│   ├── config.py                      # Settings (Pydantic)
│   ├── main.py                        # FastAPI application
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                          # React Frontend
│   ├── src/
│   │   ├── components/                # Reusable UI components
│   │   ├── pages/                     # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Events.tsx
│   │   │   ├── EventDetail.tsx
│   │   │   ├── Rotation.tsx
│   │   │   ├── Alerts.tsx
│   │   │   └── Settings.tsx
│   │   ├── contexts/                  # React contexts
│   │   │   ├── AuthContext.tsx        # JWT authentication
│   │   │   └── SocketContext.tsx      # WebSocket connection
│   │   ├── lib/                       # Utilities
│   │   └── main.tsx                   # Entry point
│   │
│   ├── package.json
│   └── Dockerfile
│
├── docker-compose.yml                 # Container orchestration
├── .env                               # Environment variables
├── .env.example                       # Example environment file
└── README.md                          # This file
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE SCHEMA                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│      User        │       │  OnCallRotation  │       │ EscalationContact│
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (UUID, PK)    │←──────│ primaryUserId    │       │ id (UUID, PK)    │
│ name             │←──────│ secondaryUserId  │       │ userId (FK)      │──→
│ email (unique)   │       │ startDate        │       │ position         │
│ passwordHash     │       │ endDate          │       │ contactType      │
│ phoneNumber      │       │ createdAt        │       │ isActive         │
│ role             │       │ updatedAt        │       │ createdAt        │
│ isActive         │       └──────────────────┘       │ updatedAt        │
│ createdAt        │                                  └──────────────────┘
│ updatedAt        │                                           │
└──────────────────┘                                           │
         │                                                     │
         │                                                     ▼
         │        ┌──────────────────┐             ┌──────────────────┐
         │        │      Event       │             │  EscalationLog   │
         │        ├──────────────────┤             ├──────────────────┤
         │        │ id (UUID, PK)    │←────────────│ eventId (FK)     │
         └───────→│ acknowledgedById │             │ contactId (FK)   │──→
                  │ source           │             │ userId (FK)      │──→
                  │ subject          │             │ attemptNumber    │
                  │ body             │             │ callSid          │
                  │ aiSummary        │             │ callStatus       │
                  │ senderEmail      │             │ smsSid           │
                  │ senderPhone      │             │ smsStatus        │
                  │ receivedAt       │             │ ackReceived      │
                  │ emergencyScore   │             │ acknowledgedAt   │
                  │ extractedContext │             │ errorMessage     │
                  │ status           │             │ createdAt        │
                  │ escalationLadder │             └──────────────────┘
                  │ voicemailUrl     │
                  │ createdAt        │
                  │ updatedAt        │
                  └──────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Acknowledgment  │ │   AdminAlert     │ │  DailyMetric     │
├──────────────────┤ ├──────────────────┤ ├──────────────────┤
│ id (UUID, PK)    │ │ id (UUID, PK)    │ │ id (UUID, PK)    │
│ eventId (FK)     │ │ eventId (FK)     │ │ date (unique)    │
│ userId (FK)      │ │ alertType        │ │ totalEvents      │
│ method           │ │ message          │ │ emailEvents      │
│ acknowledgedAt   │ │ details          │ │ dialpadEvents    │
│ notes            │ │ resolved         │ │ escalatedEvents  │
│ downgradeReason  │ │ resolvedAt       │ │ acknowledgedEvts │
│ createdAt        │ │ resolvedById     │ │ missedEvents     │
└──────────────────┘ │ createdAt        │ │ avgResponseTime  │
                     └──────────────────┘ │ slaCompliance    │
                                          │ createdAt        │
                                          └──────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  SystemSetting   │ │ EmergencyKeyword │ │ProcessedEmailUid │
├──────────────────┤ ├──────────────────┤ ├──────────────────┤
│ id (UUID, PK)    │ │ id (UUID, PK)    │ │ id (UUID, PK)    │
│ key (unique)     │ │ keyword          │ │ uid (unique)     │
│ value            │ │ weight           │ │ processedAt      │
│ description      │ │ category         │ │ createdAt        │
│ updatedById (FK) │ │ isNegative       │ └──────────────────┘
│ createdAt        │ │ isActive         │
│ updatedAt        │ │ createdAt        │
└──────────────────┘ │ updatedAt        │
                     └──────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                    EscalationLadderConfig (NEW)                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ id (UUID, PK)                                                                 │
│ level (unique)          # Position in ladder (1, 2, 3...)                    │
│ role                    # Display name ("Primary On-Call", "Manager")         │
│ userId (FK, optional)   # Linked user for fixed contacts                      │
│ timeoutSeconds          # How long to wait before next contact (default 120) │
│ isRotation              # True if filled from rotation schedule               │
│ isActive                # Can be disabled without deletion                    │
│ createdAt               │
│ updatedAt               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Key Enums

```typescript
// Event Source
enum EventSource {
  email    // From email inbox
  dialpad  // From Dialpad call/voicemail
}

// Event Status
enum EventStatus {
  pending       // Created, not yet classified
  escalated     // Actively being escalated
  acknowledged  // Someone took ownership
  downgraded    // Marked as non-emergency
  missed        // All contacts exhausted
  closed        // Resolved
}

// Contact Type
enum ContactType {
  primary    // Primary on-call (from rotation)
  secondary  // Secondary on-call (from rotation)
  fixed      // Fixed contact (always in ladder)
}

// Call Status
enum CallStatus {
  not_called  // Not yet attempted
  ringing     // Call in progress
  answered    // Call connected
  failed      // Call failed
  no_answer   // Timed out
  busy        // Busy signal
}

// SMS Status
enum SmsStatus {
  not_sent   // Not yet attempted
  sent       // Sent to carrier
  delivered  // Delivered to device
  failed     // Delivery failed
}

// Alert Type
enum AlertType {
  email_ingestion_failure
  dialpad_webhook_failure
  call_failure
  sms_failure
  no_acknowledgment
  system_health
}
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# ============================================================================
# DATABASE
# ============================================================================
DATABASE_URL="postgresql://user:password@host:5432/database"
# Individual components (used by some services)
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=escalation
DB_HOST=localhost
DB_PORT=5432

# ============================================================================
# AUTHENTICATION
# ============================================================================
JWT_SECRET="your-secure-random-string-at-least-32-chars"
JWT_EXPIRATION="7d"
INTERNAL_API_KEY="shared-key-for-service-to-service-auth"

# ============================================================================
# SERVICE URLS
# ============================================================================
BACKEND_URL="http://localhost:3004"
AI_SERVICE_URL="http://localhost:8083"
FRONTEND_URL="http://localhost:5175"
WEBHOOK_BASE_URL="https://your-public-domain.com"

# ============================================================================
# PORTS
# ============================================================================
BACKEND_PORT=3004
AI_SERVICE_PORT=8083
FRONTEND_PORT=5175

# ============================================================================
# OPENAI (Required for AI classification)
# ============================================================================
OPENAI_API_KEY="sk-your-openai-api-key"
# Note: Model is locked to gpt-5.2 in code

# ============================================================================
# TWILIO (Required for voice/SMS)
# ============================================================================
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_PHONE_NUMBER="+14155551234"
TWILIO_WEBHOOK_URL="https://your-domain.com/twilio"

# ============================================================================
# GMAIL (Required for email monitoring)
# ============================================================================
IMAP_HOST="imap.gmail.com"
IMAP_PORT=993
IMAP_USER="your-email@gmail.com"
IMAP_PASSWORD="your-16-char-app-password"
IMAP_ENCRYPTION="SSL"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-16-char-app-password"
SMTP_ENCRYPTION="STARTTLS"

EMAIL_FROM_ADDRESS="your-email@gmail.com"
EMAIL_FROM_NAME="After-Hours Escalation System"
ADMIN_EMAIL="admin@your-company.com"

# ============================================================================
# DIALPAD (Optional)
# ============================================================================
DIALPAD_API_KEY=""
DIALPAD_WEBHOOK_SECRET=""

# ============================================================================
# ESCALATION SETTINGS
# ============================================================================
EMERGENCY_SCORE_THRESHOLD=0.6
ACKNOWLEDGMENT_TIMEOUT_SECONDS=120

# ============================================================================
# FEATURE FLAGS
# ============================================================================
EMAIL_POLLING_ENABLED=true
TWILIO_ENABLED=true
AI_SERVICE_ENABLED=true
```

### Configuration Hierarchy

Configuration is loaded from multiple sources with this priority:

1. **Environment Variables** (highest priority)
2. **Database Settings** (SystemSetting table)
3. **Default Values** (in code)

The `AppConfigService` provides a unified interface:

```typescript
// Access configuration
const threshold = configService.get<number>('escalation.emergencyScoreThreshold');
const twilioSid = configService.get<string>('twilio.accountSid');
```

---

## Installation & Setup

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ (20 recommended) | Backend and frontend runtime |
| Python | 3.11+ | AI service runtime |
| Docker | Latest | Container runtime |
| Docker Compose | v2+ | Container orchestration |
| PostgreSQL | 15 | Database (or use Supabase/Docker) |

### Quick Start with Docker Compose

```bash
# 1. Clone the repository
git clone https://github.com/your-org/afterhours_escalation.git
cd afterhours_escalation

# 2. Create environment file
cp .env.example .env
# Edit .env with your credentials

# 3. Start all services
docker compose up -d --build

# 4. View logs
docker compose logs -f

# 5. Access the application
# Frontend: http://localhost:5175
# Backend API: http://localhost:3004/api/docs
# AI Service: http://localhost:8083/docs
```

### Development Mode (Without Docker)

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npx prisma generate
npx prisma db push  # Apply schema to database
npm run start:dev
```

**Terminal 2 - AI Service:**
```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8083
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Database Setup

```bash
# Generate Prisma client
cd backend
npx prisma generate

# Apply migrations to database
DATABASE_URL="your-connection-string" npx prisma db push

# Seed initial data (optional)
npx prisma db seed

# Open Prisma Studio (database GUI)
npx prisma studio
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

    # AI Service / Twilio Webhooks
    handle /twilio/* {
        reverse_proxy localhost:8083
    }

    # Dialpad Webhooks
    handle /dialpad* {
        reverse_proxy localhost:8083
    }
}
```

2. **Update Environment:**
```env
WEBHOOK_BASE_URL=https://your-domain.com
TWILIO_WEBHOOK_URL=https://your-domain.com/twilio
```

3. **Deploy:**
```bash
docker compose up -d --build
sudo systemctl reload caddy
```

---

## API Reference

### Backend API Endpoints

#### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate user, returns JWT |
| `GET` | `/api/auth/me` | Get current authenticated user |
| `POST` | `/api/auth/refresh` | Refresh JWT token |

#### Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/events` | List events with filters |
| `GET` | `/api/events/:id` | Get event details |
| `POST` | `/api/events/email` | Create event from email (internal) |
| `POST` | `/api/events/dialpad` | Create event from Dialpad (internal) |
| `POST` | `/api/events/:id/acknowledge` | Acknowledge an event |
| `POST` | `/api/events/:id/downgrade` | Downgrade event (false alarm) |
| `GET` | `/api/events/export` | Export events as CSV |

#### Escalation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/escalation/start/:eventId` | Start escalation (internal) |
| `GET` | `/api/escalation/contacts` | List escalation contacts |
| `POST` | `/api/escalation/contacts` | Create escalation contact |
| `PUT` | `/api/escalation/contacts/:id` | Update escalation contact |
| `DELETE` | `/api/escalation/contacts/:id` | Delete escalation contact |

#### Rotation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rotation` | Get all rotations |
| `GET` | `/api/rotation/current` | Get current on-call rotation |
| `POST` | `/api/rotation` | Create new rotation |
| `PUT` | `/api/rotation/:id` | Update rotation |
| `DELETE` | `/api/rotation/:id` | Delete rotation |

#### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/alerts` | List admin alerts |
| `GET` | `/api/alerts/:id` | Get alert details |
| `POST` | `/api/alerts/:id/resolve` | Resolve an alert |

#### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/metrics/dashboard` | Dashboard statistics |
| `GET` | `/api/metrics/weekly` | Weekly trend data |

#### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | System health check |

### AI Service API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/classify` | Classify email content |
| `POST` | `/classify/orchestrated` | Full multi-agent classification |
| `POST` | `/escalate` | Send escalation (call + SMS) |
| `POST` | `/dialpad` | Receive Dialpad webhooks |
| `POST` | `/twilio/voice` | Twilio voice webhook (TwiML) |
| `POST` | `/twilio/voice/gather` | DTMF digit collection |
| `POST` | `/twilio/voice/status` | Voice call status callback |
| `POST` | `/twilio/sms` | Incoming SMS handler |
| `POST` | `/twilio/sms/status` | SMS status callback |
| `GET` | `/health` | Health check |

### Interactive Documentation

- **Backend Swagger UI**: http://localhost:3004/api/docs
- **AI Service OpenAPI**: http://localhost:8083/docs

---

## Integrations

### Twilio Setup

1. Create account at https://www.twilio.com
2. Purchase a phone number with Voice + SMS capabilities
3. Configure webhooks in Twilio Console:

| Setting | Value |
|---------|-------|
| Voice Request URL | `https://your-domain.com/twilio/voice` |
| Voice Status Callback | `https://your-domain.com/twilio/voice/status` |
| Messaging Request URL | `https://your-domain.com/twilio/sms` |
| Messaging Status Callback | `https://your-domain.com/twilio/sms/status` |

**Note**: Trial accounts can only call verified phone numbers.

### Gmail Setup

1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password:
   - Go to [Google Account > Security > App Passwords](https://myaccount.google.com/apppasswords)
   - Select "Mail" and your device type
   - Copy the 16-character password (no spaces)
3. Configure in `.env`:
```env
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### Dialpad Setup (Optional)

1. Get API key from Dialpad admin console
2. Configure webhook URL for call events
3. Set in `.env`:
```env
DIALPAD_API_KEY=your-api-key
DIALPAD_WEBHOOK_SECRET=your-webhook-secret
```

---

## Troubleshooting

### Common Issues

#### Email Polling Not Working

```bash
# Check AI service logs
docker logs escalation-ai-service | grep -i imap

# Test IMAP connection
openssl s_client -connect imap.gmail.com:993
```

**Solutions:**
- Ensure using Gmail App Password (not regular password)
- Verify 2FA is enabled on Google account
- Check IMAP is enabled in Gmail settings

#### Twilio Calls "Simulated"

Calls show as simulated when Twilio credentials are missing.

**Solutions:**
- Verify `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` are set
- Check credentials are correct in Twilio Console
- Ensure phone number has Voice capability

#### WebSocket Not Connecting

```bash
# Check backend logs
docker logs escalation-backend | grep -i socket
```

**Solutions:**
- Verify WebSocket port is exposed
- Check CORS settings allow your frontend origin
- Ensure no proxy is blocking WebSocket upgrade

#### Database Connection Failed

```bash
# Test PostgreSQL
docker exec -it escalation-postgres pg_isready

# Check connection string
psql $DATABASE_URL -c "SELECT 1"
```

**Solutions:**
- Verify `DATABASE_URL` format
- Check database is running
- Ensure network connectivity

### Debug Mode

Enable detailed logging:

```env
# Backend
DEBUG=true
LOG_LEVEL=debug

# AI Service
DEBUG=true
```

### Log Locations

| Service | Docker | Local |
|---------|--------|-------|
| Backend | `docker logs escalation-backend` | `backend/logs/` |
| AI Service | `docker logs escalation-ai-service` | `ai-service/logs/` |
| Frontend | `docker logs escalation-frontend` | Browser console |

---

## Development Guide

### Code Style

**TypeScript (Backend/Frontend):**
- ESLint + Prettier
- 2-space indentation
- Single quotes
- No semicolons (Prettier default)

**Python (AI Service):**
- Black formatter
- isort for imports
- 4-space indentation
- Type hints required

### Testing

```bash
# Backend tests
cd backend && npm test

# AI service tests
cd ai-service && pytest

# Frontend tests
cd frontend && npm test
```

### Database Migrations

```bash
# Create migration
cd backend
npx prisma migrate dev --name description_of_change

# Apply in production
npx prisma migrate deploy

# Reset database (DESTRUCTIVE)
npx prisma migrate reset
```

### Adding New Features

1. **Backend Module:**
   - Create controller, service, module files
   - Add to `app.module.ts` imports
   - Use repository pattern for data access

2. **AI Agent:**
   - Create agent class in `ah_agents/` following OpenAI Agents SDK pattern:
     ```python
     from agents import Agent, Runner

     class MyAgent:
         def __init__(self):
             self._agent = Agent(
                 name="My Agent",
                 instructions="...",
                 model="gpt-5.2",
                 output_type=MyOutputModel,  # Optional Pydantic model
             )

         async def process(self, input: str) -> dict:
             result = await Runner.run(self._agent, input)
             return result.final_output
     ```
   - Add fallback logic for when OpenAI is unavailable
   - Export from `ah_agents/__init__.py`
   - Add route handler if API endpoint needed

3. **Frontend Page:**
   - Create page component in `pages/`
   - Add route in `App.tsx`
   - Use React Query for data fetching

---

## Default Credentials

After database seeding:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | admin123 |

---

## Recent Changes (v1.1.0)

### AI Service Refactoring

The AI service agents have been significantly simplified to follow the OpenAI Agents SDK pattern strictly:

**Before:**
- 4,710 lines of code across multiple agent files
- Complex wrapper classes and initialization patterns
- Unused specialist agents and backend API tools

**After:**
- 2,004 lines of code (57% reduction)
- Clean `Agent()` + `Runner.run()` pattern
- All agents have keyword-based fallback when OpenAI is unavailable

**Removed unused code:**
- `head_coordinator_agent.py`
- `specialist_agents/` folder
- `backend_api_tools/` folder
- `data_models/` folder

### Bug Fixes

| File | Issue | Resolution |
|------|-------|------------|
| `ai-service/routes/escalate.py` | Variable shadowing (`sms_result`) | Renamed to `sms_send_result` |
| `ai-service/routes/twilio_webhooks.py` | Unused `VoiceResponse()` object | Removed unnecessary code |
| `backend/src/escalation/escalation.internal.controller.ts` | Empty foreign keys allowed | Added validation with proper error handling |
| `backend/src/email-tracking/email-tracking.controller.ts` | Double path prefix (`/api/api/`) | Fixed controller decorator |
| `ai-service/ah_agents/agent_tools.py` | Wrong rotation endpoint | Fixed to use `/api/escalation/rotation/current` |

### Integration Verification

All AI service to backend integrations have been verified:
- 18 endpoints confirmed working with `x-internal-key` authentication
- Frontend confirmed fetching real data (no mock/dummy data)
- WebSocket real-time updates verified

---

## License

Proprietary - All rights reserved

---

## Support

For issues or questions:
- Open an issue on GitHub
- Contact the development team

---

*Built for reliable after-hours emergency response*
