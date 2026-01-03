/**
 * Escalation Ladder Configuration Service
 * Provides data-driven escalation ladder from database.
 * Replaces hard-coded ladder configuration.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscalationLadderConfig } from '@prisma/client';

export interface LadderLevel {
  level: number;
  role: string;
  userId?: string;
  timeoutSeconds: number;
  isRotation: boolean;
}

@Injectable()
export class LadderConfigService implements OnModuleInit {
  private readonly logger = new Logger(LadderConfigService.name);
  private cachedLadder: LadderLevel[] = [];
  private lastRefresh: Date | null = null;
  private readonly cacheExpiryMs = 60000; // 1 minute cache

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refreshLadder();
  }

  /**
   * Get the escalation ladder configuration.
   * Uses cached data if available and not expired.
   */
  async getLadder(): Promise<LadderLevel[]> {
    if (this.shouldRefresh()) {
      await this.refreshLadder();
    }
    return [...this.cachedLadder];
  }

  /**
   * Force refresh the ladder configuration from database.
   */
  async refreshLadder(): Promise<void> {
    try {
      const configs = await this.prisma.escalationLadderConfig.findMany({
        where: { isActive: true },
        orderBy: { level: 'asc' },
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true },
          },
        },
      });

      this.cachedLadder = configs.map((config) => ({
        level: config.level,
        role: config.role,
        userId: config.userId || undefined,
        timeoutSeconds: config.timeoutSeconds,
        isRotation: config.isRotation,
      }));

      this.lastRefresh = new Date();
      this.logger.debug(`Loaded ${this.cachedLadder.length} escalation ladder levels`);
    } catch (error) {
      this.logger.error(`Failed to refresh escalation ladder: ${error.message}`);
      // If we have cached data, keep using it
      if (this.cachedLadder.length === 0) {
        // Fall back to default ladder
        this.cachedLadder = this.getDefaultLadder();
      }
    }
  }

  /**
   * Get a specific level from the ladder.
   */
  async getLevel(level: number): Promise<LadderLevel | undefined> {
    const ladder = await this.getLadder();
    return ladder.find((l) => l.level === level);
  }

  /**
   * Get the timeout for a specific level.
   */
  async getTimeoutForLevel(level: number): Promise<number> {
    const levelConfig = await this.getLevel(level);
    return levelConfig?.timeoutSeconds ?? 120;
  }

  /**
   * Create or update a ladder level.
   */
  async upsertLevel(data: {
    level: number;
    role: string;
    userId?: string;
    timeoutSeconds?: number;
    isRotation?: boolean;
    isActive?: boolean;
  }): Promise<EscalationLadderConfig> {
    const result = await this.prisma.escalationLadderConfig.upsert({
      where: { level: data.level },
      update: {
        role: data.role,
        userId: data.userId,
        timeoutSeconds: data.timeoutSeconds ?? 120,
        isRotation: data.isRotation ?? false,
        isActive: data.isActive ?? true,
      },
      create: {
        level: data.level,
        role: data.role,
        userId: data.userId,
        timeoutSeconds: data.timeoutSeconds ?? 120,
        isRotation: data.isRotation ?? false,
        isActive: data.isActive ?? true,
      },
    });

    // Invalidate cache
    this.lastRefresh = null;

    return result;
  }

  /**
   * Delete a ladder level.
   */
  async deleteLevel(level: number): Promise<void> {
    await this.prisma.escalationLadderConfig.delete({
      where: { level },
    });
    this.lastRefresh = null;
  }

  /**
   * Deactivate a ladder level.
   */
  async deactivateLevel(level: number): Promise<void> {
    await this.prisma.escalationLadderConfig.update({
      where: { level },
      data: { isActive: false },
    });
    this.lastRefresh = null;
  }

  /**
   * Seed the default escalation ladder.
   */
  async seedDefaultLadder(): Promise<void> {
    const defaultLadder = this.getDefaultLadder();

    for (const level of defaultLadder) {
      await this.prisma.escalationLadderConfig.upsert({
        where: { level: level.level },
        update: {},
        create: {
          level: level.level,
          role: level.role,
          timeoutSeconds: level.timeoutSeconds,
          isRotation: level.isRotation,
          isActive: true,
        },
      });
    }

    this.logger.log(`Seeded ${defaultLadder.length} default escalation ladder levels`);
    this.lastRefresh = null;
  }

  private shouldRefresh(): boolean {
    if (!this.lastRefresh) return true;
    const elapsed = Date.now() - this.lastRefresh.getTime();
    return elapsed > this.cacheExpiryMs;
  }

  private getDefaultLadder(): LadderLevel[] {
    return [
      { level: 1, role: 'Primary On-Call', timeoutSeconds: 120, isRotation: true },
      { level: 2, role: 'Secondary On-Call', timeoutSeconds: 120, isRotation: true },
      { level: 3, role: 'Manager', timeoutSeconds: 120, isRotation: false },
      { level: 4, role: 'Director', timeoutSeconds: 120, isRotation: false },
      { level: 5, role: 'VP Operations', timeoutSeconds: 120, isRotation: false },
      { level: 6, role: 'Executive On-Call', timeoutSeconds: 120, isRotation: false },
    ];
  }
}
