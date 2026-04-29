/**
 * PII redaction utilities.
 *
 * Applied to every value that is about to be JSON-serialized into a log
 * line. Handles strings, arrays, and plain objects (recursively). Special
 * key names (e.g. `apiKey`, `authorization`) are blanket-redacted regardless
 * of value contents.
 */

const PHONE_E164 = /\+?\d{10,15}/g;
const PHONE_US = /\(\d{3}\)\s?\d{3}-?\d{4}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/g;

const REDACTED_KEYS = new Set<string>([
  'apikey',
  'api_key',
  'authorization',
  'password',
  'secret',
  'token',
  'x-api-key',
]);

const MAX_DEPTH = 8;

/**
 * Replace PII patterns inside a string with placeholder tokens.
 * Order matters: redact bearer tokens first so the JWT body isn't
 * partially rewritten by the email/phone regexes.
 */
export function redactString(input: string): string {
  if (!input) return input;
  return input
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(EMAIL, '[EMAIL]')
    .replace(PHONE_US, '[PHONE]')
    .replace(PHONE_E164, '[PHONE]');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively redact PII from arbitrary values.
 *
 * Strings: pattern-based scrubbing.
 * Plain objects: walk keys; sensitive key names get a blanket `[REDACTED]`,
 * other values are recursed into.
 * Arrays: recursed element-wise.
 * Errors: serialized to `{ message, name, stack }` (each scrubbed).
 * Anything else is returned as-is.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message ?? ''),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(val, depth + 1);
      }
    }
    return out;
  }

  // Fallback for class instances, Maps, Sets, Dates, etc. - stringify
  // safely so we still scrub any embedded PII.
  try {
    return redactString(String(value));
  } catch {
    return '[UNSERIALIZABLE]';
  }
}
