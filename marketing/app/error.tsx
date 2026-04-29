'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

/**
 * App Router root error boundary. Next.js renders this when an unhandled
 * error escapes a nested segment.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('unhandled_error', {
      error: error.message,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 px-6 text-teal-900">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-teal-900/70">
          Please try again. If the problem persists, refresh the page.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-md bg-teal-900 px-4 py-2 text-cream-50 hover:bg-teal-900/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
