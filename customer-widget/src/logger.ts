/**
 * Tiny structured JSON logger for the customer-widget.
 * Emits one JSON line per call to the browser console with a stable shape:
 *   { ts, level, service, msg, correlationId, ...context }
 *
 * Light PII redaction is applied to context before logging.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SERVICE = 'customer-widget';

const SESSION_CORRELATION_ID: string = (() => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  // Fallback for older runtimes.
  return `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

function resolveLevel(): LogLevel {
  // VITE_LOG_LEVEL overrides if set and valid.
  try {
    const envLevel = (import.meta as any)?.env?.VITE_LOG_LEVEL as string | undefined;
    if (envLevel && envLevel in LEVEL_ORDER) {
      return envLevel as LogLevel;
    }
    const isProd = Boolean((import.meta as any)?.env?.PROD);
    return isProd ? 'info' : 'debug';
  } catch {
    return 'info';
  }
}

const ACTIVE_LEVEL: LogLevel = resolveLevel();

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d{10,15}/g;
const REDACT_KEYS = new Set(['password', 'token', 'apikey', 'authorization']);

function redactString(s: string): string {
  return s.replace(EMAIL_RE, '[EMAIL]').replace(PHONE_RE, '[PHONE]');
}

function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[Object]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[ACTIVE_LEVEL]) return;
  const safeContext = context ? (redact(context) as Record<string, unknown>) : undefined;
  const record = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    msg: redactString(msg),
    correlationId: SESSION_CORRELATION_ID,
    ...(safeContext ?? {}),
  };
  const line = JSON.stringify(record);
  switch (level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(line);
      break;
    case 'info':
      // eslint-disable-next-line no-console
      console.info(line);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(line);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(line);
      break;
  }
}

export const logger = {
  debug: (msg: string, context?: Record<string, unknown>) => emit('debug', msg, context),
  info: (msg: string, context?: Record<string, unknown>) => emit('info', msg, context),
  warn: (msg: string, context?: Record<string, unknown>) => emit('warn', msg, context),
  error: (msg: string, context?: Record<string, unknown>) => emit('error', msg, context),
};

export function getCorrelationId(): string {
  return SESSION_CORRELATION_ID;
}
