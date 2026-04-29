'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '@/lib/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Client-side error boundary that logs unhandled render errors via the
 * structured logger. The marketing App Router uses `app/error.tsx` as its
 * primary boundary; this component is available for any nested client
 * subtree that wants its own boundary.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logger.error('unhandled_error', {
      error: error.message,
      stack: error.stack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
