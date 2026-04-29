-- CreateEnum
CREATE TYPE "ack_method" AS ENUM ('sms', 'call');

-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('email_ingestion_failure', 'dialpad_webhook_failure', 'call_failure', 'sms_failure', 'no_acknowledgment', 'system_health');

-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('not_called', 'ringing', 'answered', 'failed', 'no_answer', 'busy');

-- CreateEnum
CREATE TYPE "contact_type" AS ENUM ('primary', 'secondary', 'fixed');

-- CreateEnum
CREATE TYPE "event_source" AS ENUM ('email', 'dialpad');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('pending', 'escalated', 'acknowledged', 'downgraded', 'missed', 'closed');

-- CreateEnum
CREATE TYPE "sms_status" AS ENUM ('not_sent', 'sent', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'on_call', 'viewer');

-- CreateTable
CREATE TABLE "acknowledgments" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" "ack_method" NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "downgrade_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_alerts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "alert_type" "alert_type" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "alerted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_events" INTEGER NOT NULL DEFAULT 0,
    "email_events" INTEGER NOT NULL DEFAULT 0,
    "dialpad_events" INTEGER NOT NULL DEFAULT 0,
    "escalated_events" INTEGER NOT NULL DEFAULT 0,
    "acknowledged_events" INTEGER NOT NULL DEFAULT 0,
    "missed_events" INTEGER NOT NULL DEFAULT 0,
    "avg_response_time_seconds" INTEGER,
    "sla_compliance_rate" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_polling_status" (
    "id" TEXT NOT NULL,
    "last_poll_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "messages_processed" INTEGER NOT NULL DEFAULT 0,
    "errors_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'idle',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_polling_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_keywords" (
    "id" TEXT NOT NULL,
    "keyword" VARCHAR(100) NOT NULL,
    "weight" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "category" VARCHAR(100),
    "is_negative" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "emergency_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "contact_type" "contact_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_ladder_config" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "role" VARCHAR(100) NOT NULL,
    "user_id" TEXT,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 120,
    "is_rotation" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_ladder_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_logs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "call_sid" VARCHAR(100),
    "call_status" "call_status" NOT NULL DEFAULT 'not_called',
    "sms_sid" VARCHAR(100),
    "sms_status" "sms_status" NOT NULL DEFAULT 'not_sent',
    "acknowledgment_received" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "source" "event_source" NOT NULL,
    "subject" VARCHAR(500),
    "body" TEXT,
    "ai_summary" TEXT,
    "sender_domain" VARCHAR(255),
    "sender_email" VARCHAR(255),
    "sender_phone" VARCHAR(50),
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "emergency_score" DECIMAL(5,4),
    "extracted_context" JSONB,
    "status" "event_status" NOT NULL DEFAULT 'pending',
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "downgraded_to_non_emergency" BOOLEAN NOT NULL DEFAULT false,
    "escalation_ladder_snapshot" JSONB,
    "voicemail_transcription" TEXT,
    "voicemail_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_rotations" (
    "id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "primary_user_id" TEXT NOT NULL,
    "secondary_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "on_call_rotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_email_uids" (
    "id" TEXT NOT NULL,
    "uid" VARCHAR(255) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_email_uids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_health_logs" (
    "id" TEXT NOT NULL,
    "service" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "response_time_ms" INTEGER,
    "error_message" TEXT,
    "details" JSONB,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "phone_number" VARCHAR(50),
    "role" "user_role" NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acknowledgments_event_id_idx" ON "acknowledgments"("event_id" ASC);

-- CreateIndex
CREATE INDEX "admin_alerts_alert_type_idx" ON "admin_alerts"("alert_type" ASC);

-- CreateIndex
CREATE INDEX "admin_alerts_resolved_idx" ON "admin_alerts"("resolved" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_date_key" ON "daily_metrics"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "escalation_contacts_user_id_contact_type_key" ON "escalation_contacts"("user_id" ASC, "contact_type" ASC);

-- CreateIndex
CREATE INDEX "escalation_ladder_config_is_active_idx" ON "escalation_ladder_config"("is_active" ASC);

-- CreateIndex
CREATE INDEX "escalation_ladder_config_level_idx" ON "escalation_ladder_config"("level" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "escalation_ladder_config_level_key" ON "escalation_ladder_config"("level" ASC);

-- CreateIndex
CREATE INDEX "escalation_logs_call_sid_idx" ON "escalation_logs"("call_sid" ASC);

-- CreateIndex
CREATE INDEX "escalation_logs_event_id_idx" ON "escalation_logs"("event_id" ASC);

-- CreateIndex
CREATE INDEX "events_received_at_idx" ON "events"("received_at" ASC);

-- CreateIndex
CREATE INDEX "events_source_idx" ON "events"("source" ASC);

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status" ASC);

-- CreateIndex
CREATE INDEX "processed_email_uids_processed_at_idx" ON "processed_email_uids"("processed_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "processed_email_uids_uid_key" ON "processed_email_uids"("uid" ASC);

-- CreateIndex
CREATE INDEX "system_health_logs_service_checked_at_idx" ON "system_health_logs"("service" ASC, "checked_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email" ASC);

-- AddForeignKey
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acknowledgments" ADD CONSTRAINT "acknowledgments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_contacts" ADD CONSTRAINT "escalation_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_ladder_config" ADD CONSTRAINT "escalation_ladder_config_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_logs" ADD CONSTRAINT "escalation_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "escalation_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_logs" ADD CONSTRAINT "escalation_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_logs" ADD CONSTRAINT "escalation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_rotations" ADD CONSTRAINT "on_call_rotations_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_rotations" ADD CONSTRAINT "on_call_rotations_secondary_user_id_fkey" FOREIGN KEY ("secondary_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
