-- =====================================================
-- After-Hours Escalation System - Database Schema
-- PostgreSQL Schema for Reference
-- (Prisma will be the source of truth)
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum Types
CREATE TYPE user_role AS ENUM ('admin', 'on_call', 'viewer');
CREATE TYPE event_source AS ENUM ('email', 'dialpad');
CREATE TYPE event_status AS ENUM ('pending', 'escalated', 'acknowledged', 'downgraded', 'missed', 'closed');
CREATE TYPE contact_type AS ENUM ('primary', 'secondary', 'fixed');
CREATE TYPE call_status AS ENUM ('not_called', 'ringing', 'answered', 'failed', 'no_answer', 'busy');
CREATE TYPE sms_status AS ENUM ('not_sent', 'sent', 'delivered', 'failed');
CREATE TYPE ack_method AS ENUM ('sms', 'call');
CREATE TYPE alert_type AS ENUM (
  'email_ingestion_failure',
  'dialpad_webhook_failure', 
  'call_failure',
  'sms_failure',
  'no_acknowledgment',
  'system_health'
);

-- =====================================================
-- Core Tables
-- =====================================================

-- Users table - stores all user accounts
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  phone_number VARCHAR(50),
  role user_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- On-call rotations - weekly primary/secondary assignments
CREATE TABLE on_call_rotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  primary_user_id UUID NOT NULL REFERENCES users(id),
  secondary_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Escalation contacts - defines escalation order
CREATE TABLE escalation_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL,
  contact_type contact_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, contact_type)
);

-- Events - incoming email and dialpad events
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source event_source NOT NULL,
  subject TEXT,
  body TEXT,
  ai_summary TEXT,
  sender_domain VARCHAR(255),
  sender_email VARCHAR(255),
  sender_phone VARCHAR(50),
  received_at TIMESTAMPTZ NOT NULL,
  emergency_score DECIMAL(5,4),
  extracted_context JSONB,
  status event_status NOT NULL DEFAULT 'pending',
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  downgraded_to_non_emergency BOOLEAN NOT NULL DEFAULT false,
  escalation_ladder_snapshot JSONB,
  voicemail_transcription TEXT,
  voicemail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_received_at ON events(received_at);
CREATE INDEX idx_events_source ON events(source);

-- Escalation logs - each escalation attempt
CREATE TABLE escalation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id),
  contact_id UUID NOT NULL REFERENCES escalation_contacts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL,
  call_sid VARCHAR(100),
  call_status call_status NOT NULL DEFAULT 'not_called',
  sms_sid VARCHAR(100),
  sms_status sms_status NOT NULL DEFAULT 'not_sent',
  acknowledgment_received BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalation_logs_event ON escalation_logs(event_id);
CREATE INDEX idx_escalation_logs_call_sid ON escalation_logs(call_sid);

-- Acknowledgments - details of user acknowledgments
CREATE TABLE acknowledgments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id),
  user_id UUID NOT NULL REFERENCES users(id),
  method ack_method NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  downgrade_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_acknowledgments_event ON acknowledgments(event_id);

-- Admin alerts - system/SLA failures
CREATE TABLE admin_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id),
  alert_type alert_type NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_alerts_resolved ON admin_alerts(resolved);
CREATE INDEX idx_admin_alerts_type ON admin_alerts(alert_type);

-- =====================================================
-- Configuration & Settings Tables
-- =====================================================

-- System settings - configurable parameters
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Emergency keywords - weighted keywords for scoring
CREATE TABLE emergency_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword VARCHAR(255) NOT NULL,
  weight DECIMAL(3,2) NOT NULL,
  category VARCHAR(50),
  is_negative BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- Metrics & Health Tables
-- =====================================================

-- Daily metrics - aggregated daily stats
CREATE TABLE daily_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE UNIQUE NOT NULL,
  total_events INTEGER NOT NULL DEFAULT 0,
  email_events INTEGER NOT NULL DEFAULT 0,
  dialpad_events INTEGER NOT NULL DEFAULT 0,
  escalated_events INTEGER NOT NULL DEFAULT 0,
  acknowledged_events INTEGER NOT NULL DEFAULT 0,
  missed_events INTEGER NOT NULL DEFAULT 0,
  avg_response_time_seconds INTEGER,
  sla_compliance_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System health logs
CREATE TABLE system_health_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  response_time_ms INTEGER,
  error_message TEXT,
  details JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_logs_service ON system_health_logs(service, checked_at);

-- Email polling status
CREATE TABLE email_polling_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  last_poll_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  messages_processed INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
