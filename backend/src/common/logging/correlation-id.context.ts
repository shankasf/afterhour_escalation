import { AsyncLocalStorage } from 'async_hooks';

export interface CorrelationIdStore {
  correlationId: string;
}

/**
 * Singleton AsyncLocalStorage holding the per-request correlation id.
 *
 * Inbound HTTP requests populate this via the CorrelationIdMiddleware so
 * that downstream code (services, loggers, outbound HTTP calls) can read
 * the active correlation id without having to thread the value through.
 */
export const correlationIdStorage = new AsyncLocalStorage<CorrelationIdStore>();

/**
 * Get the active correlation id, or null when called outside a request scope
 * (e.g. application bootstrap, scheduled jobs, lifecycle hooks).
 */
export function getCorrelationId(): string | null {
  const store = correlationIdStorage.getStore();
  return store?.correlationId ?? null;
}
