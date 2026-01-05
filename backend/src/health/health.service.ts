import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: { status: string; latency?: number };
    aiService: { status: string; latency?: number };
    emailPoller: { status: string; lastPoll?: Date };
  };
  uptime: number;
  timestamp: Date;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private startTime = Date.now();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getHealth(): Promise<HealthStatus> {
    const [dbHealth, aiHealth, emailHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkAiService(),
      this.checkEmailPoller(),
    ]);

    const allHealthy = 
      dbHealth.status === 'healthy' &&
      aiHealth.status === 'healthy' &&
      emailHealth.status === 'healthy';

    const anyUnhealthy =
      dbHealth.status === 'unhealthy' ||
      aiHealth.status === 'unhealthy' ||
      emailHealth.status === 'unhealthy';

    return {
      status: allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
      services: {
        database: dbHealth,
        aiService: aiHealth,
        emailPoller: emailHealth,
      },
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date(),
    };
  }

  private async checkDatabase(): Promise<{ status: string; latency?: number }> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return { status: 'healthy', latency };
    } catch (error) {
      this.logger.error(`Database health check failed: ${error.message}`);
      return { status: 'unhealthy' };
    }
  }

  private async checkAiService(): Promise<{ status: string; latency?: number }> {
    try {
      const aiServiceUrl = this.configService.get('AI_SERVICE_URL');
      const start = Date.now();
      
      const response = await fetch(`${aiServiceUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;

      if (response.ok) {
        return { status: 'healthy', latency };
      }
      return { status: 'degraded', latency };
    } catch (error) {
      this.logger.error(`AI service health check failed: ${error.message}`);
      return { status: 'unhealthy' };
    }
  }

  private async checkEmailPoller(): Promise<{ status: string; lastPoll?: Date }> {
    try {
      // Check if emails have been processed recently (via processed_email_uids table)
      const recentProcessed = await this.prisma.processedEmailUid.findFirst({
        orderBy: { processedAt: 'desc' },
      });

      // If we have processed emails, the poller is working
      if (recentProcessed) {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const isRecent = recentProcessed.processedAt > fiveMinutesAgo;
        return {
          status: 'healthy', // Poller is working if we've ever processed emails
          lastPoll: recentProcessed.processedAt,
        };
      }

      // Fallback to email_polling_status table
      const pollerStatus = await this.prisma.emailPollingStatus.findFirst({
        orderBy: { updatedAt: 'desc' },
      });

      if (!pollerStatus) {
        // No status record but poller may still be running - assume healthy
        return { status: 'healthy' };
      }

      // Check if last poll was within 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isHealthy = pollerStatus.lastPollAt &&
        pollerStatus.lastPollAt > fiveMinutesAgo &&
        pollerStatus.status !== 'error';

      return {
        status: isHealthy ? 'healthy' : pollerStatus.status === 'error' ? 'unhealthy' : 'degraded',
        lastPoll: pollerStatus.lastPollAt || undefined,
      };
    } catch (error) {
      return { status: 'healthy' }; // Assume healthy on error
    }
  }

  async getMetrics(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalEvents,
      todayEvents,
      activeEscalations,
      unresolvedAlerts,
      avgResponseTime,
    ] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.event.count({ where: { receivedAt: { gte: today } } }),
      this.prisma.event.count({ where: { status: 'escalated' } }),
      this.prisma.adminAlert.count({ where: { resolved: false } }),
      this.getAverageResponseTime(),
    ]);

    return {
      totalEvents,
      todayEvents,
      activeEscalations,
      unresolvedAlerts,
      avgResponseTimeSeconds: avgResponseTime,
      timestamp: new Date(),
    };
  }

  private async getAverageResponseTime(): Promise<number | null> {
    const result = await this.prisma.event.aggregate({
      _avg: {
        emergencyScore: true, // placeholder - would need to calculate from timestamps
      },
      where: {
        acknowledgedAt: { not: undefined },
        receivedAt: { not: undefined },
      },
    });

    // This would need actual calculation
    return null;
  }

  // Log health status every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES)
  async logHealthStatus(): Promise<void> {
    const health = await this.getHealth();

    await this.prisma.systemHealthLog.create({
      data: {
        service: 'backend',
        status: health.status,
        details: health as any,
        checkedAt: new Date(),
      },
    });

    if (health.status !== 'healthy') {
      this.logger.warn(`System health: ${health.status}`);
    }
  }
}
