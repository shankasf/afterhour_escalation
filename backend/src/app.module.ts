import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { EscalationModule } from './escalation/escalation.module';
import { RotationModule } from './rotation/rotation.module';
import { AcknowledgmentModule } from './acknowledgment/acknowledgment.module';
import { AlertsModule } from './alerts/alerts.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';
import { WebsocketModule } from './websocket/websocket.module';
import { AiServiceModule } from './ai-service/ai-service.module';
import { MetricsModule } from './metrics/metrics.module';
import { EmailTrackingModule } from './email-tracking/email-tracking.module';
import { AppConfigModule } from './common/config/app-config.module';
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AppConfigModule,
    AuthModule,
    UsersModule,
    EventsModule,
    EscalationModule,
    RotationModule,
    AcknowledgmentModule,
    AlertsModule,
    SettingsModule,
    HealthModule,
    WebsocketModule,
    AiServiceModule,
    MetricsModule,
    EmailTrackingModule,
    LogsModule,
  ],
})
export class AppModule {}
