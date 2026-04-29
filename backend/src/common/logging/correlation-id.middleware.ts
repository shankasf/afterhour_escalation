import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { correlationIdStorage } from './correlation-id.context';

const HEADER_NAME = 'x-correlation-id';

/**
 * Reads the inbound `x-correlation-id` header (or generates a fresh UUIDv4
 * if absent), echoes it back on the response, and stores it in
 * AsyncLocalStorage for the lifetime of the request so loggers and
 * outbound HTTP clients can pick it up.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[HEADER_NAME];
    const correlationId =
      typeof incoming === 'string' && incoming.trim().length > 0
        ? incoming.trim()
        : uuidv4();

    res.setHeader(HEADER_NAME, correlationId);

    correlationIdStorage.run({ correlationId }, () => {
      next();
    });
  }
}
