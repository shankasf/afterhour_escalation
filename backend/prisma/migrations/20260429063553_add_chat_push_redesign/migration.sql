-- CreateEnum
CREATE TYPE "chat_session_status" AS ENUM ('active', 'idle', 'abandoned', 'converted', 'closed');

-- CreateEnum
CREATE TYPE "chat_role" AS ENUM ('customer', 'agent', 'employee');

-- CreateEnum
CREATE TYPE "chat_modality" AS ENUM ('text', 'voice');

-- AlterEnum
ALTER TYPE "event_source" ADD VALUE 'chat';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "unavailable_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "session_token" VARCHAR(255) NOT NULL,
    "customer_name" VARCHAR(255),
    "customer_email" VARCHAR(255),
    "customer_phone" VARCHAR(50),
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "chat_session_status" NOT NULL DEFAULT 'active',
    "voice_call_count" INTEGER NOT NULL DEFAULT 0,
    "event_id" TEXT,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "chat_role" NOT NULL,
    "user_id" TEXT,
    "text" TEXT NOT NULL,
    "modality" "chat_modality" NOT NULL DEFAULT 'text',
    "audio_url" VARCHAR(500),
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "customer_session_id" TEXT,
    "origin" VARCHAR(255) NOT NULL,
    "endpoint" VARCHAR(500) NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_session_token_key" ON "chat_sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_event_id_key" ON "chat_sessions"("event_id");

-- CreateIndex
CREATE INDEX "chat_sessions_session_token_idx" ON "chat_sessions"("session_token");

-- CreateIndex
CREATE INDEX "chat_sessions_status_idx" ON "chat_sessions"("status");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_customer_session_id_idx" ON "push_subscriptions"("customer_session_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_customer_session_id_fkey" FOREIGN KEY ("customer_session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
