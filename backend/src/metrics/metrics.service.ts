import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventStatus, CallStatus, SmsStatus } from '@prisma/client';

export interface ComprehensiveMetrics {
  // AI Performance Metrics
  aiMetrics: {
    totalEventsProcessed: number;
    aiSummariesGenerated: number;
    emergencyDetectionRate: number;
    falsePositiveRate: number;
    avgEmergencyScore: number;
    highConfidenceClassifications: number;
  };
  // Escalation Metrics
  escalationMetrics: {
    totalEscalations: number;
    successfulEscalations: number;
    escalationSuccessRate: number;
    avgEscalationDepth: number;
    firstContactResolutionRate: number;
    missedEscalations: number;
    escalationsInProgress: number;
  };
  // Communication Metrics
  communicationMetrics: {
    totalCallsMade: number;
    callsAnswered: number;
    callAnswerRate: number;
    totalSmsSent: number;
    smsDelivered: number;
    smsDeliveryRate: number;
    voicemailsReceived: number;
  };
  // Response Time Metrics
  responseTimeMetrics: {
    avgResponseTimeMinutes: number;
    medianResponseTimeMinutes: number;
    p95ResponseTimeMinutes: number;
    fastestResponseMinutes: number;
    slowestResponseMinutes: number;
    slaComplianceRate: number;
    slaBreaches: number;
  };
  // Source Metrics
  sourceMetrics: {
    emailEvents: number;
    chatEvents: number;
    emailPercentage: number;
    chatPercentage: number;
  };
  // Business Impact Metrics
  businessImpactMetrics: {
    afterHoursEventsHandled: number;
    eventsResolvedAutomatically: number;
    potentialSalesSaved: number;
    avgHandlingTimeMinutes: number;
    customerInquiriesCovered: number;
    downgradedNonEmergencies: number;
    timeSlotDistribution: Record<string, number>;
  };
  // Trend Metrics
  trendMetrics: {
    dailyEventTrend: Array<{ date: string; count: number }>;
    weekOverWeekChange: number;
    peakHour: number;
    peakDay: string;
  };
  // Contact Performance
  contactPerformance: Array<{
    contactName: string;
    contactPhone?: string;
    totalAssigned: number;
    acknowledged: number;
    responseRate: number;
    avgResponseTimeMinutes: number;
  }>;
}

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

    // SLA compliance (15 min) - count breaches
    const slaBreaches = eventsWithAck.filter(e => {
      const responseTime = (e.acknowledgedAt!.getTime() - e.receivedAt.getTime()) / 1000 / 60;
      return responseTime > 15;
    }).length;

    // Get current on-call
    const currentRotation = await this.prisma.onCallRotation.findFirst({
      where: {
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        primaryUser: { select: { id: true, name: true, phoneNumber: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    return {
      activeEvents: pendingEvents + escalatingEvents,
      todayEvents,
      acknowledgedToday,
      avgAckTimeMinutes: avgResponseTime,
      slaBreaches,
      currentOnCall: currentRotation?.primaryUser ? {
        name: currentRotation.primaryUser.name,
        phone: currentRotation.primaryUser.phoneNumber || 'N/A',
        startDate: currentRotation.startDate.toISOString(),
        endDate: currentRotation.endDate.toISOString(),
      } : null,
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

      const [totalEvents, acknowledgedCount, emergencyEvents] = await Promise.all([
        this.prisma.event.count({
          where: { receivedAt: { gte: date, lt: nextDate } },
        }),
        this.prisma.event.count({
          where: {
            receivedAt: { gte: date, lt: nextDate },
            status: { in: [EventStatus.acknowledged, EventStatus.downgraded] },
          },
        }),
        // Emergency events are those with emergencyScore >= 0.6
        this.prisma.event.count({
          where: {
            receivedAt: { gte: date, lt: nextDate },
            emergencyScore: { gte: 0.6 },
          },
        }),
      ]);

      result.push({
        date: date.toISOString().split('T')[0],
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        totalEvents,
        emergencyEvents,
        acknowledgedCount,
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

  async getComprehensiveMetrics(
    startDate?: Date,
    endDate?: Date,
  ): Promise<ComprehensiveMetrics> {
    const now = new Date();
    const start = startDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
    const end = endDate || now;

    // Fetch all events in the date range
    const events = await this.prisma.event.findMany({
      where: {
        receivedAt: { gte: start, lte: end },
      },
      include: {
        escalationLogs: true,
        acknowledgments: true,
      },
    });

    // Fetch escalation logs with both user and contact relations
    const escalationLogs = await this.prisma.escalationLog.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: {
        user: { select: { id: true, name: true, phoneNumber: true } },
        contact: {
          include: {
            user: { select: { id: true, name: true, phoneNumber: true } },
          },
        },
      },
    });

    // ===== AI METRICS =====
    const totalEventsProcessed = events.length;
    const aiSummariesGenerated = events.filter((e) => e.aiSummary).length;
    const emergencyEvents = events.filter(
      (e) => e.emergencyScore && Number(e.emergencyScore) >= 0.6,
    );
    const emergencyDetectionRate =
      totalEventsProcessed > 0
        ? (emergencyEvents.length / totalEventsProcessed) * 100
        : 0;
    const downgradedEvents = events.filter(
      (e) => e.status === EventStatus.downgraded,
    );
    const falsePositiveRate =
      emergencyEvents.length > 0
        ? (downgradedEvents.length / emergencyEvents.length) * 100
        : 0;
    const avgEmergencyScore =
      events.filter((e) => e.emergencyScore).length > 0
        ? events
            .filter((e) => e.emergencyScore)
            .reduce((sum, e) => sum + Number(e.emergencyScore), 0) /
          events.filter((e) => e.emergencyScore).length
        : 0;
    const highConfidenceClassifications = events.filter(
      (e) =>
        e.emergencyScore &&
        (Number(e.emergencyScore) >= 0.8 || Number(e.emergencyScore) <= 0.2),
    ).length;

    // ===== ESCALATION METRICS =====
    const escalatedEvents = events.filter(
      (e) =>
        e.status === EventStatus.escalated ||
        e.status === EventStatus.acknowledged ||
        e.status === EventStatus.downgraded ||
        e.status === EventStatus.missed,
    );
    const totalEscalations = escalatedEvents.length;
    const successfulEscalations = events.filter(
      (e) =>
        e.status === EventStatus.acknowledged ||
        e.status === EventStatus.downgraded,
    ).length;
    const escalationSuccessRate =
      totalEscalations > 0
        ? (successfulEscalations / totalEscalations) * 100
        : 0;
    const missedEscalations = events.filter(
      (e) => e.status === EventStatus.missed,
    ).length;
    const escalationsInProgress = events.filter(
      (e) => e.status === EventStatus.escalated,
    ).length;

    // Calculate average escalation depth
    const eventEscalationDepths = events
      .filter((e) => e.escalationLogs.length > 0)
      .map((e) => Math.max(...e.escalationLogs.map((l) => l.attemptNumber)));
    const avgEscalationDepth =
      eventEscalationDepths.length > 0
        ? eventEscalationDepths.reduce((a, b) => a + b, 0) /
          eventEscalationDepths.length
        : 0;

    // First contact resolution (acknowledged on first attempt)
    const firstContactResolutions = events.filter(
      (e) =>
        (e.status === EventStatus.acknowledged ||
          e.status === EventStatus.downgraded) &&
        e.escalationLogs.length > 0 &&
        Math.max(...e.escalationLogs.map((l) => l.attemptNumber)) === 1,
    ).length;
    const firstContactResolutionRate =
      successfulEscalations > 0
        ? (firstContactResolutions / successfulEscalations) * 100
        : 0;

    // ===== COMMUNICATION METRICS =====
    const callLogs = escalationLogs.filter(
      (l) => l.callStatus !== CallStatus.not_called,
    );
    const totalCallsMade = callLogs.length;
    const callsAnswered = callLogs.filter(
      (l) => l.callStatus === CallStatus.answered,
    ).length;
    const callAnswerRate =
      totalCallsMade > 0 ? (callsAnswered / totalCallsMade) * 100 : 0;

    const smsLogs = escalationLogs.filter(
      (l) => l.smsStatus !== SmsStatus.not_sent,
    );
    const totalSmsSent = smsLogs.length;
    const smsDelivered = smsLogs.filter(
      (l) => l.smsStatus === SmsStatus.delivered,
    ).length;
    const smsDeliveryRate =
      totalSmsSent > 0 ? (smsDelivered / totalSmsSent) * 100 : 0;

    const voicemailsReceived = events.filter(
      (e) => e.voicemailTranscription,
    ).length;

    // ===== RESPONSE TIME METRICS =====
    const acknowledgedEvents = events.filter((e) => e.acknowledgedAt);
    const responseTimes = acknowledgedEvents.map(
      (e) =>
        (e.acknowledgedAt!.getTime() - e.receivedAt.getTime()) / 1000 / 60,
    );
    responseTimes.sort((a, b) => a - b);

    const avgResponseTimeMinutes =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;
    const medianResponseTimeMinutes =
      responseTimes.length > 0
        ? responseTimes[Math.floor(responseTimes.length / 2)]
        : 0;
    const p95ResponseTimeMinutes =
      responseTimes.length > 0
        ? responseTimes[Math.floor(responseTimes.length * 0.95)]
        : 0;
    const fastestResponseMinutes =
      responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const slowestResponseMinutes =
      responseTimes.length > 0 ? Math.max(...responseTimes) : 0;

    const slaMinutes = 15;
    const withinSla = responseTimes.filter((t) => t <= slaMinutes).length;
    const slaComplianceRate =
      responseTimes.length > 0 ? (withinSla / responseTimes.length) * 100 : 0;
    const slaBreaches = responseTimes.filter((t) => t > slaMinutes).length;

    // ===== SOURCE METRICS =====
    const emailEvents = events.filter((e) => e.source === 'email').length;
    const chatEvents = events.filter((e) => (e.source as string) === 'chat').length;
    const emailPercentage =
      totalEventsProcessed > 0
        ? (emailEvents / totalEventsProcessed) * 100
        : 0;
    const chatPercentage =
      totalEventsProcessed > 0
        ? (chatEvents / totalEventsProcessed) * 100
        : 0;

    // ===== BUSINESS IMPACT METRICS =====
    const afterHoursEventsHandled = totalEventsProcessed;
    const eventsResolvedAutomatically = events.filter(
      (e) =>
        e.status === EventStatus.closed &&
        !e.acknowledgedById,
    ).length;
    const potentialSalesSaved = successfulEscalations; // Each handled emergency could be a saved sale
    const avgHandlingTimeMinutes = avgResponseTimeMinutes;
    const customerInquiriesCovered = totalEventsProcessed;
    const downgradedNonEmergencies = downgradedEvents.length;

    // Time slot distribution (hour of day)
    const timeSlotDistribution: Record<string, number> = {};
    for (let i = 0; i < 24; i++) {
      const hourLabel = `${i.toString().padStart(2, '0')}:00`;
      timeSlotDistribution[hourLabel] = events.filter(
        (e) => e.receivedAt.getHours() === i,
      ).length;
    }

    // ===== TREND METRICS =====
    const dailyEventTrend: Array<{ date: string; count: number }> = [];
    const daysInRange = Math.ceil(
      (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    );
    const dailyCounts: Record<string, number> = {};

    events.forEach((e) => {
      const dateKey = e.receivedAt.toISOString().split('T')[0];
      dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
    });

    for (let i = 0; i < Math.min(daysInRange, 30); i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      dailyEventTrend.push({
        date: dateKey,
        count: dailyCounts[dateKey] || 0,
      });
    }

    // Week over week change
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const thisWeekEvents = events.filter(
      (e) => e.receivedAt >= thisWeekStart,
    ).length;
    const lastWeekEvents = events.filter(
      (e) => e.receivedAt >= lastWeekStart && e.receivedAt < thisWeekStart,
    ).length;
    const weekOverWeekChange =
      lastWeekEvents > 0
        ? ((thisWeekEvents - lastWeekEvents) / lastWeekEvents) * 100
        : 0;

    // Peak hour and day
    const hourCounts = Object.entries(timeSlotDistribution);
    hourCounts.sort((a, b) => b[1] - a[1]);
    const peakHour =
      hourCounts.length > 0 ? parseInt(hourCounts[0][0].split(':')[0]) : 0;

    const dayCounts: Record<string, number> = {};
    events.forEach((e) => {
      const day = e.receivedAt.toLocaleDateString('en-US', { weekday: 'long' });
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    const dayEntries = Object.entries(dayCounts);
    dayEntries.sort((a, b) => b[1] - a[1]);
    const peakDay = dayEntries.length > 0 ? dayEntries[0][0] : 'N/A';

    // ===== CONTACT PERFORMANCE =====
    // Fetch acknowledgments to see who actually acknowledged each event
    const acknowledgments = await this.prisma.acknowledgment.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      include: {
        user: { select: { id: true, name: true, phoneNumber: true } },
        event: { select: { receivedAt: true } },
      },
    });

    // Build a map of eventId -> userId who acknowledged it
    const eventAckMap: Record<string, { userId: string; acknowledgedAt: Date; eventReceivedAt: Date }> = {};
    acknowledgments.forEach((ack) => {
      // Store first acknowledgment per event
      if (!eventAckMap[ack.eventId]) {
        eventAckMap[ack.eventId] = {
          userId: ack.userId,
          acknowledgedAt: ack.acknowledgedAt,
          eventReceivedAt: ack.event.receivedAt,
        };
      }
    });

    const contactPerformance: ComprehensiveMetrics['contactPerformance'] = [];
    const contactStats: Record<
      string,
      { name: string; phone: string; total: number; acked: number; responseTimes: number[] }
    > = {};

    escalationLogs.forEach((log) => {
      // Use contact's user name/phone first (escalation contacts), fall back to direct user
      const contactName = log.contact?.user?.name || log.user?.name || 'Unknown';
      const contactPhone = log.contact?.user?.phoneNumber || log.user?.phoneNumber || '';
      // Get the actual user ID (from contact's user or direct user)
      const contactUserId = log.contact?.user?.id || log.user?.id || log.userId;

      if (!contactStats[contactUserId]) {
        contactStats[contactUserId] = {
          name: contactName,
          phone: contactPhone,
          total: 0,
          acked: 0,
          responseTimes: [],
        };
      }
      contactStats[contactUserId].total++;

      // Check if THIS user actually acknowledged this event (not just if event was acknowledged)
      const eventAck = eventAckMap[log.eventId];
      if (eventAck && eventAck.userId === contactUserId) {
        contactStats[contactUserId].acked++;
        // Calculate response time from event received to acknowledgment
        const responseTime =
          (eventAck.acknowledgedAt.getTime() - eventAck.eventReceivedAt.getTime()) /
          1000 /
          60;
        contactStats[contactUserId].responseTimes.push(responseTime);
      }
    });

    Object.values(contactStats).forEach((stat) => {
      // Only include contacts with a name
      if (stat.name && stat.name !== 'Unknown') {
        contactPerformance.push({
          contactName: stat.name,
          contactPhone: stat.phone || undefined,
          totalAssigned: stat.total,
          acknowledged: stat.acked,
          responseRate: stat.total > 0 ? (stat.acked / stat.total) * 100 : 0,
          avgResponseTimeMinutes:
            stat.responseTimes.length > 0
              ? stat.responseTimes.reduce((a, b) => a + b, 0) /
                stat.responseTimes.length
              : 0,
        });
      }
    });

    // Sort by total assigned (most active first), then by response rate
    contactPerformance.sort((a, b) => {
      if (b.totalAssigned !== a.totalAssigned) {
        return b.totalAssigned - a.totalAssigned;
      }
      return b.responseRate - a.responseRate;
    });

    return {
      aiMetrics: {
        totalEventsProcessed,
        aiSummariesGenerated,
        emergencyDetectionRate: Math.round(emergencyDetectionRate * 10) / 10,
        falsePositiveRate: Math.round(falsePositiveRate * 10) / 10,
        avgEmergencyScore: Math.round(avgEmergencyScore * 100) / 100,
        highConfidenceClassifications,
      },
      escalationMetrics: {
        totalEscalations,
        successfulEscalations,
        escalationSuccessRate: Math.round(escalationSuccessRate * 10) / 10,
        avgEscalationDepth: Math.round(avgEscalationDepth * 10) / 10,
        firstContactResolutionRate:
          Math.round(firstContactResolutionRate * 10) / 10,
        missedEscalations,
        escalationsInProgress,
      },
      communicationMetrics: {
        totalCallsMade,
        callsAnswered,
        callAnswerRate: Math.round(callAnswerRate * 10) / 10,
        totalSmsSent,
        smsDelivered,
        smsDeliveryRate: Math.round(smsDeliveryRate * 10) / 10,
        voicemailsReceived,
      },
      responseTimeMetrics: {
        avgResponseTimeMinutes: Math.round(avgResponseTimeMinutes * 10) / 10,
        medianResponseTimeMinutes:
          Math.round(medianResponseTimeMinutes * 10) / 10,
        p95ResponseTimeMinutes: Math.round(p95ResponseTimeMinutes * 10) / 10,
        fastestResponseMinutes: Math.round(fastestResponseMinutes * 10) / 10,
        slowestResponseMinutes: Math.round(slowestResponseMinutes * 10) / 10,
        slaComplianceRate: Math.round(slaComplianceRate * 10) / 10,
        slaBreaches,
      },
      sourceMetrics: {
        emailEvents,
        chatEvents,
        emailPercentage: Math.round(emailPercentage * 10) / 10,
        chatPercentage: Math.round(chatPercentage * 10) / 10,
      },
      businessImpactMetrics: {
        afterHoursEventsHandled,
        eventsResolvedAutomatically,
        potentialSalesSaved,
        avgHandlingTimeMinutes: Math.round(avgHandlingTimeMinutes * 10) / 10,
        customerInquiriesCovered,
        downgradedNonEmergencies,
        timeSlotDistribution,
      },
      trendMetrics: {
        dailyEventTrend,
        weekOverWeekChange: Math.round(weekOverWeekChange * 10) / 10,
        peakHour,
        peakDay,
      },
      contactPerformance,
    };
  }
}
