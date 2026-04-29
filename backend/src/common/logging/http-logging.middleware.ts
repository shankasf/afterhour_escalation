import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SKIP_PREFIXES = ['/api/internal/logs', '/health', '/api/health'];

/**
 * Logs every HTTP request once the response has been sent, with method,
 * URL, status code, latency, and (already populated) correlation id.
 * Noisy / health-check paths and websocket upgrades are skipped.
 */
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    // Skip websocket upgrade handshakes - they are streamed separately.
    if ((req.headers.upgrade || '').toLowerCase() === 'websocket') {
      return next();
    }

    const url = req.originalUrl || req.url || '';
    if (SKIP_PREFIXES.some((p) => url.startsWith(p))) {
      return next();
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const statusCode = res.statusCode;

      const payload = {
        message: `${req.method} ${url} ${statusCode}`,
        method: req.method,
        url,
        statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userAgent: req.headers['user-agent'] || null,
        ip: req.ip || req.socket?.remoteAddress || null,
      };

      if (statusCode >= 500) {
        this.logger.error(payload);
      } else if (statusCode >= 400) {
        this.logger.warn(payload);
      } else {
        this.logger.log(payload);
      }
    });

    next();
  }
}
