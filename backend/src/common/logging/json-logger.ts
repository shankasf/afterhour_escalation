import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { WebsocketGateway, LiveLogEntry } from '../../websocket/websocket.gateway';
import { getCorrelationId } from './correlation-id.context';
import { redact, redactString } from './redactor';

type JsonLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<JsonLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevelFromEnv(): JsonLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase().trim();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Map an arbitrary context string to one of the WebSocket dashboard
 * categories. The dashboard already understands these buckets, so we
 * pick the closest match for live streaming. Default is `system`.
 */
function categoryForContext(context: string | undefined): LiveLogEntry['category'] {
  if (!context) return 'system';
  const c = context.toLowerCase();
  if (c.includes('escalat') || c.includes('acknowledg') || c.includes('rotation')) {
    return 'escalation';
  }
  if (c.includes('event')) return 'event';
  if (c.includes('call') || c.includes('voice')) return 'call';
  if (c.includes('sms')) return 'sms';
  if (c.includes('ai')) return 'ai';
  return 'system';
}

/**
 * NestJS logger that emits one structured JSON line per record to stdout
 * (or stderr for errors), pulls the active correlation id from
 * AsyncLocalStorage, scrubs PII via the shared redactor, and continues
 * to forward every entry to the WebSocket dashboard via the existing
 * `WebsocketGateway.emitLog()`.
 */
export class JsonLogger extends ConsoleLogger {
  private static gateway: WebsocketGateway | null = null;
  private readonly threshold: number;

  static setGateway(gateway: WebsocketGateway) {
    JsonLogger.gateway = gateway;
  }

  constructor(context?: string) {
    if (context) {
      super(context);
    } else {
      super();
    }
    this.threshold = LEVEL_RANK[resolveLevelFromEnv()];
  }

  log(message: any, context?: string): void {
    this.emit('info', message, undefined, context);
  }

  error(message: any, stack?: string, context?: string): void {
    this.emit('error', message, stack, context);
  }

  warn(message: any, context?: string): void {
    this.emit('warn', message, undefined, context);
  }

  debug(message: any, context?: string): void {
    this.emit('debug', message, undefined, context);
  }

  verbose(message: any, context?: string): void {
    // Map Nest's `verbose` to our `debug` bucket.
    this.emit('debug', message, undefined, context);
  }

  private emit(
    level: JsonLevel,
    message: unknown,
    stack: string | undefined,
    contextArg: string | undefined,
  ): void {
    if (LEVEL_RANK[level] < this.threshold) return;

    const ctx = contextArg ?? this.context;
    const correlationId = getCorrelationId();

    let msg: string;
    let extra: Record<string, unknown> | undefined;

    if (typeof message === 'string') {
      msg = redactString(message);
    } else if (message instanceof Error) {
      msg = redactString(message.message || message.name);
      extra = {
        error: redactString(message.message || ''),
        stack: message.stack ? redactString(message.stack) : undefined,
      };
    } else {
      // Object payloads: pick a `message` field if present, attach the rest.
      const redacted = redact(message);
      if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
        const r = redacted as Record<string, unknown>;
        if (typeof r.message === 'string') {
          msg = r.message;
          const { message: _m, ...rest } = r;
          extra = rest;
        } else {
          msg = '';
          extra = r;
        }
      } else {
        msg = String(redacted);
      }
    }

    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      service: 'backend',
      msg,
      correlationId,
    };

    if (ctx) record.context = ctx;
    if (stack) record.stack = redactString(stack);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (record[k] === undefined) record[k] = v;
      }
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        ts: record.ts,
        level,
        service: 'backend',
        msg: '[unserializable log payload]',
        correlationId,
      });
    }

    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }

    // Forward to dashboard. Map our level/context onto the existing
    // category vocabulary the WebSocket dashboard already understands.
    if (JsonLogger.gateway) {
      const formatted = ctx ? `[${ctx}] ${msg}` : msg;
      const details: Record<string, unknown> = { context: ctx, correlationId };
      if (extra) Object.assign(details, extra);
      if (stack) details.stack = redactString(stack);
      JsonLogger.gateway.emitLog(
        categoryForContext(ctx),
        level,
        formatted,
        details,
        'backend',
      );
    }
  }

  // Tell Nest which levels to deliver to us so we can self-filter.
  isLevelEnabled(level: LogLevel): boolean {
    switch (level) {
      case 'debug':
      case 'verbose':
        return this.threshold <= LEVEL_RANK.debug;
      case 'log':
        return this.threshold <= LEVEL_RANK.info;
      case 'warn':
        return this.threshold <= LEVEL_RANK.warn;
      case 'error':
      case 'fatal':
        return this.threshold <= LEVEL_RANK.error;
      default:
        return true;
    }
  }
}
