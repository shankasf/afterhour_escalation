import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

interface SaveSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  origin: string;
  userAgent?: string;
  userId?: string;
  customerSessionId?: string;
}

/**
 * Web Push notification service. Persists subscriptions in Prisma and
 * fans out notifications via the `web-push` library.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.configService.get<string>('WEB_PUSH_VAPID_PUBLIC');
    const privateKey = this.configService.get<string>('WEB_PUSH_VAPID_PRIVATE');
    const subject =
      this.configService.get<string>('WEB_PUSH_VAPID_SUBJECT') ||
      'mailto:ops@amsterdamhostel.cloud';

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'WEB_PUSH_VAPID_PUBLIC / WEB_PUSH_VAPID_PRIVATE not set; push disabled',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
    this.logger.log('Web Push configured');
  }

  async saveSubscription(input: SaveSubscriptionInput): Promise<any> {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        p256dh: input.p256dh,
        auth: input.auth,
        origin: input.origin,
        userAgent: input.userAgent,
        userId: input.userId,
        customerSessionId: input.customerSessionId,
      },
      create: {
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        origin: input.origin,
        userAgent: input.userAgent,
        userId: input.userId,
        customerSessionId: input.customerSessionId,
      },
    });
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  async sendToUser(
    userId: string,
    payload: Record<string, any>,
  ): Promise<{ sent: number; failed: number }> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    return this.fanOut(subs, payload);
  }

  async sendToCustomer(
    customerSessionId: string,
    payload: Record<string, any>,
  ): Promise<{ sent: number; failed: number }> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { customerSessionId },
    });
    return this.fanOut(subs, payload);
  }

  async sendToAdmins(
    payload: Record<string, any>,
  ): Promise<{ sent: number; failed: number }> {
    const subs = await this.prisma.pushSubscription.findMany({
      where: {
        user: {
          role: UserRole.admin,
        },
      },
    });
    return this.fanOut(subs, payload);
  }

  private async fanOut(
    subs: Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    payload: Record<string, any>,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.configured) {
      this.logger.warn('Push not configured; skipping fan-out');
      return { sent: 0, failed: subs.length };
    }

    const body = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    const now = new Date();

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
          );
          sent += 1;
          await this.prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { lastUsedAt: now },
          });
        } catch (err: any) {
          failed += 1;
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            this.logger.warn(
              `Removing dead push subscription ${sub.endpoint}`,
            );
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          } else {
            this.logger.error(
              `webpush.sendNotification failed (status=${status}): ${err?.message ?? 'unknown'}`,
            );
          }
        }
      }),
    );

    return { sent, failed };
  }
}
