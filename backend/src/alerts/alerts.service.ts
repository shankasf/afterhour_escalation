import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AlertType, AdminAlert } from '@prisma/client';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Initialize email transporter
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASSWORD'),
      },
    });
  }

  async findAll(resolved?: boolean): Promise<AdminAlert[]> {
    const where = resolved !== undefined ? { resolved } : {};
    return this.prisma.adminAlert.findMany({
      where,
      include: {
        event: { select: { id: true, subject: true, source: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
      orderBy: { alertedAt: 'desc' },
    });
  }

  async findById(id: string): Promise<AdminAlert | null> {
    return this.prisma.adminAlert.findUnique({
      where: { id },
      include: {
        event: true,
        resolvedBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(data: {
    eventId?: string;
    alertType: AlertType;
    message: string;
    details?: any;
  }): Promise<AdminAlert> {
    this.logger.warn({
      message: 'Alert created',
      alertType: data.alertType,
      eventId: data.eventId,
      alertMessage: data.message,
    });

    const alert = await this.prisma.adminAlert.create({
      data: {
        eventId: data.eventId,
        alertType: data.alertType,
        message: data.message,
        details: data.details as any,
        alertedAt: new Date(),
      },
    });

    // Send notification based on alert type
    const isUrgent = [
      'no_acknowledgment',
      'call_failure',
      'sms_failure',
    ].includes(data.alertType as string);

    if (isUrgent) {
      await this.sendUrgentNotification(alert);
    } else {
      await this.sendEmailNotification(alert);
    }

    return alert;
  }

  async resolve(id: string, userId: string): Promise<AdminAlert> {
    this.logger.log({
      message: 'Alert resolved (updated)',
      alertId: id,
      userId,
    });
    return this.prisma.adminAlert.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });
  }

  private async sendUrgentNotification(alert: AdminAlert): Promise<void> {
    await this.sendEmailNotification(alert);
    this.logger.log(`Urgent alert ${alert.id} - email notification dispatched`);
  }

  private async sendEmailNotification(alert: AdminAlert): Promise<void> {
    const adminEmail = this.configService.get('ADMIN_EMAIL');
    if (!adminEmail) {
      this.logger.warn('No admin email configured, skipping notification');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.configService.get('SMTP_USER'),
        to: adminEmail,
        subject: `[Escalation System] ${alert.alertType}: ${alert.message}`,
        html: `
          <h2>System Alert</h2>
          <p><strong>Type:</strong> ${alert.alertType}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Time:</strong> ${alert.alertedAt.toISOString()}</p>
          ${alert.details ? `<p><strong>Details:</strong> <pre>${JSON.stringify(alert.details, null, 2)}</pre></p>` : ''}
        `,
      });
      this.logger.log(`Email notification sent for alert ${alert.id}`);
    } catch (error) {
      this.logger.error(`Failed to send email notification: ${error.message}`);
    }
  }

  async getUnresolvedCount(): Promise<number> {
    return this.prisma.adminAlert.count({ where: { resolved: false } });
  }
}
