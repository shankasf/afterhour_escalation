import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventStatus } from '@prisma/client';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardMetrics(): Promise<any> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Today's events
    const todayEvents = await this.prisma.event.count({
      where: { receivedAt: { gte: today } },
    });

    // Pending events
    const pendingEvents = await this.prisma.event.count({
      where: { status: EventStatus.pending },
    });

    // Escalating events
    const escalatingEvents = await this.prisma.event.count({
      where: { status: EventStatus.escalated },
    });

    // Acknowledged today
    const acknowledgedToday = await this.prisma.event.count({
      where: {
        acknowledgedAt: { gte: today },
        status: { in: [EventStatus.acknowledged, EventStatus.downgraded] },
      },
    });

    // Average response time today
    const eventsWithAck = await this.prisma.event.findMany({
      where: {
        acknowledgedAt: { gte: today },
      },
      select: { receivedAt: true, acknowledgedAt: true },
    });

    let avgResponseTime = 0;
    if (eventsWithAck.length > 0) {
      const totalTime = eventsWithAck.reduce((sum, e) => {
        return sum + (e.acknowledgedAt!.getTime() - e.receivedAt.getTime());
      }, 0);
      avgResponseTime = Math.round(totalTime / eventsWithAck.length / 1000 / 60); // minutes
    }

    // SLA compliance (15 min)
    const withinSla = eventsWithAck.filter(e => {
      const responseTime = (e.acknowledgedAt!.getTime() - e.receivedAt.getTime()) / 1000 / 60;
      return responseTime <= 15;
    }).length;
    const slaRate = eventsWithAck.length > 0 ? Math.round((withinSla / eventsWithAck.length) * 100) : 100;

    return {
      todayEvents,
      pendingEvents,
      escalatingEvents,
      acknowledgedToday,
      avgResponseTimeMinutes: avgResponseTime,
      slaComplianceRate: slaRate,
    };
  }

  async getWeeklyMetrics(): Promise<any[]> {
    const result = [];
    const now = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const [total, acknowledged, escalated] = await Promise.all([
        this.prisma.event.count({
          where: { receivedAt: { gte: date, lt: nextDate } },
        }),
        this.prisma.event.count({
          where: {
            receivedAt: { gte: date, lt: nextDate },
            status: { in: [EventStatus.acknowledged, EventStatus.downgraded] },
          },
        }),
        this.prisma.event.count({
          where: {
            receivedAt: { gte: date, lt: nextDate },
            status: EventStatus.escalated,
          },
        }),
      ]);

      result.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        total,
        acknowledged,
        escalated,
      });
    }

    return result;
  }

  async getDailyMetrics(date?: Date): Promise<any> {
    const targetDate = date || new Date();
    targetDate.setHours(0, 0, 0, 0);

    const metric = await this.prisma.dailyMetric.findUnique({
      where: { date: targetDate },
    });

    if (metric) return metric;

    // Calculate if not exists
    return this.calculateDailyMetrics(targetDate);
  }

  async getMetricsRange(startDate: Date, endDate: Date): Promise<any[]> {
    return this.prisma.dailyMetric.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });
  }

  async getSlaCompliance(startDate?: Date, endDate?: Date): Promise<any> {
    const where: any = {
      status: { in: [EventStatus.acknowledged, EventStatus.downgraded] },
    };

    if (startDate) {
      where.receivedAt = { gte: startDate };
    }
    if (endDate) {
      where.receivedAt = { ...where.receivedAt, lte: endDate };
    }

    const events = await this.prisma.event.findMany({
      where,
      select: {
        receivedAt: true,
        acknowledgedAt: true,
      },
    });

    let totalWithAck = 0;
    let withinSla = 0;
    let totalResponseTime = 0;

    const slaMinutes = 15;

    for (const event of events) {
      if (event.acknowledgedAt) {
        totalWithAck++;
        const responseTime = 
          (event.acknowledgedAt.getTime() - event.receivedAt.getTime()) / 1000 / 60;
        totalResponseTime += responseTime;

        if (responseTime <= slaMinutes) {
          withinSla++;
        }
      }
    }

    return {
      totalEvents: events.length,
      acknowledgedEvents: totalWithAck,
      withinSla,
      slaComplianceRate: totalWithAck > 0 ? (withinSla / totalWithAck) * 100 : 0,
      avgResponseTimeMinutes: totalWithAck > 0 ? totalResponseTime / totalWithAck : 0,
    };
  }

  private async calculateDailyMetrics(date: Date): Promise<any> {
    const nextDay = new Date(date);
    nextDay.setDate(date.getDate() + 1);

    const events = await this.prisma.event.findMany({
      where: {
        receivedAt: { gte: date, lt: nextDay },
      },
    });

    const emailEvents = events.filter(e => e.source === 'email').length;
    const dialpadEvents = events.filter(e => e.source === 'dialpad').length;
    const escalatedEvents = events.filter(
      e => e.status === EventStatus.escalated || 
           e.status === EventStatus.acknowledged ||
           e.status === EventStatus.downgraded
    ).length;
    const acknowledgedEvents = events.filter(
      e => e.status === EventStatus.acknowledged || 
           e.status === EventStatus.downgraded
    ).length;
    const missedEvents = events.filter(e => e.status === EventStatus.missed).length;

    // Calculate average response time
    let totalResponseTime = 0;
    let eventsWithResponse = 0;

    for (const event of events) {
      if (event.acknowledgedAt) {
        const responseTime = 
          (event.acknowledgedAt.getTime() - event.receivedAt.getTime()) / 1000;
        totalResponseTime += responseTime;
        eventsWithResponse++;
      }
    }

    const avgResponseTimeSeconds = eventsWithResponse > 0 
      ? Math.round(totalResponseTime / eventsWithResponse) 
      : null;

    // SLA compliance (15 minutes)
    const slaSeconds = 15 * 60;
    let withinSla = 0;
    for (const event of events) {
      if (event.acknowledgedAt) {
        const responseTime = 
          (event.acknowledgedAt.getTime() - event.receivedAt.getTime()) / 1000;
        if (responseTime <= slaSeconds) withinSla++;
      }
    }
    const slaComplianceRate = eventsWithResponse > 0 
      ? (withinSla / eventsWithResponse) * 100 
      : null;

    return {
      date,
      totalEvents: events.length,
      emailEvents,
      dialpadEvents,
      escalatedEvents,
      acknowledgedEvents,
      missedEvents,
      avgResponseTimeSeconds,
      slaComplianceRate,
    };
  }

  // Generate daily metrics at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateDailyMetrics(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const metrics = await this.calculateDailyMetrics(yesterday);

    await this.prisma.dailyMetric.upsert({
      where: { date: yesterday },
      update: metrics,
      create: metrics,
    });
  }
}
