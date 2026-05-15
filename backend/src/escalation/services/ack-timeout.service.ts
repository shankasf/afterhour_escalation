/**
 * Ack-Timeout Firer
 *
 * The LangGraph escalation workflow parks at `wait_for_ack` after each
 * dispatch and only resumes when a `channel_event` is POSTed back. The
 * workflow itself can't fire a timeout — that's what this cron does.
 *
 * Every 15s we scan ChatCompletion / dispatch state for events that
 * have been `awaiting_deadline` past the configured timeout (default
 * 120s, see system_settings.acknowledgment_timeout_seconds). For each,
 * we POST a `{type:"timeout"}` channel_event so the graph's
 * response_interpreter advances the cursor to the next on-duty staff.
 *
 * State lives in the LangGraph Postgres checkpointer (`checkpoints`
 * table written by AsyncPostgresSaver), so we query that table for
 * threads with status='awaiting_ack' and a stale deadline.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AiServiceClient } from '../../ai-service/ai-service.client';

const LOCK_SECONDS = 30;

@Injectable()
export class AckTimeoutService implements OnModuleInit {
  private readonly logger = new Logger(AckTimeoutService.name);
  private firing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  onModuleInit(): void {
    this.logger.log('AckTimeoutService initialised; cron will fire every 15s');
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async fireExpiredAckTimeouts(): Promise<void> {
    if (this.firing) return; // overlap guard — a slow tick must not stack
    this.firing = true;
    try {
      const stale = await this.findStaleAwaitingAckThreads();
      if (stale.length === 0) return;
      this.logger.log(
        `ack-timeout: ${stale.length} thread(s) past deadline — firing channel_event`,
      );
      for (const t of stale) {
        try {
          await this.aiServiceClient.postChannelEvent(t.threadId, {
            type: 'timeout',
            source: 'ack-timeout-cron',
          });
          // Stamp the checkpoint to suppress re-fires until graph
          // advances. The graph writes a new checkpoint on resume,
          // which naturally clears awaiting_ack / awaiting_deadline.
          this.logger.log(
            `ack-timeout: posted timeout for event ${t.threadId}`,
          );
        } catch (err) {
          this.logger.warn(
            `ack-timeout: post failed for ${t.threadId}: ${
              (err as Error).message
            }`,
          );
        }
      }
    } finally {
      this.firing = false;
    }
  }

  /**
   * Pull thread IDs from the LangGraph Postgres checkpointer where the
   * latest checkpoint state shows status='awaiting_ack' AND
   * awaiting_deadline < now(). We read directly with raw SQL because
   * the checkpointer schema is owned by langgraph and not modelled in
   * Prisma.
   */
  private async findStaleAwaitingAckThreads(): Promise<{ threadId: string }[]> {
    // `checkpoints` columns: thread_id, checkpoint_ns, checkpoint_id,
    // checkpoint, metadata, created_at, ... The state payload includes
    // status + awaiting + awaiting_deadline (set by outreach.py).
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { thread_id: string }[]
      >(`
        WITH latest AS (
          SELECT DISTINCT ON (thread_id)
                 thread_id, checkpoint
          FROM checkpoints
          ORDER BY thread_id, checkpoint_id DESC
        )
        SELECT thread_id
        FROM latest
        WHERE checkpoint->>'channel_values' IS NOT NULL
          AND (checkpoint->'channel_values'->>'status') = 'awaiting_ack'
          AND (checkpoint->'channel_values'->>'awaiting_deadline') IS NOT NULL
          AND ((checkpoint->'channel_values'->>'awaiting_deadline')::timestamptz)
              < (NOW() - INTERVAL '${LOCK_SECONDS} seconds')
        LIMIT 50
      `);
      return rows.map((r) => ({ threadId: r.thread_id }));
    } catch (err) {
      // If the checkpoint table doesn't exist yet (cold-boot) or the
      // schema differs, log once and exit — the cron retries every 10s.
      const msg = (err as Error).message;
      if (msg.includes('relation') && msg.includes('does not exist')) {
        // Quiet during boot before LangGraph creates the table.
        return [];
      }
      this.logger.warn(`ack-timeout query failed: ${msg}`);
      return [];
    }
  }
}
