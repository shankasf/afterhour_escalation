/**
 * Email Tracking Service
 * Manages processed email UIDs in the database.
 * Replaces file-based tracking for reliability.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailTrackingService {
  private readonly logger = new Logger(EmailTrackingService.name);

  // Maximum number of UIDs to keep (prevent unbounded growth)
  private readonly MAX_UIDS = 2000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all processed email UIDs.
   * Returns the most recent UIDs up to MAX_UIDS.
   */
  async getProcessedUids(): Promise<string[]> {
    const records = await this.prisma.processedEmailUid.findMany({
      orderBy: { processedAt: 'desc' },
      take: this.MAX_UIDS,
      select: { uid: true },
    });

    return records.map((r) => r.uid);
  }

  /**
   * Check if a UID has been processed.
   */
  async isProcessed(uid: string): Promise<boolean> {
    const count = await this.prisma.processedEmailUid.count({
      where: { uid },
    });
    return count > 0;
  }

  /**
   * Mark a UID as processed.
   */
  async markProcessed(uid: string, processedAt?: string): Promise<void> {
    const timestamp = processedAt ? new Date(processedAt) : new Date();

    await this.prisma.processedEmailUid.upsert({
      where: { uid },
      update: { processedAt: timestamp },
      create: { uid, processedAt: timestamp },
    });

    this.logger.debug(`Marked email UID as processed: ${uid}`);

    // Cleanup old records periodically
    await this.cleanupOldRecords();
  }

  /**
   * Clean up old records to prevent unbounded growth.
   * Keeps only the most recent MAX_UIDS records.
   */
  private async cleanupOldRecords(): Promise<void> {
    const count = await this.prisma.processedEmailUid.count();

    if (count > this.MAX_UIDS) {
      // Find the oldest records to delete
      const toDelete = await this.prisma.processedEmailUid.findMany({
        orderBy: { processedAt: 'asc' },
        take: count - this.MAX_UIDS,
        select: { id: true },
      });

      if (toDelete.length > 0) {
        await this.prisma.processedEmailUid.deleteMany({
          where: {
            id: { in: toDelete.map((r) => r.id) },
          },
        });

        this.logger.debug(`Cleaned up ${toDelete.length} old email UID records`);
      }
    }
  }
}
