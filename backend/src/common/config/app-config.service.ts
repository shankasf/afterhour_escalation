/**
 * Centralized Application Configuration Service
 * Single source of truth for all application configuration.
 * Combines environment variables with database-stored settings.
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface AppConfig {
  // Service URLs
  backendUrl: string;
  aiServiceUrl: string;
  frontendUrl: string;

  // Authentication
  jwtSecret: string;
  jwtExpiresIn: string;
  internalApiKey: string;

  // Database
  databaseUrl: string;

  // Email Configuration
  imap: {
    host: string;
    port: number;
    user: string;
    password: string;
    encryption: string;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    encryption: string;
  };

  // Twilio
  twilio: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    webhookUrl: string;
  };

  // Escalation Settings
  escalation: {
    emergencyScoreThreshold: number;
    acknowledgmentTimeoutSeconds: number;
    maxEscalationAttempts: number;
  };

  // Feature Flags
  features: {
    emailPollingEnabled: boolean;
    twilioEnabled: boolean;
    aiServiceEnabled: boolean;
  };
}

@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);
  private config: AppConfig;
  private dbSettings: Map<string, string> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.loadConfiguration();
  }

  /**
   * Load configuration from environment and database.
   */
  async loadConfiguration(): Promise<void> {
    // Load database settings
    await this.loadDbSettings();

    // Build config object
    this.config = {
      backendUrl: this.env('BACKEND_URL', 'http://localhost:3004'),
      aiServiceUrl: this.env('AI_SERVICE_URL', 'http://localhost:8083'),
      frontendUrl: this.env('FRONTEND_URL', 'http://localhost:3000'),

      jwtSecret: this.env('JWT_SECRET', 'change-me-in-production'),
      jwtExpiresIn: this.env('JWT_EXPIRES_IN', '24h'),
      internalApiKey: this.env('INTERNAL_API_KEY', 'internal-service-key'),

      databaseUrl: this.env('DATABASE_URL', ''),

      imap: {
        host: this.env('IMAP_HOST', 'imap.gmail.com'),
        port: this.envNumber('IMAP_PORT', 993),
        user: this.env('IMAP_USER', ''),
        password: this.env('IMAP_PASSWORD', ''),
        encryption: this.env('IMAP_ENCRYPTION', 'SSL'),
      },

      smtp: {
        host: this.env('SMTP_HOST', 'smtp.gmail.com'),
        port: this.envNumber('SMTP_PORT', 587),
        user: this.env('SMTP_USER', ''),
        password: this.env('SMTP_PASSWORD', ''),
        encryption: this.env('SMTP_ENCRYPTION', 'STARTTLS'),
      },

      twilio: {
        accountSid: this.env('TWILIO_ACCOUNT_SID', ''),
        authToken: this.env('TWILIO_AUTH_TOKEN', ''),
        phoneNumber: this.env('TWILIO_PHONE_NUMBER', ''),
        webhookUrl: this.env('TWILIO_WEBHOOK_URL', ''),
      },

      escalation: {
        emergencyScoreThreshold: this.dbNumber('emergency_score_threshold', 0.6),
        acknowledgmentTimeoutSeconds: this.dbNumber('acknowledgment_timeout_seconds', 120),
        maxEscalationAttempts: this.dbNumber('max_escalation_attempts', 8),
      },

      features: {
        emailPollingEnabled: this.envBoolean('EMAIL_POLLING_ENABLED', true),
        twilioEnabled: this.envBoolean('TWILIO_ENABLED', true),
        aiServiceEnabled: this.envBoolean('AI_SERVICE_ENABLED', true),
      },
    };

    this.logger.log('Configuration loaded successfully');
  }

  /**
   * Load settings from database.
   */
  private async loadDbSettings(): Promise<void> {
    try {
      const settings = await this.prisma.systemSetting.findMany();
      for (const setting of settings) {
        this.dbSettings.set(setting.key, setting.value);
      }
      this.logger.debug(`Loaded ${settings.length} settings from database`);
    } catch (error) {
      this.logger.warn(`Failed to load database settings: ${error.message}`);
    }
  }

  /**
   * Get the full configuration object.
   */
  getConfig(): AppConfig {
    return this.config;
  }

  /**
   * Get a specific configuration value by path.
   */
  get<T>(path: string): T {
    const parts = path.split('.');
    let value: any = this.config;

    for (const part of parts) {
      if (value === undefined || value === null) break;
      value = value[part];
    }

    return value as T;
  }

  /**
   * Refresh configuration from database.
   */
  async refresh(): Promise<void> {
    await this.loadConfiguration();
  }

  // Helper methods for reading environment variables
  private env(key: string, defaultValue: string): string {
    return this.configService.get<string>(key) || defaultValue;
  }

  private envNumber(key: string, defaultValue: number): number {
    const value = this.configService.get<string>(key);
    return value ? parseInt(value, 10) : defaultValue;
  }

  private envBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.configService.get<string>(key);
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }

  // Helper methods for reading database settings
  private db(key: string, defaultValue: string): string {
    return this.dbSettings.get(key) || defaultValue;
  }

  private dbNumber(key: string, defaultValue: number): number {
    const value = this.dbSettings.get(key);
    return value ? parseFloat(value) : defaultValue;
  }

  private dbBoolean(key: string, defaultValue: boolean): boolean {
    const value = this.dbSettings.get(key);
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }
}
