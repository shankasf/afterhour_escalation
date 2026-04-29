/**
 * Minimal structured logger for the marketing site.
 *
 * Emits JSON lines to console with a stable shape:
 *   {"ts":"...","level":"info","service":"marketing","msg":"...","correlationId":"...",...}
 *
 * The marketing site is mostly static — this exists primarily so that the
 * root error boundary has somewhere to send unhandled errors.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SERVICE = 'marketing' as const;

const DEFAULT_LEVEL: LogLevel =
  process.env.NODE_ENV === 'production' ? 'info' : 'debug';

// Per-session correlation id. Only meaningful client-side; on the server
// (SSR / RSC render) we return null because each request renders fresh.
let correlationId: string | null = null;

function generateCorrelationId(): string | null {
  // Browser and Node 19+ both expose globalThis.crypto.randomUUID.
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return null;
}

export function getCorrelationId(): string | null {
  if (typeof window === 'undefined') {
    // Server-side: no stable per-session id.
    return null;
  }
  if (correlationId === null) {
    correlationId = generateCorrelationId();
  }
  return correlationId;
}

// --- Redaction --------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Loose phone matcher: 10+ digits possibly with separators / leading +.
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;
const SENSITIVE_KEYS = /^(password|token|apiKey|authorization)$/i;

function redactString(value: string): string {
  return value.replace(EMAIL_RE, '[REDACTED]').replace(PHONE_RE, '[REDACTED]');
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

// --- Emit -------------------------------------------------------------------

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[DEFAULT_LEVEL];
}

function emit(
  level: LogLevel,
  msg: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const record = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    msg,
    correlationId: getCorrelationId(),
    ...((redact(context) as Record<string, unknown> | undefined) ?? {}),
  };

  const line = JSON.stringify(record);
  // Route through the appropriate console method so devtools filtering works.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, context?: Record<string, unknown>) =>
    emit('debug', msg, context),
  info: (msg: string, context?: Record<string, unknown>) =>
    emit('info', msg, context),
  warn: (msg: string, context?: Record<string, unknown>) =>
    emit('warn', msg, context),
  error: (msg: string, context?: Record<string, unknown>) =>
    emit('error', msg, context),
};

export type Logger = typeof logger;
