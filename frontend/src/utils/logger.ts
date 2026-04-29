/**
 * Lightweight client-side structured logger.
 *
 * Emits a single JSON-stringified object as the first argument to the matching
 * `console` method (so DevTools level-filtering still works).
 *
 * Shape:
 *   {"ts","level","service":"frontend","msg","correlationId",...context}
 *
 * Per-session correlation ID is generated once on module load and is used as
 * the `x-correlation-id` header on outbound API calls (see lib/api.ts).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const SESSION_CORRELATION_ID: string =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function resolveCurrentLevel(): LogLevel {
    const envLevel = (import.meta.env.VITE_LOG_LEVEL as string | undefined)?.toLowerCase();
    if (envLevel && envLevel in LEVEL_ORDER) {
        return envLevel as LogLevel;
    }
    return import.meta.env.PROD ? 'info' : 'debug';
}

const CURRENT_LEVEL: LogLevel = resolveCurrentLevel();

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d{10,15}/g;
const REDACT_KEYS = new Set(['password', 'token', 'apiKey', 'authorization']);

function redactString(s: string): string {
    return s.replace(EMAIL_RE, '[EMAIL]').replace(PHONE_RE, '[PHONE]');
}

function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return value;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value.map((v) => redact(v, seen));
    }
    if (typeof value === 'object') {
        if (seen.has(value as object)) return '[Circular]';
        seen.add(value as object);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (REDACT_KEYS.has(k.toLowerCase())) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = redact(v, seen);
            }
        }
        return out;
    }
    // functions, symbols, etc.
    return String(value);
}

function emit(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[CURRENT_LEVEL]) return;

    const redactedContext =
        context && typeof context === 'object'
            ? (redact(context) as Record<string, unknown>)
            : undefined;

    const payload: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        service: 'frontend',
        msg: redactString(msg),
        correlationId: SESSION_CORRELATION_ID,
        ...(redactedContext ?? {}),
    };

    const line = JSON.stringify(payload);
    switch (level) {
        case 'debug':
            console.debug(line);
            break;
        case 'info':
            console.info(line);
            break;
        case 'warn':
            console.warn(line);
            break;
        case 'error':
            console.error(line);
            break;
    }
}

export const logger = {
    debug(msg: string, context?: Record<string, unknown>): void {
        emit('debug', msg, context);
    },
    info(msg: string, context?: Record<string, unknown>): void {
        emit('info', msg, context);
    },
    warn(msg: string, context?: Record<string, unknown>): void {
        emit('warn', msg, context);
    },
    error(msg: string, context?: Record<string, unknown>): void {
        emit('error', msg, context);
    },
};

export function getCorrelationId(): string {
    return SESSION_CORRELATION_ID;
}
