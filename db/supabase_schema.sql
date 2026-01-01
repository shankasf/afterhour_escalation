-- =====================================================
-- After-Hours Escalation System - Supabase Schema
-- Run this in Supabase SQL Editor
-- =====================================================

-- Enable UUID extension (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- Drop existing tables (in reverse dependency order)
-- =====================================================
DROP TABLE IF EXISTS email_polling_status CASCADE;
DROP TABLE IF EXISTS system_health_logs CASCADE;
DROP TABLE IF EXISTS daily_metrics CASCADE;
DROP TABLE IF EXISTS emergency_keywords CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS admin_alerts CASCADE;
DROP TABLE IF EXISTS acknowledgments CASCADE;
DROP TABLE IF EXISTS escalation_logs CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS escalation_contacts CASCADE;
DROP TABLE IF EXISTS on_call_rotations CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =====================================================
-- Drop existing enums
-- =====================================================
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS event_source CASCADE;
DROP TYPE IF EXISTS event_status CASCADE;
DROP TYPE IF EXISTS contact_type CASCADE;
DROP TYPE IF EXISTS call_status CASCADE;
DROP TYPE IF EXISTS sms_status CASCADE;
DROP TYPE IF EXISTS ack_method CASCADE;
DROP TYPE IF EXISTS alert_type CASCADE;

-- =====================================================
-- Create Enums
-- =====================================================

CREATE TYPE user_role AS ENUM ('admin', 'on_call', 'viewer');
CREATE TYPE event_source AS ENUM ('email', 'dialpad');
CREATE TYPE event_status AS ENUM ('pending', 'escalated', 'acknowledged', 'downgraded', 'missed', 'closed');
CREATE TYPE contact_type AS ENUM ('primary', 'secondary', 'fixed');
CREATE TYPE call_status AS ENUM ('not_called', 'ringing', 'answered', 'failed', 'no_answer', 'busy');
CREATE TYPE sms_status AS ENUM ('not_sent', 'sent', 'delivered', 'failed');
CREATE TYPE ack_method AS ENUM ('sms', 'call');
CREATE TYPE alert_type AS ENUM ('email_ingestion_failure', 'dialpad_webhook_failure', 'call_failure', 'sms_failure', 'no_acknowledgment', 'system_health');

-- =====================================================
-- Core Tables
-- =====================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    phone_number VARCHAR(50),
    role user_role DEFAULT 'viewer' NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- On-call rotation table
CREATE TABLE on_call_rotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    primary_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secondary_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Escalation contacts table
CREATE TABLE escalation_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    contact_type contact_type NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, contact_type)
);

-- Events table (main escalation events)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source event_source NOT NULL,
    subject VARCHAR(500),
    body TEXT,
    sender_domain VARCHAR(255),
    sender_email VARCHAR(255),
    sender_phone VARCHAR(50),
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    emergency_score DECIMAL(5,4),
    extracted_context JSONB,
    status event_status DEFAULT 'pending' NOT NULL,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    downgraded_to_non_emergency BOOLEAN DEFAULT false NOT NULL,
    escalation_ladder_snapshot JSONB,
    voicemail_transcription TEXT,
    voicemail_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for events
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_received_at ON events(received_at);
CREATE INDEX idx_events_source ON events(source);

-- Escalation logs table
CREATE TABLE escalation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES escalation_contacts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    call_sid VARCHAR(100),
    call_status call_status DEFAULT 'not_called' NOT NULL,
    sms_sid VARCHAR(100),
    sms_status sms_status DEFAULT 'not_sent' NOT NULL,
    acknowledgment_received BOOLEAN DEFAULT false NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for escalation_logs
CREATE INDEX idx_escalation_logs_event_id ON escalation_logs(event_id);
CREATE INDEX idx_escalation_logs_call_sid ON escalation_logs(call_sid);

-- Acknowledgments table
CREATE TABLE acknowledgments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method ack_method NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE NOT NULL,
    notes TEXT,
    downgrade_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create index for acknowledgments
CREATE INDEX idx_acknowledgments_event_id ON acknowledgments(event_id);

-- Admin alerts table
CREATE TABLE admin_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    alert_type alert_type NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    alerted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    resolved BOOLEAN DEFAULT false NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for admin_alerts
CREATE INDEX idx_admin_alerts_resolved ON admin_alerts(resolved);
CREATE INDEX idx_admin_alerts_type ON admin_alerts(alert_type);

-- =====================================================
-- Configuration Tables
-- =====================================================

-- System settings table
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Emergency keywords table
CREATE TABLE emergency_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword VARCHAR(100) NOT NULL,
    weight DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    category VARCHAR(100),
    is_negative BOOLEAN DEFAULT false NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- =====================================================
-- Metrics Tables
-- =====================================================

-- Daily metrics table
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE UNIQUE NOT NULL,
    total_events INTEGER DEFAULT 0 NOT NULL,
    email_events INTEGER DEFAULT 0 NOT NULL,
    dialpad_events INTEGER DEFAULT 0 NOT NULL,
    escalated_events INTEGER DEFAULT 0 NOT NULL,
    acknowledged_events INTEGER DEFAULT 0 NOT NULL,
    missed_events INTEGER DEFAULT 0 NOT NULL,
    avg_response_time_seconds INTEGER,
    sla_compliance_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- System health logs table
CREATE TABLE system_health_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    response_time_ms INTEGER,
    error_message TEXT,
    details JSONB,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create index for system_health_logs
CREATE INDEX idx_system_health_logs_service_checked ON system_health_logs(service, checked_at);

-- Email polling status table
CREATE TABLE email_polling_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    last_poll_at TIMESTAMP WITH TIME ZONE,
    last_success_at TIMESTAMP WITH TIME ZONE,
    messages_processed INTEGER DEFAULT 0 NOT NULL,
    errors_count INTEGER DEFAULT 0 NOT NULL,
    last_error TEXT,
    status VARCHAR(50) DEFAULT 'idle' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- =====================================================
-- Updated_at Trigger Function
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_on_call_rotations_updated_at BEFORE UPDATE ON on_call_rotations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_escalation_contacts_updated_at BEFORE UPDATE ON escalation_contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_emergency_keywords_updated_at BEFORE UPDATE ON emergency_keywords FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_email_polling_status_updated_at BEFORE UPDATE ON email_polling_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Seed Data: Admin User
-- Password: admin123 (bcrypt hash)
-- =====================================================

INSERT INTO users (id, name, email, password_hash, phone_number, role, is_active) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Admin User', 'admin@example.com', '$2b$10$rQEY9zfl7H9H.GqOFMKHseJPLfU9qcDCK1K1Z9xPjRZL7FfGQKqH6', '+1234567890', 'admin', true);

-- =====================================================
-- Seed Data: On-Call Users (Jordan & Christina)
-- =====================================================

INSERT INTO users (id, name, email, password_hash, phone_number, role, is_active) VALUES
    ('00000000-0000-0000-0000-000000000002', 'Jordan', 'jordan@example.com', '$2b$10$rQEY9zfl7H9H.GqOFMKHseJPLfU9qcDCK1K1Z9xPjRZL7FfGQKqH6', '+16508552762', 'on_call', true),
    ('00000000-0000-0000-0000-000000000003', 'Christina', 'christina@example.com', '$2b$10$rQEY9zfl7H9H.GqOFMKHseJPLfU9qcDCK1K1Z9xPjRZL7FfGQKqH6', '+16508552763', 'on_call', true);

-- =====================================================
-- Seed Data: Fixed Escalation Contacts
-- =====================================================

INSERT INTO users (id, name, email, password_hash, phone_number, role, is_active) VALUES
    ('00000000-0000-0000-0000-000000000004', 'Matt Mehler', 'matt@example.com', NULL, '+16508552764', 'viewer', true),
    ('00000000-0000-0000-0000-000000000005', 'Karina Blondet', 'karina@example.com', NULL, '+16508552765', 'viewer', true),
    ('00000000-0000-0000-0000-000000000006', 'Katelyn Badger', 'katelyn@example.com', NULL, '+16508552766', 'viewer', true),
    ('00000000-0000-0000-0000-000000000007', 'Stefi', 'stefi@example.com', NULL, '+16508552767', 'viewer', true),
    ('00000000-0000-0000-0000-000000000008', 'Eric', 'eric@example.com', NULL, '+16508552768', 'viewer', true),
    ('00000000-0000-0000-0000-000000000009', 'Rocco', 'rocco@example.com', NULL, '+16508552769', 'viewer', true);

-- =====================================================
-- Seed Data: On-Call Rotation (Current Week)
-- =====================================================

INSERT INTO on_call_rotations (id, start_date, end_date, primary_user_id, secondary_user_id) VALUES
    ('00000000-0000-0000-0000-000000000010', CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');

-- =====================================================
-- Seed Data: Escalation Contacts Configuration
-- Position 1-2: On-call (primary/secondary from rotation)
-- Position 3-8: Fixed contacts
-- =====================================================

-- Primary on-call contact
INSERT INTO escalation_contacts (user_id, position, contact_type, is_active) VALUES
    ('00000000-0000-0000-0000-000000000002', 1, 'primary', true);

-- Secondary on-call contact
INSERT INTO escalation_contacts (user_id, position, contact_type, is_active) VALUES
    ('00000000-0000-0000-0000-000000000003', 2, 'secondary', true);

-- Fixed escalation contacts (positions 3-8)
INSERT INTO escalation_contacts (user_id, position, contact_type, is_active) VALUES
    ('00000000-0000-0000-0000-000000000004', 3, 'fixed', true),  -- Matt Mehler
    ('00000000-0000-0000-0000-000000000005', 4, 'fixed', true),  -- Karina Blondet
    ('00000000-0000-0000-0000-000000000006', 5, 'fixed', true),  -- Katelyn Badger
    ('00000000-0000-0000-0000-000000000007', 6, 'fixed', true),  -- Stefi
    ('00000000-0000-0000-0000-000000000008', 7, 'fixed', true),  -- Eric
    ('00000000-0000-0000-0000-000000000009', 8, 'fixed', true);  -- Rocco

-- =====================================================
-- Seed Data: System Settings
-- =====================================================

INSERT INTO system_settings (key, value, description) VALUES
    ('emergency_threshold', '0.80', 'Emergency score threshold (0-1)'),
    ('escalation_timeout_seconds', '90', 'Seconds to wait before escalating to next contact'),
    ('max_escalation_attempts', '8', 'Maximum number of contacts to try'),
    ('sla_ack_minutes', '15', 'SLA target for acknowledgment in minutes'),
    ('business_hours_start', '09:00', 'Business hours start time'),
    ('business_hours_end', '17:00', 'Business hours end time'),
    ('business_timezone', 'America/New_York', 'Business timezone'),
    ('admin_email', 'admin@example.com', 'Admin notification email'),
    ('admin_phone', '+1234567890', 'Admin notification phone'),
    ('twilio_enabled', 'true', 'Enable Twilio integration'),
    ('dialpad_enabled', 'false', 'Enable Dialpad integration (optional)'),
    ('email_polling_interval_seconds', '60', 'Email polling interval');

-- =====================================================
-- Seed Data: Emergency Keywords
-- =====================================================

INSERT INTO emergency_keywords (keyword, weight, category, is_negative, is_active) VALUES
    ('flood', 1.50, 'water', false, true),
    ('flooding', 1.50, 'water', false, true),
    ('water leak', 1.40, 'water', false, true),
    ('burst pipe', 1.50, 'water', false, true),
    ('water damage', 1.30, 'water', false, true),
    ('sewage', 1.50, 'water', false, true),
    ('fire', 1.80, 'fire', false, true),
    ('smoke', 1.50, 'fire', false, true),
    ('gas leak', 1.80, 'gas', false, true),
    ('smell gas', 1.70, 'gas', false, true),
    ('carbon monoxide', 1.80, 'gas', false, true),
    ('no heat', 1.20, 'hvac', false, true),
    ('no ac', 1.00, 'hvac', false, true),
    ('no hot water', 1.10, 'hvac', false, true),
    ('power outage', 1.30, 'electrical', false, true),
    ('electrical fire', 1.80, 'electrical', false, true),
    ('sparks', 1.40, 'electrical', false, true),
    ('break-in', 1.60, 'security', false, true),
    ('intruder', 1.70, 'security', false, true),
    ('locked out', 0.80, 'access', false, true),
    ('elevator stuck', 1.50, 'elevator', false, true),
    ('trapped', 1.70, 'emergency', false, true),
    ('emergency', 1.30, 'general', false, true),
    ('urgent', 1.10, 'general', false, true),
    ('asap', 1.00, 'general', false, true),
    ('immediately', 1.10, 'general', false, true),
    -- Negative keywords (reduce score)
    ('question', 0.50, 'general', true, true),
    ('inquiry', 0.50, 'general', true, true),
    ('when convenient', 0.40, 'general', true, true),
    ('not urgent', 0.30, 'general', true, true),
    ('fyi', 0.40, 'general', true, true);

-- =====================================================
-- Seed Data: Email Polling Status (initial record)
-- =====================================================

INSERT INTO email_polling_status (status) VALUES ('idle');

-- =====================================================
-- Seed Data: Sample Events (for testing)
-- =====================================================

INSERT INTO events (id, source, subject, body, sender_domain, sender_email, sender_phone, received_at, emergency_score, status, extracted_context) VALUES
    -- Emergency event - water leak (acknowledged)
    ('10000000-0000-0000-0000-000000000001', 'email', 'URGENT: Water leak in unit 302', 
     'There is water pouring from the ceiling in unit 302. It looks like a burst pipe from the unit above. Water is damaging the floors and furniture. Please send someone immediately!',
     'gmail.com', 'tenant302@gmail.com', NULL, NOW() - INTERVAL '2 hours', 0.9200, 'acknowledged',
     '{"unit": "302", "issue_type": "water_leak", "severity": "high"}'::jsonb),
    
    -- Emergency event - no heat (escalating)
    ('10000000-0000-0000-0000-000000000002', 'email', 'No heat - freezing temperatures', 
     'Our heating system stopped working and its 15 degrees outside. We have a baby in the apartment. This is an emergency, we need help tonight.',
     'yahoo.com', 'family405@yahoo.com', NULL, NOW() - INTERVAL '45 minutes', 0.8800, 'escalated',
     '{"unit": "405", "issue_type": "hvac", "severity": "high"}'::jsonb),
    
    -- Emergency event - from Dialpad voicemail (pending)
    ('10000000-0000-0000-0000-000000000003', 'dialpad', 'Voicemail from +1-555-123-4567', 
     'Hi this is John from unit 210. I smell gas in my apartment. I turned off the stove but the smell is getting stronger. Please call me back urgently.',
     NULL, NULL, '+15551234567', NOW() - INTERVAL '10 minutes', 0.9500, 'pending',
     '{"unit": "210", "issue_type": "gas_leak", "severity": "critical"}'::jsonb),
    
    -- Non-emergency event (closed)
    ('10000000-0000-0000-0000-000000000004', 'email', 'Question about parking permit renewal', 
     'Hi, I wanted to ask when I need to renew my parking permit. Its not urgent, just wanted to plan ahead. Thanks!',
     'outlook.com', 'resident101@outlook.com', NULL, NOW() - INTERVAL '1 day', 0.1500, 'closed',
     '{"unit": "101", "issue_type": "parking", "severity": "low"}'::jsonb),
    
    -- Non-emergency event (downgraded)
    ('10000000-0000-0000-0000-000000000005', 'email', 'Dripping faucet in bathroom', 
     'The bathroom faucet has been dripping for a few days. Not urgent but would like it fixed when convenient.',
     'gmail.com', 'tenant508@gmail.com', NULL, NOW() - INTERVAL '3 hours', 0.3500, 'downgraded',
     '{"unit": "508", "issue_type": "plumbing", "severity": "low"}'::jsonb),
    
    -- Emergency event - elevator stuck (missed - no one acknowledged)
    ('10000000-0000-0000-0000-000000000006', 'dialpad', 'Voicemail - Elevator emergency', 
     'Someone is stuck in the elevator on floor 4! They have been there for 20 minutes. Please send help!',
     NULL, NULL, '+15559876543', NOW() - INTERVAL '5 hours', 0.9100, 'missed',
     '{"location": "elevator_4", "issue_type": "elevator", "severity": "critical"}'::jsonb);

-- Update acknowledged event with acknowledger info
UPDATE events SET acknowledged_by = '00000000-0000-0000-0000-000000000002', acknowledged_at = NOW() - INTERVAL '1 hour 30 minutes'
WHERE id = '10000000-0000-0000-0000-000000000001';

-- =====================================================
-- Seed Data: Sample Escalation Logs
-- =====================================================

-- Escalation logs for water leak event (acknowledged on 2nd contact)
INSERT INTO escalation_logs (id, event_id, contact_id, user_id, attempt_number, call_sid, call_status, sms_sid, sms_status, acknowledgment_received, acknowledged_at, created_at) VALUES
    -- First attempt to Jordan (no answer)
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000002'),
     '00000000-0000-0000-0000-000000000002', 1, 'CA_test_001', 'no_answer', 'SM_test_001', 'delivered', 
     false, NULL, NOW() - INTERVAL '2 hours'),
    -- Second attempt to Christina (acknowledged)
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000003'),
     '00000000-0000-0000-0000-000000000003', 2, 'CA_test_002', 'answered', 'SM_test_002', 'delivered',
     true, NOW() - INTERVAL '1 hour 30 minutes', NOW() - INTERVAL '1 hour 50 minutes');

-- Escalation logs for no heat event (currently escalating)
INSERT INTO escalation_logs (id, event_id, contact_id, user_id, attempt_number, call_sid, call_status, sms_sid, sms_status, acknowledgment_received, created_at) VALUES
    -- First attempt to Jordan (no answer)
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000002'),
     '00000000-0000-0000-0000-000000000002', 1, 'CA_test_003', 'no_answer', 'SM_test_003', 'delivered',
     false, NOW() - INTERVAL '40 minutes'),
    -- Second attempt to Christina (no answer)
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000003'),
     '00000000-0000-0000-0000-000000000003', 2, 'CA_test_004', 'no_answer', 'SM_test_004', 'delivered',
     false, NOW() - INTERVAL '35 minutes'),
    -- Third attempt to Matt Mehler (ringing)
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     '00000000-0000-0000-0000-000000000004', 3, 'CA_test_005', 'ringing', 'SM_test_005', 'sent',
     false, NOW() - INTERVAL '2 minutes');

-- Escalation logs for missed elevator event (all contacts tried, no ack)
INSERT INTO escalation_logs (id, event_id, contact_id, user_id, attempt_number, call_sid, call_status, sms_sid, sms_status, acknowledgment_received, created_at) VALUES
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000002'),
     '00000000-0000-0000-0000-000000000002', 1, 'CA_test_006', 'no_answer', 'SM_test_006', 'delivered', false, NOW() - INTERVAL '5 hours'),
    ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000006',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000003'),
     '00000000-0000-0000-0000-000000000003', 2, 'CA_test_007', 'no_answer', 'SM_test_007', 'delivered', false, NOW() - INTERVAL '4 hours 55 minutes'),
    ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000006',
     (SELECT id FROM escalation_contacts WHERE user_id = '00000000-0000-0000-0000-000000000004'),
     '00000000-0000-0000-0000-000000000004', 3, 'CA_test_008', 'failed', 'SM_test_008', 'failed', false, NOW() - INTERVAL '4 hours 50 minutes');

-- =====================================================
-- Seed Data: Sample Acknowledgments
-- =====================================================

INSERT INTO acknowledgments (id, event_id, user_id, method, acknowledged_at, notes, created_at) VALUES
    -- Water leak acknowledged by Christina via SMS
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 
     '00000000-0000-0000-0000-000000000003', 'sms', NOW() - INTERVAL '1 hour 30 minutes',
     'On my way to check the unit. Called plumber.', NOW() - INTERVAL '1 hour 30 minutes'),
    
    -- Dripping faucet downgraded by admin
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005',
     '00000000-0000-0000-0000-000000000001', 'call', NOW() - INTERVAL '2 hours 30 minutes',
     'Downgraded to non-emergency. Scheduled for regular maintenance.', NOW() - INTERVAL '2 hours 30 minutes');

-- =====================================================
-- Seed Data: Sample Admin Alerts
-- =====================================================

INSERT INTO admin_alerts (id, event_id, alert_type, message, details, alerted_at, resolved, resolved_at, resolved_by, created_at) VALUES
    -- Resolved alert - escalation failure
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 
     'no_acknowledgment', 'No one acknowledged elevator emergency after all escalation attempts',
     '{"attempts": 3, "event_id": "10000000-0000-0000-0000-000000000006"}'::jsonb,
     NOW() - INTERVAL '4 hours 30 minutes', true, NOW() - INTERVAL '4 hours',
     '00000000-0000-0000-0000-000000000001', NOW() - INTERVAL '4 hours 30 minutes'),
    
    -- Active alert - call failure
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
     'call_failure', 'Failed to connect call to Matt Mehler after 3 retries',
     '{"contact": "Matt Mehler", "phone": "+16508552764", "error": "Network timeout"}'::jsonb,
     NOW() - INTERVAL '30 minutes', false, NULL, NULL, NOW() - INTERVAL '30 minutes'),
    
    -- System health alert (resolved)
    ('40000000-0000-0000-0000-000000000003', NULL,
     'system_health', 'Email polling service was down for 5 minutes',
     '{"service": "email_poller", "downtime_seconds": 300}'::jsonb,
     NOW() - INTERVAL '6 hours', true, NOW() - INTERVAL '5 hours 55 minutes',
     '00000000-0000-0000-0000-000000000001', NOW() - INTERVAL '6 hours');

-- =====================================================
-- Seed Data: Sample Daily Metrics (last 7 days)
-- =====================================================

INSERT INTO daily_metrics (date, total_events, email_events, dialpad_events, escalated_events, acknowledged_events, missed_events, avg_response_time_seconds, sla_compliance_rate, created_at) VALUES
    (CURRENT_DATE - INTERVAL '6 days', 8, 6, 2, 3, 3, 0, 420, 100.00, NOW() - INTERVAL '6 days'),
    (CURRENT_DATE - INTERVAL '5 days', 12, 9, 3, 5, 4, 1, 540, 80.00, NOW() - INTERVAL '5 days'),
    (CURRENT_DATE - INTERVAL '4 days', 5, 4, 1, 2, 2, 0, 380, 100.00, NOW() - INTERVAL '4 days'),
    (CURRENT_DATE - INTERVAL '3 days', 15, 11, 4, 6, 5, 1, 620, 83.33, NOW() - INTERVAL '3 days'),
    (CURRENT_DATE - INTERVAL '2 days', 9, 7, 2, 4, 4, 0, 450, 100.00, NOW() - INTERVAL '2 days'),
    (CURRENT_DATE - INTERVAL '1 day', 11, 8, 3, 5, 4, 1, 510, 80.00, NOW() - INTERVAL '1 day'),
    (CURRENT_DATE, 6, 4, 2, 3, 1, 1, 480, 66.67, NOW());

-- =====================================================
-- Seed Data: Sample System Health Logs
-- =====================================================

INSERT INTO system_health_logs (service, status, response_time_ms, error_message, details, checked_at) VALUES
    -- Recent health checks
    ('database', 'healthy', 12, NULL, '{"connections": 5, "max_connections": 100}'::jsonb, NOW() - INTERVAL '5 minutes'),
    ('ai_service', 'healthy', 145, NULL, '{"model": "gpt-4", "requests_today": 42}'::jsonb, NOW() - INTERVAL '5 minutes'),
    ('twilio', 'healthy', 230, NULL, '{"account_balance": "$50.00"}'::jsonb, NOW() - INTERVAL '5 minutes'),
    ('email_poller', 'healthy', 890, NULL, '{"last_poll": "2025-12-31T10:00:00Z", "messages_checked": 15}'::jsonb, NOW() - INTERVAL '5 minutes'),
    
    -- Historical checks
    ('database', 'healthy', 15, NULL, NULL, NOW() - INTERVAL '1 hour'),
    ('ai_service', 'healthy', 132, NULL, NULL, NOW() - INTERVAL '1 hour'),
    ('twilio', 'healthy', 245, NULL, NULL, NOW() - INTERVAL '1 hour'),
    ('email_poller', 'healthy', 920, NULL, NULL, NOW() - INTERVAL '1 hour'),
    
    -- One historical failure
    ('email_poller', 'unhealthy', NULL, 'Connection timeout to IMAP server', '{"error_code": "ETIMEDOUT"}'::jsonb, NOW() - INTERVAL '6 hours');

-- =====================================================
-- Row Level Security (RLS) Policies for Supabase
-- =====================================================
-- IMPORTANT: This application uses the service_role key which bypasses RLS.
-- RLS is enabled to block anon/authenticated access - only service_role can access.
-- Never expose service_role key to the frontend!

-- Enable RLS on all tables (blocks anon/authenticated, service_role bypasses)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_call_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_health_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_polling_status ENABLE ROW LEVEL SECURITY;

-- NO POLICIES = No access for anon/authenticated roles
-- service_role key bypasses RLS entirely, so our backend can access all data
-- This is the most secure configuration for a backend-only API

-- Drop any existing permissive policies (safety cleanup)
DROP POLICY IF EXISTS "Service role has full access to users" ON users;
DROP POLICY IF EXISTS "Service role has full access to on_call_rotations" ON on_call_rotations;
DROP POLICY IF EXISTS "Service role has full access to escalation_contacts" ON escalation_contacts;
DROP POLICY IF EXISTS "Service role has full access to events" ON events;
DROP POLICY IF EXISTS "Service role has full access to escalation_logs" ON escalation_logs;
DROP POLICY IF EXISTS "Service role has full access to acknowledgments" ON acknowledgments;
DROP POLICY IF EXISTS "Service role has full access to admin_alerts" ON admin_alerts;
DROP POLICY IF EXISTS "Service role has full access to system_settings" ON system_settings;
DROP POLICY IF EXISTS "Service role has full access to emergency_keywords" ON emergency_keywords;
DROP POLICY IF EXISTS "Service role has full access to daily_metrics" ON daily_metrics;
DROP POLICY IF EXISTS "Service role has full access to system_health_logs" ON system_health_logs;
DROP POLICY IF EXISTS "Service role has full access to email_polling_status" ON email_polling_status;

-- Verify RLS is active (for debugging)
DO $$
BEGIN
    RAISE NOTICE 'RLS enabled on all tables. Only service_role can access data.';
END $$;

-- =====================================================
-- Useful Views (with security_invoker to respect RLS)
-- =====================================================
-- NOTE: Views use security_invoker = true so they inherit
-- the caller's permissions. Only service_role can access.

-- Drop existing views first
DROP VIEW IF EXISTS current_on_call CASCADE;
DROP VIEW IF EXISTS escalation_ladder CASCADE;
DROP VIEW IF EXISTS active_events_summary CASCADE;

-- Current on-call view (secured)
CREATE VIEW current_on_call
WITH (security_invoker = true)
AS
SELECT 
    r.id as rotation_id,
    r.start_date,
    r.end_date,
    p.id as primary_id,
    p.name as primary_name,
    p.phone_number as primary_phone,
    p.email as primary_email,
    s.id as secondary_id,
    s.name as secondary_name,
    s.phone_number as secondary_phone,
    s.email as secondary_email
FROM on_call_rotations r
JOIN users p ON r.primary_user_id = p.id
JOIN users s ON r.secondary_user_id = s.id
WHERE CURRENT_DATE BETWEEN r.start_date AND r.end_date
LIMIT 1;

-- Full escalation ladder view (secured)
CREATE VIEW escalation_ladder
WITH (security_invoker = true)
AS
SELECT 
    ec.position,
    ec.contact_type,
    u.id as user_id,
    u.name,
    u.phone_number,
    u.email,
    ec.is_active
FROM escalation_contacts ec
JOIN users u ON ec.user_id = u.id
WHERE ec.is_active = true AND u.is_active = true
ORDER BY ec.position;

-- Active events summary view (secured)
CREATE VIEW active_events_summary
WITH (security_invoker = true)
AS
SELECT 
    e.id,
    e.source,
    e.subject,
    e.emergency_score,
    e.status,
    e.received_at,
    e.created_at,
    COUNT(el.id) as escalation_attempts,
    MAX(el.created_at) as last_escalation_at
FROM events e
LEFT JOIN escalation_logs el ON e.id = el.event_id
WHERE e.status IN ('pending', 'escalated')
GROUP BY e.id
ORDER BY e.received_at DESC;

-- =====================================================
-- Done!
-- =====================================================

SELECT 'Schema created successfully!' as message;
